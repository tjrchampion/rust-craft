import * as THREE from "three";
import { fbm } from "@rustcraft/shared";

const RING_SEGMENTS = 160;
const RADIAL_STEPS = 10;
const TEXTURE_TILING = 5;
const BASE_Y = -12;

const textureLoader = new THREE.TextureLoader();
function tiledTexture(url: string): THREE.Texture {
  const tex = textureLoader.load(url);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const ROCK_MAP = tiledTexture("/assets/textures/terrain/rock.jpg");
const SNOW_MAP = tiledTexture("/assets/textures/terrain/snow.jpg");

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function ridged(seed: number, x: number, z: number, cellSize: number, octaves: number): number {
  const n = fbm(seed, x, z, cellSize, octaves) * 2 - 1;
  return 1 - Math.abs(n);
}

export interface RegionHorizonOpts {
  innerRadius: number;
  outerRadius: number;
  peakScale?: number;
  tint?: string;
  snowline?: number;
  seed?: number;
}

/** Distant non-collidable mountain ring sized to a region (not ZONE_SIZE). */
export function buildRegionHorizon(opts: RegionHorizonOpts): THREE.Group {
  const group = new THREE.Group();
  group.name = "region-horizon";
  const peakScale = opts.peakScale ?? 1;
  const snowline = opts.snowline ?? 70;
  const seed = opts.seed ?? 424242;
  const peakHeight = 140 * peakScale;
  const tint = new THREE.Color(opts.tint ?? "#8d97a8");
  const snowColor = new THREE.Color(0xe7edf3);

  const cols = RING_SEGMENTS + 1;
  const rows = RADIAL_STEPS + 1;
  const positions = new Float32Array(cols * rows * 3);
  const uvs = new Float32Array(cols * rows * 2);
  const snowBlend = new Float32Array(cols * rows);

  for (let row = 0; row < rows; row++) {
    const radialT = row / RADIAL_STEPS;
    const radius = opts.innerRadius + radialT * (opts.outerRadius - opts.innerRadius);
    for (let col = 0; col < cols; col++) {
      const angle = (col / RING_SEGMENTS) * Math.PI * 2;
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      const ridgeMain = ridged(seed, x, z, 280, 3);
      const ridgeDetail = ridged(seed + 500, x, z, 80, 3);
      const fine = fbm(seed + 900, x, z, 22, 2);
      const shape = ridgeMain * 0.6 + ridgeDetail * 0.28 + fine * 0.12;
      const innerFade = smoothstep(0, 0.18, radialT);
      const outerFade = 1 - smoothstep(0.72, 1, radialT);
      const y = BASE_Y + shape * peakHeight * innerFade * outerFade;
      const i = row * cols + col;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      uvs[i * 2] = (col / RING_SEGMENTS) * TEXTURE_TILING * (opts.outerRadius / 150);
      uvs[i * 2 + 1] = radialT * TEXTURE_TILING;
      snowBlend[i] = smoothstep(snowline - 10, snowline + 18, y - BASE_Y);
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

  const mat = new THREE.MeshLambertMaterial({ color: tint, fog: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tRock = { value: ROCK_MAP };
    shader.uniforms.tSnow = { value: SNOW_MAP };
    shader.uniforms.uSnowColor = { value: snowColor };
    shader.uniforms.uTint = { value: tint };
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
        uniform vec3 uTint;
        varying float vSnowBlend;
        varying vec2 vMountainUv;`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec3 rockTex = texture2D(tRock, vMountainUv).rgb * uTint;
        vec3 snowTex = texture2D(tSnow, vMountainUv).rgb * uSnowColor;
        diffuseColor.rgb = mix(rockTex, snowTex, vSnowBlend);`,
      );
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "region-horizon-mesh";
  mesh.frustumCulled = false;
  group.add(mesh);
  return group;
}
