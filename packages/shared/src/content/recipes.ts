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
  // Mine the previous ore tier to unlock the next: base Pickaxe already
  // mines Copper/Tin/Iron, a Mithril Pickaxe (from Iron Ore) mines Mithril,
  // a Thorium Pickaxe (from Mithril Ore) mines Thorium.
  mithril_pickaxe: {
    id: "mithril_pickaxe",
    output: "mithril_pickaxe",
    outputQty: 1,
    ingredients: [
      { itemId: "iron_ore", qty: 10 },
      { itemId: "wood", qty: 15 },
      { itemId: "stone", qty: 10 },
    ],
  },
  thorium_pickaxe: {
    id: "thorium_pickaxe",
    output: "thorium_pickaxe",
    outputQty: 1,
    ingredients: [
      { itemId: "mithril_ore", qty: 10 },
      { itemId: "wood", qty: 20 },
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
  iron_sword: {
    id: "iron_sword",
    output: "iron_sword",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 15 },
      { itemId: "stone", qty: 10 },
    ],
  },
  apprentice_staff: {
    id: "apprentice_staff",
    output: "apprentice_staff",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 20 },
      { itemId: "ancient_dust", qty: 5 },
    ],
  },
  twin_daggers: {
    id: "twin_daggers",
    output: "twin_daggers",
    outputQty: 1,
    ingredients: [
      { itemId: "stone", qty: 10 },
      { itemId: "bone", qty: 5 },
    ],
  },
  blessed_mace: {
    id: "blessed_mace",
    output: "blessed_mace",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 15 },
      { itemId: "stone", qty: 8 },
    ],
  },
  hunting_bow: {
    id: "hunting_bow",
    output: "hunting_bow",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 20 },
      { itemId: "hide", qty: 5 },
    ],
  },
  grove_staff: {
    id: "grove_staff",
    output: "grove_staff",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 20 },
      { itemId: "berries", qty: 5 },
    ],
  },
  sunforged_blade: {
    id: "sunforged_blade",
    output: "sunforged_blade",
    outputQty: 1,
    ingredients: [
      { itemId: "stone", qty: 20 },
      { itemId: "ancient_dust", qty: 5 },
    ],
  },
  axe_1handed: {
    id: "axe_1handed",
    output: "axe_1handed",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 15 },
      { itemId: "stone", qty: 8 },
    ],
  },
  axe_1handed_large: {
    id: "axe_1handed_large",
    output: "axe_1handed_large",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 25 },
      { itemId: "stone", qty: 15 },
    ],
  },
  axe_2handed: {
    id: "axe_2handed",
    output: "axe_2handed",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 30 },
      { itemId: "stone", qty: 20 },
    ],
  },
  axe_2handed_large: {
    id: "axe_2handed_large",
    output: "axe_2handed_large",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 45 },
      { itemId: "stone", qty: 30 },
    ],
  },
  bow: {
    id: "bow",
    output: "bow",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 25 },
      { itemId: "hide", qty: 10 },
    ],
  },
  crossbow_1handed: {
    id: "crossbow_1handed",
    output: "crossbow_1handed",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 20 },
      { itemId: "stone", qty: 15 },
      { itemId: "hide", qty: 5 },
    ],
  },
  crossbow_2handed: {
    id: "crossbow_2handed",
    output: "crossbow_2handed",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 35 },
      { itemId: "stone", qty: 25 },
      { itemId: "hide", qty: 10 },
    ],
  },
  dagger: {
    id: "dagger",
    output: "dagger",
    outputQty: 1,
    ingredients: [
      { itemId: "stone", qty: 15 },
      { itemId: "bone", qty: 8 },
    ],
  },
  druid_staff: {
    id: "druid_staff",
    output: "druid_staff",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 30 },
      { itemId: "berries", qty: 10 },
      { itemId: "ancient_dust", qty: 5 },
    ],
  },
  wand: {
    id: "wand",
    output: "wand",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 15 },
      { itemId: "ancient_dust", qty: 8 },
    ],
  },
  shield_badge: {
    id: "shield_badge",
    output: "shield_badge",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 15 },
      { itemId: "stone", qty: 15 },
    ],
  },
  shield_round: {
    id: "shield_round",
    output: "shield_round",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 20 },
      { itemId: "stone", qty: 20 },
      { itemId: "hide", qty: 5 },
    ],
  },
  shield_square: {
    id: "shield_square",
    output: "shield_square",
    outputQty: 1,
    ingredients: [
      { itemId: "stone", qty: 40 },
      { itemId: "hide", qty: 15 },
      { itemId: "bone", qty: 10 },
    ],
  },
  shield_spikes: {
    id: "shield_spikes",
    output: "shield_spikes",
    outputQty: 1,
    ingredients: [
      { itemId: "stone", qty: 25 },
      { itemId: "bone", qty: 15 },
      { itemId: "ancient_dust", qty: 5 },
    ],
  },
  wrench: {
    id: "wrench",
    output: "wrench",
    outputQty: 1,
    ingredients: [
      { itemId: "wood", qty: 20 },
      { itemId: "stone", qty: 20 },
    ],
  },
  // Mob-drop-gated weapon upgrades -- each requires a trophy only obtained
  // by killing the associated creature, plus a mineral.
  fanged_dagger: {
    id: "fanged_dagger",
    output: "fanged_dagger",
    outputQty: 1,
    ingredients: [
      { itemId: "wolf_fang", qty: 3 },
      { itemId: "iron_ore", qty: 5 },
      { itemId: "wood", qty: 10 },
    ],
  },
  frostclaw_axe: {
    id: "frostclaw_axe",
    output: "frostclaw_axe",
    outputQty: 1,
    ingredients: [
      { itemId: "yeti_claw", qty: 2 },
      { itemId: "mithril_ore", qty: 8 },
      { itemId: "wood", qty: 15 },
    ],
  },
  runic_staff: {
    id: "runic_staff",
    output: "runic_staff",
    outputQty: 1,
    ingredients: [
      { itemId: "golem_core", qty: 1 },
      { itemId: "thorium_ore", qty: 6 },
      { itemId: "ancient_dust", qty: 10 },
    ],
  },
  demonbone_bow: {
    id: "demonbone_bow",
    output: "demonbone_bow",
    outputQty: 1,
    ingredients: [
      { itemId: "demon_horn", qty: 2 },
      { itemId: "thorium_ore", qty: 8 },
      { itemId: "hide", qty: 10 },
    ],
  },
  dragonscale_ward: {
    id: "dragonscale_ward",
    output: "dragonscale_ward",
    outputQty: 1,
    ingredients: [
      { itemId: "dragon_scale", qty: 3 },
      { itemId: "mithril_ore", qty: 10 },
    ],
  },
  peasant_hood: {
    id: "peasant_hood",
    output: "peasant_hood",
    outputQty: 1,
    ingredients: [{ itemId: "hide", qty: 8 }],
  },
  peasant_chest: {
    id: "peasant_chest",
    output: "peasant_chest",
    outputQty: 1,
    ingredients: [{ itemId: "hide", qty: 15 }],
  },
  peasant_arms: {
    id: "peasant_arms",
    output: "peasant_arms",
    outputQty: 1,
    ingredients: [{ itemId: "hide", qty: 6 }],
  },
  peasant_legs: {
    id: "peasant_legs",
    output: "peasant_legs",
    outputQty: 1,
    ingredients: [{ itemId: "hide", qty: 12 }],
  },
  peasant_feet: {
    id: "peasant_feet",
    output: "peasant_feet",
    outputQty: 1,
    ingredients: [{ itemId: "hide", qty: 8 }],
  },
  ranger_hood: {
    id: "ranger_hood",
    output: "ranger_hood",
    outputQty: 1,
    ingredients: [
      { itemId: "hide", qty: 12 },
      { itemId: "bone", qty: 4 },
    ],
  },
  ranger_chest: {
    id: "ranger_chest",
    output: "ranger_chest",
    outputQty: 1,
    ingredients: [
      { itemId: "hide", qty: 25 },
      { itemId: "bone", qty: 8 },
    ],
  },
  ranger_arms: {
    id: "ranger_arms",
    output: "ranger_arms",
    outputQty: 1,
    ingredients: [
      { itemId: "hide", qty: 10 },
      { itemId: "bone", qty: 4 },
    ],
  },
  ranger_legs: {
    id: "ranger_legs",
    output: "ranger_legs",
    outputQty: 1,
    ingredients: [
      { itemId: "hide", qty: 20 },
      { itemId: "bone", qty: 6 },
    ],
  },
  ranger_feet: {
    id: "ranger_feet",
    output: "ranger_feet",
    outputQty: 1,
    ingredients: [
      { itemId: "hide", qty: 12 },
      { itemId: "bone", qty: 4 },
    ],
  },
};
