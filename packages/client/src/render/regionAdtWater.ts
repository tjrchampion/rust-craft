import * as THREE from "three";
import {
  ADT_KEEP_EXTRA,
  ADT_RING,
  adtKeyChebyshevDist,
  adtRingKeysInBounds,
  parseAdtKey,
  type RegionBlueprint,
} from "@rustcraft/shared";
import { buildRegionAdtWaterTile, createRegionWaterMaterial, applyWaterEnvironment } from "./terrain";
import type { StreamBudget } from "./streamBudget";

const BUILDS_PER_FRAME = 1;
const MAX_ATTEMPTS = 8;
const DISPOSES_PER_FRAME = 1;

type WaterBlueprint = Pick<RegionBlueprint, "gridSize" | "pitch" | "heights"> & {
  waterHeights: number[];
};

/**
 * Streams 64 m ADT tiles of painted region water around the player.
 * Dry tiles are skipped (no mesh). Editor preview still uses the full mesh.
 * Same load/keep hysteresis as terrain so seams stay filled while walking.
 */
export class RegionAdtWaterStreamer {
  readonly group = new THREE.Group();
  private material: THREE.MeshLambertMaterial;
  private tiles = new Map<string, THREE.Mesh>();
  /** Tiles known to have no water — skip rebuild attempts. */
  private dryTiles = new Set<string>();
  private pending: string[] = [];
  private disposeQueue: THREE.BufferGeometry[] = [];
  private lastAnchorKey = "";
  private readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private keepRing: number;
  private scrollT = 0;

  constructor(
    parent: THREE.Object3D,
    private blueprint: WaterBlueprint,
    private ring = ADT_RING,
  ) {
    this.group.name = "region-adt-water";
    this.keepRing = ring + ADT_KEEP_EXTRA;
    const half = ((blueprint.gridSize - 1) * blueprint.pitch) / 2;
    this.bounds = { minX: -half, maxX: half, minZ: -half, maxZ: half };
    this.material = createRegionWaterMaterial();
    parent.add(this.group);
  }

  /** Update Chebyshev stream ring (graphics draw-distance). Forces re-enqueue. */
  setRing(ring: number): void {
    const next = Math.max(1, Math.min(6, Math.round(ring)));
    if (next === this.ring) return;
    this.ring = next;
    this.keepRing = next + ADT_KEEP_EXTRA;
    this.lastAnchorKey = "";
  }

  private loadKeys(x: number, z: number): string[] {
    return adtRingKeysInBounds(x, z, this.ring, this.bounds);
  }

  private keepKeys(x: number, z: number): string[] {
    return adtRingKeysInBounds(x, z, this.keepRing, this.bounds);
  }

  private sortPending(x: number, z: number): void {
    this.pending.sort((a, b) => adtKeyChebyshevDist(a, x, z) - adtKeyChebyshevDist(b, x, z));
  }

  private enqueueDispose(mesh: THREE.Mesh): void {
    this.group.remove(mesh);
    this.disposeQueue.push(mesh.geometry);
  }

  private flushDisposes(budget?: StreamBudget): void {
    let n = 0;
    while (n < DISPOSES_PER_FRAME && this.disposeQueue.length > 0) {
      if (budget && !budget.ok) break;
      this.disposeQueue.shift()!.dispose();
      n++;
    }
  }

  update(x: number, z: number, budget?: StreamBudget): void {
    const desired = this.loadKeys(x, z);
    const desiredSet = new Set(desired);
    const keepSet = new Set(this.keepKeys(x, z));
    const anchor = desired[0] ?? "";

    if (anchor !== this.lastAnchorKey) {
      this.lastAnchorKey = anchor;
      this.pending = desired.filter((k) => !this.tiles.has(k) && !this.dryTiles.has(k));
    } else {
      for (const k of desired) {
        if (!this.tiles.has(k) && !this.dryTiles.has(k) && !this.pending.includes(k)) {
          this.pending.push(k);
        }
      }
    }
    this.sortPending(x, z);

    for (const [key, mesh] of this.tiles) {
      if (keepSet.has(key)) continue;
      this.enqueueDispose(mesh);
      this.tiles.delete(key);
    }
    this.flushDisposes(budget);

    let built = 0;
    let attempts = 0;
    while (built < BUILDS_PER_FRAME && attempts < MAX_ATTEMPTS && this.pending.length > 0) {
      attempts++;
      const key = this.pending[0]!;
      if (this.tiles.has(key) || this.dryTiles.has(key) || !desiredSet.has(key)) {
        this.pending.shift();
        continue;
      }
      const dist = adtKeyChebyshevDist(key, x, z);
      const urgent = dist <= 1;
      if (budget && !urgent && !budget.ok) break;
      if (budget && !urgent && !budget.takeBuild()) break;
      if (budget && urgent) budget.takeBuild();
      this.pending.shift();
      const { ix, iz } = parseAdtKey(key);
      const mesh = buildRegionAdtWaterTile(this.blueprint, ix, iz, this.material);
      if (!mesh) {
        this.dryTiles.add(key);
        continue;
      }
      this.group.add(mesh);
      this.tiles.set(key, mesh);
      built++;
    }
  }

  /** Sync-build the full water ring (loading screen). */
  warm(x: number, z: number): void {
    const keys = this.loadKeys(x, z);
    for (const key of keys) {
      if (this.tiles.has(key) || this.dryTiles.has(key)) continue;
      const { ix, iz } = parseAdtKey(key);
      const mesh = buildRegionAdtWaterTile(this.blueprint, ix, iz, this.material);
      if (!mesh) {
        this.dryTiles.add(key);
        continue;
      }
      this.group.add(mesh);
      this.tiles.set(key, mesh);
    }
    this.pending = [];
    this.lastAnchorKey = keys[0] ?? "";
  }

  /** Apply region sky/fog/ground tint to the shared water material. */
  applyEnvironment(env: {
    skyColor: THREE.ColorRepresentation;
    fogColor: THREE.ColorRepresentation;
    groundTint?: THREE.ColorRepresentation;
  }): void {
    applyWaterEnvironment(this.material, env);
  }

  /** Scroll the shared normal map. */
  updateScroll(dt: number): void {
    this.scrollT += dt;
    const normalMap = this.material.userData.waterNormalMap as THREE.Texture | undefined;
    if (!normalMap) return;
    normalMap.offset.set(
      this.scrollT * 0.02 + Math.sin(this.scrollT * 0.04) * 0.02,
      this.scrollT * 0.015,
    );
  }

  dispose(): void {
    for (const mesh of this.tiles.values()) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    for (const geo of this.disposeQueue) geo.dispose();
    this.disposeQueue = [];
    this.tiles.clear();
    this.dryTiles.clear();
    this.pending = [];
    this.material.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
    this.group.clear();
  }
}
