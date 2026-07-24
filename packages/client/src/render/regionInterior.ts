import * as THREE from "three";
import { sampleRegionHeight, type RegionBlueprint } from "@rustcraft/shared";
import { load } from "./gltf";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { buildShrine, buildNameplate } from "./models";
import { buildRegionBlueprintTerrain, buildRegionWaterMesh, type RegionWaterMeshField } from "./terrain";

const ASSET_DIR: Record<"building" | "foliage" | "prop", string> = {
  building: "buildings",
  foliage: "foliage",
  prop: "props",
};

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
  private blueprint: RegionBlueprint;
  private terrainMesh: THREE.Mesh;
  private waterField?: RegionWaterMeshField;
  private loaded = new Map<number, THREE.Object3D>();
  private loading = new Set<number>();
  private lastUpdatePos = new THREE.Vector3(Infinity, Infinity, Infinity);

  constructor(group: THREE.Object3D, blueprint: RegionBlueprint) {
    this.group = group;
    this.blueprint = blueprint;

    this.terrainMesh = this.buildTerrain();
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

    // Exit portal at the region's own entry point, matching the dungeon
    // interior's exit-portal convention -- interacted with via the same
    // "poi_region_exit" nodeId the server already listens for.
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

    for (const l of blueprint.lights ?? []) {
      const pointLight = new THREE.PointLight(l.color, l.intensity, l.distance, 1.5);
      pointLight.position.set(l.localX, l.localY, l.localZ);
      this.group.add(pointLight);
    }
  }

  private buildTerrain(): THREE.Mesh {
    return buildRegionBlueprintTerrain(this.blueprint);
  }

  /** Ground height at (x,z) -- used by Game.ts to place the player correctly
   *  while walking around inside this region. */
  heightAt(x: number, z: number): number {
    return sampleRegionHeight(this.blueprint, x, z);
  }

  get colorGrading(): RegionBlueprint["colorGrading"] {
    return this.blueprint.colorGrading;
  }

  /** {gridSize,pitch,heights,waterHeights} for stepMovement's regionHeightmap input --
   *  keeps client-side prediction grounded on the same surface the server
   *  uses, exactly like dungeon movement already reuses dungeonFloorHeightAt
   *  on both sides. */
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

  /** Placed trees/rocks/buildings, for stepMovement's regionAssets collision
   *  input -- same reasoning as `heightmap` above. */
  get assets(): RegionBlueprint["assets"] {
    return this.blueprint.assets;
  }

  get musicTrack(): string | null {
    return this.blueprint.musicTrack ?? null;
  }

  get regionName(): string {
    return this.blueprint.name;
  }

  update(px: number, pz: number): void {
    const distMoved = Math.hypot(px - this.lastUpdatePos.x, pz - this.lastUpdatePos.z);
    if (distMoved < 1.0) return;
    this.lastUpdatePos.set(px, 0, pz);

    const radius = 60;
    const hysteresis = 10;

    for (let i = 0; i < this.blueprint.assets.length; i++) {
      const asset = this.blueprint.assets[i]!;
      const dist = Math.hypot(px - asset.localX, pz - asset.localZ);

      if (dist < radius) {
        if (!this.loaded.has(i) && !this.loading.has(i)) {
          this.loading.add(i);
          const url = `/assets/models/${ASSET_DIR[asset.category]}/${asset.model}`;
          load(url)
            .then((gltf) => {
              this.loading.delete(i);
              const currentDist = Math.hypot(px - asset.localX, pz - asset.localZ);
              if (currentDist > radius + hysteresis) return;

              const obj = SkeletonUtils.clone(gltf.scene);
              const scale = asset.scale ?? 1.0;
              obj.scale.set(scale, scale, scale);
              obj.position.set(asset.localX, asset.localY, asset.localZ);
              obj.rotation.y = asset.yaw;
              obj.traverse((child) => {
                if ((child as THREE.Mesh).isMesh) {
                  child.receiveShadow = true;
                  child.castShadow = asset.category !== "prop" || !asset.model.startsWith("floor");
                }
              });
              this.group.add(obj);
              this.loaded.set(i, obj);
            })
            .catch((err) => {
              this.loading.delete(i);
              console.error(`Failed to load region asset ${asset.model}:`, err);
            });
        }
      } else if (dist > radius + hysteresis) {
        if (this.loaded.has(i)) {
          const obj = this.loaded.get(i)!;
          this.group.remove(obj);
          this.loaded.delete(i);
        }
      }
    }
  }

  destroy(): void {
    this.group.remove(this.terrainMesh);
    this.terrainMesh.geometry.dispose();
    for (const obj of this.loaded.values()) this.group.remove(obj);
    this.loaded.clear();
    this.loading.clear();
  }
}
