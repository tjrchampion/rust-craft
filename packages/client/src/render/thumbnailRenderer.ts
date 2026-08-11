/**
 * Shared character-thumbnail renderer.
 *
 * Previously every <CharacterThumbnail> spun up its OWN THREE.WebGLRenderer (a
 * full WebGL context — browsers hard-cap ~16 and evict/lose the oldest) plus a
 * full geared-character load, and ran a perpetual 60fps render loop for what is
 * a static pose. Character-create mounts ~10 of those at once → the lag.
 *
 * This replaces all of that with ONE renderer that draws each thumbnail a
 * single time to a PNG data URL, fed by a serial queue (so model loads never
 * burst) with a small cache. Components just show an <img> + a loader.
 */
import * as THREE from "three";
import type { CharacterAppearance, CharacterGender, ClassId } from "@rustcraft/shared";
import { AnimatedModel, PLAYER_ANIMS } from "./gltf";
import { GENDER_MODEL_URLS } from "./classModels";
import { applyModularGearFromSnapAsync } from "./modularGear";
import { nextIdle, nextFrame } from "./idleScheduler";

/** Async canvas → Blob so the PNG encode runs OFF the main thread (unlike the
 *  synchronous toDataURL, which froze the cursor while it encoded). */
function canvasToBlobUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(URL.createObjectURL(blob));
      else reject(new Error("thumbnail toBlob failed"));
    }, "image/png");
  });
}

export type ThumbnailMode = "head" | "full";

export interface ThumbnailRequest {
  classId: ClassId;
  gender: CharacterGender;
  appearance: CharacterAppearance;
  equip?: Partial<Record<string, string>> | null;
  mode?: ThumbnailMode;
  /** Skip the CLASS_FULL_ARMOR fallback below -- an unequipped slot renders
   *  bare instead of thematic default armor. Character-select/create cards
   *  want the "what could you look like" themed preview (the default);
   *  anywhere showing a real character's actual gear (inventory paperdoll,
   *  HUD portrait) must set this or an empty slot lies and shows armor the
   *  player doesn't have equipped. */
  bareUnequipped?: boolean;
}

const SIZE = 128;
const CACHE_MAX = 96;

/** Thematic full class armor so class thumbnails always look fully geared. */
const CLASS_FULL_ARMOR: Record<string, Record<string, string>> = {
  warrior: { head: "knight_helmet", chest: "knight_chest", arms: "knight_arms", legs: "knight_legs", feet: "knight_feet", shoulders: "knight_pauldrons_round" },
  paladin: { head: "knight_helmet", chest: "knight_chest", arms: "knight_arms", legs: "knight_legs", feet: "knight_feet", shoulders: "knight_pauldrons_spike" },
  berserker: { chest: "knight_chest_cloth", arms: "knight_arms", legs: "knight_legs", feet: "knight_feet", shoulders: "knight_horns" },
  ranger: { head: "ranger_hood", chest: "ranger_chest", arms: "ranger_arms", legs: "ranger_legs", feet: "ranger_feet", shoulders: "ranger_pauldrons" },
  rogue: { head: "ranger_hood", chest: "ranger_chest", arms: "ranger_arms", legs: "ranger_legs", feet: "ranger_feet" },
  assassin: { head: "ranger_hood", chest: "ranger_chest", arms: "ranger_arms", legs: "ranger_legs", feet: "ranger_feet" },
  mage: { chest: "wizard_chest", arms: "wizard_arms", legs: "wizard_legs", feet: "wizard_feet" },
  cleric: { head: "peasant_hood", chest: "wizard_chest", arms: "wizard_arms", legs: "wizard_legs", feet: "wizard_feet" },
  druid: { head: "peasant_hood", chest: "wizard_chest", arms: "wizard_arms", legs: "wizard_legs", feet: "wizard_feet" },
  engineer: { chest: "noble_chest", arms: "noble_arms", legs: "noble_legs", feet: "noble_feet", shoulders: "noble_pauldrons" },
};

const SLOTS = ["head", "chest", "arms", "legs", "feet", "shoulders", "neck"] as const;

function effectiveEquip(req: ThumbnailRequest): Partial<Record<string, string | null>> {
  const def = req.bareUnequipped ? {} : (CLASS_FULL_ARMOR[req.classId] ?? {});
  const out: Partial<Record<string, string | null>> = {};
  for (const s of SLOTS) out[s] = req.equip?.[s] ?? def[s] ?? null;
  return out;
}

function cacheKey(req: ThumbnailRequest): string {
  const a = req.appearance;
  const eq = effectiveEquip(req);
  return [
    req.mode ?? "head",
    req.bareUnequipped ? "bare" : "themed",
    req.classId,
    req.gender,
    a.hairStyle,
    a.facialHair,
    a.hairColor,
    a.eyeColor,
    a.outfitHue,
    ...SLOTS.map((s) => eq[s] ?? "-"),
  ].join("|");
}

interface Job {
  key: string;
  req: ThumbnailRequest;
  resolve: (url: string) => void;
  reject: (err: unknown) => void;
}

class ThumbnailRenderer {
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private cameraHead: THREE.PerspectiveCamera | null = null;
  private cameraFull: THREE.PerspectiveCamera | null = null;
  private readonly cache = new Map<string, string>();
  private readonly queue: Job[] = [];
  /** Persistent per-gender rigs, reused across jobs. Building an AnimatedModel
   *  (rig clone + anim binding) per thumbnail was the biggest repeated spike;
   *  now it's paid once per gender and each job just re-applies gear/hair. */
  private readonly models = new Map<CharacterGender, AnimatedModel>();
  private running = false;
  private disposed = false;

  private ensure(): void {
    if (this.renderer) return;
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    // preserveDrawingBuffer so the async toBlob() reads the rendered frame
    // (it runs a task later, after the draw call returns).
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
    // Cap DPR — a 128px portrait at 1.5x is plenty and keeps the per-thumbnail
    // GPU upload/draw cost (which blocks the main thread) low.
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
    renderer.setSize(SIZE, SIZE, false);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xfff2da, 0.95));
    const key = new THREE.DirectionalLight(0xffe4b0, 1.4);
    key.position.set(-1.5, 2.5, 2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xa060ff, 1.2);
    rim.position.set(1.5, 1, -1.5);
    scene.add(rim);
    this.scene = scene;

    const head = new THREE.PerspectiveCamera(32, 1, 0.1, 10);
    head.position.set(0, 1.58, 0.55);
    head.lookAt(0, 1.56, 0);
    this.cameraHead = head;

    const full = new THREE.PerspectiveCamera(30, 1, 0.1, 10);
    full.position.set(0, 1.0, 2.2);
    full.lookAt(0, 0.9, 0);
    this.cameraFull = full;
  }

  /** Queue a thumbnail render; resolves to a PNG data URL (cached). */
  request(req: ThumbnailRequest): Promise<string> {
    const key = cacheKey(req);
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    return new Promise<string>((resolve, reject) => {
      this.queue.push({ key, req, resolve, reject });
      void this.pump();
    });
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length && !this.disposed) {
        const job = this.queue.shift()!;
        const cached = this.cache.get(job.key);
        if (cached) {
          job.resolve(cached);
          continue;
        }
        try {
          const url = await this.renderOne(job.req);
          this.cache.set(job.key, url);
          // Bounded LRU — appearance tweaking in create mode can mint many
          // keys; drop (and revoke) the oldest so object URLs can't leak/grow.
          if (this.cache.size > CACHE_MAX) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) {
              const stale = this.cache.get(oldest);
              if (stale) URL.revokeObjectURL(stale);
              this.cache.delete(oldest);
            }
          }
          job.resolve(url);
        } catch (err) {
          job.reject(err);
        }
        // Yield so the UI paints between renders — the queue is the throttle.
        await nextIdle();
      }
    } finally {
      this.running = false;
    }
  }

  /** Lazily build (once) and return the persistent rig for a gender. */
  private async ensureModel(gender: CharacterGender): Promise<AnimatedModel> {
    let model = this.models.get(gender);
    if (!model) {
      model = new AnimatedModel(PLAYER_ANIMS);
      model.group.visible = false;
      this.scene!.add(model.group);
      this.models.set(gender, model);
      await model.loadFrom(GENDER_MODEL_URLS[gender], 1.75);
    }
    return model;
  }

  private async renderOne(req: ThumbnailRequest): Promise<string> {
    this.ensure();
    const renderer = this.renderer!;
    const scene = this.scene!;
    const camera = (req.mode ?? "head") === "head" ? this.cameraHead! : this.cameraFull!;

    const model = await this.ensureModel(req.gender);
    const eq = effectiveEquip(req);
    await applyModularGearFromSnapAsync(model, req.gender, {
      headId: eq.head ?? null,
      chestId: eq.chest ?? null,
      armsId: eq.arms ?? null,
      legsId: eq.legs ?? null,
      feetId: eq.feet ?? null,
      shouldersId: eq.shoulders ?? null,
      neckId: eq.neck ?? null,
    });
    await model.applyAppearance(req.gender, req.appearance);
    model.group.rotation.y = 0.28;
    model.play("idle");
    model.update(0);

    // Only the rig we're capturing is visible for this render.
    for (const [g, m] of this.models) m.group.visible = g === req.gender;

    // Yield a frame before the GPU work so the cursor/compositor stays live,
    // then render (uploads textures) and read back asynchronously via toBlob.
    await nextFrame();
    renderer.render(scene, camera);
    return canvasToBlobUrl(renderer.domElement);
  }
}

let shared: ThumbnailRenderer | null = null;

export function requestCharacterThumbnail(req: ThumbnailRequest): Promise<string> {
  if (!shared) shared = new ThumbnailRenderer();
  return shared.request(req);
}
