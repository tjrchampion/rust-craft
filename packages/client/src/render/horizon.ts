import * as THREE from "three";
import { fbm, ZONE_SIZE } from "@rustcraft/shared";

const HORIZON_SEED = 424242;
const HAZE_COLOR = 0x8d97a8;
const SNOW_COLOR = 0xe7edf3;

const RING_SEGMENTS = 220; // vertices around the full 360°
const RADIAL_STEPS = 12; // vertices across the mountain band
const BAND_INNER = ZONE_SIZE * 0.62; // where slopes start rising out of the flat zone
const BAND_OUTER = ZONE_SIZE * 1.05; // outer edge, faded to nothing by fog
const PEAK_HEIGHT = 155;
const SNOWLINE = 78;
const BASE_Y = -18;
const TEXTURE_TILING = 5;

const textureLoader = new THREE.TextureLoader();
function tiledTexture(url: string): THREE.Texture {
  const tex = textureLoader.load(url);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Real rock/snow photo textures (same ambientCG CC0 set used for the ground), height-blended
// and lit so distant peaks read as real textured terrain rather than flat silhouettes.
const ROCK_MAP = tiledTexture("/assets/textures/terrain/rock.jpg");
const SNOW_MAP = tiledTexture("/assets/textures/terrain/snow.jpg");

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Sharp-peaked ridged noise: folds fbm's [0,1] output around its midpoint. */
function ridged(seed: number, x: number, z: number, cellSize: number, octaves: number): number {
  const n = fbm(seed, x, z, cellSize, octaves) * 2 - 1;
  return 1 - Math.abs(n);
}

/** Height field (world units) for a point already known to sit on the mountain ring. */
function mountainHeight(x: number, z: number, radialT: number): number {
  const ridgeMain = ridged(HORIZON_SEED, x, z, 300, 3);
  const ridgeDetail = ridged(HORIZON_SEED + 500, x, z, 90, 3);
  const fine = fbm(HORIZON_SEED + 900, x, z, 24, 2);
  const shape = ridgeMain * 0.6 + ridgeDetail * 0.28 + fine * 0.12;

  // Fade to flat at the inner edge (blends into the playable zone) and to
  // nothing at the outer edge (dissolves into fog) — peaks live in between.
  const innerFade = smoothstep(0, 0.18, radialT);
  const outerFade = 1 - smoothstep(0.72, 1, radialT);
  return shape * PEAK_HEIGHT * innerFade * outerFade;
}

/**
 * A distant, non-collidable ring of real heightmapped mountains beyond the
 * playable zone — layered ridged noise for a jagged silhouette, textured
 * with the same rock/snow photo maps used for the ground, height-blended
 * and fog-faded for a proper sense of scale. Pure backdrop, never walkable.
 */
export function buildHorizonMountains(): THREE.Group {
  const group = new THREE.Group();
  const cols = RING_SEGMENTS + 1;
  const rows = RADIAL_STEPS + 1;
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const snowBlend = new Float32Array(cols * rows);

  for (let row = 0; row < rows; row++) {
    const radialT = row / RADIAL_STEPS;
    const radius = BAND_INNER + radialT * (BAND_OUTER - BAND_INNER);
    for (let col = 0; col < cols; col++) {
      const angle = (col / RING_SEGMENTS) * Math.PI * 2;
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      const y = BASE_Y + mountainHeight(x, z, radialT);

      const i = row * cols + col;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      uvs[i * 2] = (col / RING_SEGMENTS) * TEXTURE_TILING * (BAND_OUTER / 150);
      uvs[i * 2 + 1] = radialT * TEXTURE_TILING;
      snowBlend[i] = smoothstep(SNOWLINE - 10, SNOWLINE + 18, y - BASE_Y);
    }
  }

  const indices: number[] = [];
  for (let row = 0; row < RADIAL_STEPS; row++) {
    for (let col = 0; col < RING_SEGMENTS; col++) {
      const a = row * cols + col;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("mountainUv", new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute("snowBlend", new THREE.BufferAttribute(snowBlend, 1));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({ color: HAZE_COLOR, fog: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tRock = { value: ROCK_MAP };
    shader.uniforms.tSnow = { value: SNOW_MAP };
    shader.uniforms.uSnowColor = { value: new THREE.Color(SNOW_COLOR) };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
        attribute float snowBlend;
        attribute vec2 mountainUv;
        varying float vSnowBlend;
        varying vec2 vMountainUv;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vSnowBlend = snowBlend;
        vMountainUv = mountainUv;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        uniform sampler2D tRock;
        uniform sampler2D tSnow;
        uniform vec3 uSnowColor;
        varying float vSnowBlend;
        varying vec2 vMountainUv;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec3 rockTex = texture2D(tRock, vMountainUv).rgb;
        vec3 snowTex = texture2D(tSnow, vMountainUv).rgb * uSnowColor;
        diffuseColor.rgb = mix(rockTex, snowTex, vSnowBlend);`,
      );
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "horizon-mountains";
  group.add(mesh);
  return group;
}
