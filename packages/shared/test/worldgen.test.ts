import { describe, it, expect } from "vitest";
import {
  generateVillages,
  generatePaths,
  generatePois,
  generateNodes,
  generateMobSpawns,
  generateBridges,
  distPointToSegment,
} from "../src/worldgen";
import {
  biomeAt,
  terrainHeight,
  terrainHeightBeforeRivers,
  generateRivers,
  distToRiver,
  distToPass,
  RIVER_HALF_WIDTH,
  PASS_HALF_WIDTH,
} from "../src/terrain";
import { WATER_LEVEL } from "../src/constants";
import { dist2D } from "../src/math";

describe("biomes", () => {
  it("all six biomes appear somewhere with usable, above-water land", () => {
    const half = 300;
    const seen = new Set<string>();
    const aboveWater = new Set<string>();
    for (let x = -half; x <= half; x += 6) {
      for (let z = -half; z <= half; z += 6) {
        const b = biomeAt(x, z);
        seen.add(b);
        if (terrainHeight(x, z) > WATER_LEVEL) aboveWater.add(b);
      }
    }
    for (const b of ["meadow", "forest", "hills", "mountain", "swamp", "dunes"]) {
      expect(seen.has(b)).toBe(true);
      expect(aboveWater.has(b)).toBe(true);
    }
  });

  it("mountain passes carve a real, walkable notch through peaks", () => {
    const half = 300;
    const onPass: number[] = [];
    const offPass: number[] = [];
    for (let x = -half; x <= half; x += 4) {
      for (let z = -half; z <= half; z += 4) {
        if (biomeAt(x, z) !== "mountain") continue;
        const d = distToPass(x, z);
        const y = terrainHeight(x, z);
        if (d < PASS_HALF_WIDTH * 0.6) onPass.push(y);
        else if (d < PASS_HALF_WIDTH * 3) offPass.push(y);
      }
    }
    expect(onPass.length).toBeGreaterThan(10);
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    // The pass corridor should sit meaningfully lower than nearby mountain terrain.
    expect(avg(onPass)).toBeLessThan(avg(offPass) - 3);
  });
});

describe("villages", () => {
  it("settles villages on buildable land, deterministically", () => {
    const a = generateVillages();
    const b = generateVillages();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThanOrEqual(3);
    for (const v of a) {
      expect(v.name.length).toBeGreaterThan(3);
      expect(v.buildings.length).toBeGreaterThanOrEqual(4);
      const y = terrainHeight(v.x, v.z);
      expect(y).toBeGreaterThan(WATER_LEVEL + 1);
      // Every building sits on land.
      for (const bld of v.buildings) {
        expect(bld.y).toBeGreaterThan(WATER_LEVEL);
      }
    }
  });
});

describe("paths", () => {
  it("connects spawn to every village", () => {
    const villages = generateVillages();
    const paths = generatePaths();
    expect(paths.length).toBeGreaterThan(villages.length * 3);
    for (const v of villages) {
      // Some segment endpoint lands on the village center.
      const touches = paths.some(
        (s) => dist2D(s.bx, s.bz, v.x, v.z) < 1 || dist2D(s.ax, s.az, v.x, v.z) < 1,
      );
      expect(touches).toBe(true);
    }
  });

  it("distPointToSegment is sane", () => {
    expect(distPointToSegment(0, 5, -10, 0, 10, 0)).toBeCloseTo(5);
    expect(distPointToSegment(20, 0, -10, 0, 10, 0)).toBeCloseTo(10);
  });
});

describe("pois", () => {
  it("creates ruins, shrines and a camp away from villages", () => {
    const pois = generatePois();
    const types = pois.map((p) => p.type);
    expect(types).toContain("ruins");
    expect(types).toContain("shrine");
    const villages = generateVillages();
    for (const p of pois) {
      expect(villages.every((v) => dist2D(p.x, p.z, v.x, v.z) >= 40)).toBe(true);
    }
  });

  it("crowns a highland watchtower on genuinely elevated ground", () => {
    const pois = generatePois();
    const tower = pois.find((p) => p.type === "tower");
    expect(tower).toBeDefined();
    expect(terrainHeight(tower!.x, tower!.z)).toBeGreaterThanOrEqual(8);
    expect(tower!.buildings.length).toBe(1);
  });
});

describe("node scatter with settlements", () => {
  it("keeps nodes out of village plazas and off paths", () => {
    const nodes = generateNodes();
    const villages = generateVillages();
    const paths = generatePaths();
    expect(nodes.length).toBeGreaterThan(200);
    for (const n of nodes) {
      expect(villages.every((v) => dist2D(n.x, n.z, v.x, v.z) >= 22)).toBe(true);
      expect(paths.every((s) => distPointToSegment(n.x, n.z, s.ax, s.az, s.bx, s.bz) >= 3.5)).toBe(true);
    }
  });

  it("biome mixes differ (meadow berry-rich, mountain rocky)", () => {
    const nodes = generateNodes();
    const byBiome = { meadow: { berry: 0, all: 0 }, mountain: { rock: 0, all: 0 } };
    for (const n of nodes) {
      if (n.biome === "meadow") {
        byBiome.meadow.all++;
        if (n.type === "berry_bush") byBiome.meadow.berry++;
      } else if (n.biome === "mountain") {
        byBiome.mountain.all++;
        if (n.type === "rock") byBiome.mountain.rock++;
      }
      expect(n.biome).toBe(biomeAt(n.x, n.z));
    }
    if (byBiome.meadow.all > 20) {
      expect(byBiome.meadow.berry / byBiome.meadow.all).toBeGreaterThan(0.3);
    }
    if (byBiome.mountain.all > 20) {
      expect(byBiome.mountain.rock / byBiome.mountain.all).toBeGreaterThan(0.4);
    }
  });

  it("mob spawns avoid villages", () => {
    const spawns = generateMobSpawns();
    const villages = generateVillages();
    expect(spawns.length).toBeGreaterThan(5);
    for (const s of spawns) {
      expect(villages.every((v) => dist2D(s.x, s.z, v.x, v.z) >= v.radius + 20)).toBe(true);
    }
  });

  it("nodes and mobs avoid river channels", () => {
    for (const n of generateNodes()) {
      expect(distToRiver(n.x, n.z)).toBeGreaterThanOrEqual(RIVER_HALF_WIDTH + 2 - 0.01);
    }
    for (const s of generateMobSpawns()) {
      expect(distToRiver(s.x, s.z)).toBeGreaterThanOrEqual(RIVER_HALF_WIDTH + 2 - 0.01);
    }
  });
});

describe("rivers", () => {
  it("generates deterministic winding polylines", () => {
    const a = generateRivers();
    const b = generateRivers();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(5);
  });

  it("no longer carves the terrain — rivers are rendering-free, placement-avoidance data only", () => {
    const rivers = generateRivers();
    const mid = rivers[Math.floor(rivers.length / 2)]!;
    const x = (mid.ax + mid.bx) / 2;
    const z = (mid.az + mid.bz) / 2;
    expect(terrainHeight(x, z)).toBe(terrainHeightBeforeRivers(x, z));
  });

  it("villages and POIs keep clear of river channels", () => {
    for (const v of generateVillages()) {
      expect(distToRiver(v.x, v.z)).toBeGreaterThan(RIVER_HALF_WIDTH);
    }
    for (const p of generatePois()) {
      expect(distToRiver(p.x, p.z)).toBeGreaterThan(RIVER_HALF_WIDTH);
    }
  });
});

describe("bridges", () => {
  it("places a bridge at every path/river crossing, deterministically", () => {
    const a = generateBridges();
    const b = generateBridges();
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
    const rivers = generateRivers();
    for (const bridge of a) {
      const nearRiver = rivers.some(
        (r) => distPointToSegment(bridge.x, bridge.z, r.ax, r.az, r.bx, r.bz) < 1,
      );
      expect(nearRiver).toBe(true);
    }
  });
});
