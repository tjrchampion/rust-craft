import * as THREE from "three";
import type { School } from "./vfx";

/** A short-lived, camera-facing shader flash layered on top of the particle
 *  burst (see SpellVfxSystem) -- particles read fine for "stuff flying
 *  outward" but read weak for the instantaneous flash/glyph/shockwave punch
 *  a school-flavored hit wants at the moment of impact. One shared,
 *  parametrized fragment shader (hash noise + radial falloff + optional
 *  rings/spokes) driven by a small preset per school, rather than a bespoke
 *  shader per school -- keeps this maintainable while still reading as
 *  visually distinct per school through the parameters alone. */

const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;
varying vec2 vUv;

uniform float uT; // 0..1 normalized progress through the flash's life
uniform vec3 uColorCore;
uniform vec3 uColorMid;
uniform vec3 uColorEdge;
uniform float uNoiseScale;
uniform float uNoiseSpeed;
uniform float uDistortion;
uniform float uRingFreq;   // 0 disables the ring pattern
uniform float uRingSpeed;
uniform float uSpokes;     // 0 disables the angular spoke pattern
uniform float uSoftness;
// 0 = radially symmetric (rings/void/shockwave shapes). >0 = stretched into
// a flame silhouette that narrows and licks upward from a base, with
// jagged per-angle tongues instead of a smooth disc edge -- fire is the
// only school that wants this, everything else leaves it at 0.
uniform float uUpBias;

// Classic hash-based value noise + 4-octave fbm -- standard, ubiquitous
// technique (this exact hash shape shows up in countless independent GLSL
// codebases), not tied to any one source.
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += amp * valueNoise(p);
    p *= 2.0;
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 c = vUv - 0.5;

  // Flame mode: pull the sample point's origin down (so the shape grows
  // mostly upward from a base near the bottom of the quad, like a flame
  // rooted at the impact point) and squash it narrower than it is tall.
  vec2 cc = c;
  if (uUpBias > 0.0) {
    cc.y -= uUpBias * 0.28;
    cc /= vec2(mix(1.0, 0.72, uUpBias), mix(1.0, 1.55, uUpBias));
  }
  float r = length(cc) * 2.0;
  float angle = atan(cc.y, cc.x);

  // Quick punch-in, held briefly, then fade -- the shared envelope every
  // school's flash rides regardless of its own visual pattern.
  float envelope = smoothstep(0.0, 0.08, uT) * (1.0 - smoothstep(0.25, 1.0, uT));

  float n = fbm(cc * uNoiseScale + vec2(0.0, uT * uNoiseSpeed * 6.2831));
  float rd = r - (n - 0.5) * uDistortion;

  // Jagged per-angle tongues instead of a smooth edge -- individual licks
  // of flame rather than a uniform blob. Scaled by uUpBias so every other
  // school's clean disc/ring shape is untouched.
  if (uUpBias > 0.0) {
    float tongues = fbm(vec2(angle * 2.2, uT * 1.6 - r * 1.5)) - 0.5;
    rd -= tongues * uUpBias * 0.5;
  }

  // Outward-expanding disc -- radius grows with uT so the flash reads as a
  // burst racing outward, not a static decal fading in place.
  float radius = mix(0.05, 1.05, smoothstep(0.0, 0.45, uT));
  float disc = 1.0 - smoothstep(radius - uSoftness, radius, rd);

  float ring = uRingFreq > 0.0 ? pow(abs(sin(rd * uRingFreq - uT * uRingSpeed)), 2.0) : 1.0;
  float spoke = uSpokes > 0.0 ? pow(abs(sin(angle * uSpokes)), 1.5) : 1.0;
  float ringMix = uRingFreq > 0.0 ? mix(1.0, ring, 0.6) : 1.0;
  float spokeMix = uSpokes > 0.0 ? mix(1.0, spoke, 0.5) : 1.0;

  // Fast temporal flicker on top of the envelope -- subtle for most schools,
  // but it's what keeps fire from reading as a static glow instead of
  // something actively burning.
  float flicker = mix(1.0, 0.75 + 0.25 * valueNoise(vec2(uT * 26.0, angle * 3.0)), uUpBias);

  float intensity = disc * ringMix * spokeMix * envelope * flicker;

  // Three-stop ramp: white-hot core -> mid color -> edge color, instead of
  // a flat two-color lerp -- this is what actually sells "fire" (white/
  // yellow center cooling through orange to a dark red edge) rather than a
  // generic tinted glow.
  vec3 color = mix(uColorMid, uColorCore, smoothstep(0.32, 0.0, rd));
  color = mix(uColorEdge, color, smoothstep(0.62, 0.22, rd));

  gl_FragColor = vec4(color * intensity * 1.6, intensity);
}
`;

interface SchoolFlashParams {
  colorCore: number;
  /** Middle stop of the 3-color ramp -- defaults to colorCore for schools
   *  that don't need a distinct one (their core->edge 2-stop look is
   *  unchanged; the mid stop only shows up between the two smoothsteps if
   *  it actually differs from colorCore). */
  colorMid: number;
  colorEdge: number;
  noiseScale: number;
  noiseSpeed: number;
  distortion: number;
  ringFreq: number;
  ringSpeed: number;
  spokes: number;
  softness: number;
  /** 0 = radially symmetric (every school so far except fire). >0 = stretched
   *  upward into a flame silhouette with jagged tongues and flicker -- see
   *  the shader's uUpBias comment. */
  upBias: number;
  size: number;
  lifeMs: number;
}

/** One preset per school -- distinct silhouette per family (fire's noisy
 *  rising churn, frost's tight faceted rings, holy's radiant spokes, arcane's
 *  slow rotating rune rings, shadow's soft edgeless void, nature's loose
 *  organic noise, physical's sharp noiseless shockwave, heal/buff's soft
 *  glow) using only the one shared shader's parameters. */
const SCHOOL_FLASH_PARAMS: Record<School, SchoolFlashParams> = {
  // The only school using upBias -- white-hot core, saturated orange mid,
  // deep red edge, stretched into a jagged upward-licking flame silhouette
  // with flicker (see the shader's uUpBias branches).
  fire: {
    colorCore: 0xfff6d6,
    colorMid: 0xff9a1f,
    colorEdge: 0x8f1000,
    noiseScale: 3.2,
    noiseSpeed: 1.8,
    distortion: 0.3,
    ringFreq: 0,
    ringSpeed: 0,
    spokes: 0,
    softness: 0.14,
    upBias: 0.85,
    size: 1.7,
    lifeMs: 420,
  },
  frost: {
    colorCore: 0xf0fbff,
    colorMid: 0xf0fbff,
    colorEdge: 0x5fc4ff,
    noiseScale: 6,
    noiseSpeed: 0.2,
    distortion: 0.12,
    ringFreq: 18,
    ringSpeed: 4,
    spokes: 6,
    softness: 0.05,
    upBias: 0,
    size: 1.4,
    lifeMs: 420,
  },
  holy: {
    colorCore: 0xffffff,
    colorMid: 0xffffff,
    colorEdge: 0xffe9a8,
    noiseScale: 1.5,
    noiseSpeed: 0.3,
    distortion: 0.05,
    ringFreq: 0,
    ringSpeed: 0,
    spokes: 12,
    softness: 0.1,
    upBias: 0,
    size: 1.8,
    lifeMs: 450,
  },
  arcane: {
    colorCore: 0xf4e2ff,
    colorMid: 0xf4e2ff,
    colorEdge: 0xa855f7,
    noiseScale: 2,
    noiseSpeed: 0.5,
    distortion: 0.08,
    ringFreq: 10,
    ringSpeed: 3,
    spokes: 0,
    softness: 0.06,
    upBias: 0,
    size: 1.5,
    lifeMs: 480,
  },
  shadow: {
    colorCore: 0x2a123f,
    colorMid: 0x2a123f,
    colorEdge: 0x120818,
    noiseScale: 2.5,
    noiseSpeed: -0.6,
    distortion: 0.3,
    ringFreq: 0,
    ringSpeed: 0,
    spokes: 0,
    softness: 0.3,
    upBias: 0,
    size: 1.5,
    lifeMs: 420,
  },
  nature: {
    colorCore: 0xe8ffcf,
    colorMid: 0xe8ffcf,
    colorEdge: 0x4caf50,
    noiseScale: 4,
    noiseSpeed: 0.7,
    distortion: 0.28,
    ringFreq: 0,
    ringSpeed: 0,
    spokes: 5,
    softness: 0.2,
    upBias: 0,
    size: 1.4,
    lifeMs: 420,
  },
  physical: {
    colorCore: 0xffffff,
    colorMid: 0xffffff,
    colorEdge: 0xcfcfcf,
    noiseScale: 1,
    noiseSpeed: 0,
    distortion: 0.0,
    ringFreq: 0,
    ringSpeed: 0,
    spokes: 0,
    softness: 0.03,
    upBias: 0,
    size: 1.2,
    lifeMs: 220,
  },
  heal: {
    colorCore: 0xffffff,
    colorMid: 0xffffff,
    colorEdge: 0x7be07b,
    noiseScale: 1.5,
    noiseSpeed: 0.25,
    distortion: 0.06,
    ringFreq: 0,
    ringSpeed: 0,
    spokes: 0,
    softness: 0.22,
    upBias: 0,
    size: 1.6,
    lifeMs: 480,
  },
  buff: {
    colorCore: 0xffffff,
    colorMid: 0xffffff,
    colorEdge: 0xffd166,
    noiseScale: 1.5,
    noiseSpeed: 0.25,
    distortion: 0.06,
    ringFreq: 0,
    ringSpeed: 0,
    spokes: 8,
    softness: 0.2,
    upBias: 0,
    size: 1.4,
    lifeMs: 400,
  },
};

interface LiveFlash {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  born: number;
  lifeMs: number;
}

/** Pooled, camera-facing shader flashes -- one shared geometry/shader
 *  program, per-instance ShaderMaterial clones so simultaneous flashes of
 *  different schools (or the same school twice) don't fight over uniforms. */
export class SchoolFlashSystem {
  private scene: THREE.Scene;
  private geometry = new THREE.PlaneGeometry(1, 1);
  private pool: THREE.Mesh[] = [];
  private live: LiveFlash[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  spawn(school: School, pos: THREE.Vector3): void {
    const params = SCHOOL_FLASH_PARAMS[school];
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uT: { value: 0 },
        uColorCore: { value: new THREE.Color(params.colorCore) },
        uColorMid: { value: new THREE.Color(params.colorMid) },
        uColorEdge: { value: new THREE.Color(params.colorEdge) },
        uNoiseScale: { value: params.noiseScale },
        uNoiseSpeed: { value: params.noiseSpeed },
        uDistortion: { value: params.distortion },
        uRingFreq: { value: params.ringFreq },
        uRingSpeed: { value: params.ringSpeed },
        uSpokes: { value: params.spokes },
        uSoftness: { value: params.softness },
        uUpBias: { value: params.upBias },
      },
    });

    let mesh = this.pool.pop();
    if (mesh) {
      (mesh.material as THREE.ShaderMaterial).dispose();
      mesh.material = material;
      mesh.visible = true;
    } else {
      mesh = new THREE.Mesh(this.geometry, material);
      this.scene.add(mesh);
    }
    mesh.position.copy(pos);
    mesh.scale.setScalar(params.size);
    mesh.renderOrder = 5;

    this.live.push({ mesh, material, born: performance.now(), lifeMs: params.lifeMs });
  }

  /** Billboards every live flash toward `camera` and advances its shader
   *  clock -- called once per frame. */
  update(camera: THREE.Camera): void {
    if (this.live.length === 0) return;
    const now = performance.now();
    const next: LiveFlash[] = [];
    for (const f of this.live) {
      const t = (now - f.born) / f.lifeMs;
      if (t >= 1) {
        f.mesh.visible = false;
        this.pool.push(f.mesh);
        continue;
      }
      f.mesh.quaternion.copy(camera.quaternion);
      f.material.uniforms.uT!.value = t;
      next.push(f);
    }
    this.live = next;
  }
}
