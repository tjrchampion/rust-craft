import * as THREE from "three";
import { sampleRegionHeight, type RegionBlueprint, type RegionAsset } from "@rustcraft/shared";
import { load, AnimatedModel, PLAYER_ANIMS } from "./gltf";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { buildShrine, buildNameplate, buildHealthNameplate } from "./models";
import { buildRegionBlueprintTerrain, buildRegionWaterMesh, type RegionWaterMeshField } from "./terrain";

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

/** Pre-warm the GLTF cache for every unique model used by a blueprint so that
 *  when RegionInteriorRenderer.update() fires they resolve instantly.
 *  onProgress(loaded, total) is called after each file completes. */
export async function preloadRegionAssets(
  blueprint: RegionBlueprint,
  onProgress: (loaded: number, total: number) => void,
): Promise<void> {
  const urls = [
    ...new Set(
      blueprint.assets.map(
        (a) => `/assets/models/${ASSET_DIR[a.category]}/${a.model}`,
      ),
    ),
  ];
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

/** How many `SkeletonUtils.clone()` calls are allowed per update() tick.
 *  Cloning is synchronous CPU work -- spreading it across frames prevents
 *  spikes when many cached GLBs resolve at once (especially on first entry
 *  into a dense region). 5 per frame ≈ a few ms at worst. */
const MAX_CLONES_PER_TICK = 5;

interface CloneJob {
  i: number;
  asset: RegionAsset;
  gltf: GLTF;
  dist: number; // distance at the time the GLTF resolved — used for priority sort
}

/** Renders a region's interior once a player has walked through its portal --
 *  modeled directly on DungeonInteriorRenderer's proximity-streaming pattern
 *  (load/unload props as the player wanders, with hysteresis to avoid
 *  thrashing at the boundary), but unlike a dungeon a region has real open
 *  sky and its own sculpted terrain instead of a sealed void-floor/ceiling
 *  box, so this builds a real heightmap mesh instead. Color grading
 *  (sky/fog/ambient/sun) is applied by Game.ts's updateDayNight, the same
 *  place the dungeon's fixed torchlight override already lives, rather than
 *  here -- avoids fighting over the same scene-level fog/background/lights
 *  from two places. Mobs are NOT rendered here -- they flow through the
 *  same generic MobSnap/entity pipeline every other mob does, filtered by
 *  the server's existing instance-visibility check. */
export class RegionInteriorRenderer {
  private group: THREE.Object3D;
  readonly blueprint: RegionBlueprint;
  private terrainMesh: THREE.Mesh;
  private waterField?: RegionWaterMeshField;
  private loaded = new Map<number, THREE.Object3D>();
  private loading = new Set<number>();
  private lastUpdatePos = new THREE.Vector3(Infinity, Infinity, Infinity);

  /** Jobs waiting for their SkeletonUtils.clone() turn, sorted nearest-first. */
  private cloneQueue: CloneJob[] = [];
  private npcModels: AnimatedModel[] = [];
  private npcInstances: RegionNpcInstance[] = [];

  // Pre-allocated scratch objects so update() doesn't allocate on the heap
  // every frame (avoids GC pressure in tight per-frame loops).
  private readonly _frustum = new THREE.Frustum();
  private readonly _projMat = new THREE.Matrix4();
  private readonly _cullSphere = new THREE.Sphere();
  private readonly _assetPos = new THREE.Vector3();

  /** Dynamic load radius derived from the region's actual dimensions so it
   *  scales correctly whether the region is 80m or 400m across. The extra
   *  80m buffer ensures assets at the far edge are loaded before you reach
   *  them. Capped at 450m to avoid loading the whole world for giant regions. */
  private readonly LOAD_RADIUS: number;
  private readonly UNLOAD_HYSTERESIS = 40;
  /** Assets within this distance load unconditionally (no frustum check) so
   *  turning around doesn't leave a ring of invisible props right beside you. */
  private readonly NEAR_RADIUS = 40;
  /** Padding sphere around each asset for frustum intersection tests -- larger
   *  values prevent edge-of-view flickering but load slightly more off-screen. */
  private readonly ASSET_CULL_RADIUS = 14;

  constructor(group: THREE.Object3D, blueprint: RegionBlueprint, regionNameMap?: ReadonlyMap<string, string>) {
    this.npcModels = [];
    this.group = group;
    this.blueprint = blueprint;

    // Derive a load radius that covers the full diagonal of this region.
    const halfSpan = ((blueprint.gridSize - 1) * blueprint.pitch) / 2;
    this.LOAD_RADIUS = Math.min(450, Math.hypot(halfSpan, halfSpan) + 80);

    this.terrainMesh = buildRegionBlueprintTerrain(blueprint);
    this.group.add(this.terrainMesh);

    if (blueprint.waterHeights && blueprint.waterHeights.some((w) => w > 0)) {
      this.waterField = buildRegionWaterMesh(blueprint.gridSize, blueprint.pitch, blueprint.heights, blueprint.waterHeights);
      this.group.add(this.waterField.mesh);
    }

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

    this.update(blueprint.entryLocal.x, blueprint.entryLocal.z);
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

  get musicTrack(): string | null {
    return this.blueprint.musicTrack ?? null;
  }

  get regionName(): string {
    return this.blueprint.name;
  }

  /** Place up to MAX_CLONES_PER_TICK queued clone jobs, nearest-first. */
  private flushCloneQueue(px: number, pz: number): void {
    if (this.cloneQueue.length === 0) return;

    // Sort nearest-first so the player always sees the closest assets first.
    this.cloneQueue.sort((a, b) => a.dist - b.dist);

    const batch = this.cloneQueue.splice(0, MAX_CLONES_PER_TICK);
    for (const { i, asset, gltf } of batch) {
      // Guard: asset may have already been loaded by a duplicate job.
      if (this.loaded.has(i)) continue;
      // Guard: player may have moved away while the job was queued.
      const dist = Math.hypot(px - asset.localX, pz - asset.localZ);
      if (dist > this.LOAD_RADIUS + this.UNLOAD_HYSTERESIS) continue;

      const obj = SkeletonUtils.clone(gltf.scene);
      const scale = asset.scale ?? 1.0;
      obj.scale.set(scale, scale, scale);
      const groundY = sampleRegionHeight(this.blueprint, asset.localX, asset.localZ);
      const storedOffset = asset.localY - groundY;
      obj.position.set(asset.localX, groundY + Math.max(0, storedOffset), asset.localZ);
      obj.rotation.y = asset.yaw;
      // Explicit frustumCulled so Three.js skips draw calls for off-screen
      // objects -- also guards against any child node overriding the default.
      obj.frustumCulled = true;
      obj.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.receiveShadow = true;
          child.castShadow = asset.category !== "prop" || !asset.model.startsWith("floor");
          child.frustumCulled = true;
        }
      });
      this.group.add(obj);
      this.loaded.set(i, obj);
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

  update(px: number, pz: number, camera?: THREE.Camera, fog?: THREE.Fog | THREE.FogExp2, delta?: number): void {
    if (delta && delta > 0) {
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
    // Only re-check the full asset list when the player moves meaningfully.
    const distMoved = Math.hypot(px - this.lastUpdatePos.x, pz - this.lastUpdatePos.z);
    const hasMoved = distMoved >= 0.5;
    if (hasMoved) this.lastUpdatePos.set(px, 0, pz);

    // Always drain the clone queue on every tick regardless of movement
    // so queued jobs finish as fast as possible after a burst of GLTF resolves.
    this.flushCloneQueue(px, pz);

    if (!hasMoved) return;

    // Rebuild frustum from camera (using pre-allocated scratch objects).
    let hasFrustum = false;
    if (camera) {
      camera.updateMatrixWorld();
      this._projMat.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this._frustum.setFromProjectionMatrix(this._projMat);
      hasFrustum = true;
    }

    // Determine fog visibility limit so assets obscured by fog aren't streamed or rendered.
    let fogMaxDist = Infinity;
    if (fog instanceof THREE.FogExp2 && fog.density > 0) {
      fogMaxDist = 3.5 / fog.density;
    } else if (fog instanceof THREE.Fog) {
      fogMaxDist = fog.far;
    } else if (this.blueprint.colorGrading?.fogDensity && this.blueprint.colorGrading.fogDensity > 0) {
      fogMaxDist = 3.5 / this.blueprint.colorGrading.fogDensity;
    }

    const effectiveLoadRadius = Math.min(this.LOAD_RADIUS, fogMaxDist);
    const { UNLOAD_HYSTERESIS, NEAR_RADIUS, ASSET_CULL_RADIUS } = this;

    for (let i = 0; i < this.blueprint.assets.length; i++) {
      const asset = this.blueprint.assets[i]!;
      const dist = Math.hypot(px - asset.localX, pz - asset.localZ);

      if (dist < effectiveLoadRadius) {
        if (!this.loaded.has(i) && !this.loading.has(i)) {
          // Frustum gate: skip starting a load for assets clearly out of view,
          // unless they're so close that turning around would reveal them immediately.
          if (hasFrustum && dist > NEAR_RADIUS) {
            this._assetPos.set(asset.localX, asset.localY, asset.localZ);
            this._cullSphere.set(this._assetPos, ASSET_CULL_RADIUS);
            if (!this._frustum.intersectsSphere(this._cullSphere)) continue;
          }

          this.loading.add(i);
          const url = `/assets/models/${ASSET_DIR[asset.category]}/${asset.model}`;
          load(url)
            .then((gltf) => {
              this.loading.delete(i);
              // Don't clone synchronously here -- queue it for frame-budget
              // processing so many resolving promises don't spike one frame.
              const currentDist = Math.hypot(px - asset.localX, pz - asset.localZ);
              if (currentDist <= effectiveLoadRadius + UNLOAD_HYSTERESIS) {
                this.cloneQueue.push({ i, asset, gltf, dist: currentDist });
              }
            })
            .catch(() => {
              this.loading.delete(i);
            });
        }
      } else if (dist > effectiveLoadRadius + UNLOAD_HYSTERESIS) {
        // Unload when far enough away (or hidden by fog) regardless of view direction.
        if (this.loaded.has(i)) {
          this.group.remove(this.loaded.get(i)!);
          this.loaded.delete(i);
        }
        this.loading.delete(i);
        // Drop any pending clone job for this asset too.
        const qi = this.cloneQueue.findIndex((j) => j.i === i);
        if (qi !== -1) this.cloneQueue.splice(qi, 1);
      }
    }
  }

  destroy(): void {
    this.group.remove(this.terrainMesh);
    this.terrainMesh.geometry.dispose();
    for (const obj of this.loaded.values()) this.group.remove(obj);
    this.loaded.clear();
    this.loading.clear();
    this.cloneQueue.length = 0;
    this.npcModels = [];
  }
}
