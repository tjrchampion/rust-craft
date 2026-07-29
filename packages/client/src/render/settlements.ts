import * as THREE from "three";
import { type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  generateVillages,
  generatePois,
  generateDungeonLayout,
  mulberry32,
  hashString,
  terrainHeight,
  TIER_NAMES,
  dungeonTierDef,
} from "@rustcraft/shared";
import { buildShrine, buildStump, buildCampfire, buildNameplate, buildRock } from "./models";
import { createSharedGltfLoader } from "./sharedGltf";

const loader = createSharedGltfLoader();
const cache = new Map<string, Promise<GLTF>>();

/** Target real-world height (m) per building type after normalization.
 *  Scaled up markedly for a more imposing, realistic settlement. */
const BUILDING_HEIGHTS: Record<string, number> = {
  home_A: 6.5,
  home_B: 7.0,
  tavern: 8.5,
  blacksmith: 7.2,
  market: 6.8,
  church: 12.0,
  windmill: 13.5,
  lumbermill: 8.0,
  well: 3.2,
  destroyed: 6.0,
  grain: 1.8,
  tower_A: 16.0,
};

/** Clutter props (KayKit hexagon decoration). Height in meters. */
const PROP_HEIGHTS: Record<string, number> = {
  barrel: 1.1,
  crate_A_big: 1.2,
  crate_A_small: 0.8,
  crate_B_small: 0.8,
  bucket_water: 0.7,
  fence_wood_straight: 1.2,
  fence_wood_straight_gate: 1.6,
  fence_stone_straight: 1.3,
  flag_red: 3.5,
  flag_blue: 3.5,
};

function loadGltf(url: string): Promise<GLTF> {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url);
    cache.set(url, p);
  }
  return p;
}

function loadBuilding(type: string): Promise<GLTF> {
  return loadGltf(`/assets/models/buildings/building_${type}.gltf`);
}

function loadProp(type: string): Promise<GLTF> {
  return loadGltf(`/assets/models/buildings/${type}.gltf`);
}

/** Queued clone+placement jobs -- see flushSettlementQueue. Each job is the
 *  synchronous, CPU-bound tail end of a placeBuilding/placeProp/instanceProp
 *  call (deep clone, bbox measurement, scene.add), deferred so a freshly-
 *  streamed-in village's ~50-60 placements don't all land in the same
 *  rendered frame. */
const pendingWork: (() => void)[] = [];

/** Drain a bounded number of queued placement jobs -- call once per frame
 *  from the main render loop (mirrors RegionInteriorRenderer's own
 *  MAX_CLONES_PER_TICK-style clone-queue draining). */
export function flushSettlementQueue(maxPerFrame = 4): void {
  for (let i = 0; i < maxPerFrame && pendingWork.length > 0; i++) {
    pendingWork.shift()!();
  }
}

/** Drop any queued village placements (e.g. overworld torn down mid-stream). */
export function clearSettlementQueue(): void {
  pendingWork.length = 0;
}

async function placeBuilding(
  scene: THREE.Object3D,
  type: string,
  x: number,
  y: number,
  z: number,
  yaw: number,
  scaleMul: number,
  queued = false,
): Promise<void> {
  try {
    const gltf = await loadBuilding(type);
    const finish = () => {
      const model = gltf.scene.clone(true);
      model.userData.fromGltf = true;
      model.traverse((o) => {
        o.userData.fromGltf = true;
      });
      const bbox = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const target = (BUILDING_HEIGHTS[type] ?? 4.5) * scaleMul;
      const scale = size.y > 0.01 ? target / size.y : 1;
      model.scale.setScalar(scale);
      // Feet on the ground, slightly sunk to hug uneven terrain.
      model.position.set(x, y - bbox.min.y * scale - 0.12, z);
      model.rotation.y = yaw;
      model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      scene.add(model);
    };
    if (queued) pendingWork.push(finish);
    else finish();
  } catch (err) {
    console.warn(`[settlements] failed to load building '${type}'`, err);
  }
}

async function placeProp(
  scene: THREE.Object3D,
  type: string,
  x: number,
  z: number,
  yaw: number,
  scaleMul = 1,
  queued = false,
): Promise<void> {
  try {
    const gltf = await loadProp(type);
    const finish = () => {
      const model = gltf.scene.clone(true);
      model.userData.fromGltf = true;
      model.traverse((o) => {
        o.userData.fromGltf = true;
      });
      const bbox = new THREE.Box3().setFromObject(model);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const target = (PROP_HEIGHTS[type] ?? 1) * scaleMul;
      const scale = size.y > 0.01 ? target / size.y : 1;
      model.scale.setScalar(scale);
      const y = terrainHeight(x, z);
      model.position.set(x, y - bbox.min.y * scale - 0.05, z);
      model.rotation.y = yaw;
      model.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) o.castShadow = true;
      });
      scene.add(model);
    };
    if (queued) pendingWork.push(finish);
    else finish();
  } catch (err) {
    console.warn(`[settlements] failed to load prop '${type}'`, err);
  }
}

/** Same visual placement as N `placeProp` calls (bbox-normalized height,
 *  ground-hugging Y, per-position yaw) but as ONE draw call via
 *  THREE.InstancedMesh -- for props repeated many times identically per
 *  village, like the ~25-segment perimeter fence, where cloning a whole
 *  separate Object3D per segment (the old approach) was 25 draw calls doing
 *  the exact same geometry/material for no visual benefit. */
async function instanceProp(
  scene: THREE.Object3D,
  type: string,
  placements: { x: number; z: number; yaw: number }[],
  queued = false,
): Promise<void> {
  if (placements.length === 0) return;
  try {
    const gltf = await loadProp(type);
    const finish = () => {
      const template = gltf.scene.clone(true);
      template.updateMatrixWorld(true);
      const bbox = new THREE.Box3().setFromObject(template);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const target = PROP_HEIGHTS[type] ?? 1;
      const scale = size.y > 0.01 ? target / size.y : 1;
      const minY = bbox.min.y;

      const meshes: THREE.Mesh[] = [];
      template.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
      });

      const dummy = new THREE.Object3D();
      for (const mesh of meshes) {
        // Preserve this submesh's own offset within the template (e.g. posts
        // vs. rails authored as separate parts, not both centered at root)
        // -- `mesh.matrixWorld` is relative to the template's own
        // untransformed root since `template` is never itself added to the
        // real scene.
        const localMatrix = mesh.matrixWorld.clone();
        const instanced = new THREE.InstancedMesh(mesh.geometry, mesh.material, placements.length);
        instanced.userData.fromGltf = true;
        instanced.userData.sharedGeometry = true;
        instanced.castShadow = true;
        for (let i = 0; i < placements.length; i++) {
          const p = placements[i]!;
          const y = terrainHeight(p.x, p.z);
          dummy.position.set(p.x, y - minY * scale - 0.05, p.z);
          dummy.rotation.set(0, p.yaw, 0);
          dummy.scale.setScalar(scale);
          dummy.updateMatrix();
          instanced.setMatrixAt(i, dummy.matrix.clone().multiply(localMatrix));
        }
        instanced.instanceMatrix.needsUpdate = true;
        scene.add(instanced);
      }
    };
    if (queued) pendingWork.push(finish);
    else finish();
  } catch (err) {
    console.warn(`[settlements] failed to instance prop '${type}'`, err);
  }
}

/** Deterministic clutter + a fence perimeter that makes a village feel lived-in. */
function scatterVillageClutter(
  scene: THREE.Object3D,
  village: { id: string; x: number; z: number; radius: number; buildings: { x: number; z: number }[] },
): void {
  const rng = mulberry32(hashString(village.id) ^ 0x9e3779b9);

  // A few barrels / crates / buckets huddled beside random buildings.
  const clutterTypes = ["barrel", "crate_A_big", "crate_A_small", "crate_B_small", "bucket_water"];
  for (const b of village.buildings) {
    const n = Math.floor(rng() * 3); // 0-2 props per building
    for (let i = 0; i < n; i++) {
      const type = clutterTypes[Math.floor(rng() * clutterTypes.length)]!;
      const a = rng() * Math.PI * 2;
      const d = 2 + rng() * 2.5;
      void placeProp(scene, type, b.x + Math.sin(a) * d, b.z + Math.cos(a) * d, rng() * Math.PI * 2, 1, true);
    }
  }

  // Banners flanking the central plaza well.
  for (let i = 0; i < 2; i++) {
    const a = i === 0 ? 0.6 : -0.6;
    void placeProp(
      scene,
      i === 0 ? "flag_red" : "flag_blue",
      village.x + Math.sin(a) * 3.5,
      village.z + Math.cos(a) * 3.5,
      a,
      1,
      true,
    );
  }

  // Wooden fence ring around the town with a gate facing world-origin.
  // Straight segments (~24 of the 26) are identical geometry repeated around
  // the perimeter -- instanced into one draw call instead of 24 separate
  // Object3D clones. The one-off gate segment isn't worth instancing.
  const segments = 26;
  const gateAngle = Math.atan2(-village.x, -village.z); // toward spawn/paths
  const fenceR = village.radius + 3;
  const straightPlacements: { x: number; z: number; yaw: number }[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    // Leave a gap (gate) near the path entrance.
    const delta = Math.abs(((a - gateAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const nearGate = delta < 0.35;
    const fx = village.x + Math.sin(a) * fenceR;
    const fz = village.z + Math.cos(a) * fenceR;
    if (nearGate) {
      if (delta < 0.12) void placeProp(scene, "fence_wood_straight_gate", fx, fz, a, 1, true);
      continue; // gap either side of the gate
    }
    straightPlacements.push({ x: fx, z: fz, yaw: a });
  }
  void instanceProp(scene, "fence_wood_straight", straightPlacements, true);
}

/**
 * Static world dressing: villages, ruins, shrines, camps. Fully deterministic
 * from the shared worldgen — no server round-trip needed.
 */
export interface SettlementHandles {
  shrines: { id: string; x: number; y: number; z: number }[];
  dungeonPortals: { id: string; x: number; y: number; z: number; tier: number }[];
  crystals: THREE.Object3D[];
  signs: THREE.Object3D[];
}

/** Construct a single village's buildings, clutter and nameplate. Cheap to
 *  call lazily per-zone since building GLTFs are cached process-wide. */
export function buildVillage(
  scene: THREE.Object3D,
  village: ReturnType<typeof generateVillages>[number],
  withSigns = true,
): THREE.Object3D[] {
  const signs: THREE.Object3D[] = [];
  for (const b of village.buildings) {
    void placeBuilding(scene, b.type, b.x, b.y, b.z, b.yaw, b.scale, true);
  }
  scatterVillageClutter(scene, village);
  if (withSigns) {
    const sign = buildNameplate(village.name, "#ffe9a8");
    sign.scale.set(7, 1.75, 1);
    sign.position.set(village.x, (village.buildings[0]?.y ?? 4) + 9, village.z);
    scene.add(sign);
    signs.push(sign);
  }
  return signs;
}

/** Ruins, shrines, camps, and the watchtower — modest in count,
 *  so these stay eager rather than being streamed per-zone like villages. */
export function buildWorldStatic(scene: THREE.Object3D, withSigns = true): SettlementHandles {
  const shrines: { id: string; x: number; y: number; z: number }[] = [];
  const dungeonPortals: { id: string; x: number; y: number; z: number; tier: number }[] = [];
  const crystals: THREE.Object3D[] = [];
  const signs: THREE.Object3D[] = [];

  for (const poi of generatePois()) {
    for (const b of poi.buildings) {
      void placeBuilding(scene, b.type, b.x, b.y, b.z, b.yaw, b.scale);
    }
    if (poi.type === "shrine") {
      const shrine = buildShrine();
      shrine.position.set(poi.x, poi.y, poi.z);
      shrine.rotation.y = poi.yaw;
      scene.add(shrine);
      shrines.push({ id: poi.id, x: poi.x, y: poi.y, z: poi.z });
      const crystal = shrine.getObjectByName("crystal");
      if (crystal) crystals.push(crystal);
    } else if (poi.type === "dungeon_portal") {
      // The gateway itself -- reuses the shrine mesh as the outdoor
      // "trigger" object -- the nameplate distinguishes it in-world.
      const portal = buildShrine();
      portal.position.set(poi.x, poi.y, poi.z);
      portal.rotation.y = poi.yaw;
      scene.add(portal);
      const tier = poi.dungeonTier ?? 0;
      dungeonPortals.push({ id: poi.id, x: poi.x, y: poi.y, z: poi.z, tier });
      const crystal = portal.getObjectByName("crystal");
      if (crystal) crystals.push(crystal);
      if (withSigns) {
        const sign = buildNameplate(`Dungeon Portal — ${TIER_NAMES[tier]}`, "#c583ff");
        sign.scale.set(5.5, 1.4, 1);
        sign.position.set(poi.x, poi.y + 4.5, poi.z);
        scene.add(sign);
        signs.push(sign);
      }
    } else if (poi.type === "camp") {
      const fireX = poi.x + 2;
      const fire = buildCampfire();
      fire.position.set(fireX, terrainHeight(fireX, poi.z), poi.z);
      scene.add(fire);
      for (let i = 0; i < 5; i++) {
        const stump = buildStump((i * 0.19 + 0.07) % 1);
        const a = i * 1.35;
        const sx = poi.x + Math.sin(a) * 5;
        const sz = poi.z + Math.cos(a) * 5;
        stump.position.set(sx, terrainHeight(sx, sz), sz);
        scene.add(stump);
      }
    } else if (poi.type === "ruins") {
      for (let i = 0; i < 3; i++) {
        const rubble = buildRock((i * 0.31 + 0.11) % 1);
        const a = poi.yaw + i * 2.2;
        const rx = poi.x + Math.sin(a) * 4.5;
        const rz = poi.z + Math.cos(a) * 4.5;
        rubble.scale.setScalar(0.7);
        rubble.position.set(rx, terrainHeight(rx, rz), rz);
        scene.add(rubble);
      }
      const sign = buildNameplate("Old Watchtower", "#d8c9a8");
      sign.scale.set(6, 1.5, 1);
      sign.position.set(poi.x, poi.y + 18, poi.z);
      scene.add(sign);
      signs.push(sign);
    }
  }

  return { shrines, dungeonPortals, crystals, signs };
}

/** Everything at once — used by the title screen fly-over, which has no
 *  player position to stream around and wants the whole world visible. */
export function buildSettlements(scene: THREE.Scene, withSigns = true): SettlementHandles {
  const allSigns: THREE.Object3D[] = [];
  for (const village of generateVillages()) {
    allSigns.push(...buildVillage(scene, village, withSigns));
  }
  const handles = buildWorldStatic(scene, withSigns);
  handles.signs.push(...allSigns);
  return handles;
}

/** Animate shrine crystals; call per-frame with elapsed time. */
export function animateSettlements(handles: SettlementHandles, timeMs: number): void {
  for (const crystal of handles.crystals) {
    crystal.rotation.y = timeMs / 900;
    crystal.position.y = 1.1 + Math.sin(timeMs / 600) * 0.15;
  }
}

export function preloadSettlements(): Promise<void> {
  const promises: Promise<any>[] = [];
  for (const type of Object.keys(BUILDING_HEIGHTS)) {
    promises.push(loadBuilding(type).catch(() => null));
  }
  for (const type of Object.keys(PROP_HEIGHTS)) {
    promises.push(loadProp(type).catch(() => null));
  }
  return Promise.all(promises).then(() => {});
}
