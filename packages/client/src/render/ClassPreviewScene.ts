import * as THREE from "three";
import { classDef, itemDef, GENDERS, type ClassId, type CharacterGender, type CharacterAppearance } from "@rustcraft/shared";
import { AnimatedModel, PLAYER_ANIMS } from "./gltf";
import { GENDER_MODEL_URLS, CLASS_WEAPON_NODES } from "./classModels";
import { applyModularGearFromSnapAsync } from "./modularGear";

/** Low stone dais under the character's feet -- gives the spotlight
 *  something to visibly land on instead of just the character floating in
 *  space, echoing the CSS glow the character-select screen draws behind
 *  the (transparent) canvas. */
function buildPedestal(): THREE.Group {
  const group = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.95, 1.05, 0.14, 32),
    new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 0.85, metalness: 0.05 }),
  );
  base.position.y = 0.07;
  base.receiveShadow = true;
  group.add(base);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.95, 0.025, 8, 48),
    new THREE.MeshStandardMaterial({ color: 0xc9a24b, roughness: 0.4, metalness: 0.6, emissive: 0x3a2a0a }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.14;
  group.add(rim);
  // The character model's origin is at its feet (y=0) -- the pedestal was
  // built with its top surface at y=0.14, well above that, so the feet
  // rendered as if buried inside the stone. Drop the whole dais so its top
  // sits just under the character's feet instead of cutting them off.
  group.position.y = -0.16;
  return group;
}

/** Slow-drifting gold motes around the character -- the one bit of ambient
 *  motion on an otherwise static pedestal shot. */
function buildMotes(): { points: THREE.Points; speeds: Float32Array } {
  const count = 40;
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 0.5 + Math.random() * 0.9;
    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = Math.random() * 2.0;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
    speeds[i] = 0.08 + Math.random() * 0.14;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xffd66e,
    size: 0.02,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return { points: new THREE.Points(geo, material), speeds };
}

export interface ClassPreviewOptions {
  /** Character-select stage dressing (stone dais). Default true. */
  pedestal?: boolean;
  /** Floating gold motes. Default true. */
  motes?: boolean;
  /** Soft spotlight pulse. Default true; inventory paperdoll turns this off. */
  spotlight?: boolean;
}

/**
 * Small self-contained viewer for the character-select screen: one
 * AnimatedModel per class, preloaded and kept in the scene (hidden) so
 * switching the preview is instant instead of re-fetching/re-cloning.
 * Static by default (drag to rotate manually) -- no idle auto-spin.
 */
export class ClassPreviewScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private models = new Map<CharacterGender, AnimatedModel>();
  private activeGender: CharacterGender | null = null;
  private activeKey: string | null = null;
  private running = true;
  private paused = false;
  private lastFrame = performance.now();
  private yaw = 0;
  private dragging = false;
  private moved = false;
  private lastPointerX = 0;
  private downX = 0;
  private downY = 0;
  private spotlight: THREE.SpotLight | null = null;
  private motes: THREE.Points | null = null;
  private moteSpeeds: Float32Array | null = null;
  private start = performance.now();

  constructor(
    private canvas: HTMLCanvasElement,
    options: ClassPreviewOptions = {},
  ) {
    const showPedestal = options.pedestal !== false;
    const showMotes = options.motes !== false;
    const showSpotlight = options.spotlight !== false;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    this.camera.position.set(0, 1.05, 5.2);
    this.camera.lookAt(0, 0.95, 0);

    this.scene.add(new THREE.AmbientLight(0xfff2da, showSpotlight ? 0.55 : 0.7));
    const key = new THREE.DirectionalLight(0xffe4b0, showSpotlight ? 1.3 : 1.45);
    key.position.set(-2, 3, 2.5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9db9ff, 0.7);
    rim.position.set(2, 1.5, -2);
    this.scene.add(rim);

    if (showSpotlight) {
      // Theatrical stage spotlight from above -- a directional key light alone
      // reads as generic even-ish lighting; a cone of light landing right at
      // the character's feet is what actually sells "spotlit pedestal".
      this.spotlight = new THREE.SpotLight(0xfff2da, 6, 8, Math.PI / 7, 0.4, 1.2);
      this.spotlight.position.set(0, 4.2, 1.2);
      this.spotlight.target.position.set(0, 0, 0);
      this.scene.add(this.spotlight, this.spotlight.target);
    }

    if (showPedestal) this.scene.add(buildPedestal());
    if (showMotes) {
      const { points, speeds } = buildMotes();
      this.motes = points;
      this.moteSpeeds = speeds;
      this.scene.add(this.motes);
    }

    this.resize();
    canvas.addEventListener("pointerdown", this.onPointerDown);
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    requestAnimationFrame(this.frame);
  }

  resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Load both gender body models up front so hover/select never has to
   *  wait -- gender is a per-character choice now, independent of class, so
   *  only 2 base rigs exist total (not one per class). */
  async preloadAll(): Promise<void> {
    await Promise.all(GENDERS.map((g) => this.ensureLoaded(g)));
  }

  private async ensureLoaded(gender: CharacterGender): Promise<AnimatedModel> {
    let model = this.models.get(gender);
    if (!model) {
      model = new AnimatedModel(PLAYER_ANIMS);
      model.group.visible = false;
      this.scene.add(model.group);
      this.models.set(gender, model);
      await model.loadFrom(GENDER_MODEL_URLS[gender], 1.75);
    }
    return model;
  }

  /** Show whichever gear/appearance the model should currently be wearing: a
   *  specific character's actual equipped items + saved appearance
   *  (character-select mode, `equip` passed in), or the class's default
   *  starting weapon with no armor/hat/cape plus whatever draft appearance
   *  is currently picked (character-creation preview). */
  private applyEquip(
    id: ClassId,
    gender: CharacterGender,
    model: AnimatedModel,
    appearance: CharacterAppearance,
    equip: Partial<Record<string, string>> | null,
  ): void {
    // `equip == null` means "no loadout provided" (character-create bare
    // preview) -- show the class starting weapon for identity. A real equip
    // map (inventory paperdoll / roster character) must honor an empty
    // weapon slot: falling back here made unequipped weapons reappear.
    const weaponId =
      equip == null
        ? classDef(id).startingGear.find((g) => g.slot === "weapon")?.itemId
        : (equip.weapon ?? null);
    const weaponDef = weaponId ? itemDef(weaponId) : null;

    void applyModularGearFromSnapAsync(model, gender, {
      headId: equip?.head ?? null,
      chestId: equip?.chest ?? null,
      armsId: equip?.arms ?? null,
      legsId: equip?.legs ?? null,
      feetId: equip?.feet ?? null,
      shouldersId: equip?.shoulders ?? null,
      neckId: equip?.neck ?? null,
    });
    void model.applyAppearance(gender, appearance);

    const allKnown = CLASS_WEAPON_NODES[id] ?? [];
    model.setWeapon(weaponDef?.weaponModel ?? [], allKnown);
    void model.setWeaponProp(weaponDef?.weaponProp ?? null);
  }

  /** Switch the visible turntable model. Loads on demand if not preloaded
   *  yet. Pass a character's `equip` map (character-select roster) to show
   *  what they actually have on, or omit it (character creation / hovering
   *  a class with no character yet) to show the class's bare default look. */
  setClass(
    id: ClassId,
    gender: CharacterGender,
    appearance: CharacterAppearance,
    equip?: Partial<Record<string, string>> | null,
  ): void {
    const key = JSON.stringify({ id, gender, appearance, equip: equip ?? null });
    if (this.activeKey === key) return;
    this.activeGender = gender;
    this.activeKey = key;
    this.yaw = 0;
    void this.ensureLoaded(gender).then((model) => {
      if (this.activeKey !== key) return; // superseded by a later hover/select
      this.applyEquip(id, gender, model, appearance, equip ?? null);
      for (const [g, m] of this.models) m.group.visible = g === gender;
    });
  }

  /** Character-select preview just shows the champion standing (idle) for now
   *  — the celebratory flourish is disabled. */
  flourish(): void {}

  private onPointerDown = (e: PointerEvent): void => {
    this.dragging = true;
    this.moved = false;
    this.lastPointerX = e.clientX;
    this.downX = e.clientX;
    this.downY = e.clientY;
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastPointerX;
    this.lastPointerX = e.clientX;
    if (Math.abs(e.clientX - this.downX) > 4 || Math.abs(e.clientY - this.downY) > 4) this.moved = true;
    this.yaw += dx * 0.012;
  };

  private onPointerUp = (): void => {
    if (this.dragging && !this.moved) this.flourish();
    this.dragging = false;
  };

  private frame = (): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    if (this.paused) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    const model = this.activeGender ? this.models.get(this.activeGender) : null;
    if (model) {
      model.group.rotation.y = this.yaw;
      model.update(dt);
    }

    if (this.motes && this.moteSpeeds) {
      const positions = this.motes.geometry.attributes.position!.array as Float32Array;
      for (let i = 0; i < this.moteSpeeds.length; i++) {
        const yi = i * 3 + 1;
        positions[yi] = (positions[yi] ?? 0) + this.moteSpeeds[i]! * dt;
        if (positions[yi]! > 2.0) positions[yi] = 0;
      }
      this.motes.geometry.attributes.position!.needsUpdate = true;
    }

    if (this.spotlight) {
      const t = (now - this.start) / 1000;
      this.spotlight.intensity = 6 + Math.sin(t * 1.7) * 0.3;
    }

    this.renderer.render(this.scene, this.camera);
  };

  /** Stop updating/rendering while keeping models warm (e.g. inventory tab hidden). */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (!paused) this.lastFrame = performance.now();
  }

  dispose(): void {
    this.running = false;
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    for (const model of this.models.values()) {
      this.scene.remove(model.group);
      model.dispose();
    }
    this.models.clear();
    if (this.motes) {
      this.motes.geometry.dispose();
      (this.motes.material as THREE.PointsMaterial).dispose();
      this.motes = null;
    }
    this.renderer.dispose();
  }
}
