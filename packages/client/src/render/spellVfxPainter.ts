import * as THREE from "three";
import { getSpellVfxSpec, SCHOOL_PALETTES, type SpellVfxSpec } from "./spellSpecs";
import { GroundDecals, ShockwaveRings } from "./spellVfxPrimitives";
import type { SpellVfxSystem } from "./spellVfx";

/**
 * Data-Driven Ability VFX Painter Engine
 *
 * Intercepts combat events, resolves spell specs, and coordinates visual
 * components (shockwave rings, ground decals, particle bursts, aura glows).
 */

export class SpellVfxPainter {
  private rings: ShockwaveRings;
  private decals: GroundDecals;
  private particleSystem?: SpellVfxSystem;

  constructor(scene: THREE.Scene, particleSystem?: SpellVfxSystem) {
    this.rings = new ShockwaveRings(scene);
    this.decals = new GroundDecals(scene);
    this.particleSystem = particleSystem;
  }

  /** Called when a spell is cast by an entity. `groundY` is the caster's
   *  foot/terrain height -- the windup ring lies flat on the ground there,
   *  not at whatever height `casterPos.y` happens to carry. Defaults to
   *  casterPos.y for callers that already pass a ground-level position. */
  handleSpellCast(spellId: string, casterPos: THREE.Vector3, school: string = "physical", groundY: number = casterPos.y): void {
    const spec = getSpellVfxSpec(spellId, school);

    // 1. Trigger Cast Windup Ring if specified
    if (spec.windup && spec.windup.style !== "none") {
      const radius = (spec.windup.scale ?? 1.0) * 1.5;
      this.rings.spawn(casterPos.x, groundY, casterPos.z, radius, spec.palette.primary, 0.6);
    }
  }

  /** Called when a spell impacts a target or ground position. `groundY` is
   *  the target's foot/terrain height -- ground-plane elements (shockwave
   *  ring, scorch/frost/holy decal) are laid there so they hug the floor
   *  under the target instead of floating at chest height (which is where
   *  `impactPos.y` sits, since impacts resolve against the torso). The
   *  particle burst still fires from the real impact point. */
  handleSpellImpact(spellId: string, impactPos: THREE.Vector3, school: string = "physical", groundY: number = impactPos.y): void {
    const spec = getSpellVfxSpec(spellId, school);
    const impact = spec.impact ?? { ringRadius: 1.5, burstCount: 16, decal: "cracked_earth" };

    // 1. Spawn Expanding Shockwave Ring (flat on the ground under the target)
    if (impact.ringRadius && impact.ringRadius > 0) {
      this.rings.spawn(impactPos.x, groundY, impactPos.z, impact.ringRadius, spec.palette.primary, 0.5);
    }

    // 2. Spawn Ground Decal (Scorch / Frost / Holy / Shadow) at the feet
    if (impact.decal && impact.decal !== "none") {
      const decalRadius = (impact.ringRadius ?? 1.5) * 0.8;
      this.decals.spawn(impactPos.x, groundY, impactPos.z, decalRadius, impact.decal, spec.palette.secondary, 5.0);
    }

    // 3. Spawn Quarks Particle Burst at the actual impact point
    if (this.particleSystem) {
      this.particleSystem.spawnForSchool((school as any) ?? "physical", impactPos);
    }
  }

  update(dt: number): void {
    this.rings.update(dt);
    this.decals.update(dt);
  }
}
