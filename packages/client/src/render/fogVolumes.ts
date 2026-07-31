import * as THREE from "three";
import type { RegionFogVolume } from "@rustcraft/shared";

/**
 * Wispy smoke pocket. Raymarches the mesh interior with a cheap 2-octave
 * noise — kept deliberately light (few steps, early-out, distance LOD) so
 * large volumes don't tank the frame budget.
 */
const FOG_VERTEX = /* glsl */ `
varying vec3 vLocalPos;
varying vec3 vLocalCam;
varying float vCamDist;

void main() {
  vLocalPos = position;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vCamDist = length(cameraPosition - worldPos.xyz);
  // Avoid inverse(modelMatrix): extract scale from columns, subtract translated cam.
  vec3 scale = vec3(
    length(vec3(modelMatrix[0][0], modelMatrix[0][1], modelMatrix[0][2])),
    length(vec3(modelMatrix[1][0], modelMatrix[1][1], modelMatrix[1][2])),
    length(vec3(modelMatrix[2][0], modelMatrix[2][1], modelMatrix[2][2]))
  );
  vec3 worldOrigin = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]);
  // Assumes axis-aligned volumes (editor doesn't rotate fog) — enough for our use.
  vLocalCam = (cameraPosition - worldOrigin) / max(scale, vec3(1e-4));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FOG_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uDensity;
uniform float uFeather;
uniform float uBox;
uniform float uTime;
varying vec3 vLocalPos;
varying vec3 vLocalCam;
varying float vCamDist;

vec2 intersectSphere(vec3 ro, vec3 rd) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - 1.0;
  float h = b * b - c;
  if (h < 0.0) return vec2(1.0, -1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

vec2 intersectBox(vec3 ro, vec3 rd) {
  vec3 inv = 1.0 / rd;
  vec3 t0 = (-1.0 - ro) * inv;
  vec3 t1 = (1.0 - ro) * inv;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  float tNear = max(max(tmin.x, tmin.y), tmin.z);
  float tFar = min(min(tmax.x, tmax.y), tmax.z);
  return vec2(tNear, tFar);
}

float hash31(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float valueNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash31(i);
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}

// Two octaves only — enough for wisps without the old 4×warp cost.
float smokeNoise(vec3 p) {
  float n = valueNoise(p);
  n += 0.5 * valueNoise(p * 2.02 + 7.3);
  return n * 0.666;
}

float volumeMask(vec3 p, float feather) {
  float d = uBox > 0.5 ? max(abs(p.x), max(abs(p.y), abs(p.z))) : length(p);
  float rim = mix(0.9, 0.5, clamp(feather, 0.0, 1.0));
  return smoothstep(1.0, rim, d);
}

void main() {
  if (gl_FrontFacing) discard;

  // Far volumes: skip entirely past ~120 m (still culled by frustum, but
  // cheap out when a huge volume fills the far background).
  if (vCamDist > 120.0) discard;

  vec3 rd = vLocalPos - vLocalCam;
  float rdLen = length(rd);
  if (rdLen < 1e-5) discard;
  rd /= rdLen;

  vec2 hit = uBox > 0.5 ? intersectBox(vLocalCam, rd) : intersectSphere(vLocalCam, rd);
  float tNear = max(hit.x, 0.0);
  float tFar = hit.y;
  if (tFar <= tNear) discard;

  float thickness = tFar - tNear;
  if (thickness < 1e-4) discard;

  float densScale = mix(0.7, 3.6, clamp(uDensity, 0.0, 1.0));
  float opacity = mix(0.2, 1.0, clamp(uOpacity, 0.0, 1.0));
  float feather = clamp(uFeather, 0.0, 1.0);

  float alpha;
  vec3 col = uColor;

  // LOD: far = analytical thickness + 1 noise tap; near = 5-step march.
  if (vCamDist > 55.0) {
    vec3 mid = vLocalCam + rd * (tNear + tFar) * 0.5;
    vec3 q = mid * vec3(1.3, 0.8, 1.3);
    q.y -= uTime * 0.04;
    float n = smokeNoise(q * 1.8 + uTime * 0.03);
    float wisps = smoothstep(0.3, 0.75, n);
    float mask = volumeMask(mid, feather);
    float optical = thickness * densScale * mix(0.35, 1.0, wisps) * mask;
    alpha = (1.0 - exp(-optical)) * opacity;
  } else {
    const int STEPS = 5;
    float stepLen = thickness / float(STEPS);
    float accum = 0.0;
    float transmittance = 1.0;
    float jitter = hash31(vLocalPos * 11.0 + vec3(uTime));
    float t = tNear + stepLen * jitter;

    for (int i = 0; i < STEPS; i++) {
      vec3 p = vLocalCam + rd * t;
      float mask = volumeMask(p, feather);
      if (mask > 0.01) {
        vec3 q = p * vec3(1.3, 0.8, 1.3);
        q.y -= uTime * 0.04;
        q.xz += vec2(uTime * 0.025, -uTime * 0.02);
        // Single cheap warp tap (was 3 full FBMs before).
        float w = valueNoise(q * 1.2 + 3.1);
        q.x += (w - 0.5) * 0.45;
        float n = smokeNoise(q * 2.0);
        float billow = 1.0 - abs(n * 2.0 - 1.0);
        float smoke = mix(billow * billow, smoothstep(0.28, 0.78, n), 0.5) * mask;
        float sampleAbsorb = smoke * densScale * stepLen;
        float sampleAlpha = 1.0 - exp(-sampleAbsorb);
        accum += transmittance * sampleAlpha;
        transmittance *= 1.0 - sampleAlpha * 0.9;
        if (accum > 0.93 || transmittance < 0.06) break;
      }
      t += stepLen;
    }
    alpha = accum * opacity;
    col = uColor * (0.85 + 0.25 * accum);
  }

  if (alpha < 0.025) discard;
  gl_FragColor = vec4(col, alpha);
}
`;

function bindFogTime(mesh: THREE.Mesh, mat: THREE.ShaderMaterial): void {
  mesh.onBeforeRender = () => {
    mat.uniforms.uTime!.value = performance.now() * 0.001;
  };
}

export function createFogVolumeMaterial(vol: Pick<RegionFogVolume, "color" | "density" | "opacity" | "feather" | "shape">): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    fog: false,
    toneMapped: false,
    uniforms: {
      uColor: { value: new THREE.Color(vol.color) },
      uOpacity: { value: vol.opacity },
      uDensity: { value: vol.density },
      uFeather: { value: vol.feather },
      uBox: { value: vol.shape === "box" ? 1 : 0 },
      uTime: { value: 0 },
    },
    vertexShader: FOG_VERTEX,
    fragmentShader: FOG_FRAGMENT,
  });
}

/** Unit sphere/box scaled by size*; cheap raymarched smoke pocket. */
export function createFogVolumeMesh(vol: RegionFogVolume): THREE.Mesh {
  const geo =
    vol.shape === "box"
      ? new THREE.BoxGeometry(2, 2, 2)
      : new THREE.SphereGeometry(1, 20, 14);
  const mat = createFogVolumeMaterial(vol);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(vol.localX, vol.localY, vol.localZ);
  mesh.scale.set(Math.max(0.5, vol.sizeX), Math.max(0.5, vol.sizeY), Math.max(0.5, vol.sizeZ));
  mesh.renderOrder = 3;
  mesh.frustumCulled = true;
  mesh.name = `fog-volume:${vol.id ?? "anon"}`;
  mesh.userData.fogVolume = true;
  mesh.userData.fogShape = vol.shape;
  bindFogTime(mesh, mat);
  return mesh;
}

export function syncFogVolumeMesh(mesh: THREE.Mesh, vol: Pick<RegionFogVolume, "color" | "density" | "opacity" | "feather" | "shape" | "sizeX" | "sizeY" | "sizeZ" | "localX" | "localY" | "localZ">): void {
  mesh.position.set(vol.localX, vol.localY, vol.localZ);
  mesh.scale.set(Math.max(0.5, vol.sizeX), Math.max(0.5, vol.sizeY), Math.max(0.5, vol.sizeZ));
  const wantBox = vol.shape === "box";
  const isBox = mesh.userData.fogShape === "box";
  if (wantBox !== isBox) {
    mesh.geometry.dispose();
    mesh.geometry = wantBox ? new THREE.BoxGeometry(2, 2, 2) : new THREE.SphereGeometry(1, 20, 14);
    mesh.userData.fogShape = vol.shape;
  }
  const mat = mesh.material as THREE.ShaderMaterial;
  if (!mat.uniforms) return;
  (mat.uniforms.uColor!.value as THREE.Color).set(vol.color);
  mat.uniforms.uOpacity!.value = vol.opacity;
  mat.uniforms.uDensity!.value = vol.density;
  mat.uniforms.uFeather!.value = vol.feather;
  mat.uniforms.uBox!.value = wantBox ? 1 : 0;
  if (!mesh.onBeforeRender) bindFogTime(mesh, mat);
}

/** 0..1 influence of a fog volume on the camera (1 = deep inside core). */
export function fogVolumeInfluence(
  vol: RegionFogVolume,
  camX: number,
  camY: number,
  camZ: number,
): number {
  const dx = (camX - vol.localX) / Math.max(0.5, vol.sizeX);
  const dy = (camY - vol.localY) / Math.max(0.5, vol.sizeY);
  const dz = (camZ - vol.localZ) / Math.max(0.5, vol.sizeZ);
  let d: number;
  if (vol.shape === "box") d = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  else d = Math.hypot(dx, dy, dz);
  const edge = 1 - Math.min(0.85, Math.max(0.15, vol.feather));
  return THREE.MathUtils.clamp(1 - (d - edge) / Math.max(0.05, 1 - edge), 0, 1) * vol.density;
}
