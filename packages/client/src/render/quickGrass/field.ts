import * as THREE from "three";
import {
  DEFAULT_QUICK_GRASS_SETTINGS,
  mergeQuickGrassSettings,
  dist2D,
  smoothstep,
  type QuickGrassSettings,
  type GrassPatch,
  type GrassExclusion,
} from "@rustcraft/shared";
import { GRASS_VS, GRASS_FS } from "./shaders";

/**
 * Quick Grass field — ported from quick-grass-1.html's patch-pooling /
 * instanced-blade-per-vertex-shader trick (see ./REFERENCE.html), adapted to
 * render onto an authored region heightmap + painted GrassPatch coverage
 * instead of the demo's procedural terrain and always-on field.
 *
 * One InstancedBufferGeometry "patch" (thousands of blades, one draw call)
 * is reused across a small pool of THREE.Mesh instances that get
 * repositioned every frame to wherever they're needed near the camera —
 * exactly the demo's poolHigh/poolLow + takePatch()/updatePatches() scheme.
 */

/** Distance ratio (0 = patch center, 1 = patch edge) past which per-cell
 *  density tapers smoothly to zero instead of a hard circular cutoff —
 *  mirrors grassField.ts's GRASS_FEATHER_START so quick-grass patches read
 *  consistently with the legacy instanced-blade field. */
const GRASS_FEATHER_START = 0.55;

/** Density threshold below which a patch cell isn't worth a draw call (its
 *  blades would mostly collapse to zero height anyway — see shaders.ts's
 *  `dens < 0.02` blade-collapse rule). */
const MIN_SPAWN_DENSITY = 0.02;

const MAX_PATCHES = 520;

export interface QuickGrassHeightmap {
  gridSize: number;
  pitch: number;
  heights: Float32Array | number[];
}

export interface QuickGrassField {
  group: THREE.Group;
  getSettings(): QuickGrassSettings;
  setSettings(partial: Partial<QuickGrassSettings>): void;
  /** Upload heightmap texture (call when terrain changes). */
  setHeightmap(hm: QuickGrassHeightmap): void;
  /** Rasterize paint strokes into density texture (call after paint/erase). */
  setCoverage(patches: GrassPatch[], exclusions?: GrassExclusion[]): void;
  /** Player/orb position for blade push. */
  setPlayer(x: number, y: number, z: number): void;
  /** Optional sun override from scene lights; pass null to clear and fall
   *  back to settings elevation/azimuth. */
  setSunFromLight(dir: THREE.Vector3 | null, color?: THREE.Color, intensity?: number): void;
  /** Stream patches around camera + advance wind time. Call every frame. */
  update(camera: THREE.Camera, dt: number): void;
  /** Force geometry rebuild (segments / bladesPerPatch / patchSize). */
  rebuild(): void;
  dispose(): void;
  stats(): { patches: number; blades: number; tris: number };
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds the instanced ribbon-blade geometry for one patch — identical to
 *  the demo's createGrassGeometry(): two quad ribbons per blade (front +
 *  back, wound in reverse) and one jittered-grid offset per instance. */
function createGrassGeometry(segments: number, count: number, patchSize: number): THREE.InstancedBufferGeometry {
  const VERTICES = (segments + 1) * 2;

  const indices: number[] = [];
  for (let i = 0; i < segments; ++i) {
    const vi = i * 2;
    indices.push(vi + 0, vi + 1, vi + 2, vi + 2, vi + 1, vi + 3);
    const fi = VERTICES + vi;
    indices.push(fi + 2, fi + 1, fi + 0, fi + 3, fi + 1, fi + 2);
  }

  const vertID = new Float32Array(VERTICES * 2);
  for (let i = 0; i < VERTICES * 2; ++i) vertID[i] = i;

  const rand = mulberry32(1337);
  const offsets = new Float32Array(count * 3);
  const cols = Math.ceil(Math.sqrt(count));
  const cell = patchSize / cols;
  for (let i = 0; i < count; ++i) {
    const cx = i % cols;
    const cz = Math.floor(i / cols);
    offsets[i * 3 + 0] = -patchSize * 0.5 + (cx + rand()) * cell;
    offsets[i * 3 + 1] = -patchSize * 0.5 + (cz + rand()) * cell; // read as world Z
    offsets[i * 3 + 2] = 0;
  }

  const geo = new THREE.InstancedBufferGeometry();
  geo.instanceCount = count;
  geo.setAttribute("vertIndex", new THREE.Float32BufferAttribute(vertID, 1));
  geo.setAttribute("position", new THREE.InstancedBufferAttribute(offsets, 3));
  geo.setIndex(indices);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), patchSize * 2 + 8);
  return geo;
}

/** Shared per-field uniforms — analogous to the demo's module-level `U`,
 *  but scoped per field so multiple grass fields (e.g. editor + runtime)
 *  don't fight over one set of GPU resources. */
interface QuickGrassUniforms {
  uTime: THREE.IUniform<number>;
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSkyHorizon: THREE.IUniform<THREE.Color>;
  uSkyZenith: THREE.IUniform<THREE.Color>;
  uSunColour: THREE.IUniform<THREE.Color>;
  uSunGlow: THREE.IUniform<THREE.Color>;
  uGroundColour: THREE.IUniform<THREE.Color>;
  uSunIntensity: THREE.IUniform<number>;
  uHaze: THREE.IUniform<number>;
  uExposure: THREE.IUniform<number>;
  uAmbient: THREE.IUniform<number>;
  uTranslucency: THREE.IUniform<number>;
  uBaseColour: THREE.IUniform<THREE.Color>;
  uTipColour: THREE.IUniform<THREE.Color>;
  uColourVar: THREE.IUniform<number>;
  uGrassSize: THREE.IUniform<THREE.Vector2>;
  uGrassDraw: THREE.IUniform<THREE.Vector2>;
  uPatchSize: THREE.IUniform<number>;
  uWind: THREE.IUniform<THREE.Vector4>;
  uPlayerPos: THREE.IUniform<THREE.Vector3>;
  uPush: THREE.IUniform<THREE.Vector2>;
  uCurve: THREE.IUniform<number>;
  uRound: THREE.IUniform<number>;
  uThicken: THREE.IUniform<number>;
  uNormalUp: THREE.IUniform<number>;
  uShowLod: THREE.IUniform<number>;
  uHeightMap: THREE.IUniform<THREE.Texture | null>;
  uDensityMap: THREE.IUniform<THREE.Texture | null>;
  uMapRect: THREE.IUniform<THREE.Vector4>;
  uMapTexel: THREE.IUniform<THREE.Vector2>;
  [key: string]: THREE.IUniform;
}

function createUniforms(settings: QuickGrassSettings): QuickGrassUniforms {
  return {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSkyHorizon: { value: new THREE.Color(0x53709c).convertSRGBToLinear() },
    uSkyZenith: { value: new THREE.Color(0x0e1730).convertSRGBToLinear() },
    uSunColour: { value: new THREE.Color(0xfff0d2).convertSRGBToLinear() },
    uSunGlow: { value: new THREE.Color(0x40506a).convertSRGBToLinear() },
    uGroundColour: { value: new THREE.Color(0x1b2114).convertSRGBToLinear() },
    uSunIntensity: { value: settings.sunIntensity },
    uHaze: { value: settings.haze },
    uExposure: { value: settings.exposure },
    uAmbient: { value: settings.ambient },
    uTranslucency: { value: settings.translucency },
    uBaseColour: { value: new THREE.Color(settings.baseColour).convertSRGBToLinear() },
    uTipColour: { value: new THREE.Color(settings.tipColour).convertSRGBToLinear() },
    uColourVar: { value: settings.colourVariation },
    uGrassSize: { value: new THREE.Vector2(settings.bladeWidth, settings.bladeHeight) },
    uGrassDraw: { value: new THREE.Vector2(settings.detailDistance, settings.drawDistance) },
    uPatchSize: { value: settings.patchSize },
    uWind: {
      value: new THREE.Vector4(settings.windStrength, settings.windSpeed, settings.gustScale, settings.windDrift),
    },
    uPlayerPos: { value: new THREE.Vector3() },
    uPush: { value: new THREE.Vector2(settings.pushRadius, settings.pushStrength) },
    uCurve: { value: settings.curvature },
    uRound: { value: settings.roundness },
    uThicken: { value: settings.thickening },
    uNormalUp: { value: settings.normalFlatten },
    uShowLod: { value: settings.showLod ? 1 : 0 },
    uHeightMap: { value: null },
    uDensityMap: { value: null },
    uMapRect: { value: new THREE.Vector4(-1, -1, 2, 2) },
    uMapTexel: { value: new THREE.Vector2(1, 1) },
  };
}

function createGrassMaterial(
  shared: QuickGrassUniforms,
  lodColour: number,
  heightVariation: number,
  tipTaper: number,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: GRASS_VS,
    fragmentShader: GRASS_FS,
    side: THREE.DoubleSide,
    glslVersion: THREE.GLSL1,
    // Custom tonemap in the fragment shader — don't let the renderer ACES it again
    // (that crushed blades to near-black against the lit terrain).
    toneMapped: false,
    depthTest: true,
    depthWrite: true,
    uniforms: Object.assign({}, shared, {
      uGrassParams: { value: new THREE.Vector4(1, 4, heightVariation, tipTaper) },
      uLodColour: { value: new THREE.Color(lodColour) },
    }),
  });
}

/** Makes a DataTexture from a Float32Array of scalar samples.
 *  Uses RGBA Float (value in .r) — more reliable than RedFormat/R32F across
 *  WebGL1/2 and linear filtering, which often sampled painted density as 0. */
function makeFloatTexture(data: Float32Array, size: number): THREE.DataTexture {
  const rgba = new Float32Array(size * size * 4);
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    const o = i * 4;
    rgba[o] = v;
    rgba[o + 1] = v;
    rgba[o + 2] = v;
    rgba[o + 3] = 1;
  }
  const tex = new THREE.DataTexture(rgba, size, size, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Upload a scalar buffer into an existing RGBA float DataTexture (.r channel). */
function uploadScalarToRgbaTexture(tex: THREE.DataTexture, data: Float32Array): void {
  const rgba = tex.image.data as Float32Array;
  const n = data.length;
  for (let i = 0; i < n; i++) {
    const v = data[i]!;
    const o = i * 4;
    rgba[o] = v;
    rgba[o + 1] = v;
    rgba[o + 2] = v;
    rgba[o + 3] = 1;
  }
  tex.needsUpdate = true;
}

interface SunOverride {
  dir: THREE.Vector3;
  color: THREE.Color | null;
  intensity: number | null;
}

interface Cell {
  x: number;
  z: number;
  d: number;
}

export function createQuickGrassField(
  parent: THREE.Object3D,
  initialSettings?: Partial<QuickGrassSettings>,
): QuickGrassField {
  let settings: QuickGrassSettings = mergeQuickGrassSettings(initialSettings);

  const group = new THREE.Group();
  group.name = "QuickGrassField";
  parent.add(group);

  const U = createUniforms(settings);
  const matHigh = createGrassMaterial(U, 0xff4d3d, settings.heightVariation, settings.tipTaper);
  const matLow = createGrassMaterial(U, 0x3d7bff, settings.heightVariation, settings.tipTaper);

  let geoHigh: THREE.InstancedBufferGeometry | null = null;
  let geoLow: THREE.InstancedBufferGeometry | null = null;
  const poolHigh: THREE.Mesh[] = [];
  const poolLow: THREE.Mesh[] = [];
  const cursor = { high: 0, low: 0 };

  let heightmapState: { gridSize: number; pitch: number; heights: Float32Array } | null = null;
  let densityBuffer: Float32Array | null = null;
  let densityTexture: THREE.DataTexture | null = null;
  let heightTexture: THREE.DataTexture | null = null;
  let coveragePatches: GrassPatch[] = [];
  let coverageExclusions: GrassExclusion[] = [];

  let sunOverride: SunOverride | null = null;
  let shaderTime = Math.random() * 10;
  let needsRebuild = false;
  let lastStats = { patches: 0, blades: 0, tris: 0 };

  function takePatch(pool: THREE.Mesh[], key: "high" | "low", geo: THREE.InstancedBufferGeometry, mat: THREE.Material): THREE.Mesh | null {
    const i = cursor[key]++;
    if (i < pool.length) return pool[i]!;
    if (pool.length >= MAX_PATCHES) return null;
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.visible = false;
    pool.push(m);
    group.add(m);
    return m;
  }

  function hideAllPatches(): void {
    for (const m of poolHigh) m.visible = false;
    for (const m of poolLow) m.visible = false;
    cursor.high = 0;
    cursor.low = 0;
  }

  function rebuildGrass(): void {
    for (const m of poolHigh) group.remove(m);
    for (const m of poolLow) group.remove(m);
    poolHigh.length = 0;
    poolLow.length = 0;
    cursor.high = 0;
    cursor.low = 0;
    geoHigh?.dispose();
    geoLow?.dispose();

    const segHigh = settings.segments | 0;
    const segLow = 1;
    geoHigh = createGrassGeometry(segHigh, settings.bladesPerPatch | 0, settings.patchSize);
    geoLow = createGrassGeometry(segLow, settings.bladesPerPatch | 0, settings.patchSize);

    (matHigh.uniforms.uGrassParams!.value as THREE.Vector4).set(segHigh, (segHigh + 1) * 2, settings.heightVariation, settings.tipTaper);
    (matLow.uniforms.uGrassParams!.value as THREE.Vector4).set(segLow, (segLow + 1) * 2, settings.heightVariation, settings.tipTaper);
    needsRebuild = false;
  }

  function ensureDensityBuffer(gridSize: number): void {
    if (densityBuffer && densityBuffer.length === gridSize * gridSize) return;
    densityBuffer = new Float32Array(gridSize * gridSize);
    densityTexture?.dispose();
    densityTexture = makeFloatTexture(densityBuffer, gridSize);
    U.uDensityMap.value = densityTexture;
  }

  /** Rasterize the stored paint strokes (GrassPatch circles minus
   *  GrassExclusion holes) into the CPU density buffer, then upload it. */
  function rasterizeDensity(): void {
    if (!heightmapState || !densityBuffer || !densityTexture) return;
    const { gridSize, pitch } = heightmapState;
    const half = ((gridSize - 1) * pitch) / 2;
    densityBuffer.fill(0);

    for (const patch of coveragePatches) {
      if (patch.radius <= 0 || patch.density <= 0) continue;
      const gx0 = Math.max(0, Math.floor((patch.localX - patch.radius + half) / pitch));
      const gx1 = Math.min(gridSize - 1, Math.ceil((patch.localX + patch.radius + half) / pitch));
      const gz0 = Math.max(0, Math.floor((patch.localZ - patch.radius + half) / pitch));
      const gz1 = Math.min(gridSize - 1, Math.ceil((patch.localZ + patch.radius + half) / pitch));
      for (let gz = gz0; gz <= gz1; gz++) {
        const wz = gz * pitch - half;
        for (let gx = gx0; gx <= gx1; gx++) {
          const wx = gx * pitch - half;
          const ratio = dist2D(wx, wz, patch.localX, patch.localZ) / patch.radius;
          if (ratio > 1) continue;
          const edgeFalloff =
            ratio <= GRASS_FEATHER_START ? 1 : 1 - smoothstep((ratio - GRASS_FEATHER_START) / (1 - GRASS_FEATHER_START));
          const dens = patch.density * edgeFalloff;
          const idx = gz * gridSize + gx;
          if (dens > densityBuffer[idx]!) densityBuffer[idx] = dens;
        }
      }
    }

    for (const ex of coverageExclusions) {
      if (ex.radius <= 0 || ex.strength <= 0) continue;
      const gx0 = Math.max(0, Math.floor((ex.localX - ex.radius + half) / pitch));
      const gx1 = Math.min(gridSize - 1, Math.ceil((ex.localX + ex.radius + half) / pitch));
      const gz0 = Math.max(0, Math.floor((ex.localZ - ex.radius + half) / pitch));
      const gz1 = Math.min(gridSize - 1, Math.ceil((ex.localZ + ex.radius + half) / pitch));
      for (let gz = gz0; gz <= gz1; gz++) {
        const wz = gz * pitch - half;
        for (let gx = gx0; gx <= gx1; gx++) {
          const wx = gx * pitch - half;
          const ratio = dist2D(wx, wz, ex.localX, ex.localZ) / ex.radius;
          if (ratio > 1) continue;
          const falloff = 1 - smoothstep(ratio); // 1 at the exclusion center, 0 at its edge
          const idx = gz * gridSize + gx;
          densityBuffer[idx] = densityBuffer[idx]! * (1 - ex.strength * falloff);
        }
      }
    }

    uploadScalarToRgbaTexture(densityTexture, densityBuffer);
  }

  /** Max density inside a patch-sized cell — center-only sampling missed brush
   *  dabs that didn't land on the 10 m grid point, so nothing ever spawned. */
  function sampleDensityInCell(cx: number, cz: number, size: number): number {
    if (!heightmapState || !densityBuffer) return 0;
    const { gridSize, pitch } = heightmapState;
    const half = ((gridSize - 1) * pitch) / 2;
    const halfCell = size * 0.5;
    const gx0 = Math.max(0, Math.floor((cx - halfCell + half) / pitch));
    const gx1 = Math.min(gridSize - 1, Math.ceil((cx + halfCell + half) / pitch));
    const gz0 = Math.max(0, Math.floor((cz - halfCell + half) / pitch));
    const gz1 = Math.min(gridSize - 1, Math.ceil((cz + halfCell + half) / pitch));
    let max = 0;
    for (let gz = gz0; gz <= gz1; gz++) {
      const row = gz * gridSize;
      for (let gx = gx0; gx <= gx1; gx++) {
        const d = densityBuffer[row + gx] ?? 0;
        if (d > max) max = d;
      }
    }
    return max;
  }

  /** Keep uMapRect in world space so shader sampleHeight/sampleDensity
   *  (which use modelMatrix world XZ) line up with local paint coverage even
   *  when the field group is parented under an offset region root. */
  function syncMapRectWorld(): void {
    if (!heightmapState) return;
    const { gridSize, pitch } = heightmapState;
    const half = ((gridSize - 1) * pitch) / 2;
    const span = (gridSize - 1) * pitch;
    group.getWorldPosition(groupWorldPos);
    U.uMapRect.value.set(groupWorldPos.x - half, groupWorldPos.z - half, span, span);
  }

  /** Bilinear CPU height sample, mirroring shared regions.ts's
   *  sampleRegionHeight — used only for the (approximate, culling-only)
   *  patch bounding box center; the shader re-derives the real per-blade
   *  height from the GPU heightmap texture. */
  function sampleHeightCPU(x: number, z: number): number {
    if (!heightmapState) return 0;
    const { gridSize, pitch, heights } = heightmapState;
    const half = ((gridSize - 1) * pitch) / 2;
    const gx = (x + half) / pitch;
    const gz = (z + half) / pitch;
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const tx = Math.min(1, Math.max(0, gx - x0));
    const tz = Math.min(1, Math.max(0, gz - z0));
    const cx0 = Math.min(gridSize - 1, Math.max(0, x0));
    const cx1 = Math.min(gridSize - 1, Math.max(0, x0 + 1));
    const cz0 = Math.min(gridSize - 1, Math.max(0, z0));
    const cz1 = Math.min(gridSize - 1, Math.max(0, z0 + 1));
    const h00 = heights[cz0 * gridSize + cx0] ?? 0;
    const h10 = heights[cz0 * gridSize + cx1] ?? 0;
    const h01 = heights[cz1 * gridSize + cx0] ?? 0;
    const h11 = heights[cz1 * gridSize + cx1] ?? 0;
    const a = h00 + (h10 - h00) * tx;
    const b = h01 + (h11 - h01) * tx;
    return a + (b - a) * tz;
  }

  function pushUniforms(): void {
    U.uGrassSize.value.set(settings.bladeWidth, settings.bladeHeight);
    U.uGrassDraw.value.set(settings.detailDistance, settings.drawDistance);
    U.uPatchSize.value = settings.patchSize;
    U.uWind.value.set(settings.windStrength, settings.windSpeed, settings.gustScale, settings.windDrift);
    U.uPush.value.set(settings.pushRadius, settings.pushStrength);
    U.uCurve.value = settings.curvature;
    U.uRound.value = settings.roundness;
    U.uThicken.value = settings.thickening;
    U.uNormalUp.value = settings.normalFlatten;
    U.uColourVar.value = settings.colourVariation;
    U.uAmbient.value = settings.ambient;
    U.uTranslucency.value = settings.translucency;
    U.uHaze.value = settings.haze;
    U.uExposure.value = settings.exposure;
    U.uShowLod.value = settings.showLod ? 1 : 0;
    U.uBaseColour.value.set(settings.baseColour).convertSRGBToLinear();
    U.uTipColour.value.set(settings.tipColour).convertSRGBToLinear();

    if (sunOverride) {
      U.uSunDir.value.copy(sunOverride.dir);
      if (sunOverride.color) U.uSunColour.value.copy(sunOverride.color);
      U.uSunIntensity.value = sunOverride.intensity ?? settings.sunIntensity;
      // Match blade sky-ambient to the remapped key light so night isn't a
      // black field under a still-bright ambient term (or vice versa).
      const i = sunOverride.intensity ?? settings.sunIntensity;
      U.uAmbient.value = settings.ambient * Math.min(1.15, Math.max(0.45, i / 1.1));
    } else {
      const el = (settings.sunElevation * Math.PI) / 180;
      const az = (settings.sunAzimuth * Math.PI) / 180;
      U.uSunDir.value.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
      U.uSunIntensity.value = settings.sunIntensity;
      U.uAmbient.value = settings.ambient;
    }

    (matHigh.uniforms.uGrassParams!.value as THREE.Vector4).z = settings.heightVariation;
    (matHigh.uniforms.uGrassParams!.value as THREE.Vector4).w = settings.tipTaper;
    (matLow.uniforms.uGrassParams!.value as THREE.Vector4).z = settings.heightVariation;
    (matLow.uniforms.uGrassParams!.value as THREE.Vector4).w = settings.tipTaper;

    matHigh.wireframe = settings.wireframe;
    matLow.wireframe = settings.wireframe;
  }

  const tmpCenter = new THREE.Vector3();
  const camWorldPos = new THREE.Vector3();
  const groupWorldPos = new THREE.Vector3();
  const camLocalXZ = new THREE.Vector3();
  const camForDistance = new THREE.Vector3();
  let cells: Cell[] = [];
  /** Last-frame high-LOD membership — hysteresis stops near/far geo flipping
   *  every few frames (reads as a 1–3 s grass "flicker" with camera bob). */
  const lodHigh = new Map<string, boolean>();
  /** Sticky visible set so MAX_PATCHES thrashing doesn't pop the same cells. */
  const stickyVisible = new Set<string>();

  function cellKey(cx: number, cz: number): string {
    return `${cx}|${cz}`;
  }

  /** Streams patches around the camera within drawDistance. Distance-only
   *  (no frustum cull) — frustum edge tests strobed patches when the orbit
   *  camera bobbed. High/low LOD still uses hysteresis below. */
  function updatePatches(camera: THREE.Camera): { patches: number; blades: number; tris: number } {
    if (!geoHigh || !geoLow || !heightmapState) return { patches: 0, blades: 0, tris: 0 };

    hideAllPatches();

    const size = settings.patchSize;
    const maxD = settings.drawDistance;
    const lodD = settings.detailDistance;
    const lodEnter = lodD * 0.88;
    const lodExit = lodD * 1.22;
    // Keep cells a bit past drawDistance so they don't pop when distance
    // oscillates around the cutoff (walk bob / smooth camera).
    const keepD = maxD * 1.12;

    camera.getWorldPosition(camWorldPos);
    group.getWorldPosition(groupWorldPos);
    camLocalXZ.set(camWorldPos.x - groupWorldPos.x, 0, camWorldPos.z - groupWorldPos.z);

    const half = ((heightmapState.gridSize - 1) * heightmapState.pitch) / 2;
    const boundPad = size * 0.5;

    const bx = Math.floor(camLocalXZ.x / size) * size;
    const bz = Math.floor(camLocalXZ.z / size) * size;
    const reach = Math.ceil(keepD / size) + 1;

    let n = 0;
    for (let x = -reach; x <= reach; ++x) {
      for (let z = -reach; z <= reach; ++z) {
        const cx = bx + x * size;
        const cz = bz + z * size;
        if (Math.abs(cx) > half + boundPad || Math.abs(cz) > half + boundPad) continue;
        if (sampleDensityInCell(cx, cz, size) <= MIN_SPAWN_DENSITY) continue;

        const cellHeight = sampleHeightCPU(cx, cz);
        tmpCenter.set(cx + groupWorldPos.x, cellHeight + groupWorldPos.y, cz + groupWorldPos.z);
        camForDistance.set(camWorldPos.x, tmpCenter.y, camWorldPos.z);
        const dx = tmpCenter.x - camForDistance.x;
        const dz = tmpCenter.z - camForDistance.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        const key = cellKey(cx, cz);
        const wasVisible = stickyVisible.has(key);
        if (d > (wasVisible ? keepD : maxD)) continue;

        if (!cells[n]) cells[n] = { x: 0, z: 0, d: 0 };
        const c = cells[n++]!;
        c.x = cx;
        c.z = cz;
        c.d = d;
      }
    }

    let list = cells.slice(0, n);
    if (n > MAX_PATCHES) {
      list.sort((a, b) => {
        const aSticky = stickyVisible.has(cellKey(a.x, a.z)) ? 0 : 1;
        const bSticky = stickyVisible.has(cellKey(b.x, b.z)) ? 0 : 1;
        if (aSticky !== bSticky) return aSticky - bSticky;
        return a.d - b.d;
      });
      list.length = MAX_PATCHES;
    }

    stickyVisible.clear();
    const seenLod = new Set<string>();

    let patches = 0;
    let blades = 0;
    let tris = 0;
    const bladesHigh = geoHigh.instanceCount;
    const bladesLow = geoLow.instanceCount;
    const segHigh = settings.segments | 0;

    for (const c of list) {
      const key = cellKey(c.x, c.z);
      stickyVisible.add(key);
      seenLod.add(key);
      const wasHigh = lodHigh.get(key) ?? c.d <= lodD;
      const near = wasHigh ? c.d <= lodExit : c.d <= lodEnter;
      lodHigh.set(key, near);

      const m = near ? takePatch(poolHigh, "high", geoHigh, matHigh) : takePatch(poolLow, "low", geoLow, matLow);
      if (!m) continue;
      m.position.set(c.x, 0, c.z);
      m.visible = true;
      patches++;
      blades += near ? bladesHigh : bladesLow;
      tris += (near ? bladesHigh * segHigh : bladesLow) * 4;
    }

    for (const key of [...lodHigh.keys()]) {
      if (!seenLod.has(key)) lodHigh.delete(key);
    }

    return { patches, blades, tris };
  }

  rebuildGrass();

  const field: QuickGrassField = {
    group,
    getSettings() {
      // Defensive spread under DEFAULT_QUICK_GRASS_SETTINGS so a caller never
      // sees an incomplete object even if a future field misses a default.
      return { ...DEFAULT_QUICK_GRASS_SETTINGS, ...settings };
    },
    setSettings(partial) {
      const prev = settings;
      settings = { ...settings, ...partial };
      if (
        (partial.bladesPerPatch !== undefined && partial.bladesPerPatch !== prev.bladesPerPatch) ||
        (partial.patchSize !== undefined && partial.patchSize !== prev.patchSize) ||
        (partial.segments !== undefined && partial.segments !== prev.segments)
      ) {
        needsRebuild = true;
      }
    },
    setHeightmap(hm) {
      const heights = hm.heights instanceof Float32Array ? hm.heights : Float32Array.from(hm.heights);
      heightTexture?.dispose();
      heightTexture = makeFloatTexture(heights, hm.gridSize);
      U.uHeightMap.value = heightTexture;

      heightmapState = { gridSize: hm.gridSize, pitch: hm.pitch, heights };
      U.uMapTexel.value.set(1 / hm.gridSize, 1 / hm.gridSize);
      syncMapRectWorld();

      ensureDensityBuffer(hm.gridSize);
      rasterizeDensity();
    },
    setCoverage(patches, exclusions) {
      coveragePatches = patches;
      coverageExclusions = exclusions ?? [];
      if (heightmapState) rasterizeDensity();
    },
    setPlayer(x, y, z) {
      U.uPlayerPos.value.set(x, y, z);
    },
    setSunFromLight(dir, color, intensity) {
      if (!dir) {
        sunOverride = null;
        return;
      }
      // Quick Grass does its own tonemap (toneMapped: false). Scene light
      // intensities are authored for MeshLambert + ACES — remap into the
      // grass shader's ~0.4..1.5 working range and keep a night floor so
      // blades don't crush to black while still reading day/night.
      const sceneI = intensity ?? settings.sunIntensity;
      const grassI = Math.min(1.55, Math.max(0.35, sceneI * 0.85 + 0.2));
      sunOverride = {
        dir: dir.clone().normalize(),
        color: color ? color.clone() : null,
        intensity: grassI,
      };
    },
    update(camera, dt) {
      if (needsRebuild) rebuildGrass();
      if (!heightmapState) {
        hideAllPatches();
        lastStats = { patches: 0, blades: 0, tris: 0 };
        return;
      }
      if (!settings.freezeWind) shaderTime += dt;
      U.uTime.value = shaderTime;
      syncMapRectWorld();
      pushUniforms();
      lastStats = updatePatches(camera);
    },
    rebuild() {
      rebuildGrass();
    },
    dispose() {
      for (const m of poolHigh) group.remove(m);
      for (const m of poolLow) group.remove(m);
      poolHigh.length = 0;
      poolLow.length = 0;
      geoHigh?.dispose();
      geoLow?.dispose();
      matHigh.dispose();
      matLow.dispose();
      heightTexture?.dispose();
      densityTexture?.dispose();
      parent.remove(group);
      cells = [];
      lodHigh.clear();
      stickyVisible.clear();
    },
    stats() {
      return lastStats;
    },
  };

  return field;
}
