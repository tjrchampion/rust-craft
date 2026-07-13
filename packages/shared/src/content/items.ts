export type ItemType = "resource" | "tool" | "weapon" | "consumable" | "placeable" | "tome";

export interface ItemDef {
  id: string;
  name: string;
  type: ItemType;
  stack: number;
  /** Melee damage when held (tools double as weak weapons). */
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
};

export function itemDef(id: string): ItemDef {
  const def = ITEMS[id];
  if (!def) throw new Error(`Unknown item: ${id}`);
  return def;
}
