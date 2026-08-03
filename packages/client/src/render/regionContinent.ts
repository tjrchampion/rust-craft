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
  type RegionAssetCollider,
} from "@rustcraft/shared";
import { RegionInteriorRenderer, preloadRegionAssets } from "./regionInterior";

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

  /** Collision shapes for every mounted region, in world space. */
  collidersWorld(): RegionAssetCollider[] {
    if (this.colliderCache) return this.colliderCache;
    const out: RegionAssetCollider[] = [];
    for (const layer of this.layers.values()) {
      const o = regionWorldOrigin(layer.blueprint);
      const local = [
        ...regionAssetColliders(regionAllAssets(layer.blueprint)),
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
      if (layer) await layer.ready;
    }
  }

  private async ensureMounted(bp: RegionBlueprint): Promise<void> {
    if (this.layers.has(bp.id) || this.loading.has(bp.id)) {
      const existing = this.layers.get(bp.id);
      if (existing) {
        // Catalog/cache may have newer authored data (barriers etc.) after a save.
        if (bp.heights?.length) this.updateLayerBlueprint(bp);
        return existing.ready;
      }
      // Wait for in-flight mount.
      while (this.loading.has(bp.id) && !this.layers.has(bp.id)) {
        await new Promise((r) => setTimeout(r, 50));
      }
      return;
    }
    this.loading.add(bp.id);
    try {
      // Always fetch so editor saves (barriers/clouds) land without a remount cycle.
      let blueprint = bp;
      try {
        blueprint = await this.fetchBlueprint(bp.id);
      } catch {
        if (!blueprint.heights?.length) throw new Error(`Failed to fetch region ${bp.id}`);
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
      await layer.ready;
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
    this.colliderCache = null;
  }

  destroy(): void {
    for (const id of [...this.layers.keys()]) this.unload(id);
  }
}
