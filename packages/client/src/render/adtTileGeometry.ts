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
  gridSizeX?: number;
  gridSizeZ?: number;
  pitch: number;
  heights: ArrayLike<number>;
  biome: RegionBiome;
  roads: RegionRoad[];
  /** RegionColorGrading.groundTint hex, e.g. "#8aa04f". */
  groundTint?: string;
  customTextures?: ArrayLike<number>;
  waterHeights?: ArrayLike<number>;
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
  weightsC: Float32Array;
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
  halfX?: number;
  halfZ?: number;
  half: number;
  spanX?: number;
  spanZ?: number;
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
  gridSizeX?: number,
  gridSizeZ?: number,
): AdtTileSpan | null {
  const gx = gridSizeX ?? gridSize;
  const gz = gridSizeZ ?? gridSize;
  const halfX = ((gx - 1) * pitch) / 2;
  const halfZ = ((gz - 1) * pitch) / 2;
  const spanXTotal = halfX * 2;
  const spanZTotal = halfZ * 2;
  const tile = adtWorldBounds(ix, iz);
  const minX = Math.max(tile.minX, -halfX);
  const maxX = Math.min(tile.maxX, halfX);
  const minZ = Math.max(tile.minZ, -halfZ);
  const maxZ = Math.min(tile.maxZ, halfZ);
  if (minX >= maxX - 1e-6 || minZ >= maxZ - 1e-6) return null;

  const spanX = adtGridSpan(minX, maxX, halfX, pitch, gx);
  const spanZ = adtGridSpan(minZ, maxZ, halfZ, pitch, gz);
  if (!spanX || !spanZ) return null;
  const segsX = spanX.g1 - spanX.g0;
  const segsZ = spanZ.g1 - spanZ.g0;
  if (segsX < 1 || segsZ < 1) return null;

  const sizeX = segsX * pitch;
  const sizeZ = segsZ * pitch;
  const centerX = -halfX + spanX.g0 * pitch + sizeX / 2;
  const centerZ = -halfZ + spanZ.g0 * pitch + sizeZ / 2;
  return {
    ix,
    iz,
    gx0: spanX.g0,
    gz0: spanZ.g0,
    segsX,
    segsZ,
    sizeX,
    sizeZ,
    centerX,
    centerZ,
    halfX,
    halfZ,
    half: Math.max(halfX, halfZ),
    spanX: spanXTotal,
    spanZ: spanZTotal,
    span: Math.max(spanXTotal, spanZTotal),
  };
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
  const { segsX, segsZ } = span;
  const halfX = span.halfX ?? span.half;
  const halfZ = span.halfZ ?? span.half;
  const spanXTotal = span.spanX ?? span.span;
  const spanZTotal = span.spanZ ?? span.span;
  const gxTotal = bp.gridSizeX ?? bp.gridSize;
  const gzTotal = bp.gridSizeZ ?? bp.gridSize;
  const cols = segsX + 1;
  const rows = segsZ + 1;
  const count = cols * rows;

  const ys = new Float32Array(count);
  const normals = new Float32Array(count * 3);
  const terrainUv = new Float32Array(count * 2);
  const colors = new Float32Array(count * 3);
  const weightsA = new Float32Array(count * 4);
  const weightsB = new Float32Array(count * 4);
  const weightsC = new Float32Array(count);

  const groundTintRgb = bp.groundTint
    ? hexToRgb(parseHexColor(bp.groundTint))
    : hexToRgb(REGION_GRASS_TINT_HEX[biome]);

  // Spatially cull roads that cannot touch this tile (the original looped all
  // 100+ roads for every vertex; this drops that to only the relevant few).
  const reach = Math.max(span.sizeX, span.sizeZ);
  const roads = bp.roads.length ? bp.roads.filter((r) => roadNearTile(r, span.centerX, span.centerZ, reach)) : bp.roads;

  const heightBp = {
    gridSize: bp.gridSize,
    gridSizeX: bp.gridSizeX,
    gridSizeZ: bp.gridSizeZ,
    pitch,
    heights: bp.heights as number[],
  };
  const customTextures = bp.customTextures;

  // Pass 1 — heights + UVs (x/z read straight from the skeleton positions).
  for (let i = 0; i < count; i++) {
    const x = positions[i * 3]!;
    const z = positions[i * 3 + 2]!;
    ys[i] = sampleRegionHeight(heightBp, x, z);
    terrainUv[i * 2] = (x + halfX) / spanXTotal;
    terrainUv[i * 2 + 1] = (z + halfZ) / spanZTotal;
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
        const gcx = clampNum(Math.round((x + halfX) / pitch), 0, gxTotal - 1);
        const gcz = clampNum(Math.round((z + halfZ) / pitch), 0, gzTotal - 1);
        customTex = customTextures[gcz * gxTotal + gcx] ?? 0;
      }
      let waterDepth = y <= 0 ? Math.max(0, -y) : 0;
      if (bp.waterHeights && bp.waterHeights.length) {
        const gx = clampNum((x + halfX) / pitch, 0, gxTotal - 1);
        const gz = clampNum((z + halfZ) / pitch, 0, gzTotal - 1);
        const gx0 = Math.floor(gx);
        const gz0 = Math.floor(gz);
        const gx1 = Math.min(gxTotal - 1, gx0 + 1);
        const gz1 = Math.min(gzTotal - 1, gz0 + 1);
        const tx = gx - gx0;
        const tz = gz - gz0;
        const w00 = bp.waterHeights[gz0 * gxTotal + gx0] ?? 0;
        const w10 = bp.waterHeights[gz0 * gxTotal + gx1] ?? 0;
        const w01 = bp.waterHeights[gz1 * gxTotal + gx0] ?? 0;
        const w11 = bp.waterHeights[gz1 * gxTotal + gx1] ?? 0;
        const sampledW = (w00 * (1 - tx) + w10 * tx) * (1 - tz) + (w01 * (1 - tx) + w11 * tx) * tz;
        if (sampledW > waterDepth) waterDepth = sampledW;
      }
      const distX = halfX - Math.abs(x);
      const distZ = halfZ - Math.abs(z);
      const edgeDist = Math.min(distX, distZ);
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
        weightsC,
        colors,
        waterDepth,
        edgeDist,
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
    weightsC,
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
  weightsC: Float32Array,
  colors: Float32Array,
  waterDepth = 0,
  edgeDist = Infinity,
  neighborTint?: [number, number, number],
): void {
  let wGrass = 0;
  let wRock = 0;
  let wSand = 0;
  let wSnow = 0;
  let wDirt = 0;
  let wCobble = 0;
  let wMud = 0;
  let wLava = 0;
  let wGravel = 0;
  let tr = baseTint[0];
  let tg = baseTint[1];
  let tb = baseTint[2];

  // Smooth seamless border blending across neighbouring regions
  if (neighborTint) {
    const edgeBlendDist = 32.0;
    const edgeFactor = clampNum(edgeDist / edgeBlendDist, 0, 1);
    const smoothEdge = edgeFactor * edgeFactor * (3 - 2 * edgeFactor);

    if (smoothEdge < 1.0) {
      tr = tr * smoothEdge + neighborTint[0] * (1 - smoothEdge);
      tg = tg * smoothEdge + neighborTint[1] * (1 - smoothEdge);
      tb = tb * smoothEdge + neighborTint[2] * (1 - smoothEdge);
    }
  }

  if (customTex === 1) wGrass = 1;
  else if (customTex === 2) wDirt = 1;
  else if (customTex === 3) wCobble = 1;
  else if (customTex === 4) wSnow = 1;
  else if (customTex === 5) wRock = 1;
  else if (customTex === 6) wSand = 1;
  else if (customTex === 7) wMud = 1;
  else if (customTex === 8) wLava = 1;
  else if (customTex === 9) wGravel = 1;
  else {
    // Water & Shoreline calculation:
    // Sand is only for actual waterbeds (waterDepth > 0.02), submerged ground (y <= 0), or the immediate tidal wash at sea level (y < 0.8m).
    let sandShore = 0;
    if (waterDepth > 0.02) {
      sandShore = clampNum(waterDepth * 2.0, 0.4, 1.0);
    } else if (y <= 0.0) {
      sandShore = 1.0;
    } else if (y < 0.8) {
      sandShore = clampNum((0.8 - y) / 0.8, 0, 1);
    }

    if (biome === "desert") {
      wSand = 1;
      if (slope > 0.75) wRock = 0.6;
    } else if (biome === "swamp") {
      wMud = clampNum(0.45 + Math.max(0, -y) * 0.08, 0, 1);
      wDirt = (1 - wMud) * 0.4;
      wGrass = (1 - wMud) * 0.6;
      if (sandShore > 0) {
        wSand = sandShore * 0.85;
        wMud *= (1 - sandShore * 0.5);
        wGrass *= (1 - sandShore);
      }
      if (slope > 0.7) wRock = 0.5;
    } else if (biome === "arctic") {
      if (sandShore > 0) {
        wSand = sandShore;
        wSnow = 1 - sandShore;
      } else {
        wSnow = 1;
      }
      if (slope > 0.75) wRock = 0.7;
    } else if (biome === "volcanic") {
      wLava = 0.5 * (1 - sandShore * 0.5);
      wSand = sandShore * 0.7;
      wRock = 0.5;
      if (slope > 0.6) wRock = 0.8;
    } else if (biome === "underground") {
      wRock = 0.7 * (1 - sandShore * 0.6);
      wDirt = 0.3 * (1 - sandShore * 0.6);
      wSand = sandShore;
    } else {
      // Grassland, Forest, Jungle, Alien, Cosmic (Temperate & Grassy Biomes)
      // Pure lush green hills with rock only on steep cliff faces or high alpine altitudes:
      const rockSlope = clampNum((slope - 0.72) / 0.38, 0, 1);
      const alpineRock = clampNum((y - 55) / 20, 0, 1);
      const alpineSnow = clampNum((y - 75) / 15, 0, 1);

      const effectiveRock = Math.max(rockSlope * 0.85, alpineRock);

      if (alpineSnow > 0) {
        wSnow = alpineSnow;
        wRock = (1 - alpineSnow) * effectiveRock;
        wGrass = (1 - alpineSnow) * (1 - effectiveRock) * (1 - sandShore);
      } else {
        wRock = effectiveRock;
        wGrass = (1 - effectiveRock) * (1 - sandShore);
      }
      wSand = (1 - effectiveRock) * sandShore;
    }
    if (roadBlend > 0) {
      const keep = 1 - roadBlend;
      wGrass *= keep;
      wRock *= keep;
      wSand *= keep;
      wSnow *= keep;
      wMud *= keep;
      wLava *= keep;
      wDirt = wDirt * keep + roadBlend;
      tr += (1 - tr) * roadBlend;
      tg += (1 - tg) * roadBlend;
      tb += (1 - tb) * roadBlend;
    }
  }

  const sum = wGrass + wRock + wSand + wSnow + wDirt + wCobble + wMud + wLava + wGravel || 1;
  weightsA[i * 4 + 0] = wGrass / sum;
  weightsA[i * 4 + 1] = wRock / sum;
  weightsA[i * 4 + 2] = wSand / sum;
  weightsA[i * 4 + 3] = wSnow / sum;
  weightsB[i * 4 + 0] = wDirt / sum;
  weightsB[i * 4 + 1] = wCobble / sum;
  weightsB[i * 4 + 2] = wMud / sum;
  weightsB[i * 4 + 3] = wLava / sum;
  weightsC[i] = wGravel / sum;
  colors[i * 3 + 0] = tr;
  colors[i * 3 + 1] = tg;
  colors[i * 3 + 2] = tb;
}

export const ADT_TILE_SIZE = ADT_SIZE;
