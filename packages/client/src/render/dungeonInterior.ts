import * as THREE from "three";
import { type DungeonLayoutSpec } from "@rustcraft/shared";
import { load } from "./gltf";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
import { buildShrine, buildNameplate } from "./models";

export interface DungeonTheme {
  wallTint: number;
  ceilingTint: number;
  torchColor: number;
  decorColor: number;
}

export const DUNGEON_THEME_COLORS: Record<"ruins" | "ice", DungeonTheme> = {
  ruins: { wallTint: 0xb9b9a8, ceilingTint: 0x6f6a5f, torchColor: 0xff9a3e, decorColor: 0x8a867e },
  ice: { wallTint: 0x9fc9e0, ceilingTint: 0x4d6478, torchColor: 0x66ccff, decorColor: 0x9fe0ff },
};

/** Manages loading and unloading dungeon assets dynamically based on player proximity
 *  (GTA-style streaming) to support massive layouts without lag or memory leaks. */
export class DungeonInteriorRenderer {
  private group: THREE.Object3D;
  private layout: DungeonLayoutSpec;
  private loaded = new Map<number, THREE.Object3D>();
  private loading = new Set<number>();
  private voidFloor: THREE.Mesh;
  private ceiling: THREE.Mesh;
  private lastUpdatePos = new THREE.Vector3(Infinity, Infinity, Infinity);

  constructor(group: THREE.Object3D, layout: DungeonLayoutSpec) {
    this.group = group;
    this.layout = layout;
    const { center, floorY } = layout;

    // Render a large surrounding black floor plane far below the dungeon to occlude
    // any outdoor landscape/water that could bleed in when looking down pits.
    this.voidFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(500, 500),
      new THREE.MeshBasicMaterial({ color: 0x030303 })
    );
    this.voidFloor.rotation.x = -Math.PI / 2;
    this.voidFloor.position.set(center.x, floorY - 6.0, center.z);
    this.group.add(this.voidFloor);

    // Render a solid dark ceiling plane to seal the dungeon from the outdoor sky.
    this.ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(500, 500),
      new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.DoubleSide })
    );
    this.ceiling.rotation.x = Math.PI / 2;
    this.ceiling.position.set(center.x, floorY + 16.0, center.z);
    this.group.add(this.ceiling);

    // Render the exit portal gateway at the dungeon's entry point
    const exitPortal = buildShrine();
    exitPortal.position.set(layout.entryPoint.x, layout.floorY + layout.spawnHeight, layout.entryPoint.z);
    
    // Customize the crystal to be purple/violet to indicate it's a departure portal
    const crystal = exitPortal.getObjectByName("crystal") as THREE.Mesh | undefined;
    if (crystal) {
      crystal.material = new THREE.MeshBasicMaterial({
        color: 0xd38cff,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
      });
    }
    this.group.add(exitPortal);

    // Add a floating nameplate above the exit portal
    const exitSign = buildNameplate("Exit Portal", "#d38cff");
    exitSign.scale.set(4.0, 1.1, 1);
    exitSign.position.set(layout.entryPoint.x, layout.floorY + layout.spawnHeight + 4.0, layout.entryPoint.z);
    this.group.add(exitSign);
  }

  update(px: number, pz: number): void {
    const distMoved = Math.hypot(px - this.lastUpdatePos.x, pz - this.lastUpdatePos.z);
    if (distMoved < 1.0) return;
    this.lastUpdatePos.set(px, 0, pz);

    const radius = 50; // Proximity radius to load assets (meters)
    const hysteresis = 8; // Extra distance before unloading to prevent thrashing

    for (let i = 0; i < this.layout.assets.length; i++) {
      const asset = this.layout.assets[i]!;
      const ax = this.layout.center.x + asset.localX;
      const az = this.layout.center.z + asset.localZ;
      const dist = Math.hypot(px - ax, pz - az);

      if (dist < radius) {
        if (!this.loaded.has(i) && !this.loading.has(i)) {
          this.loading.add(i);
          const url = `/assets/models/props/${asset.model}`;
          load(url)
            .then((gltf) => {
              this.loading.delete(i);
              
              // Validate player didn't already sprint away during async load
              const currentDist = Math.hypot(px - ax, pz - az);
              if (currentDist > radius + hysteresis) {
                return;
              }

              const obj = SkeletonUtils.clone(gltf.scene);
              const scale = asset.scale ?? 1.0;
              obj.scale.set(scale, scale, scale);
              obj.position.set(ax, this.layout.floorY + asset.localY, az);
              obj.rotation.y = asset.yaw;

              obj.traverse((child) => {
                if ((child as THREE.Mesh).isMesh) {
                  child.receiveShadow = true;
                  // Optimize: Floors/ceilings don't need to cast shadows
                  if (!asset.model.includes("floor") && !asset.model.includes("ceiling")) {
                    child.castShadow = true;
                  }
                }
              });

              if (asset.model.includes("torch")) {
                const torchLight = new THREE.PointLight(0xffaa44, 4, 12, 1.5);
                torchLight.position.set(0, 0.3, 0);
                obj.add(torchLight);
              }

              this.group.add(obj);
              this.loaded.set(i, obj);
            })
            .catch((err) => {
              this.loading.delete(i);
              console.error(`Failed to load dungeon asset ${asset.model}:`, err);
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
    this.group.remove(this.voidFloor);
    this.voidFloor.geometry.dispose();
    this.group.remove(this.ceiling);
    this.ceiling.geometry.dispose();

    for (const obj of this.loaded.values()) {
      this.group.remove(obj);
    }
    this.loaded.clear();
    this.loading.clear();
  }
}
