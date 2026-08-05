import * as THREE from "three";
import {
  type RegionBlueprint,
  regionWorldOrigin,
  regionsNearWorld,
  findRegionAtWorld,
  worldToRegionLocal,
  sampleRegionHeightWorld,
  sampleRegionWaterDepthWorld,
  regionAssetColliders,
  regionVolumeColliders,
  regionBarrierColliders,
  regionAllAssets,
  REGION_STREAM_RADIUS_METERS,
  ADT_RING,
  PLAYER_BODY_RADIUS,
  type RegionAssetCollider,
} from "@rustcraft/shared";
import {
  buildRegionCollisionBVH,
  resolveCapsule,
  sampleGroundBelow,
  disposeRegionCollision,
  type RegionCollision,
  type PlacedCollider,
} from "@rustcraft/shared/collision";
import { preloadCollision, getCollisionMesh, collisionModelKey } from "./collisionData";
import { RegionInteriorRenderer, preloadRegionAssets } from "./regionInterior";

const CAPSULE_HEIGHT = 1.7;

export interface ContinentLayer {
  id: string;
  blueprint: RegionBlueprint;
  group: THREE.Group;
  renderer: RegionInteriorRenderer;
  ready: Promise<void>;
}

/**
 * Keeps multiple authored regions mounted in shared world space so walking
 * across a seam does not tear down / reload (WoW-style outdoor streaming).
 */
export class RegionContinent {
  private layers = new Map<string, ContinentLayer>();
  private loading = new Set<string>();
  private nameMap: ReadonlyMap<string, string>;
  private colliderCache: RegionAssetCollider[] | null = null;
  /** True-geometry (BVH) collision per mounted region, world-baked with its
   *  origin so it matches the authoritative server's per-region BVH. Built
   *  async on mount (needs the offline meshes fetched); until ready the layer's
   *  solids fall back to the analytic colliders in collidersWorld(). */
  private bvhCache = new Map<string, RegionCollision | null>();
  private graphicsOpts = {
    streamRing: ADT_RING,
    grassDrawDistance: 90,
  };

  constructor(
    private scene: THREE.Scene,
    private fetchBlueprint: (id: string) => Promise<RegionBlueprint>,
    nameMap?: ReadonlyMap<string, string>,
  ) {
    this.nameMap = nameMap ?? new Map();
  }

  setNameMap(map: ReadonlyMap<string, string>): void {
    this.nameMap = map;
  }

  /** Push draw-distance / grass settings to every mounted layer (+ future mounts). */
  setGraphicsOptions(opts: { streamRing: number; grassDrawDistance: number }): void {
    this.graphicsOpts = { ...opts };
    for (const layer of this.layers.values()) {
      layer.renderer.applyGraphicsSettings(this.graphicsOpts);
    }
  }

  get primary(): ContinentLayer | null {
    return null;
  }

  getLayer(id: string): ContinentLayer | null {
    return this.layers.get(id) ?? null;
  }

  /** Hot-swap authored data (e.g. after editor save) without remounting meshes. */
  updateLayerBlueprint(bp: RegionBlueprint): void {
    const layer = this.layers.get(bp.id);
    if (!layer) return;
    layer.blueprint = bp;
    // Keep the interior renderer's blueprint in sync — colorGrading / skyPreset
    // are read from renderer.blueprint, not only layer.blueprint.
    layer.renderer.replaceBlueprint(bp);
    this.colliderCache = null;
    // Re-bake this region's collision BVH so an editor save (moved/scaled
    // assets) updates collision live.
    void this.buildLayerCollision(bp);
  }

  get mountedIds(): string[] {
    return [...this.layers.keys()];
  }

  /** Full blueprints for every mounted layer (for atmosphere / fog blending). */
  mountedBlueprints(): RegionBlueprint[] {
    return [...this.layers.values()].map((l) => l.blueprint);
  }

  /** Iterate mounted interior renderers (water / fog volumes). */
  forEachLayer(fn: (layer: ContinentLayer) => void): void {
    for (const layer of this.layers.values()) fn(layer);
  }

  /** Region covering this world point, if mounted or known via catalog. */
  regionAt(wx: number, wz: number, catalog: Iterable<RegionBlueprint>): RegionBlueprint | null {
    return findRegionAtWorld(catalog, wx, wz);
  }

  groundAt(wx: number, wz: number, catalog: Iterable<RegionBlueprint>): number {
    // Prefer mounted (full) blueprints so stub catalog entries without heights
    // don't win with a flat zero.
    for (const layer of this.layers.values()) {
      const h = sampleRegionHeightWorld(layer.blueprint, wx, wz);
      if (h !== null) return h;
    }
    for (const bp of catalog) {
      if (!bp.heights?.length) continue;
      const h = sampleRegionHeightWorld(bp, wx, wz);
      if (h !== null) return h;
    }
    // Outside all regions — flat fallback (should not walk here often).
    return 0;
  }

  waterDepthAt(wx: number, wz: number, catalog: Iterable<RegionBlueprint>): number {
    for (const layer of this.layers.values()) {
      if (sampleRegionHeightWorld(layer.blueprint, wx, wz) === null) continue;
      return sampleRegionWaterDepthWorld(layer.blueprint, wx, wz);
    }
    for (const bp of catalog) {
      if (!bp.heights?.length) continue;
      if (sampleRegionHeightWorld(bp, wx, wz) === null) continue;
      return sampleRegionWaterDepthWorld(bp, wx, wz);
    }
    return 0;
  }

  /** Collision shapes for every mounted region, in world space. Solids whose
   *  mesh is baked into that region's BVH are excluded (collided via the BVH
   *  closures below) to avoid double collision. */
  collidersWorld(): RegionAssetCollider[] {
    if (this.colliderCache) return this.colliderCache;
    const out: RegionAssetCollider[] = [];
    for (const layer of this.layers.values()) {
      const o = regionWorldOrigin(layer.blueprint);
      const bvhReady = this.bvhCache.get(layer.id) != null;
      const analyticAssets = regionAllAssets(layer.blueprint).filter(
        (a) => !(bvhReady && a.solid && getCollisionMesh(collisionModelKey(a.category, a.model)) != null),
      );
      const local = [
        ...regionAssetColliders(analyticAssets),
        ...regionVolumeColliders(layer.blueprint.terrainVolumes ?? []),
        ...regionBarrierColliders(layer.blueprint.barrierVolumes),
      ];
      for (const c of local) {
        out.push({
          ...c,
          x: c.x + o.x,
          z: c.z + o.z,
          baseY: c.baseY,
          topY: c.topY,
          stairRamp: c.stairRamp
            ? { ...c.stairRamp }
            : undefined,
        });
      }
    }
    this.colliderCache = out;
    return out;
  }

  /** Depenetrate the body capsule out of every mounted region's mesh geometry
   *  (walls/pillars/rock faces). Passed to stepMovement as meshResolve. */
  meshResolveWorld = (
    x: number,
    y: number,
    z: number,
  ): { x: number; y: number; z: number; grounded: boolean; moved: number } => {
    let cx = x, cy = y, cz = z, grounded = false, moved = 0;
    for (const col of this.bvhCache.values()) {
      if (!col) continue;
      const r = resolveCapsule(col, cx, cy, cz, { radius: PLAYER_BODY_RADIUS, height: CAPSULE_HEIGHT });
      if (r.moved > 1e-4) {
        cx = r.x; cy = r.y; cz = r.z;
        moved += r.moved;
        if (r.grounded) grounded = true;
      }
    }
    return { x: cx, y: cy, z: cz, grounded, moved };
  };

  /** Highest up-facing mesh surface under the feet across mounted regions (so
   *  you stand on a deck / rooftop). Passed to stepMovement as meshGroundBelow. */
  meshGroundBelowWorld = (x: number, z: number, fromY: number, maxDrop: number): number | null => {
    let best: number | null = null;
    for (const col of this.bvhCache.values()) {
      if (!col) continue;
      const s = sampleGroundBelow(col, x, z, fromY, PLAYER_BODY_RADIUS, maxDrop);
      if (s !== null && (best === null || s > best)) best = s;
    }
    return best;
  };

  /** True when at least one mounted region has a built mesh BVH. */
  hasMeshCollision(): boolean {
    for (const c of this.bvhCache.values()) if (c) return true;
    return false;
  }

  /** Build (or rebuild) a mounted region's world-baked collision BVH from its
   *  solid assets. Async: fetches the offline meshes first. */
  private async buildLayerCollision(bp: RegionBlueprint): Promise<void> {
    const placed: PlacedCollider[] = [];
    const keys = new Set<string>();
    for (const a of regionAllAssets(bp)) {
      if (!a.solid) continue;
      const key = collisionModelKey(a.category, a.model);
      keys.add(key);
      placed.push({
        modelKey: key,
        x: a.localX,
        y: a.localY,
        z: a.localZ,
        yaw: a.yaw,
        scaleX: a.scaleX ?? a.scale ?? 1,
        scaleY: a.scaleY ?? a.scale ?? 1,
        scaleZ: a.scaleZ ?? a.scale ?? 1,
      });
    }
    await preloadCollision(keys);
    if (!this.layers.has(bp.id)) return; // unmounted while fetching
    const origin = regionWorldOrigin(bp);
    const next = buildRegionCollisionBVH(placed, getCollisionMesh, { x: origin.x, z: origin.z });
    const prev = this.bvhCache.get(bp.id);
    if (prev) disposeRegionCollision(prev);
    this.bvhCache.set(bp.id, next);
    this.colliderCache = null; // partition changed
  }

  /**
   * Ensure regions near the player are mounted. `catalog` is the full set of
   * known blueprints (with world origins). Returns when the region underfoot
   * (if any) is ready to walk on.
   */
  async syncAround(
    wx: number,
    wz: number,
    catalog: RegionBlueprint[],
    opts?: { urgentId?: string },
  ): Promise<void> {
    const near = regionsNearWorld(catalog, wx, wz, REGION_STREAM_RADIUS_METERS);
    const want = new Set(near.map((b) => b.id));
    if (opts?.urgentId) want.add(opts.urgentId);

    for (const id of [...this.layers.keys()]) {
      if (!want.has(id)) this.unload(id);
    }

    const mounts: Promise<void>[] = [];
    for (const bp of near) {
      mounts.push(this.ensureMounted(bp));
    }
    if (opts?.urgentId) {
      const urgent = catalog.find((b) => b.id === opts.urgentId);
      if (urgent) mounts.push(this.ensureMounted(urgent));
    }
    await Promise.all(mounts);

    // Warm terrain/grass around the *viewer*, not each region's entry — neighbors
    // used to show seam foliage with empty ground underfoot.
    for (const layer of this.layers.values()) {
      const local = worldToRegionLocal(layer.blueprint, wx, wz);
      layer.renderer.warmAround(local.x, local.z);
    }

    const under = findRegionAtWorld(catalog, wx, wz);
    if (under) {
      const layer = this.layers.get(under.id);
      if (layer) {
        await Promise.race([
          layer.ready,
          new Promise<void>((r) => setTimeout(r, 8000)),
        ]).catch(() => {});
      }
    }
  }

  private async ensureMounted(bp: RegionBlueprint): Promise<void> {
    if (this.layers.has(bp.id)) {
      const existing = this.layers.get(bp.id)!;
      // Catalog/cache may have newer authored data (barriers etc.) after a save.
      if (bp.heights?.length) this.updateLayerBlueprint(bp);
      return Promise.race([
        existing.ready,
        new Promise<void>((r) => setTimeout(r, 8000)),
      ]).catch(() => {});
    }
    if (this.loading.has(bp.id)) {
      // Wait for in-flight mount — if it succeeds we're done; if it was
      // cleaned up (e.g. unload() fired mid-mount) we'll re-enter below.
      const waited = new Promise<void>((resolve) => {
        const poll = setInterval(() => {
          if (!this.loading.has(bp.id)) { clearInterval(poll); resolve(); }
        }, 50);
      });
      await waited;
      // It may have been unloaded during the in-flight mount; fall through to
      // re-mount if still needed. If already present, return its ready.
      const after = this.layers.get(bp.id);
      if (after) {
        return Promise.race([
          after.ready,
          new Promise<void>((r) => setTimeout(r, 8000)),
        ]).catch(() => {});
      }
      if (this.loading.has(bp.id)) return; // another re-entry is handling it
    }
    this.loading.add(bp.id);
    try {
      // Fetch with a hard 5 s deadline — a stalled API call must not block
      // the loading screen forever. Fall back to the stub (catalog entry).
      let blueprint = bp;
      try {
        blueprint = await Promise.race([
          this.fetchBlueprint(bp.id),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
        ]);
      } catch {
        if (!blueprint.heights?.length) throw new Error(`Failed to fetch region ${bp.id}`);
        // Use the stub we have — terrain will be flat but the player won't hang.
      }
      await preloadRegionAssets(blueprint, () => {});
      const group = new THREE.Group();
      group.name = `region-continent:${blueprint.id}`;
      const origin = regionWorldOrigin(blueprint);
      group.position.set(origin.x, 0, origin.z);
      const renderer = new RegionInteriorRenderer(group, blueprint, this.nameMap);
      renderer.applyGraphicsSettings(this.graphicsOpts);
      const layer: ContinentLayer = {
        id: blueprint.id,
        blueprint,
        group,
        renderer,
        // Terrain warm happens in syncAround around the player (not entry).
        ready: renderer.ready,
      };
      this.scene.add(group);
      this.layers.set(blueprint.id, layer);
      this.colliderCache = null;
      // Build true-geometry (BVH) collision for this region's solids (async).
      void this.buildLayerCollision(blueprint);
      await Promise.race([
        layer.ready,
        new Promise<void>((r) => setTimeout(r, 8000)),
      ]).catch(() => {});
      // Warm around local player projection once we know them — caller updates.
    } finally {
      this.loading.delete(bp.id);
    }
  }

  update(
    dt: number,
    sun: THREE.DirectionalLight | undefined,
    wx: number,
    wz: number,
    camera?: THREE.Camera,
  ): void {
    for (const layer of this.layers.values()) {
      const local = worldToRegionLocal(layer.blueprint, wx, wz);
      layer.renderer.update(dt, sun, local.x, local.z, camera);
    }
  }

  unload(id: string): void {
    const layer = this.layers.get(id);
    if (!layer) return;
    this.scene.remove(layer.group);
    layer.renderer.destroy();
    this.layers.delete(id);
    const col = this.bvhCache.get(id);
    if (col) disposeRegionCollision(col);
    this.bvhCache.delete(id);
    this.colliderCache = null;
  }

  destroy(): void {
    for (const id of [...this.layers.keys()]) this.unload(id);
  }
}
