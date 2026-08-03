import { describe, it, expect } from "vitest";
import { regionAssetColliders, type RegionAsset } from "../src/content/regions";
import { stepMovement, type MoveState } from "../src/sim/movement";
import { TICK_DT } from "../src/constants";

describe("solid walkable platforms", () => {
  it("bakes wide solid meshes as a deck below railing height", () => {
    const asset: RegionAsset = {
      id: "bridge",
      model: "bridge_stone_01.glb",
      category: "building",
      localX: 0,
      localY: -8,
      localZ: 0,
      yaw: 0,
      scale: 1,
      solid: true,
      solidBox: { halfX: 6, halfY: 5, halfZ: 2, offsetY: 5 },
    };
    const cols = regionAssetColliders([asset]);
    expect(cols).toHaveLength(1);
    const c = cols[0]!;
    expect(c.climbable).toBe(true);
    expect(c.solid).toBe(false); // soft floor — no pillar wall
    expect(c.topY - c.baseY).toBeLessThan(1);
    // AABB top is localY+offsetY+halfY = 2; deck is pulled down from rails.
    expect(c.topY).toBeLessThan(2);
    expect(c.topY).toBeGreaterThan(-2);
  });

  it("keeps compact rocks as a full solid volume", () => {
    const asset: RegionAsset = {
      id: "rock",
      model: "rock_a.glb",
      category: "prop",
      localX: 0,
      localY: 0,
      localZ: 0,
      yaw: 0,
      scale: 1,
      solid: true,
      solidBox: { halfX: 1, halfY: 0.8, halfZ: 1, offsetY: 0.8 },
    };
    const cols = regionAssetColliders([asset]);
    expect(cols).toHaveLength(1);
    expect(cols[0]!.solid).toBe(true);
    expect(cols[0]!.topY - cols[0]!.baseY).toBeCloseTo(1.6, 5);
  });

  it("lets the player walk across a solid bridge over a terrain trench", () => {
    const asset: RegionAsset = {
      id: "bridge",
      model: "bridge_stone_01.glb",
      category: "building",
      localX: 0,
      localY: -8,
      localZ: 0,
      yaw: 0,
      scale: 1,
      solid: true,
      solidBox: { halfX: 8, halfY: 5, halfZ: 2.5, offsetY: 5 },
    };
    const cols = regionAssetColliders([asset]);
    const deckY = cols[0]!.topY;
    const groundAt = (x: number, _z: number) => (Math.abs(x) < 6 ? -10 : deckY);

    let s: MoveState = { x: -7, y: deckY, z: 0, vy: 0, grounded: true };
    for (let i = 0; i < 80; i++) {
      s = stepMovement(
        s,
        { moveX: 1, moveZ: 0, jump: false, sprint: true, groundAt, regionAssets: cols },
        TICK_DT,
      );
    }
    expect(s.x).toBeGreaterThan(0);
    expect(s.y).toBeCloseTo(deckY, 1);
  });

  it("walks the real new_region bridge_stone dimensions", () => {
    const asset: RegionAsset = {
      id: "asset_6401",
      model: "fantastic_village/bridge_stone_01.gltf",
      category: "building",
      localX: 0,
      localY: -9.5,
      localZ: 0,
      yaw: 0,
      scale: 3.4829491834875115,
      scaleX: 3.4829491834875115,
      scaleY: 3.118632265233402,
      scaleZ: 7.158736808256287,
      solid: true,
      solidBox: {
        halfX: 1.7853406667709353,
        halfY: 1.6085661342367543,
        halfZ: 4.666791677474975,
        offsetX: 0,
        offsetY: 1.6085661342367528,
        offsetZ: 0,
      },
    };
    const cols = regionAssetColliders([asset]);
    const deckY = cols[0]!.topY;
    // Banks sit below the AABB lid (rails) but near the estimated deck.
    expect(deckY).toBeLessThan(0);
    expect(deckY).toBeGreaterThan(-4);

    const bankY = deckY + 0.5;
    const groundAt = (_x: number, z: number) => (Math.abs(z) < 25 ? -12 : bankY);

    let s: MoveState = { x: 0, y: bankY, z: -cols[0]!.halfZ! - 1.5, vy: 0, grounded: true };
    for (let i = 0; i < 160; i++) {
      s = stepMovement(
        s,
        { moveX: 0, moveZ: 1, jump: false, sprint: true, groundAt, regionAssets: cols },
        TICK_DT,
      );
    }
    expect(s.z).toBeGreaterThan(-5);
    expect(s.y).toBeGreaterThan(deckY - 0.5);
    expect(s.y).toBeLessThan(deckY + 1.5);
  });
});
