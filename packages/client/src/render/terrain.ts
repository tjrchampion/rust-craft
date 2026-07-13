import * as THREE from "three";
import {
  terrainHeight,
  terrainSlope,
  biomeAt,
  generatePaths,
  generateRivers,
  distToRiver,
  distPointToSegment,
  RIVER_HALF_WIDTH,
  RIVER_WATER_OFFSET,
  ZONE_SIZE,
  WATER_LEVEL,
} from "@rustcraft/shared";
import { terrainDetailTexture } from "./textures";

const RESOLUTION = 200; // vertices per side

const SAND = new THREE.Color(0xcfc08a);
const SAND_DUNE = new THREE.Color(0xdfc47e);
const GRASS_FOREST = new THREE.Color(0x55803c);
const GRASS_MEADOW = new THREE.Color(0x8aa04f);
const GRASS_HILLS = new THREE.Color(0x92923f);
const GRASS_MOUNTAIN = new THREE.Color(0x6f7d55);
const GRASS_SWAMP = new THREE.Color(0x515f3a);
const MUD_SWAMP = new THREE.Color(0x453d29);
const ROCK = new THREE.Color(0x7d7a72);
const SNOW = new THREE.Color(0xe8ecf0);
const DIRT = new THREE.Color(0x8a6f4d);

export function buildTerrain(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(ZONE_SIZE, ZONE_SIZE, RESOLUTION, RESOLUTION);
  geo.rotateX(-Math.PI / 2);

  const paths = generatePaths();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = terrainHeight(x, z);
    pos.setY(i, y);

    const slope = terrainSlope(x, z);
    const biome = biomeAt(x, z);
    if (biome === "dunes") {
      // Deserts stay sandy throughout — no grass, no beach-line transition.
      color.copy(SAND_DUNE);
    } else if (biome === "swamp" && y < WATER_LEVEL + 1.4) {
      color.copy(MUD_SWAMP);
    } else if (y < WATER_LEVEL + 0.6) {
      color.copy(SAND);
    } else if (slope > 0.75 || y > 24) {
      color.copy(y > 26 ? SNOW : ROCK);
    } else {
      const grass =
        biome === "meadow"
          ? GRASS_MEADOW
          : biome === "mountain"
            ? GRASS_MOUNTAIN
            : biome === "hills"
              ? GRASS_HILLS
              : biome === "swamp"
                ? GRASS_SWAMP
                : GRASS_FOREST;
      color.copy(grass);
      if (biome === "mountain" && slope > 0.45) color.lerp(ROCK, 0.5);
    }

    // Dirt paths carved into the grass.
    if (y > WATER_LEVEL + 0.3) {
      let minDist = Infinity;
      for (const s of paths) {
        const d = distPointToSegment(x, z, s.ax, s.az, s.bx, s.bz);
        if (d < minDist) minDist = d;
        if (minDist < 0.5) break;
      }
      if (minDist < 2.2) color.lerp(DIRT, 0.85);
      else if (minDist < 3.6) color.lerp(DIRT, 0.85 * (1 - (minDist - 2.2) / 1.4));
    }

    // Sandy riverbanks along carved river channels.
    const riverBank = RIVER_HALF_WIDTH + 3;
    const riverD = distToRiver(x, z);
    if (riverD < riverBank) {
      color.lerp(SAND, Math.max(0, Math.min(1, 1 - riverD / riverBank)) * 0.85);
    }

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  // A finely-tiled detail texture multiplies the biome/road vertex colors,
  // adding grassy grain without hiding the low-poly silhouette.
  const detail = terrainDetailTexture();
  detail.repeat.set(RESOLUTION, RESOLUTION);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: detail });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = "terrain";
  return mesh;
}

export function buildWater(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(ZONE_SIZE * 1.4, ZONE_SIZE * 1.4);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({
    color: 0x2a6a9c,
    transparent: true,
    opacity: 0.78,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER_LEVEL;
  mesh.name = "water";
  return mesh;
}

/** Winding river water ribbons, following the carved terrain channels. */
export function buildRivers(): THREE.Group {
  const group = new THREE.Group();
  const segments = generateRivers();
  const byRiver = new Map<number, typeof segments>();
  for (const s of segments) {
    if (!byRiver.has(s.riverId)) byRiver.set(s.riverId, []);
    byRiver.get(s.riverId)!.push(s);
  }

  const mat = new THREE.MeshLambertMaterial({
    color: 0x3a7cac,
    transparent: true,
    opacity: 0.82,
    side: THREE.DoubleSide,
  });

  for (const segs of byRiver.values()) {
    if (segs.length === 0) continue;
    const points: [number, number][] = [[segs[0]!.ax, segs[0]!.az]];
    for (const s of segs) points.push([s.bx, s.bz]);

    const positions: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const [x, z] = points[i]!;
      const prev = points[Math.max(0, i - 1)]!;
      const next = points[Math.min(points.length - 1, i + 1)]!;
      const dx = next[0] - prev[0];
      const dz = next[1] - prev[1];
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      const y = terrainHeight(x, z) + RIVER_WATER_OFFSET;
      positions.push(x + nx * RIVER_HALF_WIDTH, y, z + nz * RIVER_HALF_WIDTH);
      positions.push(x - nx * RIVER_HALF_WIDTH, y, z - nz * RIVER_HALF_WIDTH);
    }

    const indices: number[] = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = (i + 1) * 2;
      const d = (i + 1) * 2 + 1;
      indices.push(a, c, b, b, c, d);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "river";
    group.add(mesh);
  }

  return group;
}
