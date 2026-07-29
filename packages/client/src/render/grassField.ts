import * as THREE from "three";
import {
  hash2,
  dist2D,
  fbm,
  smoothstep,
  sampleRegionHeight,
  type GrassPatch,
  type GrassExclusion,
  type GrassColor,
  type RegionWind,
  type RegionBlueprint,
} from "@rustcraft/shared";
import { makeBladeGeometry, makeBladeMaterial, createGrassBladeUniforms, type GrassBladeUniforms } from "./grassBlade";
import { applyRegionWind } from "./windSway";

/** Matches grassBlade.ts's own uWindStrength default -- a RegionWind at
 *  strength 1 reproduces the pre-existing hardcoded sway amplitude. */
const BASE_GRASS_WIND_STRENGTH = 0.3;

/** Distance ratio (0 = patch center, 1 = patch edge) past which per-cell
 *  inclusion density tapers smoothly to zero, instead of a hard circular
 *  cutoff -- avoids a visible fence-like edge where a brush stroke ends. */
const GRASS_FEATHER_START = 0.55;

/** Meters between candidate blade cells within a patch, jittered -- tighter
 *  than the open-world ambient grass's 3.4m cell (see render/grass.ts) since
 *  these blades are individually visible up close, not a distant tuft impostor. */
const GRASS_BLADE_CELL = 0.35;

/** Spatial culling chunk size, matching the open-world ambient grass's own
 *  40m chunk (not RegionInteriorRenderer's 80m building/prop chunk) -- grass
 *  needs a tighter cell so Three.js's free per-object frustum culling has
 *  something worth skipping. */
const GRASS_CHUNK_SIZE = 40;

/** Runtime streaming radius -- chunks farther than this are removed from the
 *  scene (and their instance buffers disposed) until the player walks back. */
const GRASS_STREAM_RADIUS = 95;

const BLADE_WIDTH = 0.06;
const BLADE_HEIGHT = 0.28;

const BLADE_GEOMETRY = makeBladeGeometry();

export interface GrassField {
  meshes: THREE.InstancedMesh[];
  uniforms: GrassBladeUniforms;
  /** When streaming, call each frame with the viewer position. No-op for
   *  eagerly-built editor previews. */
  update(px: number, pz: number): void;
  dispose(): void;
}

export interface GrassVisualOptions {
  color?: GrassColor;
  wind?: RegionWind;
  /**
   * When true (runtime regions), only build InstancedMeshes for chunks near
   * the player. When false (editor preview), build every chunk immediately.
   */
  stream?: boolean;
  /** Parent group to add/remove streamed chunk meshes. Required when stream. */
  parent?: THREE.Object3D;
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
  color: THREE.Color;
}

interface ChunkKey {
  cx: number;
  cz: number;
  key: string;
}

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

function collectBlades(
  patches: GrassPatch[],
  exclusions: GrassExclusion[] | undefined,
  heightmap: Pick<RegionBlueprint, "gridSize" | "pitch" | "heights">,
): Map<string, Blade[]> {
  const chunks = new Map<string, Blade[]>();

  for (const patch of patches) {
    if (patch.radius <= 0 || patch.density <= 0) continue;
    const patchLength = patch.lengthScale ?? 1;
    const cells = Math.max(1, Math.ceil((patch.radius * 2) / GRASS_BLADE_CELL));
    const originX = patch.localX - patch.radius;
    const originZ = patch.localZ - patch.radius;

    for (let ix = 0; ix < cells; ix++) {
      for (let iz = 0; iz < cells; iz++) {
        const base = ix * 977 + iz;
        const jx = hash2(patch.seed + 11, base, 0);
        const jz = hash2(patch.seed + 13, base, 1);
        const x = originX + (ix + jx) * GRASS_BLADE_CELL;
        const z = originZ + (iz + jz) * GRASS_BLADE_CELL;
        if (
          exclusions &&
          exclusions.some((ex, exi) => {
            if (dist2D(x, z, ex.localX, ex.localZ) > ex.radius) return false;
            if (ex.strength >= 1) return true;
            return hash2(ex.seed + 61, base, exi) < ex.strength;
          })
        ) {
          continue;
        }

        const distRatio = dist2D(x, z, patch.localX, patch.localZ) / patch.radius;
        if (distRatio > 1) continue;
        const edgeFalloff =
          distRatio <= GRASS_FEATHER_START
            ? 1
            : 1 - smoothstep((distRatio - GRASS_FEATHER_START) / (1 - GRASS_FEATHER_START));

        const roll = hash2(patch.seed + 17, base, 2);
        if (roll > patch.density * edgeFalloff) continue;

        const y = sampleRegionHeight(heightmap, x, z);
        const yaw = hash2(patch.seed + 19, base, 3) * Math.PI * 2;
        const widthScale = 0.8 + hash2(patch.seed + 23, base, 4) * 0.5;

        const clumpCellSize = Math.max(1.2, patch.radius * 0.6);
        const lengthClump = fbm(patch.seed + 37, x, z, clumpCellSize, 2);
        const heightScale = 0.45 + lengthClump * 1.15 + hash2(patch.seed + 29, base, 5) * 0.25;

        const rMul = 0.85 + hash2(patch.seed + 41, base, 6) * 0.3;
        const gMul = 0.92 + hash2(patch.seed + 43, base, 7) * 0.16;
        const bMul = 0.7 + hash2(patch.seed + 47, base, 8) * 0.5;
        const color = new THREE.Color(rMul, gMul, bMul);

        const cx = Math.floor(x / GRASS_CHUNK_SIZE);
        const cz = Math.floor(z / GRASS_CHUNK_SIZE);
        const key = chunkKey(cx, cz);
        const blade: Blade = { x, y, z, yaw, widthScale, heightScale, lengthScale: patchLength, color };
        const list = chunks.get(key);
        if (list) list.push(blade);
        else chunks.set(key, [blade]);
      }
    }
  }

  return chunks;
}

function buildChunkMesh(blades: Blade[], material: THREE.Material): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(BLADE_GEOMETRY, material, blades.length);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(blades.length * 3), 3);
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scaleVec = new THREE.Vector3();
  for (let i = 0; i < blades.length; i++) {
    const b = blades[i]!;
    pos.set(b.x, b.y, b.z);
    quat.setFromAxisAngle(up, b.yaw);
    scaleVec.set(BLADE_WIDTH * b.widthScale, BLADE_HEIGHT * b.heightScale * b.lengthScale, BLADE_WIDTH * b.widthScale);
    matrix.compose(pos, quat, scaleVec);
    mesh.setMatrixAt(i, matrix);
    mesh.setColorAt(i, b.color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.sharedGeometry = true; // BLADE_GEOMETRY is module-shared
  return mesh;
}

/** Expand a region's painted grass patches into wind-shaded blade instances,
 *  chunked spatially. Deterministic: the same patches + heightmap always
 *  produce byte-identical instance transforms (editor preview and runtime
 *  must agree).
 *
 *  Pass `stream: true` + `parent` for runtime regions so only nearby chunks
 *  keep GPU instance buffers; the editor keeps the default eager build. */
export function buildGrassInstances(
  patches: GrassPatch[],
  exclusions: GrassExclusion[] | undefined,
  heightmap: Pick<RegionBlueprint, "gridSize" | "pitch" | "heights">,
  options?: GrassVisualOptions,
): GrassField {
  const uniforms = createGrassBladeUniforms(options?.color);
  if (options?.wind) applyRegionWind(uniforms, options.wind, BASE_GRASS_WIND_STRENGTH);
  const material = makeBladeMaterial(uniforms);
  const chunkBlades = collectBlades(patches, exclusions, heightmap);
  const stream = !!options?.stream;
  const parent = options?.parent;
  const visibleRadius = options?.visibleRadius ?? GRASS_STREAM_RADIUS;

  const liveMeshes = new Map<string, THREE.InstancedMesh>();
  const chunkCenters = new Map<string, ChunkKey & { x: number; z: number }>();
  for (const key of chunkBlades.keys()) {
    const [cx, cz] = key.split(",").map(Number) as [number, number];
    chunkCenters.set(key, {
      cx,
      cz,
      key,
      x: (cx + 0.5) * GRASS_CHUNK_SIZE,
      z: (cz + 0.5) * GRASS_CHUNK_SIZE,
    });
  }

  const ensureMesh = (key: string): THREE.InstancedMesh | null => {
    const existing = liveMeshes.get(key);
    if (existing) return existing;
    const blades = chunkBlades.get(key);
    if (!blades || blades.length === 0) return null;
    const mesh = buildChunkMesh(blades, material);
    liveMeshes.set(key, mesh);
    parent?.add(mesh);
    return mesh;
  };

  const dropMesh = (key: string): void => {
    const mesh = liveMeshes.get(key);
    if (!mesh) return;
    parent?.remove(mesh);
    // Dispose instance buffers only -- geometry is shared module-level.
    mesh.dispose();
    liveMeshes.delete(key);
  };

  if (!stream) {
    for (const key of chunkBlades.keys()) ensureMesh(key);
  }

  let lastPx = Number.NaN;
  let lastPz = Number.NaN;

  const field: GrassField = {
    get meshes() {
      return [...liveMeshes.values()];
    },
    uniforms,
    update(px: number, pz: number) {
      if (!stream || !parent) return;
      // Skip tiny moves -- rebuild window every ~4m of travel.
      if (Number.isFinite(lastPx) && dist2D(px, pz, lastPx, lastPz) < 4) return;
      lastPx = px;
      lastPz = pz;

      const wanted = new Set<string>();
      const margin = GRASS_CHUNK_SIZE * 0.71;
      for (const meta of chunkCenters.values()) {
        if (dist2D(px, pz, meta.x, meta.z) <= visibleRadius + margin) wanted.add(meta.key);
      }
      for (const key of wanted) ensureMesh(key);
      for (const key of [...liveMeshes.keys()]) {
        if (!wanted.has(key)) dropMesh(key);
      }
    },
    dispose() {
      for (const key of [...liveMeshes.keys()]) dropMesh(key);
      material.dispose();
      chunkBlades.clear();
    },
  };

  // Caller seeds the first window (region entry / editor shows all via !stream).
  return field;
}
