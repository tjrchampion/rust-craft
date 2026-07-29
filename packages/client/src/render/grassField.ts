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

/** Base blade dimensions in meters, before per-instance random variation --
 *  the geometry itself is unit-sized (height 1, base width 1); the instance
 *  matrix scales it down to a real blade's actual slender size. */
const BLADE_WIDTH = 0.06;
const BLADE_HEIGHT = 0.28;

const BLADE_GEOMETRY = makeBladeGeometry();

export interface GrassField {
  meshes: THREE.InstancedMesh[];
  uniforms: GrassBladeUniforms;
}

export interface GrassVisualOptions {
  color?: GrassColor;
  wind?: RegionWind;
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

/** Expand a region's painted grass patches into wind-shaded blade instances,
 *  chunked spatially for frustum culling. Deterministic: the same patches +
 *  heightmap always produce byte-identical instance transforms, since the
 *  editor's live preview and the runtime RegionInteriorRenderer both call
 *  this and must agree on what a saved region actually looks like.
 *
 *  Overlapping patches (e.g. a dragged brush stroke) independently roll
 *  inclusion over the same world cells with different seeds, so density
 *  naturally increases in the overlap -- this is the intended "denser where
 *  you painted more" behavior, not a bug. */
export function buildGrassInstances(
  patches: GrassPatch[],
  exclusions: GrassExclusion[] | undefined,
  heightmap: Pick<RegionBlueprint, "gridSize" | "pitch" | "heights">,
  options?: GrassVisualOptions,
): GrassField {
  const uniforms = createGrassBladeUniforms(options?.color);
  if (options?.wind) applyRegionWind(uniforms, options.wind, BASE_GRASS_WIND_STRENGTH);
  const material = makeBladeMaterial(uniforms);

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
        // Each exclusion independently rolls to remove a blade at its own
        // `strength` (1 = always) rather than an all-or-nothing cutout --
        // overlapping erase strokes compound, same "more passes removes more"
        // feel as a real eraser.
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

        // Organic length variety: a low-frequency clump noise (patches of
        // taller/shorter grass) dominates over a narrower per-blade jitter --
        // a flat per-blade-only jitter reads as uniform "fuzz" rather than
        // the tufted, uneven look real grass has.
        const clumpCellSize = Math.max(1.2, patch.radius * 0.6);
        const lengthClump = fbm(patch.seed + 37, x, z, clumpCellSize, 2);
        const heightScale = 0.45 + lengthClump * 1.15 + hash2(patch.seed + 29, base, 5) * 0.25;

        // Hue variety: per-blade multiplicative tint composited on top of the
        // shader's own lush/dry gradient via Three's standard instanceColor
        // mechanism (`diffuseColor *= vColor` runs after our custom color
        // computation -- no grassBlade.ts shader changes needed). Green stays
        // fairly stable since it dominates lushness; red/blue swing wider to
        // drift individual blades toward warm olive or cool blue-green.
        const rMul = 0.85 + hash2(patch.seed + 41, base, 6) * 0.3;
        const gMul = 0.92 + hash2(patch.seed + 43, base, 7) * 0.16;
        const bMul = 0.7 + hash2(patch.seed + 47, base, 8) * 0.5;
        const color = new THREE.Color(rMul, gMul, bMul);

        const cx = Math.floor(x / GRASS_CHUNK_SIZE);
        const cz = Math.floor(z / GRASS_CHUNK_SIZE);
        const key = `${cx},${cz}`;
        const blade: Blade = { x, y, z, yaw, widthScale, heightScale, lengthScale: patchLength, color };
        const list = chunks.get(key);
        if (list) list.push(blade);
        else chunks.set(key, [blade]);
      }
    }
  }

  const meshes: THREE.InstancedMesh[] = [];
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3();
  const scaleVec = new THREE.Vector3();

  for (const blades of chunks.values()) {
    if (blades.length === 0) continue;
    const mesh = new THREE.InstancedMesh(BLADE_GEOMETRY, material, blades.length);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(blades.length * 3), 3);
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
    meshes.push(mesh);
  }

  return { meshes, uniforms };
}
