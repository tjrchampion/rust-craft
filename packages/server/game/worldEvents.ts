import {
  DUNGEON_MOB_MULT_PER_EXTRA_PLAYER,
  WORLD_EVENT_REWARD_TABLE,
  type RegionWorldEvent,
  type WorldEventRewardTier,
} from "@rustcraft/shared";

export type WorldEventPhase = "cooldown" | "active" | "success" | "failed";

export interface WorldEventParticipant {
  score: number;
  lastInRadiusAt: number;
  /** Damage dealt to each event mob (capped per mob). */
  damageByMob: Map<string, number>;
}

export interface WorldEventRuntime {
  def: RegionWorldEvent;
  regionId: string;
  instanceId: string;
  phase: WorldEventPhase;
  nextActiveAt: number;
  endsAt: number | null;
  playerCount: number;
  mobIds: Set<string>;
  bossMobId: string | null;
  scores: Map<string, WorldEventParticipant>;
  /** Last applied proximity×difficulty scale on living event mobs. */
  lastScale: number;
  /** Force a client broadcast next tick. */
  dirty: boolean;
  /** After success/fail, keep that phase visible until this time, then cooldown. */
  phaseHoldUntil: number | null;
}

const DAMAGE_SCORE_PER_HIT = 1;
const MAX_DAMAGE_SCORE_PER_MOB = 40;
const PARTICIPATION_DECAY_MS = 150_000; // ~2.5 min after leaving radius
const GOLD_SCORE = 80;
const SILVER_SCORE = 40;

/** Jittered cooldown so many events don't all fire on the same second. */
export function cooldownMs(frequencyMin: number): number {
  const base = Math.max(60_000, frequencyMin * 60_000);
  const jitter = 0.9 + Math.random() * 0.2;
  return Math.round(base * jitter);
}

export function createWorldEventRuntime(
  def: RegionWorldEvent,
  regionId: string,
  now: number,
): WorldEventRuntime {
  // First activation sooner so authors can see the event without waiting a full cycle.
  const firstDelay = Math.min(cooldownMs(def.frequencyMin) * 0.35, 90_000);
  return {
    def,
    regionId,
    instanceId: `region_${regionId}`,
    phase: "cooldown",
    nextActiveAt: now + firstDelay,
    endsAt: null,
    playerCount: 0,
    mobIds: new Set(),
    bossMobId: null,
    scores: new Map(),
    lastScale: 1,
    dirty: true,
    phaseHoldUntil: null,
  };
}

/** difficulty × dungeon-style proximity curve, clamped. */
export function computeEventScale(difficulty: number, playerCount: number): number {
  const n = Math.max(1, playerCount);
  const prox = 1 + Math.max(0, n - 1) * DUNGEON_MOB_MULT_PER_EXTRA_PLAYER;
  return Math.min(8, Math.max(0.35, difficulty * prox));
}

export function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

export function recordEventDamage(
  rt: WorldEventRuntime,
  playerId: string,
  mobId: string,
  amount: number,
  now: number,
): void {
  if (rt.phase !== "active" || amount <= 0) return;
  if (!rt.mobIds.has(mobId)) return;
  let p = rt.scores.get(playerId);
  if (!p) {
    p = { score: 0, lastInRadiusAt: now, damageByMob: new Map() };
    rt.scores.set(playerId, p);
  }
  p.lastInRadiusAt = now;
  const prev = p.damageByMob.get(mobId) ?? 0;
  const room = Math.max(0, MAX_DAMAGE_SCORE_PER_MOB - prev);
  if (room <= 0) return;
  const add = Math.min(room, Math.max(DAMAGE_SCORE_PER_HIT, amount * 0.15));
  p.damageByMob.set(mobId, prev + add);
  p.score += add;
  rt.dirty = true;
}

/** Decay scores for players who left the radius. */
export function decayParticipation(rt: WorldEventRuntime, now: number): void {
  for (const [id, p] of rt.scores) {
    if (now - p.lastInRadiusAt < PARTICIPATION_DECAY_MS) continue;
    p.score *= 0.92;
    if (p.score < 1) rt.scores.delete(id);
    else rt.dirty = true;
  }
}

/** Refresh decay clock only for players already on the scoreboard. */
export function markInRadius(rt: WorldEventRuntime, playerId: string, now: number): void {
  const p = rt.scores.get(playerId);
  if (p) p.lastInRadiusAt = now;
}

export function tierForScore(score: number): WorldEventRewardTier | null {
  if (score >= GOLD_SCORE) return "gold";
  if (score >= SILVER_SCORE) return "silver";
  if (score >= 1) return "bronze";
  return null;
}

export function rollEventRewards(
  tier: WorldEventRewardTier,
  lootAmount: number,
): Array<{ itemId: string; qty: number }> {
  const table = WORLD_EVENT_REWARD_TABLE[tier];
  const out: Array<{ itemId: string; qty: number }> = [];
  const scale = Math.max(0.5, lootAmount);
  for (const row of table) {
    const base = row.min + Math.floor(Math.random() * (row.max - row.min + 1));
    const qty = Math.max(1, Math.round(base * scale));
    out.push({ itemId: row.itemId, qty });
  }
  return out;
}

export type WorldEventSnap = {
  id: string;
  regionId: string;
  name: string;
  phase: WorldEventPhase;
  localX: number;
  localZ: number;
  radius: number;
  playerCount: number;
  endsAt?: number;
  nextActiveAt?: number;
  myScore?: number;
  myTier?: WorldEventRewardTier | null;
};

export function snapshotWorldEvent(rt: WorldEventRuntime, playerId?: string): WorldEventSnap {
  const snap: WorldEventSnap = {
    id: rt.def.id,
    regionId: rt.regionId,
    name: rt.def.name,
    phase: rt.phase,
    localX: rt.def.localX,
    localZ: rt.def.localZ,
    radius: rt.def.radius,
    playerCount: rt.playerCount,
  };
  if (rt.phase === "active" && rt.endsAt != null) snap.endsAt = rt.endsAt;
  if (rt.phase === "cooldown") snap.nextActiveAt = rt.nextActiveAt;
  if (playerId) {
    const p = rt.scores.get(playerId);
    snap.myScore = p ? Math.round(p.score) : 0;
    snap.myTier = p ? tierForScore(p.score) : null;
  }
  return snap;
}
