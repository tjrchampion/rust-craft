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
  /** While active, blocks the afflicted player from starting a new cast. */
  silences?: boolean;
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
    statModifiers: { power: 4, moveSpeedMult: 0.15, critChance: 0.15 },
    icon: "⚔️",
    positive: true,
  },
  burning: {
    id: "burning",
    name: "Burning",
    durationS: 6,
    tickIntervalS: 2,
    tick: { type: "damage", base: 4, powerScale: 0.35, damageType: "fire" },
    icon: "🔥",
    positive: false,
  },
  arcane_silence: {
    id: "arcane_silence",
    name: "Silenced",
    durationS: 2.5,
    silences: true,
    icon: "🔇",
    positive: false,
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
  holy_burn: {
    id: "holy_burn",
    name: "Holy Burn",
    durationS: 6,
    tickIntervalS: 2,
    tick: { type: "damage", base: 3, powerScale: 0.35, damageType: "holy" },
    icon: "🔥",
    positive: false,
  },
  renew: {
    id: "renew",
    name: "Renew",
    durationS: 10,
    tickIntervalS: 2,
    tick: { type: "heal", base: 5, powerScale: 0.7 },
    icon: "💫",
    positive: true,
  },
  moonfire_burn: {
    id: "moonfire_burn",
    name: "Moonfire",
    durationS: 8,
    tickIntervalS: 2,
    tick: { type: "damage", base: 3, powerScale: 0.4, damageType: "arcane" },
    icon: "🌙",
    positive: false,
  },
  entangled: {
    id: "entangled",
    name: "Entangled",
    durationS: 5,
    statModifiers: { moveSpeedMult: -0.6 },
    icon: "🌱",
    positive: false,
  },
  shield_wall: {
    id: "shield_wall",
    name: "Shield Wall",
    durationS: 6,
    statModifiers: { armor: 12 },
    icon: "🛡️",
    positive: true,
  },
  holy_shield: {
    id: "holy_shield",
    name: "Holy Shield",
    durationS: 6,
    statModifiers: { armor: 8, vitality: 3 },
    icon: "🛡️",
    positive: true,
  },
  /** Lasts as long as the summoned wolf is alive, not a fixed time -- the
   *  server clears it explicitly (removeAura) the moment the pet dies or
   *  its owner disconnects, rather than letting it time out on its own. */
  beast_mastery_buff: {
    id: "beast_mastery_buff",
    name: "Beast Mastery",
    durationS: 24 * 60 * 60,
    statModifiers: { power: 4 },
    icon: "🐺",
    positive: true,
  },
};

export function auraDef(id: string): AuraDef {
  const def = AURAS[id];
  if (!def) throw new Error(`Unknown aura: ${id}`);
  return def;
}
