import * as THREE from "three";
import { auraDef } from "@rustcraft/shared";
import { abilityVfxTextures } from "./fxTextures";

/**
 * Persistent + one-shot spell auras attached to a character.
 *
 * Unlike the impact bursts (spellVfx/spellVfxPainter), these follow the
 * target: the visual is parented to the character's THREE.Group, so it moves,
 * turns, and is culled with the body automatically. Two entry points:
 *
 *  - `syncBuffs(group, auraIds)` mirrors a character's active *positive*
 *    auras (from SelfState.auras) as a lasting glow/shield/halo, adding and
 *    fading them as buffs come and go each frame.
 *  - `flourish(group, style, ...)` fires a short celebratory effect (a heal
 *    landing) that cleans itself up.
 */

/** Visual archetypes, reused across buffs and debuffs:
 *  - "regen": motes streaming up from the feet + a ground halo (HoTs, DoTs)
 *  - "shield": a translucent shell around the torso (shields/barriers)
 *  - "glow": a ground rune ring + a few torso-orbiting motes (haste/CC/misc) */
export type AuraVisual = "regen" | "shield" | "glow";

interface Mote {
  sprite: THREE.Sprite;
  angle: number;
  radius: number;
  speed: number; // orbit/rise rate
  phase: number; // 0..1 offset so motes don't move in lockstep
}

interface AuraItem {
  key: string; // "<group.uuid>|<auraId>" for buffs, "flourish#<n>" for one-shots
  group: THREE.Object3D;
  root: THREE.Group;
  style: AuraVisual;
  color: THREE.Color;
  age: number; // seconds since spawn
  fadeIn: number; // seconds
  ttl: number | null; // total lifetime for one-shots; null = lives until released
  releasing: boolean; // buff expired -> fading out then dispose
  releaseAge: number; // age at which release began
  shell?: THREE.Mesh; // shield bubble
  ring?: THREE.Mesh; // ground halo / rune ring
  motes: Mote[];
}

const FADE = 0.35; // seconds for buffs to fade in / out
const FLOURISH_FADE = 0.25;

/** Which lasting auras get a body visual, and what it looks like -- covers
 *  both positive buffs (shown on the local player from SelfState.auras) and
 *  negative debuffs (shown on mobs/remote players from their snapshot
 *  `debuffs`). Long-lived utility buffs (30-min flasks, invisibility, the
 *  always-on pet buff) return null so nobody's permanently wreathed in glow,
 *  and chilled/frozen return null because the ice overlay already renders
 *  those (see EntityManager.createIceMesh). */
export function auraVisualFor(auraId: string): { style: AuraVisual; color: number } | null {
  let def;
  try {
    def = auraDef(auraId);
  } catch {
    return null;
  }

  if (!def.positive) {
    // Debuffs the ice overlay / nothing should visualise.
    if (auraId === "chilled" || auraId === "frozen") return null;
    if (auraId === "arcane_silence") return null; // brief, not a body aura
    if (auraId === "entangled") return { style: "glow", color: 0x5aa838 }; // roots at the feet
    if (auraId === "bleeding") return { style: "glow", color: 0xd12626 };
    // Remaining DoTs: motes rising off the body, coloured by damage school.
    const dt = def.tick?.damageType;
    const color =
      dt === "fire" ? 0xff6a1a :
      dt === "nature" ? 0x7ad63a :
      dt === "holy" ? 0xffe066 :
      dt === "arcane" ? 0xb86bff :
      dt === "frost" ? 0x8fd8ff :
      0xd12626;
    return { style: "regen", color };
  }

  if (auraId === "invisible") return null;
  if (def.durationS >= 40) return null; // long potions/flasks/pet buff
  if (def.tick?.type === "heal") return { style: "regen", color: 0x69ff9c };
  if (def.icon === "🛡️" || auraId.includes("shield") || auraId.includes("wall")) {
    return { style: "shield", color: 0x9fd8ff };
  }
  const mods = def.statModifiers ?? {};
  if ((mods.power ?? 0) > 0 || (mods.critChance ?? 0) > 0) return { style: "glow", color: 0xff7a3c };
  if ((mods.hasteRating ?? 0) > 0 || (mods.moveSpeedMult ?? 0) > 0) return { style: "glow", color: 0x74d0ff };
  return { style: "glow", color: 0xffd27a };
}

export class CharacterAuras {
  private items: AuraItem[] = [];
  private flourishSeq = 0;

  // Shared geometries (built lazily, reused across every aura instance).
  private static _shieldGeo?: THREE.SphereGeometry;
  private static _haloGeo?: THREE.RingGeometry;
  private static _runeGeo?: THREE.PlaneGeometry;

  private static shieldGeo(): THREE.SphereGeometry {
    return (this._shieldGeo ??= new THREE.SphereGeometry(0.72, 20, 14));
  }
  private static haloGeo(): THREE.RingGeometry {
    if (!this._haloGeo) {
      this._haloGeo = new THREE.RingGeometry(0.5, 0.85, 40);
      this._haloGeo.rotateX(-Math.PI / 2);
    }
    return this._haloGeo;
  }
  private static runeGeo(): THREE.PlaneGeometry {
    if (!this._runeGeo) {
      this._runeGeo = new THREE.PlaneGeometry(1.5, 1.5);
      this._runeGeo.rotateX(-Math.PI / 2);
    }
    return this._runeGeo;
  }

  /** Reconcile a character's lasting positive buffs. `auraIds` is the full
   *  current aura list (from SelfState.auras / a snapshot); buffs that map to
   *  a visual are added when they appear and faded out when they drop off. */
  syncBuffs(group: THREE.Object3D, auraIds: string[]): void {
    const prefix = `${group.uuid}|`;
    const want = new Map<string, { style: AuraVisual; color: number }>();
    for (const id of auraIds) {
      const vis = auraVisualFor(id);
      if (vis) want.set(prefix + id, vis);
    }
    // Fade out visuals whose buff has expired.
    for (const item of this.items) {
      if (!item.key.startsWith(prefix) || item.ttl !== null) continue;
      if (!want.has(item.key) && !item.releasing) this.beginRelease(item);
    }
    // Spawn newly-applied buffs.
    for (const [key, vis] of want) {
      if (this.items.some((it) => it.key === key)) continue;
      this.items.push(this.build(key, group, vis.style, vis.color, null));
    }
  }

  /** One-shot flourish (a heal landing on `group`). Rising motes + a quick
   *  ground halo, gone in ~`ttlSec`. */
  flourish(group: THREE.Object3D, style: AuraVisual, color: number, ttlSec = 1.1): void {
    this.items.push(this.build(`flourish#${this.flourishSeq++}`, group, style, color, ttlSec));
  }

  private beginRelease(item: AuraItem): void {
    item.releasing = true;
    item.releaseAge = item.age;
  }

  private build(key: string, group: THREE.Object3D, style: AuraVisual, colorHex: number, ttl: number | null): AuraItem {
    const root = new THREE.Group();
    group.add(root);
    const color = new THREE.Color(colorHex);
    const item: AuraItem = {
      key, group, root, style, color, age: 0, fadeIn: ttl === null ? FADE : FLOURISH_FADE,
      ttl, releasing: false, releaseAge: 0, motes: [],
    };

    if (style === "shield") {
      const shell = new THREE.Mesh(
        CharacterAuras.shieldGeo(),
        new THREE.MeshBasicMaterial({
          color, transparent: true, opacity: 0, depthWrite: false,
          side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        }),
      );
      shell.position.y = 1.0;
      root.add(shell);
      item.shell = shell;
    } else if (style === "regen") {
      item.ring = this.makeGroundRing(CharacterAuras.haloGeo(), color, 0.02);
      root.add(item.ring);
      this.addMotes(item, ttl === null ? 5 : 9, "rise");
    } else {
      // glow buff: rune ring on the ground + a few orbiting motes at the torso
      item.ring = this.makeGroundRing(CharacterAuras.runeGeo(), color, 0.03, abilityVfxTextures.runeRing);
      root.add(item.ring);
      this.addMotes(item, 3, "orbit");
    }
    return item;
  }

  private makeGroundRing(geo: THREE.BufferGeometry, color: THREE.Color, y: number, map?: THREE.Texture): THREE.Mesh {
    const mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color, map, transparent: true, opacity: 0, depthWrite: false,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      }),
    );
    mesh.position.y = y;
    return mesh;
  }

  private addMotes(item: AuraItem, count: number, kind: "rise" | "orbit"): void {
    for (let i = 0; i < count; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: abilityVfxTextures.glow, color: item.color, transparent: true,
          opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
        }),
      );
      sprite.scale.setScalar(kind === "rise" ? 0.3 : 0.24);
      item.root.add(sprite);
      item.motes.push({
        sprite,
        angle: (i / count) * Math.PI * 2,
        radius: kind === "rise" ? 0.18 + Math.random() * 0.34 : 0.62,
        speed: kind === "rise" ? 0.6 + Math.random() * 0.4 : 1.4,
        phase: Math.random(),
      });
    }
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i]!;
      item.age += dt;

      // Envelope: 0 -> 1 fade-in, hold, then fade-out (ttl end or release).
      let env = Math.min(1, item.age / item.fadeIn);
      if (item.ttl !== null) {
        const remaining = item.ttl - item.age;
        if (remaining <= 0) {
          this.dispose(item);
          this.items.splice(i, 1);
          continue;
        }
        env *= Math.min(1, remaining / FLOURISH_FADE);
      } else if (item.releasing) {
        const out = 1 - (item.age - item.releaseAge) / FADE;
        if (out <= 0) {
          this.dispose(item);
          this.items.splice(i, 1);
          continue;
        }
        env *= out;
      }

      this.animate(item, env);
    }
  }

  private animate(item: AuraItem, env: number): void {
    const t = item.age;
    if (item.shell) {
      const mat = item.shell.material as THREE.MeshBasicMaterial;
      mat.opacity = env * (0.16 + Math.sin(t * 3) * 0.05);
      item.shell.rotation.y += 0.6 * (1 / 60);
      const s = 1 + Math.sin(t * 2.5) * 0.03;
      item.shell.scale.setScalar(s);
    }
    if (item.ring) {
      const mat = item.ring.material as THREE.MeshBasicMaterial;
      const base = item.style === "glow" ? 0.5 : 0.6;
      mat.opacity = env * (base + Math.sin(t * 4) * 0.12);
      item.ring.rotation.y += (item.style === "glow" ? 0.5 : -0.9) * (1 / 60);
    }
    for (const m of item.motes) {
      const mat = m.sprite.material as THREE.SpriteMaterial;
      if (item.style === "regen") {
        // Rise from the feet, spiralling gently, fading out near the head.
        const p = (t * m.speed + m.phase) % 1;
        const ang = m.angle + t * 1.2;
        m.sprite.position.set(Math.cos(ang) * m.radius, 0.1 + p * 1.85, Math.sin(ang) * m.radius);
        mat.opacity = env * Math.sin(p * Math.PI) * 0.9;
      } else {
        // Orbit the torso.
        const ang = m.angle + t * m.speed;
        m.sprite.position.set(Math.cos(ang) * m.radius, 1.0 + Math.sin(t * 2 + m.phase * 6.28) * 0.12, Math.sin(ang) * m.radius);
        mat.opacity = env * 0.85;
      }
    }
  }

  private dispose(item: AuraItem): void {
    item.group.remove(item.root);
    if (item.shell) (item.shell.material as THREE.Material).dispose();
    if (item.ring) (item.ring.material as THREE.Material).dispose();
    for (const m of item.motes) (m.sprite.material as THREE.Material).dispose();
  }

  /** Drop every aura attached to `group` immediately (entity despawn/death). */
  clearGroup(group: THREE.Object3D): void {
    const prefix = `${group.uuid}|`;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i]!;
      if (item.group === group || item.key.startsWith(prefix)) {
        this.dispose(item);
        this.items.splice(i, 1);
      }
    }
  }
}
