import { describe, it, expect } from "vitest";
import {
  generateVillages,
  generatePaths,
  generatePois,
  generateNodes,
  generateMobSpawns,
  generateBridges,
  generateRegionTwoNodes,
  generateRegionTwoMobSpawns,
  generateDungeonLayout,
  dungeonFloorHeightAt,
  dungeonTileFloorHeight,
  dungeonPortalAt,
  deriveDungeonGridFromAssets,
  distPointToSegment,
  type DungeonAsset,
} from "../src/worldgen";
import { hasDungeonBlueprint, DUNGEON_BLUEPRINTS } from "../src/content/dungeonBlueprints";
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
import { WATER_LEVEL, VALLEY_START_Z, REGION_TWO_MAX_Z, DUNGEON_WALL_RADIUS } from "../src/constants";
import { dist2D } from "../src/math";
import { mobDef } from "../src/content/mobs";

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

  it("biome mixes differ (meadow berry-rich, mountain mixed rock + real forest)", () => {
    const nodes = generateNodes();
    const byBiome = {
      meadow: { berry: 0, all: 0 },
      mountain: { rock: 0, tree: 0, all: 0 },
    };
    for (const n of nodes) {
      if (n.biome === "meadow") {
        byBiome.meadow.all++;
        if (n.type === "berry_bush") byBiome.meadow.berry++;
      } else if (n.biome === "mountain") {
        byBiome.mountain.all++;
        if (n.type === "rock") byBiome.mountain.rock++;
        if (n.type === "tree") byBiome.mountain.tree++;
      }
      expect(n.biome).toBe(biomeAt(n.x, n.z));
    }
    if (byBiome.meadow.all > 20) {
      // The Ashenpeak Pass mouth reclaimed a sliver of what used to be
      // sunk-into-the-sea edge terrain (z near 300, x near 0) into dry
      // meadow-classified land, pulling this ratio down slightly from its
      // old ~0.3+ baseline — still meaningfully berry-rich, just less so.
      expect(byBiome.meadow.berry / byBiome.meadow.all).toBeGreaterThan(0.2);
    }
    if (byBiome.mountain.all > 20) {
      // Mountain was rebalanced to carry noticeably more forest (it used to
      // be one of the sparsest biomes for trees) without losing its rocky
      // character — both should now be meaningfully represented, rather
      // than rock alone dominating the way it used to.
      expect(byBiome.mountain.rock / byBiome.mountain.all).toBeGreaterThan(0.25);
      expect(byBiome.mountain.tree / byBiome.mountain.all).toBeGreaterThan(0.25);
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

describe("region two (Ashenpeak)", () => {
  it("ids never collide with region-1's, and stay in region-2's own z window", () => {
    const region1Nodes = generateNodes();
    const region1Mobs = generateMobSpawns();
    const region2Nodes = generateRegionTwoNodes();
    const region2Mobs = generateRegionTwoMobSpawns();

    expect(region2Nodes.length).toBeGreaterThan(0);
    expect(region2Mobs.length).toBeGreaterThan(0);

    const region1NodeIds = new Set(region1Nodes.map((n) => n.id));
    const region1MobIds = new Set(region1Mobs.map((m) => m.id));
    for (const n of region2Nodes) {
      expect(n.id.startsWith("n2_")).toBe(true);
      expect(region1NodeIds.has(n.id)).toBe(false);
      expect(n.z).toBeGreaterThan(VALLEY_START_Z);
      expect(n.z).toBeLessThanOrEqual(REGION_TWO_MAX_Z);
    }
    for (const m of region2Mobs) {
      expect(m.id.startsWith("m2_")).toBe(true);
      expect(region1MobIds.has(m.id)).toBe(false);
    }
  });

  it("only spawns the existing tier-3/4 mobs, much denser than any region-1 biome", () => {
    const region2Mobs = generateRegionTwoMobSpawns();
    const highTier = new Set(["giant", "yeti", "yetialt", "golem", "demon", "demonalt", "dragon"]);
    for (const m of region2Mobs) {
      expect(highTier.has(m.type)).toBe(true);
      expect(mobDef(m.type).tier).toBeGreaterThanOrEqual(3);
    }
    // Denser than region 1's mountain biome, which is the closest comparison.
    const region1Mobs = generateMobSpawns();
    const region1Mountain = region1Mobs.filter((m) => biomeAt(m.x, m.z) === "mountain");
    const region1Density = region1Mountain.length / (600 * 600);
    const region2Density = region2Mobs.length / (600 * 600);
    expect(region2Density).toBeGreaterThan(region1Density);
  });

  it("terrain stays mostly above water and reads as mountain/hills", () => {
    let aboveWater = 0;
    let total = 0;
    const biomes = new Set<string>();
    for (let x = -300; x <= 300; x += 20) {
      for (let z = VALLEY_START_Z + 20; z <= REGION_TWO_MAX_Z - 20; z += 20) {
        total++;
        if (terrainHeight(x, z) > WATER_LEVEL) aboveWater++;
        biomes.add(biomeAt(x, z));
      }
    }
    expect(aboveWater / total).toBeGreaterThan(0.6);
    for (const b of biomes) expect(["mountain", "hills"]).toContain(b);
  });

  it("region 1 (z <= 300) never uses the north branch, and default calls are unaffected", () => {
    // The real regression guard is that every pre-existing test in this file
    // (biome sweep, node/mob placement, rivers, bridges) still passes
    // unmodified — this just adds an explicit boundary check that z=300
    // itself (the last region-1 coordinate) still behaves like ordinary
    // land, not the valley floor.
    for (let x = -300; x <= 300; x += 60) {
      expect(Number.isFinite(terrainHeight(x, VALLEY_START_Z))).toBe(true);
    }
    expect(generateNodes().length).toBeGreaterThan(0);
    expect(generateMobSpawns().length).toBeGreaterThan(0);
  });
});

describe("dungeon interiors", () => {
  const portals = generatePois().filter((p) => p.type === "dungeon_portal");

  it("has at least two dungeon portals to test", () => {
    expect(portals.length).toBeGreaterThanOrEqual(2);
  });

  it("dungeonFloorHeightAt returns the layout's flat floorY within the wall radius, null far away", () => {
    for (const portal of portals) {
      const layout = generateDungeonLayout(portal.id);
      expect(dungeonFloorHeightAt(layout.entryPoint.x, layout.entryPoint.z)).toBe(layout.floorY);
      const nearEdge = layout.entryPoint.x - 6;
      expect(dungeonFloorHeightAt(nearEdge, layout.entryPoint.z)).toBe(layout.floorY);
      const farAway = portal.arenaX! + DUNGEON_WALL_RADIUS + 200;
      expect(dungeonFloorHeightAt(farAway, portal.arenaZ!)).toBeNull();
    }
  });

  it("dungeonPortalAt identifies the correct portal within its wall radius, null far away", () => {
    for (const portal of portals) {
      expect(dungeonPortalAt(portal.arenaX!, portal.arenaZ!)?.id).toBe(portal.id);
      const farAway = portal.arenaX! + DUNGEON_WALL_RADIUS + 200;
      expect(dungeonPortalAt(farAway, portal.arenaZ!)).toBeNull();
    }
  });

  it("pillars/rubble are deterministic and differ between distinct portals", () => {
    const [a, b] = portals;
    const layoutA1 = generateDungeonLayout(a!.id);
    const layoutA2 = generateDungeonLayout(a!.id);
    expect(layoutA1.pillars).toEqual(layoutA2.pillars);
    expect(layoutA1.rubble).toEqual(layoutA2.rubble);

    const layoutB = generateDungeonLayout(b!.id);
    expect(layoutB.pillars).not.toEqual(layoutA1.pillars);
    expect(layoutB.rubble).not.toEqual(layoutA1.rubble);
  });

  it("doorwayAngle points from the room center back toward the portal's own outdoor position", () => {
    for (const portal of portals) {
      const layout = generateDungeonLayout(portal.id);
      const expected = Math.atan2(layout.center.x - portal.x, layout.center.z - portal.z);
      expect(layout.doorwayAngle).toBeCloseTo(expected, 5);
    }
  });
});

describe("dungeon editor blueprints", () => {
  // tier 0 and tier 3 are real, live-editable content authored via the
  // in-browser dungeon editor (packages/client/src/ui/DungeonEditor.svelte)
  // -- packages/shared/src/content/dungeonBlueprints/{0,3}.json can go from
  // empty placeholder to fully authored (or back) as the user edits, so
  // these tests deliberately don't assume which state either tier is in;
  // they check the *wiring* is correct whichever state they're found in.
  // The stairs-rise/height-continuity math itself is covered independent of
  // any real file by the deriveDungeonGridFromAssets / dungeonTileFloorHeight
  // unit tests below.
  it("hasDungeonBlueprint reflects whether a tier's blueprint has any assets, and is false for an unknown tier", () => {
    expect(hasDungeonBlueprint(99)).toBe(false);
    for (const tier of [0, 3]) {
      expect(hasDungeonBlueprint(tier)).toBe((DUNGEON_BLUEPRINTS[tier]?.assets.length ?? 0) > 0);
    }
  });

  it("generateDungeonLayout wires an authored tier's blueprint straight through, deriving the grid from its assets", () => {
    const portal = generatePois().find(
      (p) => p.type === "dungeon_portal" && hasDungeonBlueprint(p.dungeonTier ?? 0)
    );
    if (!portal) return; // no tier currently authored -- covered by the fallback test below instead
    const tier = portal.dungeonTier ?? 0;
    const layout = generateDungeonLayout(portal.id);
    const bp = DUNGEON_BLUEPRINTS[tier]!;
    expect(layout.assets).toEqual(bp.assets);
    expect(layout.chests).toEqual(bp.chests);
    expect(layout.mobSpawns).toEqual(bp.mobSpawns);
    expect(layout.entryPoint).toEqual({ x: layout.center.x + bp.entryLocal.x, z: layout.center.z + bp.entryLocal.z });
    // pillars/rubble are vestigial for blueprint-driven tiers, unlike the procedural path.
    expect(layout.pillars).toEqual([]);
    expect(layout.rubble).toEqual([]);
  });

  it("generateDungeonLayout falls back to procedural generation for any portal whose tier has no authored blueprint", () => {
    for (const portal of generatePois().filter((p) => p.type === "dungeon_portal")) {
      if (hasDungeonBlueprint(portal.dungeonTier ?? 0)) continue;
      const layout = generateDungeonLayout(portal.id);
      expect(layout.assets.length).toBeGreaterThan(0);
      // Non-empty pillars is a procedural-only signal (blueprint-driven
      // layouts always report [] -- see the authored-tier test above).
      expect(layout.pillars.length).toBeGreaterThan(0);
    }
  });

  it("deriveDungeonGridFromAssets ignores non-floor/stairs assets", () => {
    const assets: DungeonAsset[] = [
      { model: "torch_mounted.gltf", localX: 0, localY: 0, localZ: 0, yaw: 0 },
      { model: "pillar.gltf", localX: 4, localY: 0, localZ: 0, yaw: 0 },
    ];
    expect(deriveDungeonGridFromAssets(assets)).toEqual([]);
  });

  it("deriveDungeonGridFromAssets maps a floor asset's localY straight through as walkable height", () => {
    const assets: DungeonAsset[] = [
      { model: "floor_tile_large.gltf", localX: -58, localY: 2.5, localZ: -58, yaw: 0 },
    ];
    const grid = deriveDungeonGridFromAssets(assets);
    expect(grid).toHaveLength(1);
    expect(grid[0]).toMatchObject({ tx: 0, tz: 0, type: "floor", height: 2.5 });
  });

  it("deriveDungeonGridFromAssets maps stairs yaw to the correct cardinal stairsDir and carries rise through", () => {
    const cases: { yaw: number; dir: { x: number; z: number } }[] = [
      { yaw: 0, dir: { x: 0, z: -1 } },
      { yaw: Math.PI / 2, dir: { x: -1, z: 0 } },
      { yaw: Math.PI, dir: { x: 0, z: 1 } },
      { yaw: -Math.PI / 2, dir: { x: 1, z: 0 } },
    ];
    for (const c of cases) {
      const grid = deriveDungeonGridFromAssets([
        { model: "stairs_modular_center.gltf", localX: -58, localY: 0, localZ: -58, yaw: c.yaw, rise: 4.0 },
      ]);
      expect(grid[0]!.type).toBe("stairs");
      expect(grid[0]!.stairsDir).toMatchObject({ x: c.dir.x, z: c.dir.z, rise: 4.0 });
    }
  });

  it("deriveDungeonGridFromAssets defaults rise to 1.0 when the asset omits it", () => {
    const grid = deriveDungeonGridFromAssets([
      { model: "stairs_wide.gltf", localX: -58, localY: 0, localZ: -58, yaw: 0 },
    ]);
    expect(grid[0]!.stairsDir!.rise).toBe(1.0);
  });

  it("dungeonTileFloorHeight ramps across a stairs tile scaled by its own rise, not a hardcoded 1.0", () => {
    const tile = { tx: 0, tz: 0, type: "stairs" as const, height: 10, stairsDir: { x: 1, z: 0, rise: 5.1 } };
    const cellCenterX = -60 + 0 * 4 + 2; // dungeonCellCenter(0)
    const cellCenterZ = -60 + 0 * 4 + 2;
    const atStart = dungeonTileFloorHeight(tile, cellCenterX - 2, cellCenterZ, 100);
    const atEnd = dungeonTileFloorHeight(tile, cellCenterX + 2, cellCenterZ, 100);
    expect(atStart).toBeCloseTo(100 + 10, 5);
    expect(atEnd).toBeCloseTo(100 + 10 + 5.1, 5);
  });

  it("dungeonTileFloorHeight is flat for floor tiles regardless of position", () => {
    const tile = { tx: 0, tz: 0, type: "floor" as const, height: 3 };
    expect(dungeonTileFloorHeight(tile, 0, 0, 50)).toBe(53);
    expect(dungeonTileFloorHeight(tile, 1.9, -1.9, 50)).toBe(53);
  });
});

describe("mineral ore nodes", () => {
  const ORE_TYPES = ["copper_vein", "tin_vein", "iron_deposit", "mithril_deposit", "thorium_vein"];

  it("region 1 ore nodes only spawn in mountain/hills/dunes biomes, never forest/meadow/swamp", () => {
    const nodes = generateNodes();
    const oreNodes = nodes.filter((n) => ORE_TYPES.includes(n.type));
    expect(oreNodes.length).toBeGreaterThan(0);
    for (const n of oreNodes) {
      expect(["mountain", "hills", "dunes"]).toContain(n.biome);
    }
  });

  it("thorium_vein is exclusive to Ashenpeak (region 2) -- never in region 1", () => {
    const region1 = generateNodes();
    const region2 = generateRegionTwoNodes();
    expect(region1.some((n) => n.type === "thorium_vein")).toBe(false);
    expect(region2.some((n) => n.type === "thorium_vein")).toBe(true);
  });

  it("mithril_deposit appears in both region 1's mountain biome and region 2", () => {
    // Region 1's default bounds only contain a couple dozen mountain-biome
    // node cells -- too small a sample for an ~8% cumulative band to be
    // guaranteed present for any single deterministic seed. Sample a much
    // larger window of the same terrain/table to check the composition
    // reliably, without changing production placement odds.
    const bigSample = generateNodes({ minX: -900, maxX: 900, minZ: -900, maxZ: 900 }, "big_", 555);
    const region2 = generateRegionTwoNodes();
    expect(bigSample.some((n) => n.type === "mithril_deposit" && n.biome === "mountain")).toBe(true);
    expect(region2.some((n) => n.type === "mithril_deposit")).toBe(true);
  });

  it("dunes only ever gets the thin copper_vein band, never tin/iron/mithril/thorium", () => {
    const nodes = generateNodes();
    const dunesOre = nodes.filter((n) => n.biome === "dunes" && ORE_TYPES.includes(n.type));
    for (const n of dunesOre) expect(n.type).toBe("copper_vein");
  });
});
