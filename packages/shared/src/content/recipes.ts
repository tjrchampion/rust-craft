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
};
