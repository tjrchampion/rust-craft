import * as THREE from "three";
import {
  terrainHeight, terrainSlope, biomeAt, generatePaths, distPointToSegment, ZONE_SIZE, WATER_LEVEL,
  adtKey, adtWorldBounds,
  sampleRegionHeight, regionSlopeAt,
  type RegionBlueprint, type RegionBiome, type RegionRoad,
} from "@rustcraft/shared";

const RESOLUTION = 200; // vertices per side (legacy monolithic meshes)
const TERRAIN_TILING = 48; // texture repeats across the zone

const GRASS_MEADOW = new THREE.Color(0x8aa04f);
const GRASS_HILLS = new THREE.Color(0x92923f);
const GRASS_MOUNTAIN = new THREE.Color(0x6f7d55);
const GRASS_SWAMP = new THREE.Color(0x515f3a);
const GRASS_FOREST = new THREE.Color(0x55803c);
const MUD_SWAMP = new THREE.Color(0x453d29);
const WHITE = new THREE.Color(0xffffff);

const textureLoader = new THREE.TextureLoader();
function tiledTexture(url: string): THREE.Texture {
  const tex = textureLoader.load(url);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Photo-sourced ground textures (ambientCG, CC0), blended per-vertex by biome/slope/height. */
const GROUND_TEXTURES = {
  grass: tiledTexture("/assets/textures/terrain/grass.jpg"),
  rock: tiledTexture("/assets/textures/terrain/rock.jpg"),
  sand: tiledTexture("/assets/textures/terrain/sand.jpg"),
  snow: tiledTexture("/assets/textures/terrain/snow.jpg"),
  dirt: tiledTexture("/assets/textures/terrain/dirt.jpg"),
  cobble: tiledTexture("/assets/textures/terrain/cobble.png"),
};

/** Injects a 6-way texture blend (grass/rock/sand/snow/dirt/cobble) into the standard Lambert shader. */
export function applyGroundBlendShader(mat: THREE.MeshLambertMaterial): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tGrass = { value: GROUND_TEXTURES.grass };
    shader.uniforms.tRock = { value: GROUND_TEXTURES.rock };
    shader.uniforms.tSand = { value: GROUND_TEXTURES.sand };
    shader.uniforms.tSnow = { value: GROUND_TEXTURES.snow };
    shader.uniforms.tDirt = { value: GROUND_TEXTURES.dirt };
    shader.uniforms.tCobble = { value: GROUND_TEXTURES.cobble };
    shader.uniforms.uTiling = { value: TERRAIN_TILING };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute vec3 weightsA;
        attribute vec3 weightsB;
        attribute vec2 terrainUv;
        varying vec3 vWeightsA;
        varying vec3 vWeightsB;
        varying vec2 vTerrainUv;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vWeightsA = weightsA;
        vWeightsB = weightsB;
        vTerrainUv = terrainUv;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D tGrass;
        uniform sampler2D tRock;
        uniform sampler2D tSand;
        uniform sampler2D tSnow;
        uniform sampler2D tDirt;
        uniform sampler2D tCobble;
        uniform float uTiling;
        varying vec3 vWeightsA;
        varying vec3 vWeightsB;
        varying vec2 vTerrainUv;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec2 tuv = vTerrainUv * uTiling;
        vec3 groundColor =
          texture2D(tGrass,  tuv).rgb * vWeightsA.x +
          texture2D(tRock,   tuv).rgb * vWeightsA.y +
          texture2D(tSand,   tuv).rgb * vWeightsA.z +
          texture2D(tSnow,   tuv).rgb * vWeightsB.x +
          texture2D(tDirt,   tuv).rgb * vWeightsB.y +
          texture2D(tCobble, tuv).rgb * vWeightsB.z;
        diffuseColor.rgb = groundColor * mix(vec3(1.0), vColor.rgb, 0.55);`,
      );
  };
}

/** Shared body behind terrain builders — a heightmapped, biome-textured plane
 *  centered at `(centerX, centerZ)`. Optional `sharedMat` avoids per-tile materials. */
function buildTerrainMesh(
  centerX: number,
  centerZ: number,
  sizeX: number,
  sizeZ: number,
  segments = RESOLUTION,
  sharedMat?: THREE.MeshLambertMaterial,
): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(sizeX, sizeZ, segments, segments);
  geo.rotateX(-Math.PI / 2);
  geo.translate(centerX, 0, centerZ);

  const paths = generatePaths();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const terrainUv = (geo.attributes.uv as THREE.BufferAttribute).array as Float32Array;
  const tints = new Float32Array(pos.count * 3);
  // weightsA = [grass, rock, sand], weightsB = [snow, dirt, cobble]
  const weightsA = new Float32Array(pos.count * 3);
  const weightsB = new Float32Array(pos.count * 3);
  const tint = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = terrainHeight(x, z);
    pos.setY(i, y);

    terrainUv[i * 2] = (x + ZONE_SIZE / 2) / ZONE_SIZE;
    terrainUv[i * 2 + 1] = (z + ZONE_SIZE / 2) / ZONE_SIZE;

    const slope = terrainSlope(x, z);
    const biome = biomeAt(x, z);
    let wGrass = 0;
    let wRock = 0;
    let wSand = 0;
    let wSnow = 0;
    let wDirt = 0;
    tint.copy(WHITE);

    if (biome === "dunes") {
      // Deserts stay sandy throughout — no grass, no beach-line transition.
      wSand = 1;
    } else if (biome === "swamp" && y < WATER_LEVEL + 1.4) {
      wDirt = 1;
      tint.copy(MUD_SWAMP);
    } else if (y < WATER_LEVEL + 0.6) {
      wSand = 1;
    } else if (slope > 0.75 || y > 24) {
      if (y > 26) wSnow = 1;
      else wRock = 1;
    } else {
      wGrass = 1;
      tint.copy(
        biome === "meadow"
          ? GRASS_MEADOW
          : biome === "mountain"
            ? GRASS_MOUNTAIN
            : biome === "hills"
              ? GRASS_HILLS
              : biome === "swamp"
                ? GRASS_SWAMP
                : GRASS_FOREST,
      );
      if (biome === "mountain" && slope > 0.45) {
        wRock = 0.5;
        wGrass = 0.5;
      }
    }

    // Dirt paths carved into the grass.
    if (y > WATER_LEVEL + 0.3) {
      let minDist = Infinity;
      for (const s of paths) {
        const d = distPointToSegment(x, z, s.ax, s.az, s.bx, s.bz);
        if (d < minDist) minDist = d;
        if (minDist < 0.5) break;
      }
      let pathBlend = 0;
      if (minDist < 2.2) pathBlend = 0.85;
      else if (minDist < 3.6) pathBlend = 0.85 * (1 - (minDist - 2.2) / 1.4);
      if (pathBlend > 0) {
        wGrass *= 1 - pathBlend;
        wRock *= 1 - pathBlend;
        wSand *= 1 - pathBlend;
        wSnow *= 1 - pathBlend;
        wDirt = wDirt * (1 - pathBlend) + pathBlend;
        tint.lerp(WHITE, pathBlend);
      }
    }

    const sum = wGrass + wRock + wSand + wSnow + wDirt || 1;
    weightsA[i * 3] = wGrass / sum;
    weightsA[i * 3] = wGrass / sum;
    weightsA[i * 3 + 1] = wRock / sum;
    weightsA[i * 3 + 2] = wSand / sum;
    weightsB[i * 3] = wSnow / sum;
    weightsB[i * 3 + 1] = wDirt / sum;
    weightsB[i * 3 + 2] = 0;

    tints[i * 3] = tint.r;
    tints[i * 3 + 1] = tint.g;
    tints[i * 3 + 2] = tint.b;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(tints, 3));
  geo.setAttribute("weightsA", new THREE.BufferAttribute(weightsA, 3));
  geo.setAttribute("weightsB", new THREE.BufferAttribute(weightsB, 3));
  geo.setAttribute("terrainUv", new THREE.BufferAttribute(terrainUv, 2));
  geo.computeVertexNormals();

  const mat = sharedMat ?? new THREE.MeshLambertMaterial({ vertexColors: true });
  if (!sharedMat) applyGroundBlendShader(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

/** Shared Lambert + ground-blend material for streamed region ADT tiles. */
export function createAdtTerrainMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  applyGroundBlendShader(mat);
  return mat;
}

export function buildTerrain(): THREE.Mesh {
  const mesh = buildTerrainMesh(0, 0, ZONE_SIZE, ZONE_SIZE);
  mesh.name = "terrain";
  return mesh;
}

/** Base grass tint per region-editor biome -- there's no spatial biome blend
 *  here the way the open world has (a region is always a single biome), so
 *  this is the one tint baked into every grass-weighted vertex, the same
 *  role GRASS_MEADOW/GRASS_FOREST/etc. play above. */
export const REGION_GRASS_TINTS: Record<RegionBiome, THREE.Color> = {
  grassland: new THREE.Color(0x8aa04f),
  forest: new THREE.Color(0x4d7a3a),
  jungle: new THREE.Color(0x3c6b2f),
  desert: new THREE.Color(0xffffff),
  arctic: new THREE.Color(0xffffff),
  swamp: new THREE.Color(0x515f3a),
  volcanic: new THREE.Color(0x6a4432),
  alien: new THREE.Color(0x8a6fd6),
  underground: new THREE.Color(0x5a6a8a),
  cosmic: new THREE.Color(0xa090e0),
};

export function sampleRegionCustomTexture(
  blueprint: Pick<RegionBlueprint, "gridSize" | "pitch"> & { customTextures?: number[] },
  x: number,
  z: number,
): number {
  if (!blueprint.customTextures || blueprint.customTextures.length === 0) return 0;
  const half = ((blueprint.gridSize - 1) * blueprint.pitch) / 2;
  const gx = Math.round((x + half) / blueprint.pitch);
  const gz = Math.round((z + half) / blueprint.pitch);
  const cx = clampNum(gx, 0, blueprint.gridSize - 1);
  const cz = clampNum(gz, 0, blueprint.gridSize - 1);
  return blueprint.customTextures[cz * blueprint.gridSize + cx] ?? 0;
}

/** Ground texture weights (grass/rock/sand/snow/dirt/cobble) + tint for a single
 *  region-editor vertex, given its own biome, height, local slope, an
 *  optional 0-1 road blend (see regionRoadBlendAt), an optional
 *  author-chosen groundTint override (RegionColorGrading.groundTint), and an
 *  optional custom painted texture ID (1=grass, 2=dirt, 3=cobble, 4=snow, 5=rock, 6=sand). */
export function regionGroundWeights(
  biome: RegionBiome,
  y: number,
  slope: number,
  roadBlend = 0,
  groundTint?: string,
  customTex = 0,
): { wGrass: number; wRock: number; wSand: number; wSnow: number; wDirt: number; wCobble: number; tint: THREE.Color } {
  let wGrass = 0;
  let wRock = 0;
  let wSand = 0;
  let wSnow = 0;
  let wDirt = 0;
  let wCobble = 0;
  const tint = groundTint ? new THREE.Color(groundTint) : REGION_GRASS_TINTS[biome].clone();

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
      tint.lerp(WHITE, roadBlend);
    }
  }

  const sum = wGrass + wRock + wSand + wSnow + wDirt + wCobble || 1;
  return {
    wGrass: wGrass / sum,
    wRock: wRock / sum,
    wSand: wSand / sum,
    wSnow: wSnow / sum,
    wDirt: wDirt / sum,
    wCobble: wCobble / sum,
    tint,
  };
}

function clampNum(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Inclusive grid vertex span for one ADT tile. Uses floor on both edges so
 * adjacent tiles share only the boundary vertex line (no overlapping quads).
 * `maxW` is the exclusive world max from adtWorldBounds (or the clipped
 * region edge).
 */
function adtGridSpan(
  minW: number,
  maxW: number,
  half: number,
  pitch: number,
  gridSize: number,
): { g0: number; g1: number } | null {
  let g0 = Math.floor((minW + half) / pitch + 1e-9);
  let g1 = Math.floor((maxW + half) / pitch + 1e-9);
  // Region edge: include the final heightmap vertex.
  if (maxW >= half - 1e-6) g1 = gridSize - 1;
  g0 = clampNum(g0, 0, gridSize - 1);
  g1 = clampNum(g1, 0, gridSize - 1);
  if (g1 <= g0) return null;
  return { g0, g1 };
}

/** Distance-based dirt blend (0-1) for a point near any painted road --
 *  mirrors the open world's path-blend shape (full dirt within the road's
 *  own width, fading out over an extra ~1.5 units) but reads from the
 *  region's own authored RegionRoad list instead of generatePaths(). */
export function regionRoadBlendAt(roads: RegionRoad[], x: number, z: number): number {
  let best = 0;
  for (const road of roads) {
    let minDist = Infinity;
    for (let i = 0; i < road.points.length - 1; i++) {
      const a = road.points[i]!;
      const b = road.points[i + 1]!;
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

/** Full textured terrain mesh for an in-game region interior -- reads the
 *  blueprint's own sculpted heightmap via sampleRegionHeight/regionSlopeAt
 *  (continuous, bilinear) rather than assuming any vertex-to-grid-cell
 *  correspondence, and reuses the exact same ground-blend shader the open
 *  world's terrain uses instead of a single flat material color. */
export function buildRegionBlueprintTerrain(
  blueprint: Pick<RegionBlueprint, "gridSize" | "pitch" | "heights" | "biome" | "roads" | "colorGrading" | "customTextures">,
): THREE.Mesh {
  const span = (blueprint.gridSize - 1) * blueprint.pitch;
  const geo = new THREE.PlaneGeometry(span, span, blueprint.gridSize - 1, blueprint.gridSize - 1);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const terrainUv = (geo.attributes.uv as THREE.BufferAttribute).array as Float32Array;
  const tints = new Float32Array(pos.count * 3);
  const weightsA = new Float32Array(pos.count * 3);
  const weightsB = new Float32Array(pos.count * 3);
  const roads = blueprint.roads ?? [];
  const groundTint = blueprint.colorGrading.groundTint;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = sampleRegionHeight(blueprint, x, z);
    pos.setY(i, y);

    terrainUv[i * 2] = (x + span / 2) / span;
    terrainUv[i * 2 + 1] = (z + span / 2) / span;

    const slope = regionSlopeAt(blueprint, x, z);
    const roadBlend = regionRoadBlendAt(roads, x, z);
    const customTex = sampleRegionCustomTexture(blueprint, x, z);
    const w = regionGroundWeights(blueprint.biome, y, slope, roadBlend, groundTint, customTex);
    weightsA[i * 3] = w.wGrass;
    weightsA[i * 3 + 1] = w.wRock;
    weightsA[i * 3 + 2] = w.wSand;
    weightsB[i * 3] = w.wSnow;
    weightsB[i * 3 + 1] = w.wDirt;
    weightsB[i * 3 + 2] = w.wCobble;
    tints[i * 3] = w.tint.r;
    tints[i * 3 + 1] = w.tint.g;
    tints[i * 3 + 2] = w.tint.b;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(tints, 3));
  geo.setAttribute("weightsA", new THREE.BufferAttribute(weightsA, 3));
  geo.setAttribute("weightsB", new THREE.BufferAttribute(weightsB, 3));
  geo.setAttribute("terrainUv", new THREE.BufferAttribute(terrainUv, 2));
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  applyGroundBlendShader(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = "region-terrain";
  return mesh;
}

/**
 * One ADT tile of a region heightmap. Vertices snap to the blueprint grid so
 * neighboring tiles share edge heights. Returns null if the tile misses the region.
 */
export function buildRegionAdtTile(
  blueprint: Pick<RegionBlueprint, "gridSize" | "pitch" | "heights" | "biome" | "roads" | "colorGrading" | "customTextures">,
  ix: number,
  iz: number,
  material: THREE.MeshLambertMaterial,
): THREE.Mesh | null {
  const { gridSize, pitch } = blueprint;
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
  const gx0 = spanX.g0;
  const gx1 = spanX.g1;
  const gz0 = spanZ.g0;
  const gz1 = spanZ.g1;
  const segsX = gx1 - gx0;
  const segsZ = gz1 - gz0;
  if (segsX < 1 || segsZ < 1) return null;

  const sizeX = segsX * pitch;
  const sizeZ = segsZ * pitch;
  const centerX = -half + gx0 * pitch + sizeX / 2;
  const centerZ = -half + gz0 * pitch + sizeZ / 2;

  const geo = new THREE.PlaneGeometry(sizeX, sizeZ, segsX, segsZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(centerX, 0, centerZ);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const terrainUv = (geo.attributes.uv as THREE.BufferAttribute).array as Float32Array;
  const tints = new Float32Array(pos.count * 3);
  const weightsA = new Float32Array(pos.count * 3);
  const weightsB = new Float32Array(pos.count * 3);
  const normals = new Float32Array(pos.count * 3);
  const roads = blueprint.roads ?? [];
  const groundTint = blueprint.colorGrading.groundTint;
  const cols = segsX + 1;
  const rows = segsZ + 1;

  // Pass 1 — heights + UVs only (one height sample per vert).
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, sampleRegionHeight(blueprint, x, z));
    terrainUv[i * 2] = (x + half) / span;
    terrainUv[i * 2 + 1] = (z + half) / span;
  }

  // Pass 2 — normals/slope from neighboring grid Y (avoids regionSlopeAt's
  // 4 extra samples + Three's face-walk computeVertexNormals).
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const iL = row * cols + Math.max(0, col - 1);
      const iR = row * cols + Math.min(cols - 1, col + 1);
      const iD = Math.max(0, row - 1) * cols + col;
      const iU = Math.min(rows - 1, row + 1) * cols + col;
      const xSpan = col === 0 || col === cols - 1 ? pitch : 2 * pitch;
      const zSpan = row === 0 || row === rows - 1 ? pitch : 2 * pitch;
      const dHx = (pos.getY(iR) - pos.getY(iL)) / xSpan;
      const dHz = (pos.getY(iU) - pos.getY(iD)) / zSpan;
      // Normal ≈ normalize(-dHx, 1, -dHz)
      let nx = -dHx;
      let ny = 1;
      let nz = -dHz;
      const len = Math.hypot(nx, ny, nz) || 1;
      normals[i * 3] = nx / len;
      normals[i * 3 + 1] = ny / len;
      normals[i * 3 + 2] = nz / len;

      const slope = Math.hypot(dHx, dHz);
      const roadBlend = regionRoadBlendAt(roads, x, z);
      const customTex = sampleRegionCustomTexture(blueprint, x, z);
      const w = regionGroundWeights(blueprint.biome, y, slope, roadBlend, groundTint, customTex);
      weightsA[i * 3] = w.wGrass;
      weightsA[i * 3 + 1] = w.wRock;
      weightsA[i * 3 + 2] = w.wSand;
      weightsB[i * 3] = w.wSnow;
      weightsB[i * 3 + 1] = w.wDirt;
      weightsB[i * 3 + 2] = w.wCobble;
      tints[i * 3] = w.tint.r;
      tints[i * 3 + 1] = w.tint.g;
      tints[i * 3 + 2] = w.tint.b;
    }
  }

  geo.setAttribute("color", new THREE.BufferAttribute(tints, 3));
  geo.setAttribute("weightsA", new THREE.BufferAttribute(weightsA, 3));
  geo.setAttribute("weightsB", new THREE.BufferAttribute(weightsB, 3));
  geo.setAttribute("terrainUv", new THREE.BufferAttribute(terrainUv, 2));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));

  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.name = `region-adt:${adtKey(ix, iz)}`;
  mesh.userData.adtIx = ix;
  mesh.userData.adtIz = iz;
  return mesh;
}

export interface WaterField {
  mesh: THREE.Mesh;
  update(dt: number): void;
}

export interface WaterEnvColors {
  skyColor: THREE.ColorRepresentation;
  fogColor: THREE.ColorRepresentation;
  groundTint?: THREE.ColorRepresentation;
}

/** Light atmosphere tint kept for Game/editor callers; base look matches original water. */
export function applyWaterEnvironment(mat: THREE.MeshLambertMaterial, env: WaterEnvColors): void {
  const sky = new THREE.Color(env.skyColor);
  const fog = new THREE.Color(env.fogColor);
  const water = new THREE.Color(0x3b9bc9);
  water.lerp(fog, 0.25);
  water.lerp(sky, 0.12);
  mat.color.copy(water);
}

export function applyWaterClarityShader(_mat: THREE.MeshLambertMaterial): void {
  // Original water had no clarity shader pass.
}

export function buildWater(): WaterField {
  const geo = new THREE.PlaneGeometry(ZONE_SIZE * 1.4, ZONE_SIZE * 1.4);
  geo.rotateX(-Math.PI / 2);
  const normalMap = tiledTexture("/assets/textures/water/water_normal.jpg");
  normalMap.repeat.set(80, 80);
  // A second copy of the same map, scrolling at a different speed/angle —
  // MeshLambertMaterial only samples one normal map, so instead of a real
  // two-layer blend we alternate the scroll direction with a slow drift so
  // the ripple pattern never reads as a straight, mechanical conveyor-belt.
  const mat = new THREE.MeshLambertMaterial({
    color: 0x2a6a9c,
    transparent: true,
    opacity: 0.82,
    normalMap,
    normalScale: new THREE.Vector2(0.35, 0.35),
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = WATER_LEVEL;
  mesh.name = "water";

  let t = 0;
  function update(dt: number): void {
    t += dt;
    normalMap.offset.set(t * 0.015 + Math.sin(t * 0.05) * 0.03, t * 0.011);
  }

  return { mesh, update };
}

export interface RegionWaterMeshField {
  mesh: THREE.Mesh;
  updateGeometry(heights: ArrayLike<number>, waterHeights: ArrayLike<number>, gridSize: number, pitch: number): void;
  update(dt: number): void;
}

export function buildRegionWaterMesh(
  gridSize: number,
  pitch: number,
  heights: ArrayLike<number>,
  waterHeights: ArrayLike<number>,
): RegionWaterMeshField {
  const span = (gridSize - 1) * pitch;
  const geo = new THREE.PlaneGeometry(span, span, gridSize - 1, gridSize - 1);
  geo.rotateX(-Math.PI / 2);

  const normalMap = tiledTexture("/assets/textures/water/water_normal.jpg");
  normalMap.repeat.set(16, 16);

  const mat = new THREE.MeshLambertMaterial({
    color: 0x3b9bc9,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    side: THREE.DoubleSide,
    normalMap,
    normalScale: new THREE.Vector2(0.4, 0.4),
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "region-water";
  mesh.receiveShadow = true;

  function updateGeometry(hArr: ArrayLike<number>, wArr: ArrayLike<number>, gSize: number, pPitch: number): void {
    const pos = geo.attributes.position as THREE.BufferAttribute;

    for (let gz = 0; gz < gSize; gz++) {
      for (let gx = 0; gx < gSize; gx++) {
        const idx = gz * gSize + gx;
        const h = hArr[idx] ?? 0;
        const w = wArr[idx] ?? 0;
        const vIdx = gz * gSize + gx;

        if (w > 0.005) {
          let waterY = h + w;

          // Wall-clinging meniscus effect:
          // Check 4-neighbors for higher terrain walls or cliff faces
          let maxWallH = h;
          if (gx > 0) maxWallH = Math.max(maxWallH, hArr[idx - 1] ?? 0);
          if (gx < gSize - 1) maxWallH = Math.max(maxWallH, hArr[idx + 1] ?? 0);
          if (gz > 0) maxWallH = Math.max(maxWallH, hArr[idx - gSize] ?? 0);
          if (gz < gSize - 1) maxWallH = Math.max(maxWallH, hArr[idx + gSize] ?? 0);

          if (maxWallH > waterY) {
            // Cling slightly upward to cliff / wall face
            const clingLift = Math.min(0.25, (maxWallH - waterY) * 0.22);
            waterY += clingLift;
          }

          pos.setY(vIdx, waterY);
        } else {
          // Check if any neighboring cell is wet (shoreline vertex)
          let hasWetNeighbor = false;
          let neighborWaterY = h;
          if (gx > 0 && (wArr[idx - 1] ?? 0) > 0.005) { hasWetNeighbor = true; neighborWaterY = (hArr[idx - 1] ?? 0) + (wArr[idx - 1] ?? 0); }
          if (gx < gSize - 1 && (wArr[idx + 1] ?? 0) > 0.005) { hasWetNeighbor = true; neighborWaterY = (hArr[idx + 1] ?? 0) + (wArr[idx + 1] ?? 0); }
          if (gz > 0 && (wArr[idx - gSize] ?? 0) > 0.005) { hasWetNeighbor = true; neighborWaterY = (hArr[idx - gSize] ?? 0) + (wArr[idx - gSize] ?? 0); }
          if (gz < gSize - 1 && (wArr[idx + gSize] ?? 0) > 0.005) { hasWetNeighbor = true; neighborWaterY = (hArr[idx + gSize] ?? 0) + (wArr[idx + gSize] ?? 0); }

          if (hasWetNeighbor) {
            // Shoreline edge vertex: snap flush to ground level
            pos.setY(vIdx, Math.min(h, neighborWaterY));
          } else {
            // Dry interior cell: sink below ground
            pos.setY(vIdx, h - 2);
          }
        }
      }
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }

  updateGeometry(heights, waterHeights, gridSize, pitch);

  let t = 0;
  function update(dt: number): void {
    t += dt;
    normalMap.offset.set(t * 0.02 + Math.sin(t * 0.04) * 0.02, t * 0.015);
  }

  return { mesh, updateGeometry, update };
}

/** Shared water material for region ADT water tiles. */
export function createRegionWaterMaterial(): THREE.MeshLambertMaterial {
  const normalMap = tiledTexture("/assets/textures/water/water_normal.jpg");
  normalMap.repeat.set(16, 16);
  const mat = new THREE.MeshLambertMaterial({
    color: 0x3b9bc9,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    side: THREE.DoubleSide,
    normalMap,
    normalScale: new THREE.Vector2(0.4, 0.4),
  });
  mat.userData.waterNormalMap = normalMap;
  return mat;
}

function waterSurfaceY(
  hArr: ArrayLike<number>,
  wArr: ArrayLike<number>,
  gridSize: number,
  gx: number,
  gz: number,
): number {
  const idx = gz * gridSize + gx;
  const h = hArr[idx] ?? 0;
  const w = wArr[idx] ?? 0;

  if (w > 0.005) {
    let waterY = h + w;
    let maxWallH = h;
    if (gx > 0) maxWallH = Math.max(maxWallH, hArr[idx - 1] ?? 0);
    if (gx < gridSize - 1) maxWallH = Math.max(maxWallH, hArr[idx + 1] ?? 0);
    if (gz > 0) maxWallH = Math.max(maxWallH, hArr[idx - gridSize] ?? 0);
    if (gz < gridSize - 1) maxWallH = Math.max(maxWallH, hArr[idx + gridSize] ?? 0);
    if (maxWallH > waterY) waterY += Math.min(0.25, (maxWallH - waterY) * 0.22);
    return waterY;
  }

  let hasWetNeighbor = false;
  let neighborWaterY = h;
  if (gx > 0 && (wArr[idx - 1] ?? 0) > 0.005) {
    hasWetNeighbor = true;
    neighborWaterY = (hArr[idx - 1] ?? 0) + (wArr[idx - 1] ?? 0);
  }
  if (gx < gridSize - 1 && (wArr[idx + 1] ?? 0) > 0.005) {
    hasWetNeighbor = true;
    neighborWaterY = (hArr[idx + 1] ?? 0) + (wArr[idx + 1] ?? 0);
  }
  if (gz > 0 && (wArr[idx - gridSize] ?? 0) > 0.005) {
    hasWetNeighbor = true;
    neighborWaterY = (hArr[idx - gridSize] ?? 0) + (wArr[idx - gridSize] ?? 0);
  }
  if (gz < gridSize - 1 && (wArr[idx + gridSize] ?? 0) > 0.005) {
    hasWetNeighbor = true;
    neighborWaterY = (hArr[idx + gridSize] ?? 0) + (wArr[idx + gridSize] ?? 0);
  }
  if (hasWetNeighbor) return Math.min(h, neighborWaterY);
  return h - 2;
}

/**
 * One ADT tile of region painted water. Returns null if the tile has no wet cells
 * (and no shoreline) — keeps dry land free of water meshes.
 */
export function buildRegionAdtWaterTile(
  blueprint: Pick<RegionBlueprint, "gridSize" | "pitch" | "heights"> & { waterHeights: number[] },
  ix: number,
  iz: number,
  material: THREE.MeshLambertMaterial,
): THREE.Mesh | null {
  const { gridSize, pitch, heights, waterHeights } = blueprint;
  const half = ((gridSize - 1) * pitch) / 2;
  const tile = adtWorldBounds(ix, iz);

  const minX = Math.max(tile.minX, -half);
  const maxX = Math.min(tile.maxX, half);
  const minZ = Math.max(tile.minZ, -half);
  const maxZ = Math.min(tile.maxZ, half);
  if (minX >= maxX - 1e-6 || minZ >= maxZ - 1e-6) return null;

  const spanX = adtGridSpan(minX, maxX, half, pitch, gridSize);
  const spanZ = adtGridSpan(minZ, maxZ, half, pitch, gridSize);
  if (!spanX || !spanZ) return null;
  const gx0 = spanX.g0;
  const gx1 = spanX.g1;
  const gz0 = spanZ.g0;
  const gz1 = spanZ.g1;
  const segsX = gx1 - gx0;
  const segsZ = gz1 - gz0;
  if (segsX < 1 || segsZ < 1) return null;

  let anyWet = false;
  for (let gz = gz0; gz <= gz1 && !anyWet; gz++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      if ((waterHeights[gz * gridSize + gx] ?? 0) > 0.005) {
        anyWet = true;
        break;
      }
    }
  }
  if (!anyWet) return null;

  const sizeX = segsX * pitch;
  const sizeZ = segsZ * pitch;
  const centerX = -half + gx0 * pitch + sizeX / 2;
  const centerZ = -half + gz0 * pitch + sizeZ / 2;

  const geo = new THREE.PlaneGeometry(sizeX, sizeZ, segsX, segsZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(centerX, 0, centerZ);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  // PlaneGeometry verts are row-major matching segs; map back to grid indices.
  for (let row = 0; row <= segsZ; row++) {
    for (let col = 0; col <= segsX; col++) {
      const vIdx = row * (segsX + 1) + col;
      const gx = gx0 + col;
      const gz = gz0 + row;
      pos.setY(vIdx, waterSurfaceY(heights, waterHeights, gridSize, gx, gz));
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = `region-water-adt:${adtKey(ix, iz)}`;
  mesh.receiveShadow = true;
  mesh.userData.adtIx = ix;
  mesh.userData.adtIz = iz;
  return mesh;
}
