import * as THREE from "three";
import { terrainHeight, terrainSlope, biomeAt, generatePaths, distPointToSegment, ZONE_SIZE, WATER_LEVEL } from "@rustcraft/shared";

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
};

/** Injects a 5-way texture blend (grass/rock/sand/snow/dirt) into the standard Lambert shader. */
function applyGroundBlendShader(mat: THREE.MeshLambertMaterial): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tGrass = { value: GROUND_TEXTURES.grass };
    shader.uniforms.tRock = { value: GROUND_TEXTURES.rock };
    shader.uniforms.tSand = { value: GROUND_TEXTURES.sand };
    shader.uniforms.tSnow = { value: GROUND_TEXTURES.snow };
    shader.uniforms.tDirt = { value: GROUND_TEXTURES.dirt };
    shader.uniforms.uTiling = { value: TERRAIN_TILING };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute vec3 weightsA;
        attribute vec2 weightsB;
        attribute vec2 terrainUv;
        varying vec3 vWeightsA;
        varying vec2 vWeightsB;
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
        uniform float uTiling;
        varying vec3 vWeightsA;
        varying vec2 vWeightsB;
        varying vec2 vTerrainUv;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec2 tuv = vTerrainUv * uTiling;
        vec3 groundColor =
          texture2D(tGrass, tuv).rgb * vWeightsA.x +
          texture2D(tRock,  tuv).rgb * vWeightsA.y +
          texture2D(tSand,  tuv).rgb * vWeightsA.z +
          texture2D(tSnow,  tuv).rgb * vWeightsB.x +
          texture2D(tDirt,  tuv).rgb * vWeightsB.y;
        diffuseColor.rgb = groundColor * mix(vec3(1.0), vColor.rgb, 0.55);`,
      );
  };
}

export function buildTerrain(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(ZONE_SIZE, ZONE_SIZE, RESOLUTION, RESOLUTION);
  geo.rotateX(-Math.PI / 2);

  const paths = generatePaths();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const terrainUv = (geo.attributes.uv as THREE.BufferAttribute).array as Float32Array;
  const tints = new Float32Array(pos.count * 3);
  // weightsA = [grass, rock, sand], weightsB = [snow, dirt]
  const weightsA = new Float32Array(pos.count * 3);
  const weightsB = new Float32Array(pos.count * 2);
  const tint = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = terrainHeight(x, z);
    pos.setY(i, y);

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
    weightsA[i * 3 + 1] = wRock / sum;
    weightsA[i * 3 + 2] = wSand / sum;
    weightsB[i * 2] = wSnow / sum;
    weightsB[i * 2 + 1] = wDirt / sum;

    tints[i * 3] = tint.r;
    tints[i * 3 + 1] = tint.g;
    tints[i * 3 + 2] = tint.b;
  }

  geo.setAttribute("color", new THREE.BufferAttribute(tints, 3));
  geo.setAttribute("weightsA", new THREE.BufferAttribute(weightsA, 3));
  geo.setAttribute("weightsB", new THREE.BufferAttribute(weightsB, 2));
  geo.setAttribute("terrainUv", new THREE.BufferAttribute(terrainUv, 2));
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  applyGroundBlendShader(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = "terrain";
  return mesh;
}

export function buildWater(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(ZONE_SIZE * 1.4, ZONE_SIZE * 1.4);
  geo.rotateX(-Math.PI / 2);
  const normalMap = tiledTexture("/assets/textures/water/water_normal.jpg");
  normalMap.repeat.set(80, 80);
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
  return mesh;
}

