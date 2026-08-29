import * as THREE from "three";
import { WATER_LEVEL } from "@rustcraft/shared";
import type { WaterEnvColors } from "./terrain";

const OCEAN_INNER_RADIUS = 180;
const OCEAN_RADIUS = 9000;
const RINGS = 40;
const SEGMENTS = 64;

/**
 * Builds an annular horizon ocean mesh geometry with exponential ring spacing.
 * Starts at innerRadius (leaving local zone water to RegionAdtWaterStreamer)
 * and smoothly expands to 9km at the horizon, eliminating double water layers.
 */
function buildOceanGeometry(
  innerRadius = OCEAN_INNER_RADIUS,
  outerRadius = OCEAN_RADIUS,
  rings = RINGS,
  segments = SEGMENTS,
): THREE.BufferGeometry {
  const vertexCount = (rings + 1) * segments;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);

  let vIdx = 0;
  for (let r = 0; r <= rings; r++) {
    const frac = r / rings;
    const dist = innerRadius + Math.pow(frac, 2.2) * (outerRadius - innerRadius);

    for (let s = 0; s < segments; s++) {
      const angle = (s / segments) * Math.PI * 2;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;

      positions[vIdx * 3 + 0] = x;
      positions[vIdx * 3 + 1] = 0;
      positions[vIdx * 3 + 2] = z;

      uvs[vIdx * 2 + 0] = x / outerRadius + 0.5;
      uvs[vIdx * 2 + 1] = z / outerRadius + 0.5;
      vIdx++;
    }
  }

  const indices: number[] = [];
  for (let r = 0; r < rings; r++) {
    const rStart = r * segments;
    const nextRStart = (r + 1) * segments;

    for (let s = 0; s < segments; s++) {
      const nextS = (s + 1) % segments;

      const i0 = rStart + s;
      const i1 = rStart + nextS;
      const i2 = nextRStart + s;
      const i3 = nextRStart + nextS;

      indices.push(i0, i2, i1);
      indices.push(i1, i2, i3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const textureLoader = new THREE.TextureLoader();

function tiledNormalTexture(url: string): THREE.Texture {
  const tex = textureLoader.load(url);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/**
 * Global endless ocean plane that follows the player/camera, generating
 * open sea and horizon water anywhere there is no joining landmass.
 */
export class HorizonOcean {
  readonly mesh: THREE.Mesh;
  private material: THREE.MeshLambertMaterial;
  private normalMap1: THREE.Texture;
  private normalMap2: THREE.Texture;
  private time = 0;
  private targetSkyColor = new THREE.Color(0x7da4cf);
  private targetFogColor = new THREE.Color(0x87b5d9);
  private targetDeepColor = new THREE.Color(0x071e3d);

  constructor(
    private scene: THREE.Scene,
    innerRadius = OCEAN_INNER_RADIUS,
    outerRadius = OCEAN_RADIUS,
  ) {
    const geo = buildOceanGeometry(innerRadius, outerRadius);

    this.normalMap1 = tiledNormalTexture("/assets/textures/water/waternormals.jpg");
    this.normalMap1.repeat.set(120, 120);

    this.normalMap2 = tiledNormalTexture("/assets/textures/water/water_1_normal.jpg");
    this.normalMap2.repeat.set(160, 160);

    this.material = new THREE.MeshLambertMaterial({
      color: 0x1a486e,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      side: THREE.DoubleSide,
      normalMap: this.normalMap1,
      normalScale: new THREE.Vector2(0.45, 0.45),
    });

    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.tNormal1 = { value: this.normalMap1 };
      shader.uniforms.tNormal2 = { value: this.normalMap2 };
      shader.uniforms.uDeepColor = { value: this.targetDeepColor };
      shader.uniforms.uSkyColor = { value: this.targetSkyColor };
      shader.uniforms.uFogColor = { value: this.targetFogColor };

      this.material.userData.shader = shader;

      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          `#include <common>
           varying vec3 vWorldPos;
           varying float vDistToCam;
           uniform float uTime;`,
        )
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           vec4 wPos = modelMatrix * vec4(position, 1.0);
           vWorldPos = wPos.xyz;
           float dist = length(wPos.xz - cameraPosition.xz);
           vDistToCam = dist;

           // Subtle multi-harmonic oceanic swell near player that fades smoothly towards horizon
           float swellFalloff = 1.0 - smoothstep(80.0, 900.0, dist);
           float wave1 = sin(uTime * 1.2 + (wPos.x * 0.07 + wPos.z * 0.05)) * 0.035;
           float wave2 = cos(uTime * 1.6 - (wPos.x * 0.12 - wPos.z * 0.09)) * 0.022;
           float wave3 = sin(uTime * 0.65 + (wPos.x * 0.02 - wPos.z * 0.03)) * 0.045;
           transformed.y += (wave1 + wave2 + wave3) * swellFalloff;`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          `#include <common>
           varying vec3 vWorldPos;
           varying float vDistToCam;
           uniform float uTime;
           uniform sampler2D tNormal1;
           uniform sampler2D tNormal2;
           uniform vec3 uDeepColor;
           uniform vec3 uSkyColor;
           uniform vec3 uFogColor;`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
           // Dynamic dual-scrolling normal sample in world space
           vec2 uvA = vWorldPos.xz * 0.045 + vec2(uTime * 0.015, uTime * 0.011);
           vec2 uvB = vWorldPos.xz * 0.030 + vec2(-uTime * 0.010, uTime * 0.014);

           vec3 n1 = texture2D(tNormal1, uvA).rgb * 2.0 - 1.0;
           vec3 n2 = texture2D(tNormal2, uvB).rgb * 2.0 - 1.0;
           vec3 combinedN = normalize(n1 + n2);

           // Fresnel reflection: glancing angle towards horizon picks up sky/fog reflection
           vec3 viewDir = normalize(cameraPosition - vWorldPos);
           float fresnel = pow(clamp(1.0 - max(0.0, dot(viewDir, vec3(0.0, 1.0, 0.0) + combinedN * 0.15)), 0.0, 1.0), 3.0);

           vec3 baseOcean = mix(uDeepColor, diffuseColor.rgb, 0.45);
           vec3 oceanColor = mix(baseOcean, uSkyColor, fresnel * 0.65 + 0.05);

           // Distant horizon blend into fog color
           float horizonBlend = smoothstep(1200.0, 5000.0, vDistToCam);
           oceanColor = mix(oceanColor, uFogColor, horizonBlend * 0.6);

           diffuseColor.rgb = oceanColor;
           diffuseColor.a = mix(0.86, 0.95, fresnel);`,
        );
    };

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.name = "horizon-ocean";
    this.mesh.renderOrder = 180;
    this.mesh.receiveShadow = false;

    this.scene.add(this.mesh);
  }

  /** Sync ocean colors with live atmospheric lighting (sky/fog/grading). */
  syncLighting(fog: THREE.Color, sky: THREE.Color): void {
    this.targetSkyColor.copy(sky);
    this.targetFogColor.copy(fog);

    const ocean = new THREE.Color(0x08223f);
    ocean.lerp(fog, 0.3);
    ocean.lerp(sky, 0.15);
    this.targetDeepColor.copy(ocean);

    this.material.color.copy(ocean);

    const shader = this.material.userData.shader;
    if (shader) {
      shader.uniforms.uSkyColor.value.copy(sky);
      shader.uniforms.uFogColor.value.copy(fog);
      shader.uniforms.uDeepColor.value.copy(ocean);
    }
  }

  syncWaterEnvironment(env: WaterEnvColors): void {
    const sky = new THREE.Color(env.skyColor);
    const fog = new THREE.Color(env.fogColor);
    this.syncLighting(fog, sky);
  }

  /** Update time and center ocean mesh onto the active camera. */
  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;

    // Center mesh onto camera with sub-meter grid snapping to eliminate texture crawl
    const snap = 2.0;
    const snapX = Math.floor(camera.position.x / snap) * snap;
    const snapZ = Math.floor(camera.position.z / snap) * snap;

    this.mesh.position.set(snapX, WATER_LEVEL, snapZ);

    const shader = this.material.userData.shader;
    if (shader) {
      shader.uniforms.uTime.value = this.time;
    }

    if (this.normalMap1) {
      this.normalMap1.offset.set(this.time * 0.015, this.time * 0.01);
    }
    if (this.normalMap2) {
      this.normalMap2.offset.set(-this.time * 0.012, this.time * 0.014);
    }
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.normalMap1.dispose();
    this.normalMap2.dispose();
  }
}
