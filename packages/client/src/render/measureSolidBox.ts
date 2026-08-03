import * as THREE from "three";
import type { RegionAssetSolidBox } from "@rustcraft/shared";

const _size = new THREE.Vector3();
const _center = new THREE.Vector3();
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3(0, -1, 0);
const _raycaster = new THREE.Raycaster();

/** World half-extent under which a solid stays a full blocking rock/prop. */
const COMPACT_XZ = 2.5;
/** Thin walk-slab half-height in world metres (full thickness = 2× this). */
const DECK_SLAB_HALF_Y = 0.28;
/** Downward sample grid across the footprint when probing for a walk deck. */
const DECK_SAMPLE_GRID = 7;

/**
 * Measure an oriented collision box from a placed asset mesh.
 * Temporarily clears yaw so the AABB aligns with the model's local axes,
 * then stores half-extents + center offset in model-local (pre-scale) space.
 * Placement yaw/position are applied later by solidBoxColliderFields().
 *
 * Compact props keep the full mesh AABB (stand on top, block sides).
 * Wide / tall spans (bridges) probe the mesh for a walk deck and store a
 * thin slab there — the raw AABB top is often railings, not the walkway.
 */
export function measureObjectSolidBox(obj: THREE.Object3D): RegionAssetSolidBox | null {
  const yaw = obj.rotation.y;
  const sx = Math.abs(obj.scale.x) || 1;
  const sy = Math.abs(obj.scale.y) || 1;
  const sz = Math.abs(obj.scale.z) || 1;

  obj.rotation.y = 0;
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);

  if (box.isEmpty()) {
    obj.rotation.y = yaw;
    obj.updateMatrixWorld(true);
    return null;
  }
  box.getSize(_size);
  box.getCenter(_center);
  if (_size.x < 1e-4 && _size.y < 1e-4 && _size.z < 1e-4) {
    obj.rotation.y = yaw;
    obj.updateMatrixWorld(true);
    return null;
  }

  const worldHalfX = _size.x / 2;
  const worldHalfY = _size.y / 2;
  const worldHalfZ = _size.z / 2;
  const compact = Math.max(worldHalfX, worldHalfZ) < COMPACT_XZ || worldHalfY <= 1.0;

  let offsetX = (_center.x - obj.position.x) / sx;
  let offsetY = (_center.y - obj.position.y) / sy;
  let offsetZ = (_center.z - obj.position.z) / sz;
  let halfX = Math.max(0.05, worldHalfX / sx);
  let halfY = Math.max(0.05, worldHalfY / sy);
  let halfZ = Math.max(0.05, worldHalfZ / sz);

  if (!compact) {
    const deckY = sampleWalkDeckY(obj, box);
    if (deckY != null) {
      // Thin slab whose top sits on the probed deck.
      halfY = DECK_SLAB_HALF_Y / sy;
      offsetY = (deckY - DECK_SLAB_HALF_Y - obj.position.y) / sy;
      // Keep XZ from the mesh footprint (slightly inset so rail posts don't
      // dominate the walkable width on very ornate bridges).
      halfX = Math.max(0.05, (worldHalfX * 0.92) / sx);
      halfZ = Math.max(0.05, (worldHalfZ * 0.92) / sz);
      offsetX = (_center.x - obj.position.x) / sx;
      offsetZ = (_center.z - obj.position.z) / sz;
    }
  }

  obj.rotation.y = yaw;
  obj.updateMatrixWorld(true);

  return { halfX, halfY, halfZ, offsetX, offsetY, offsetZ };
}

/**
 * Raycast down across the footprint and pick a walk height.
 * Rails / posts sit above the deck and are sparse; the deck dominates the
 * sample set, so we drop the top outliers and take the high end of the rest.
 */
function sampleWalkDeckY(obj: THREE.Object3D, box: THREE.Box3): number | null {
  const min = box.min;
  const max = box.max;
  const spanX = max.x - min.x;
  const spanZ = max.z - min.z;
  if (spanX < 0.05 || spanZ < 0.05) return null;

  const padX = spanX * 0.08;
  const padZ = spanZ * 0.08;
  const x0 = min.x + padX;
  const x1 = max.x - padX;
  const z0 = min.z + padZ;
  const z1 = max.z - padZ;
  const yTop = max.y + 1.5;
  const maxDist = max.y - min.y + 3;

  _raycaster.far = maxDist;
  const hits: number[] = [];
  const n = DECK_SAMPLE_GRID;
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const tx = ix / Math.max(1, n - 1);
      const tz = iz / Math.max(1, n - 1);
      _rayOrigin.set(x0 + (x1 - x0) * tx, yTop, z0 + (z1 - z0) * tz);
      _raycaster.set(_rayOrigin, _rayDir);
      const found = _raycaster.intersectObject(obj, true);
      if (found.length === 0) continue;
      const y = found[0]!.point.y;
      // Ignore deep pillar / water hits — only surfaces in the upper half.
      if (y < min.y + (max.y - min.y) * 0.35) continue;
      hits.push(y);
    }
  }

  if (hits.length < 3) return null;
  hits.sort((a, b) => a - b);
  // Drop the top ~18% (railings / lamps), keep the highest remaining as deck.
  const cut = Math.max(1, Math.floor(hits.length * 0.82));
  const deckHits = hits.slice(0, cut);
  return deckHits[deckHits.length - 1]!;
}
