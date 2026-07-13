import { describe, it, expect } from "vitest";
import { terrainHeight } from "../src/terrain";
import { generateNodes, generateMobSpawns } from "../src/worldgen";
import { stepMovement, type MoveState } from "../src/sim/movement";
import { WATER_LEVEL, SPAWN_POINT, TICK_DT } from "../src/constants";
import { hash2, mulberry32 } from "../src/rng";

describe("determinism", () => {
  it("terrain height is stable for the same coordinates", () => {
    const a = terrainHeight(12.5, -83.2);
    const b = terrainHeight(12.5, -83.2);
    expect(a).toBe(b);
  });

  it("hash2 is stable and well-distributed", () => {
    expect(hash2(1, 2, 3)).toBe(hash2(1, 2, 3));
    let sum = 0;
    for (let i = 0; i < 1000; i++) sum += hash2(42, i, i * 7);
    expect(sum / 1000).toBeGreaterThan(0.4);
    expect(sum / 1000).toBeLessThan(0.6);
  });

  it("mulberry32 sequence is reproducible", () => {
    const a = mulberry32(99);
    const b = mulberry32(99);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });

  it("node scatter is identical across calls and lands on dry land", () => {
    const n1 = generateNodes();
    const n2 = generateNodes();
    expect(n1.length).toBeGreaterThan(200);
    expect(n1).toEqual(n2);
    for (const node of n1) {
      expect(node.y).toBeGreaterThanOrEqual(WATER_LEVEL + 0.4);
      expect(terrainHeight(node.x, node.z)).toBeCloseTo(node.y, 10);
    }
    const types = new Set(n1.map((n) => n.type));
    expect(types).toContain("tree");
    expect(types).toContain("rock");
    expect(types).toContain("berry_bush");
  });

  it("mob spawns exist and avoid the spawn plateau", () => {
    const spawns = generateMobSpawns();
    expect(spawns.length).toBeGreaterThan(5);
    for (const s of spawns) {
      const d = Math.hypot(s.x - SPAWN_POINT.x, s.z - SPAWN_POINT.z);
      expect(d).toBeGreaterThan(30);
    }
  });
});

describe("movement", () => {
  const spawnState = (): MoveState => ({
    x: SPAWN_POINT.x,
    y: terrainHeight(SPAWN_POINT.x, SPAWN_POINT.z),
    z: SPAWN_POINT.z,
    vy: 0,
    grounded: true,
  });

  it("is deterministic for the same input sequence", () => {
    let a = spawnState();
    let b = spawnState();
    for (let i = 0; i < 200; i++) {
      const input = { moveX: Math.sin(i / 10), moveZ: 0.5, jump: i % 40 === 0, sprint: i > 100 };
      a = stepMovement(a, input, TICK_DT);
      b = stepMovement(b, input, TICK_DT);
    }
    expect(a).toEqual(b);
  });

  it("moves at walk speed on flat ground", () => {
    let s = spawnState();
    for (let i = 0; i < 20; i++) {
      s = stepMovement(s, { moveX: 1, moveZ: 0, jump: false, sprint: false }, TICK_DT);
    }
    // 1 second of walking ≈ WALK_SPEED meters (spawn plateau is nearly flat)
    expect(s.x).toBeGreaterThan(3.5);
    expect(s.x).toBeLessThan(5.5);
  });

  it("jump leaves the ground and lands again", () => {
    let s = spawnState();
    s = stepMovement(s, { moveX: 0, moveZ: 0, jump: true, sprint: false }, TICK_DT);
    expect(s.grounded).toBe(false);
    let landed = false;
    for (let i = 0; i < 100; i++) {
      s = stepMovement(s, { moveX: 0, moveZ: 0, jump: false, sprint: false }, TICK_DT);
      if (s.grounded) {
        landed = true;
        break;
      }
    }
    expect(landed).toBe(true);
  });

  it("clamps to zone bounds", () => {
    let s = spawnState();
    for (let i = 0; i < 3000; i++) {
      s = stepMovement(s, { moveX: 1, moveZ: 0, jump: false, sprint: true }, TICK_DT);
    }
    expect(s.x).toBeLessThanOrEqual(300);
  });

  it("a horse mount gallops much faster than sprinting on land", () => {
    const run = (mount: "horse" | null) => {
      let s = spawnState();
      for (let i = 0; i < 20; i++) {
        s = stepMovement(s, { moveX: 1, moveZ: 0, jump: false, sprint: true, mount }, TICK_DT);
      }
      return s.x;
    };
    const sprintDist = run(null);
    const horseDist = run("horse");
    expect(horseDist).toBeGreaterThan(sprintDist * 1.4);
  });
});
