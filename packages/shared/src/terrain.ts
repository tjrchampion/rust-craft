import { hash2, mulberry32 } from "./rng";
import { smoothstep, lerp, clamp, distPointToSegment } from "./math";
import { ZONE_SEED, ZONE_SIZE, SPAWN_POINT, WATER_LEVEL } from "./constants";

/** Value noise at (x, z) for one octave with given cell size. */
function valueNoise(seed: number, x: number, z: number, cellSize: number): number {
  const gx = x / cellSize;
  const gz = z / cellSize;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const tx = smoothstep(gx - x0);
  const tz = smoothstep(gz - z0);
  const v00 = hash2(seed, x0, z0);
  const v10 = hash2(seed, x0 + 1, z0);
  const v01 = hash2(seed, x0, z0 + 1);
  const v11 = hash2(seed, x0 + 1, z0 + 1);
  return lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), tz);
}

/** Fractal (fBm) value noise in [0, 1]. */
export function fbm(seed: number, x: number, z: number, cellSize: number, octaves: number): number {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let size = cellSize;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(seed + i * 101, x, z, size);
    norm += amp;
    amp *= 0.5;
    size *= 0.5;
  }
  return sum / norm;
}

export type Biome = "meadow" | "forest" | "hills" | "mountain" | "swamp" | "dunes";

/** Elevation-ish field in [0,1] — the primary axis (low → high ground). */
export function biomeValue(x: number, z: number): number {
  return fbm(ZONE_SEED + 909, x, z, 240, 2);
}

/** Moisture field in [0,1] — the secondary axis (dry → wet), independent of elevation. */
export function moistureValue(x: number, z: number): number {
  return fbm(ZONE_SEED + 2003, x, z, 200, 2);
}

/**
 * Biome is a simple Whittaker-style lookup over elevation × moisture:
 * high ground is always mountain; among low/mid ground, wet lowlands are
 * swamp, dry lowlands are dunes, dry mid-ground is hills, and everything
 * else is meadow (dry-ish) or forest (wetter mid-ground).
 */
export function biomeAt(x: number, z: number): Biome {
  const e = biomeValue(x, z);
  const m = moistureValue(x, z);
  if (e > 0.72) return "mountain";
  if (e < 0.32) {
    if (m > 0.58) return "swamp";
    if (m < 0.34) return "dunes";
    return "meadow";
  }
  return m < 0.34 ? "hills" : "forest";
}

/**
 * Terrain height before rivers are carved in — the raw hill/biome shape.
 * Exported so bridge decks can sit at bank height instead of the trench.
 */
export function terrainHeightBeforeRivers(x: number, z: number): number {
  const base = fbm(ZONE_SEED, x, z, 90, 4); // rolling hills
  const ridge = fbm(ZONE_SEED + 7777, x, z, 220, 2); // large-scale variation
  let h = base * 14 + ridge * 12 - 6;

  const e = biomeValue(x, z);
  const m = moistureValue(x, z);

  // Continuous per-biome weights (smooth, so terrain never seams at a band edge).
  const mountainT = smoothstep(clamp((e - 0.62) / 0.25, 0, 1));
  const midElevT =
    smoothstep(clamp((e - 0.3) / 0.15, 0, 1)) * (1 - smoothstep(clamp((e - 0.72) / 0.15, 0, 1)));
  const lowElevT = 1 - smoothstep(clamp((e - 0.32) / 0.15, 0, 1));
  const wetT = smoothstep(clamp((m - 0.58) / 0.25, 0, 1));
  const dryT = 1 - smoothstep(clamp((m - 0.34) / 0.2, 0, 1));
  const hillsT = midElevT * dryT;
  const swampT = lowElevT * wetT;
  const dunesT = lowElevT * dryT;
  const meadowT = lowElevT * (1 - wetT) * (1 - dryT);

  // Mountains rise into tall, craggy, terraced peaks — a dramatic jump well
  // above the rolling hills, with extra fine noise for rocky jaggedness.
  const jagged = fbm(ZONE_SEED + 3301, x, z, 42, 3) - 0.5;
  h += mountainT * 32 + jagged * 7 * mountainT;
  // Hills roll gently — a modest bump well short of full mountain height.
  h += hillsT * (1 - mountainT) * 3.5;
  // Meadows sit slightly low and open.
  h -= meadowT * 2;
  // Swamps sink into flat, boggy lowland near the waterline.
  h -= swampT * 4;
  h = lerp(h, WATER_LEVEL + 0.6, swampT * 0.75);
  // Dunes stay dry and sandy — fine ripple noise instead of broad rolling
  // hills, but centered on the same baseline (never sinks below the water).
  const ripple = fbm(ZONE_SEED + 2101, x, z, 22, 2) - 0.5;
  h += ripple * 3 * dunesT;
  h = lerp(h, 4, dunesT * 0.4);

  // Blend toward stepped plateaus deep in mountain terrain for dramatic
  // cliff faces and walkable terraces.
  if (mountainT > 0.25) {
    const STEP = 5;
    const terraced = Math.round(h / STEP) * STEP;
    h = lerp(h, terraced, ((mountainT - 0.25) / 0.75) * 0.75);
  }

  // Mountain passes: a couple of winding corridors notch down through
  // whatever peaks they cross, carving a walkable canyon route — but have
  // no effect outside actual mountain terrain (gated by mountainT).
  const passD = distToPass(x, z);
  const passT = (1 - smoothstep(clamp((passD - PASS_HALF_WIDTH) / (PASS_HALF_WIDTH * 1.3), 0, 1))) * mountainT;
  h -= passT * 22;

  // Flatten a gentle plateau around spawn so players start on open ground.
  const dSpawn = Math.sqrt(x * x + z * z);
  const flat = 1 - smoothstep(clamp(dSpawn / 40, 0, 1));
  h = lerp(h, 4.2, flat * 0.85);

  // Sink the map edges into the sea so the zone has a natural border.
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const half = ZONE_SIZE / 2;
  const falloff = smoothstep(clamp((edge - half * 0.72) / (half * 0.28), 0, 1));
  h = lerp(h, -8, falloff);

  return h;
}

// ============================ mountain passes ============================

interface PassSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

export const PASS_HALF_WIDTH = 9;
const PASS_LENGTH = 130;

/** How much of a candidate line actually crosses real mountain terrain. */
function scorePassLine(cx: number, cz: number, angle: number): number {
  let score = 0;
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps - 0.5) * PASS_LENGTH;
    const x = cx + Math.cos(angle) * t;
    const z = cz + Math.sin(angle) * t;
    if (biomeValue(x, z) > 0.62) score++;
  }
  return score;
}

let passesCache: PassSegment[] | null = null;

interface PassCandidate {
  cx: number;
  cz: number;
  angle: number;
  score: number;
}

/**
 * Deterministic winding corridors that cut through whatever mountains they
 * cross. Rather than guessing fixed endpoints (which may miss the mountain
 * noise field entirely), search many candidate lines and keep the two that
 * actually spend the most length inside real mountain terrain.
 */
function generatePasses(): PassSegment[] {
  if (passesCache) return passesCache;
  const half = ZONE_SIZE / 2;
  const searchRng = mulberry32(ZONE_SEED + 8001);
  let best: PassCandidate | null = null;
  let secondBest: PassCandidate | null = null;
  for (let attempt = 0; attempt < 400; attempt++) {
    const cx = (searchRng() - 0.5) * half * 1.6;
    const cz = (searchRng() - 0.5) * half * 1.6;
    const angle = searchRng() * Math.PI;
    const score = scorePassLine(cx, cz, angle);
    if (!best || score > best.score) {
      secondBest = best;
      best = { cx, cz, angle, score };
    } else if ((!secondBest || score > secondBest.score) && Math.hypot(cx - best.cx, cz - best.cz) > 60) {
      secondBest = { cx, cz, angle, score };
    }
  }

  const segments: PassSegment[] = [];
  const candidates = [best, secondBest].filter((c): c is NonNullable<typeof c> => !!c && c.score > 0);
  candidates.forEach((c, passId) => {
    const rng = mulberry32(ZONE_SEED + 8101 + passId * 97);
    const ax = c.cx - Math.cos(c.angle) * (PASS_LENGTH / 2);
    const az = c.cz - Math.sin(c.angle) * (PASS_LENGTH / 2);
    const bx = c.cx + Math.cos(c.angle) * (PASS_LENGTH / 2);
    const bz = c.cz + Math.sin(c.angle) * (PASS_LENGTH / 2);
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    const steps = 6;
    const points: [number, number][] = [[ax, az]];
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const mx = ax + dx * t;
      const mz = az + dz * t;
      const jitter = (rng() - 0.5) * Math.min(30, len * 0.1);
      points.push([mx + (-dz / len) * jitter, mz + (dx / len) * jitter]);
    }
    points.push([bx, bz]);
    for (let p = 0; p < points.length - 1; p++) {
      segments.push({ ax: points[p]![0], az: points[p]![1], bx: points[p + 1]![0], bz: points[p + 1]![1] });
    }
  });
  passesCache = segments;
  return segments;
}

/** Distance from (x,z) to the nearest mountain-pass centerline. */
export function distToPass(x: number, z: number): number {
  let best = Infinity;
  for (const s of generatePasses()) {
    const d = distPointToSegment(x, z, s.ax, s.az, s.bx, s.bz);
    if (d < best) best = d;
  }
  return best;
}

// ============================ rivers ============================

export interface RiverSegment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  riverId: number;
}

const RIVER_DEFS: { start: [number, number]; end: [number, number]; seedOffset: number }[] = [
  { start: [-95, -225], end: [65, 255], seedOffset: 4001 },
  { start: [235, -35], end: [-255, 150], seedOffset: 4101 },
];

export const RIVER_HALF_WIDTH = 5; // meters, centerline to bank
export const RIVER_DEPTH = 2.2; // meters below the surrounding land
export const RIVER_WATER_OFFSET = 0.7; // meters above the carved bed to the water surface

let riversCache: RiverSegment[] | null = null;

/** Deterministic winding river polylines, independent of villages/paths. */
export function generateRivers(): RiverSegment[] {
  if (riversCache) return riversCache;
  const segments: RiverSegment[] = [];
  RIVER_DEFS.forEach((def, riverId) => {
    const rng = mulberry32(ZONE_SEED + def.seedOffset);
    const [ax, az] = def.start;
    const [bx, bz] = def.end;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz) || 1;
    const steps = 7;
    const points: [number, number][] = [[ax, az]];
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const mx = ax + dx * t;
      const mz = az + dz * t;
      const jitter = (rng() - 0.5) * Math.min(55, len * 0.16);
      points.push([mx + (-dz / len) * jitter, mz + (dx / len) * jitter]);
    }
    points.push([bx, bz]);
    for (let p = 0; p < points.length - 1; p++) {
      segments.push({
        ax: points[p]![0],
        az: points[p]![1],
        bx: points[p + 1]![0],
        bz: points[p + 1]![1],
        riverId,
      });
    }
  });
  riversCache = segments;
  return segments;
}

/** Distance from (x,z) to the nearest river centerline, or Infinity if far. */
export function distToRiver(x: number, z: number): number {
  let best = Infinity;
  for (const s of generateRivers()) {
    const d = distPointToSegment(x, z, s.ax, s.az, s.bx, s.bz);
    if (d < best) best = d;
  }
  return best;
}

/** Carve a river trench into a base height, following the land's own contour. */
function applyRiverCarve(x: number, z: number, h: number): number {
  // Keep the spawn plateau dry regardless of river proximity.
  if (Math.hypot(x - SPAWN_POINT.x, z - SPAWN_POINT.z) < 30) return h;

  const d = distToRiver(x, z);
  const bankSpread = RIVER_HALF_WIDTH * 1.8;
  if (d > RIVER_HALF_WIDTH + bankSpread) return h;

  const trench = h - RIVER_DEPTH;
  const t = 1 - smoothstep(clamp((d - RIVER_HALF_WIDTH) / bankSpread, 0, 1));
  return lerp(h, trench, t);
}

/**
 * World terrain height at (x, z). Deterministic and identical on client and
 * server — this IS the ground truth for the zone.
 */
export function terrainHeight(x: number, z: number): number {
  return applyRiverCarve(x, z, terrainHeightBeforeRivers(x, z));
}

/** Approximate terrain normal, for slope checks and lighting. */
export function terrainSlope(x: number, z: number): number {
  const e = 1.0;
  const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const hz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return Math.sqrt(hx * hx + hz * hz) / (2 * e); // rise over run
}
