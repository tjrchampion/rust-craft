/**
 * True-geometry (BVH) collision for placed region assets.
 *
 * THREE + three-mesh-bvh based — this is the ONE module in @rustcraft/shared
 * that pulls in three.js. It is deliberately NOT re-exported from the package
 * barrel (index.ts); import it via the subpath `@rustcraft/shared/collision`
 * so the 82 THREE-free consumers of the barrel stay THREE-free. It is used by
 * all three movement paths (client prediction, editor Playtest, and the
 * authoritative server running three-mesh-bvh headless) so collision is
 * identical everywhere.
 *
 * Model triangle soup comes from the offline extractor
 * (scripts/extract-collision.mjs) in MODEL-LOCAL, pre-scale space. Here we bake
 * each placed asset's live TRS (+ region world origin) into WORLD space and
 * build one merged MeshBVH per region. Because the triangles are world-baked,
 * the capsule query needs no per-asset matrix inverse and non-uniform scale /
 * rotation / translation "just work" — rebuild (or refit) the region when an
 * asset transform changes and collision tracks the new shape live.
 *
 * Two primitives, mirroring three-mesh-bvh's characterMovement example:
 *  - resolveCapsule()   — depenetrate a vertical capsule out of geometry
 *                         (walls/pillars/rock faces; pushes up out of a deck).
 *  - sampleGroundBelow() — highest up-facing surface under the feet, so the
 *                         controller can STAND on a bridge deck / rooftop.
 *                         (When you are below a deck this finds the terrain
 *                          under it, not the deck — that is "swim under".)
 */
import * as THREE from "three";
import { MeshBVH, type MeshBVHOptions } from "three-mesh-bvh";

/** Raw model-local triangle soup as produced by the offline extractor. */
export interface CollisionMeshData {
  /** Flat model-local xyz, length = vertCount*3. */
  verts: ArrayLike<number>;
  /** Triangle indices into verts, length = triCount*3. */
  indices: ArrayLike<number>;
}

/** One placed asset to bake into the region BVH. Yaw is rotation about +Y. */
export interface PlacedCollider {
  modelKey: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
}

export interface RegionCollision {
  bvh: MeshBVH;
  geometry: THREE.BufferGeometry;
  /** World-space AABB of the whole merged mesh (broadphase). */
  aabb: THREE.Box3;
  /** Placed count actually baked (models with data). */
  bakedCount: number;
}

export interface CapsuleParams {
  /** Body radius (world units). */
  radius: number;
  /** Total capsule height, feet→head (world units). */
  height: number;
  /** Depenetration passes for corner stability (default 4). */
  iterations?: number;
}

export interface CapsuleResult {
  /** Corrected feet position. */
  x: number;
  y: number;
  z: number;
  /** True when depenetration pushed the capsule upward (standing on geometry). */
  grounded: boolean;
  /** How far the capsule was displaced (world units); 0 = no contact. */
  moved: number;
}

// ── Module-scope temporaries (single-threaded; avoids per-call allocation) ──
const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();
const _v = new THREE.Vector3();
const _seg = new THREE.Line3();
const _triPoint = new THREE.Vector3();
const _capPoint = new THREE.Vector3();
const _triNormal = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _capsuleBox = new THREE.Box3();
const _ray = new THREE.Ray();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _down = new THREE.Vector3(0, -1, 0);

/**
 * Bake placed assets into a single world-space merged geometry + MeshBVH.
 * `lookup(modelKey)` returns the model-local soup, or undefined (skip → the
 * caller keeps the analytic fallback for that asset). `origin` is the region's
 * world origin added to every asset position. Returns null if nothing baked.
 */
export function buildRegionCollisionBVH(
  placed: readonly PlacedCollider[],
  lookup: (modelKey: string) => CollisionMeshData | undefined,
  origin: { x: number; z: number } = { x: 0, z: 0 },
  bvhOptions?: MeshBVHOptions,
): RegionCollision | null {
  const positions: number[] = [];
  const indices: number[] = [];
  let bakedCount = 0;

  for (const p of placed) {
    const data = lookup(p.modelKey);
    if (!data) continue;
    const vs = data.verts;
    const is = data.indices;
    const vertCount = vs.length / 3;
    if (vertCount === 0 || is.length === 0) continue;

    _pos.set(p.x + origin.x, p.y, p.z + origin.z);
    _quat.setFromAxisAngle(_yAxis, p.yaw);
    _scl.set(p.scaleX || 1, p.scaleY || 1, p.scaleZ || 1);
    _mat.compose(_pos, _quat, _scl);

    const base = positions.length / 3;
    for (let i = 0; i < vertCount; i++) {
      _v.set(vs[i * 3]!, vs[i * 3 + 1]!, vs[i * 3 + 2]!).applyMatrix4(_mat);
      positions.push(_v.x, _v.y, _v.z);
    }
    for (let i = 0; i < is.length; i++) indices.push(base + is[i]!);
    bakedCount++;
  }

  if (bakedCount === 0 || indices.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(
    positions.length / 3 > 65535
      ? new THREE.Uint32BufferAttribute(indices, 1)
      : new THREE.Uint16BufferAttribute(indices, 1),
  );
  const bvh = new MeshBVH(geometry, bvhOptions);
  geometry.boundsTree = bvh;

  geometry.computeBoundingBox();
  const aabb = geometry.boundingBox ?? new THREE.Box3();

  return { bvh, geometry, aabb, bakedCount };
}

/**
 * Depenetrate a vertical capsule (feet at `x,y,z`) out of the region geometry.
 * Returns the corrected feet position + whether it was pushed up (grounded).
 * World-space capsule vs world-baked BVH — no matrix inverse needed.
 */
export function resolveCapsule(
  collision: RegionCollision,
  x: number,
  y: number,
  z: number,
  params: CapsuleParams,
): CapsuleResult {
  const radius = params.radius;
  const height = Math.max(params.height, radius * 2 + 0.01);
  const iterations = params.iterations ?? 4;
  const bvh = collision.bvh;

  // Capsule = segment between the two sphere centers, offset by radius.
  let sx = x, sy = y, sz = z; // running feet position
  let grounded = false;
  let movedTotal = 0;

  for (let iter = 0; iter < iterations; iter++) {
    _seg.start.set(sx, sy + radius, sz);
    _seg.end.set(sx, sy + height - radius, sz);
    _capsuleBox.makeEmpty();
    _capsuleBox.expandByPoint(_seg.start);
    _capsuleBox.expandByPoint(_seg.end);
    _capsuleBox.min.addScalar(-radius);
    _capsuleBox.max.addScalar(radius);

    if (!_capsuleBox.intersectsBox(collision.aabb)) break;

    let dx = 0, dy = 0, dz = 0;
    let contacts = 0;
    bvh.shapecast({
      intersectsBounds: (box) => box.intersectsBox(_capsuleBox),
      intersectsTriangle: (tri) => {
        const t = tri as unknown as {
          closestPointToSegment(seg: THREE.Line3, a: THREE.Vector3, b: THREE.Vector3): number;
          getNormal(target: THREE.Vector3): THREE.Vector3;
        };
        const dist = t.closestPointToSegment(_seg, _triPoint, _capPoint);
        if (dist < radius) {
          const depth = radius - dist;
          _v.copy(_capPoint).sub(_triPoint);
          const len = _v.length();
          if (len > 1e-6) {
            _v.multiplyScalar(depth / len);
          } else {
            // Deep penetration: closest points coincide, so the segment→triangle
            // direction is degenerate. Push along the triangle normal instead,
            // oriented toward the capsule so it exits the correct face.
            t.getNormal(_triNormal);
            _mid.copy(_seg.start).add(_seg.end).multiplyScalar(0.5).sub(_triPoint);
            if (_mid.dot(_triNormal) < 0) _triNormal.negate();
            _v.copy(_triNormal).multiplyScalar(depth);
          }
          dx += _v.x; dy += _v.y; dz += _v.z;
          // Move the working segment so subsequent triangles this pass see the
          // pushed-out capsule (matches three-mesh-bvh's example).
          _seg.start.add(_v);
          _seg.end.add(_v);
          contacts++;
        }
        return false;
      },
    });

    if (contacts === 0) break;
    sx += dx; sy += dy; sz += dz;
    movedTotal += Math.hypot(dx, dy, dz);
    if (dy > 1e-4) grounded = true;
  }

  return { x: sx, y: sy, z: sz, grounded, moved: movedTotal };
}

/**
 * Highest up-facing surface directly under the feet within `radius`, searched
 * downward from `fromY` up to `maxDrop` below it. Returns the surface Y, or
 * null if none (→ caller falls back to terrain ground). Only counts triangles
 * whose normal points up (so you stand on a deck, not on a wall face or the
 * underside of a bridge). Samples the feet centre plus a ring so a narrow beam
 * under an edge-standing capsule is still found.
 */
export function sampleGroundBelow(
  collision: RegionCollision,
  x: number,
  z: number,
  fromY: number,
  radius: number,
  maxDrop: number,
): number | null {
  const bvh = collision.bvh;
  const start = fromY + 0.05;
  const minY = fromY - maxDrop;
  let best: number | null = null;

  const probe = (px: number, pz: number): void => {
    _ray.origin.set(px, start, pz);
    _ray.direction.copy(_down);
    const hit = bvh.raycastFirst(_ray, THREE.DoubleSide);
    if (!hit) return;
    if (hit.point.y < minY) return;
    // Up-facing surfaces only.
    if (hit.face) {
      _v.copy(hit.face.normal); // face normal is in geometry (world) space here
      if (_v.dot(_yAxis) < 0.3) return;
    }
    if (best === null || hit.point.y > best) best = hit.point.y;
  };

  probe(x, z);
  const r = radius * 0.7;
  probe(x + r, z);
  probe(x - r, z);
  probe(x, z + r);
  probe(x, z - r);
  return best;
}

/** Release GPU/CPU resources when a region BVH is discarded. */
export function disposeRegionCollision(collision: RegionCollision | null): void {
  if (!collision) return;
  collision.geometry.boundsTree = undefined;
  collision.geometry.dispose();
}
