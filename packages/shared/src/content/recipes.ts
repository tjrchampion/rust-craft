export interface RecipeDef {
  id: string;
  output: string; // item id
  outputQty: number;
  ingredients: { itemId: string; qty: number }[];
  /** Requires standing near this structure type (e.g. campfire for cooking). */
  station?: string;
}

export const RECIPES: Record<string, RecipeDef> = {
  axe: {
    id: "axe",
    output: "axe",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 30 },
      { itemId: "stone", qty: 10 },
    ],
  },
  pickaxe: {
    id: "pickaxe",
    output: "pickaxe",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 25 },
      { itemId: "stone", qty: 15 },
    ],
  },
  spear: {
    id: "spear",
    output: "spear",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 35 },
      { itemId: "stone", qty: 5 },
    ],
  },
  torch: {
    id: "torch",
    output: "torch",
    outputQty: 1,
    ingredients: [{ itemId: "wood", qty: 12 }],
  },
  campfire: {
    id: "campfire",
    output: "campfire",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 25 },
      { itemId: "stone", qty: 10 },
    ],
  },
  bandage: {
    id: "bandage",
    output: "bandage",
    outputQty: 1,
    ingredients: [{ itemId: "hide", qty: 2 }],
  },
  cooked_meat: {
    id: "cooked_meat",
    output: "cooked_meat",
    outputQty: 1,
    ingredients: [{ itemId: "raw_meat", qty: 1 }],
    station: "campfire",
  },
  tome_firebolt: {
    id: "tome_firebolt",
    output: "tome_firebolt",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 20 },
      { itemId: "stone", qty: 20 },
      { itemId: "hide", qty: 3 },
    ],
  },
  saddle: {
    id: "saddle",
    output: "saddle",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 20 },
      { itemId: "hide", qty: 8 },
    ],
  },
  raft: {
    id: "raft",
    output: "raft",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 30 },
      { itemId: "hide", qty: 2 },
    ],
  },
  minor_healing_potion: {
    id: "minor_healing_potion",
    output: "minor_healing_potion",
    outputQty: 1,
    ingredients: [
      { itemId: "berries", qty: 3 },
      { itemId: "wood", qty: 5 },
    ],
  },
  runic_healing_potion: {
    id: "runic_healing_potion",
    output: "runic_healing_potion",
    outputQty: 1,
    ingredients: [
      { itemId: "berries", qty: 10 },
      { itemId: "ancient_dust", qty: 5 },
    ],
  },
  minor_mana_potion: {
    id: "minor_mana_potion",
    output: "minor_mana_potion",
    outputQty: 1,
    ingredients: [
      { itemId: "ancient_dust", qty: 5 },
    ],
  },
  runic_mana_potion: {
    id: "runic_mana_potion",
    output: "runic_mana_potion",
    outputQty: 1,
    ingredients: [
      { itemId: "ancient_dust", qty: 10 },
      { itemId: "bone", qty: 5 },
    ],
  },
  frontline_potion: {
    id: "frontline_potion",
    output: "frontline_potion",
    outputQty: 1,
    ingredients: [
      { itemId: "stone", qty: 10 },
      { itemId: "hide", qty: 2 },
    ],
  },
  potion_focus: {
    id: "potion_focus",
    output: "potion_focus",
    outputQty: 1,
    ingredients: [
      { itemId: "bone", qty: 5 },
      { itemId: "ancient_dust", qty: 5 },
    ],
  },
  invisibility_potion: {
    id: "invisibility_potion",
    output: "invisibility_potion",
    outputQty: 1,
    ingredients: [
      { itemId: "ancient_dust", qty: 5 },
      { itemId: "hide", qty: 3 },
    ],
  },
  free_action_potion: {
    id: "free_action_potion",
    output: "free_action_potion",
    outputQty: 1,
    ingredients: [
      { itemId: "berries", qty: 8 },
      { itemId: "hide", qty: 5 },
    ],
  },
  flask_titan: {
    id: "flask_titan",
    output: "flask_titan",
    outputQty: 1,
    ingredients: [
      { itemId: "stone", qty: 20 },
      { itemId: "bone", qty: 10 },
      { itemId: "ancient_dust", qty: 5 },
    ],
  },
  phial_quickness: {
    id: "phial_quickness",
    output: "phial_quickness",
    outputQty: 1,
    ingredients: [
      { itemId: "berries", qty: 15 },
      { itemId: "hide", qty: 15 },
      { itemId: "ancient_dust", qty: 5 },
    ],
  },
};
