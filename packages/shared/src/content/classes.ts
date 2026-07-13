import type { BaseStats } from "../sim/actorStats";
import type { GearSlot } from "./items";

export type ClassId = "warrior" | "mage" | "rogue" | "cleric";

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
    startingSpells: ["rend", "charge"],
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
    startingSpells: ["firebolt", "frostbolt"],
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
    startingSpells: ["backstab", "poison_strike"],
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
    startingSpells: ["heal", "smite"],
    startingGear: [
      { slot: "weapon", itemId: "blessed_mace" },
      { slot: "chest", itemId: "cloth_robe" },
    ],
  },
};

export const CLASS_IDS = Object.keys(CLASSES) as ClassId[];

export function classDef(id: string): ClassTemplate {
  const def = CLASSES[id as ClassId];
  if (!def) throw new Error(`Unknown class: ${id}`);
  return def;
}
