import * as THREE from "three";
import {
  ADT_KEEP_EXTRA,
  ADT_RING,
  adtIndex,
  adtKey,
  adtKeyChebyshevDist,
  adtRingKeysInBounds,
  parseAdtKey,
  type RegionBlueprint,
} from "@rustcraft/shared";
import { buildRegionAdtTile, createAdtTerrainMaterial } from "./terrain";
import type { StreamBudget } from "./streamBudget";

/** Hard cap when no time budget is supplied (warm / editor). */
const BUILDS_PER_FRAME = 1;
/** Stop spinning on skips (already-built / out of ring) within one drain. */
const MAX_ATTEMPTS = 8;
/** Defer GPU dispose so unloading a ring row doesn't hitch. */
const DISPOSES_PER_FRAME = 1;

/**
 * Streams 64 m ADT tiles of an editor region's heightmap around the player.
 * Editor preview keeps the full mesh; runtime interiors use this.
 *
 * Loads out to `ring`, keeps tiles out to `ring + ADT_KEEP_EXTRA` so boundary
 * walks don't thrash. Nearest missing tiles build first; the viewer's own
 * tile is always allowed even if the shared time budget is exhausted.
 */
export class RegionAdtTerrainStreamer {
  readonly group = new THREE.Group();
  private material: THREE.MeshLambertMaterial;
  private tiles = new Map<string, THREE.Mesh>();
  private pending: string[] = [];
  private disposeQueue: THREE.BufferGeometry[] = [];
  private lastAnchorKey = "";
  private readonly half: number;
  private readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private keepRing: number;

  constructor(
    parent: THREE.Object3D,
    private blueprint: Pick<
      RegionBlueprint,
      "gridSize" | "pitch" | "heights" | "biome" | "roads" | "colorGrading" | "customTextures"
    >,
    private ring = ADT_RING,
  ) {
    this.group.name = "region-adt-terrain";
    this.keepRing = ring + ADT_KEEP_EXTRA;
    this.half = ((blueprint.gridSize - 1) * blueprint.pitch) / 2;
    this.bounds = {
      minX: -this.half,
      maxX: this.half,
      minZ: -this.half,
      maxZ: this.half,
    };
    this.material = createAdtTerrainMaterial();
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

  get streamRing(): number {
    return this.ring;
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
      this.pending = desired.filter((k) => !this.tiles.has(k));
    } else {
      for (const k of desired) {
        if (!this.tiles.has(k) && !this.pending.includes(k)) this.pending.push(k);
      }
    }
    this.sortPending(x, z);

    for (const [key, mesh] of this.tiles) {
      if (keepSet.has(key)) continue;
      this.enqueueDispose(mesh);
      this.tiles.delete(key);
    }
    this.flushDisposes(budget);

    const underfootMissing = !this.hasTileAt(x, z);
    let built = 0;
    let attempts = 0;
    while (built < BUILDS_PER_FRAME && attempts < MAX_ATTEMPTS && this.pending.length > 0) {
      attempts++;
      const key = this.pending[0]!;
      if (this.tiles.has(key) || !desiredSet.has(key)) {
        this.pending.shift();
        continue;
      }
      const dist = adtKeyChebyshevDist(key, x, z);
      // Always fill underfoot / adjacent even if the shared slice is spent —
      // otherwise the player walks onto void while far tiles chew the budget.
      const urgent = underfootMissing || dist <= 1;
      if (budget && !urgent && !budget.ok) break;
      if (budget && !urgent && !budget.takeBuild()) break;
      if (budget && urgent) budget.takeBuild(); // count it when possible
      this.pending.shift();
      const { ix, iz } = parseAdtKey(key);
      const mesh = buildRegionAdtTile(this.blueprint, ix, iz, this.material);
      if (!mesh) continue;
      this.group.add(mesh);
      this.tiles.set(key, mesh);
      built++;
    }
  }

  /** Sync-build the full stream ring around (x,z) before the loading screen drops. */
  warm(x: number, z: number): void {
    const keys = this.loadKeys(x, z);
    for (const key of keys) {
      if (this.tiles.has(key)) continue;
      const { ix, iz } = parseAdtKey(key);
      const mesh = buildRegionAdtTile(this.blueprint, ix, iz, this.material);
      if (!mesh) continue;
      this.group.add(mesh);
      this.tiles.set(key, mesh);
    }
    this.pending = [];
    this.lastAnchorKey = keys[0] ?? "";
  }

  /** True if the ADT tile under local (x,z) is already meshed. */
  hasTileAt(x: number, z: number): boolean {
    return this.tiles.has(adtKey(adtIndex(x), adtIndex(z)));
  }

  get tileCount(): number {
    return this.tiles.size;
  }

  dispose(): void {
    for (const mesh of this.tiles.values()) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    for (const geo of this.disposeQueue) geo.dispose();
    this.disposeQueue = [];
    this.tiles.clear();
    this.pending = [];
    this.material.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
    this.group.clear();
  }
}
