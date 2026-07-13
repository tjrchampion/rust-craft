import type { StatModifiers } from "../sim/actorStats";

export type ItemType = "resource" | "tool" | "weapon" | "consumable" | "placeable" | "tome" | "gear";

/** Equip-slot gear is a separate container from the hotbar (see protocol.ts's
 *  container enum) — it feeds passive stat modifiers into the dynamic stat
 *  calculation engine rather than being "held" for melee damage. */
export type GearSlot = "weapon" | "head" | "chest";

/** Fixed equip-slot indices -- slot 0 is always the weapon, etc. */
export const EQUIP_SLOTS: GearSlot[] = ["weapon", "head", "chest"];

export interface ItemDef {
  id: string;
  name: string;
  type: ItemType;
  stack: number;
  /** Melee damage when held in the hotbar (tools double as weak weapons). */
  damage?: number;
  /** Gather effectiveness against node classes. */
  gatherPower?: { wood?: number; stone?: number };
  maxDurability?: number;
  /** Consumable effects. */
  restore?: { hp?: number; hunger?: number; thirst?: number };
  /** Tome: spell taught on use. */
  teachesSpell?: string;
  /** Placeable: structure type created. */
  placesStructure?: string;
  /** Gear: which equip slot this occupies. */
  slot?: GearSlot;
  /** Gear: passive stat modifiers applied while equipped in `slot`. */
  statModifiers?: StatModifiers;
}

export const ITEMS: Record<string, ItemDef> = {
  wood: { id: "wood", name: "Wood", type: "resource", stack: 100 },
  stone: { id: "stone", name: "Stone", type: "resource", stack: 100 },
  hide: { id: "hide", name: "Animal Hide", type: "resource", stack: 50 },
  bone: { id: "bone", name: "Bone", type: "resource", stack: 100 },
  ancient_dust: { id: "ancient_dust", name: "Ancient Dust", type: "resource", stack: 100 },
  berries: {
    id: "berries",
    name: "Berries",
    type: "consumable",
    stack: 50,
    restore: { hunger: 12, thirst: 4 },
  },
  raw_meat: {
    id: "raw_meat",
    name: "Raw Meat",
    type: "consumable",
    stack: 20,
    restore: { hunger: 10 },
  },
  cooked_meat: {
    id: "cooked_meat",
    name: "Cooked Meat",
    type: "consumable",
    stack: 20,
    restore: { hunger: 40 },
  },
  bandage: {
    id: "bandage",
    name: "Bandage",
    type: "consumable",
    stack: 10,
    restore: { hp: 30 },
  },
  axe: {
    id: "axe",
    name: "Stone Axe",
    type: "tool",
    stack: 1,
    damage: 12,
    gatherPower: { wood: 4 },
    maxDurability: 120,
  },
  pickaxe: {
    id: "pickaxe",
    name: "Stone Pickaxe",
    type: "tool",
    stack: 1,
    damage: 10,
    gatherPower: { stone: 4 },
    maxDurability: 120,
  },
  spear: {
    id: "spear",
    name: "Wooden Spear",
    type: "weapon",
    stack: 1,
    damage: 24,
    maxDurability: 80,
  },
  torch: {
    id: "torch",
    name: "Torch",
    type: "tool",
    stack: 1,
    damage: 5,
    maxDurability: 100,
  },
  campfire: {
    id: "campfire",
    name: "Campfire",
    type: "placeable",
    stack: 5,
    placesStructure: "campfire",
  },
  tome_firebolt: {
    id: "tome_firebolt",
    name: "Tome: Firebolt",
    type: "tome",
    stack: 1,
    teachesSpell: "firebolt",
  },
  saddle: {
    id: "saddle",
    name: "Riding Saddle",
    type: "tool",
    stack: 1,
  },
  raft: {
    id: "raft",
    name: "Raft",
    type: "tool",
    stack: 1,
  },

  // Class starter gear -- equipped (not held), feeds passive stat modifiers.
  iron_sword: {
    id: "iron_sword",
    name: "Iron Sword",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { power: 3, agility: 1 },
  },
  apprentice_staff: {
    id: "apprentice_staff",
    name: "Apprentice Staff",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { power: 4 },
  },
  twin_daggers: {
    id: "twin_daggers",
    name: "Twin Daggers",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { agility: 4, critChance: 0.03 },
  },
  blessed_mace: {
    id: "blessed_mace",
    name: "Blessed Mace",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { power: 3, vitality: 1 },
  },
  leather_armor: {
    id: "leather_armor",
    name: "Leather Armor",
    type: "gear",
    stack: 1,
    slot: "chest",
    statModifiers: { armor: 6, vitality: 1 },
  },
  cloth_robe: {
    id: "cloth_robe",
    name: "Cloth Robe",
    type: "gear",
    stack: 1,
    slot: "chest",
    statModifiers: { armor: 2, power: 2 },
  },
};

export function itemDef(id: string): ItemDef {
  const def = ITEMS[id];
  if (!def) throw new Error(`Unknown item: ${id}`);
  return def;
}
