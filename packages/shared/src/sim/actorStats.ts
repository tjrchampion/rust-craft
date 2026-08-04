import { clamp } from "../math";
import { BASE_MAX_HP, BASE_MAX_MANA, HP_PER_LEVEL, MANA_PER_LEVEL } from "../constants";
import { gcdDurationS, ratingToPercent, spellHitChance } from "./combat";

/**
 * The four base stats every actor (player, NPC, mob) is built from. Classes
 * assign these at character creation; nothing here is ever persisted —
 * `computeActorStats` recombines base + level growth + gear + auras fresh
 * every time it's called.
 */
export interface BaseStats {
  power: number; // scales spell/melee damage and healing
  armor: number; // reduces incoming damage
  agility: number; // scales crit chance
  vitality: number; // scales bonus max HP
}

/** A modifier contribution from one piece of gear or one active aura. */
export interface StatModifiers {
  power?: number;
  armor?: number;
  agility?: number;
  vitality?: number;
  maxHp?: number;
  maxMana?: number;
  /** Flat crit chance fraction (legacy / auras). Stacks with critRating. */
  critChance?: number;
  moveSpeedMult?: number;
  /** Integer secondary ratings — converted via level scaling + soft-cap DR. */
  critRating?: number;
  hasteRating?: number;
  hitRating?: number;
  masteryRating?: number;
}

export interface ComputedStats {
  power: number;
  armor: number;
  agility: number;
  vitality: number;
  maxHp: number;
  maxMana: number;
  /** Final crit chance 0..1 (agility + flat + rating after DR). */
  critChance: number;
  /** Haste as a fraction (0.2 = 20%) after rating DR. */
  hastePct: number;
  /** Spell hit chance 0..1 after hit rating. */
  hitChance: number;
  /** Mastery as a fraction — class-agnostic damage/heal amp for now. */
  masteryPct: number;
  /** Effective GCD length in seconds for this actor. */
  gcdS: number;
  moveSpeedMult: number;
}

function sumMod(mods: StatModifiers[], key: keyof StatModifiers): number {
  return mods.reduce((n, m) => n + (m[key] ?? 0), 0);
}

/**
 * The dynamic stat calculation engine: (base + level growth) + gear + auras,
 * computed on demand. Nothing this function outputs should ever be written
 * to the database — only `BaseStats` (from the class template) and level
 * are persisted; gear and auras are looked up and summed fresh each call.
 */
export function computeActorStats(
  base: BaseStats,
  level: number,
  gearMods: StatModifiers[],
  auraMods: StatModifiers[],
): ComputedStats {
  const mods = [...gearMods, ...auraMods];
  const growth = level - 1;

  const power = base.power + growth * 0.8 + sumMod(mods, "power");
  const armor = base.armor + growth * 0.4 + sumMod(mods, "armor");
  const agility = base.agility + growth * 0.3 + sumMod(mods, "agility");
  const vitality = base.vitality + growth * 0.6 + sumMod(mods, "vitality");

  const maxHp = BASE_MAX_HP + HP_PER_LEVEL * growth + vitality * 4 + sumMod(mods, "maxHp");
  const maxMana = BASE_MAX_MANA + MANA_PER_LEVEL * growth + sumMod(mods, "maxMana");

  const critFromRating = ratingToPercent(sumMod(mods, "critRating"), level);
  const hastePct = ratingToPercent(sumMod(mods, "hasteRating"), level);
  const hitFromRating = ratingToPercent(sumMod(mods, "hitRating"), level);
  const masteryPct = ratingToPercent(sumMod(mods, "masteryRating"), level);

  const critChance = clamp(
    0.05 + agility * 0.006 + sumMod(mods, "critChance") + critFromRating,
    0,
    0.75,
  );
  const hitChance = spellHitChance(hitFromRating);
  const moveSpeedMult = Math.max(0.1, 1 + sumMod(mods, "moveSpeedMult"));
  const gcdS = gcdDurationS(hastePct);

  return {
    power,
    armor,
    agility,
    vitality,
    maxHp,
    maxMana,
    critChance,
    hastePct,
    hitChance,
    masteryPct,
    gcdS,
    moveSpeedMult,
  };
}

/**
 * Classic diminishing-returns mitigation curve: 100 armor = 50% reduction.
 * EHP grows linearly with armor even as % DR soft-caps.
 */
export function armorMitigation(armor: number): number {
  return 100 / (100 + Math.max(0, armor));
}

/** Effective health vs physical for a given HP + armor pool. */
export function effectiveHealth(hp: number, armor: number): number {
  return hp * (1 + Math.max(0, armor) / 100);
}
