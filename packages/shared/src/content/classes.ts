import type { BaseStats } from "../sim/actorStats";
import type { GearSlot } from "./items";

export type ClassId = "warrior" | "mage" | "rogue" | "cleric" | "ranger" | "druid" | "paladin";

/**
 * Classes are pure data blueprints applied ONLY at character creation --
 * they hand out a starting BaseStats block, spell list, and gear loadout.
 * Nothing about "being a warrior" is checked at runtime; the character is
 * just an Actor with the stats/spells/gear the template happened to grant.
 */
export interface ClassTemplate {
  id: ClassId;
  name: string;
  description: string;
  /** Display label only -- the underlying resource pool is still `mana`. */
  resourceLabel: string;
  baseStats: BaseStats;
  startingSpells: string[];
  startingGear: { slot: GearSlot; itemId: string }[];
}

export const CLASSES: Record<ClassId, ClassTemplate> = {
  warrior: {
    id: "warrior",
    name: "Warrior",
    description: "A frontline fighter who trades spells for raw steel and grit.",
    resourceLabel: "Stamina",
    baseStats: { power: 8, armor: 10, agility: 4, vitality: 8 },
    startingSpells: ["rend", "charge", "heal", "whirlwind", "execute", "shield_wall"],
    startingGear: [
      { slot: "weapon", itemId: "iron_sword" },
      { slot: "chest", itemId: "leather_armor" },
    ],
  },
  mage: {
    id: "mage",
    name: "Mage",
    description: "Channels elemental power at range, fragile up close.",
    resourceLabel: "Mana",
    baseStats: { power: 10, armor: 2, agility: 3, vitality: 4 },
    startingSpells: ["firebolt", "frostbolt", "heal", "flame_nova", "arcane_blast", "blizzard"],
    startingGear: [
      { slot: "weapon", itemId: "apprentice_staff" },
      { slot: "chest", itemId: "cloth_robe" },
    ],
  },
  rogue: {
    id: "rogue",
    name: "Rogue",
    description: "Fast and precise, striking hardest from the shadows.",
    resourceLabel: "Energy",
    baseStats: { power: 7, armor: 4, agility: 10, vitality: 5 },
    startingSpells: ["backstab", "poison_strike", "heal", "fan_of_knives", "eviscerate", "garrote"],
    startingGear: [
      { slot: "weapon", itemId: "twin_daggers" },
      { slot: "chest", itemId: "leather_armor" },
    ],
  },
  cleric: {
    id: "cleric",
    name: "Cleric",
    description: "A healer who mends allies and smites the wicked.",
    resourceLabel: "Mana",
    baseStats: { power: 8, armor: 5, agility: 3, vitality: 6 },
    startingSpells: ["heal", "smite", "circle_of_healing", "holy_fire", "renew"],
    startingGear: [
      { slot: "weapon", itemId: "blessed_mace" },
      { slot: "chest", itemId: "cloth_robe" },
    ],
  },
  ranger: {
    id: "ranger",
    name: "Ranger",
    description: "A keen-eyed hunter who strikes from afar with bow and blade.",
    resourceLabel: "Focus",
    baseStats: { power: 9, armor: 3, agility: 9, vitality: 5 },
    startingSpells: ["quick_shot", "piercing_shot", "heal", "volley", "aimed_shot", "serpent_sting", "beast_mastery"],
    startingGear: [
      { slot: "weapon", itemId: "hunting_bow" },
      { slot: "chest", itemId: "leather_armor" },
    ],
  },
  druid: {
    id: "druid",
    name: "Druid",
    description: "A shaper of growth and decay, mending allies and calling down nature's wrath.",
    resourceLabel: "Harmony",
    baseStats: { power: 8, armor: 4, agility: 5, vitality: 6 },
    startingSpells: ["wrath", "regrowth", "heal", "thorn_burst", "moonfire", "entangling_roots"],
    startingGear: [
      { slot: "weapon", itemId: "grove_staff" },
      { slot: "chest", itemId: "cloth_robe" },
    ],
  },
  paladin: {
    id: "paladin",
    name: "Paladin",
    description: "A holy knight who smites foes up close and shields allies with faith.",
    resourceLabel: "Faith",
    baseStats: { power: 8, armor: 8, agility: 4, vitality: 9 },
    startingSpells: ["crusader_strike", "divine_favor", "heal", "consecration", "hammer_of_wrath", "holy_shield"],
    startingGear: [
      { slot: "weapon", itemId: "sunforged_blade" },
      { slot: "chest", itemId: "leather_armor" },
    ],
  },
};

export const CLASS_IDS = Object.keys(CLASSES) as ClassId[];

export function classDef(id: string): ClassTemplate {
  const def = CLASSES[id as ClassId];
  if (!def) throw new Error(`Unknown class: ${id}`);
  return def;
}
