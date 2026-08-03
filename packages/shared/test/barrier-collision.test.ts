import { describe, it, expect } from "vitest";
import { regionBarrierColliders, PLAYER_BODY_RADIUS, segmentHitsColliderXZ } from "../src/content/regions";
import { stepMovement, type MoveState } from "../src/sim/movement";
import { TICK_DT } from "../src/constants";

describe("invisible barriers", () => {
  it("blocks walking through a thin wall", () => {
    const cols = regionBarrierColliders([
      { localX: 0, localY: 10, localZ: 5.5, yaw: 0, sizeX: 40, sizeY: 20, sizeZ: 0.4 },
    ]);
    expect(cols[0]!.halfZ).toBeGreaterThanOrEqual(1.0);
    expect(cols[0]!.solid).toBe(true);
    let s: MoveState = { x: 0, y: 10, z: 0, vy: 0, grounded: true };
    const groundAt = () => 10;
    for (let i = 0; i < 100; i++) {
      s = stepMovement(s, { moveX: 0, moveZ: 1, jump: false, sprint: true, groundAt, regionAssets: cols }, TICK_DT);
    }
    expect(s.z).toBeLessThan(5.5);
  });

  it("segment sweep catches a wall thinner than one step", () => {
    const cols = regionBarrierColliders([
      { localX: 0, localY: 0, localZ: 0, yaw: 0, sizeX: 10, sizeY: 5, sizeZ: 0.2 },
    ]);
    const c = cols[0]!;
    expect(segmentHitsColliderXZ(0, -2, 0, 2, c, PLAYER_BODY_RADIUS)).toBe(true);
  });

  it("does not allow walking through once overlapping", () => {
    const cols = regionBarrierColliders([
      { localX: 0, localY: 10, localZ: 0, yaw: 0, sizeX: 20, sizeY: 10, sizeZ: 0.3 },
    ]);
    // Start embedded on the -Z side of the wall; sprinting +Z must not
    // cross through to the far side (old escape rule allowed that).
    let s: MoveState = { x: 0, y: 10, z: -0.5, vy: 0, grounded: true };
    const groundAt = () => 10;
    for (let i = 0; i < 40; i++) {
      s = stepMovement(s, { moveX: 0, moveZ: 1, jump: false, sprint: true, groundAt, regionAssets: cols }, TICK_DT);
    }
    expect(s.z).toBeLessThan(2);
  });
});
