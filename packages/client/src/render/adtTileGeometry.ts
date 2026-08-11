/**
 * THREE-free ADT tile geometry math.
 *
 * This is the heavy per-vertex work extracted out of `buildRegionAdtTile`
 * (terrain.ts) so it can run inside a Web Worker (adtTile.worker.ts) — the
 * main thread only wraps the returned typed arrays into a BufferGeometry,
 * which is cheap. It also doubles as the synchronous main-thread fallback
 * when workers are unavailable (or for the always-allowed underfoot tile).
 *
 * Coordinate layout matches THREE.PlaneGeometry(sizeX,sizeZ,segsX,segsZ)
 * after `.rotateX(-PI/2).translate(centerX,0,centerZ)`: row-major verts with
 * `i = row * (segsX+1) + col`, x/z on a regular `pitch` grid. The main thread
 * uses the same PlaneGeometry so the index buffer (winding) always matches.
 */
import {
  ADT_SIZE,
  adtWorldBounds,
  distPointToSegment,
  sampleRegionHeight,
  type RegionBiome,
  type RegionRoad,
} from "@rustcraft/shared";

/** Minimal, transferable blueprint slice the ADT math needs. `heights` is a
 *  Float32Array so it can be copied cheaply to workers. */
export interface AdtLiteBlueprint {
  gridSize: number;
  pitch: number;
  heights: ArrayLike<number>;
  biome: RegionBiome;
  roads: RegionRoad[];
  /** RegionColorGrading.groundTint hex, e.g. "#8aa04f". */
  groundTint?: string;
  customTextures?: ArrayLike<number>;
}

/** Result of computing one ADT tile — all typed arrays are transferable. */
export interface AdtTileGeometryData {
  ix: number;
  iz: number;
  segsX: number;
  segsZ: number;
  centerX: number;
  centerZ: number;
  sizeX: number;
  sizeZ: number;
  /** y only, indexed by vertex (positions x/z come from the PlaneGeometry). */
  ys: Float32Array;
  normals: Float32Array;
  terrainUv: Float32Array;
  colors: Float32Array;
  weightsA: Float32Array;
  weightsB: Float32Array;
}

/** Grid span params for one tile — shared between the skeleton builder (main
 *  thread) and the sampler (worker) so both agree on vertex count/layout. */
export interface AdtTileSpan {
  ix: number;
  iz: number;
  gx0: number;
  gz0: number;
  segsX: number;
  segsZ: number;
  sizeX: number;
  sizeZ: number;
  centerX: number;
  centerZ: number;
  half: number;
  span: number;
}

function clampNum(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function adtGridSpan(
  minW: number,
  maxW: number,
  half: number,
  pitch: number,
  gridSize: number,
): { g0: number; g1: number } | null {
  let g0 = Math.floor((minW + half) / pitch + 1e-9);
  let g1 = Math.floor((maxW + half) / pitch + 1e-9);
  if (maxW >= half - 1e-6) g1 = gridSize - 1;
  g0 = clampNum(g0, 0, gridSize - 1);
  g1 = clampNum(g1, 0, gridSize - 1);
  if (g1 <= g0) return null;
  return { g0, g1 };
}

/** Resolve the grid span + centering for one ADT tile, or null if the tile is
 *  empty / outside the region. Cheap; safe to call on the main thread. */
export function adtTileSpan(
  gridSize: number,
  pitch: number,
  ix: number,
  iz: number,
): AdtTileSpan | null {
  const half = ((gridSize - 1) * pitch) / 2;
  const span = half * 2;
  const tile = adtWorldBounds(ix, iz);
  const minX = Math.max(tile.minX, -half);
  const maxX = Math.min(tile.maxX, half);
  const minZ = Math.max(tile.minZ, -half);
  const maxZ = Math.min(tile.maxZ, half);
  if (minX >= maxX - 1e-6 || minZ >= maxZ - 1e-6) return null;

  const spanX = adtGridSpan(minX, maxX, half, pitch, gridSize);
  const spanZ = adtGridSpan(minZ, maxZ, half, pitch, gridSize);
  if (!spanX || !spanZ) return null;
  const segsX = spanX.g1 - spanX.g0;
  const segsZ = spanZ.g1 - spanZ.g0;
  if (segsX < 1 || segsZ < 1) return null;

  const sizeX = segsX * pitch;
  const sizeZ = segsZ * pitch;
  const centerX = -half + spanX.g0 * pitch + sizeX / 2;
  const centerZ = -half + spanZ.g0 * pitch + sizeZ / 2;
  return { ix, iz, gx0: spanX.g0, gz0: spanZ.g0, segsX, segsZ, sizeX, sizeZ, centerX, centerZ, half, span };
}

// ---- Ground tint / weight math (THREE.Color-free) ---------------------------

const REGION_GRASS_TINT_HEX: Record<RegionBiome, number> = {
  grassland: 0x8aa04f,
  forest: 0x4d7a3a,
  jungle: 0x3c6b2f,
  desert: 0xffffff,
  arctic: 0xffffff,
  swamp: 0x515f3a,
  volcanic: 0x6a4432,
  alien: 0x8a6fd6,
  underground: 0x5a6a8a,
  cosmic: 0xa090e0,
};

/** sRGB byte → linear-ish is *not* applied here: the original used
 *  THREE.Color(hex) which stores sRGB components directly into r/g/b (no
 *  color-management unless enabled). We match that: plain component/255. */
function hexToRgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 0xff) / 255, ((hex >> 8) & 0xff) / 255, (hex & 0xff) / 255];
}

function parseHexColor(s: string): number {
  const h = s.trim().replace(/^#/, "");
  return parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16) || 0;
}

/** Squared distance from tile center used to spatially cull roads far away —
 *  a road that can't possibly touch this tile is skipped entirely. */
function roadNearTile(road: RegionRoad, cx: number, cz: number, reach: number): boolean {
  const r = road.width / 2 + 1.5 + reach;
  const r2 = r * r;
  for (let i = 0; i < road.points.length; i++) {
    const p = road.points[i]!;
    const dx = p.x - cx;
    const dz = p.z - cz;
    if (dx * dx + dz * dz <= r2) return true;
  }
  return false;
}

function roadBlendAt(roads: RegionRoad[], x: number, z: number): number {
  let best = 0;
  for (let ri = 0; ri < roads.length; ri++) {
    const road = roads[ri]!;
    const pts = road.points;
    let minDist = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const d = distPointToSegment(x, z, a.x, a.z, b.x, b.z);
      if (d < minDist) minDist = d;
      if (minDist < 0.3) break;
    }
    const half = road.width / 2;
    let blend = 0;
    if (minDist < half) blend = 1;
    else if (minDist < half + 1.5) blend = 1 - (minDist - half) / 1.5;
    if (blend > best) best = blend;
  }
  return best;
}

/**
 * Compute all per-vertex attributes for one ADT tile.
 *
 * `positions` is the PlaneGeometry skeleton's own position buffer (x, 0, z per
 * vertex, row-major with `i = row*(segsX+1) + col`), built on the main thread
 * so the exact x/z — and thus the index winding — always match. We only read
 * x/z from it; heights, normals, weights and tints are computed here. This is
 * the heavy work that runs in the worker.
 */
export function computeAdtTileAttributes(
  bp: AdtLiteBlueprint,
  span: AdtTileSpan,
  positions: Float32Array,
): AdtTileGeometryData {
  const { pitch, biome } = bp;
  const { segsX, segsZ, half } = span;
  const worldSpan = span.span;
  const cols = segsX + 1;
  const rows = segsZ + 1;
  const count = cols * rows;

  const ys = new Float32Array(count);
  const normals = new Float32Array(count * 3);
  const terrainUv = new Float32Array(count * 2);
  const colors = new Float32Array(count * 3);
  const weightsA = new Float32Array(count * 3);
  const weightsB = new Float32Array(count * 3);

  const groundTintRgb = bp.groundTint
    ? hexToRgb(parseHexColor(bp.groundTint))
    : hexToRgb(REGION_GRASS_TINT_HEX[biome]);

  // Spatially cull roads that cannot touch this tile (the original looped all
  // 100+ roads for every vertex; this drops that to only the relevant few).
  const reach = Math.max(span.sizeX, span.sizeZ);
  const roads = bp.roads.length ? bp.roads.filter((r) => roadNearTile(r, span.centerX, span.centerZ, reach)) : bp.roads;

  const heightBp = { gridSize: bp.gridSize, pitch, heights: bp.heights as number[] };
  const customTextures = bp.customTextures;
  const gridSize = bp.gridSize;

  // Pass 1 — heights + UVs (x/z read straight from the skeleton positions).
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3]!;
    const z = positions[i * 3 + 2]!;
    ys[i] = sampleRegionHeight(heightBp, x, z);
    terrainUv[i * 2] = (x + half) / worldSpan;
    terrainUv[i * 2 + 1] = (z + half) / worldSpan;
  }

  // Pass 2 — normals/slope from neighbouring grid Y + ground weights.
  for (let row = 0; row < rows; row++) {
    const rowBase = row * cols;
    const rowDown = Math.max(0, row - 1) * cols;
    const rowUp = Math.min(rows - 1, row + 1) * cols;
    const zSpan = row === 0 || row === rows - 1 ? pitch : 2 * pitch;
    for (let col = 0; col < cols; col++) {
      const i = rowBase + col;
      const x = positions[i * 3]!;
      const z = positions[i * 3 + 2]!;
      const y = ys[i]!;
      const iL = rowBase + Math.max(0, col - 1);
      const iR = rowBase + Math.min(cols - 1, col + 1);
      const iD = rowDown + col;
      const iU = rowUp + col;
      const xSpan = col === 0 || col === cols - 1 ? pitch : 2 * pitch;
      const dHx = (ys[iR]! - ys[iL]!) / xSpan;
      const dHz = (ys[iU]! - ys[iD]!) / zSpan;
      let nx = -dHx;
      const ny = 1;
      let nz = -dHz;
      const len = Math.hypot(nx, ny, nz) || 1;
      normals[i * 3] = nx / len;
      normals[i * 3 + 1] = ny / len;
      normals[i * 3 + 2] = nz / len;

      const slope = Math.hypot(dHx, dHz);
      const roadBlend = roads.length ? roadBlendAt(roads, x, z) : 0;
      let customTex = 0;
      if (customTextures && customTextures.length) {
        const gcx = clampNum(Math.round((x + half) / pitch), 0, gridSize - 1);
        const gcz = clampNum(Math.round((z + half) / pitch), 0, gridSize - 1);
        customTex = customTextures[gcz * gridSize + gcx] ?? 0;
      }
      writeGroundWeights(
        biome,
        y,
        slope,
        roadBlend,
        customTex,
        groundTintRgb,
        i,
        weightsA,
        weightsB,
        colors,
      );
    }
  }

  return {
    ix: span.ix,
    iz: span.iz,
    segsX,
    segsZ,
    centerX: span.centerX,
    centerZ: span.centerZ,
    sizeX: span.sizeX,
    sizeZ: span.sizeZ,
    ys,
    normals,
    terrainUv,
    colors,
    weightsA,
    weightsB,
  };
}

/** Port of terrain.ts `regionGroundWeights`, writing straight into the output
 *  attribute arrays (no per-vertex object/THREE.Color allocation). */
function writeGroundWeights(
  biome: RegionBiome,
  y: number,
  slope: number,
  roadBlend: number,
  customTex: number,
  baseTint: [number, number, number],
  i: number,
  weightsA: Float32Array,
  weightsB: Float32Array,
  colors: Float32Array,
): void {
  let wGrass = 0;
  let wRock = 0;
  let wSand = 0;
  let wSnow = 0;
  let wDirt = 0;
  let wCobble = 0;
  let tr = baseTint[0];
  let tg = baseTint[1];
  let tb = baseTint[2];

  if (customTex === 1) wGrass = 1;
  else if (customTex === 2) wDirt = 1;
  else if (customTex === 3) wCobble = 1;
  else if (customTex === 4) wSnow = 1;
  else if (customTex === 5) wRock = 1;
  else if (customTex === 6) wSand = 1;
  else {
    if (biome === "desert") {
      wSand = 1;
    } else if (biome === "swamp") {
      wDirt = clampNum(0.35 + Math.max(0, -y) * 0.08, 0, 1);
      wGrass = 1 - wDirt;
    } else if (slope > 0.8 || y > 22) {
      if (y > 26 || biome === "arctic") wSnow = 1;
      else wRock = 1;
    } else {
      wGrass = 1;
      if (slope > 0.45) {
        wRock = 0.5;
        wGrass = 0.5;
      }
    }
    if (roadBlend > 0) {
      const keep = 1 - roadBlend;
      wGrass *= keep;
      wRock *= keep;
      wSand *= keep;
      wSnow *= keep;
      wDirt = wDirt * keep + roadBlend;
      // tint.lerp(WHITE, roadBlend)
      tr += (1 - tr) * roadBlend;
      tg += (1 - tg) * roadBlend;
      tb += (1 - tb) * roadBlend;
    }
  }

  const sum = wGrass + wRock + wSand + wSnow + wDirt + wCobble || 1;
  weightsA[i * 3] = wGrass / sum;
  weightsA[i * 3 + 1] = wRock / sum;
  weightsA[i * 3 + 2] = wSand / sum;
  weightsB[i * 3] = wSnow / sum;
  weightsB[i * 3 + 1] = wDirt / sum;
  weightsB[i * 3 + 2] = wCobble / sum;
  colors[i * 3] = tr;
  colors[i * 3 + 1] = tg;
  colors[i * 3 + 2] = tb;
}

export const ADT_TILE_SIZE = ADT_SIZE;
