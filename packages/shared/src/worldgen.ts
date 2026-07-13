import { hash2, mulberry32, hashString } from "./rng";
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
import { ZONE_SEED, ZONE_SIZE, WATER_LEVEL, SPAWN_POINT } from "./constants";
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

export type PoiType = "ruins" | "shrine" | "camp" | "tower";

export interface PoiSpec {
  id: string;
  type: PoiType;
  x: number;
  y: number;
  z: number;
  yaw: number;
  buildings: BuildingSpec[];
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

  poisCache = pois;
  return pois;
}

// ============================ resource nodes ============================

interface BiomeMix {
  presence: number; // scatter density 0..1 (higher = more nodes)
  tree: number; // cumulative rolls
  rock: number;
}

const BIOME_MIX: Record<Biome, BiomeMix> = {
  forest: { presence: 0.62, tree: 0.6, rock: 0.85 },
  meadow: { presence: 0.34, tree: 0.3, rock: 0.45 },
  mountain: { presence: 0.5, tree: 0.28, rock: 0.85 },
  hills: { presence: 0.42, tree: 0.35, rock: 0.75 },
  swamp: { presence: 0.55, tree: 0.5, rock: 0.55 },
  dunes: { presence: 0.16, tree: 0.7, rock: 0.9 },
};

/**
 * Deterministic resource node scatter. Client and server both call this and
 * get the identical node list; only depletion state is dynamic.
 */
export function generateNodes(): WorldNode[] {
  const villages = generateVillages();
  const paths = generatePaths();
  const pois = generatePois();

  const nodes: WorldNode[] = [];
  const half = ZONE_SIZE / 2;
  const cells = Math.floor(ZONE_SIZE / NODE_CELL);
  for (let cx = 0; cx < cells; cx++) {
    for (let cz = 0; cz < cells; cz++) {
      const jx = hash2(ZONE_SEED + 31, cx, cz);
      const jz = hash2(ZONE_SEED + 37, cx, cz);
      const x = -half + (cx + 0.15 + jx * 0.7) * NODE_CELL;
      const z = -half + (cz + 0.15 + jz * 0.7) * NODE_CELL;

      const biome = biomeAt(x, z);
      const mix = BIOME_MIX[biome];
      const presence = hash2(ZONE_SEED + 11, cx, cz);
      const density = fbm(ZONE_SEED + 23, x, z, 160, 2);
      if (presence > mix.presence * (0.45 + density * 0.9)) continue;

      const y = terrainHeight(x, z);
      if (y < WATER_LEVEL + 0.4) continue;
      if (terrainSlope(x, z) > 0.85) continue;
      if (dist2D(x, z, SPAWN_POINT.x, SPAWN_POINT.z) < SPAWN_CLEAR_RADIUS) continue;
      if (villages.some((v) => dist2D(x, z, v.x, v.z) < v.radius + 4)) continue;
      if (pois.some((p) => dist2D(x, z, p.x, p.z) < POI_CLEAR)) continue;
      if (paths.some((s) => distPointToSegment(x, z, s.ax, s.az, s.bx, s.bz) < PATH_CLEAR)) continue;
      if (distToRiver(x, z) < RIVER_HALF_WIDTH + 2) continue;

      const roll = hash2(ZONE_SEED + 41, cx, cz);
      const type = roll < mix.tree ? "tree" : roll < mix.rock ? "rock" : "berry_bush";
      nodes.push({
        id: `n_${cx}_${cz}`,
        type,
        x,
        y,
        z,
        variant: hash2(ZONE_SEED + 43, cx, cz),
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

function pickBiomeMob(biome: Biome, roll: number): string {
  const table = BIOME_MOB_TABLE[biome];
  for (const [type, w] of table) if (roll < w) return type;
  return "wolf";
}

/**
 * Deterministic mob spawn points. Every biome has a mix of beasts and stray
 * undead; ruins add dense skeleton clusters on top.
 */
export function generateMobSpawns(): MobSpawn[] {
  const villages = generateVillages();
  const ruins = generatePois().filter((p) => p.type === "ruins");
  const spawns: MobSpawn[] = [];
  const half = ZONE_SIZE / 2;
  const cells = Math.floor(ZONE_SIZE / MOB_CELL);
  for (let cx = 0; cx < cells; cx++) {
    for (let cz = 0; cz < cells; cz++) {
      if (hash2(ZONE_SEED + 51, cx, cz) > 0.72) continue; // denser world
      const x = -half + (cx + 0.2 + hash2(ZONE_SEED + 53, cx, cz) * 0.6) * MOB_CELL;
      const z = -half + (cz + 0.2 + hash2(ZONE_SEED + 57, cx, cz) * 0.6) * MOB_CELL;
      const y = terrainHeight(x, z);
      if (y < WATER_LEVEL + 0.5) continue;
      if (dist2D(x, z, SPAWN_POINT.x, SPAWN_POINT.z) < SPAWN_CLEAR_RADIUS * 1.6) continue;
      if (villages.some((v) => dist2D(x, z, v.x, v.z) < v.radius + 20)) continue;
      if (ruins.some((r) => dist2D(x, z, r.x, r.z) < UNDEAD_RADIUS)) continue; // undead handled below
      if (distToRiver(x, z) < RIVER_HALF_WIDTH + 2) continue;

      const type = pickBiomeMob(biomeAt(x, z), hash2(ZONE_SEED + 61, cx, cz));
      spawns.push({ id: `m_${cx}_${cz}`, type, x, y, z });
    }
  }

  // Guaranteed undead clusters ringing each ruins so they feel truly haunted.
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
      const roll = hash2(ZONE_SEED + 79, ri, i);
      const type = roll < 0.5 ? "skeleton_minion" : roll < 0.8 ? "skeleton_warrior" : "skeleton_rogue";
      spawns.push({ id: `u_${ri}_${i}`, type, x, y, z });
    }
  }

  return spawns;
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
