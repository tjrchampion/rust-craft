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
  mergeQuickGrassSettings,
  grassDetailDistance,
  type RegionBlueprint,
  type RegionAsset,
  type RegionFogVolume,
  type RegionNPC,
} from "@rustcraft/shared";
import { load, AnimatedModel, PLAYER_ANIMS } from "./gltf";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { buildShrine, buildNameplate, buildHealthNameplate } from "./models";
import { RegionAdtTerrainStreamer } from "./regionAdtTerrain";
import { RegionAdtWaterStreamer } from "./regionAdtWater";
import { createQuickGrassField, type QuickGrassField } from "./quickGrass/field";
import { createTreeWindUniforms, applyTreeWindSway, applyRegionWind, type TreeWindUniforms } from "./windSway";
import { createTerrainVolumeMesh } from "./terrainVolumes";
import { createFogVolumeMesh, fogVolumeInfluence } from "./fogVolumes";
import { createRegionCloudRuntime, type RegionCloudRuntime } from "./regionClouds";
import { buildRegionHorizon } from "./regionHorizon";
import { StreamBudget, REGION_STREAM_BUDGET_MS } from "./streamBudget";
import { game } from "../ui/gameState.svelte";
import { getGame } from "../game/instance";

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
  return [...new Set(blueprint.assets.map((a) => `/assets/models/${ASSET_DIR[a.category]}/${a.model}`))];
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
  await Promise.all(
    urls.map((url) =>
      load(url)
        .catch(() => null) // one broken model shouldn't block the whole region
        .finally(() => { loaded++; onProgress(loaded, urls.length); }),
    ),
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
  readonly blueprint: RegionBlueprint;
  private adtTerrain: RegionAdtTerrainStreamer;
  private adtWater: RegionAdtWaterStreamer | null = null;
  private npcModels: AnimatedModel[] = [];
  private npcInstances: RegionNpcInstance[] = [];
  /** Every InstancedMesh built by instanceModel (foliage + props/buildings),
   *  tracked flat for destroy() cleanup. */
  private instancedGroups: THREE.InstancedMesh[] = [];
  /** Instanced asset chunks (foliage/props/buildings) for distance culling. */
  private assetChunks: { x: number; z: number; meshes: THREE.InstancedMesh[] }[] = [];
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
    this.ready = Promise.all([this.buildFoliage(), this.buildPropsAndBuildings()]).then(() => {});

    for (const village of blueprint.villages) {
      const plate = buildNameplate(village.name, "#ffe9a8");
      plate.scale.set(3.2, 0.9, 1);
      plate.position.set(village.localX, sampleRegionHeight(blueprint, village.localX, village.localZ) + 5, village.localZ);
      this.group.add(plate);
    }

    // Exit portal at the region's own entry point.
    const exitY = sampleRegionHeight(blueprint, blueprint.entryLocal.x, blueprint.entryLocal.z);
    const exitPortal = buildShrine();
    exitPortal.position.set(blueprint.entryLocal.x, exitY, blueprint.entryLocal.z);
    const crystal = exitPortal.getObjectByName("crystal") as THREE.Mesh | undefined;
    if (crystal) {
      crystal.material = new THREE.MeshBasicMaterial({
        color: 0xd38cff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending,
      });
    }
    this.group.add(exitPortal);
    const exitSign = buildNameplate("Exit Portal", "#d38cff");
    exitSign.scale.set(4.0, 1.1, 1);
    exitSign.position.set(blueprint.entryLocal.x, exitY + 4.0, blueprint.entryLocal.z);
    this.group.add(exitSign);

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
        new THREE.SphereGeometry(0.7, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0x33b5e5 }),
      );
      placeholder.position.set(0, 0.5, 0);
      npcGroup.add(placeholder);

      const modelName = npc.model || "Knight";
      const modelPath = modelName.endsWith(".glb") ? modelName : `${modelName}.glb`;
      const modelUrl = modelPath.startsWith("/") ? modelPath : `/assets/models/${modelPath}`;

      const animModel = new AnimatedModel(PLAYER_ANIMS);
      animModel
        .loadFrom(modelUrl, 1.75)
        .then(() => {
          placeholder.visible = false;
          animModel.play("idle");
          npcGroup.add(animModel.group);
        })
        .catch((err) => {
          console.error(`Failed to load region NPC model ${modelUrl}:`, err);
        });
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
      };

      const labelText = npc.title ? `${npc.name}\n${npc.title}` : npc.name;
      const plate = buildHealthNameplate(labelText, 100, 100, "#33b5e5");
      plate.position.set(0, 2.6, 0);
      npcGroup.add(plate);
      inst.plateSprite = plate;

      this.npcModels.push(animModel);
      this.npcInstances.push(inst);

      if ((npc.quests?.length ?? 0) > 0 || npc.generateProceduralQuests !== false) {
        const badge = buildNameplate("!", "#ffd700");
        badge.position.set(0, 3.4, 0);
        badge.scale.set(1.4, 1.4, 1);
        npcGroup.add(badge);
      }

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
        this.instanceModel(gltf, indices, {
          castShadow: true,
          receiveShadow: false,
          applyWind: !isRockLikeAssetModel(model),
          distanceCull: true,
        });
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
        this.instanceModel(gltf, indices, { castShadow, receiveShadow: true, distanceCull: true });
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

  /** Shared instancing helper: one InstancedMesh per submesh/material per
   *  spatial cell (see CHUNK_SIZE), covering every asset index passed in at
   *  its authored position/rotation/scale (same localY as the region editor —
   *  no heightmap re-snap). Pass `distanceCull` so far chunks can be hidden
   *  in update() without load/unload thrashing. */
  private instanceModel(
    gltf: GLTF,
    indices: number[],
    opts: { castShadow: boolean; receiveShadow: boolean; applyWind?: boolean; distanceCull?: boolean },
  ): void {
    const template = SkeletonUtils.clone(gltf.scene);
    template.updateMatrixWorld(true);
    const meshTemplates: THREE.Mesh[] = [];
    template.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshTemplates.push(o as THREE.Mesh);
    });
    if (meshTemplates.length === 0) return;

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

    const localMatrices = meshTemplates.map((m) => m.matrixWorld.clone());

    const cells = new Map<string, number[]>();
    for (const i of indices) {
      const asset = this.allAssets[i]!;
      const cx = Math.floor(asset.localX / RegionInteriorRenderer.CHUNK_SIZE);
      const cz = Math.floor(asset.localZ / RegionInteriorRenderer.CHUNK_SIZE);
      const key = `${cx},${cz}`;
      const list = cells.get(key);
      if (list) list.push(i);
      else cells.set(key, [i]);
    }

    const dummy = new THREE.Object3D();
    for (const [cellKey, cellIndices] of cells) {
      const [cellCx, cellCz] = cellKey.split(",").map(Number) as [number, number];
      const instancedMeshes = meshTemplates.map((m) => {
        const im = new THREE.InstancedMesh(m.geometry, m.material, cellIndices.length);
        im.castShadow = opts.castShadow;
        im.receiveShadow = opts.receiveShadow;
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
          instancedMeshes[mi]!.setMatrixAt(k, dummy.matrix.clone().multiply(localMatrices[mi]!));
        }
      }
      for (const im of instancedMeshes) {
        im.instanceMatrix.needsUpdate = true;
        this.group.add(im);
        this.instancedGroups.push(im);
      }
      if (opts.distanceCull) {
        this.assetChunks.push({
          x: (cellCx + 0.5) * RegionInteriorRenderer.CHUNK_SIZE,
          z: (cellCz + 0.5) * RegionInteriorRenderer.CHUNK_SIZE,
          meshes: instancedMeshes,
        });
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
  ): void {
    // One heavy build preferred; urgent underfoot tiles may still force a
    // second via streamer logic when the player is about to walk onto void.
    const budget = new StreamBudget(REGION_STREAM_BUDGET_MS, 2);
    this.adtTerrain.update(viewerX, viewerZ, budget);
    this.adtWater?.update(viewerX, viewerZ, budget);
    this.adtWater?.updateScroll(delta);

    // Keep foliage/props inside the same Chebyshev ADT ring as streamed
    // terrain, and only show a chunk once its ground tile exists — otherwise
    // trees draw past / ahead of the heightmap mesh and look like they float.
    const ix0 = adtIndex(viewerX);
    const iz0 = adtIndex(viewerZ);
    if (this.assetChunks.length > 0) {
      for (const chunk of this.assetChunks) {
        const d = Math.max(Math.abs(adtIndex(chunk.x) - ix0), Math.abs(adtIndex(chunk.z) - iz0));
        const visible = d <= this.streamRing && this.adtTerrain.hasTileAt(chunk.x, chunk.z);
        for (const mesh of chunk.meshes) mesh.visible = visible;
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
      const inFootprint = Math.abs(viewerX) <= half && Math.abs(viewerZ) <= half;
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
    const npcAnimReach2 = 70 * 70;
    for (const inst of this.npcInstances) {
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
          getGame()?.toasts.add("Quest Failed: You Died", "error");
          continue;
        }

        // 2. Check Mob Attacks on Escort NPC
        const now = performance.now();
        if (now - inst.lastHitTime > 1500) {
          const mobList = game.mobSnaps ?? [];
          const nearMob = mobList.find((m) => {
            if (m.hp <= 0) return false;
            return Math.hypot(m.x - inst.group.position.x, m.z - inst.group.position.z) <= 6.0;
          });
          if (nearMob) {
            inst.lastHitTime = now;
            const dmg = Math.floor(12 + Math.random() * 10);
            inst.hp = Math.max(0, inst.hp - dmg);
            this.updateNpcNameplate(inst);
            getGame()?.toasts.add(`${inst.data.name} took ${dmg} damage! (${inst.hp}/${inst.maxHp} HP)`, "error");
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
          getGame()?.toasts.add("Quest Failed: Escort NPC Perished", "error");
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
              getGame()?.toasts.add("Escort Quest Complete!", "quest");
              getGame()?.sendQuestAction("turnin", state.questId);
            }
          }
        }
      }
    }
  }

  destroy(): void {
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
  }
}
