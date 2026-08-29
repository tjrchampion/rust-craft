import { describe, it, expect } from "vitest";
import {
  REGION_BIOMES,
  generateRandomRegionBlueprint,
  generateMmoRegionName,
  generateMultiRegionContinent,
  sampleRegionHeight,
  sampleRegionWaterDepth,
  stitchRegionSeams,
  regenRegionCoastlines,
  regenContinentCoastlines,
  detectRegionNeighborEdges,
  evaluateContinentMacroTerrain,
  evaluateCoastalLandforms,
  computeLandmassDistanceToOcean,
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

  it("generates populated trees and valid terrain across all biomes", () => {
    for (const biome of REGION_BIOMES) {
      const bp = generateRandomRegionBlueprint(`seed-${biome}`, biome, "Region");
      // Tree foliage assets are placed
      const foliage = bp.assets.filter((a) => a.category === "foliage");
      expect(foliage.length).toBeGreaterThan(0);
      // Heightmap is fully populated (no holes)
      expect(bp.heights.length).toBe(bp.gridSizeX! * bp.gridSizeZ!);
      expect(bp.heights.every((h) => Number.isFinite(h))).toBe(true);
    }
  });

  it("mob spawns are placed on dry ground", () => {
    const bp = generateRandomRegionBlueprint("seed-mobs", "swamp", "Mire");
    expect(bp.mobSpawns.length).toBeGreaterThan(0);
  });

  it("trees are strictly placed on dry ground away from sea and water", () => {
    for (const biome of REGION_BIOMES) {
      const bp = generateRandomRegionBlueprint(`seed-trees-${biome}`, biome, "Shore Test Isle");
      for (const asset of bp.assets) {
        if (asset.category === "foliage") {
          // Foliage must be at dry height (above sea level 0)
          expect(asset.localY).toBeGreaterThanOrEqual(0.05);
        }
      }
    }
  });

  it("generates resource nodes with density and variety filters", () => {
    const bp = generateRandomRegionBlueprint("seed-res", "forest", "Resource Forest", {
      resourceDensity: 1.5,
      resourceVariety: ["copper_vein", "iron_deposit", "berry_bush"],
    });
    expect(bp.resourceNodes).toBeDefined();
    expect(bp.resourceNodes!.length).toBeGreaterThan(0);
    expect(bp.resourceNodes!.every((n) => ["copper_vein", "iron_deposit", "berry_bush"].includes(n.type))).toBe(true);
  });

  it("generates MMO region names for all biomes", () => {
    for (const biome of REGION_BIOMES) {
      const name = generateMmoRegionName(biome, 10);
      expect(typeof name).toBe("string");
      expect(name.length).toBeGreaterThan(3);
    }
  });

  it("respects custom gridSizeX, gridSizeZ, and pitch", () => {
    const customBp = generateRandomRegionBlueprint("seed-custom-size", "forest", "Custom Sized Isle", {
      gridSizeX: 64,
      gridSizeZ: 32,
      pitch: 6,
    });
    expect(customBp.gridSizeX).toBe(64);
    expect(customBp.gridSizeZ).toBe(32);
    expect(customBp.heights.length).toBe(64 * 32);
    expect(customBp.waterHeights?.length).toBe(64 * 32);
  });

  it("generates natural elevated terrain with rich height variation and coastal sea falloff", () => {
    const bp = generateRandomRegionBlueprint("seed-natural", "forest", "Green Hills Province");
    const halfX = (bp.gridSizeX! - 1) * bp.pitch / 2;
    // Ground elevation is above sea level in the interior spawn area
    expect(sampleRegionWaterDepth(bp, 0, 0)).toBe(0);
    expect(sampleRegionHeight(bp, 0, 0)).toBeGreaterThan(0.5);
    expect(sampleRegionHeight(bp, -halfX + 45, 0)).toBeGreaterThan(0.5);
    // Outer unbordered perimeter dips into coastal ocean
    expect(sampleRegionHeight(bp, -halfX, 0)).toBeLessThan(0);
    expect(bp.waterHeights?.some((w) => w > 0)).toBe(true);

    // When bordering a neighbor on the west, the western edge does NOT dip into ocean
    const bpBorder = generateRandomRegionBlueprint("seed-border", "forest", "Border Province", {
      neighborEdges: { west: true },
    });
    expect(sampleRegionHeight(bpBorder, -halfX, 0)).toBeGreaterThan(0.5);
  });

  it("generates rich inland water bodies and marshes for wetland biomes", () => {
    const swampBp = generateRandomRegionBlueprint("seed-swamp", "swamp", "Misty Mire");
    const waterCells = swampBp.waterHeights?.filter((w) => w > 0).length ?? 0;
    expect(waterCells).toBeGreaterThan(50);
  });

  it("generates a multi-region continent with varied sizes and neighbor detection", () => {
    const continent = generateMultiRegionContinent({
      seed: "test-continent-1",
      regionCount: 4,
      layout: "continent",
      sizeVariation: "varied",
      continentScale: "massive",
      biomeDistribution: "thematic_continent",
      levelProgression: "tiered",
    });

    expect(continent.length).toBe(4);
    // Starter region is marked
    expect(continent.some((r) => r.isStartingRegion)).toBe(true);

    // All regions are massive (>= 128) and have matching flush boundaries
    for (const r of continent) {
      expect(r.name.length).toBeGreaterThan(3);
      expect(r.gridSizeX).toBeGreaterThanOrEqual(128);
      expect(r.gridSizeZ).toBeGreaterThanOrEqual(128);
      expect(r.heights.length).toBe(r.gridSizeX! * r.gridSizeZ!);
      expect(r.worldOriginX).toBeDefined();
      expect(r.worldOriginZ).toBeDefined();
    }

    // Verify 2x2 layout touches flush with 0 gap
    const r00 = continent[0]!; // col 0, row 0
    const r10 = continent[1]!; // col 1, row 0
    const r01 = continent[2]!; // col 0, row 1
    const r11 = continent[3]!; // col 1, row 1

    const r00_maxX = r00.worldOriginX! + ((r00.gridSizeX! - 1) * r00.pitch) / 2;
    const r10_minX = r10.worldOriginX! - ((r10.gridSizeX! - 1) * r10.pitch) / 2;
    // Horizontal seam touches with 0 gap
    expect(Math.abs(r00_maxX - r10_minX)).toBeLessThanOrEqual(0.01);

    const r00_maxZ = r00.worldOriginZ! + ((r00.gridSizeZ! - 1) * r00.pitch) / 2;
    const r01_minZ = r01.worldOriginZ! - ((r01.gridSizeZ! - 1) * r01.pitch) / 2;
    // Vertical seam touches with 0 gap
    expect(Math.abs(r00_maxZ - r01_minZ)).toBeLessThanOrEqual(0.01);

    // Verify continuous terrain height parity along shared boundary between r00 and r10
    const sampleCount = Math.min(r00.gridSizeZ!, r10.gridSizeZ!);
    for (let gz = 0; gz < sampleCount; gz++) {
      const h00_East = r00.heights[gz * r00.gridSizeX! + (r00.gridSizeX! - 1)]!;
      const h10_West = r10.heights[gz * r10.gridSizeX! + 0]!;
      expect(Math.abs(h00_East - h10_West)).toBeLessThanOrEqual(0.05);
    }
  });

  it("generates compact and micro scale worlds with flush borders", () => {
    const microWorld = generateMultiRegionContinent({
      seed: "micro-world-test",
      regionCount: 2,
      continentScale: "micro",
      layout: "linear",
      sizeVariation: "uniform",
    });
    expect(microWorld.length).toBe(2);
    expect(microWorld[0]!.gridSizeX).toBe(32);
    expect(microWorld[0]!.gridSizeZ).toBe(32);
  });

  it("generates wide and tall rectangular world layouts with rectangular provinces", () => {
    const wideContinent = generateMultiRegionContinent({
      seed: "panoramic-wide-test",
      regionCount: 6,
      layout: "rectangle_wide",
      sizeVariation: "rectangular",
      continentScale: "small",
    });
    expect(wideContinent.length).toBe(6);
    // Verified 3 columns x 2 rows
    const cols = new Set(wideContinent.map((r) => r.worldOriginX));
    const rows = new Set(wideContinent.map((r) => r.worldOriginZ));
    expect(cols.size).toBe(3);
    expect(rows.size).toBe(2);

    // Verify all touching boundaries remain 100% flush with zero gap
    for (let i = 0; i < wideContinent.length; i++) {
      const r = wideContinent[i]!;
      expect(r.gridSizeX).toBeGreaterThanOrEqual(32);
      expect(r.gridSizeZ).toBeGreaterThanOrEqual(32);
      expect(r.heights.length).toBe(r.gridSizeX! * r.gridSizeZ!);
    }
  });

  it("generates natural landscape variants with islands, fjords, and calderas", () => {
    const islandRegion = generateRandomRegionBlueprint("island-test-seed", "forest", "Isle of Whispers", {
      landscapeVariant: "archipelago",
      gridSizeX: 64,
      gridSizeZ: 64,
    });
    expect(islandRegion.heights.length).toBe(64 * 64);
    // Verified there are dry island peaks rising above water level (h > 0)
    const dryHeights = islandRegion.heights.filter((h) => h > 0);
    const waterHeights = islandRegion.heights.filter((h) => h <= 0);
    expect(dryHeights.length).toBeGreaterThan(50);
    expect(waterHeights.length).toBeGreaterThan(100);

    const calderaRegion = generateRandomRegionBlueprint("caldera-seed-1", "volcanic", "Crater Caldera", {
      landscapeVariant: "caldera",
      gridSizeX: 64,
      gridSizeZ: 64,
    });
    expect(calderaRegion.heights.length).toBe(64 * 64);
  });

  it("stitches and harmonizes touching border seams between independent single regions", () => {
    // Generate two independent single regions with different biomes and seeds
    const size = 32;
    const pitch = 6;
    const span = (size - 1) * pitch; // 186m

    // Region A at origin (0, 0), Region B snapped flush to its East edge (+186, 0)
    const bpA = generateRandomRegionBlueprint("seed-east-a", "forest", "West Woods", {
      gridSizeX: size,
      gridSizeZ: size,
      pitch,
      worldOriginX: 0,
      worldOriginZ: 0,
    });

    const bpB = generateRandomRegionBlueprint("seed-west-b", "desert", "East Dunes", {
      gridSizeX: size,
      gridSizeZ: size,
      pitch,
      worldOriginX: span,
      worldOriginZ: 0,
    });

    // Before stitching: the east border of A and west border of B have different heights
    const unstitchedA_East = bpA.heights[(size / 2) * size + (size - 1)]!;
    const unstitchedB_West = bpB.heights[(size / 2) * size + 0]!;

    const [stitchedA, stitchedB] = stitchRegionSeams([bpA, bpB], { blendMargin: 24 });
    expect(stitchedA).toBeDefined();
    expect(stitchedB).toBeDefined();

    // After stitching: all along the shared boundary, heights match seamlessly
    for (let iz = 0; iz < size; iz++) {
      const hA = stitchedA!.heights[iz * size + (size - 1)]!;
      const hB = stitchedB!.heights[iz * size + 0]!;
      expect(Math.abs(hA - hB)).toBeLessThan(0.05);
    }
  });

  it("regenerates coastlines and open sea along unbordered outer edges", () => {
    const size = 32;
    const pitch = 6;
    const bp = generateRandomRegionBlueprint("seed-coast-test", "forest", "Coastal Test", {
      gridSizeX: size,
      gridSizeZ: size,
      pitch,
    });

    // West and South are connected to neighbors, North and East are open ocean
    const neighborEdges = { north: false, south: true, east: false, west: true };
    const coastalBp = regenRegionCoastlines(bp, neighborEdges, { oceanDepth: -6.0 });

    // Open North and East border vertices should sink into deep sea floor (h < 0) with water depth > 0
    const northEdgeH = coastalBp.heights[(size - 1) * size + Math.floor(size / 2)]!;
    const eastEdgeH = coastalBp.heights[Math.floor(size / 2) * size + (size - 1)]!;
    expect(northEdgeH).toBeLessThan(0);
    expect(eastEdgeH).toBeLessThan(0);
    expect(coastalBp.waterHeights?.length).toBe(size * size);

    // Neighbored West and South borders MUST NOT drop into ocean depth. They
    // preserve their original height UNLESS it was already below the
    // walkable land-connection floor (e.g. this blueprint was generated
    // without knowing the west/south neighbors existed yet) -- in that case
    // the border is raised (never lowered) up to the floor, guaranteeing a
    // land connection to the neighbor instead of silently leaving a stray
    // trench right where it expects dry ground to meet it.
    const westEdgeOrigH = bp.heights[Math.floor(size / 2) * size + 0]!;
    const westEdgeCoastH = coastalBp.heights[Math.floor(size / 2) * size + 0]!;
    expect(westEdgeCoastH).toBeGreaterThanOrEqual(westEdgeOrigH - 0.01);
    expect(westEdgeCoastH).toBeGreaterThanOrEqual(1.99);

    const southEdgeOrigH = bp.heights[0 * size + Math.floor(size / 2)]!;
    const southEdgeCoastH = coastalBp.heights[0 * size + Math.floor(size / 2)]!;
    expect(southEdgeCoastH).toBeGreaterThanOrEqual(southEdgeOrigH - 0.01);
    expect(southEdgeCoastH).toBeGreaterThanOrEqual(1.99);

    // Inland core (center) should remain dry land
    const centerH = coastalBp.heights[Math.floor(size / 2) * size + Math.floor(size / 2)]!;
    expect(centerH).toBeGreaterThan(-1.0);
  });

  it("evaluates diverse coastal landforms including headlands, coves, tombolos, and barrier islands", () => {
    const seedH = 0x5a1b3c;
    const halfX = 100;
    const halfZ = 100;
    const neighborEdges = { north: false, south: false, east: false, west: true };

    // Sample along the open east edge (perimeter facing sea)
    let foundPromontory = false;
    let foundCove = false;
    let foundSpitOrTombolo = false;
    let foundIsland = false;

    for (let x = -halfX; x <= halfX; x += 5) {
      for (let z = -halfZ; z <= halfZ; z += 5) {
        const c = evaluateCoastalLandforms(x, z, x, z, halfX, halfZ, neighborEdges, seedH, 50);
        if (c.promontoryLift > 0.5) foundPromontory = true;
        if (c.coveCarve > 0.5) foundCove = true;
        if (c.spitRidge > 0.5) foundSpitOrTombolo = true;
        if (c.islandHeight > 0.5) foundIsland = true;
      }
    }

    expect(foundPromontory).toBe(true);
    expect(foundCove).toBe(true);
    expect(foundSpitOrTombolo).toBe(true);
    expect(foundIsland).toBe(true);
  });

  it("computes continuous ocean distance across staggered and irregular multi-region layouts", () => {
    // Staggered layout: Razorfen (top right) and Witchwood Basin (bottom left with partial X overlap)
    const regions = [
      { minX: 0, maxX: 200, minZ: 200, maxZ: 400 },     // Razorfen (top)
      { minX: -150, maxX: 100, minZ: 0, maxZ: 200 },    // Witchwood Basin (bottom)
    ];

    // Point in Witchwood Basin under Razorfen (X = 50, Z = 190):
    // Z-ray extends continuously from 0 up to 400 (distN = 400 - 190 = 210m, distS = 190m)
    const underRazorfen = computeLandmassDistanceToOcean(50, 190, 50, 90, 125, 100, undefined, regions);
    expect(underRazorfen.distN).toBeGreaterThan(150); // Land continues straight through into Razorfen!
    expect(underRazorfen.distS).toBeGreaterThan(150);

    // Point in Witchwood Basin to the west of Razorfen (X = -50, Z = 190):
    // Z-ray ends at Z = 200 (distN = 200 - 190 = 10m -> slopes naturally into North ocean)
    const westOfRazorfen = computeLandmassDistanceToOcean(-50, 190, -50, 90, 125, 100, undefined, regions);
    expect(westOfRazorfen.distN).toBeLessThanOrEqual(10);
    expect(westOfRazorfen.distS).toBeGreaterThan(150);

    // Point in Razorfen right above Witchwood Basin (X = 50, Z = 210):
    // Z-ray extends continuously down to 0 (distS = 210 - 0 = 210m)
    const inRazorfenAbove = computeLandmassDistanceToOcean(50, 210, -50, -90, 100, 100, undefined, regions);
    expect(inRazorfenAbove.distS).toBeGreaterThan(150); // Land continues straight down into Witchwood Basin!
  });

  it("regenContinentCoastlines produces seamless solid land across staggered region overlaps", () => {
    const size = 32;
    const pitch = 4;
    const half = ((size - 1) * pitch) / 2; // 62m

    // Razorfen at (50, 62), Witchwood Basin at (0, -62)
    const bpRazorfen = generateRandomRegionBlueprint("razorfen", "swamp", "Razorfen", {
      worldOriginX: 50,
      worldOriginZ: 62,
      gridSize: size,
      pitch,
    });
    const bpWitchwood = generateRandomRegionBlueprint("witchwood", "forest", "Witchwood Basin", {
      worldOriginX: 0,
      worldOriginZ: -62,
      gridSize: size,
      pitch,
    });

    const [coastalRazorfen, coastalWitchwood] = regenContinentCoastlines([bpRazorfen, bpWitchwood]);

    // Sample along the shared overlap at world X = 25, Z = 0 (the seam between Razorfen and Witchwood):
    // Heights should be solid dry land (>= 1.5m), not ocean floor (-5.5m)!
    const hRazorfenAtSeam = sampleRegionHeight(coastalRazorfen!, 25 - 50, 0 - 62);
    const hWitchwoodAtSeam = sampleRegionHeight(coastalWitchwood!, 25 - 0, 0 - (-62));

    expect(hRazorfenAtSeam).toBeGreaterThan(0.5);
    expect(hWitchwoodAtSeam).toBeGreaterThan(0.5);
  });

  it("detectRegionNeighborEdges accurately detects adjacent neighbors and continent perimeter", () => {
    const size = 32;
    const pitch = 6;
    const span = (size - 1) * pitch; // 186m

    const bpWest = {
      id: "region-w",
      gridSize: size,
      pitch,
      worldOriginX: 0,
      worldOriginZ: 0,
    };
    const bpEast = {
      id: "region-e",
      gridSize: size,
      pitch,
      worldOriginX: span,
      worldOriginZ: 0,
    };

    const edgesW = detectRegionNeighborEdges(bpWest, [bpWest, bpEast]);
    expect(edgesW.east).toBe(true);
    expect(edgesW.west).toBe(false); // Perimeter facing open sea
    expect(edgesW.north).toBe(false);
    expect(edgesW.south).toBe(false);

    const edgesE = detectRegionNeighborEdges(bpEast, [bpWest, bpEast]);
    expect(edgesE.west).toBe(true);
    expect(edgesE.east).toBe(false); // Perimeter facing open sea
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

  it("handles rectangular gridSizeX and gridSizeZ", () => {
    const rectBp = {
      gridSize: 3,
      gridSizeX: 3,
      gridSizeZ: 2,
      pitch: 4,
      heights: [
        0, 1, 2,
        3, 4, 5,
      ],
    };
    // halfX = (3-1)*4/2 = 4, halfZ = (2-1)*4/2 = 2
    expect(sampleRegionHeight(rectBp, -4, -2)).toBeCloseTo(0);
    expect(sampleRegionHeight(rectBp, 4, -2)).toBeCloseTo(2);
    expect(sampleRegionHeight(rectBp, -4, 2)).toBeCloseTo(3);
    expect(sampleRegionHeight(rectBp, 4, 2)).toBeCloseTo(5);
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

describe("RegionPoi schema", () => {
  it("supports landmark 3D model, category, yaw, and scale fields", () => {
    const poi = {
      id: "poi_1",
      name: "Ancient Ruins",
      localX: 20,
      localZ: -15,
      revealShape: [
        { x: 10, z: -10 },
        { x: 30, z: -10 },
        { x: 30, z: -20 },
        { x: 10, z: -20 },
      ],
      model: "castle_ruins/CastleRuins.glb",
      category: "building" as const,
      yaw: 1.57,
      scale: 1.5,
      rewardXp: 50,
      interactRadius: 8,
    };
    expect(poi.model).toBe("castle_ruins/CastleRuins.glb");
    expect(poi.category).toBe("building");
    expect(poi.scale).toBe(1.5);
    expect(poi.revealShape.length).toBe(4);
  });
});

describe("Region level difficulty", () => {
  it("generates default level range (1-5) and accepts custom minLevel/maxLevel", () => {
    const defaultBp = generateRandomRegionBlueprint("seed-lvl", "grassland", "Starter Isle");
    expect(defaultBp.minLevel).toBe(1);
    expect(defaultBp.maxLevel).toBe(5);

    const customBp = generateRandomRegionBlueprint("seed-lvl-2", "forest", "Highlands", {
      minLevel: 3,
      maxLevel: 7,
    });
    expect(customBp.minLevel).toBe(3);
    expect(customBp.maxLevel).toBe(7);
  });
});

