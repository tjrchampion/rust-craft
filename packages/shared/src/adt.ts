/**
 * ADT-style tiles for editor region interiors: fixed-size cells streamed in a
 * Chebyshev ring around the viewer.
 *
 * Defaults: 64 m tiles, ring = 2 → up to 5×5 = 25 resident terrain tiles.
 * Open-world Greenlands uses a single mesh; Ashenpeak is not client-loaded.
 */

import { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_X, WORLD_MIN_Z } from "./constants";

/** Edge length of one ADT tile in meters (overworld + region local space). */
export const ADT_SIZE = 64;

/** Chebyshev ring radius (ring=2 → 5×5 tiles). Terrain default. */
export const ADT_RING = 2;

/** Grass is fine detail — smaller ring than terrain (~3×3 tiles). */
export const ADT_GRASS_RING = 1;

/** Overworld village stream ring (~ring 3 ≈ old 190 m radius). */
export const ADT_VILLAGE_RING = 3;

/**
 * Meters from a viewer at a tile center to the outer edge of a Chebyshev ring.
 * ring=2 → 160 m, ring=3 → 224 m. Used to keep fog / stream distances in lockstep.
 */
export function adtRingRadiusMeters(ring: number): number {
  return (ring + 0.5) * ADT_SIZE;
}

/** Linear Fog near — light atmospheric fade, well inside village stream. */
export const OVERWORLD_FOG_NEAR = adtRingRadiusMeters(ADT_RING) * 0.75; // ~120 m

/** Linear Fog far — soft horizon; trees/villages are distance-culled separately. */
export const OVERWORLD_FOG_FAR = adtRingRadiusMeters(ADT_VILLAGE_RING) * 1.4; // ~314 m

/**
 * Soft floor for region FogExp2 (~35% transmittance at the village ring).
 * Foliage is distance-culled to the terrain ADT ring, so fog only needs a
 * gentle horizon — not a hard wall at ~160 m.
 */
export const REGION_FOG_DENSITY_MIN = -Math.log(0.35) / adtRingRadiusMeters(ADT_VILLAGE_RING);

export function clampRegionFogDensity(density: number): number {
  return Math.max(density, REGION_FOG_DENSITY_MIN);
}

/** Region / overworld asset draw distance — matches terrain ADT ring edge. */
export const TREE_VISIBLE_RADIUS = adtRingRadiusMeters(ADT_RING); // ~160 m

export interface AdtAabb {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function adtIndex(world: number): number {
  return Math.floor(world / ADT_SIZE);
}

export function adtKey(ix: number, iz: number): string {
  return `${ix}:${iz}`;
}

export function parseAdtKey(key: string): { ix: number; iz: number } {
  const [a, b] = key.split(":");
  return { ix: Number(a), iz: Number(b) };
}

/** World-space center of tile (ix, iz). */
export function adtCenter(ix: number, iz: number): { x: number; z: number } {
  return {
    x: (ix + 0.5) * ADT_SIZE,
    z: (iz + 0.5) * ADT_SIZE,
  };
}

/** Inclusive-min / exclusive-max AABB of the tile. */
export function adtWorldBounds(ix: number, iz: number): AdtAabb {
  return {
    minX: ix * ADT_SIZE,
    maxX: (ix + 1) * ADT_SIZE,
    minZ: iz * ADT_SIZE,
    maxZ: (iz + 1) * ADT_SIZE,
  };
}

export function adtIntersectsAabb(ix: number, iz: number, bounds: AdtAabb): boolean {
  const b = adtWorldBounds(ix, iz);
  return b.maxX > bounds.minX && b.minX < bounds.maxX && b.maxZ > bounds.minZ && b.minZ < bounds.maxZ;
}

/** True if the tile overlaps the playable overworld AABB. */
export function adtIntersectsWorld(ix: number, iz: number): boolean {
  return adtIntersectsAabb(ix, iz, {
    minX: WORLD_MIN_X,
    maxX: WORLD_MAX_X,
    minZ: WORLD_MIN_Z,
    maxZ: WORLD_MAX_Z,
  });
}

/**
 * Keys within `ring` Chebyshev steps of (x, z), optionally clipped to an AABB.
 * Sorted nearest-first (useful when budgeting builds per frame).
 */
export function adtRingKeysInBounds(x: number, z: number, ring: number, bounds: AdtAabb): string[] {
  const ix0 = adtIndex(x);
  const iz0 = adtIndex(z);
  const entries: { key: string; dist: number }[] = [];
  for (let iz = iz0 - ring; iz <= iz0 + ring; iz++) {
    for (let ix = ix0 - ring; ix <= ix0 + ring; ix++) {
      if (!adtIntersectsAabb(ix, iz, bounds)) continue;
      const dx = ix - ix0;
      const dz = iz - iz0;
      entries.push({ key: adtKey(ix, iz), dist: Math.max(Math.abs(dx), Math.abs(dz)) });
    }
  }
  entries.sort((a, b) => a.dist - b.dist);
  return entries.map((e) => e.key);
}

/** Overworld helper — ring clipped to WORLD_* bounds. */
export function adtRingKeys(x: number, z: number, ring = ADT_RING): string[] {
  return adtRingKeysInBounds(x, z, ring, {
    minX: WORLD_MIN_X,
    maxX: WORLD_MAX_X,
    minZ: WORLD_MIN_Z,
    maxZ: WORLD_MAX_Z,
  });
}
