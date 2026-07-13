import { clamp } from "../math";
import { BASE_MAX_HP, BASE_MAX_MANA, HP_PER_LEVEL, MANA_PER_LEVEL } from "../constants";

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
  critChance?: number;
  moveSpeedMult?: number;
}

export interface ComputedStats {
  power: number;
  armor: number;
  agility: number;
  vitality: number;
  maxHp: number;
  maxMana: number;
  critChance: number; // 0..1
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
  const critChance = clamp(0.05 + agility * 0.006 + sumMod(mods, "critChance"), 0, 0.75);
  const moveSpeedMult = Math.max(0.1, 1 + sumMod(mods, "moveSpeedMult"));

  return { power, armor, agility, vitality, maxHp, maxMana, critChance, moveSpeedMult };
}

/** Classic diminishing-returns mitigation curve: 100 armor = 50% reduction. */
export function armorMitigation(armor: number): number {
  return 100 / (100 + Math.max(0, armor));
}
