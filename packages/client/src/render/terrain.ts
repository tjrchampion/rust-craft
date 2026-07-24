import * as THREE from "three";
import {
  terrainHeight, terrainSlope, biomeAt, generatePaths, distPointToSegment, ZONE_SIZE, WATER_LEVEL,
  sampleRegionHeight, regionSlopeAt, type RegionBlueprint, type RegionBiome, type RegionRoad,
} from "@rustcraft/shared";

const RESOLUTION = 200; // vertices per side
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

/** Shared body behind `buildTerrain()`/`buildRegionTerrain()` — a heightmapped,
 *  biome-textured plane centered at `(centerX, centerZ)`. */
function buildTerrainMesh(centerX: number, centerZ: number, sizeX: number, sizeZ: number): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(sizeX, sizeZ, RESOLUTION, RESOLUTION);
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

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  applyGroundBlendShader(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

export function buildTerrain(): THREE.Mesh {
  const mesh = buildTerrainMesh(0, 0, ZONE_SIZE, ZONE_SIZE);
  mesh.name = "terrain";
  return mesh;
}

/** Ashenpeak (region 2) + the valley connecting it — built lazily, once the
 *  player approaches, so it costs nothing until then. */
export function buildRegionTerrain(centerX: number, centerZ: number, sizeX: number, sizeZ: number): THREE.Mesh {
  const mesh = buildTerrainMesh(centerX, centerZ, sizeX, sizeZ);
  mesh.name = "terrain-region-two";
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

export interface WaterField {
  mesh: THREE.Mesh;
  update(dt: number): void;
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


