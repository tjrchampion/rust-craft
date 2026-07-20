import { hash2, mulberry32, hashString } from "./rng";
import { DUNGEON_BLUEPRINTS, hasDungeonBlueprint } from "./content/dungeonBlueprints";
import {
  terrainHeight,
  terrainHeightBeforeRivers,
  terrainSlope,
  fbm,
  biomeAt,
  generateRivers,
  distToRiver,
  RIVER_HALF_WIDTH,
  type Biome,
} from "./terrain";
import {
  ZONE_SEED,
  ZONE_SIZE,
  WATER_LEVEL,
  SPAWN_POINT,
  WORLD_MIN_X,
  WORLD_MAX_X,
  VALLEY_START_Z,
  REGION_TWO_MAX_Z,
  REGION_TWO_GATE_X,
  REGION_TWO_GATE_Z,
  DUNGEON_ARENA_RADIUS,
  DUNGEON_WALL_RADIUS,
} from "./constants";
import { dist2D, clamp, distPointToSegment } from "./math";

export interface WorldNode {
  id: string;
  type: string; // node type id
  x: number;
  y: number;
  z: number;
  /** Deterministic per-node variation in [0,1) for scale/rotation. */
  variant: number;
  biome: Biome;
}

export interface MobSpawn {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
}

export interface BuildingSpec {
  /** Model key, e.g. 'home_A', 'tavern', 'well', 'destroyed'. */
  type: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

export interface VillageSpec {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
  buildings: BuildingSpec[];
}

export interface NpcSpec {
  id: string;
  /** Index into generateVillages() this NPC belongs to. */
  villageIndex: number;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface PathSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

export type PoiType = "ruins" | "shrine" | "camp" | "tower" | "dungeon_portal";

export interface PoiSpec {
  id: string;
  type: PoiType;
  x: number;
  y: number;
  z: number;
  yaw: number;
  buildings: BuildingSpec[];
  /** dungeon_portal only: which difficulty tier this portal leads to. */
  dungeonTier?: number;
  /** dungeon_portal only: center of the reserved arena rectangle this
   *  portal's dungeon run takes place in (see inDungeonReserve /
   *  generateDungeonLayout) -- distinct from the portal's own x/z, which is
   *  a normal walkable overworld waypoint near, but outside, the arena. */
  arenaX?: number;
  arenaZ?: number;
}

const NODE_CELL = 14; // meters per scatter cell
const MOB_CELL = 55;
const SPAWN_CLEAR_RADIUS = 18;
const PATH_CLEAR = 3.5;
const POI_CLEAR = 10;

export { distPointToSegment } from "./math";

// ============================ villages ============================

const VILLAGE_FIRST = ["Oak", "Stone", "Elder", "Raven", "Fox", "Mill", "Ash", "Briar"];
const VILLAGE_SECOND = ["hollow", "brook", "stead", "field", "haven", "moor", "glen", "wick"];

const VILLAGE_BUILDING_POOL = [
  "home_A",
  "home_B",
  "tavern",
  "blacksmith",
  "market",
  "church",
  "windmill",
  "lumbermill",
  "home_A",
  "home_B",
];

function isBuildableSite(x: number, z: number): boolean {
  const y = terrainHeight(x, z);
  if (y < WATER_LEVEL + 1.2 || y > 18) return false;
  if (terrainSlope(x, z) > 0.45) return false;
  if (distToRiver(x, z) < RIVER_HALF_WIDTH + 6) return false;
  return true;
}

let villagesCache: VillageSpec[] | null = null;

/** Deterministically settle 4 villages around the mid-radius of the zone. */
export function generateVillages(): VillageSpec[] {
  if (villagesCache) return villagesCache;
  const villages: VillageSpec[] = [];
  for (let i = 0; i < 4; i++) {
    const rng = mulberry32(ZONE_SEED * 7 + i * 131);
    let sx = 0;
    let sz = 0;
    let found = false;
    // Sweep candidate rings until a buildable site appears (deterministic).
    outer: for (let attempt = 0; attempt < 40; attempt++) {
      const angle = ((i + 0.18 + attempt * 0.021) / 4) * Math.PI * 2 + rng() * 0.2;
      const radius = 150 + ((attempt * 13) % 70) + rng() * 12;
      const cx = Math.sin(angle) * radius;
      const cz = Math.cos(angle) * radius;
      // Site must be buildable at center and at 3 probe points.
      if (
        isBuildableSite(cx, cz) &&
        isBuildableSite(cx + 10, cz) &&
        isBuildableSite(cx, cz + 10) &&
        isBuildableSite(cx - 10, cz - 10)
      ) {
        sx = cx;
        sz = cz;
        found = true;
        break outer;
      }
    }
    if (!found) continue;

    const name =
      VILLAGE_FIRST[Math.floor(rng() * VILLAGE_FIRST.length)]! +
      VILLAGE_SECOND[Math.floor(rng() * VILLAGE_SECOND.length)]!;

    const buildings: BuildingSpec[] = [
      { type: "well", x: sx, y: terrainHeight(sx, sz), z: sz, yaw: rng() * Math.PI * 2, scale: 1 },
    ];
    // Two concentric rings for a proper town: landmarks inner, homes outer.
    const startAngle = rng() * Math.PI * 2;
    const inner = ["tavern", "blacksmith", "market", "church"];
    const innerCount = 4 + Math.floor(rng() * 2); // 4-5
    for (let b = 0; b < innerCount; b++) {
      const angle = startAngle + (b / innerCount) * Math.PI * 2 + (rng() - 0.5) * 0.3;
      const dist = 13 + rng() * 4;
      const bx = sx + Math.sin(angle) * dist;
      const bz = sz + Math.cos(angle) * dist;
      if (!isBuildableSite(bx, bz)) continue;
      const type = b < inner.length ? inner[b]! : VILLAGE_BUILDING_POOL[Math.floor(rng() * VILLAGE_BUILDING_POOL.length)]!;
      buildings.push({ type, x: bx, y: terrainHeight(bx, bz), z: bz, yaw: Math.atan2(sx - bx, sz - bz), scale: 1 });
    }
    const outerCount = 6 + Math.floor(rng() * 4); // 6-9 homes
    const outerStart = rng() * Math.PI * 2;
    for (let b = 0; b < outerCount; b++) {
      const angle = outerStart + (b / outerCount) * Math.PI * 2 + (rng() - 0.5) * 0.35;
      const dist = 24 + rng() * 8;
      const bx = sx + Math.sin(angle) * dist;
      const bz = sz + Math.cos(angle) * dist;
      if (!isBuildableSite(bx, bz)) continue;
      const type = rng() < 0.15 ? "windmill" : rng() < 0.5 ? "home_A" : "home_B";
      buildings.push({ type, x: bx, y: terrainHeight(bx, bz), z: bz, yaw: Math.atan2(sx - bx, sz - bz), scale: 1 });
    }

    villages.push({ id: `v_${i}`, name, x: sx, z: sz, radius: 34, buildings });
  }
  villagesCache = villages;
  return villages;
}

// ============================ NPCs ============================

const NPC_NAMES = [
  "Elder Maren",
  "Quartermaster Bel",
  "Warden Fitch",
  "Old Rowan",
  "Sister Alda",
  "Forester Nym",
  "Captain Oswin",
  "Herbalist Ysolde",
];

let npcsCache: NpcSpec[] | null = null;

/** One quest-giver NPC per village, standing near the central well. */
export function generateNpcQuestGivers(): NpcSpec[] {
  if (npcsCache) return npcsCache;
  const villages = generateVillages();
  const npcs: NpcSpec[] = [];
  villages.forEach((v, i) => {
    const rng = mulberry32(hashString(v.id) ^ 0x51ed270b);
    const angle = rng() * Math.PI * 2;
    const dist = 4 + rng() * 2;
    const x = v.x + Math.sin(angle) * dist;
    const z = v.z + Math.cos(angle) * dist;
    const y = terrainHeight(x, z);
    npcs.push({
      id: `npc_v${i}`,
      villageIndex: i,
      name: NPC_NAMES[i % NPC_NAMES.length]!,
      x,
      y,
      z,
      yaw: Math.atan2(v.x - x, v.z - z),
    });
  });
  npcsCache = npcs;
  return npcs;
}

// ============================ paths ============================

let pathsCache: PathSegment[] | null = null;

/** Dirt paths: spawn -> each village, plus a ring connecting neighbours. */
export function generatePaths(): PathSegment[] {
  if (pathsCache) return pathsCache;
  const villages = generateVillages();
  const segments: PathSegment[] = [];

  const addLeg = (ax: number, az: number, bx: number, bz: number, seed: number) => {
    // Subdivide with jittered midpoints for an organic wiggle.
    const rng = mulberry32(seed);
    const points: [number, number][] = [[ax, az]];
    const steps = 3;
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const mx = ax + (bx - ax) * t;
      const mz = az + (bz - az) * t;
      // jitter perpendicular to the leg
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      const jitter = (rng() - 0.5) * Math.min(28, len * 0.25);
      points.push([mx + (-dz / len) * jitter, mz + (dx / len) * jitter]);
    }
    points.push([bx, bz]);
    for (let p = 0; p < points.length - 1; p++) {
      segments.push({ ax: points[p]![0], az: points[p]![1], bx: points[p + 1]![0], bz: points[p + 1]![1] });
    }
  };

  for (let i = 0; i < villages.length; i++) {
    const v = villages[i]!;
    addLeg(SPAWN_POINT.x, SPAWN_POINT.z, v.x, v.z, ZONE_SEED + 501 + i);
    const next = villages[(i + 1) % villages.length]!;
    if (villages.length > 1) addLeg(v.x, v.z, next.x, next.z, ZONE_SEED + 601 + i);
  }
  pathsCache = segments;
  return segments;
}

// ============================ points of interest ============================

/** Finds a flat, clear rectangle within `bounds` to reserve for a dungeon
 *  arena -- excluded from all normal node/mob/POI scatter (see
 *  inDungeonReserve) so every concurrent run of the portal leading here can
 *  safely reuse the identical geometry. Sampled directly within the given
 *  region's own bounds (not the angle/radius-from-origin sweep the other
 *  POI loops use), since a region can be a whole zone rather than a ring
 *  around the origin. */
function findDungeonArenaSite(
  villages: VillageSpec[],
  existingPois: PoiSpec[],
  seedOffset: number,
  bounds: ScatterBounds,
): { x: number; z: number; y: number } | null {
  const rng = mulberry32(ZONE_SEED * 13 + 6001 + seedOffset);
  const margin = DUNGEON_ARENA_RADIUS + 20;
  for (let attempt = 0; attempt < 300; attempt++) {
    const x = bounds.minX + margin + rng() * Math.max(1, bounds.maxX - bounds.minX - margin * 2);
    const z = bounds.minZ + margin + rng() * Math.max(1, bounds.maxZ - bounds.minZ - margin * 2);
    if (!isBuildableSite(x, z)) continue;
    if (terrainSlope(x, z) > 0.35) continue; // flat enough for a hand-placed arena
    if (distToRiver(x, z) < RIVER_HALF_WIDTH + 10) continue;
    if (dist2D(x, z, SPAWN_POINT.x, SPAWN_POINT.z) < SPAWN_CLEAR_RADIUS * 2) continue;
    if (villages.some((v) => dist2D(x, z, v.x, v.z) < v.radius + DUNGEON_ARENA_RADIUS + 20)) continue;
    if (existingPois.some((p) => dist2D(x, z, p.x, p.z) < DUNGEON_ARENA_RADIUS + 20)) continue;
    // stay clear of the lazy-activation trigger point for region two itself
    if (dist2D(x, z, REGION_TWO_GATE_X, REGION_TWO_GATE_Z) < DUNGEON_ARENA_RADIUS + 30) continue;
    return { x, z, y: terrainHeight(x, z) };
  }
  return null;
}

let poisCache: PoiSpec[] | null = null;

export function generatePois(): PoiSpec[] {
  if (poisCache) return poisCache;
  const villages = generateVillages();
  const pois: PoiSpec[] = [];
  const wanted: PoiType[] = ["ruins", "ruins", "shrine", "shrine", "camp"];

  for (let i = 0; i < wanted.length; i++) {
    const type = wanted[i]!;
    const rng = mulberry32(ZONE_SEED * 13 + i * 977);
    for (let attempt = 0; attempt < 40; attempt++) {
      const angle = rng() * Math.PI * 2;
      const radius = 60 + rng() * 180;
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      if (!isBuildableSite(x, z)) continue;
      if (dist2D(x, z, SPAWN_POINT.x, SPAWN_POINT.z) < 40) continue;
      if (villages.some((v) => dist2D(x, z, v.x, v.z) < 45)) continue;
      if (pois.some((p) => dist2D(x, z, p.x, p.z) < 50)) continue;

      const y = terrainHeight(x, z);
      const yaw = rng() * Math.PI * 2;
      const buildings: BuildingSpec[] = [];
      if (type === "ruins") {
        buildings.push({ type: "destroyed", x, y, z, yaw, scale: 1.1 });
      } else if (type === "camp") {
        buildings.push({ type: "grain", x, y, z, yaw, scale: 1 });
      }
      pois.push({ id: `poi_${type}_${i}`, type, x, y, z, yaw, buildings });
      break;
    }
  }

  // A watchtower crowns the tallest reachable mountain peak — a dramatic
  // silhouette that rewards players who climb the new terraced cliffs.
  {
    const rng = mulberry32(ZONE_SEED * 13 + 5001);
    let best: { x: number; z: number; y: number } | null = null;
    for (let attempt = 0; attempt < 300; attempt++) {
      const angle = rng() * Math.PI * 2;
      const radius = 80 + rng() * 200;
      const x = Math.sin(angle) * radius;
      const z = Math.cos(angle) * radius;
      const y = terrainHeight(x, z);
      if (y < 8) continue; // must sit on genuinely elevated ground
      if (terrainSlope(x, z) > 0.5) continue;
      if (distToRiver(x, z) < RIVER_HALF_WIDTH + 6) continue;
      if (dist2D(x, z, SPAWN_POINT.x, SPAWN_POINT.z) < 60) continue;
      if (villages.some((v) => dist2D(x, z, v.x, v.z) < 60)) continue;
      if (pois.some((p) => dist2D(x, z, p.x, p.z) < 50)) continue;
      if (!best || y > best.y) best = { x, z, y };
    }
    if (best) {
      const yaw = rng() * Math.PI * 2;
      pois.push({
        id: "poi_tower_0",
        type: "tower",
        x: best.x,
        y: best.y,
        z: best.z,
        yaw,
        buildings: [{ type: "tower_A", x: best.x, y: best.y, z: best.z, yaw, scale: 1 }],
      });
    }
  }

  // Dungeon portal(s) -- one low-tier portal in Greenlands (reachable from
  // spawn without a trek) and one high-tier portal deep in Ashenpeak,
  // reusing that region's own tier-3/4 mob roster. Each portal is a normal
  // walkable overworld waypoint; the arena it leads into is a separate
  // reserved rectangle nearby (arenaX/arenaZ), excluded from all normal
  // scatter (see inDungeonReserve below) so every concurrent run of a given
  // portal can safely reuse the identical geometry.
  {
    const dungeonSpecs: { tier: number; bounds: ScatterBounds }[] = [
      { tier: 0, bounds: REGION_ONE_BOUNDS },
      { tier: 3, bounds: REGION_TWO_BOUNDS },
    ];
    for (let i = 0; i < dungeonSpecs.length; i++) {
      const { tier, bounds } = dungeonSpecs[i]!;
      const arena = findDungeonArenaSite(villages, pois, i, bounds);
      if (!arena) continue;
      const rng = mulberry32(ZONE_SEED * 13 + 7001 + i);
      for (let attempt = 0; attempt < 60; attempt++) {
        const angle = rng() * Math.PI * 2;
        const dist = 145 + rng() * 40;
        const x = arena.x + Math.sin(angle) * dist;
        const z = arena.z + Math.cos(angle) * dist;
        if (!isBuildableSite(x, z)) continue;
        if (villages.some((v) => dist2D(x, z, v.x, v.z) < v.radius + 20)) continue;
        if (pois.some((p) => dist2D(x, z, p.x, p.z) < 40)) continue;
        const y = terrainHeight(x, z);
        const yaw = Math.atan2(arena.x - x, arena.z - z); // face the arena
        pois.push({
          id: `poi_dungeon_${i}`,
          type: "dungeon_portal",
          x,
          y,
          z,
          yaw,
          buildings: [],
          dungeonTier: tier,
          arenaX: arena.x,
          arenaZ: arena.z,
        });
        break;
      }
    }
  }

  poisCache = pois;
  return pois;
}

/** True within a dungeon's reserved arena rectangle -- normal node/mob/POI
 *  scatter must exclude this so the hand-placed dungeon encounter is the
 *  only thing there, for every concurrent run alike. */
export function inDungeonReserve(x: number, z: number): boolean {
  return generatePois().some(
    (p) => p.type === "dungeon_portal" && p.arenaX !== undefined && dist2D(x, z, p.arenaX, p.arenaZ!) < DUNGEON_WALL_RADIUS,
  );
}

// ============================ resource nodes ============================

// meadow/mountain/hills were the sparsest for trees; boosted `presence`
// where the whole biome felt empty so those stretches read as denser
// forest instead of bare filler terrain.
const BIOME_PRESENCE: Record<Biome, number> = {
  forest: 0.62,
  meadow: 0.48,
  mountain: 0.58,
  hills: 0.52,
  swamp: 0.55,
  dunes: 0.16,
};

// Weighted node-type tables per biome, [type, cumulative weight] -- same
// pattern as BIOME_MOB_TABLE/pickFromWeights below. forest/meadow/swamp keep
// the original tree/rock/berry_bush-only split unchanged; mountain/hills/
// dunes additionally carve out ore bands (mountain gets the deepest
// progression up through Mithril -- Thorium is Ashenpeak-exclusive, see
// REGION_TWO_NODE_TABLE).
const BIOME_NODE_TABLE: Record<Biome, [string, number][]> = {
  forest: [
    ["tree", 0.6],
    ["rock", 0.85],
    ["berry_bush", 1.0],
  ],
  meadow: [
    ["tree", 0.45],
    ["rock", 0.6],
    ["berry_bush", 1.0],
  ],
  mountain: [
    ["tree", 0.35],
    ["rock", 0.65],
    ["copper_vein", 0.72],
    ["tin_vein", 0.78],
    ["iron_deposit", 0.84],
    ["mithril_deposit", 0.9],
    ["berry_bush", 1.0],
  ],
  hills: [
    ["tree", 0.48],
    ["rock", 0.63],
    ["copper_vein", 0.69],
    ["tin_vein", 0.74],
    ["iron_deposit", 0.78],
    ["berry_bush", 1.0],
  ],
  swamp: [
    ["tree", 0.5],
    ["rock", 0.55],
    ["berry_bush", 1.0],
  ],
  dunes: [
    ["tree", 0.7],
    ["rock", 0.87],
    ["copper_vein", 0.9],
    ["berry_bush", 1.0],
  ],
};

function pickBiomeNode(biome: Biome, roll: number): string {
  return pickFromWeights(BIOME_NODE_TABLE[biome], roll);
}

export interface ScatterBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const REGION_ONE_BOUNDS: ScatterBounds = {
  minX: -ZONE_SIZE / 2,
  maxX: ZONE_SIZE / 2,
  minZ: -ZONE_SIZE / 2,
  maxZ: ZONE_SIZE / 2,
};

/**
 * Deterministic resource node scatter. Client and server both call this and
 * get the identical node list; only depletion state is dynamic. Defaults
 * reproduce the original Greenlands-only behavior exactly; `bounds`/
 * `idPrefix`/`seedSalt` let a second region reuse this same scatter logic
 * over its own coordinate window without colliding ids or cloning the noise;
 * `pickNode` lets it swap in a different node-type table entirely (see
 * REGION_TWO_NODE_TABLE), mirroring generateMobSpawns's `pickMob` param.
 */
export function generateNodes(
  bounds: ScatterBounds = REGION_ONE_BOUNDS,
  idPrefix = "n_",
  seedSalt = 0,
  pickNode: (biome: Biome, roll: number) => string = pickBiomeNode,
): WorldNode[] {
  const villages = generateVillages();
  const paths = generatePaths();
  const pois = generatePois();

  const nodes: WorldNode[] = [];
  const cellsX = Math.floor((bounds.maxX - bounds.minX) / NODE_CELL);
  const cellsZ = Math.floor((bounds.maxZ - bounds.minZ) / NODE_CELL);
  for (let cx = 0; cx < cellsX; cx++) {
    for (let cz = 0; cz < cellsZ; cz++) {
      const jx = hash2(ZONE_SEED + 31 + seedSalt, cx, cz);
      const jz = hash2(ZONE_SEED + 37 + seedSalt, cx, cz);
      const x = bounds.minX + (cx + 0.15 + jx * 0.7) * NODE_CELL;
      const z = bounds.minZ + (cz + 0.15 + jz * 0.7) * NODE_CELL;

      const biome = biomeAt(x, z);
      const presenceThreshold = BIOME_PRESENCE[biome];
      const presence = hash2(ZONE_SEED + 11 + seedSalt, cx, cz);
      const density = fbm(ZONE_SEED + 23 + seedSalt, x, z, 160, 2);
      if (presence > presenceThreshold * (0.45 + density * 0.9)) continue;

      const y = terrainHeight(x, z);
      if (y < WATER_LEVEL + 0.4) continue;
      if (terrainSlope(x, z) > 0.85) continue;
      if (dist2D(x, z, SPAWN_POINT.x, SPAWN_POINT.z) < SPAWN_CLEAR_RADIUS) continue;
      if (villages.some((v) => dist2D(x, z, v.x, v.z) < v.radius + 4)) continue;
      if (pois.some((p) => dist2D(x, z, p.x, p.z) < POI_CLEAR)) continue;
      if (paths.some((s) => distPointToSegment(x, z, s.ax, s.az, s.bx, s.bz) < PATH_CLEAR)) continue;
      if (distToRiver(x, z) < RIVER_HALF_WIDTH + 2) continue;
      if (inDungeonReserve(x, z)) continue;

      const roll = hash2(ZONE_SEED + 41 + seedSalt, cx, cz);
      const type = pickNode(biome, roll);
      nodes.push({
        id: `${idPrefix}${cx}_${cz}`,
        type,
        x,
        y,
        z,
        variant: hash2(ZONE_SEED + 43 + seedSalt, cx, cz),
        biome,
      });
    }
  }
  return nodes;
}

const UNDEAD_RADIUS = 60; // skeletons haunt the land right around ruins

// Weighted creature tables per biome so players meet real variety anywhere,
// not just wolves near spawn. [type, cumulative weight].
const BIOME_MOB_TABLE: Record<Biome, [string, number][]> = {
  meadow: [
    ["fox", 0.22],
    ["stag", 0.4],
    ["alpaca", 0.55],
    ["wolf", 0.72],
    ["goblin", 0.86],
    ["skeleton_minion", 1.0],
  ],
  forest: [
    ["fox", 0.15],
    ["wolf", 0.35],
    ["stag", 0.5],
    ["goblin", 0.62],
    ["spider", 0.75],
    ["skeleton_minion", 0.88],
    ["skeleton_warrior", 1.0],
  ],
  hills: [
    ["alpaca", 0.15],
    ["bull", 0.32],
    ["wolf", 0.45],
    ["goblin", 0.6],
    ["orc", 0.75],
    ["dire_wolf", 0.88],
    ["skeleton_warrior", 1.0],
  ],
  mountain: [
    ["dire_wolf", 0.18],
    ["yeti", 0.36],
    ["yetialt", 0.52],
    ["golem", 0.66],
    ["giant", 0.78],
    ["skeleton_warrior", 0.88],
    ["skeleton_rogue", 0.97],
    ["dragon", 1.0],
  ],
  swamp: [
    ["frog", 0.18],
    ["ooze", 0.36],
    ["skeleton_minion", 0.5],
    ["ghost", 0.65],
    ["tribal", 0.78],
    ["skeleton_rogue", 0.88],
    ["skeleton_warrior", 1.0],
  ],
  dunes: [
    ["velociraptor", 0.2],
    ["orc", 0.38],
    ["orcenemy", 0.55],
    ["skeleton_warrior", 0.68],
    ["dire_wolf", 0.8],
    ["skeleton_rogue", 0.95],
    ["demon", 1.0],
  ],
};

function pickFromWeights(table: [string, number][], roll: number): string {
  for (const [type, w] of table) if (roll < w) return type;
  return "wolf";
}

function pickBiomeMob(biome: Biome, roll: number): string {
  return pickFromWeights(BIOME_MOB_TABLE[biome], roll);
}

// Ashenpeak (region 2): all existing tier-3/4 mobs, much denser than any
// region-1 biome — no new creature types, just pushed to be the baseline.
const REGION_TWO_MOB_TABLE: [string, number][] = [
  ["yeti", 0.22],
  ["yetialt", 0.4],
  ["golem", 0.58],
  ["giant", 0.74],
  ["demon", 0.86],
  ["demonalt", 0.94],
  ["dragon", 1.0],
];

// Ashenpeak's node table (region 2, always mountain/hills biome per
// northBiomeAt) -- reuses the same tree/rock/berry/ore mix as region 1's
// mountain, but Thorium Veins are exclusive to this table so the elite ore
// tier lives only in the harder region, same theme as the tier-3 dungeon.
const REGION_TWO_NODE_TABLE: [string, number][] = [
  ["tree", 0.3],
  ["rock", 0.5],
  ["copper_vein", 0.56],
  ["tin_vein", 0.61],
  ["iron_deposit", 0.66],
  ["mithril_deposit", 0.74],
  ["thorium_vein", 0.82],
  ["berry_bush", 1.0],
];

/**
 * Deterministic mob spawn points. Every biome has a mix of beasts and stray
 * undead; ruins add dense skeleton clusters on top. Defaults reproduce the
 * original Greenlands-only behavior exactly; the extra parameters let a
 * second region reuse this same scatter logic with its own bounds, id
 * namespace, cell density, fill rate, and mob-picking rule.
 */
export function generateMobSpawns(
  bounds: ScatterBounds = REGION_ONE_BOUNDS,
  idPrefix = "m_",
  seedSalt = 0,
  mobCell = MOB_CELL,
  fillThreshold = 0.72,
  pickMob: (biome: Biome, roll: number) => string = pickBiomeMob,
): MobSpawn[] {
  const villages = generateVillages();
  // Only ruins actually inside these bounds get skeleton clusters below —
  // without this filter, calling this for a second region (which has no
  // ruins of its own) would otherwise re-place region-1's exact clusters.
  const ruins = generatePois().filter(
    (p) => p.type === "ruins" && p.x >= bounds.minX && p.x <= bounds.maxX && p.z >= bounds.minZ && p.z <= bounds.maxZ,
  );
  const spawns: MobSpawn[] = [];
  const cellsX = Math.floor((bounds.maxX - bounds.minX) / mobCell);
  const cellsZ = Math.floor((bounds.maxZ - bounds.minZ) / mobCell);
  for (let cx = 0; cx < cellsX; cx++) {
    for (let cz = 0; cz < cellsZ; cz++) {
      if (hash2(ZONE_SEED + 51 + seedSalt, cx, cz) > fillThreshold) continue; // denser world
      const x = bounds.minX + (cx + 0.2 + hash2(ZONE_SEED + 53 + seedSalt, cx, cz) * 0.6) * mobCell;
      const z = bounds.minZ + (cz + 0.2 + hash2(ZONE_SEED + 57 + seedSalt, cx, cz) * 0.6) * mobCell;
      const y = terrainHeight(x, z);
      if (y < WATER_LEVEL + 0.5) continue;
      if (dist2D(x, z, SPAWN_POINT.x, SPAWN_POINT.z) < SPAWN_CLEAR_RADIUS * 1.6) continue;
      if (villages.some((v) => dist2D(x, z, v.x, v.z) < v.radius + 20)) continue;
      if (ruins.some((r) => dist2D(x, z, r.x, r.z) < UNDEAD_RADIUS)) continue; // undead handled below
      if (distToRiver(x, z) < RIVER_HALF_WIDTH + 2) continue;
      if (inDungeonReserve(x, z)) continue;

      const type = pickMob(biomeAt(x, z), hash2(ZONE_SEED + 61 + seedSalt, cx, cz));
      spawns.push({ id: `${idPrefix}${cx}_${cz}`, type, x, y, z });
    }
  }

  // Guaranteed undead clusters ringing each ruins so they feel truly haunted.
  // (`ruins` is already filtered to `bounds` above, so this is naturally a
  // no-op for any region with none — e.g. region 2.)
  for (let ri = 0; ri < ruins.length; ri++) {
    const r = ruins[ri]!;
    const count = 5 + Math.floor(hash2(ZONE_SEED + 71, ri, 0) * 3); // 5-7
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + hash2(ZONE_SEED + 73, ri, i) * 0.6;
      const dist = 12 + hash2(ZONE_SEED + 77, ri, i) * 30;
      const x = r.x + Math.sin(a) * dist;
      const z = r.z + Math.cos(a) * dist;
      const y = terrainHeight(x, z);
      if (y < WATER_LEVEL + 0.5) continue;
      if (villages.some((v) => dist2D(x, z, v.x, v.z) < v.radius + 25)) continue;
      if (dist2D(x, z, SPAWN_POINT.x, SPAWN_POINT.z) < SPAWN_CLEAR_RADIUS * 2.2) continue;
      if (distToRiver(x, z) < RIVER_HALF_WIDTH + 2) continue;
      if (inDungeonReserve(x, z)) continue;
      const roll = hash2(ZONE_SEED + 79, ri, i);
      const type = roll < 0.5 ? "skeleton_minion" : roll < 0.8 ? "skeleton_warrior" : "skeleton_rogue";
      spawns.push({ id: `u_${ri}_${i}`, type, x, y, z });
    }
  }

  return spawns;
}

// ============================ Ashenpeak (region 2) ============================

const REGION_TWO_BOUNDS: ScatterBounds = {
  minX: WORLD_MIN_X,
  maxX: WORLD_MAX_X,
  minZ: VALLEY_START_Z,
  maxZ: REGION_TWO_MAX_Z,
};

let regionTwoNodesCache: WorldNode[] | null = null;
let regionTwoMobSpawnsCache: MobSpawn[] | null = null;

/** Same deterministic scatter as `generateNodes()`, over Ashenpeak's own
 *  coordinate window (never sampled by region 1). */
export function generateRegionTwoNodes(): WorldNode[] {
  if (regionTwoNodesCache) return regionTwoNodesCache;
  regionTwoNodesCache = generateNodes(REGION_TWO_BOUNDS, "n2_", 9001, (_biome, roll) =>
    pickFromWeights(REGION_TWO_NODE_TABLE, roll),
  );
  return regionTwoNodesCache;
}

/** Denser, all-tier-3/4 mob spawns for Ashenpeak — smaller cells and a much
 *  higher fill rate than region 1, reusing the existing high-tier roster. */
export function generateRegionTwoMobSpawns(): MobSpawn[] {
  if (regionTwoMobSpawnsCache) return regionTwoMobSpawnsCache;
  regionTwoMobSpawnsCache = generateMobSpawns(
    REGION_TWO_BOUNDS,
    "m2_",
    9101,
    32,
    0.4,
    (_biome, roll) => pickFromWeights(REGION_TWO_MOB_TABLE, roll),
  );
  return regionTwoMobSpawnsCache;
}

// ============================ dungeons ============================

// Tile pitch matches the KayKit Dungeon Pack's modular wall/floor pieces
// (wall.gltf/wall_doorway.gltf/floor_tile_large.gltf are all 4x4 world
// units) -- shared between generateDungeonLayout and dungeonFloorHeightAt
// so the two stay in lockstep. DUNGEON_GRID_SIZE tiles at DUNGEON_PITCH each
// still spans -60..+60 (120 units) local to a portal's center.
export const DUNGEON_PITCH = 4;
export const DUNGEON_HALF = DUNGEON_PITCH / 2;
export const DUNGEON_GRID_SIZE = 30;
export const dungeonCellCenter = (t: number) => -60 + t * DUNGEON_PITCH + DUNGEON_HALF;
/** Inverse of dungeonCellCenter -- snaps a local world coordinate to its
 *  nearest tile index. Shared by deriveDungeonGridFromAssets, the
 *  blueprint-driven branch of generateDungeonLayout, and the client dungeon
 *  editor's snap-to-grid placement. */
export const dungeonSnapToTile = (v: number) => Math.round((v + 60 - DUNGEON_HALF) / DUNGEON_PITCH);

export interface DungeonTile {
  tx: number;
  tz: number;
  type: "floor" | "stairs" | "wall" | "empty";
  height: number;
  /** rise: vertical gain across this tile for stairs interpolation in
   *  dungeonFloorHeightAt -- defaults to 1.0 when absent (matches the
   *  procedural generator's historical assumption). Blueprint-driven tiles
   *  copy this from the placing DungeonAsset's own `rise` field, since it
   *  can't be inferred from the tile alone (different stair models have
   *  different real vertical spans). */
  stairsDir?: { x: number; z: number; rise?: number };
  isRoom?: boolean;
}

export interface DungeonAsset {
  /** Stable per-instance key for editor selection/undo bookkeeping.
   *  Ignored by every runtime consumer (client renderer, server). */
  id?: string;
  model: string;
  localX: number;
  localY: number;
  localZ: number;
  yaw: number;
  scale?: number;
  /** Vertical rise this asset represents, in world units -- only
   *  meaningful when `model` starts with "stairs_". Used by
   *  deriveDungeonGridFromAssets to populate DungeonTile.stairsDir.rise.
   *  Ignored by the client renderer. */
  rise?: number;
}

/** Hand-authored dungeon interior, produced by the in-browser dungeon
 *  editor (see packages/client/src/render/DungeonEditorScene.ts) and saved
 *  to packages/shared/src/content/dungeonBlueprints/<tier>.json. The author
 *  only places visual assets -- the walkable DungeonTile grid is derived
 *  automatically from them (see deriveDungeonGridFromAssets) so mesh
 *  position and collision height can never drift apart, which is what
 *  procedural generation kept getting wrong. */
export interface DungeonBlueprint {
  assets: DungeonAsset[];
  mobSpawns: { localX: number; localZ: number }[];
  chests: { localX: number; localY: number; localZ: number; rarity: "common" | "rare" }[];
  entryLocal: { x: number; z: number };
}

/** Derives the walkable DungeonTile grid from whichever placed assets have
 *  a "floor_" or "stairs_" model prefix -- tx/tz from the asset's snapped
 *  localX/localZ, height copied directly from the asset's own localY (i.e.
 *  wherever the author visually placed it), and stairsDir from the asset's
 *  yaw rounded to the nearest cardinal direction (mirrors the yaw<->dir
 *  mapping the procedural generator's asset-emission pass already uses,
 *  just inverted). Tiles not covered by such an asset are simply absent --
 *  dungeonFloorHeightAt already treats a missing tile as empty. */
export function deriveDungeonGridFromAssets(assets: DungeonAsset[]): DungeonTile[] {
  const grid: DungeonTile[] = [];
  for (const asset of assets) {
    const isFloor = asset.model.startsWith("floor_");
    const isStairs = asset.model.startsWith("stairs_");
    if (!isFloor && !isStairs) continue;
    const tx = dungeonSnapToTile(asset.localX);
    const tz = dungeonSnapToTile(asset.localZ);
    let stairsDir: { x: number; z: number; rise?: number } | undefined;
    if (isStairs) {
      // Inverse of the yaw<->stairsDir mapping used when emitting stairs
      // assets: yaw 0 -> {z:-1}, PI/2 -> {x:-1}, PI/-PI -> {z:1}, -PI/2 -> {x:1}.
      const twoPi = Math.PI * 2;
      const norm = ((asset.yaw % twoPi) + twoPi) % twoPi;
      const quarter = Math.round(norm / (Math.PI / 2)) % 4;
      const dir =
        quarter === 0 ? { x: 0, z: -1 } :
        quarter === 1 ? { x: -1, z: 0 } :
        quarter === 2 ? { x: 0, z: 1 } :
        { x: 1, z: 0 };
      stairsDir = { ...dir, rise: asset.rise ?? 1.0 };
    }
    grid.push({
      tx,
      tz,
      type: isStairs ? "stairs" : "floor",
      height: asset.localY,
      stairsDir,
    });
  }
  return grid;
}

export interface DungeonLayoutSpec {
  id: string;
  center: { x: number; y: number; z: number };
  entryPoint: { x: number; z: number };
  spawnTx: number;
  spawnTz: number;
  spawnHeight: number;
  /** Offsets from `center` -- tier-agnostic; which mob type actually
   *  populates each point is decided at instance-creation time from the
   *  chosen DungeonTierDef's mobTable (see packages/shared/src/content/
   *  dungeons.ts), not baked into the layout itself. */
  mobSpawns: { localX: number; localZ: number }[];
  /** Flat interior floor height -- the enclosed room ignores the outdoor
   *  noise-based terrain entirely once built (see dungeonFloorHeightAt). */
  floorY: number;
  /** Direction from center toward the portal/entry -- where the wall ring's
   *  doorway gap faces. */
  doorwayAngle: number;
  /** Seeded per-portal interior columns and rubble/decoration -- unique per
   *  portal (not just per tier) so future same-tier portals won't look like
   *  carbon copies of each other. */
  pillars: { localX: number; localZ: number }[];
  rubble: { localX: number; localZ: number; rot: number }[];
  grid: DungeonTile[];
  assets: DungeonAsset[];
  chests: { localX: number; localY: number; localZ: number; rarity: "common" | "rare" }[];
  torches: { localX: number; localY: number; localZ: number; yaw: number }[];
}

const dungeonLayoutCache = new Map<string, DungeonLayoutSpec>();

interface ProceduralDungeonDraft {
  assets: DungeonAsset[];
  grid: DungeonTile[];
  mobSpawns: { localX: number; localZ: number }[];
  chests: { localX: number; localY: number; localZ: number; rarity: "common" | "rare" }[];
  pillars: { localX: number; localZ: number }[];
  rubble: { localX: number; localZ: number; rot: number }[];
  torches: { localX: number; localY: number; localZ: number; yaw: number }[];
  spawnTx: number;
  spawnTz: number;
  spawnHeight: number;
  entryLocal: { x: number; z: number };
}

/** Seeded procedural room/corridor/wall/stairs generator -- entirely in
 *  local (portal-independent) coordinates, so it doubles as both (a) the
 *  fallback layout source for any dungeon tier without an authored
 *  blueprint (see generateDungeonLayout below) and (b) the dungeon editor's
 *  "Generate" button (see generateProceduralDungeonBlueprint), which uses
 *  it to scaffold a rough starting layout for the author to then fix up by
 *  hand -- the same asset-placement logic either way, just consumed
 *  differently. Extracted from generateDungeonLayout as a pure function;
 *  no behavior change for existing (portalId-seeded) callers. */
function generateProceduralDungeonDraft(seed: string): ProceduralDungeonDraft {
  let rng = mulberry32(hashString(seed) ^ 0x2f6e2b1);

  const pillars: { localX: number; localZ: number }[] = [];
  const rubble: { localX: number; localZ: number; rot: number }[] = [];
  const grid: DungeonTile[] = [];
  const assets: DungeonAsset[] = [];
  const chests: { localX: number; localY: number; localZ: number; rarity: "common" | "rare" }[] = [];
  const torches: { localX: number; localY: number; localZ: number; yaw: number }[] = [];
  const mobSpawns: { localX: number; localZ: number }[] = [];

  const setCell = (tx: number, tz: number, type: "floor" | "stairs" | "wall" | "empty", height: number, stairsDir?: { x: number; z: number }, isRoom?: boolean) => {
    const idx = grid.findIndex(t => t.tx === tx && t.tz === tz);
    if (idx !== -1) {
      grid[idx] = { tx, tz, type, height, stairsDir, isRoom: isRoom ?? grid[idx]!.isRoom };
    } else {
      grid.push({ tx, tz, type, height, stairsDir, isRoom });
    }
  };

  const getTile = (tx: number, tz: number) => {
    return grid.find(t => t.tx === tx && t.tz === tz);
  };

  let layoutRng = mulberry32(hashString(seed) ^ 0xabcdef);

  const PITCH = DUNGEON_PITCH;
  const HALF = DUNGEON_HALF;
  const GRID_SIZE = DUNGEON_GRID_SIZE;
  const cellCenter = dungeonCellCenter;

  // stairs_narrow.gltf measures exactly 4x5.1x4 (width x height x depth) --
  // the only stairs piece in the KayKit set whose footprint matches a
  // single DUNGEON_PITCH tile with no overhang (stairs_wide.gltf, used
  // here previously, is 7 units wide and spills into neighboring tiles).
  // Room height tiers step by exactly this rise so every transition is a
  // whole number of stair tiles with no leftover gap at the top -- the
  // same class of bug the hand-authored editor exists to let a human catch
  // and fix, but the auto-generated *draft* should still get this right by
  // construction rather than resurrecting the old mismatch.
  const STAIR_RISE = 5.1;

  const rooms: { cx: number; cz: number; w: number; h: number; height: number }[] = [];
  const sectors = [
    { xMin: 2, xMax: 8, zMin: 2, zMax: 8 },
    { xMin: 12, xMax: 18, zMin: 2, zMax: 8 },
    { xMin: 22, xMax: 28, zMin: 2, zMax: 8 },
    { xMin: 22, xMax: 28, zMin: 12, zMax: 18 },
    { xMin: 12, xMax: 18, zMin: 12, zMax: 18 },
    { xMin: 2, xMax: 8, zMin: 12, zMax: 18 },
    { xMin: 2, xMax: 8, zMin: 22, zMax: 28 },
    { xMin: 12, xMax: 18, zMin: 22, zMax: 28 },
    { xMin: 22, xMax: 28, zMin: 22, zMax: 28 },
  ];

  for (let i = 0; i < sectors.length; i++) {
    const s = sectors[i]!;
    const w = 3 + Math.floor(layoutRng() * 3);
    const h = 3 + Math.floor(layoutRng() * 3);
    const cx = s.xMin + Math.floor(layoutRng() * (s.xMax - s.xMin));
    const cz = s.zMin + Math.floor(layoutRng() * (s.zMax - s.zMin));
    const height = (i % 3) * STAIR_RISE;
    rooms.push({ cx, cz, w, h, height });
  }

  for (const r of rooms) {
    const xStart = r.cx - Math.floor(r.w / 2);
    const xEnd = r.cx + Math.floor(r.w / 2);
    const zStart = r.cz - Math.floor(r.h / 2);
    const zEnd = r.cz + Math.floor(r.h / 2);
    for (let x = xStart; x <= xEnd; x++) {
      for (let z = zStart; z <= zEnd; z++) {
        if (x >= 1 && x <= GRID_SIZE - 2 && z >= 1 && z <= GRID_SIZE - 2) {
          setCell(x, z, "floor", r.height, undefined, true);
        }
      }
    }
  }

  for (let i = 0; i < rooms.length - 1; i++) {
    const r1 = rooms[i]!;
    const r2 = rooms[i+1]!;

    const startX = Math.min(r1.cx, r2.cx);
    const endX = Math.max(r1.cx, r2.cx);
    const diffY = r2.height - r1.height;
    const stepsNeeded = Math.round(Math.abs(diffY) / STAIR_RISE);
    const hasStairs = stepsNeeded > 0;

    const stairStartX = Math.floor((startX + endX) / 2) - Math.floor(stepsNeeded / 2);

    // Single-tile-wide corridor -- each tile is a full PITCH-wide/deep
    // KayKit module now, so a 1-tile corridor is already a proper 4-unit
    // passage; the old code doubled every row/column to get a 4-unit-wide
    // corridor out of 2-unit tiles, which is no longer needed.
    for (let x = startX; x <= endX; x++) {
      if (hasStairs && x >= stairStartX && x < stairStartX + stepsNeeded) {
        const dirX = r2.height > r1.height ? (r2.cx > r1.cx ? 1 : -1) : (r1.cx > r2.cx ? 1 : -1);
        const lowHeight = Math.min(r1.height, r2.height);
        const baseHeight = dirX === 1 ?
          lowHeight + (x - stairStartX) * STAIR_RISE :
          lowHeight + (stairStartX + stepsNeeded - 1 - x) * STAIR_RISE;
        setCell(x, r1.cz, "stairs", baseHeight, { x: dirX, z: 0 }, false);
      } else {
        const h = (hasStairs && ((r2.cx > r1.cx && x >= stairStartX + stepsNeeded) || (r2.cx < r1.cx && x < stairStartX))) ? r2.height : r1.height;
        setCell(x, r1.cz, "floor", h, undefined, false);
      }
    }

    const startZ = Math.min(r1.cz, r2.cz);
    const endZ = Math.max(r1.cz, r2.cz);
    for (let z = startZ; z <= endZ; z++) {
      setCell(r2.cx, z, "floor", r2.height, undefined, false);
    }
  }

  const spawnTx = rooms[0]!.cx;
  const spawnTz = rooms[0]!.cz;
  const spawnHeight = rooms[0]!.height;
  const entryLocal = { x: cellCenter(spawnTx), z: cellCenter(spawnTz) };

  for (let tx = 0; tx < GRID_SIZE; tx++) {
    for (let tz = 0; tz < GRID_SIZE; tz++) {
      if (!grid.some(t => t.tx === tx && t.tz === tz)) {
        grid.push({ tx, tz, type: "empty", height: 0 });
      }
    }
  }

  for (const tile of grid) {
    if (tile.type === "empty") continue;

    const cellCenterX = cellCenter(tile.tx);
    const cellCenterZ = cellCenter(tile.tz);

    if (tile.type === "floor") {
      assets.push({
        model: "floor_tile_large.gltf",
        localX: cellCenterX,
        localY: tile.height,
        localZ: cellCenterZ,
        yaw: 0,
        scale: 1.0
      });
    } else if (tile.type === "stairs") {
      let yaw = 0;
      if (tile.stairsDir) {
        if (tile.stairsDir.x === 1) yaw = -Math.PI / 2;
        else if (tile.stairsDir.x === -1) yaw = Math.PI / 2;
        else if (tile.stairsDir.z === 1) yaw = Math.PI;
        else if (tile.stairsDir.z === -1) yaw = 0;
      }
      assets.push({
        model: "stairs_narrow.gltf",
        localX: cellCenterX,
        localY: tile.height,
        localZ: cellCenterZ,
        yaw: yaw,
        scale: 1.0,
        rise: STAIR_RISE
      });
    }

    const neighbors = [
      { dir: { x: 0, y: -1 }, yaw: 0, localX: cellCenterX, localZ: cellCenterZ - HALF, tag: "North" },
      { dir: { x: 0, y: 1 }, yaw: Math.PI, localX: cellCenterX, localZ: cellCenterZ + HALF, tag: "South" },
      { dir: { x: 1, y: 0 }, yaw: -Math.PI / 2, localX: cellCenterX + HALF, localZ: cellCenterZ, tag: "East" },
      { dir: { x: -1, y: 0 }, yaw: Math.PI / 2, localX: cellCenterX - HALF, localZ: cellCenterZ, tag: "West" },
    ];

    // Which of this tile's 4 cardinal directions actually got a wall/doorway
    // plane -- feeds the corner pass below, which caps the vertex between
    // any two ADJACENT (perpendicular) wall directions with wall_corner.gltf
    // so straight wall segments don't just butt into each other with a bare
    // seam (KayKit's straight wall pieces aren't mitred).
    const wallDirs = new Set<string>();

    for (const n of neighbors) {
      const neighborTile = getTile(tile.tx + n.dir.x, tile.tz + n.dir.y);
      if (!neighborTile || neighborTile.type === "empty") {
        if (tile.tx === spawnTx && tile.tz === spawnTz && n.tag === "West") {
          assets.push({
            model: "wall_doorway.gltf",
            localX: n.localX,
            localY: tile.height,
            localZ: n.localZ,
            yaw: n.yaw,
            scale: 1.0
          });
          wallDirs.add(n.tag);
        } else {
          assets.push({
            model: "wall.gltf",
            localX: n.localX,
            localY: tile.height,
            localZ: n.localZ,
            yaw: n.yaw,
            scale: 1.0
          });
          wallDirs.add(n.tag);

          const shouldTorch =
            (tile.tx === spawnTx && tile.tz === spawnTz && n.tag === "North") ||
            (tile.tx === rooms[8]!.cx && tile.tz === rooms[8]!.cz && n.tag === "North") ||
            (tile.tx === rooms[4]!.cx && tile.tz === rooms[4]!.cz && n.tag === "South") ||
            (tile.tx === rooms[2]!.cx && tile.tz === rooms[2]!.cz && n.tag === "East") ||
            (tile.tx === rooms[6]!.cx && tile.tz === rooms[6]!.cz && n.tag === "West") ||
            (tile.tx === rooms[1]!.cx && tile.tz === rooms[1]!.cz && n.tag === "North");

          if (shouldTorch) {
            const torchX = n.localX - n.dir.x * 0.15;
            const torchZ = n.localZ - n.dir.y * 0.15;
            assets.push({
              model: "torch_mounted.gltf",
              localX: torchX,
              localY: tile.height + 1.8,
              localZ: torchZ,
              yaw: n.yaw
            });
            torches.push({
              localX: torchX,
              localY: tile.height + 1.8,
              localZ: torchZ,
              yaw: n.yaw
            });
          }
        }
      } else if (tile.isRoom && !neighborTile.isRoom && (neighborTile.type === "floor" || neighborTile.type === "stairs")) {
        assets.push({
          model: "wall_doorway.gltf",
          localX: n.localX,
          localY: tile.height,
          localZ: n.localZ,
          yaw: n.yaw,
          scale: 1.0
        });
        wallDirs.add(n.tag);
      }
    }

    const corners: { pair: [string, string]; vx: number; vz: number; yaw: number }[] = [
      { pair: ["North", "East"], vx: HALF, vz: -HALF, yaw: 0 },
      { pair: ["East", "South"], vx: HALF, vz: HALF, yaw: -Math.PI / 2 },
      { pair: ["South", "West"], vx: -HALF, vz: HALF, yaw: Math.PI },
      { pair: ["West", "North"], vx: -HALF, vz: -HALF, yaw: Math.PI / 2 },
    ];
    for (const c of corners) {
      if (wallDirs.has(c.pair[0]) && wallDirs.has(c.pair[1])) {
        assets.push({
          model: "wall_corner.gltf",
          localX: cellCenterX + c.vx,
          localY: tile.height,
          localZ: cellCenterZ + c.vz,
          yaw: c.yaw,
          scale: 1.0
        });
      }
    }
  }

  const chestRooms: { idx: number; model: string; rarity: "common" | "rare" }[] = [
    { idx: 2, model: "chest.gltf", rarity: "common" },
    { idx: 4, model: "chest_gold.gltf", rarity: "rare" },
    { idx: 6, model: "chest.gltf", rarity: "common" },
    { idx: 8, model: "chest_gold.gltf", rarity: "rare" },
  ];
  for (const c of chestRooms) {
    const r = rooms[c.idx]!;
    const x = cellCenter(r.cx);
    const z = cellCenter(r.cz);
    chests.push({ localX: x, localY: r.height, localZ: z, rarity: c.rarity });
    assets.push({ model: c.model, localX: x, localY: r.height, localZ: z, yaw: 0, scale: 1.0 });
  }

  for (let i = 1; i < rooms.length; i++) {
    const r = rooms[i]!;
    const mobCount = i === 8 ? 4 : 2;
    for (let m = 0; m < mobCount; m++) {
      const offsetX = (m % 2 === 0 ? 1 : -1) * 0.8;
      const offsetZ = (m >= 2 ? 1 : -1) * 0.8;
      mobSpawns.push({
        localX: cellCenter(r.cx) + offsetX,
        localZ: cellCenter(r.cz) + offsetZ
      });
    }
  }

  // Set-dressing: a pillar near one corner of a handful of rooms, and a
  // rubble pile in a couple of others -- scattered within the *actual* room
  // footprints (unlike the old radius-around-center placement, which used a
  // leftover DUNGEON_WALL_RADIUS-based polar formula from an abandoned
  // circular-wall design and landed these props far outside the real
  // 120x120 tile grid, in the void past the walls where nothing ever
  // rendered them).
  const pillarRoomIdxs = [1, 3, 5, 7];
  for (const idx of pillarRoomIdxs) {
    const r = rooms[idx]!;
    const cornerX = r.cx + Math.floor(r.w / 2) - 1;
    const cornerZ = r.cz + Math.floor(r.h / 2) - 1;
    const x = cellCenter(cornerX);
    const z = cellCenter(cornerZ);
    pillars.push({ localX: x, localZ: z });
    assets.push({ model: "pillar.gltf", localX: x, localY: r.height, localZ: z, yaw: 0, scale: 1.0 });
  }
  const rubbleRoomIdxs = [2, 5];
  for (const idx of rubbleRoomIdxs) {
    const r = rooms[idx]!;
    const rot = rng() * Math.PI * 2;
    const cornerX = r.cx - Math.floor(r.w / 2) + 1;
    const cornerZ = r.cz - Math.floor(r.h / 2) + 1;
    const x = cellCenter(cornerX);
    const z = cellCenter(cornerZ);
    rubble.push({ localX: x, localZ: z, rot });
    assets.push({ model: "rubble_half.gltf", localX: x, localY: r.height, localZ: z, yaw: rot, scale: 1.0 });
  }

  return { assets, grid, mobSpawns, chests, pillars, rubble, torches, spawnTx, spawnTz, spawnHeight, entryLocal };
}

/** Random single-level dungeon layout for the editor's "Generate" button.
 *  Unlike generateProceduralDungeonDraft (the *runtime* fallback used for
 *  any dungeon tier that hasn't been hand-authored yet, which lays out a
 *  fixed 9-sector grid with multi-level stairs), this fills the whole
 *  DUNGEON_GRID_SIZE grid with a variable number of randomly-placed,
 *  corridor-connected rooms at a single flat height and furnishes them with
 *  every decorative prop category the editor palette offers -- torches,
 *  pillars, rubble, banners, tables/barrels, barriers -- so a generated
 *  draft looks like an actual furnished dungeon instead of bare floor and
 *  walls, cutting down how much the author has to hand-place afterward.
 *  Pass a fresh seed (e.g. a random string) each click for a new layout. */
export function generateRandomDungeonBlueprint(seed: string): DungeonBlueprint {
  const rng = mulberry32(hashString(seed) ^ 0x51a4d9);
  const GRID = DUNGEON_GRID_SIZE;
  const HALF = DUNGEON_HALF;
  const MARGIN = 1;
  const cellCenter = dungeonCellCenter;
  const key = (x: number, z: number) => `${x}_${z}`;

  interface Room { x0: number; z0: number; x1: number; z1: number; cx: number; cz: number; w: number; h: number }
  const rooms: Room[] = [];
  const roomCount = 4 + Math.floor(rng() * 4); // 4-7 rooms
  for (let guard = 0; rooms.length < roomCount && guard < 400; guard++) {
    const w = 6 + Math.floor(rng() * 6); // 6-11 tiles
    const h = 6 + Math.floor(rng() * 6);
    const span = GRID - 2 * MARGIN - w + 1;
    const spanH = GRID - 2 * MARGIN - h + 1;
    if (span <= 0 || spanH <= 0) continue;
    const x0 = MARGIN + Math.floor(rng() * span);
    const z0 = MARGIN + Math.floor(rng() * spanH);
    const x1 = x0 + w - 1;
    const z1 = z0 + h - 1;
    // Reject if it overlaps (or sits flush against) any existing room, so
    // rooms always stay visually distinct with a walkable gap or wall
    // between them.
    const overlaps = rooms.some(
      (r) => x0 - 1 <= r.x1 + 1 && x1 + 1 >= r.x0 - 1 && z0 - 1 <= r.z1 + 1 && z1 + 1 >= r.z0 - 1
    );
    if (overlaps) continue;
    rooms.push({ x0, z0, x1, z1, cx: Math.round((x0 + x1) / 2), cz: Math.round((z0 + z1) / 2), w, h });
  }
  if (rooms.length === 0) {
    // Every random placement attempt collided -- guarantee at least one
    // room so the draft is never completely empty.
    const w = 10, h = 10;
    const x0 = Math.floor(GRID / 2) - Math.floor(w / 2);
    const z0 = Math.floor(GRID / 2) - Math.floor(h / 2);
    rooms.push({ x0, z0, x1: x0 + w - 1, z1: z0 + h - 1, cx: x0 + Math.floor(w / 2), cz: z0 + Math.floor(h / 2), w, h });
  }

  const floor = new Set<string>();
  const roomFloor = new Set<string>();
  for (const r of rooms) {
    for (let x = r.x0; x <= r.x1; x++) {
      for (let z = r.z0; z <= r.z1; z++) {
        floor.add(key(x, z));
        roomFloor.add(key(x, z));
      }
    }
  }

  // Connect each room to its nearest already-placed room (not just the
  // previous one in generation order) via a 1-tile-wide L-shaped corridor --
  // keeps corridors short instead of one snaking mega-corridor whenever two
  // consecutively-generated rooms happen to land far apart.
  for (let i = 1; i < rooms.length; i++) {
    const b = rooms[i]!;
    let nearest = rooms[0]!;
    let bestDist = Infinity;
    for (let j = 0; j < i; j++) {
      const a = rooms[j]!;
      const d = Math.abs(a.cx - b.cx) + Math.abs(a.cz - b.cz);
      if (d < bestDist) { bestDist = d; nearest = a; }
    }
    const a = nearest;
    if (rng() < 0.5) {
      for (let x = Math.min(a.cx, b.cx); x <= Math.max(a.cx, b.cx); x++) floor.add(key(x, a.cz));
      for (let z = Math.min(a.cz, b.cz); z <= Math.max(a.cz, b.cz); z++) floor.add(key(b.cx, z));
    } else {
      for (let z = Math.min(a.cz, b.cz); z <= Math.max(a.cz, b.cz); z++) floor.add(key(a.cx, z));
      for (let x = Math.min(a.cx, b.cx); x <= Math.max(a.cx, b.cx); x++) floor.add(key(x, b.cz));
    }
  }

  const assets: DungeonAsset[] = [];
  const chests: { localX: number; localY: number; localZ: number; rarity: "common" | "rare" }[] = [];
  const mobSpawns: { localX: number; localZ: number }[] = [];

  const FLOOR_VARIANTS = [
    "floor_tile_large.gltf", "floor_tile_large.gltf", "floor_tile_large.gltf", "floor_tile_large.gltf",
    "floor_tile_large_rocks.gltf", "floor_dirt_large.gltf",
  ];
  for (const k of floor) {
    const [txs, tzs] = k.split("_");
    const tx = Number(txs), tz = Number(tzs);
    const model = FLOOR_VARIANTS[Math.floor(rng() * FLOOR_VARIANTS.length)]!;
    assets.push({ model, localX: cellCenter(tx), localY: 0, localZ: cellCenter(tz), yaw: 0, scale: 1 });
  }

  const entryRoom = rooms[0]!;
  const entryLocal = { x: cellCenter(entryRoom.cx), z: cellCenter(entryRoom.cz) };

  // Walls ring the outside of the combined floor+corridor footprint --
  // corridor cells are just regular floor cells here, so a room opens
  // straight into its connecting corridor with no doorway needed; walls
  // only appear where a floor cell borders genuinely empty space.
  const neighborsOf = (cx: number, cz: number) => [
    { dx: 0, dz: -1, yaw: 0, x: cx, z: cz - HALF, tag: "N" },
    { dx: 0, dz: 1, yaw: Math.PI, x: cx, z: cz + HALF, tag: "S" },
    { dx: 1, dz: 0, yaw: -Math.PI / 2, x: cx + HALF, z: cz, tag: "E" },
    { dx: -1, dz: 0, yaw: Math.PI / 2, x: cx - HALF, z: cz, tag: "W" },
  ] as const;
  const cornerDefs = [
    { pair: ["N", "E"], vx: HALF, vz: -HALF, yaw: 0 },
    { pair: ["E", "S"], vx: HALF, vz: HALF, yaw: -Math.PI / 2 },
    { pair: ["S", "W"], vx: -HALF, vz: HALF, yaw: Math.PI },
    { pair: ["W", "N"], vx: -HALF, vz: -HALF, yaw: Math.PI / 2 },
  ] as const;

  const wallSpotsByRoom = new Map<number, { x: number; z: number; yaw: number }[]>();
  for (const k of floor) {
    const [txs, tzs] = k.split("_");
    const tx = Number(txs), tz = Number(tzs);
    const cx = cellCenter(tx), cz = cellCenter(tz);
    const wallDirs = new Set<string>();
    const roomIdx = rooms.findIndex((r) => tx >= r.x0 && tx <= r.x1 && tz >= r.z0 && tz <= r.z1);
    for (const n of neighborsOf(cx, cz)) {
      if (floor.has(key(tx + n.dx, tz + n.dz))) continue;
      const isEntryDoor = tx === entryRoom.cx && tz === entryRoom.cz && n.tag === "W";
      assets.push({
        model: isEntryDoor ? "wall_doorway.gltf" : "wall.gltf",
        localX: n.x, localY: 0, localZ: n.z, yaw: n.yaw, scale: 1,
      });
      wallDirs.add(n.tag);
      if (roomIdx >= 0) {
        const list = wallSpotsByRoom.get(roomIdx) ?? [];
        list.push({ x: n.x, z: n.z, yaw: n.yaw });
        wallSpotsByRoom.set(roomIdx, list);
      }
    }
    for (const c of cornerDefs) {
      if (wallDirs.has(c.pair[0]) && wallDirs.has(c.pair[1])) {
        assets.push({ model: "wall_corner.gltf", localX: cx + c.vx, localY: 0, localZ: cz + c.vz, yaw: c.yaw, scale: 1 });
      }
    }
  }

  const TORCH_MODELS = ["torch_lit.gltf", "torch.gltf"];
  const PILLAR_MODELS = ["pillar.gltf", "pillar_decorated.gltf", "column.gltf"];
  const RUBBLE_MODELS = ["rubble_half.gltf", "rubble_large.gltf"];
  const BANNER_MODELS = [
    "banner_red.gltf", "banner_blue.gltf", "banner_green.gltf", "banner_brown.gltf",
    "banner_white.gltf", "banner_yellow.gltf", "banner_shield_red.gltf", "banner_shield_blue.gltf",
  ];
  const TABLE_MODELS = ["table_long.gltf", "table_medium.gltf", "table_small.gltf", "table_round_medium.gltf"];
  const BARREL_MODELS = ["barrel_large.gltf", "barrel_small.gltf", "barrel_small_stack.gltf"];
  const COMMON_CHEST_MODELS = ["chest.gltf", "chest_large.gltf"];
  const RARE_CHEST_MODELS = ["chest_gold.gltf", "chest_large_gold.gltf"];

  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rng() * arr.length)]!;

  for (let i = 0; i < rooms.length; i++) {
    const r = rooms[i]!;
    const isEntry = i === 0;

    // Interior cells only (excludes the outer ring, which is where walls
    // sit) -- every room has at least one since w/h are both >= 3.
    const interior: { tx: number; tz: number }[] = [];
    for (let x = r.x0 + 1; x <= r.x1 - 1; x++) {
      for (let z = r.z0 + 1; z <= r.z1 - 1; z++) interior.push({ tx: x, tz: z });
    }
    for (let s = interior.length - 1; s > 0; s--) {
      const j = Math.floor(rng() * (s + 1));
      [interior[s], interior[j]] = [interior[j]!, interior[s]!];
    }
    let cursor = 0;
    const nextSpot = () => (cursor < interior.length ? interior[cursor++] : undefined);

    if (!isEntry && rng() < 0.5) {
      const spot = nextSpot();
      if (spot) {
        const x = cellCenter(spot.tx), z = cellCenter(spot.tz);
        const rarity: "common" | "rare" = rng() < 0.3 ? "rare" : "common";
        const isMimic = rng() < 0.08;
        const model = isMimic ? "chest_mimic.gltf" : pick(rarity === "rare" ? RARE_CHEST_MODELS : COMMON_CHEST_MODELS);
        chests.push({ localX: x, localY: 0, localZ: z, rarity });
        assets.push({ model, localX: x, localY: 0, localZ: z, yaw: rng() * Math.PI * 2, scale: 1 });
      }
    }

    if (r.w * r.h >= 12 && rng() < 0.5) {
      const corners: [number, number][] = [[r.x0 + 1, r.z0 + 1], [r.x1 - 1, r.z0 + 1], [r.x0 + 1, r.z1 - 1], [r.x1 - 1, r.z1 - 1]];
      for (const [tx, tz] of corners) {
        if (rng() < 0.6) {
          assets.push({ model: pick(PILLAR_MODELS), localX: cellCenter(tx), localY: 0, localZ: cellCenter(tz), yaw: 0, scale: 1 });
        }
      }
    }

    if (rng() < 0.35) {
      const spot = nextSpot();
      if (spot) {
        assets.push({
          model: pick(RUBBLE_MODELS), localX: cellCenter(spot.tx), localY: 0, localZ: cellCenter(spot.tz),
          yaw: rng() * Math.PI * 2, scale: 1,
        });
      }
    }

    if (rng() < 0.3) {
      const spot = nextSpot();
      if (spot) {
        assets.push({ model: pick(TABLE_MODELS), localX: cellCenter(spot.tx), localY: 0, localZ: cellCenter(spot.tz), yaw: rng() * Math.PI * 2, scale: 1 });
      }
      if (rng() < 0.7) {
        const spot2 = nextSpot();
        if (spot2) {
          assets.push({ model: pick(BARREL_MODELS), localX: cellCenter(spot2.tx), localY: 0, localZ: cellCenter(spot2.tz), yaw: rng() * Math.PI * 2, scale: 1 });
        }
      }
    }

    const wallSpots = wallSpotsByRoom.get(i);
    if (wallSpots && wallSpots.length > 0 && rng() < 0.5) {
      const spot = pick(wallSpots);
      assets.push({ model: pick(BANNER_MODELS), localX: spot.x, localY: 1.6, localZ: spot.z, yaw: spot.yaw, scale: 1 });
    }
    if (rng() < 0.4) {
      const spot = pick(interior.length > 0 ? interior : [{ tx: r.cx, tz: r.cz }]);
      assets.push({ model: pick(TORCH_MODELS), localX: cellCenter(spot.tx), localY: 0, localZ: cellCenter(spot.tz), yaw: 0, scale: 1 });
    }

    if (!isEntry) {
      const mobCount = 1 + Math.floor(rng() * (r.w * r.h >= 16 ? 3 : 2));
      for (let m = 0; m < mobCount; m++) {
        const spot = interior[Math.floor(rng() * interior.length)]!;
        mobSpawns.push({ localX: cellCenter(spot.tx) + (rng() - 0.5) * HALF, localZ: cellCenter(spot.tz) + (rng() - 0.5) * HALF });
      }
    }
  }

  // A handful of barrier/lock props at corridor cells (floor tiles that
  // don't belong to any room) purely for flavor -- decorative only, since
  // deriveDungeonGridFromAssets only reads floor_/stairs_ prefixed assets,
  // so these never actually block movement.
  const BARRIER_MODELS = ["barrier.gltf", "barrier_column.gltf", "barrier_corner.gltf", "key_gold.gltf", "lock_A.gltf"];
  for (const k of floor) {
    if (roomFloor.has(k)) continue;
    if (rng() > 0.12) continue;
    const [txs, tzs] = k.split("_");
    const tx = Number(txs), tz = Number(tzs);
    assets.push({ model: pick(BARRIER_MODELS), localX: cellCenter(tx), localY: 0, localZ: cellCenter(tz), yaw: rng() * Math.PI * 2, scale: 1 });
  }

  return { assets, mobSpawns, chests, entryLocal };
}

export function generateDungeonLayout(portalId: string): DungeonLayoutSpec {
  const cached = dungeonLayoutCache.get(portalId);
  if (cached) return cached;
  const portal = generatePois().find((p) => p.id === portalId && p.type === "dungeon_portal");
  if (!portal || portal.arenaX === undefined || portal.arenaZ === undefined) {
    throw new Error(`Unknown dungeon portal: ${portalId}`);
  }
  const floorY = terrainHeight(portal.arenaX, portal.arenaZ);
  const center = { x: portal.arenaX, y: floorY, z: portal.arenaZ };

  const dx = center.x - portal.x;
  const dz = center.z - portal.z;
  const doorwayAngle = Math.atan2(dx, dz);

  const tier = portal.dungeonTier ?? 0;
  if (hasDungeonBlueprint(tier)) {
    const bp = DUNGEON_BLUEPRINTS[tier]!;
    const grid = deriveDungeonGridFromAssets(bp.assets);
    const spawnTx = dungeonSnapToTile(bp.entryLocal.x);
    const spawnTz = dungeonSnapToTile(bp.entryLocal.z);
    const entryTile = grid.find((t) => t.tx === spawnTx && t.tz === spawnTz);
    const layout: DungeonLayoutSpec = {
      id: portalId,
      center,
      entryPoint: { x: center.x + bp.entryLocal.x, z: center.z + bp.entryLocal.z },
      spawnTx,
      spawnTz,
      spawnHeight: entryTile?.height ?? 0,
      mobSpawns: bp.mobSpawns,
      floorY,
      doorwayAngle,
      pillars: [],
      rubble: [],
      grid,
      assets: bp.assets,
      chests: bp.chests,
      torches: [],
    };
    dungeonLayoutCache.set(portalId, layout);
    return layout;
  }

  const draft = generateProceduralDungeonDraft(portalId);
  const layout: DungeonLayoutSpec = {
    id: portalId,
    center,
    entryPoint: { x: center.x + draft.entryLocal.x, z: center.z + draft.entryLocal.z },
    spawnTx: draft.spawnTx,
    spawnTz: draft.spawnTz,
    spawnHeight: draft.spawnHeight,
    mobSpawns: draft.mobSpawns,
    floorY,
    doorwayAngle,
    pillars: draft.pillars,
    rubble: draft.rubble,
    grid: draft.grid,
    assets: draft.assets,
    chests: draft.chests,
    torches: draft.torches,
  };

  dungeonLayoutCache.set(portalId, layout);
  return layout;
}

/** Resolves a single tile's floor height at a local (lx,lz) position --
 *  flat for "floor" tiles, ramped across the stairsDir axis (scaled by
 *  stairsDir.rise, defaulting to 1.0) for "stairs" tiles. Extracted as its
 *  own pure function so the interpolation math is unit-testable without
 *  needing a real dungeon portal (see worldgen.test.ts). */
export function dungeonTileFloorHeight(tile: DungeonTile, lx: number, lz: number, floorY: number): number {
  if (tile.type === "stairs" && tile.stairsDir) {
    const cellCenterX = dungeonCellCenter(tile.tx);
    const cellCenterZ = dungeonCellCenter(tile.tz);
    let t = 0.5;
    if (tile.stairsDir.x !== 0) {
      const dx = lx - cellCenterX;
      t = (dx * tile.stairsDir.x + DUNGEON_HALF) / DUNGEON_PITCH;
    } else if (tile.stairsDir.z !== 0) {
      const dz = lz - cellCenterZ;
      t = (dz * tile.stairsDir.z + DUNGEON_HALF) / DUNGEON_PITCH;
    }
    t = Math.max(0, Math.min(1, t));
    return floorY + tile.height + t * (tile.stairsDir.rise ?? 1.0);
  }
  return floorY + tile.height;
}

export function dungeonFloorHeightAt(x: number, z: number): number | null {
  for (const p of generatePois()) {
    if (p.type !== "dungeon_portal" || p.arenaX === undefined || p.arenaZ === undefined) continue;
    if (dist2D(x, z, p.arenaX, p.arenaZ) < DUNGEON_WALL_RADIUS) {
      const layout = generateDungeonLayout(p.id);
      const lx = x - layout.center.x;
      const lz = z - layout.center.z;
      if (lx < -60 || lx > 60 || lz < -60 || lz > 60) return null;

      const gx = Math.floor((lx + 60) / DUNGEON_PITCH);
      const gz = Math.floor((lz + 60) / DUNGEON_PITCH);
      if (gx < 0 || gx > DUNGEON_GRID_SIZE - 1 || gz < 0 || gz > DUNGEON_GRID_SIZE - 1) return null;

      const tile = layout.grid.find((t: DungeonTile) => t.tx === gx && t.tz === gz);
      if (!tile || tile.type === "empty") return null;
      return dungeonTileFloorHeight(tile, lx, lz, layout.floorY);
    }
  }
  return null;
}

export function dungeonPortalAt(x: number, z: number): PoiSpec | null {
  for (const p of generatePois()) {
    if (p.type !== "dungeon_portal" || p.arenaX === undefined || p.arenaZ === undefined) continue;
    if (dist2D(x, z, p.arenaX, p.arenaZ) < DUNGEON_WALL_RADIUS) return p;
  }
  return null;
}

// ============================ bridges ============================

export interface BridgeSpec {
  id: string;
  type: "bridge_A" | "bridge_B";
  x: number;
  /** Deck height — pre-river bank height, so the model spans the trench. */
  y: number;
  z: number;
  yaw: number;
}

/** Total span of a bridge deck, bank to bank plus a little overlap. */
export const BRIDGE_SPAN = RIVER_HALF_WIDTH * 2 + 6;
/** Half-width of the walkable deck, perpendicular to the span. */
export const BRIDGE_DECK_HALF_WIDTH = 2.2;

/** 2D line-segment intersection point, or null if they don't cross. */
function segmentIntersect(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): { x: number; z: number } | null {
  const rX = bx - ax;
  const rZ = bz - az;
  const sX = dx - cx;
  const sZ = dz - cz;
  const denom = rX * sZ - rZ * sX;
  if (Math.abs(denom) < 1e-9) return null; // parallel
  const t = ((cx - ax) * sZ - (cz - az) * sX) / denom;
  const u = ((cx - ax) * rZ - (cz - az) * rX) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: ax + t * rX, z: az + t * rZ };
}

let bridgesCache: BridgeSpec[] | null = null;

/** A bridge wherever a dirt path crosses a river. */
export function generateBridges(): BridgeSpec[] {
  if (bridgesCache) return bridgesCache;
  const paths = generatePaths();
  const rivers = generateRivers();
  const bridges: BridgeSpec[] = [];
  const seen = new Set<string>();

  for (const p of paths) {
    for (const r of rivers) {
      const hit = segmentIntersect(p.ax, p.az, p.bx, p.bz, r.ax, r.az, r.bx, r.bz);
      if (!hit) continue;
      const key = `${Math.round(hit.x / 6)}_${Math.round(hit.z / 6)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const yaw = Math.atan2(p.bx - p.ax, p.bz - p.az);
      bridges.push({
        id: `bridge_${bridges.length}`,
        type: bridges.length % 2 === 0 ? "bridge_A" : "bridge_B",
        x: hit.x,
        y: terrainHeightBeforeRivers(hit.x, hit.z),
        z: hit.z,
        yaw,
      });
    }
  }
  bridgesCache = bridges;
  return bridges;
}

/**
 * If (x,z) lies on a bridge deck, its flat crossing height — so players walk
 * the span instead of sinking into the river's carved trench below. Null if
 * no bridge covers this point.
 */
export function bridgeHeightAt(x: number, z: number): number | null {
  for (const b of generateBridges()) {
    const dx = x - b.x;
    const dz = z - b.z;
    // Rotate into the bridge's local frame: "along" its span, "across" its width.
    const along = dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw);
    const across = dx * Math.cos(b.yaw) - dz * Math.sin(b.yaw);
    if (Math.abs(along) < BRIDGE_SPAN / 2 && Math.abs(across) < BRIDGE_DECK_HALF_WIDTH) {
      return b.y;
    }
  }
  return null;
}

/** Stable per-string variant helper for clients. */
export function variantOf(id: string): number {
  return (hashString(id) % 1000) / 1000;
}
