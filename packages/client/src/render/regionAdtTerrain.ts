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
import {
  assembleAdtTileMesh,
  buildAdtTileSkeleton,
  buildRegionAdtTileSync,
  createAdtTerrainMaterial,
  toAdtLiteBlueprint,
} from "./terrain";
import type { AdtLiteBlueprint, AdtTileGeometryData } from "./adtTileGeometry";
import { getAdtWorkerPool, type AdtWorkerPool } from "./adtWorkerPool";
import { AdtGeometryPool } from "./adtGeometryPool";
import type { StreamBudget } from "./streamBudget";

/** Defer GPU dispose so unloading a ring row doesn't hitch. */
const DISPOSES_PER_FRAME = 1;
/** Stop spinning on skips (already-built / out of ring) within one drain. */
const MAX_ATTEMPTS = 12;
/** Max tiles in worker flight at once (bounds latency + transient memory). */
const MAX_INFLIGHT = 6;
/** Finished tiles wrapped into meshes per frame — assembly is cheap array
 *  copies, so a few per frame stays well under a frame budget. */
const ASSEMBLE_PER_FRAME = 3;
/** Chebyshev radius built synchronously on region entry so the player never
 *  spawns on void; everything past this streams in off-thread. */
const WARM_SYNC_RING = 1;

/**
 * Streams 64 m ADT tiles of an editor region's heightmap around the player.
 *
 * The heavy per-vertex sampling (heights, road blend, ground weights, normals)
 * runs in a Web Worker pool (adtTile.worker.ts) so it never stalls the render
 * thread. The main thread only builds the cheap PlaneGeometry skeleton and
 * wraps the worker's returned typed arrays. Falls back to a synchronous
 * main-thread build when workers are unavailable, or for the always-allowed
 * tile directly underfoot.
 *
 * Loads out to `ring`, keeps tiles out to `ring + ADT_KEEP_EXTRA` so boundary
 * walks don't thrash. Nearest missing tiles build first.
 */
export class RegionAdtTerrainStreamer {
  readonly group = new THREE.Group();
  private material: THREE.MeshLambertMaterial;
  private tiles = new Map<string, THREE.Mesh>();
  private pending: string[] = [];
  /** key -> skeleton geometry awaiting its worker result. */
  private building = new Map<string, THREE.PlaneGeometry>();
  /** Worker results wrapped into meshes on the update() cadence (bounded). */
  private results: Array<{ key: string; geo: THREE.PlaneGeometry; data: AdtTileGeometryData }> = [];
  private disposeQueue: THREE.BufferGeometry[] = [];
  /** Recycles tile skeleton geometries + their attribute buffers so ring
   *  turnover doesn't churn allocations / GL buffers (GC-pause source). */
  private readonly geoPool = new AdtGeometryPool();
  private lastAnchorKey = "";
  private readonly half: number;
  private readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private keepRing: number;
  private readonly lite: AdtLiteBlueprint;
  private readonly pool: AdtWorkerPool;
  private blueprintId: number;
  private disposed = false;

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
    this.lite = toAdtLiteBlueprint(blueprint);
    this.pool = getAdtWorkerPool();
    this.blueprintId = this.pool.registerBlueprint(this.lite);
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
      // Recycle instead of dispose -- a tile that just left the ring is the
      // ideal skeleton for the next tile of its signature streaming in.
      this.geoPool.release(this.disposeQueue.shift()!);
      n++;
    }
  }

  private addMesh(key: string, mesh: THREE.Mesh): void {
    this.group.add(mesh);
    this.tiles.set(key, mesh);
  }

  /** Synchronous main-thread build (no workers, or underfoot-urgent). */
  private buildSync(key: string): void {
    const { ix, iz } = parseAdtKey(key);
    const mesh = buildRegionAdtTileSync(this.lite, ix, iz, this.material, this.geoPool);
    if (mesh) this.addMesh(key, mesh);
  }

  /** Kick off an off-thread build for one tile (or sync if no worker pool). */
  private dispatch(key: string): void {
    if (this.tiles.has(key) || this.building.has(key)) return;
    if (!this.pool.available || this.blueprintId < 0) {
      this.buildSync(key);
      return;
    }
    const { ix, iz } = parseAdtKey(key);
    const skel = buildAdtTileSkeleton(this.blueprint, ix, iz, this.geoPool);
    if (!skel) return;
    this.building.set(key, skel.geo);
    // Copy the skeleton positions so the transfer doesn't detach our geometry.
    const positions = (skel.geo.attributes.position!.array as Float32Array).slice();
    void this.pool.build(this.blueprintId, skel.span, positions).then((data) => {
      this.building.delete(key);
      if (this.disposed) {
        skel.geo.dispose();
        return;
      }
      // Empty result (tile went out of range mid-flight): recycle the skeleton.
      if (!data) {
        this.geoPool.release(skel.geo);
        return;
      }
      this.results.push({ key, geo: skel.geo, data });
    });
  }

  /** Wrap up to ASSEMBLE_PER_FRAME finished worker results into meshes. */
  private drainResults(keepSet: Set<string>): void {
    let n = 0;
    while (n < ASSEMBLE_PER_FRAME && this.results.length > 0) {
      const r = this.results.shift()!;
      n++;
      if (this.tiles.has(r.key) || !keepSet.has(r.key)) {
        this.geoPool.release(r.geo);
        continue;
      }
      this.addMesh(r.key, assembleAdtTileMesh(r.geo, r.data, this.material));
    }
  }

  update(x: number, z: number, budget?: StreamBudget): void {
    const desired = this.loadKeys(x, z);
    const desiredSet = new Set(desired);
    const keepSet = new Set(this.keepKeys(x, z));
    const anchor = desired[0] ?? "";

    if (anchor !== this.lastAnchorKey) {
      this.lastAnchorKey = anchor;
      this.pending = desired.filter((k) => !this.tiles.has(k) && !this.building.has(k));
    } else {
      for (const k of desired) {
        if (!this.tiles.has(k) && !this.building.has(k) && !this.pending.includes(k)) this.pending.push(k);
      }
    }
    this.sortPending(x, z);

    for (const [key, mesh] of this.tiles) {
      if (keepSet.has(key)) continue;
      this.enqueueDispose(mesh);
      this.tiles.delete(key);
    }
    this.flushDisposes(budget);

    this.drainResults(keepSet);

    // Underfoot safety: never let the player stand on void while a far tile is
    // still in worker flight — build the tile under them synchronously now.
    const underKey = adtKey(adtIndex(x), adtIndex(z));
    if (!this.tiles.has(underKey) && !this.building.has(underKey) && desiredSet.has(underKey)) {
      const pi = this.pending.indexOf(underKey);
      if (pi >= 0) this.pending.splice(pi, 1);
      this.buildSync(underKey);
    }

    let attempts = 0;
    while (this.building.size < MAX_INFLIGHT && attempts < MAX_ATTEMPTS && this.pending.length > 0) {
      attempts++;
      const key = this.pending[0]!;
      if (this.tiles.has(key) || this.building.has(key) || !desiredSet.has(key)) {
        this.pending.shift();
        continue;
      }
      this.pending.shift();
      this.dispatch(key);
    }
  }

  /** Build the immediate area synchronously and stream the rest off-thread
   *  before the loading screen drops (region entry). */
  warm(x: number, z: number): void {
    const keys = this.loadKeys(x, z);
    for (const key of keys) {
      if (this.tiles.has(key) || this.building.has(key)) continue;
      const dist = adtKeyChebyshevDist(key, x, z);
      if (dist <= WARM_SYNC_RING) {
        this.buildSync(key);
      } else {
        // Kick the worker immediately so outer tiles compute in parallel while
        // the near ring builds; results are assembled by update() next frames.
        this.dispatch(key);
      }
    }
    this.lastAnchorKey = keys[0] ?? "";
  }

  /** True if the ADT tile under local (x,z) is already meshed. */
  hasTileAt(x: number, z: number): boolean {
    return this.tiles.has(adtKey(adtIndex(x), adtIndex(z)));
  }

  /** True when every tile in the load ring at (x,z) is built and nothing is
   *  still in flight -- i.e. the terrain visible from (x,z) is fully streamed.
   *  Used to hold the loading screen until the view is complete (no pop-in). */
  ringComplete(x: number, z: number): boolean {
    if (this.pending.length > 0 || this.building.size > 0 || this.results.length > 0) return false;
    for (const key of this.loadKeys(x, z)) {
      if (!this.tiles.has(key)) return false;
    }
    return true;
  }

  /** Fraction (0..1) of the load ring at (x,z) that is meshed -- drives the
   *  loading-screen progress bar while the ring streams in. */
  ringProgress(x: number, z: number): number {
    const keys = this.loadKeys(x, z);
    if (keys.length === 0) return 1;
    let have = 0;
    for (const key of keys) if (this.tiles.has(key)) have++;
    return have / keys.length;
  }

  get tileCount(): number {
    return this.tiles.size;
  }

  dispose(): void {
    this.disposed = true;
    this.pool.dropBlueprint(this.blueprintId);
    for (const mesh of this.tiles.values()) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    // In-flight worker results resolve after this and dispose their own
    // skeletons (they see `disposed`); assembled-but-unwrapped results here.
    for (const r of this.results) r.geo.dispose();
    this.results = [];
    for (const geo of this.disposeQueue) geo.dispose();
    this.disposeQueue = [];
    // Free the recycled skeletons kept for reuse (checked-out geos above are
    // disposed directly; only the free list remains here).
    this.geoPool.dispose();
    this.tiles.clear();
    this.pending = [];
    this.material.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
    this.group.clear();
  }
}
