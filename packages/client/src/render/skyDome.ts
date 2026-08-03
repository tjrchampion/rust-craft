import * as THREE from "three";
import type { SkyCloudSheet } from "@rustcraft/shared";
import type { AtmosphereSample, SkyLayerState } from "./regionAtmosphere";

/** Well inside typical camera.far (game 900 / editor 800). */
const DOME_RADIUS = 520;
const CLOUD_RADIUS = 500;
const STAR_RADIUS = 510;
const SKIRT_RADIUS = 515;

const GRADIENT_VS = /* glsl */ `
varying vec3 vWorldDir;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldDir = normalize(world.xyz - cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const GRADIENT_FS = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uMid;
uniform vec3 uHorizon;
varying vec3 vWorldDir;
void main() {
  float elev = clamp(vWorldDir.y, -0.15, 1.0);
  float h = smoothstep(-0.05, 0.22, elev);
  float z = smoothstep(0.28, 0.85, elev);
  vec3 col = mix(uHorizon, uMid, h);
  col = mix(col, uZenith, z);
  gl_FragColor = vec4(col, 1.0);
}
`;

/** Direction → equirect UV. Continuous across the sphere (no mesh UV seam). */
const DIR_UV = /* glsl */ `
#define PI 3.14159265359
vec2 dirToUv(vec3 d) {
  float u = atan(d.z, d.x) / (2.0 * PI) + 0.5;
  float v = asin(clamp(d.y, -1.0, 1.0)) / PI + 0.5;
  return vec2(u, v);
}
`;

const LAYER_VS = /* glsl */ `
varying vec3 vWorldDir;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorldDir = normalize(world.xyz - cameraPosition);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const CLOUD_FS = /* glsl */ `
` + DIR_UV + /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uTint;
uniform float uOpacity;
uniform vec2 uOffset;
uniform float uScale;
varying vec3 vWorldDir;
void main() {
  float above = smoothstep(-0.02, 0.12, vWorldDir.y);
  if (above < 0.01) discard;
  vec2 uv = dirToUv(normalize(vWorldDir)) * uScale + uOffset;
  vec4 tex = texture2D(uMap, uv);
  float a = tex.a * mix(tex.r, 1.0, 0.35) * uOpacity * above;
  if (a < 0.02) discard;
  gl_FragColor = vec4(uTint * tex.rgb, a);
}
`;

const STAR_FS = /* glsl */ `
` + DIR_UV + /* glsl */ `
uniform sampler2D uMap;
uniform float uOpacity;
uniform vec2 uOffset;
varying vec3 vWorldDir;
void main() {
  float above = smoothstep(0.05, 0.35, vWorldDir.y);
  if (above < 0.01 || uOpacity < 0.01) discard;
  vec2 uv = dirToUv(normalize(vWorldDir)) * 2.2 + uOffset;
  vec4 tex = texture2D(uMap, uv);
  float a = max(tex.r, max(tex.g, tex.b)) * uOpacity * above;
  if (a < 0.02) discard;
  gl_FragColor = vec4(tex.rgb, a);
}
`;

const SKIRT_VS = /* glsl */ `
varying float vElev;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 dir = normalize(world.xyz - cameraPosition);
  vElev = dir.y;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const SKIRT_FS = /* glsl */ `
uniform vec3 uFog;
varying float vElev;
void main() {
  float band = 1.0 - smoothstep(-0.08, 0.18, vElev);
  float floorFade = smoothstep(-0.35, -0.05, vElev);
  float a = band * floorFade * 0.85;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uFog, a);
}
`;

export interface SkyWeatherOverride {
  cloudOpacity?: number;
  starOpacity?: number;
  cloudTint?: THREE.Color;
  zenithColor?: THREE.Color;
  skyMidColor?: THREE.Color;
  horizonSkyColor?: THREE.Color;
  fogColor?: THREE.Color;
}

function loadSkyTexture(url: string): THREE.Texture {
  const loader = new THREE.TextureLoader();
  const tex = loader.load(url);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  // Mipmaps across equirect poles can streak; keep linear for sky sheets.
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

function skyMaterialBase(transparent: boolean): Partial<THREE.ShaderMaterialParameters> {
  return {
    side: THREE.BackSide,
    // depthTest true: only fill empty sky pixels — never paint over trees/props
    // (the old depthTest:false path drew cloud seams through every asset).
    depthWrite: false,
    depthTest: true,
    fog: false,
    toneMapped: false,
    transparent,
  };
}

/**
 * Camera-centric layered skydome (WoW-style): gradient dome + scrolling
 * cloud shell + star/nebula shell + horizon fog skirt.
 */
export class SkyDome {
  readonly group = new THREE.Group();

  private gradientMat: THREE.ShaderMaterial;
  private cloudMat: THREE.ShaderMaterial;
  private starMat: THREE.ShaderMaterial;
  private skirtMat: THREE.ShaderMaterial;

  private cloudSoft: THREE.Texture;
  private cloudStorm: THREE.Texture;
  private stars: THREE.Texture;

  private cloudOffset = new THREE.Vector2();
  private starOffset = new THREE.Vector2();
  private scrollSpeed = 0.01;
  private timeOfDay = 0.5;
  private weather: SkyWeatherOverride | null = null;

  private zenith = new THREE.Color();
  private mid = new THREE.Color();
  private horizon = new THREE.Color();
  private fog = new THREE.Color();
  private cloudTint = new THREE.Color(0xffffff);

  constructor() {
    this.group.name = "SkyDome";
    this.group.frustumCulled = false;

    this.cloudSoft = loadSkyTexture("/assets/textures/sky/clouds_soft.png");
    this.cloudStorm = loadSkyTexture("/assets/textures/sky/clouds_storm.png");
    this.stars = loadSkyTexture("/assets/textures/sky/stars_milky.png");

    this.gradientMat = new THREE.ShaderMaterial({
      ...skyMaterialBase(false),
      vertexShader: GRADIENT_VS,
      fragmentShader: GRADIENT_FS,
      uniforms: {
        uZenith: { value: new THREE.Color(0x3a8fd9) },
        uMid: { value: new THREE.Color(0x6eb4ef) },
        uHorizon: { value: new THREE.Color(0xc8e0f8) },
      },
    });

    this.cloudMat = new THREE.ShaderMaterial({
      ...skyMaterialBase(true),
      vertexShader: LAYER_VS,
      fragmentShader: CLOUD_FS,
      blending: THREE.NormalBlending,
      uniforms: {
        uMap: { value: this.cloudSoft },
        uTint: { value: new THREE.Color(0xffffff) },
        uOpacity: { value: 0.4 },
        uOffset: { value: this.cloudOffset },
        uScale: { value: 1.75 },
      },
    });

    this.starMat = new THREE.ShaderMaterial({
      ...skyMaterialBase(true),
      vertexShader: LAYER_VS,
      fragmentShader: STAR_FS,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uMap: { value: this.stars },
        uOpacity: { value: 0 },
        uOffset: { value: this.starOffset },
      },
    });

    this.skirtMat = new THREE.ShaderMaterial({
      ...skyMaterialBase(true),
      vertexShader: SKIRT_VS,
      fragmentShader: SKIRT_FS,
      uniforms: {
        uFog: { value: new THREE.Color(0xbcd9f0) },
      },
    });

    // Draw after opaque scene so depthTest keeps layers behind meshes.
    const gradient = new THREE.Mesh(new THREE.SphereGeometry(DOME_RADIUS, 64, 32), this.gradientMat);
    gradient.frustumCulled = false;
    gradient.renderOrder = 1000;
    this.group.add(gradient);

    const stars = new THREE.Mesh(new THREE.SphereGeometry(STAR_RADIUS, 48, 24), this.starMat);
    stars.frustumCulled = false;
    stars.renderOrder = 1001;
    this.group.add(stars);

    const clouds = new THREE.Mesh(new THREE.SphereGeometry(CLOUD_RADIUS, 48, 24), this.cloudMat);
    clouds.frustumCulled = false;
    clouds.renderOrder = 1002;
    this.group.add(clouds);

    const skirt = new THREE.Mesh(new THREE.SphereGeometry(SKIRT_RADIUS, 48, 20), this.skirtMat);
    skirt.frustumCulled = false;
    skirt.renderOrder = 1003;
    this.group.add(skirt);
  }

  setTimeOfDay(t01: number): void {
    this.timeOfDay = ((t01 % 1) + 1) % 1;
  }

  getTimeOfDay(): number {
    return this.timeOfDay;
  }

  setWeatherOverride(partial: SkyWeatherOverride | null): void {
    this.weather = partial;
  }

  setAtmosphere(a: AtmosphereSample, layers?: SkyLayerState): void {
    const L = layers ?? a.layers;
    this.zenith.copy(a.zenithColor);
    this.mid.copy(a.skyMidColor);
    this.horizon.copy(a.horizonSkyColor);
    this.fog.copy(a.fogColor);
    this.cloudTint.copy(L.cloudTint);
    this.scrollSpeed = L.cloudScroll;

    let cloudOpacity = L.cloudOpacity;
    let starOpacity = L.starOpacity;
    if (this.weather) {
      if (this.weather.zenithColor) this.zenith.copy(this.weather.zenithColor);
      if (this.weather.skyMidColor) this.mid.copy(this.weather.skyMidColor);
      if (this.weather.horizonSkyColor) this.horizon.copy(this.weather.horizonSkyColor);
      if (this.weather.fogColor) this.fog.copy(this.weather.fogColor);
      if (this.weather.cloudTint) this.cloudTint.copy(this.weather.cloudTint);
      if (this.weather.cloudOpacity !== undefined) cloudOpacity = this.weather.cloudOpacity;
      if (this.weather.starOpacity !== undefined) starOpacity = this.weather.starOpacity;
    }

    (this.gradientMat.uniforms.uZenith!.value as THREE.Color).copy(this.zenith);
    (this.gradientMat.uniforms.uMid!.value as THREE.Color).copy(this.mid);
    (this.gradientMat.uniforms.uHorizon!.value as THREE.Color).copy(this.horizon);
    (this.skirtMat.uniforms.uFog!.value as THREE.Color).copy(this.fog);

    this.setCloudSheet(L.cloudSheet);
    (this.cloudMat.uniforms.uTint!.value as THREE.Color).copy(this.cloudTint);
    this.cloudMat.uniforms.uOpacity!.value = cloudOpacity;
    this.starMat.uniforms.uOpacity!.value = starOpacity;
  }

  private setCloudSheet(sheet: SkyCloudSheet): void {
    const map = sheet === "storm" ? this.cloudStorm : this.cloudSoft;
    if (this.cloudMat.uniforms.uMap!.value !== map) {
      this.cloudMat.uniforms.uMap!.value = map;
    }
  }

  /** Re-center on the camera and advance UV scroll (no mesh yaw — that
   *  spun the sphere UV pole and made the seam crawl). */
  update(dt: number, camera: THREE.Camera): void {
    camera.getWorldPosition(this.group.position);
    this.group.rotation.set(0, 0, 0);
    this.cloudOffset.x += this.scrollSpeed * dt * 0.12;
    this.cloudOffset.y += this.scrollSpeed * dt * 0.03;
    this.starOffset.x += dt * 0.0015;
  }

  dispose(): void {
    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
      }
    });
    this.gradientMat.dispose();
    this.cloudMat.dispose();
    this.starMat.dispose();
    this.skirtMat.dispose();
    this.cloudSoft.dispose();
    this.cloudStorm.dispose();
    this.stars.dispose();
  }
}
