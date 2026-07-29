import * as THREE from "three";
import { sampleRegionHeight, type RegionBlueprint, type RegionAsset } from "@rustcraft/shared";
import { load, AnimatedModel, PLAYER_ANIMS } from "./gltf";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { buildShrine, buildNameplate, buildHealthNameplate } from "./models";
import { buildRegionBlueprintTerrain, buildRegionWaterMesh, type RegionWaterMeshField } from "./terrain";
import { buildGrassInstances, type GrassField } from "./grassField";
import { createTreeWindUniforms, applyTreeWindSway, applyRegionWind, type TreeWindUniforms } from "./windSway";
import { createTerrainVolumeMesh } from "./terrainVolumes";

/** Base tree canopy sway amplitude (meters) at RegionWind strength 1 --
 *  chosen smaller than grass's own base since tree branches are much larger
 *  levers, so a little displacement reads as a lot of visible motion. */
const BASE_TREE_WIND_STRENGTH = 0.15;

import { game } from "../ui/gameState.svelte";
import { getGame } from "../game/instance";
import type { RegionNpc } from "@rustcraft/shared";

interface RegionNpcInstance {
  group: THREE.Group;
  animModel: AnimatedModel;
  data: RegionNpc;
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
 * Every prop/building/foliage placement is instanced and built once, eagerly,
 * at region entry -- there is deliberately no distance/frustum streaming
 * here. Earlier versions of this renderer streamed individual assets in and
 * out as the player moved, which meant a per-frame JS loop deciding what to
 * load/unload for up to several hundred assets; that loop was the source of
 * repeated stutter and a load/unload thrashing bug, not a fix for a real
 * performance problem. A region this size (typically a few hundred meters
 * across, on the order of a few hundred total assets) is well within what a
 * modern GPU renders for free once geometry is instanced and submitted --
 * WebGL's own hardware clipping discards off-screen triangles at effectively
 * zero cost, so there's no JS-side culling decision worth making at this
 * scale. Everything (foliage included) renders at full detail; a simplified
 * LOD variant of the foliage models exists (scripts/generate-foliage-lods.mjs)
 * if full detail ever proves too much for target hardware -- see buildFoliage.
 *
 * Unlike a dungeon, a region has real open sky and its own sculpted terrain
 * instead of a sealed void-floor/ceiling box, so this builds a real
 * heightmap mesh instead. Color grading (sky/fog/ambient/sun) is applied by
 * Game.ts's updateDayNight, the same place the dungeon's fixed torchlight
 * override already lives, rather than here -- avoids fighting over the same
 * scene-level fog/background/lights from two places. Mobs are NOT rendered
 * here -- they flow through the same generic MobSnap/entity pipeline every
 * other mob does, filtered by the server's existing instance-visibility check.
 */
export class RegionInteriorRenderer {
  private group: THREE.Object3D;
  readonly blueprint: RegionBlueprint;
  private terrainMesh: THREE.Mesh;
  private waterField?: RegionWaterMeshField;
  private npcModels: AnimatedModel[] = [];
  private npcInstances: RegionNpcInstance[] = [];
  /** Every InstancedMesh built by instanceModel (foliage + props/buildings),
   *  tracked flat for destroy() cleanup. */
  private instancedGroups: THREE.InstancedMesh[] = [];
  /** Painted grass patches, expanded once at construction -- see
   *  buildGrassPatches. Null if the blueprint has none. */
  private grassField: GrassField | null = null;
  /** Stamped 3D terrain volumes (boulder/block/etc.) from the volume sculpt
   *  brush. Shared geometries -- destroy() only removes meshes from the group. */
  private volumeMeshes: THREE.Mesh[] = [];
  /** Shared by every foliage material patched via applyTreeWindSway in
   *  instanceModel -- seeded from blueprint.wind at construction. */
  private treeWindUniforms: TreeWindUniforms = createTreeWindUniforms();

  /** Resolves once every foliage/prop/building placement has been built and
   *  added to the scene -- callers (Game.ts) await this before dismissing
   *  the loading screen / calling renderer.compile(), so the first real
   *  render already has everything present instead of assets popping in. */
  readonly ready: Promise<void>;

  constructor(group: THREE.Object3D, blueprint: RegionBlueprint, regionNameMap?: ReadonlyMap<string, string>) {
    this.npcModels = [];
    this.group = group;
    this.blueprint = blueprint;

    this.terrainMesh = buildRegionBlueprintTerrain(blueprint);
    this.group.add(this.terrainMesh);

    if (blueprint.waterHeights && blueprint.waterHeights.some((w) => w > 0)) {
      this.waterField = buildRegionWaterMesh(blueprint.gridSize, blueprint.pitch, blueprint.heights, blueprint.waterHeights);
      this.group.add(this.waterField.mesh);
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
      const pointLight = new THREE.PointLight(l.color, l.intensity, l.distance, 1.5);
      pointLight.position.set(l.localX, l.localY, l.localZ);
      this.group.add(pointLight);
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

  /** Placed trees/rocks/buildings, for stepMovement's regionAssets collision input. */
  get assets(): RegionBlueprint["assets"] {
    return this.blueprint.assets;
  }

  /** Stamped 3D terrain volumes for collision merge with assets. */
  get terrainVolumes(): RegionBlueprint["terrainVolumes"] {
    return this.blueprint.terrainVolumes;
  }

  get musicTrack(): string | null {
    return this.blueprint.musicTrack ?? null;
  }

  get regionName(): string {
    return this.blueprint.name;
  }

  /** Expand this region's painted grass patches (see GrassPatch) into
   *  wind-shaded blade InstancedMeshes -- synchronous, no GLTF load, so this
   *  doesn't need to participate in `ready` the way the async foliage/prop
   *  builds do. */
  private buildGrassPatches(): void {
    const patches = this.blueprint.grassPatches;
    if (!patches || patches.length === 0) return;
    this.grassField = buildGrassInstances(patches, this.blueprint.grassExclusions, this.blueprint, {
      color: this.blueprint.grassColor,
      wind: this.blueprint.wind,
      stream: true,
      parent: this.group,
      visibleRadius: 95,
    });
    // Streamed meshes are parented by buildGrassInstances; seed around entry.
    const entry = this.blueprint.entryLocal;
    this.grassField.update(entry.x, entry.z);
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

  /** Build every foliage placement as always-resident, per-species instanced
   *  full-detail geometry -- see the class doc comment for why this isn't
   *  streamed. Uses the same full-detail model as everything else; a
   *  simplified LOD variant exists (scripts/generate-foliage-lods.mjs) if
   *  full detail ever proves too much for target hardware. */
  private async buildFoliage(): Promise<void> {
    const byModel = new Map<string, number[]>();
    for (let i = 0; i < this.blueprint.assets.length; i++) {
      const asset = this.blueprint.assets[i]!;
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
        this.instanceModel(gltf, indices, { castShadow: true, receiveShadow: false, applyWind: true });
      }),
    );
  }

  /** Build every prop/building placement as always-resident, per-model
   *  instanced geometry, using the full-detail model (no LOD variant exists
   *  for these categories -- far fewer of them than foliage, so none is
   *  needed at this region size). */
  private async buildPropsAndBuildings(): Promise<void> {
    const byModel = new Map<string, { category: RegionAsset["category"]; model: string; indices: number[] }>();
    for (let i = 0; i < this.blueprint.assets.length; i++) {
      const asset = this.blueprint.assets[i]!;
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
        this.instanceModel(gltf, indices, { castShadow, receiveShadow: true });
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
   *  its real authored position/rotation/scale (ground-snapped the same way
   *  the old per-object placement was, preserving any authored above-ground
   *  offset). Everything is still eagerly resident -- chunking only affects
   *  which InstancedMesh an instance's transform lives in, not whether it's
   *  loaded, so there's no streaming/popping behavior here. */
  private instanceModel(gltf: GLTF, indices: number[], opts: { castShadow: boolean; receiveShadow: boolean; applyWind?: boolean }): void {
    const template = SkeletonUtils.clone(gltf.scene);
    template.updateMatrixWorld(true);
    const meshTemplates: THREE.Mesh[] = [];
    template.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) meshTemplates.push(o as THREE.Mesh);
    });
    if (meshTemplates.length === 0) return;

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
      const asset = this.blueprint.assets[i]!;
      const cx = Math.floor(asset.localX / RegionInteriorRenderer.CHUNK_SIZE);
      const cz = Math.floor(asset.localZ / RegionInteriorRenderer.CHUNK_SIZE);
      const key = `${cx},${cz}`;
      const list = cells.get(key);
      if (list) list.push(i);
      else cells.set(key, [i]);
    }

    const dummy = new THREE.Object3D();
    for (const cellIndices of cells.values()) {
      const instancedMeshes = meshTemplates.map((m) => {
        const im = new THREE.InstancedMesh(m.geometry, m.material, cellIndices.length);
        im.castShadow = opts.castShadow;
        im.receiveShadow = opts.receiveShadow;
        return im;
      });

      for (let k = 0; k < cellIndices.length; k++) {
        const asset = this.blueprint.assets[cellIndices[k]!]!;
        const scale = asset.scale ?? 1;
        const groundY = sampleRegionHeight(this.blueprint, asset.localX, asset.localZ);
        const storedOffset = asset.localY - groundY;
        dummy.position.set(asset.localX, groundY + Math.max(0, storedOffset), asset.localZ);
        dummy.rotation.set(0, asset.yaw, 0);
        dummy.scale.setScalar(scale);
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
   *  time/sun uniforms. No asset streaming here anymore -- see the class
   *  doc comment. `sun` is optional so callers without a directional light
   *  handy (there are none today, but keeps this defensive) just leave the
   *  blade shader's sun uniforms at their static defaults. */
  update(delta: number, sun?: THREE.DirectionalLight, viewerX = 0, viewerZ = 0): void {
    if (this.grassField) this.grassField.update(viewerX, viewerZ);
    if (!(delta > 0)) return;

    if (this.grassField) {
      this.grassField.uniforms.uTime.value += delta;
      if (sun) {
        this.grassField.uniforms.uSunDir.value.copy(sun.position).sub(sun.target.position).normalize();
        this.grassField.uniforms.uSunColor.value.copy(sun.color).multiplyScalar(sun.intensity);
      }
    }
    this.treeWindUniforms.uTime.value += delta;

    for (const inst of this.npcInstances) {
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
    this.group.remove(this.terrainMesh);
    this.terrainMesh.geometry.dispose();
    for (const im of this.instancedGroups) this.group.remove(im);
    this.instancedGroups = [];
    for (const mesh of this.volumeMeshes) {
      this.group.remove(mesh);
      if (!mesh.userData.sharedGeometry) mesh.geometry.dispose();
    }
    this.volumeMeshes = [];
    this.npcModels = [];
  }
}
