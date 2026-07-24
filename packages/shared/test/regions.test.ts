import { describe, it, expect } from "vitest";
import {
  REGION_BIOMES,
  generateRandomRegionBlueprint,
  sampleRegionHeight,
  pickRegionMob,
  REGION_MOB_TABLE,
  slugifyRegionName,
  type RegionBlueprint,
} from "../src/content/regions";

describe("region editor: generateRandomRegionBlueprint", () => {
  it("is deterministic for a given seed/biome/name", () => {
    const a = generateRandomRegionBlueprint("seed-1", "forest", "Test Region");
    const b = generateRandomRegionBlueprint("seed-1", "forest", "Test Region");
    expect(a).toEqual(b);
  });

  it("produces different layouts for different seeds", () => {
    const a = generateRandomRegionBlueprint("seed-a", "grassland", "A");
    const b = generateRandomRegionBlueprint("seed-b", "grassland", "A");
    expect(a.heights).not.toEqual(b.heights);
    expect(a.assets).not.toEqual(b.assets);
  });

  it("every biome produces at least one foliage/rock asset and one village", () => {
    for (const biome of REGION_BIOMES) {
      const bp = generateRandomRegionBlueprint(`seed-${biome}`, biome, "Region");
      expect(bp.assets.length).toBeGreaterThan(0);
      expect(bp.villages.length).toBeGreaterThan(0);
      // At least one non-building asset (foliage or rock prop).
      expect(bp.assets.some((a) => a.category === "foliage" || a.category === "prop")).toBe(true);
      // Every village gets at least one building.
      expect(bp.assets.some((a) => a.category === "building")).toBe(true);
      // Heightmap is fully populated (no holes).
      expect(bp.heights.length).toBe(bp.gridSize * bp.gridSize);
      expect(bp.heights.every((h) => Number.isFinite(h))).toBe(true);
    }
  });

  it("mob spawns avoid landing inside a village's radius", () => {
    const bp = generateRandomRegionBlueprint("seed-mobs", "swamp", "Mire");
    for (const spawn of bp.mobSpawns) {
      for (const v of bp.villages) {
        const d = Math.hypot(spawn.localX - v.localX, spawn.localZ - v.localZ);
        expect(d).toBeGreaterThanOrEqual(v.radius + 15);
      }
    }
  });
});

describe("sampleRegionHeight", () => {
  const gridSize = 3;
  const pitch = 4;
  // Grid: corners easy to reason about. Local coords span -4..+4 on each axis.
  const heights = [
    0, 1, 2,
    1, 2, 3,
    2, 3, 4,
  ];
  const bp: Pick<RegionBlueprint, "gridSize" | "pitch" | "heights"> = { gridSize, pitch, heights };

  it("returns exact grid values at grid corners", () => {
    expect(sampleRegionHeight(bp, -4, -4)).toBeCloseTo(0);
    expect(sampleRegionHeight(bp, 4, -4)).toBeCloseTo(2);
    expect(sampleRegionHeight(bp, -4, 4)).toBeCloseTo(2);
    expect(sampleRegionHeight(bp, 4, 4)).toBeCloseTo(4);
  });

  it("interpolates at the exact midpoint between two grid cells", () => {
    // Between (-4,-4)=0 and (0,-4)=1 -> midpoint should be 0.5.
    expect(sampleRegionHeight(bp, -2, -4)).toBeCloseTo(0.5);
  });

  it("clamps to the nearest edge instead of extrapolating out of bounds", () => {
    expect(sampleRegionHeight(bp, -100, -100)).toBeCloseTo(0);
    expect(sampleRegionHeight(bp, 100, 100)).toBeCloseTo(4);
  });
});

describe("pickRegionMob / REGION_MOB_TABLE", () => {
  it("every biome's table is non-empty and cumulative weights end at 1.0", () => {
    for (const biome of REGION_BIOMES) {
      const table = REGION_MOB_TABLE[biome];
      expect(table.length).toBeGreaterThan(0);
      expect(table[table.length - 1]![1]).toBeCloseTo(1.0);
    }
  });

  it("picks the first entry whose weight exceeds the roll", () => {
    expect(pickRegionMob("grassland", 0)).toBe(REGION_MOB_TABLE.grassland[0]![0]);
    expect(pickRegionMob("grassland", 0.999)).toBe(REGION_MOB_TABLE.grassland[REGION_MOB_TABLE.grassland.length - 1]![0]);
  });
});

describe("slugifyRegionName", () => {
  it("lowercases and replaces non-alphanumerics with underscores", () => {
    expect(slugifyRegionName("Frostwood Valley!")).toBe("frostwood_valley");
  });

  it("falls back to a default when the name has no usable characters", () => {
    expect(slugifyRegionName("***")).toBe("region");
  });
});
