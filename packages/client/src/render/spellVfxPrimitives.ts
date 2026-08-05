import * as THREE from "three";
import type { DecalStyle } from "./spellSpecs";
import { abilityVfxTextures } from "./fxTextures";

/**
 * Pre-allocated Pooled 3D Visual Primitives
 *
 * Implements hard-capped, zero-allocation primitive pools for:
 * - Shockwave Rings (Expanding ground & impact rings)
 * - Ground Decals (Scorch marks, frost runes, holy seals)
 * - Ribbon Trails (Comet trails & weapon slash arcs)
 */

// ---------------------------------------------------------------------------
// 1. Shockwave Rings Pool
// ---------------------------------------------------------------------------

interface ActiveRing {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  x: number;
  y: number;
  z: number;
  startRadius: number;
  maxRadius: number;
  progress: number; // 0 to 1
  duration: number;
  colorHex: number;
}

export class ShockwaveRings {
  private group = new THREE.Group();
  private pool: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>[] = [];
  private active: ActiveRing[] = [];
  private static readonly MAX_RINGS = 32;
  private geometry: THREE.RingGeometry;

  constructor(scene: THREE.Scene) {
    // Shared ring geometry (innerRadius 0.7, outerRadius 1.0, 32 segments)
    this.geometry = new THREE.RingGeometry(0.7, 1.0, 32);
    this.geometry.rotateX(-Math.PI / 2); // Orient horizontal on XZ plane

    for (let i = 0; i < ShockwaveRings.MAX_RINGS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        map: abilityVfxTextures.runeRing,
        transparent: true,
        opacity: 1,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this.geometry, mat);
      mesh.visible = false;
      this.pool.push(mesh);
      this.group.add(mesh);
    }
    scene.add(this.group);
  }

  spawn(x: number, y: number, z: number, maxRadius: number, colorHex: number, duration = 0.5): void {
    const mesh = this.pool.pop();
    if (!mesh) return; // Cap reached

    mesh.material.color.setHex(colorHex);
    mesh.material.opacity = 1.0;
    mesh.position.set(x, y + 0.02, z);
    mesh.scale.set(0.1, 0.1, 0.1);
    mesh.visible = true;

    this.active.push({
      mesh,
      x,
      y,
      z,
      startRadius: 0.2,
      maxRadius,
      progress: 0,
      duration,
      colorHex,
    });
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const r = this.active[i]!;
      r.progress += dt / r.duration;

      if (r.progress >= 1.0) {
        r.mesh.visible = false;
        this.pool.push(r.mesh);
        this.active.splice(i, 1);
        continue;
      }

      // Smooth step easing out
      const t = r.progress;
      const easeOut = 1 - Math.pow(1 - t, 3);
      const radius = r.startRadius + (r.maxRadius - r.startRadius) * easeOut;

      r.mesh.scale.set(radius, radius, radius);
      r.mesh.material.opacity = Math.max(0, 1.0 - t * t);
    }
  }

  dispose(): void {
    this.geometry.dispose();
    for (const mesh of this.pool) {
      mesh.material.dispose();
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Procedural Ground Decals Pool
// ---------------------------------------------------------------------------

interface ActiveDecal {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  duration: number;
  elapsed: number;
}

export class GroundDecals {
  private group = new THREE.Group();
  private pool: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  private active: ActiveDecal[] = [];
  private static readonly MAX_DECALS = 32;
  private textures: Map<string, THREE.CanvasTexture> = new Map();

  constructor(scene: THREE.Scene) {
    this.createTextures();

    const planeGeo = new THREE.PlaneGeometry(1, 1);
    planeGeo.rotateX(-Math.PI / 2);

    for (let i = 0; i < GroundDecals.MAX_DECALS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 1,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        side: THREE.DoubleSide,
        blending: THREE.NormalBlending,
      });
      const mesh = new THREE.Mesh(planeGeo, mat);
      mesh.visible = false;
      this.pool.push(mesh);
      this.group.add(mesh);
    }
    scene.add(this.group);
  }

  /** Styles whose texture bakes its own colour (ported from the reference
   *  fx_textures.ts) -- these ignore the incoming spell tint so a scorch
   *  always reads as a burn, frost as ice, etc. holy/shadow stay soft
   *  radial glows that DO take the spell's secondary colour. */
  private static readonly BAKED_STYLES = new Set<DecalStyle>(["scorch", "frost", "cracked_earth"]);

  private createTextures(): void {
    // Detailed, colour-baked decals for the elemental ground marks.
    this.textures.set("scorch", abilityVfxTextures.char);
    this.textures.set("frost", abilityVfxTextures.rime);
    this.textures.set("cracked_earth", abilityVfxTextures.crack);

    // holy + shadow remain soft tintable radial glows.
    for (const type of ["holy", "shadow"] as DecalStyle[]) {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d")!;
      const grad = ctx.createRadialGradient(64, 64, 5, 64, 64, 60);
      if (type === "holy") {
        grad.addColorStop(0, "rgba(255, 240, 150, 0.9)");
        grad.addColorStop(0.5, "rgba(255, 200, 80, 0.5)");
        grad.addColorStop(1, "rgba(255, 180, 0, 0)");
      } else {
        grad.addColorStop(0, "rgba(30, 10, 40, 0.9)");
        grad.addColorStop(0.7, "rgba(15, 5, 20, 0.4)");
        grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      }
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(64, 64, 60, 0, Math.PI * 2);
      ctx.fill();
      this.textures.set(type, new THREE.CanvasTexture(canvas));
    }
  }

  spawn(x: number, y: number, z: number, radius: number, style: DecalStyle = "scorch", colorHex?: number, duration = 4.0): void {
    if (style === "none") return;
    const mesh = this.pool.pop();
    if (!mesh) return;

    const tex = this.textures.get(style) ?? this.textures.get("scorch")!;
    mesh.material.map = tex;
    // Baked-colour decals draw untinted; soft glows take the spell's secondary.
    if (GroundDecals.BAKED_STYLES.has(style)) mesh.material.color.setHex(0xffffff);
    else if (colorHex !== undefined) mesh.material.color.setHex(colorHex);
    else mesh.material.color.setHex(0xffffff);

    mesh.position.set(x, y + 0.02, z);
    mesh.scale.set(radius * 2, 1, radius * 2);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    mesh.material.opacity = 0.85;
    mesh.visible = true;

    this.active.push({ mesh, duration, elapsed: 0 });
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const d = this.active[i]!;
      d.elapsed += dt;

      if (d.elapsed >= d.duration) {
        d.mesh.visible = false;
        this.pool.push(d.mesh);
        this.active.splice(i, 1);
        continue;
      }

      // Fade out smoothly in the last 40% of duration
      const fadeStart = d.duration * 0.6;
      if (d.elapsed > fadeStart) {
        const fadePct = 1 - (d.elapsed - fadeStart) / (d.duration - fadeStart);
        d.mesh.material.opacity = 0.85 * fadePct;
      }
    }
  }
}
