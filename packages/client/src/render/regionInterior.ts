import * as THREE from "three";
import {
  sampleRegionHeight,
  ADT_RING,
  adtIndex,
  adtRingRadiusMeters,
  regionAllAssets,
  resolveRegionAssetLight,
  regionAssetScale,
  hashString,
  isRockLikeAssetModel,
  isLowShadowValueFoliageModel,
  mergeQuickGrassSettings,
  grassDetailDistance,
  INTEREST_RADIUS,
  type RegionBlueprint,
  type RegionAsset,
  type RegionFogVolume,
  type RegionNPC,
} from "@rustcraft/shared";
import { load, AnimatedModel, PLAYER_ANIMS, resolveNpcModelUrl } from "./gltf";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { buildShrine, buildNameplate, buildHealthNameplate } from "./models";
import { resolvePoiModelUrl } from "./regionPropPalette";
import { RegionAdtTerrainStreamer } from "./regionAdtTerrain";
import { RegionAdtWaterStreamer } from "./regionAdtWater";
import { createQuickGrassField, type QuickGrassField } from "./quickGrass/field";
import { createTreeWindUniforms, applyTreeWindSway, applyRegionWind, type TreeWindUniforms } from "./windSway";
import { createTerrainVolumeMesh } from "./terrainVolumes";
import { createFogVolumeMesh, fogVolumeInfluence } from "./fogVolumes";
import { createRegionCloudRuntime, type RegionCloudRuntime } from "./regionClouds";
import { buildRegionHorizon } from "./regionHorizon";
import { StreamBudget, REGION_STREAM_BUDGET_MS } from "./streamBudget";
import { nextFrame, runCooperatively } from "./idleScheduler";
import { game } from "../ui/gameState.svelte";
import { getGame } from "../game/instance";
import { perfTime, perfTimeAsync } from "./perfBus";

/** Base tree canopy sway amplitude (meters) at RegionWind strength 1 --
 *  chosen smaller than grass's own base since tree branches are much larger
 *  levers, so a little displacement reads as a lot of visible motion. */
const BASE_TREE_WIND_STRENGTH = 0.15;

interface RegionNpcInstance {
  group: THREE.Group;
  animModel: AnimatedModel;
  data: RegionNPC;
  initialX: number;
  initialY: number;
  initialZ: number;
  initialYaw: number;
  hp: number;
  maxHp: number;
  lastHitTime: number;
  plateSprite?: THREE.Sprite;
  loaded?: boolean;
  loading?: boolean;
  placeholder?: THREE.Mesh;
  escortState?: {
    questId: string;
    waypoints: { x: number; z: number }[];
    index: number;
    completed: boolean;
  };
}

// Re-export GLTF for the load() call in preloadRegionAssets
export type { GLTF };

const ASSET_DIR: Record<"building" | "foliage" | "prop", string> = {
  building: "buildings",
  foliage: "foliage",
  prop: "props",
};

/** Every unique full-detail model URL a blueprint's assets reference. See
 *  RegionInteriorRenderer's class doc comment -- foliage currently renders
 *  at full detail too (same as props/buildings); scripts/generate-foliage-lods.mjs
 *  still exists if a lower-detail pass is ever needed again. */
function regionAssetUrls(blueprint: RegionBlueprint): string[] {
  const urls = new Set<string>();
  // regionAllAssets(), not blueprint.assets directly -- procedural house-kit
  // pieces (expandHousesToAssets) are what buildPropsAndBuildings() actually
  // instances, so skipping them here just meant their first load() landed
  // inline during instancing instead of a step ahead of it.
  for (const a of regionAllAssets(blueprint)) {
    if (a.model && (a.model.endsWith(".glb") || a.model.endsWith(".gltf"))) {
      urls.add(`/assets/models/${ASSET_DIR[a.category]}/${a.model}`);
    }
  }
  if (blueprint.npcs) {
    for (const npc of blueprint.npcs) {
      urls.add(resolveNpcModelUrl(npc.model));
    }
  }
  if (blueprint.pois) {
    for (const poi of blueprint.pois) {
      if (poi.model) {
        urls.add(resolvePoiModelUrl(poi.model, poi.category));
      }
    }
  }
  return [...urls];
}

/** Pre-warm the GLTF cache for every unique model used by a blueprint so that
 *  RegionInteriorRenderer's eager instancing pass resolves instantly.
 *  onProgress(loaded, total) is called after each file completes. */
export async function preloadRegionAssets(
  blueprint: RegionBlueprint,
  onProgress: (loaded: number, total: number) => void,
): Promise<void> {
  const urls = regionAssetUrls(blueprint);
  if (urls.length === 0) { onProgress(0, 0); return; }
  let loaded = 0;
  const timeoutMs = 2500;
  // Cooperative + capped concurrency: `syncAround` calls this live while the
  // player walks near a new region, not just behind a loading screen. Firing
  // every model's load() at once let dozens of first-time GLTF parses drain
  // back-to-back as one microtask cascade with no frame in between -- which
  // is what stalled camera/mouse-look mid-walk. Yielding between small waves
  // gives the render loop + input a slot every few parses instead of one.
  await runCooperatively(
    urls,
    async (url) => {
      await Promise.race([
        load(url),
        new Promise((r) => setTimeout(r, timeoutMs)),
      ]).catch(() => null); // one broken model shouldn't block the whole region
      loaded++;
      onProgress(loaded, urls.length);
    },
    { concurrency: 3 },
  );
}

/**
 * Renders a region's interior once a player has walked through its portal.
 *
 * Props/buildings/foliage are instanced once at region entry. Each spatial
 * chunk is shown only when its ADT terrain tile is resident (same Chebyshev
 * ring as streamed ground), so foliage never draws as floating over void.
 *
 * Unlike a dungeon, a region has real open sky and its own sculpted terrain
 * instead of a sealed void-floor/ceiling box. Terrain + painted grass stream
 * as 64 m ADT tiles around the player. Color grading (sky/fog/ambient/sun)
 * is applied by Game.ts's updateDayNight. Mobs are NOT rendered here -- they
 * flow through the same generic MobSnap/entity pipeline.
 */
export class RegionInteriorRenderer {
  private group: THREE.Object3D;
  /** Not readonly: replaceBlueprint() hot-swaps this after an editor save. */
  blueprint: RegionBlueprint;
  private adtTerrain: RegionAdtTerrainStreamer;
  private adtWater: RegionAdtWaterStreamer | null = null;
  /** Set once update()'s renderer.compile precompile has warmed each shared
   *  streamer material -- see update()'s renderer/topScene params. */
  private terrainMaterialWarmed = false;
  private waterMaterialWarmed = false;
  private npcModels: AnimatedModel[] = [];
  private npcInstances: RegionNpcInstance[] = [];
  private poiGroups: THREE.Object3D[] = [];
  /** Every InstancedMesh built by instanceModel (foliage + props/buildings),
   *  tracked flat for destroy() cleanup. */
  private instancedGroups: THREE.InstancedMesh[] = [];
  /** Set in destroy() so a time-sliced instance build bails instead of adding
   *  meshes into a torn-down region group. */
  private destroyed = false;
  /** Instanced asset chunks (foliage/props/buildings) for distance culling.
   *  Deliberately just full-detail meshes shown/hidden per the ADT stream
   *  ring -- an earlier LOD-tier/billboard-impostor/crossfade-dither system
   *  lived here and was removed. It didn't move the needle on performance
   *  (the real cost was multiple whole regions mounted simultaneously at a
   *  seam, fixed via REGION_UNLOAD_RADIUS_METERS, not per-region triangle
   *  count) and the extra tiers/pop/dither made foliage visibly worse than
   *  the editor's plain full-detail rendering of the same content. Keeping
   *  this simple on purpose. */
  private assetChunks: {
    x: number;
    z: number;
    model: string;
    meshes: THREE.InstancedMesh[];
  }[] = [];
  /** Painted grass via Quick Grass (see quickGrass/). Null if none. */
  private grassField: QuickGrassField | null = null;
  /** Scratch camera used when callers don't pass one (distance-only stream). */
  private grassCam = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
  /** Scratch for local→world viewer conversion (continent region origins). */
  private grassWorldScratch = new THREE.Vector3();
  /** Stamped 3D terrain volumes (boulder/block/etc.) from the volume sculpt
   *  brush. Shared geometries -- destroy() only removes meshes from the group. */
  private volumeMeshes: THREE.Mesh[] = [];
  /** Local fog pockets from the editor — additive meshes + density influence. */
  private fogMeshes: THREE.Mesh[] = [];
  private fogVolumeData: RegionFogVolume[] = [];
  /** Authored drifting cloud puffs. */
  private cloudRuntime: RegionCloudRuntime | null = null;
  /** Optional distant mountain ring from colorGrading.horizonEnabled. */
  private horizonGroup: THREE.Group | null = null;
  /** Hand-placed assets + expanded procedural houses (for instancing/collision). */
  private allAssets: RegionAsset[];
  /** Shared by every foliage material patched via applyTreeWindSway in
   *  instanceModel -- seeded from blueprint.wind at construction. */
  private treeWindUniforms: TreeWindUniforms = createTreeWindUniforms();
  /** Live graphics stream ring (defaults to ADT_RING; updated from Game). */
  private streamRing = ADT_RING;
  /** Optional grass draw-distance override from graphics settings. */
  private grassDrawDistanceOverride: number | null = null;

  /** Resolves once every foliage/prop/building placement has been built and
   *  added to the scene -- callers (Game.ts) await this before dismissing
   *  the loading screen / calling renderer.compile(), so the first real
   *  render already has everything present instead of assets popping in. */
  readonly ready: Promise<void>;

  constructor(group: THREE.Object3D, blueprint: RegionBlueprint, regionNameMap?: ReadonlyMap<string, string>) {
    this.npcModels = [];
    this.group = group;
    this.blueprint = blueprint;
    this.allAssets = regionAllAssets(blueprint);

    // Heightmap streams as 64 m ADT tiles around the player (not one full mesh).
    this.adtTerrain = new RegionAdtTerrainStreamer(this.group, blueprint);
    this.adtTerrain.warm(blueprint.entryLocal.x, blueprint.entryLocal.z);

    if (blueprint.waterHeights && blueprint.waterHeights.some((w) => w > 0)) {
      this.adtWater = new RegionAdtWaterStreamer(this.group, {
        gridSize: blueprint.gridSize,
        pitch: blueprint.pitch,
        heights: blueprint.heights,
        waterHeights: blueprint.waterHeights,
      });
      this.adtWater.applyEnvironment({
        skyColor: blueprint.colorGrading.skyColor,
        fogColor: blueprint.colorGrading.fogColor,
        groundTint: blueprint.colorGrading.groundTint,
      });
      this.adtWater.warm(blueprint.entryLocal.x, blueprint.entryLocal.z);
    }

    if (blueprint.wind) applyRegionWind(this.treeWindUniforms, blueprint.wind, BASE_TREE_WIND_STRENGTH);

    this.buildGrassPatches();
    this.buildTerrainVolumes();
    this.ready = Promise.all([this.buildFoliage(), this.buildPropsAndBuildings(), this.buildPois()]).then(() => {});

    for (const village of blueprint.villages) {
      const plate = buildNameplate(village.name, "#ffe9a8");
      plate.scale.set(3.2, 0.9, 1);
      plate.position.set(village.localX, sampleRegionHeight(blueprint, village.localX, village.localZ) + 5, village.localZ);
      this.group.add(plate);
    }


    for (const portal of blueprint.portals ?? []) {
      const pY = sampleRegionHeight(blueprint, portal.localX, portal.localZ);
      const portalMesh = buildShrine();
      portalMesh.position.set(portal.localX, pY, portal.localZ);
      const pCrystal = portalMesh.getObjectByName("crystal") as THREE.Mesh | undefined;
      if (pCrystal) {
        pCrystal.material = new THREE.MeshBasicMaterial({
          color: 0x9944ff,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
        });
      }
      this.group.add(portalMesh);
      const destName = regionNameMap?.get(portal.targetRegionId) ?? portal.name ?? "Portal";
      const pSign = buildNameplate(`→ ${destName}`, "#b88cff");
      pSign.scale.set(4.0, 1.1, 1);
      pSign.position.set(portal.localX, pY + 4.0, portal.localZ);
      this.group.add(pSign);
    }

    for (const npc of blueprint.npcs ?? []) {
      const npcY = sampleRegionHeight(blueprint, npc.localX, npc.localZ);
      const npcGroup = new THREE.Group();
      npcGroup.position.set(npc.localX, npcY, npc.localZ);
      npcGroup.rotation.y = npc.yaw;

      const placeholder = new THREE.Mesh(
        new THREE.SphereGeometry(0.7, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x33b5e5 }),
      );
      placeholder.position.set(0, 0.5, 0);
      npcGroup.add(placeholder);

      const animModel = new AnimatedModel(PLAYER_ANIMS);
      const inst: RegionNpcInstance = {
        group: npcGroup,
        animModel,
        data: npc,
        initialX: npc.localX,
        initialY: npcY,
        initialZ: npc.localZ,
        initialYaw: npc.yaw,
        hp: 100,
        maxHp: 100,
        lastHitTime: 0,
        placeholder,
        loaded: false,
        loading: false,
      };

      const labelText = npc.title ? `${npc.name}\n${npc.title}` : npc.name;
      const plate = buildHealthNameplate(labelText, 100, 100, "#33b5e5");
      plate.position.set(0, 2.6, 0);
      npcGroup.add(plate);
      inst.plateSprite = plate;

      if ((npc.quests?.length ?? 0) > 0 || npc.generateProceduralQuests !== false) {
        const badge = buildNameplate("!", "#ffd700");
        badge.position.set(0, 3.4, 0);
        badge.scale.set(1.4, 1.4, 1);
        npcGroup.add(badge);
      }

      this.npcModels.push(animModel);
      this.npcInstances.push(inst);
      this.group.add(npcGroup);
    }

    for (const l of blueprint.lights ?? []) {
      const pointLight = new THREE.PointLight(l.color, l.intensity, l.distance, l.decay ?? 1);
      pointLight.position.set(l.localX, l.localY, l.localZ);
      this.group.add(pointLight);
    }

    // Prop-attached lights (lanterns etc.) — separate from InstancedMesh so
    // each placement can have its own color/intensity without breaking batching.
    for (const asset of this.allAssets) {
      const resolved = resolveRegionAssetLight(asset);
      if (!resolved) continue;
      // Use authored localY (same as editor) — do not re-snap to heightmap.
      const y = asset.localY;
      const pointLight = new THREE.PointLight(
        resolved.color,
        resolved.intensity,
        resolved.distance,
        resolved.decay,
      );
      // Rotate local bulb offset by asset yaw (matches editor child transform).
      const cy = Math.cos(asset.yaw);
      const sy = Math.sin(asset.yaw);
      const ox = resolved.offsetX;
      const oz = resolved.offsetZ;
      pointLight.position.set(
        asset.localX + ox * cy + oz * sy,
        y + resolved.offsetY,
        asset.localZ - ox * sy + oz * cy,
      );
      this.group.add(pointLight);
    }

    for (const fog of blueprint.fogVolumes ?? []) {
      const data: RegionFogVolume = { ...fog };
      const mesh = createFogVolumeMesh(data);
      this.group.add(mesh);
      this.fogMeshes.push(mesh);
      this.fogVolumeData.push(data);
    }

    if (blueprint.clouds?.length) {
      this.cloudRuntime = createRegionCloudRuntime(this.group, blueprint.clouds);
    }

    if (blueprint.colorGrading.horizonEnabled) {
      const halfSpan = ((blueprint.gridSize - 1) * blueprint.pitch) / 2;
      const cg = blueprint.colorGrading;
      this.horizonGroup = buildRegionHorizon({
        innerRadius: cg.horizonInnerRadius ?? halfSpan * 0.85,
        outerRadius: cg.horizonOuterRadius ?? halfSpan * 1.35,
        peakScale: cg.horizonPeakScale ?? 1,
        tint: cg.horizonTint ?? "#8d97a8",
        seed: hashString(blueprint.id || blueprint.name),
      });
      this.group.add(this.horizonGroup);
    }
  }

  /** Ground height at (x,z) -- used by Game.ts to place the player correctly
   *  while walking around inside this region. */
  heightAt(x: number, z: number): number {
    return sampleRegionHeight(this.blueprint, x, z);
  }

  get colorGrading(): RegionBlueprint["colorGrading"] {
    return this.blueprint.colorGrading;
  }

  /** Hot-swap blueprint data after an editor save (atmosphere / fog / wind). */
  replaceBlueprint(bp: RegionBlueprint): void {
    this.blueprint = bp;
  }

  get fogVolumes(): readonly RegionFogVolume[] {
    return this.fogVolumeData;
  }

  /** Strongest local fog-volume influence at a local point (0..~1). */
  fogInfluenceAt(
    x: number,
    y: number,
    z: number,
    baseFogColor?: THREE.ColorRepresentation,
  ): { weight: number; color: THREE.Color } {
    let weight = 0;
    const color = new THREE.Color(baseFogColor ?? this.blueprint.colorGrading.fogColor);
    const blend = new THREE.Color();
    for (const vol of this.fogVolumeData) {
      const w = fogVolumeInfluence(vol, x, y, z);
      if (w <= 0) continue;
      if (w > weight) {
        weight = w;
        blend.set(vol.color);
      }
    }
    if (weight > 0) color.lerp(blend, Math.min(1, weight));
    return { weight, color };
  }

  /** Keep painted water tinted to sky/fog/ground grading (optional override for seam blends). */
  syncWaterEnvironment(env?: {
    skyColor: THREE.ColorRepresentation;
    fogColor: THREE.ColorRepresentation;
    groundTint?: THREE.ColorRepresentation;
  }): void {
    if (env) {
      this.adtWater?.applyEnvironment(env);
      return;
    }
    const cg = this.blueprint.colorGrading;
    this.adtWater?.applyEnvironment({
      skyColor: cg.skyColor,
      fogColor: cg.fogColor,
      groundTint: cg.groundTint,
    });
  }

  /** {gridSize,pitch,heights,waterHeights} for stepMovement's regionHeightmap input. */
  get heightmap(): Pick<RegionBlueprint, "gridSize" | "pitch" | "heights"> & { waterHeights?: number[] } {
    return {
      gridSize: this.blueprint.gridSize,
      pitch: this.blueprint.pitch,
      heights: this.blueprint.heights,
      waterHeights: this.blueprint.waterHeights,
    };
  }

  get entryLocal(): { x: number; z: number } {
    return this.blueprint.entryLocal;
  }

  /** Placed trees/rocks/buildings (+ expanded houses), for stepMovement collision. */
  get assets(): RegionAsset[] {
    return this.allAssets;
  }

  /** Stamped 3D terrain volumes for collision merge with assets. */
  get terrainVolumes(): RegionBlueprint["terrainVolumes"] {
    return this.blueprint.terrainVolumes;
  }

  get musicTrack(): string | null {
    return this.blueprint.musicTrack ?? null;
  }

  /** Sync-build ADT terrain + water around a viewer position (loading screen).
   *  Do NOT restream Quick Grass here — continent.syncAround calls this on a
   *  ~1.5 s timer, and a scratch camera was stomping the real-camera patch
   *  set (visible as a full-field flicker every couple of seconds). */
  warmAround(x: number, z: number): void {
    this.adtTerrain.warm(x, z);
    this.adtWater?.warm(x, z);
  }

  /** True when the terrain ring visible from local (x,z) is fully streamed --
   *  used with `ready` (foliage/props) to hold the loading screen until nothing
   *  will pop in around the player. Pump update() to drive it toward true. */
  isTerrainRingLoaded(x: number, z: number): boolean {
    return this.adtTerrain.ringComplete(x, z);
  }

  /** Fraction (0..1) of the visible terrain ring that's meshed. */
  terrainRingProgress(x: number, z: number): number {
    return this.adtTerrain.ringProgress(x, z);
  }

  get regionName(): string {
    return this.blueprint.name;
  }

  /** Build Quick Grass from painted coverage + region heightmap. */
  private buildGrassPatches(): void {
    const patches = this.blueprint.grassPatches;
    if (!patches || patches.length === 0) return;
    const settings = mergeQuickGrassSettings(this.blueprint.grassSettings, {
      grassColor: this.blueprint.grassColor,
      grassSway: this.blueprint.grassSway,
    });
    this.grassField = createQuickGrassField(this.group, settings);
    this.grassField.setHeightmap({
      gridSize: this.blueprint.gridSize,
      pitch: this.blueprint.pitch,
      heights: this.blueprint.heights,
    });
    this.grassField.setCoverage(patches, this.blueprint.grassExclusions);
    if (this.grassDrawDistanceOverride != null) {
      const draw = this.grassDrawDistanceOverride;
      this.grassField.setSettings({
        drawDistance: draw,
        detailDistance: grassDetailDistance(draw),
      });
    }
    const entry = this.blueprint.entryLocal;
    this.warmAround(entry.x, entry.z);
  }

  /** Apply live graphics knobs (stream ring + grass draw distance). */
  applyGraphicsSettings(opts: { streamRing?: number; grassDrawDistance?: number }): void {
    if (opts.streamRing !== undefined) {
      this.streamRing = Math.max(1, Math.min(6, Math.round(opts.streamRing)));
      this.adtTerrain.setRing(this.streamRing);
      this.adtWater?.setRing(this.streamRing);
    }
    if (opts.grassDrawDistance !== undefined) {
      this.grassDrawDistanceOverride = opts.grassDrawDistance;
      if (this.grassField) {
        this.grassField.setSettings({
          drawDistance: opts.grassDrawDistance,
          detailDistance: grassDetailDistance(opts.grassDrawDistance),
        });
      }
    }
  }

  /** Add freeform sculpted terrain volumes (boulder/block/pillar/spike/ramp).
   *  Synchronous -- uses shared cached geometries from terrainVolumes.ts. */
  private buildTerrainVolumes(): void {
    const volumes = this.blueprint.terrainVolumes;
    if (!volumes || volumes.length === 0) return;
    for (const v of volumes) {
      const mesh = createTerrainVolumeMesh(v);
      this.group.add(mesh);
      this.volumeMeshes.push(mesh);
    }
  }

  /** Build every foliage placement as per-species instanced geometry, then
   *  distance-cull chunks to the terrain ADT ring in update(). */
  private async buildFoliage(): Promise<void> {
    const byModel = new Map<string, number[]>();
    for (let i = 0; i < this.allAssets.length; i++) {
      const asset = this.allAssets[i]!;
      if (asset.category !== "foliage") continue;
      const list = byModel.get(asset.model);
      if (list) list.push(i);
      else byModel.set(asset.model, [i]);
    }
    if (byModel.size === 0) return;

    await Promise.all(
      [...byModel.entries()].map(async ([model, indices]) => {
        let gltf: GLTF;
        try {
          gltf = await load(`/assets/models/${ASSET_DIR.foliage}/${model}`);
        } catch {
          console.warn(`[regionInterior] failed to load foliage model '${model}' -- skipping ${indices.length} placement(s)`);
          return;
        }
        // Rocks are foliage for placement, but must stay rigid — tree wind
        // sway looks wrong on stone and fought the solid collision silhouette.
        await perfTimeAsync(
          "regionInterior:instanceModel:foliage",
          () =>
            this.instanceModel(gltf, indices, {
              // Small/ground-cover foliage (grass, flowers, ferns, mushrooms,
              // bushes, rocks) skips shadow casting -- its shadow blob is
              // imperceptible but still costs a full alpha-tested depth pass
              // per instance, which adds up fast in dense areas. Trees keep it.
              castShadow: !isLowShadowValueFoliageModel(model),
              receiveShadow: false,
              applyWind: !isRockLikeAssetModel(model),
              distanceCull: true,
              model,
              chunkSize: RegionInteriorRenderer.FOLIAGE_CHUNK_SIZE,
            }),
          model,
        );
      }),
    );
  }

  /** Build every prop/building placement as per-model instanced geometry,
   *  distance-culled to the terrain ADT ring the same way as foliage. */
  private async buildPropsAndBuildings(): Promise<void> {
    const byModel = new Map<string, { category: RegionAsset["category"]; model: string; indices: number[] }>();
    for (let i = 0; i < this.allAssets.length; i++) {
      const asset = this.allAssets[i]!;
      if (asset.category === "foliage") continue;
      const key = `${asset.category}/${asset.model}`;
      const entry = byModel.get(key);
      if (entry) entry.indices.push(i);
      else byModel.set(key, { category: asset.category, model: asset.model, indices: [i] });
    }
    if (byModel.size === 0) return;

    await Promise.all(
      [...byModel.values()].map(async ({ category, model, indices }) => {
        let gltf: GLTF;
        try {
          gltf = await load(`/assets/models/${ASSET_DIR[category]}/${model}`);
        } catch {
          console.warn(`[regionInterior] failed to load ${category} model '${model}' -- skipping ${indices.length} placement(s)`);
          return;
        }
        // Mirrors the old per-object placement rule: floor-type props never
        // cast (they'd shadow themselves against the ground right beneath them).
        const castShadow = category !== "prop" || !model.startsWith("floor");
        await perfTimeAsync(
          "regionInterior:instanceModel:prop",
          () => this.instanceModel(gltf, indices, { castShadow, receiveShadow: true, distanceCull: true, model }),
          model,
        );
      }),
    );
  }

  /** Instantiate authored 3D landmark models placed at POIs. */
  private async buildPois(): Promise<void> {
    const pois = this.blueprint.pois ?? [];
    if (pois.length === 0) return;

    await Promise.all(
      pois.map(async (poi) => {
        if (!poi.model) return;
        const url = resolvePoiModelUrl(poi.model, poi.category);
        if (!url) return;

        let gltf: GLTF;
        try {
          gltf = await load(url);
        } catch {
          console.warn(`[regionInterior] failed to load POI model '${poi.model}' at '${url}'`);
          return;
        }

        if (this.destroyed) return;

        const pY = sampleRegionHeight(this.blueprint, poi.localX, poi.localZ);
        const group = new THREE.Group();
        group.position.set(poi.localX, pY, poi.localZ);
        if (poi.yaw !== undefined) group.rotation.y = poi.yaw;
        if (poi.scale !== undefined) group.scale.setScalar(poi.scale);

        const cloned = SkeletonUtils.clone(gltf.scene) as THREE.Group;
        cloned.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        group.add(cloned);

        this.poiGroups.push(group);
        this.group.add(group);
      }),
    );
  }

  /** World-unit size of the spatial grid instanceModel buckets instances
   *  into. One InstancedMesh spanning an entire region has a bounding sphere
   *  that's almost always inside the camera frustum, so Three.js's free
   *  per-object culling is close to a no-op at that scale -- chunking into
   *  cells this size gives that same free culling a tight-enough bounding
   *  sphere per batch to actually skip whole off-screen cells. */
  private static readonly CHUNK_SIZE = 80;
  /** Foliage-specific override, passed via instanceModel's opts.chunkSize.
   *  Foliage is by far the most numerous category (hundreds-thousands of
   *  instances vs. tens for props/buildings), so it benefits the most from
   *  tighter per-chunk bounding spheres -- a chunk near the edge of the
   *  frustum wastes fewer off-screen instances bundled in with visible ones.
   *  Props/buildings keep the wider default; they don't have enough volume
   *  for this to matter and a 4x cell-count increase isn't worth it there. */
  private static readonly FOLIAGE_CHUNK_SIZE = 40;

  /** Shared instancing helper: one InstancedMesh per submesh/material per
   *  spatial cell (see CHUNK_SIZE), covering every asset index passed in at
   *  its authored position/rotation/scale (same localY as the region editor —
   *  no heightmap re-snap). Pass `distanceCull` so far chunks can be hidden
   *  in update() without load/unload thrashing. */
  /** Wall-clock slice for instance-matrix building before yielding a frame, so
   *  a species with thousands of placements streams in instead of freezing the
   *  main thread in one synchronous burst. */
  private static readonly INSTANCE_BUILD_SLICE_MS = 1.5;

  /** Extracts mesh templates from a loaded GLTF, patches fog/wind the same
   *  way for both the full-detail and LOD variant (see instanceModel), and
   *  returns the world matrices needed to place instances. Shared so the two
   *  tiers stay visually consistent (same fog toggle, same wind-sway rule). */
  private prepareInstanceTemplate(
    gltf: GLTF,
    opts: { applyWind?: boolean },
  ): { meshTemplates: THREE.Mesh[]; localMatrices: THREE.Matrix4[] } {
    const template = SkeletonUtils.clone(gltf.scene);
    template.updateMatrixWorld(true);
    const meshTemplates: THREE.Mesh[] = [];
    template.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshTemplates.push(o as THREE.Mesh);
    });

    // GLTF materials often ship with fog disabled — turn it on so trees fade
    // into the horizon fog instead of hard silhouettes.
    for (const m of meshTemplates) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if (mat && "fog" in mat) (mat as THREE.Material & { fog: boolean }).fog = true;
      }
    }

    // Patched once per mesh template (not per cell/instance below) since
    // every InstancedMesh built from this template shares the same material
    // reference -- each gets its own uMinY/uMaxY baked from that specific
    // mesh's own geometry bounds (trunk vs. canopy meshes differ).
    if (opts.applyWind) {
      for (const m of meshTemplates) {
        m.geometry.computeBoundingBox();
        const bbox = m.geometry.boundingBox!;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        const patched = mats.map((mat) => applyTreeWindSway(mat, this.treeWindUniforms, bbox.min.y, bbox.max.y));
        m.material = Array.isArray(m.material) ? patched : patched[0]!;
      }
    }

    return { meshTemplates, localMatrices: meshTemplates.map((m) => m.matrixWorld.clone()) };
  }

  private async instanceModel(
    gltf: GLTF,
    indices: number[],
    opts: {
      castShadow: boolean;
      receiveShadow: boolean;
      applyWind?: boolean;
      distanceCull?: boolean;
      model?: string;
      /** Overrides CHUNK_SIZE for this call (see FOLIAGE_CHUNK_SIZE). */
      chunkSize?: number;
    },
  ): Promise<void> {
    const { meshTemplates, localMatrices } = this.prepareInstanceTemplate(gltf, opts);
    if (meshTemplates.length === 0) return;

    const chunkSize = opts.chunkSize ?? RegionInteriorRenderer.CHUNK_SIZE;
    const cells = new Map<string, number[]>();
    for (const i of indices) {
      const asset = this.allAssets[i]!;
      const cx = Math.floor(asset.localX / chunkSize);
      const cz = Math.floor(asset.localZ / chunkSize);
      const key = `${cx},${cz}`;
      const list = cells.get(key);
      if (list) list.push(i);
      else cells.set(key, [i]);
    }

    const dummy = new THREE.Object3D();
    // Reused across every instance/submesh — the old code allocated a fresh
    // Matrix4 (dummy.matrix.clone()) per instance per submesh, which for
    // thousands of trees is thousands of throwaway matrices (GC churn + slower
    // build). setMatrixAt copies into the instance buffer, so reuse is safe.
    const scratch = new THREE.Matrix4();
    let sliceStart = performance.now();

    /** Builds one InstancedMesh per template for this cell's placements,
     *  registers it for cleanup, and returns the set. */
    const buildTier = (
      templates: THREE.Mesh[],
      matrices: THREE.Matrix4[],
      cellIndices: number[],
    ): THREE.InstancedMesh[] => {
      const instancedMeshes = templates.map((m) => {
        const im = new THREE.InstancedMesh(m.geometry, m.material, cellIndices.length);
        im.castShadow = opts.castShadow;
        im.receiveShadow = opts.receiveShadow;
        im.visible = true;
        return im;
      });
      for (let k = 0; k < cellIndices.length; k++) {
        const asset = this.allAssets[cellIndices[k]!]!;
        const axes = regionAssetScale(asset);
        // Authored localY matches the editor — do not re-snap to sampleRegionHeight
        // (bilinear vs editor mesh/raycast disagreed and shifted props slightly).
        dummy.position.set(asset.localX, asset.localY, asset.localZ);
        dummy.rotation.set(0, asset.yaw, 0);
        dummy.scale.set(axes.x, axes.y, axes.z);
        dummy.updateMatrix();
        for (let mi = 0; mi < instancedMeshes.length; mi++) {
          scratch.multiplyMatrices(dummy.matrix, matrices[mi]!);
          instancedMeshes[mi]!.setMatrixAt(k, scratch);
        }
      }
      for (const im of instancedMeshes) {
        im.instanceMatrix.needsUpdate = true;
        this.group.add(im);
        this.instancedGroups.push(im);
      }
      return instancedMeshes;
    };

    for (const [cellKey, cellIndices] of cells) {
      if (this.destroyed) return;
      const [cellCx, cellCz] = cellKey.split(",").map(Number) as [number, number];
      const instancedMeshes = buildTier(meshTemplates, localMatrices, cellIndices);

      if (opts.distanceCull) {
        this.assetChunks.push({
          x: (cellCx + 0.5) * chunkSize,
          z: (cellCz + 0.5) * chunkSize,
          model: opts.model ?? "",
          meshes: instancedMeshes,
        });
      }

      // Spread the work: once this frame's slice is spent, yield so the render
      // loop paints, then resume with the next cell.
      if (performance.now() - sliceStart >= RegionInteriorRenderer.INSTANCE_BUILD_SLICE_MS) {
        await nextFrame();
        if (this.destroyed) return;
        sliceStart = performance.now();
      }
    }
  }

  private updateNpcNameplate(inst: RegionNpcInstance): void {
    if (inst.plateSprite) {
      inst.group.remove(inst.plateSprite);
      inst.plateSprite.material.map?.dispose();
      inst.plateSprite.material.dispose();
    }
    const labelText = inst.data.title ? `${inst.data.name}\n${inst.data.title}` : inst.data.name;
    const newPlate = buildHealthNameplate(labelText, inst.hp, inst.maxHp, "#33b5e5");
    newPlate.position.set(0, 2.6, 0);
    inst.group.add(newPlate);
    inst.plateSprite = newPlate;
  }

  /** Per-frame NPC animation + escort-quest logic, plus the grass shader's
   *  time/sun uniforms and asset distance culling. `sun` is optional so
   *  callers without a directional light handy just leave the blade shader's
   *  sun uniforms at their static defaults. */
  update(
    delta: number,
    sun?: THREE.DirectionalLight,
    viewerX = 0,
    viewerZ = 0,
    camera?: THREE.Camera,
    /** Shared per-tick streaming slice (see RegionContinent.update). When
     *  omitted (standalone callers) a private one-region budget is used. */
    budget: StreamBudget = new StreamBudget(REGION_STREAM_BUDGET_MS, 2),
    /** Real sky colors (Game.ts's atmosphereDisplay) so grass's own fog/rim
     *  lighting matches the actual sky instead of a fixed default -- see
     *  QuickGrassField.setSky. Omitted for standalone callers (editor/prewarm
     *  passes) that don't track a live atmosphere sample. */
    sky?: { horizon: THREE.Color; zenith: THREE.Color; fog: THREE.Color; ground?: THREE.Color },
    /** Precompiles the terrain/water shader against the first tile that
     *  streams in (see below) -- terrain/water tiles build progressively
     *  over many frames AFTER region mount (not caught by Game.ts's
     *  one-time compileNewLayer snapshot right after mount), so without
     *  this the very first tile ever drawn for a region pays the full
     *  first-use shader-link stall during a real render frame instead of
     *  off to the side. `renderer`/`topScene` omitted for standalone callers
     *  (editor/prewarm passes) that don't have those handy -- `topScene` is
     *  the real top-level THREE.Scene (this.group's parent, holding the
     *  actual sun/ambient lights), passed as compile()'s targetScene so the
     *  light count baked into the compiled shader variant matches what the
     *  real render will actually use -- compiling against just `tile` alone
     *  (zero lights, since terrain tiles have none as children) would
     *  prepare the wrong variant and waste the precompile entirely. */
    renderer?: THREE.WebGLRenderer,
    topScene?: THREE.Scene,
    isUnderfoot: boolean = true,
  ): void {
    this.adtTerrain.update(viewerX, viewerZ, budget);
    this.adtWater?.update(viewerX, viewerZ, delta, budget);

    if (renderer && camera && topScene) {
      if (!this.terrainMaterialWarmed) {
        const tile = this.adtTerrain.anyTileMesh;
        if (tile) {
          perfTime("regionInterior:compile:terrain", () => renderer.compile(tile, camera, topScene));
          this.terrainMaterialWarmed = true;
        }
      }
      if (!this.waterMaterialWarmed) {
        const tile = this.adtWater?.anyTileMesh;
        if (tile) {
          perfTime("regionInterior:compile:water", () => renderer.compile(tile, camera, topScene));
          this.waterMaterialWarmed = true;
        }
      }
    }

    // Keep foliage/props inside the same Chebyshev ADT ring as streamed
    // terrain, and only show a chunk once its ground tile exists — otherwise
    // trees draw past / ahead of the heightmap mesh and look like they float.
    // Deliberately just a hard in/out toggle -- see assetChunks' doc comment
    // for why this used to be a multi-tier LOD/billboard/dither system.
    const ix0 = adtIndex(viewerX);
    const iz0 = adtIndex(viewerZ);
    if (this.assetChunks.length > 0) {
      for (const chunk of this.assetChunks) {
        const d = Math.max(Math.abs(adtIndex(chunk.x) - ix0), Math.abs(adtIndex(chunk.z) - iz0));
        const inRange = d <= this.streamRing && this.adtTerrain.hasTileAt(chunk.x, chunk.z);
        for (const mesh of chunk.meshes) mesh.visible = inRange;
      }
    }
    for (const mesh of this.volumeMeshes) {
      const d = Math.max(
        Math.abs(adtIndex(mesh.position.x) - ix0),
        Math.abs(adtIndex(mesh.position.z) - iz0),
      );
      mesh.visible = d <= this.streamRing && this.adtTerrain.hasTileAt(mesh.position.x, mesh.position.z);
    }
    // Fog is fill-rate heavy — cull sooner than props (~90 m).
    const fogReach2 = 90 * 90;
    for (const mesh of this.fogMeshes) {
      const dx = mesh.position.x - viewerX;
      const dz = mesh.position.z - viewerZ;
      mesh.visible = dx * dx + dz * dz <= fogReach2;
    }

    if (!(delta > 0)) return;

    if (this.grassField) {
      const half =
        ((this.blueprint.gridSize - 1) * this.blueprint.pitch) / 2 +
        adtRingRadiusMeters(Math.max(1, this.streamRing - 1));
      const inFootprint = isUnderfoot && Math.abs(viewerX) <= half && Math.abs(viewerZ) <= half;
      this.grassField.group.visible = inFootprint;
      if (inFootprint) {
        // Blade push samples world XZ (modelMatrix); convert local viewer → world.
        this.group.getWorldPosition(this.grassWorldScratch);
        this.grassField.setPlayer(
          this.grassWorldScratch.x + viewerX,
          this.grassWorldScratch.y,
          this.grassWorldScratch.z + viewerZ,
        );
        if (sun) {
          const dir = new THREE.Vector3()
            .copy(sun.position)
            .sub(sun.target.position)
            .normalize();
          this.grassField.setSunFromLight(dir, sun.color, sun.intensity);
        }
        if (sky) {
          this.grassField.setSky(sky.horizon, sky.zenith, sky.fog, sky.ground);
        }
        if (camera) {
          this.grassField.update(camera, delta);
        } else {
          this.grassCam.position.set(
            this.grassWorldScratch.x + viewerX,
            this.grassWorldScratch.y + 12,
            this.grassWorldScratch.z + viewerZ,
          );
          this.grassCam.updateMatrixWorld();
          this.grassField.update(this.grassCam, delta);
        }
      }
    }
    this.treeWindUniforms.uTime.value += delta;

    this.cloudRuntime?.update(delta, this.blueprint.wind);

    // Village quest-givers standing idle far from the player don't need a
    // per-frame animation-mixer update (the expensive part of this loop --
    // skinning/bone-matrix work) -- only skip it for NPCs that aren't
    // currently escorting, since an escorting NPC follows the player and can
    // wander arbitrarily far from its authored spot. A quest can only go
    // "active" in the first place by talking to its giver, which requires
    // being near it, so gating the escort-start check behind this same
    // distance cull doesn't change when escorts actually begin.
    const npcAnimReach2 = INTEREST_RADIUS * INTEREST_RADIUS;
    for (const inst of this.npcInstances) {
      if (!inst.loaded) {
        if (!inst.loading) {
          const dx = inst.group.position.x - viewerX;
          const dz = inst.group.position.z - viewerZ;
          if (dx * dx + dz * dz <= npcAnimReach2) {
            inst.loading = true;
            const modelUrl = resolveNpcModelUrl(inst.data.model);
            // A cluster of NPCs crossing the 70m threshold together (e.g.
            // approaching a village) used to fire several loadFrom() calls
            // in close succession with no shader precompile -- each one's
            // first real render then paid a GPU shader-link stall on the
            // hot render frame. renderer.compile() right after attach (same
            // pattern entities.ts's mob queue already uses) moves that cost
            // off to the side instead.
            void perfTimeAsync("regionInterior:npc:loadFrom", () => inst.animModel.loadFrom(modelUrl, 1.75), inst.data.model)
              .then(() => {
                inst.loaded = true;
                if (inst.placeholder) inst.placeholder.visible = false;
                inst.animModel.play("idle");
                inst.group.add(inst.animModel.group);
                if (renderer && camera && topScene) {
                  // topScene (not inst.group's own subtree, which has no
                  // lights) so the compiled variant's baked-in light count
                  // matches what the real render will use -- see this
                  // update() signature's own doc comment on the terrain/
                  // water warm-up above for why that matters.
                  perfTime("regionInterior:npc:compile", () => renderer.compile(inst.animModel.group, camera, topScene), inst.data.model);
                }
              })
              .catch((err) => {
                console.warn(`Failed to load region NPC model ${modelUrl}:`, err);
              })
              .finally(() => {
                inst.loading = false;
              });
          }
        }
        continue;
      }

      const isEscorting = !!inst.escortState && !inst.escortState.completed;
      if (!isEscorting) {
        const dx = inst.group.position.x - viewerX;
        const dz = inst.group.position.z - viewerZ;
        if (dx * dx + dz * dz > npcAnimReach2) continue;
      }
      inst.animModel.update(delta);

      // Check if there is an active escort quest for this NPC in game.questLog
      const activeEscort = game.questLog.find((q) => {
        if (q.status !== "active") return false;
        const npcQuestMatch = inst.data.quests?.some(
          (nq) => nq.id === q.id && (nq.objectiveKind === "escort" || (nq.waypoints && nq.waypoints.length > 0)),
        );
        return npcQuestMatch || (q.objectiveKind === "escort" && q.waypoints && q.waypoints.length > 0);
      });

      if (activeEscort && !inst.escortState) {
        const authoredQuest = inst.data.quests?.find((nq) => nq.id === activeEscort.id);
        const waypoints =
          authoredQuest?.waypoints && authoredQuest.waypoints.length > 0
            ? authoredQuest.waypoints
            : activeEscort.waypoints && activeEscort.waypoints.length > 0
              ? activeEscort.waypoints
              : null;

        if (waypoints && waypoints.length > 0) {
          inst.escortState = { questId: activeEscort.id, waypoints, index: 0, completed: false };
        }
      }

      if (inst.escortState && !inst.escortState.completed) {
        const state = inst.escortState;
        const markerId = `escort_${inst.data.id}`;

        // Update minimap marker position while escorting
        const existingIdx = game.questMarkers.findIndex((m) => m.id === markerId);
        const newMarker = {
          id: markerId,
          name: inst.data.name,
          x: inst.group.position.x,
          z: inst.group.position.z,
          marker: "escort" as const,
        };
        if (existingIdx >= 0) {
          game.questMarkers[existingIdx] = newMarker;
        } else {
          game.questMarkers.push(newMarker);
        }

        // 1. Check Player Death Fail Condition
        if (game.self?.hp !== undefined && game.self.hp <= 0) {
          const qId = state.questId;
          inst.escortState = undefined;
          inst.hp = inst.maxHp;
          inst.group.position.set(inst.initialX, inst.initialY, inst.initialZ);
          inst.group.rotation.y = inst.initialYaw;
          inst.animModel.play("idle");
          game.questMarkers = game.questMarkers.filter((m) => m.id !== markerId);
          game.questLog = game.questLog.filter((q) => q.id !== qId);
          getGame()?.sendQuestAction("decline", qId);
          game.toast("Quest Failed: You Died");
          continue;
        }

        // 2. Check Mob Attacks on Escort NPC
        const now = performance.now();
        if (now - inst.lastHitTime > 1500) {
          const nearMob = getGame()?.entities.nearestHostileMob(
            inst.group.position.x,
            inst.group.position.z,
            6.0,
          );
          if (nearMob) {
            inst.lastHitTime = now;
            const dmg = Math.floor(12 + Math.random() * 10);
            inst.hp = Math.max(0, inst.hp - dmg);
            this.updateNpcNameplate(inst);
            game.toast(`${inst.data.name} took ${dmg} damage! (${inst.hp}/${inst.maxHp} HP)`);
          }
        }

        // 3. Check NPC Death Fail Condition
        if (inst.hp <= 0) {
          const qId = state.questId;
          inst.escortState = undefined;
          inst.hp = inst.maxHp;
          this.updateNpcNameplate(inst);
          inst.group.position.set(inst.initialX, inst.initialY, inst.initialZ);
          inst.group.rotation.y = inst.initialYaw;
          inst.animModel.play("idle");
          game.questMarkers = game.questMarkers.filter((m) => m.id !== markerId);
          game.questLog = game.questLog.filter((q) => q.id !== qId);
          getGame()?.sendQuestAction("decline", qId);
          game.toast("Quest Failed: Escort NPC Perished");
          continue;
        }

        // 4. Move along waypoints
        const targetWp = state.waypoints[state.index];
        if (targetWp) {
          const dx = targetWp.x - inst.group.position.x;
          const dz = targetWp.z - inst.group.position.z;
          const dist = Math.hypot(dx, dz);

          if (dist > 0.5) {
            const moveSpeed = 3.2; // Walking speed
            const targetYaw = Math.atan2(dx, dz);
            inst.group.rotation.y = targetYaw;

            const step = Math.min(dist, moveSpeed * delta);
            inst.group.position.x += (dx / dist) * step;
            inst.group.position.z += (dz / dist) * step;

            const groundY = sampleRegionHeight(this.blueprint, inst.group.position.x, inst.group.position.z);
            inst.group.position.y = groundY;

            inst.animModel.play("run");
          } else {
            state.index++;
            if (state.index >= state.waypoints.length) {
              state.completed = true;
              inst.animModel.play("idle");
              game.questMarkers = game.questMarkers.filter((m) => m.id !== markerId);
              game.toast("Escort Quest Complete!");
              getGame()?.sendQuestAction("turnin", state.questId);
            }
          }
        }
      }
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.grassField) {
      this.grassField.dispose();
      this.grassField = null;
    }
    this.adtTerrain.dispose();
    this.adtWater?.dispose();
    this.adtWater = null;
    for (const im of this.instancedGroups) {
      this.group.remove(im);
      im.geometry?.dispose();
      // Materials are shared with the GLTF cache — don't dispose them.
    }
    this.instancedGroups = [];
    this.assetChunks = [];
    for (const mesh of this.volumeMeshes) {
      this.group.remove(mesh);
      if (!mesh.userData.sharedGeometry) mesh.geometry.dispose();
    }
    this.volumeMeshes = [];
    for (const mesh of this.fogMeshes) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    this.fogMeshes = [];
    this.fogVolumeData = [];
    this.cloudRuntime?.dispose();
    this.cloudRuntime = null;
    if (this.horizonGroup) {
      this.group.remove(this.horizonGroup);
      this.horizonGroup.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          (mesh.material as THREE.Material)?.dispose?.();
        }
      });
      this.horizonGroup = null;
    }
    for (const model of this.npcModels) {
      model.group.parent?.remove(model.group);
      model.dispose();
    }
    this.npcModels = [];
    this.npcInstances = [];
    for (const g of this.poiGroups) {
      this.group.remove(g);
      g.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((m) => m.dispose());
          } else if (mesh.material) {
            mesh.material.dispose();
          }
        }
      });
    }
    this.poiGroups = [];
  }
}
