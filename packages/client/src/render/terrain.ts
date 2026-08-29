import * as THREE from "three";
import {
  terrainHeight, terrainSlope, biomeAt, generatePaths, distPointToSegment, ZONE_SIZE, WATER_LEVEL,
  adtKey, adtWorldBounds,
  sampleRegionHeight, regionSlopeAt, sampleRegionWaterDepth,
  type RegionBlueprint, type RegionBiome, type RegionRoad,
} from "@rustcraft/shared";
import {
  adtTileSpan,
  computeAdtTileAttributes,
  type AdtLiteBlueprint,
  type AdtTileGeometryData,
  type AdtTileSpan,
} from "./adtTileGeometry";
import type { AdtGeometryPool } from "./adtGeometryPool";

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

function tiledColorTexture(url: string): THREE.Texture {
  const tex = textureLoader.load(url);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function tiledDataTexture(url: string): THREE.Texture {
  const tex = textureLoader.load(url);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Photo-sourced authentic PBR ground textures (ambientCG, CC0), blended per-vertex. */
export const GROUND_TEXTURES = {
  grass: tiledColorTexture("/assets/textures/terrain/Grass001_Color.jpg"),
  grassN: tiledDataTexture("/assets/textures/terrain/Grass001_NormalGL.jpg"),
  dirt: tiledColorTexture("/assets/textures/terrain/Ground023_Color.jpg"),
  dirtN: tiledDataTexture("/assets/textures/terrain/Ground023_NormalGL.jpg"),
  rock: tiledColorTexture("/assets/textures/terrain/Rock026_Color.jpg"),
  rockN: tiledDataTexture("/assets/textures/terrain/Rock026_NormalGL.jpg"),
  sand: tiledColorTexture("/assets/textures/terrain/Ground080_Color.jpg"),
  sandN: tiledDataTexture("/assets/textures/terrain/Ground080_NormalGL.jpg"),
  snow: tiledColorTexture("/assets/textures/terrain/Snow010A_Color.jpg"),
  snowN: tiledDataTexture("/assets/textures/terrain/Snow010A_NormalGL.jpg"),
  cobble: tiledColorTexture("/assets/textures/terrain/PavingStones046_Color.jpg"),
  cobbleN: tiledDataTexture("/assets/textures/terrain/PavingStones046_NormalGL.jpg"),
  mud: tiledColorTexture("/assets/textures/terrain/Ground071_Color.jpg"),
  mudN: tiledDataTexture("/assets/textures/terrain/Ground071_NormalGL.jpg"),
  lava: tiledColorTexture("/assets/textures/terrain/Lava004_Color.jpg"),
  lavaN: tiledDataTexture("/assets/textures/terrain/Lava004_NormalGL.jpg"),
  gravel: tiledColorTexture("/assets/textures/terrain/Gravel024_Color.jpg"),
  gravelN: tiledDataTexture("/assets/textures/terrain/Gravel024_NormalGL.jpg"),
  groundAO: tiledDataTexture("/assets/textures/terrain/GroundAO_Packed.png"),
};

/** Injects an 8-way PBR texture blend with normal mapping & cavity AO into the standard Lambert shader. */
/** Injects a 9-way PBR texture blend with cavity AO and macro modulation into the standard Lambert shader. */
export function applyGroundBlendShader(mat: THREE.MeshLambertMaterial): void {
  mat.customProgramCacheKey = () => "groundBlend_pbr_v4";
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tGrass = { value: GROUND_TEXTURES.grass };
    shader.uniforms.tRock = { value: GROUND_TEXTURES.rock };
    shader.uniforms.tSand = { value: GROUND_TEXTURES.sand };
    shader.uniforms.tSnow = { value: GROUND_TEXTURES.snow };
    shader.uniforms.tDirt = { value: GROUND_TEXTURES.dirt };
    shader.uniforms.tCobble = { value: GROUND_TEXTURES.cobble };
    shader.uniforms.tMud = { value: GROUND_TEXTURES.mud };
    shader.uniforms.tLava = { value: GROUND_TEXTURES.lava };
    shader.uniforms.tGravel = { value: GROUND_TEXTURES.gravel };
    shader.uniforms.tGroundAO = { value: GROUND_TEXTURES.groundAO };
    shader.uniforms.uTiling = { value: TERRAIN_TILING };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute vec4 weightsA;
        attribute vec4 weightsB;
        attribute float weightsC;
        attribute vec2 terrainUv;
        varying vec4 vWeightsA;
        varying vec4 vWeightsB;
        varying float vWeightsC;
        varying vec2 vTerrainUv;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vWeightsA = weightsA;
        vWeightsB = weightsB;
        vWeightsC = weightsC;
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
        uniform sampler2D tMud;
        uniform sampler2D tLava;
        uniform sampler2D tGravel;
        uniform sampler2D tGroundAO;
        uniform float uTiling;
        varying vec4 vWeightsA;
        varying vec4 vWeightsB;
        varying float vWeightsC;
        varying vec2 vTerrainUv;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec2 tuv = vTerrainUv * uTiling;
        vec2 tuvMacro = vTerrainUv * (uTiling * 0.12);

        vec3 cGrass  = texture2D(tGrass,  tuv).rgb;
        vec3 cRock   = texture2D(tRock,   tuv).rgb;
        vec3 cSand   = texture2D(tSand,   tuv).rgb;
        vec3 cSnow   = texture2D(tSnow,   tuv).rgb;
        vec3 cDirt   = texture2D(tDirt,   tuv).rgb;
        vec3 cCobble = texture2D(tCobble, tuv).rgb;
        vec3 cMud    = texture2D(tMud,    tuv).rgb;
        vec3 cLava   = texture2D(tLava,   tuv).rgb;
        vec3 cGravel = texture2D(tGravel, tuv).rgb;

        vec4 aoSample = texture2D(tGroundAO, tuv);
        vec4 macroSample = texture2D(tGroundAO, tuvMacro);

        // Break up straight linear vertex weight interpolation across quad edges using macro/micro noise:
        float blendJitter = (macroSample.r - 0.5) * 0.32 + (aoSample.g - 0.5) * 0.16;

        vec4 wA = vWeightsA;
        vec4 wB = vWeightsB;
        float wC = vWeightsC;

        // Zero out trace weights (<0.015) so unpainted/dry surfaces stay 100% pure without sand bleeding into grass:
        if (wA.x < 0.015) wA.x = 0.0;
        if (wA.y < 0.015) wA.y = 0.0;
        if (wA.z < 0.015) wA.z = 0.0;
        if (wA.w < 0.015) wA.w = 0.0;
        if (wB.x < 0.015) wB.x = 0.0;
        if (wB.y < 0.015) wB.y = 0.0;
        if (wB.z < 0.015) wB.z = 0.0;
        if (wB.w < 0.015) wB.w = 0.0;
        if (wC < 0.015) wC = 0.0;

        // Texture height profile for organic height-blended transitions:
        if (wA.x > 0.0) wA.x *= max(0.01, (dot(cGrass, vec3(0.299, 0.587, 0.114)) * 0.6 + 0.4) + blendJitter);
        if (wA.y > 0.0) wA.y *= max(0.01, (dot(cRock, vec3(0.299, 0.587, 0.114)) * 0.6 + 0.4) + blendJitter * 0.5);
        if (wA.z > 0.0) wA.z *= max(0.01, (dot(cSand, vec3(0.299, 0.587, 0.114)) * 0.6 + 0.4) - blendJitter);
        if (wA.w > 0.0) wA.w *= max(0.01, (dot(cSnow, vec3(0.299, 0.587, 0.114)) * 0.6 + 0.4) + blendJitter);
        if (wB.x > 0.0) wB.x *= max(0.01, (dot(cDirt, vec3(0.299, 0.587, 0.114)) * 0.6 + 0.4) - blendJitter);
        if (wB.y > 0.0) wB.y *= max(0.01, (dot(cCobble, vec3(0.299, 0.587, 0.114)) * 0.6 + 0.4));
        if (wB.z > 0.0) wB.z *= max(0.01, (dot(cMud, vec3(0.299, 0.587, 0.114)) * 0.6 + 0.4) - blendJitter);
        if (wB.w > 0.0) wB.w *= max(0.01, (dot(cLava, vec3(0.299, 0.587, 0.114)) * 0.6 + 0.4));
        if (wC > 0.0)   wC   *= max(0.01, (dot(cGravel, vec3(0.299, 0.587, 0.114)) * 0.6 + 0.4));

        float totalW = wA.x + wA.y + wA.z + wA.w + wB.x + wB.y + wB.z + wB.w + wC;
        if (totalW > 0.0001) {
          wA /= totalW;
          wB /= totalW;
          wC /= totalW;
        }

        vec3 groundColor =
          cGrass  * wA.x +
          cRock   * wA.y +
          cSand   * wA.z +
          cSnow   * wA.w +
          cDirt   * wB.x +
          cCobble * wB.y +
          cMud    * wB.z +
          cLava   * wB.w +
          cGravel * wC;

        float ao = 
          aoSample.r * wA.x +
          aoSample.b * wA.y +
          aoSample.a * wA.z +
          1.0        * wA.w +
          aoSample.g * wB.x +
          aoSample.b * wB.y +
          aoSample.g * wB.z +
          0.95       * wB.w +
          aoSample.b * wC;
        ao = clamp(ao, 0.45, 1.0);

        float macroMod = mix(0.92, 1.08, (macroSample.r + macroSample.g) * 0.5);
        groundColor *= macroMod;

        diffuseColor.rgb = groundColor * ao * mix(vec3(1.0), vColor.rgb, 0.52);`,
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
  // weightsA = [grass, rock, sand, snow], weightsB = [dirt, cobble, mud, lava]
  const weightsA = new Float32Array(pos.count * 4);
  const weightsB = new Float32Array(pos.count * 4);
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
    } else if (y < WATER_LEVEL + 1.3) {
      const isSubmerged = y <= WATER_LEVEL;
      const sandShore = isSubmerged ? 1.0 : clampNum((WATER_LEVEL + 1.3 - y) / 1.1, 0, 1);
      wSand = sandShore;
      wGrass = 1 - sandShore;
    } else if (slope > 0.85 || y > 55) {
      if (y > 75) wSnow = 1;
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
      if (biome === "mountain" && slope > 0.65) {
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
    weightsA[i * 4 + 0] = wGrass / sum;
    weightsA[i * 4 + 1] = wRock / sum;
    weightsA[i * 4 + 2] = wSand / sum;
    weightsA[i * 4 + 3] = wSnow / sum;
    weightsB[i * 4 + 0] = wDirt / sum;
    weightsB[i * 4 + 1] = 0;
    weightsB[i * 4 + 2] = 0;
    weightsB[i * 4 + 3] = 0;

    tints[i * 3] = tint.r;
    tints[i * 3 + 1] = tint.g;
    tints[i * 3 + 2] = tint.b;
  }

  const weightsC = new Float32Array(pos.count);
  geo.setAttribute("color", new THREE.BufferAttribute(tints, 3));
  geo.setAttribute("weightsA", new THREE.BufferAttribute(weightsA, 4));
  geo.setAttribute("weightsB", new THREE.BufferAttribute(weightsB, 4));
  geo.setAttribute("weightsC", new THREE.BufferAttribute(weightsC, 1));
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

export interface RegionGroundWeights {
  wGrass: number;
  wRock: number;
  wSand: number;
  wSnow: number;
  wDirt: number;
  wCobble: number;
  wMud: number;
  wLava: number;
  wGravel: number;
  tint: THREE.Color;
}

/** Ground texture weights (grass/rock/sand/snow/dirt/cobble/mud/lava/gravel) + tint for a single
 *  region-editor vertex, given its own biome, height, local slope, an
 *  optional 0-1 road blend (see regionRoadBlendAt), an optional
 *  author-chosen groundTint override (RegionColorGrading.groundTint), and an
 *  optional custom painted texture ID:
 *  0=auto, 1=grass, 2=dirt, 3=cobble, 4=snow, 5=rock, 6=sand, 7=mud, 8=lava, 9=gravel. */
export function regionGroundWeights(
  biome: RegionBiome,
  y: number,
  slope: number,
  roadBlend = 0,
  groundTint?: string,
  customTex = 0,
  waterDepth = 0,
  edgeDist = Infinity,
  neighborGroundTint?: string,
): RegionGroundWeights {
  let wGrass = 0;
  let wRock = 0;
  let wSand = 0;
  let wSnow = 0;
  let wDirt = 0;
  let wCobble = 0;
  let wMud = 0;
  let wLava = 0;
  let wGravel = 0;
  const tint = groundTint ? new THREE.Color(groundTint) : REGION_GRASS_TINTS[biome].clone();

  // Smooth seamless border blending toward adjacent neighbor color if provided
  if (neighborGroundTint) {
    const edgeBlendDist = 32.0;
    const edgeFactor = clampNum(edgeDist / edgeBlendDist, 0, 1);
    const smoothEdge = edgeFactor * edgeFactor * (3 - 2 * edgeFactor);
    if (smoothEdge < 1.0) {
      const targetColor = new THREE.Color(neighborGroundTint);
      tint.lerp(targetColor, 1 - smoothEdge);
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
        wMud *= 1 - sandShore * 0.5;
        wGrass *= 1 - sandShore;
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
      tint.lerp(WHITE, roadBlend);
    }
  }

  const sum = wGrass + wRock + wSand + wSnow + wDirt + wCobble + wMud + wLava + wGravel || 1;
  return {
    wGrass: wGrass / sum,
    wRock: wRock / sum,
    wSand: wSand / sum,
    wSnow: wSnow / sum,
    wDirt: wDirt / sum,
    wCobble: wCobble / sum,
    wMud: wMud / sum,
    wLava: wLava / sum,
    wGravel: wGravel / sum,
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
    const pts = road.points;
    if (pts.length < 2) continue;
    const halfWidth = road.width / 2;
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      if (!p1 || !p2) continue;
      const d = distPointToSegment(x, z, p1.x, p1.z, p2.x, p2.z);
      if (d < minDist) minDist = d;
      if (minDist <= halfWidth) break;
    }
    let blend = 0;
    if (minDist <= halfWidth) blend = 1.0;
    else if (minDist < halfWidth + 1.8) {
      blend = 1.0 - (minDist - halfWidth) / 1.8;
    }
    if (blend > best) best = blend;
  }
  return best;
}

/** Full-region mesh built synchronously from a RegionBlueprint -- used by the
 *  in-game RegionViewer / RegionTransition overlay for previewing and
 *  visiting regions. Height sampling uses the exact same bilinear
 *  interpolation as the client heightmap for pixel-perfect physics
 *  correspondence, and reuses the exact same ground-blend shader the open
 *  world's terrain uses instead of a single flat material color. */
export function buildRegionBlueprintTerrain(
  blueprint: Pick<RegionBlueprint, "gridSize" | "pitch" | "heights" | "biome" | "roads" | "colorGrading" | "customTextures"> & { gridSizeX?: number; gridSizeZ?: number },
): THREE.Mesh {
  const gx = blueprint.gridSizeX ?? blueprint.gridSize;
  const gz = blueprint.gridSizeZ ?? blueprint.gridSize;
  const spanX = (gx - 1) * blueprint.pitch;
  const spanZ = (gz - 1) * blueprint.pitch;
  const geo = new THREE.PlaneGeometry(spanX, spanZ, gx - 1, gz - 1);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  const terrainUv = (geo.attributes.uv as THREE.BufferAttribute).array as Float32Array;
  const tints = new Float32Array(pos.count * 3);
  const weightsA = new Float32Array(pos.count * 4);
  const weightsB = new Float32Array(pos.count * 4);
  const weightsC = new Float32Array(pos.count);
  const roads = blueprint.roads ?? [];
  const groundTint = blueprint.colorGrading.groundTint;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = sampleRegionHeight(blueprint, x, z);
    pos.setY(i, y);

    terrainUv[i * 2] = (x + spanX / 2) / Math.max(1, spanX);
    terrainUv[i * 2 + 1] = (z + spanZ / 2) / Math.max(1, spanZ);

    const slope = regionSlopeAt(blueprint, x, z);
    const roadBlend = regionRoadBlendAt(roads, x, z);
    const customTex = sampleRegionCustomTexture(blueprint, x, z);
    const waterDepth = sampleRegionWaterDepth(blueprint, x, z);
    const distX = spanX / 2 - Math.abs(x);
    const distZ = spanZ / 2 - Math.abs(z);
    const edgeDist = Math.min(distX, distZ);
    const w = regionGroundWeights(blueprint.biome, y, slope, roadBlend, groundTint, customTex, waterDepth, edgeDist);
    weightsA[i * 4 + 0] = w.wGrass;
    weightsA[i * 4 + 1] = w.wRock;
    weightsA[i * 4 + 2] = w.wSand;
    weightsA[i * 4 + 3] = w.wSnow;
    weightsB[i * 4 + 0] = w.wDirt;
    weightsB[i * 4 + 1] = w.wCobble;
    weightsB[i * 4 + 2] = w.wMud;
    weightsB[i * 4 + 3] = w.wLava;
    weightsC[i] = w.wGravel;
    tints[i * 3] = w.tint.r;
    tints[i * 3 + 1] = w.tint.g;
    tints[i * 3 + 2] = w.tint.b;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(tints, 3));
  geo.setAttribute("weightsA", new THREE.BufferAttribute(weightsA, 4));
  geo.setAttribute("weightsB", new THREE.BufferAttribute(weightsB, 4));
  geo.setAttribute("weightsC", new THREE.BufferAttribute(weightsC, 1));
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
  const weightsA = new Float32Array(pos.count * 4);
  const weightsB = new Float32Array(pos.count * 4);
  const weightsC = new Float32Array(pos.count);
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
      const waterDepth = sampleRegionWaterDepth(blueprint, x, z);
      const distX = span / 2 - Math.abs(x);
      const distZ = span / 2 - Math.abs(z);
      const edgeDist = Math.min(distX, distZ);
      const w = regionGroundWeights(blueprint.biome, y, slope, roadBlend, groundTint, customTex, waterDepth, edgeDist);
      weightsA[i * 4 + 0] = w.wGrass;
      weightsA[i * 4 + 1] = w.wRock;
      weightsA[i * 4 + 2] = w.wSand;
      weightsA[i * 4 + 3] = w.wSnow;
      weightsB[i * 4 + 0] = w.wDirt;
      weightsB[i * 4 + 1] = w.wCobble;
      weightsB[i * 4 + 2] = w.wMud;
      weightsB[i * 4 + 3] = w.wLava;
      weightsC[i] = w.wGravel;
      tints[i * 3] = w.tint.r;
      tints[i * 3 + 1] = w.tint.g;
      tints[i * 3 + 2] = w.tint.b;
    }
  }

  geo.setAttribute("color", new THREE.BufferAttribute(tints, 3));
  geo.setAttribute("weightsA", new THREE.BufferAttribute(weightsA, 4));
  geo.setAttribute("weightsB", new THREE.BufferAttribute(weightsB, 4));
  geo.setAttribute("weightsC", new THREE.BufferAttribute(weightsC, 1));
  geo.setAttribute("terrainUv", new THREE.BufferAttribute(terrainUv, 2));
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));

  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.name = `region-adt:${adtKey(ix, iz)}`;
  mesh.userData.adtIx = ix;
  mesh.userData.adtIz = iz;
  return mesh;
}

// ---- Worker-driven ADT tile pipeline ---------------------------------------
//
// The heavy per-vertex sampling now lives in adtTileGeometry.ts (worker-safe).
// The main thread only builds the cheap PlaneGeometry skeleton (which owns the
// correct x/z + index winding) and wraps the worker's returned typed arrays.

/** Extract the minimal, worker-transferable slice of a region blueprint. */
export function toAdtLiteBlueprint(
  bp: Pick<RegionBlueprint, "gridSize" | "pitch" | "heights" | "biome" | "roads" | "colorGrading" | "customTextures" | "waterHeights"> & { gridSizeX?: number; gridSizeZ?: number },
): AdtLiteBlueprint {
  return {
    gridSize: bp.gridSize,
    gridSizeX: bp.gridSizeX,
    gridSizeZ: bp.gridSizeZ,
    pitch: bp.pitch,
    // Float32Array copy so it clones cheaply into workers.
    heights: bp.heights instanceof Float32Array ? bp.heights : Float32Array.from(bp.heights as number[]),
    biome: bp.biome,
    roads: bp.roads ?? [],
    groundTint: bp.colorGrading?.groundTint,
    customTextures: bp.customTextures ? Float32Array.from(bp.customTextures) : undefined,
    waterHeights: bp.waterHeights ? Float32Array.from(bp.waterHeights) : undefined,
  };
}

/** Build the flat PlaneGeometry skeleton for one ADT tile (positions x/z +
 *  index only; y is 0). Cheap — no sampling. Returns null for empty tiles.
 *  When a pool is supplied the skeleton is recycled instead of allocated. */
export function buildAdtTileSkeleton(
  bp: Pick<RegionBlueprint, "gridSize" | "pitch"> & { gridSizeX?: number; gridSizeZ?: number },
  ix: number,
  iz: number,
  pool?: AdtGeometryPool,
): { geo: THREE.PlaneGeometry; span: AdtTileSpan } | null {
  const span = adtTileSpan(bp.gridSize, bp.pitch, ix, iz, bp.gridSizeX, bp.gridSizeZ);
  if (!span) return null;
  if (pool) return { geo: pool.acquire(span), span };
  const geo = new THREE.PlaneGeometry(span.sizeX, span.sizeZ, span.segsX, span.segsZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(span.centerX, 0, span.centerZ);
  return { geo, span };
}

/** Write a Float32 attribute into `geo`, reusing the existing BufferAttribute's
 *  array in place when the geometry came from the pool (same vertex count).
 *  Reusing the attribute keeps its GL buffer, so a pooled tile re-uploads via
 *  bufferSubData instead of allocating a new buffer -- and, unlike a fresh
 *  setAttribute(), it never orphans the previous attribute's GL buffer (which
 *  the sync-replace path used to leak one-per-tile for `normal`). */
function writeGeoAttribute(
  geo: THREE.BufferGeometry,
  name: string,
  arr: Float32Array,
  itemSize: number,
): void {
  const existing = geo.getAttribute(name) as THREE.BufferAttribute | undefined;
  if (existing && (existing.array as Float32Array).length === arr.length) {
    (existing.array as Float32Array).set(arr);
    existing.needsUpdate = true;
  } else {
    geo.setAttribute(name, new THREE.BufferAttribute(arr, itemSize));
  }
}

/** Wrap a worker's computed attributes into a finished terrain mesh. Cheap:
 *  writes Y into the skeleton and fills the transferred typed arrays. When
 *  `geo` was recycled from the pool this reuses every attribute buffer in
 *  place; a fresh geometry allocates the custom attributes on first use. */
export function assembleAdtTileMesh(
  geo: THREE.PlaneGeometry,
  data: AdtTileGeometryData,
  material: THREE.MeshLambertMaterial,
): THREE.Mesh {
  const posAttr = geo.attributes.position as THREE.BufferAttribute;
  const posArr = posAttr.array as Float32Array;
  const ys = data.ys;
  for (let i = 0; i < ys.length; i++) posArr[i * 3 + 1] = ys[i]!;
  posAttr.needsUpdate = true;
  writeGeoAttribute(geo, "color", data.colors, 3);
  writeGeoAttribute(geo, "weightsA", data.weightsA, 4);
  writeGeoAttribute(geo, "weightsB", data.weightsB, 4);
  writeGeoAttribute(geo, "weightsC", data.weightsC, 1);
  writeGeoAttribute(geo, "terrainUv", data.terrainUv, 2);
  writeGeoAttribute(geo, "normal", data.normals, 3);
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.name = `region-adt:${adtKey(data.ix, data.iz)}`;
  mesh.userData.adtIx = data.ix;
  mesh.userData.adtIz = data.iz;
  return mesh;
}

/** Synchronous main-thread build (fallback / underfoot-urgent) via the same
 *  math the worker runs — one source of truth, no visual drift. */
export function buildRegionAdtTileSync(
  lite: AdtLiteBlueprint,
  ix: number,
  iz: number,
  material: THREE.MeshLambertMaterial,
  pool?: AdtGeometryPool,
): THREE.Mesh | null {
  const skel = buildAdtTileSkeleton(lite, ix, iz, pool);
  if (!skel) return null;
  const positions = (skel.geo.attributes.position!.array as Float32Array).slice();
  const data = computeAdtTileAttributes(lite, skel.span, positions);
  return assembleAdtTileMesh(skel.geo, data, material);
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
  const normalMap = tiledDataTexture("/assets/textures/water/waternormals.jpg");
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
  updateGeometry(heights: ArrayLike<number>, waterHeights: ArrayLike<number>, gridSize: number, pitch: number, gridSizeZ?: number): void;
  update(dt: number): void;
}

export function buildRegionWaterMesh(
  gridSize: number,
  pitch: number,
  heights: ArrayLike<number>,
  waterHeights: ArrayLike<number>,
  gridSizeZ?: number,
): RegionWaterMeshField {
  const gSizeX = gridSize;
  const gSizeZ = gridSizeZ ?? gridSize;
  const spanX = (gSizeX - 1) * pitch;
  const spanZ = (gSizeZ - 1) * pitch;
  const geo = new THREE.PlaneGeometry(spanX, spanZ, gSizeX - 1, gSizeZ - 1);
  geo.rotateX(-Math.PI / 2);

  const count = (geo.attributes.position as THREE.BufferAttribute).count;
  geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute("waterDepth", new THREE.BufferAttribute(new Float32Array(count), 1));

  const normalMap = tiledDataTexture("/assets/textures/water/waternormals.jpg");
  normalMap.repeat.set(16, 16);

  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    side: THREE.DoubleSide,
    normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "region-water";
  mesh.receiveShadow = true;

  function updateGeometry(hArr: ArrayLike<number>, wArr: ArrayLike<number>, gSize: number, pPitch: number, pGSizeZ?: number): void {
    const sizeX = gSize;
    const sizeZ = pGSizeZ ?? gSize;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colorAttr = geo.attributes.color as THREE.BufferAttribute;
    const depthAttr = geo.attributes.waterDepth as THREE.BufferAttribute;
    const shallowR = 0.62, shallowG = 0.95, shallowB = 1.0;
    const deepR = 0.03, deepG = 0.12, deepB = 0.24;

    for (let gz = 0; gz < sizeZ; gz++) {
      for (let gx = 0; gx < sizeX; gx++) {
        const idx = gz * sizeX + gx;
        const rawH = hArr[idx];
        const rawW = wArr[idx];
        const h = Number.isFinite(rawH) ? (rawH as number) : 0;
        const w = Number.isFinite(rawW) ? (rawW as number) : 0;
        const vIdx = gz * sizeX + gx;

        const realDepth = h <= 0 ? Math.max(0.0, -h) : w;
        depthAttr.setX(vIdx, realDepth);

        const depthFactor = Math.min(1.0, Math.max(0.0, realDepth / 2.5));
        const t = Math.pow(depthFactor, 0.6);

        colorAttr.setXYZ(
          vIdx,
          shallowR + (deepR - shallowR) * t,
          shallowG + (deepG - shallowG) * t,
          shallowB + (deepB - shallowB) * t,
        );

        if (w > 0.005) {
          let waterY = h + w;

          // Wall-clinging meniscus effect:
          let maxWallH = h;
          if (gx > 0) { const nh = hArr[idx - 1]; if (Number.isFinite(nh)) maxWallH = Math.max(maxWallH, nh as number); }
          if (gx < sizeX - 1) { const nh = hArr[idx + 1]; if (Number.isFinite(nh)) maxWallH = Math.max(maxWallH, nh as number); }
          if (gz > 0) { const nh = hArr[idx - sizeX]; if (Number.isFinite(nh)) maxWallH = Math.max(maxWallH, nh as number); }
          if (gz < sizeZ - 1) { const nh = hArr[idx + sizeX]; if (Number.isFinite(nh)) maxWallH = Math.max(maxWallH, nh as number); }

          if (maxWallH > waterY) {
            const clingLift = Math.min(0.25, (maxWallH - waterY) * 0.22);
            waterY += clingLift;
          }

          pos.setY(vIdx, Number.isFinite(waterY) ? waterY : 0);
        } else {
          let hasWetNeighbor = false;
          let neighborWaterY = h;
          if (gx > 0 && ((wArr[idx - 1] as number) ?? 0) > 0.005) { hasWetNeighbor = true; neighborWaterY = ((hArr[idx - 1] as number) ?? 0) + ((wArr[idx - 1] as number) ?? 0); }
          if (gx < sizeX - 1 && ((wArr[idx + 1] as number) ?? 0) > 0.005) { hasWetNeighbor = true; neighborWaterY = ((hArr[idx + 1] as number) ?? 0) + ((wArr[idx + 1] as number) ?? 0); }
          if (gz > 0 && ((wArr[idx - sizeX] as number) ?? 0) > 0.005) { hasWetNeighbor = true; neighborWaterY = ((hArr[idx - sizeX] as number) ?? 0) + ((wArr[idx - sizeX] as number) ?? 0); }
          if (gz < sizeZ - 1 && ((wArr[idx + sizeX] as number) ?? 0) > 0.005) { hasWetNeighbor = true; neighborWaterY = ((hArr[idx + sizeX] as number) ?? 0) + ((wArr[idx + sizeX] as number) ?? 0); }

          if (hasWetNeighbor) {
            pos.setY(vIdx, Number.isFinite(neighborWaterY) ? Math.min(h, neighborWaterY) : h);
          } else {
            pos.setY(vIdx, h - 2);
          }
        }
      }
    }
    pos.needsUpdate = true;
    colorAttr.needsUpdate = true;
    depthAttr.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
  }

  updateGeometry(heights, waterHeights, gSizeX, pitch, gSizeZ);

  let t = 0;
  function update(dt: number): void {
    t += dt;
    const m = mesh.material as THREE.MeshLambertMaterial;
    if (m.userData.shader) {
      m.userData.shader.uniforms.uTime.value = t;
    }
    const norm = (m.userData.waterNormalMap as THREE.Texture | undefined) ?? m.normalMap;
    if (norm) {
      norm.offset.set(t * 0.03 + Math.sin(t * 0.05) * 0.015, t * 0.025);
    }
  }

  return { mesh, updateGeometry, update };
}

/** Shared water material for region ADT water tiles. */
export function createRegionWaterMaterial(): THREE.MeshLambertMaterial {
  const normalMap = tiledDataTexture("/assets/textures/water/waternormals.jpg");
  normalMap.repeat.set(16, 16);
  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
    side: THREE.DoubleSide,
    normalMap,
    normalScale: new THREE.Vector2(0.5, 0.5),
  });

  mat.userData.waterNormalMap = normalMap;

    // Custom GLSL shader injection for calm 3D vertex displacement, terrain-conforming edge foam, and shallow glow
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uFoamColor = { value: new THREE.Color(0xffffff) };

      mat.userData.shader = shader;

      shader.vertexShader = shader.vertexShader.replace(
        "#include <common>",
        `#include <common>
         attribute float waterDepth;
         varying vec3 vWorldPos;
         varying float vWaterDepth;
         uniform float uTime;`,
      ).replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vec4 wPos = modelMatrix * vec4(position, 1.0);
         vWorldPos = wPos.xyz;
         vWaterDepth = waterDepth;

         // Calm, gentle 3D GPU vertex displacement (subtle glassy swell: ~0.03m amplitude)
         float wave1 = sin(uTime * 1.5 + (wPos.x * 0.2 + wPos.z * 0.15)) * 0.035;
         float wave2 = cos(uTime * 2.1 - (wPos.x * 0.35 - wPos.z * 0.28)) * 0.020;
         float shoreWave = sin(uTime * 2.0 - waterDepth * 4.0) * 0.025 * clamp(waterDepth, 0.0, 1.5);

         float totalDisplacement = (wave1 + wave2 + shoreWave) * clamp(waterDepth * 0.4, 0.0, 1.0);
         transformed.y += totalDisplacement;`,
      );

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `#include <common>
         varying vec3 vWorldPos;
         varying float vWaterDepth;
         uniform float uTime;
         uniform vec3 uFoamColor;`,
      ).replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         // 1. Shallow Water Light Transmission Glow (making shallow water noticeably brighter cyan)
         float shallowGlow = 1.0 - smoothstep(0.0, 1.6, vWaterDepth);
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.64, 0.96, 1.0), shallowGlow * 0.38);

         // 2. Crisp Edge Foam line following the exact terrain contour (vWaterDepth < 0.45m)
         float edgeMask = 1.0 - smoothstep(0.0, 0.45, vWaterDepth);
         float shoreRipple = sin(uTime * 2.5 - vWaterDepth * 14.0);
         float crispEdgeFoam = smoothstep(0.1, 0.85, edgeMask * (0.85 + shoreRipple * 0.25));

         // 3. Micro-foam caustics texture pattern over shallow water
         float foamNoise = sin(vWorldPos.x * 2.5 + uTime * 1.5) * cos(vWorldPos.z * 2.5 - uTime * 1.2);
         float texturedFoam = smoothstep(0.5, 0.88, foamNoise * 0.5 + 0.5) * shallowGlow * 0.4;

         // Blend caustics into water color
         diffuseColor.rgb = mix(diffuseColor.rgb, uFoamColor, texturedFoam * 0.5);

         // Overlay the crisp white edge foam following terrain contours cleanly on top!
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), crispEdgeFoam * 0.95);
         diffuseColor.a = max(diffuseColor.a, crispEdgeFoam * 0.95);`,
      );
    };

  return mat;
}

/** How many grid cells the water sheet extends under the surrounding bank so
 *  its hard grid edge hides behind the opaque shore instead of showing a
 *  sawtooth waterline. See waterSurfaceY. */
const WATER_SKIRT_CELLS = 2;

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

  // Dry vertex: extend the water sheet a few cells UNDER the surrounding
  // terrain so its hard, grid-aligned boundary tucks behind the opaque shore /
  // cliff (which then occludes it) rather than ending in a visible 6m-grid
  // sawtooth right at the waterline. `Math.min(h, ...)` keeps the sheet below
  // the terrain everywhere, so widening the skirt never makes water poke up
  // onto land -- it just hides the seam. WATER_SKIRT_CELLS controls how far the
  // sheet reaches under the bank (2 ≈ ~12 m at pitch 6, enough to bury the seam
  // behind all but the shallowest banks).
  const SKIRT = WATER_SKIRT_CELLS;
  let nearestWaterY = 0;
  let nearestDist = Infinity;
  for (let dz = -SKIRT; dz <= SKIRT; dz++) {
    for (let dx = -SKIRT; dx <= SKIRT; dx++) {
      if (dx === 0 && dz === 0) continue;
      const ngx = gx + dx;
      const ngz = gz + dz;
      if (ngx < 0 || ngx >= gridSize || ngz < 0 || ngz >= gridSize) continue;
      const nIdx = ngz * gridSize + ngx;
      if ((wArr[nIdx] ?? 0) <= 0.005) continue;
      // Nearest wet cell wins (Chebyshev) so the surface tracks the closest
      // shoreline height; ties keep the first found.
      const d = Math.max(Math.abs(dx), Math.abs(dz));
      if (d < nearestDist) {
        nearestDist = d;
        nearestWaterY = (hArr[nIdx] ?? 0) + (wArr[nIdx] ?? 0);
      }
    }
  }
  if (nearestDist !== Infinity) return Math.min(h, nearestWaterY);
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
  const count = pos.count;
  const colorArr = new Float32Array(count * 3);
  const depthArr = new Float32Array(count);

  const shallowR = 0.55, shallowG = 0.93, shallowB = 0.98;
  const deepR = 0.04, deepG = 0.14, deepB = 0.26;

  // PlaneGeometry verts are row-major matching segs; map back to grid indices.
  for (let row = 0; row <= segsZ; row++) {
    for (let col = 0; col <= segsX; col++) {
      const vIdx = row * (segsX + 1) + col;
      const gx = gx0 + col;
      const gz = gz0 + row;
      const idx = gz * gridSize + gx;
      const h = heights[idx] ?? 0;
      const w = waterHeights[idx] ?? 0;

      const realDepth = h <= 0 ? Math.max(0.0, -h) : w;
      depthArr[vIdx] = realDepth;

      const depthFactor = Math.min(1.0, Math.max(0.0, realDepth / 2.5));
      const t = Math.pow(depthFactor, 0.5);

      colorArr[vIdx * 3] = shallowR + (deepR - shallowR) * t;
      colorArr[vIdx * 3 + 1] = shallowG + (deepG - shallowG) * t;
      colorArr[vIdx * 3 + 2] = shallowB + (deepB - shallowB) * t;

      pos.setY(vIdx, waterSurfaceY(heights, waterHeights, gridSize, gx, gz));
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colorArr, 3));
  geo.setAttribute("waterDepth", new THREE.BufferAttribute(depthArr, 1));
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = `region-water-adt:${adtKey(ix, iz)}`;
  mesh.receiveShadow = true;
  mesh.userData.adtIx = ix;
  mesh.userData.adtIz = iz;
  return mesh;
}
