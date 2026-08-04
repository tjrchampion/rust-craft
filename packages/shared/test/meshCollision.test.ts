import { describe, it, expect } from "vitest";
import * as THREE from "three";
import {
  buildRegionCollisionBVH,
  resolveCapsule,
  sampleGroundBelow,
  type CollisionMeshData,
  type PlacedCollider,
} from "../src/sim/meshCollision";

/** Model-local box soup with correct outward winding/normals (via BoxGeometry). */
function boxSoup(w: number, h: number, d: number): CollisionMeshData {
  const geo = new THREE.BoxGeometry(w, h, d);
  const verts = Array.from(geo.attributes.position!.array as Float32Array);
  const indices = Array.from(geo.index!.array as ArrayLike<number>);
  geo.dispose();
  return { verts, indices };
}

function place(modelKey: string, x: number, y: number, z: number, extra?: Partial<PlacedCollider>): PlacedCollider {
  return { modelKey, x, y, z, yaw: 0, scaleX: 1, scaleY: 1, scaleZ: 1, ...extra };
}

const CAP = { radius: 0.45, height: 1.7 };

describe("meshCollision (BVH capsule)", () => {
  it("samples ground on top of a slab and ignores the terrain far below", () => {
    // 4 x 0.2 x 4 slab, centred at y=5 → top surface at y=5.1.
    const soup = boxSoup(4, 0.2, 4);
    const col = buildRegionCollisionBVH([place("slab", 0, 5, 0)], () => soup)!;
    expect(col).toBeTruthy();

    const g = sampleGroundBelow(col, 0, 0, 8, CAP.radius, 6);
    expect(g).not.toBeNull();
    expect(g!).toBeCloseTo(5.1, 2);

    // Off the slab there is no surface below → null (caller uses terrain).
    expect(sampleGroundBelow(col, 20, 20, 8, CAP.radius, 6)).toBeNull();
  });

  it("pushes a capsule up out of a slab it is embedded in (grounded)", () => {
    const soup = boxSoup(4, 0.6, 4); // spans y [4.7, 5.3]
    const col = buildRegionCollisionBVH([place("slab", 0, 5, 0)], () => soup)!;
    // Feet buried at y=4.8 (capsule bottom sphere inside the slab).
    const r = resolveCapsule(col, 0, 4.8, 0, CAP);
    expect(r.grounded).toBe(true);
    expect(r.y).toBeGreaterThan(4.8);
    expect(r.moved).toBeGreaterThan(0);
  });

  it("lets a capsule pass through a gap between two wall segments", () => {
    // Two walls leaving a 1.6m gap around x=0 (capsule diameter 0.9).
    const wall = boxSoup(1.4, 3, 0.4); // half-x 0.7
    const placed = [place("wallL", -1.5, 1.5, 0), place("wallR", 1.5, 1.5, 0)];
    const col = buildRegionCollisionBVH(placed, () => wall)!;

    // In the gap → no contact.
    const through = resolveCapsule(col, 0, 0, 0, CAP);
    expect(through.moved).toBeLessThan(1e-3);
    expect(Math.abs(through.x)).toBeLessThan(1e-3);

    // Inside the left wall → pushed out horizontally.
    const blocked = resolveCapsule(col, -1.5, 0, 0, CAP);
    expect(blocked.moved).toBeGreaterThan(0.1);
  });

  it("blocks a capsule at a wall face and pushes it back horizontally, not up", () => {
    // Thin wall at z≈1 (spans z [0.8,1.2]), wide in x, tall in y.
    const wall = boxSoup(6, 3, 0.4);
    const col = buildRegionCollisionBVH([place("wall", 0, 1.5, 1)], () => wall)!;
    // Feet penetrating the wall from the -z side.
    const r = resolveCapsule(col, 0, 0.5, 0.9, CAP);
    expect(r.moved).toBeGreaterThan(0);
    expect(r.z).toBeLessThan(0.9); // pushed toward -z, out of the wall
    expect(r.grounded).toBe(false); // horizontal push, not a floor
  });

  it("depenetrates a capsule out of a solid rock", () => {
    const rock = boxSoup(2, 2, 2); // centred at (0,1,0), spans [-1,1]^3 + y offset
    const col = buildRegionCollisionBVH([place("rock", 0, 1, 0)], () => rock)!;
    const before = { x: 0, y: 1, z: 0 };
    const r = resolveCapsule(col, before.x, before.y, before.z, CAP);
    expect(r.moved).toBeGreaterThan(0);
    const horiz = Math.hypot(r.x - before.x, r.z - before.z);
    expect(horiz + Math.abs(r.y - before.y)).toBeGreaterThan(0.1);
  });

  it("returns null when no placed asset has collision data", () => {
    const col = buildRegionCollisionBVH([place("missing", 0, 0, 0)], () => undefined);
    expect(col).toBeNull();
  });

  it("bakes yaw + scale into world space (rotated wall still blocks)", () => {
    // A thin wall rotated 90° so its thin axis becomes X; scaled 2x wide.
    const wall = boxSoup(4, 3, 0.4);
    const col = buildRegionCollisionBVH(
      [place("wall", 0, 1.5, 0, { yaw: Math.PI / 2, scaleX: 2, scaleY: 1, scaleZ: 1 })],
      () => wall,
    )!;
    // After yaw 90°, the thin (z) axis points along x → wall now blocks along x≈0.
    const r = resolveCapsule(col, 0.1, 0.5, 0, CAP);
    expect(r.moved).toBeGreaterThan(0);
    expect(Math.abs(r.x)).toBeGreaterThan(0.1); // pushed along x
  });
});
