import * as THREE from "three";
import {
  hash2,
  dist2D,
  fbm,
  smoothstep,
  sampleRegionHeight,
  ADT_SIZE,
  adtIndex,
  adtKey,
  adtRingKeysInBounds,
  adtWorldBounds,
  parseAdtKey,
  ADT_GRASS_RING,
  type GrassPatch,
  type GrassExclusion,
  type GrassColor,
  type RegionWind,
  type RegionBlueprint,
} from "@rustcraft/shared";
import {
  makeBladeTuftGeometry,
  makeBladeMaterial,
  createGrassBladeUniforms,
  MAX_ROCKS,
  type GrassBladeUniforms,
} from "./grassBlade";
import { applyRegionWind } from "./windSway";
import type { StreamBudget } from "./streamBudget";

/** Matches grassBlade.ts's own uWindStrength default -- a RegionWind at
 *  strength 1 reproduces the pre-existing hardcoded sway amplitude. */
const BASE_GRASS_WIND_STRENGTH = 0.3;

/** Distance ratio (0 = patch center, 1 = patch edge) past which per-cell
 *  inclusion density tapers smoothly to zero, instead of a hard circular
 *  cutoff -- avoids a visible fence-like edge where a brush stroke ends. */
const GRASS_FEATHER_START = 0.55;

/** Meters between tuft instances. Each tuft draws ~4 blades, so this reads
 *  denser than single-blade spacing at the same instance budget. */
const GRASS_BLADE_CELL = 0.48;

/** Scratch color so collectBlades doesn't allocate a THREE.Color per blade. */
const BLADE_COLOR_SCRATCH = new THREE.Color();

/** ADT tile size for grass chunking (matches region/overworld terrain tiles). */
const GRASS_CHUNK_SIZE = ADT_SIZE;

const BLADE_WIDTH = 0.1;
const BLADE_HEIGHT = 0.45;

/** Exclusion hash-grid cell size -- trades a bit of memory for skipping the
 *  O(exclusions) scan on every candidate blade cell. */
const EXCLUSION_CELL = 8;

const BLADE_GEOMETRY = makeBladeTuftGeometry(3, 5);

export interface GrassTrampler {
  x: number;
  z: number;
  /** Influence radius in meters (player ~0.85). */
  radius: number;
}

export interface GrassField {
  meshes: THREE.InstancedMesh[];
  uniforms: GrassBladeUniforms;
  /** When streaming, call each frame with the viewer position. */
  update(px: number, pz: number, budget?: StreamBudget): void;
  /** Sync-build the ADT grass ring (region entry / loading screen). */
  warm(px: number, pz: number): void;
  /** Drive rock-trampling slots (player / mounts / nearby actors). */
  setTramplers(tramplers: GrassTrampler[]): void;
  /** Gust modulation on top of authored wind — call once per frame. */
  tickWind(dt: number): void;
  /** Re-apply authored region wind (updates gust baseline). */
  applyWind(wind: RegionWind): void;
  /** Grass-only motion amount (0..n); wind strength still multiplies on top. */
  setGrassSway(amount: number): void;
  /**
   * Re-expand blades and (re)build meshes. Pass `onlyKeys` to refresh just the
   * ADT tiles a brush stroke touched — full rebuild when omitted.
   */
  rebuild(
    patches: GrassPatch[],
    exclusions: GrassExclusion[] | undefined,
    heightmap: Pick<RegionBlueprint, "gridSize" | "pitch" | "heights">,
    onlyKeys?: Iterable<string>,
  ): void;
  /** Build up to `budgetCount` pending streamed chunk meshes. Returns remaining. */
  drain(budgetCount: number, timeBudget?: StreamBudget): number;
  dispose(): void;
}

export interface GrassVisualOptions {
  color?: GrassColor;
  wind?: RegionWind;
  /** Grass-only sway multiplier (default 1). Wind still scales motion. */
  grassSway?: number;
  /**
   * When true, only build InstancedMeshes for ADT tiles near the viewer.
   * Editor and runtime both benefit — editor used to eager-build everything.
   */
  stream?: boolean;
  /** Parent group to add/remove streamed chunk meshes. Required when stream. */
  parent?: THREE.Object3D;
  /** @deprecated Prefer ADT_GRASS_RING — kept for call-site overrides. */
  visibleRadius?: number;
}

interface Blade {
  x: number;
  y: number;
  z: number;
  yaw: number;
  widthScale: number;
  heightScale: number;
  lengthScale: number;
  /** Packed RGB 0–1 (avoids per-blade THREE.Color alloc). */
  r: number;
  g: number;
  b: number;
}

/** ADT keys whose tiles intersect a circle (brush stroke / patch footprint). */
export function grassKeysOverlapping(x: number, z: number, radius: number): string[] {
  const pad = Math.max(0, radius) + GRASS_BLADE_CELL;
  const ix0 = adtIndex(x - pad);
  const ix1 = adtIndex(x + pad);
  const iz0 = adtIndex(z - pad);
  const iz1 = adtIndex(z + pad);
  const keys: string[] = [];
  for (let iz = iz0; iz <= iz1; iz++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      keys.push(adtKey(ix, iz));
    }
  }
  return keys;
}

/** Spatial hash so each blade cell only tests nearby exclusions. */
class ExclusionIndex {
  private readonly cellSize: number;
  private readonly cells = new Map<string, { ex: GrassExclusion; index: number }[]>();

  constructor(exclusions: GrassExclusion[] | undefined, cellSize = EXCLUSION_CELL) {
    this.cellSize = cellSize;
    if (!exclusions || exclusions.length === 0) return;
    for (let exi = 0; exi < exclusions.length; exi++) {
      const ex = exclusions[exi]!;
      if (ex.radius <= 0 || ex.strength <= 0) continue;
      const ix0 = Math.floor((ex.localX - ex.radius) / cellSize);
      const ix1 = Math.floor((ex.localX + ex.radius) / cellSize);
      const iz0 = Math.floor((ex.localZ - ex.radius) / cellSize);
      const iz1 = Math.floor((ex.localZ + ex.radius) / cellSize);
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const key = `${ix}:${iz}`;
          const list = this.cells.get(key);
          const entry = { ex, index: exi };
          if (list) list.push(entry);
          else this.cells.set(key, [entry]);
        }
      }
    }
  }

  /** True if this cell should be culled by an exclusion. */
  rejects(x: number, z: number, base: number): boolean {
    if (this.cells.size === 0) return false;
    const ix = Math.floor(x / this.cellSize);
    const iz = Math.floor(z / this.cellSize);
    const list = this.cells.get(`${ix}:${iz}`);
    if (!list) return false;
    for (let i = 0; i < list.length; i++) {
      const { ex, index } = list[i]!;
      if (dist2D(x, z, ex.localX, ex.localZ) > ex.radius) continue;
      if (ex.strength >= 1) return true;
      if (hash2(ex.seed + 61, base, index) < ex.strength) return true;
    }
    return false;
  }
}

function tryEmitBlade(
  chunks: Map<string, Blade[]>,
  patch: GrassPatch,
  exclusionIndex: ExclusionIndex,
  heightmap: Pick<RegionBlueprint, "gridSize" | "pitch" | "heights">,
  ix: number,
  iz: number,
  originX: number,
  originZ: number,
  patchLength: number,
  onlyKeys?: Set<string>,
): void {
  const base = ix * 977 + iz;
  const jx = hash2(patch.seed + 11, base, 0);
  const jz = hash2(patch.seed + 13, base, 1);
  const x = originX + (ix + jx) * GRASS_BLADE_CELL;
  const z = originZ + (iz + jz) * GRASS_BLADE_CELL;

  const key = adtKey(adtIndex(x), adtIndex(z));
  if (onlyKeys && onlyKeys.size > 0 && !onlyKeys.has(key)) return;
  if (exclusionIndex.rejects(x, z, base)) return;

  const distRatio = dist2D(x, z, patch.localX, patch.localZ) / patch.radius;
  if (distRatio > 1) return;
  const edgeFalloff =
    distRatio <= GRASS_FEATHER_START
      ? 1
      : 1 - smoothstep((distRatio - GRASS_FEATHER_START) / (1 - GRASS_FEATHER_START));

  const roll = hash2(patch.seed + 17, base, 2);
  if (roll > patch.density * edgeFalloff) return;

  const y = sampleRegionHeight(heightmap, x, z);
  const yaw = hash2(patch.seed + 19, base, 3) * Math.PI * 2;
  const widthScale = 0.8 + hash2(patch.seed + 23, base, 4) * 0.5;

  const clumpCellSize = Math.max(1.2, patch.radius * 0.6);
  const lengthClump = fbm(patch.seed + 37, x, z, clumpCellSize, 2);
  const heightScale = 0.45 + lengthClump * 1.15 + hash2(patch.seed + 29, base, 5) * 0.25;

  const rMul = 0.85 + hash2(patch.seed + 41, base, 6) * 0.3;
  const gMul = 0.92 + hash2(patch.seed + 43, base, 7) * 0.16;
  const bMul = 0.7 + hash2(patch.seed + 47, base, 8) * 0.5;

  const blade: Blade = {
    x,
    y,
    z,
    yaw,
    widthScale,
    heightScale,
    lengthScale: patchLength,
    r: rMul,
    g: gMul,
    b: bMul,
  };
  const list = chunks.get(key);
  if (list) list.push(blade);
  else chunks.set(key, [blade]);
}

function collectBlades(
  patches: GrassPatch[],
  exclusions: GrassExclusion[] | undefined,
  heightmap: Pick<RegionBlueprint, "gridSize" | "pitch" | "heights">,
  onlyKeys?: Set<string>,
): Map<string, Blade[]> {
  const chunks = new Map<string, Blade[]>();
  const exclusionIndex = new ExclusionIndex(exclusions);

  for (const patch of patches) {
    if (patch.radius <= 0 || patch.density <= 0) continue;

    const patchLength = patch.lengthScale ?? 1;
    const cells = Math.max(1, Math.ceil((patch.radius * 2) / GRASS_BLADE_CELL));
    const originX = patch.localX - patch.radius;
    const originZ = patch.localZ - patch.radius;

    // Partial rebuild: only walk cells that land in the dirtied ADT tiles
    // (full nested loops over large patches were freezing erase strokes).
    if (onlyKeys && onlyKeys.size > 0) {
      let overlaps = false;
      for (const key of grassKeysOverlapping(patch.localX, patch.localZ, patch.radius)) {
        if (!onlyKeys.has(key)) continue;
        overlaps = true;
        const { ix: tx, iz: tz } = parseAdtKey(key);
        const bounds = adtWorldBounds(tx, tz);
        const minX = Math.max(originX, bounds.minX);
        const maxX = Math.min(originX + patch.radius * 2, bounds.maxX);
        const minZ = Math.max(originZ, bounds.minZ);
        const maxZ = Math.min(originZ + patch.radius * 2, bounds.maxZ);
        if (minX >= maxX || minZ >= maxZ) continue;
        const ix0 = Math.max(0, Math.floor((minX - originX) / GRASS_BLADE_CELL));
        const ix1 = Math.min(cells - 1, Math.ceil((maxX - originX) / GRASS_BLADE_CELL));
        const iz0 = Math.max(0, Math.floor((minZ - originZ) / GRASS_BLADE_CELL));
        const iz1 = Math.min(cells - 1, Math.ceil((maxZ - originZ) / GRASS_BLADE_CELL));
        for (let ix = ix0; ix <= ix1; ix++) {
          for (let iz = iz0; iz <= iz1; iz++) {
            tryEmitBlade(
              chunks,
              patch,
              exclusionIndex,
              heightmap,
              ix,
              iz,
              originX,
              originZ,
              patchLength,
              onlyKeys,
            );
          }
        }
      }
      if (!overlaps) continue;
      continue;
    }

    for (let ix = 0; ix < cells; ix++) {
      for (let iz = 0; iz < cells; iz++) {
        tryEmitBlade(
          chunks,
          patch,
          exclusionIndex,
          heightmap,
          ix,
          iz,
          originX,
          originZ,
          patchLength,
        );
      }
    }
  }

  return chunks;
}

/**
 * Build an InstancedMesh for one ADT grass tile.
 * `lodStep` > 1 keeps every Nth blade (outer ring tiles) to cut draw cost.
 */
function buildChunkMesh(blades: Blade[], material: THREE.Material, lodStep = 1): THREE.InstancedMesh {
  const step = Math.max(1, lodStep | 0);
  const count = Math.ceil(blades.length / step);
  const mesh = new THREE.InstancedMesh(BLADE_GEOMETRY, material, count);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scaleVec = new THREE.Vector3();
  let written = 0;
  for (let i = 0; i < blades.length && written < count; i += step) {
    const b = blades[i]!;
    pos.set(b.x, b.y, b.z);
    quat.setFromAxisAngle(up, b.yaw);
    scaleVec.set(BLADE_WIDTH * b.widthScale, BLADE_HEIGHT * b.heightScale * b.lengthScale, BLADE_WIDTH * b.widthScale);
    matrix.compose(pos, quat, scaleVec);
    mesh.setMatrixAt(written, matrix);
    BLADE_COLOR_SCRATCH.setRGB(b.r, b.g, b.b);
    mesh.setColorAt(written, BLADE_COLOR_SCRATCH);
    written++;
  }
  mesh.count = written;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = false;
  // Custom multi-tap shadow sampling in the blade shader is expensive; grass
  // reads ambient/key light only. Terrain still receives character shadows.
  mesh.receiveShadow = false;
  mesh.frustumCulled = true;
  mesh.userData.sharedGeometry = true; // BLADE_GEOMETRY is module-shared
  return mesh;
}

function chunkLodStep(key: string, px: number, pz: number): number {
  const { ix, iz } = parseAdtKey(key);
  const dx = Math.abs(ix - adtIndex(px));
  const dz = Math.abs(iz - adtIndex(pz));
  const chebyshev = Math.max(dx, dz);
  // Center tile full density; ring-1 tiles keep ~half the blades.
  return chebyshev <= 0 ? 1 : 2;
}

function refreshGrassBounds(chunkBlades: Map<string, Blade[]>): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const key of chunkBlades.keys()) {
    const { ix, iz } = parseAdtKey(key);
    const b = adtWorldBounds(ix, iz);
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minZ = Math.min(minZ, b.minZ);
    maxZ = Math.max(maxZ, b.maxZ);
  }
  if (!Number.isFinite(minX)) {
    return {
      minX: -GRASS_CHUNK_SIZE,
      maxX: GRASS_CHUNK_SIZE,
      minZ: -GRASS_CHUNK_SIZE,
      maxZ: GRASS_CHUNK_SIZE,
    };
  }
  return { minX, maxX, minZ, maxZ };
}

/** Expand a region's painted grass patches into wind-shaded blade instances,
 *  chunked spatially. Deterministic: the same patches + heightmap always
 *  produce byte-identical instance transforms (editor preview and runtime
 *  must agree).
 *
 *  Pass `stream: true` + `parent` so only nearby chunks keep GPU buffers —
 *  both runtime regions and the editor preview use this now. */
export function buildGrassInstances(
  patches: GrassPatch[],
  exclusions: GrassExclusion[] | undefined,
  heightmap: Pick<RegionBlueprint, "gridSize" | "pitch" | "heights">,
  options?: GrassVisualOptions,
): GrassField {
  const uniforms = createGrassBladeUniforms(options?.color);
  let baseWindStrength = BASE_GRASS_WIND_STRENGTH;
  let baseWindTurb = uniforms.uWindTurb.value;
  if (options?.wind) {
    applyRegionWind(uniforms, options.wind, BASE_GRASS_WIND_STRENGTH);
    baseWindStrength = uniforms.uWindStrength.value;
    baseWindTurb = uniforms.uWindTurb.value;
  }
  if (options?.grassSway !== undefined) {
    uniforms.uGrassSway.value = Math.max(0, options.grassSway);
  }
  const material = makeBladeMaterial(uniforms);
  const chunkBlades = collectBlades(patches, exclusions, heightmap);
  const stream = !!options?.stream;
  const parent = options?.parent;
  const grassRing = ADT_GRASS_RING;

  const liveMeshes = new Map<string, THREE.InstancedMesh>();
  const pending = new Set<string>();
  let grassBounds = refreshGrassBounds(chunkBlades);
  let gustT = Math.random() * 10;
  let lastPx = Number.NaN;
  let lastPz = Number.NaN;

  const dropMesh = (key: string): void => {
    const mesh = liveMeshes.get(key);
    if (!mesh) return;
    parent?.remove(mesh);
    mesh.dispose();
    liveMeshes.delete(key);
  };

  const ensureMesh = (key: string): THREE.InstancedMesh | null => {
    const lod = Number.isFinite(lastPx) ? chunkLodStep(key, lastPx, lastPz) : 1;
    const existing = liveMeshes.get(key);
    if (existing) {
      // Promote to full density when this tile becomes the viewer center.
      if ((existing.userData.lodStep as number | undefined) === lod || existing.userData.lodStep < lod) {
        return existing;
      }
      dropMesh(key);
    }
    const blades = chunkBlades.get(key);
    if (!blades || blades.length === 0) return null;
    const mesh = buildChunkMesh(blades, material, lod);
    mesh.userData.lodStep = lod;
    liveMeshes.set(key, mesh);
    parent?.add(mesh);
    return mesh;
  };

  if (!stream) {
    for (const key of chunkBlades.keys()) ensureMesh(key);
  }

  const field: GrassField = {
    get meshes() {
      return [...liveMeshes.values()];
    },
    uniforms,
    update(px: number, pz: number, budget?: StreamBudget) {
      if (!stream || !parent) return;
      if (Number.isFinite(lastPx) && dist2D(px, pz, lastPx, lastPz) < 4) {
        // Still drain pending under the shared ADT time slice even when the
        // viewer hasn't moved enough to refresh the wanted set.
        field.drain(1, budget);
        return;
      }
      lastPx = px;
      lastPz = pz;

      const wanted = new Set(adtRingKeysInBounds(px, pz, grassRing, grassBounds));
      const keepRing = grassRing + 1;
      const keep = new Set(adtRingKeysInBounds(px, pz, keepRing, grassBounds));
      for (const key of wanted) {
        if (!chunkBlades.has(key)) continue;
        pending.add(key);
        // Re-queue center tiles that were built at outer LOD so they promote.
        const live = liveMeshes.get(key);
        if (live && (live.userData.lodStep as number) > chunkLodStep(key, px, pz)) {
          dropMesh(key);
        }
      }
      for (const key of [...liveMeshes.keys()]) {
        if (!keep.has(key)) dropMesh(key);
      }
      field.drain(2, budget);
    },
    warm(px: number, pz: number) {
      if (!stream || !parent) return;
      lastPx = px;
      lastPz = pz;
      const wanted = adtRingKeysInBounds(px, pz, grassRing, grassBounds);
      for (const key of wanted) {
        if (chunkBlades.has(key)) ensureMesh(key);
      }
      pending.clear();
    },
    setTramplers(tramplers: GrassTrampler[]) {
      const rocks = uniforms.uRocks.value;
      const n = Math.min(MAX_ROCKS, tramplers.length);
      for (let i = 0; i < n; i++) {
        const t = tramplers[i]!;
        rocks[i]!.set(t.x, 0, t.z, t.radius);
      }
      uniforms.uRockCount.value = n;
    },
    tickWind(dt: number) {
      gustT += dt;
      const swell = 0.72 + 0.28 * Math.sin(gustT * 0.55) + 0.12 * Math.sin(gustT * 1.7 + 0.8);
      const turbPulse = 0.75 + 0.35 * Math.sin(gustT * 1.15 + 2.1);
      uniforms.uWindStrength.value = baseWindStrength * swell;
      uniforms.uWindTurb.value = baseWindTurb * turbPulse;
    },
    applyWind(wind: RegionWind) {
      applyRegionWind(uniforms, wind, BASE_GRASS_WIND_STRENGTH);
      baseWindStrength = uniforms.uWindStrength.value;
      baseWindTurb = uniforms.uWindTurb.value;
    },
    setGrassSway(amount: number) {
      uniforms.uGrassSway.value = Math.max(0, amount);
    },
    rebuild(nextPatches, nextExclusions, nextHeightmap, onlyKeys) {
      const keySet = onlyKeys ? new Set(onlyKeys) : undefined;
      if (!keySet || keySet.size === 0) {
        chunkBlades.clear();
        const fresh = collectBlades(nextPatches, nextExclusions, nextHeightmap);
        for (const [k, blades] of fresh) chunkBlades.set(k, blades);
        grassBounds = refreshGrassBounds(chunkBlades);
        for (const key of [...liveMeshes.keys()]) {
          dropMesh(key);
        }
        pending.clear();
        if (!stream) {
          for (const key of chunkBlades.keys()) ensureMesh(key);
        } else if (Number.isFinite(lastPx)) {
          const wanted = adtRingKeysInBounds(lastPx, lastPz, grassRing, grassBounds);
          for (const key of wanted) {
            if (chunkBlades.has(key)) pending.add(key);
          }
          field.drain(6);
        }
        return;
      }

      for (const key of keySet) chunkBlades.delete(key);
      const partial = collectBlades(nextPatches, nextExclusions, nextHeightmap, keySet);
      for (const [k, blades] of partial) chunkBlades.set(k, blades);
      grassBounds = refreshGrassBounds(chunkBlades);

      for (const key of keySet) {
        dropMesh(key);
        if (!chunkBlades.has(key)) {
          pending.delete(key);
          continue;
        }
        // Always build tiles the caller just dirtied — gating on the stream
        // window dropped editor brush strokes that weren't near lastPx.
        if (stream) pending.add(key);
        else ensureMesh(key);
      }
      if (stream) field.drain(Math.max(4, keySet.size));
    },
    drain(budgetCount: number, timeBudget?: StreamBudget) {
      let built = 0;
      for (const key of [...pending]) {
        if (built >= budgetCount) break;
        if (timeBudget && !timeBudget.ok) break;
        if (!chunkBlades.has(key) || liveMeshes.has(key)) {
          pending.delete(key);
          continue;
        }
        if (timeBudget && !timeBudget.takeBuild()) break;
        pending.delete(key);
        ensureMesh(key);
        built++;
      }
      return pending.size;
    },
    dispose() {
      for (const key of [...liveMeshes.keys()]) dropMesh(key);
      pending.clear();
      material.dispose();
      chunkBlades.clear();
      uniforms.uRockCount.value = 0;
    },
  };

  return field;
}
