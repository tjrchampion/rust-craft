/**
 * WoW-inspired combat math: GCD, ratings→%, secondary DR, hit tables, threat.
 * Server-authoritative — client uses the same helpers for prediction only.
 */

import { clamp } from "../math";

/** Baseline global cooldown (seconds) before haste. */
export const GCD_BASE_S = 1.5;
/** Hard floor for GCD after haste (seconds). */
export const GCD_MIN_S = 0.75;
/**
 * Spell-queue window (ms): if the player presses an ability this close to
 * cast/GCD completion, the server buffers it and fires on the finishing tick.
 */
export const SPELL_QUEUE_WINDOW_MS = 350;

/** Base spell miss chance before hit rating (two-roll system, roll 1). */
export const SPELL_MISS_BASE = 0.04;
/** Floor miss chance even with full hit rating. */
export const SPELL_MISS_FLOOR = 0.01;
/** Melee auto/ability miss slice (single-roll table). */
export const MELEE_MISS_CHANCE = 0.05;
/** Melee dodge slice vs players/mobs (simplified — no parry/block yet). */
export const MELEE_DODGE_CHANCE = 0.05;

/** Crit damage multipliers. */
export const SPELL_CRIT_MULT = 2.0;
export const MELEE_CRIT_MULT = 2.0;

/** Threat lock ratios before an NPC switches target (prevents aggro jitter). */
export const THREAT_LOCK_MELEE = 1.1;
export const THREAT_LOCK_RANGED = 1.3;
/** Healing generates this fraction of damage threat, shared to all engaged. */
export const HEAL_THREAT_FRAC = 0.5;

export type CombatOutcome = "hit" | "crit" | "miss" | "dodge";

export interface CombatHitResult {
  outcome: CombatOutcome;
  /** Damage/heal multiplier (0 on miss/dodge). */
  mult: number;
}

/** Rating → % conversion factor grows with level (old gear loses relative value). */
export function ratingConversionFactor(level: number): number {
  const lv = Math.max(1, Math.min(60, level | 0));
  return 12 + (lv - 1) * 1.65;
}

/**
 * Soft-cap diminishing returns on secondary stats from gear (Crit/Haste/Hit/Mastery).
 * Input/output are fractions (0.30 = 30%).
 */
export function applySecondaryStatDR(rawPct: number): number {
  const x = Math.max(0, rawPct);
  const brackets: Array<{ upTo: number; efficiency: number }> = [
    { upTo: 0.3, efficiency: 1.0 },
    { upTo: 0.39, efficiency: 0.9 },
    { upTo: 0.47, efficiency: 0.8 },
    { upTo: 0.54, efficiency: 0.7 },
    { upTo: 0.66, efficiency: 0.6 },
    { upTo: Infinity, efficiency: 0.5 },
  ];
  let remaining = x;
  let prev = 0;
  let out = 0;
  for (const b of brackets) {
    const span = Math.min(remaining, b.upTo - prev);
    if (span <= 0) break;
    out += span * b.efficiency;
    remaining -= span;
    prev = b.upTo;
    if (remaining <= 1e-9) break;
  }
  return out;
}

/** Convert integer rating into a post-DR percentage contribution (fraction).
 *  `ratingConversionFactor` is ratings-per-1%, so 12 rating at L1 ≈ 1% = 0.01. */
export function ratingToPercent(rating: number, level: number): number {
  const raw = Math.max(0, rating) / ratingConversionFactor(level) / 100;
  return applySecondaryStatDR(raw);
}

/** Effective GCD length given haste as a fraction (0.2 = 20% haste). */
export function gcdDurationS(hastePct: number): number {
  return Math.max(GCD_MIN_S, GCD_BASE_S / (1 + Math.max(0, hastePct)));
}

/** Multiplier applied to cast times / spell CDs (not GCD — use gcdDurationS). */
export function hasteTimeMult(hastePct: number): number {
  return 1 / (1 + Math.max(0, hastePct));
}

/** Spell hit chance after hit rating (clamped). */
export function spellHitChance(hitPctFromStats: number): number {
  return clamp(1 - SPELL_MISS_BASE + hitPctFromStats, 1 - SPELL_MISS_BASE, 1 - SPELL_MISS_FLOOR);
}

/**
 * Two-roll spell table: (1) hit vs miss, (2) crit vs normal.
 * Used for spell damage and spell heals.
 */
export function rollSpellHit(
  hitChance: number,
  critChance: number,
  rng: () => number = Math.random,
): CombatHitResult {
  if (rng() >= hitChance) return { outcome: "miss", mult: 0 };
  if (rng() < clamp(critChance, 0, 1)) return { outcome: "crit", mult: SPELL_CRIT_MULT };
  return { outcome: "hit", mult: 1 };
}

/**
 * Simplified single-roll melee table: Miss → Dodge → Crit → Hit.
 * Slices are fixed for now (no expertise/parry/block).
 */
export function rollMeleeHit(
  critChance: number,
  rng: () => number = Math.random,
): CombatHitResult {
  const roll = rng();
  let cursor = 0;
  cursor += MELEE_MISS_CHANCE;
  if (roll < cursor) return { outcome: "miss", mult: 0 };
  cursor += MELEE_DODGE_CHANCE;
  if (roll < cursor) return { outcome: "dodge", mult: 0 };
  const critSlice = clamp(critChance, 0, 0.6);
  cursor += critSlice;
  if (roll < cursor) return { outcome: "crit", mult: MELEE_CRIT_MULT };
  return { outcome: "hit", mult: 1 };
}

/** Whether a queued ability should fire now given remaining cast/GCD time. */
export function isInSpellQueueWindow(readyAtMs: number, nowMs: number): boolean {
  return readyAtMs - nowMs <= SPELL_QUEUE_WINDOW_MS && readyAtMs > nowMs - 16;
}

/** Add threat and return whether the mob should switch to `attackerId`. */
export function shouldSwitchThreat(
  currentTargetId: string | null,
  currentThreat: number,
  challengerId: string,
  challengerThreat: number,
  ranged: boolean,
): boolean {
  if (!currentTargetId || currentTargetId === challengerId) return true;
  const lock = ranged ? THREAT_LOCK_RANGED : THREAT_LOCK_MELEE;
  return challengerThreat > currentThreat * lock;
}
