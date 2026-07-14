import * as THREE from "three";
import {
  biomeAt,
  terrainHeight,
  terrainSlope,
  dist2D,
  distPointToSegment,
  distToRiver,
  hash2,
  fbm,
  generateVillages,
  generatePois,
  generatePaths,
  ZONE_SIZE,
  WATER_LEVEL,
  RIVER_HALF_WIDTH,
  type Biome,
} from "@rustcraft/shared";

const GRASS_SEED = 71717;
const CHUNK_M = 40; // meters per streaming chunk (one InstancedMesh each)
const GRASS_CELL = 3.4; // meters between candidate tuft cells, jittered
const VISIBLE_RADIUS = 95; // grass is fine detail, doesn't need to render far
const SPAWN_CLEAR = 16;
const POI_CLEAR = 9;
const PATH_CLEAR = 3;
const HALF = ZONE_SIZE / 2;
const CHUNKS_PER_SIDE = Math.ceil(ZONE_SIZE / CHUNK_M);

/** Grassy biomes only — mountain (rock/snow) and dunes (sand) stay bare. */
const GRASS_BIOME: Partial<Record<Biome, { color: THREE.Color; density: number }>> = {
  meadow: { color: new THREE.Color(0x8aa04f), density: 1.0 },
  forest: { color: new THREE.Color(0x4f7a38), density: 0.8 },
  hills: { color: new THREE.Color(0x8a9147), density: 0.65 },
  swamp: { color: new THREE.Color(0x4c5736), density: 0.45 },
};

/** A tiny 3-blade tuft, built once in local space; instances only translate/rotate/scale it. */
function buildTuftGeometry(): THREE.BufferGeometry {
  const BLADE_H = 0.5;
  const BLADE_W = 0.11;
  const LEAN = 0.16;
  const DARK = 0.3;
  const LIGHT = 1.0;
  const positions: number[] = [];
  const colors: number[] = [];

  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const hw = BLADE_W / 2;
    const baseLx = -cos * hw;
    const baseLz = sin * hw;
    const baseRx = cos * hw;
    const baseRz = -sin * hw;
    const tipX = sin * LEAN * BLADE_H;
    const tipZ = cos * LEAN * BLADE_H;
    positions.push(baseLx, 0, baseLz, baseRx, 0, baseRz, tipX, BLADE_H, tipZ);
    colors.push(DARK, DARK, DARK, DARK, DARK, DARK, LIGHT, LIGHT, LIGHT);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

const BLADE_GEOMETRY = buildTuftGeometry();
const BLADE_MATERIAL = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });

/**
 * Decorative grass ground-cover — purely client-side and deterministic (no
 * server round-trip, no gathering), streamed in 40m InstancedMesh chunks
 * around the player the same way NodeManager windows resource nodes.
 */
export class GrassField {
  private scene: THREE.Scene;
  private built = new Map<string, THREE.InstancedMesh | null>();
  private inScene = new Set<string>();
  private lastWindowUpdate = 0;
  private villages = generateVillages();
  private pois = generatePois();
  private paths = generatePaths();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  /** Spatial windowing (throttled); call once per frame. */
  update(px: number, pz: number, timeMs: number): void {
    if (timeMs - this.lastWindowUpdate < 600) return;
    this.lastWindowUpdate = timeMs;

    const cx0 = Math.floor((px + HALF) / CHUNK_M);
    const cz0 = Math.floor((pz + HALF) / CHUNK_M);
    const reach = Math.ceil(VISIBLE_RADIUS / CHUNK_M) + 1;

    const wanted = new Set<string>();
    for (let dx = -reach; dx <= reach; dx++) {
      for (let dz = -reach; dz <= reach; dz++) {
        const cx = cx0 + dx;
        const cz = cz0 + dz;
        if (cx < 0 || cz < 0 || cx >= CHUNKS_PER_SIDE || cz >= CHUNKS_PER_SIDE) continue;
        const centerX = -HALF + (cx + 0.5) * CHUNK_M;
        const centerZ = -HALF + (cz + 0.5) * CHUNK_M;
        if (dist2D(px, pz, centerX, centerZ) > VISIBLE_RADIUS + CHUNK_M * 0.71) continue;
        wanted.add(`${cx}_${cz}`);
      }
    }

    for (const key of wanted) {
      if (this.inScene.has(key)) continue;
      let mesh = this.built.get(key);
      if (mesh === undefined) {
        const [cx, cz] = key.split("_").map(Number) as [number, number];
        mesh = this.buildChunk(cx, cz);
        this.built.set(key, mesh);
      }
      if (mesh) this.scene.add(mesh);
      this.inScene.add(key);
    }
    for (const key of this.inScene) {
      if (wanted.has(key)) continue;
      const mesh = this.built.get(key);
      if (mesh) this.scene.remove(mesh);
      this.inScene.delete(key);
    }
  }

  private buildChunk(cx: number, cz: number): THREE.InstancedMesh | null {
    const originX = -HALF + cx * CHUNK_M;
    const originZ = -HALF + cz * CHUNK_M;
    const cells = Math.floor(CHUNK_M / GRASS_CELL);

    interface Item {
      x: number;
      y: number;
      z: number;
      yaw: number;
      scale: number;
      color: THREE.Color;
    }
    const items: Item[] = [];

    for (let ix = 0; ix < cells; ix++) {
      for (let iz = 0; iz < cells; iz++) {
        const base = cx * 97711 + cz * 131 + ix * 977 + iz;
        const jx = hash2(GRASS_SEED + 11, base, 0);
        const jz = hash2(GRASS_SEED + 13, base, 1);
        const x = originX + (ix + jx) * GRASS_CELL;
        const z = originZ + (iz + jz) * GRASS_CELL;

        const cfg = GRASS_BIOME[biomeAt(x, z)];
        if (!cfg) continue;

        const clump = fbm(GRASS_SEED + 29, x, z, 22, 2);
        const roll = hash2(GRASS_SEED + 17, base, 2);
        if (roll > cfg.density * (0.35 + clump * 1.1)) continue;

        const y = terrainHeight(x, z);
        if (y < WATER_LEVEL + 0.35) continue;
        if (terrainSlope(x, z) > 0.5) continue;
        if (dist2D(x, z, 0, 0) < SPAWN_CLEAR) continue;
        if (this.villages.some((v) => dist2D(x, z, v.x, v.z) < v.radius + 3)) continue;
        if (this.pois.some((p) => dist2D(x, z, p.x, p.z) < POI_CLEAR)) continue;
        if (this.paths.some((s) => distPointToSegment(x, z, s.ax, s.az, s.bx, s.bz) < PATH_CLEAR)) continue;
        if (distToRiver(x, z) < RIVER_HALF_WIDTH + 2) continue;

        const yaw = hash2(GRASS_SEED + 19, base, 3) * Math.PI * 2;
        const scale = 0.75 + hash2(GRASS_SEED + 23, base, 4) * 0.55;
        const shade = 0.85 + hash2(GRASS_SEED + 31, base, 5) * 0.3;
        items.push({ x, y, z, yaw, scale, color: cfg.color.clone().multiplyScalar(shade) });
      }
    }

    if (items.length === 0) return null;

    const mesh = new THREE.InstancedMesh(BLADE_GEOMETRY, BLADE_MATERIAL, items.length);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(items.length * 3), 3);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    items.forEach((item, i) => {
      quat.setFromAxisAngle(up, item.yaw);
      matrix.compose(new THREE.Vector3(item.x, item.y, item.z), quat, new THREE.Vector3(item.scale, item.scale, item.scale));
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, item.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    return mesh;
  }
}
