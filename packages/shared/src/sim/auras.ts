import { auraDef, type AuraTick } from "../content/auras";
import type { StatModifiers } from "./actorStats";

export interface ActiveAura {
  auraId: string;
  appliedAt: number; // ms
  expiresAt: number; // ms
  nextTickAt: number; // ms; Infinity if the aura has no periodic tick
  sourceId: string; // who applied it -- attribution for DoT kill credit
}

/** Apply (or refresh) an aura. Reapplying resets duration rather than stacking. */
export function applyAura(actives: ActiveAura[], auraId: string, sourceId: string, now: number): ActiveAura[] {
  const def = auraDef(auraId);
  const kept = actives.filter((a) => a.auraId !== auraId);
  kept.push({
    auraId,
    appliedAt: now,
    expiresAt: now + def.durationS * 1000,
    nextTickAt: def.tickIntervalS ? now + def.tickIntervalS * 1000 : Infinity,
    sourceId,
  });
  return kept;
}

/** Drop auras whose duration has elapsed. */
export function expireAuras(actives: ActiveAura[], now: number): ActiveAura[] {
  return actives.filter((a) => a.expiresAt > now);
}

/** Explicitly drop an aura before its timer would naturally expire it --
 *  e.g. clearing a pet's damage buff the instant the pet dies. */
export function removeAura(actives: ActiveAura[], auraId: string): ActiveAura[] {
  return actives.filter((a) => a.auraId !== auraId);
}

/** Every active aura's passive stat contribution, for computeActorStats. */
export function aggregateAuraModifiers(actives: ActiveAura[]): StatModifiers[] {
  return actives.map((a) => auraDef(a.auraId).statModifiers ?? {});
}

/** Combined movement speed multiplier from all active auras (e.g. -1.0 for frozen = 0). */
export function moveSpeedMultFromAuras(actives: ActiveAura[]): number {
  let mult = 1.0;
  for (const a of actives) {
    const mods = auraDef(a.auraId).statModifiers;
    if (mods?.moveSpeedMult !== undefined) {
      mult *= Math.max(0, 1 + mods.moveSpeedMult);
    }
  }
  return mult;
}

export interface DueTick {
  aura: ActiveAura;
  tick: AuraTick;
}

/** Auras whose periodic tick is due at `now`, advancing each one's nextTickAt in place. */
export function collectDueTicks(actives: ActiveAura[], now: number): DueTick[] {
  const due: DueTick[] = [];
  for (const a of actives) {
    const def = auraDef(a.auraId);
    if (!def.tick || !def.tickIntervalS) continue;
    if (now >= a.nextTickAt) {
      due.push({ aura: a, tick: def.tick });
      a.nextTickAt += def.tickIntervalS * 1000;
    }
  }
  return due;
}
