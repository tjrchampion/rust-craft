import type { StatModifiers } from "../sim/actorStats";
import type { DamageType } from "./spells";

export interface AuraTick {
  type: "damage" | "heal";
  base: number;
  powerScale?: number;
  damageType?: DamageType;
}

export interface AuraDef {
  id: string;
  name: string;
  durationS: number;
  /** If set, `tick` fires once every this many seconds for the aura's duration. */
  tickIntervalS?: number;
  tick?: AuraTick;
  /** Passive stat modifiers applied for as long as the aura is active. */
  statModifiers?: StatModifiers;
  icon: string;
  /** Buff (heal/haste) vs debuff (DoT/slow) -- drives HUD coloring. */
  positive: boolean;
}

export const AURAS: Record<string, AuraDef> = {
  chilled: {
    id: "chilled",
    name: "Chilled",
    durationS: 4,
    statModifiers: { moveSpeedMult: -0.3 },
    icon: "❄️",
    positive: false,
  },
  bleeding: {
    id: "bleeding",
    name: "Bleeding",
    durationS: 6,
    tickIntervalS: 2,
    tick: { type: "damage", base: 3, powerScale: 0.3, damageType: "physical" },
    icon: "🩸",
    positive: false,
  },
  poisoned: {
    id: "poisoned",
    name: "Poisoned",
    durationS: 6,
    tickIntervalS: 2,
    tick: { type: "damage", base: 2, powerScale: 0.25, damageType: "nature" },
    icon: "☠️",
    positive: false,
  },
  battle_fury: {
    id: "battle_fury",
    name: "Battle Fury",
    durationS: 6,
    statModifiers: { power: 4, moveSpeedMult: 0.15 },
    icon: "⚔️",
    positive: true,
  },
  regrowth: {
    id: "regrowth",
    name: "Regrowth",
    durationS: 8,
    tickIntervalS: 2,
    tick: { type: "heal", base: 4, powerScale: 0.6 },
    icon: "🌿",
    positive: true,
  },
  divine_favor: {
    id: "divine_favor",
    name: "Divine Favor",
    durationS: 6,
    statModifiers: { armor: 5, power: 2 },
    icon: "✨",
    positive: true,
  },
};

export function auraDef(id: string): AuraDef {
  const def = AURAS[id];
  if (!def) throw new Error(`Unknown aura: ${id}`);
  return def;
}
