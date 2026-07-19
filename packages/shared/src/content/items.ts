import type { StatModifiers } from "../sim/actorStats";

export type ItemType = "resource" | "tool" | "weapon" | "consumable" | "placeable" | "tome" | "gear";

/** Equip-slot gear is a separate container from the hotbar (see protocol.ts's
 *  container enum) — it feeds passive stat modifiers into the dynamic stat
 *  calculation engine rather than being "held" for melee damage. */
export type GearSlot = "weapon" | "head" | "chest" | "arms" | "legs" | "feet";

/** Fixed equip-slot indices -- slot 0 is always the weapon, etc. */
export const EQUIP_SLOTS: GearSlot[] = ["weapon", "head", "chest", "arms", "legs", "feet"];

export interface ItemDef {
  id: string;
  name: string;
  type: ItemType;
  stack: number;
  /** Melee damage when held in the hotbar (tools double as weak weapons). */
  damage?: number;
  /** Gather effectiveness against node classes. */
  gatherPower?: { wood?: number; stone?: number; ore?: number };
  maxDurability?: number;
  /** Consumable effects. */
  restore?: { hp?: number; mana?: number; hunger?: number; thirst?: number };
  applyAuraOnConsume?: string;
  /** Tome: spell taught on use. */
  teachesSpell?: string;
  /** Placeable: structure type created. */
  placesStructure?: string;
  /** Gear: which equip slot this occupies. */
  slot?: GearSlot;
  /** Gear: passive stat modifiers applied while equipped in `slot`. */
  statModifiers?: StatModifiers;
  /** Gear (weapon slot only): GLTF node name(s) to show on the wearer's rig
   *  while equipped — e.g. ["Knife","Knife_Offhand"] for twin daggers. */
  weaponModel?: string[];
  /** Gear (weapon slot only): a separate prop GLTF to attach onto a named
   *  hand-socket bone, for weapons not baked into the wearer's own rig
   *  (e.g. the Ranger's bow — Ranger.glb ships without one, unlike every
   *  other class's rig which already bundles all its weapon variants). */
  weaponProp?: { url: string; bone: string };
  /** Gear (weapon slot only): override clip(s) for the basic melee swing
   *  while this weapon is equipped, e.g. a dual-wield chop for twin daggers. */
  attackAnim?: string[];
  /** Gear (weapon slot only): override clip(s) for spellcasting while this
   *  weapon is equipped, e.g. a bow draw-and-loose instead of hand-waving. */
  castAnim?: string[];
}

// Shared attackAnim/castAnim fallback chains, reused across every weapon of a
// given type -- new (KayKit Character Animations 1.1 library) clip names
// first, old (still-baked Paladin.glb) names last, plus both rig-size
// variants where they differ, since findAction() just tries each name in
// order and silently skips whichever aren't loaded on a given rig.
const DUALWIELD_ATTACK = [
  "Melee_Dualwield_Attack_Chop",
  "Melee_Dualwield_Attack_Slice",
  "Melee_Dualwield_Slash",
  "Melee_Dualwield_SlashCombo",
  "Dualwield_Melee_Attack_Chop",
];
const AXE_1H_ATTACK = ["Melee_1H_Attack_Chop", "1H_Melee_Attack_Chop", "Melee_1H_Attack_Slice_Horizontal"];
const AXE_2H_ATTACK = ["Melee_2H_Attack_Chop", "Melee_2H_Attack_Slice", "Melee_2H_Attack", "2H_Melee_Attack_Chop"];
const GREATAXE_ATTACK = ["Melee_2H_Slam", "Melee_2H_Attack", "Melee_2H_Attack_Chop", "2H_Melee_Attack_Chop"];
const STAFF_ATTACK = ["Melee_2H_Attack_Chop", "Melee_2H_Attack_Slice", "2H_Melee_Attack_Chop"];
const BOW_CAST = ["Ranged_Bow_Release", "Ranged_2H_Shoot", "2H_Ranged_Shoot"];

export const ITEMS: Record<string, ItemDef> = {
  wood: { id: "wood", name: "Wood", type: "resource", stack: 100 },
  stone: { id: "stone", name: "Stone", type: "resource", stack: 100 },
  hide: { id: "hide", name: "Animal Hide", type: "resource", stack: 50 },
  bone: { id: "bone", name: "Bone", type: "resource", stack: 100 },
  ancient_dust: { id: "ancient_dust", name: "Ancient Dust", type: "resource", stack: 100 },
  // Mining ores -- tier 0-4, matching the game's existing Trivial..Elite
  // scale (see TIER_NAMES in content/quests.ts). Each tier's pickaxe unlocks
  // the next: base Pickaxe mines Copper/Tin/Iron, a Mithril Pickaxe (crafted
  // from Iron Ore) mines Mithril, a Thorium Pickaxe (crafted from Mithril
  // Ore) mines Thorium -- Thorium Veins only spawn in Ashenpeak.
  copper_ore: { id: "copper_ore", name: "Copper Ore", type: "resource", stack: 100 },
  tin_ore: { id: "tin_ore", name: "Tin Ore", type: "resource", stack: 100 },
  iron_ore: { id: "iron_ore", name: "Iron Ore", type: "resource", stack: 100 },
  mithril_ore: { id: "mithril_ore", name: "Mithril Ore", type: "resource", stack: 100 },
  thorium_ore: { id: "thorium_ore", name: "Thorium Ore", type: "resource", stack: 100 },
  // Rare bonus veins -- never their own node, just a small chance alongside
  // the base ore they're classically found with (copper/iron).
  silver_ore: { id: "silver_ore", name: "Silver Ore", type: "resource", stack: 100 },
  gold_ore: { id: "gold_ore", name: "Gold Ore", type: "resource", stack: 100 },
  // Mob-drop trophies -- never gathered or sold, only obtained by killing
  // the associated creature, and consumed by exactly one weapon recipe
  // each (see recipes.ts).
  wolf_fang: { id: "wolf_fang", name: "Wolf Fang", type: "resource", stack: 20 },
  yeti_claw: { id: "yeti_claw", name: "Yeti Claw", type: "resource", stack: 20 },
  golem_core: { id: "golem_core", name: "Golem Core", type: "resource", stack: 20 },
  demon_horn: { id: "demon_horn", name: "Demon Horn", type: "resource", stack: 20 },
  dragon_scale: { id: "dragon_scale", name: "Dragon Scale", type: "resource", stack: 20 },
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
    gatherPower: { stone: 4, ore: 1 },
    maxDurability: 120,
  },
  mithril_pickaxe: {
    id: "mithril_pickaxe",
    name: "Mithril Pickaxe",
    type: "tool",
    stack: 1,
    damage: 14,
    gatherPower: { stone: 4, ore: 2 },
    maxDurability: 150,
  },
  thorium_pickaxe: {
    id: "thorium_pickaxe",
    name: "Thorium Pickaxe",
    type: "tool",
    stack: 1,
    damage: 18,
    gatherPower: { stone: 4, ore: 3 },
    maxDurability: 180,
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
    // Warrior's rig (Barbarian.glb) has no sword mesh, only axes.
    weaponModel: ["2H_Axe"],
    weaponProp: { url: "/assets/models/props/sword_1handed.glb", bone: "handslotr" },
  },
  apprentice_staff: {
    id: "apprentice_staff",
    name: "Apprentice Staff",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { power: 4 },
    weaponModel: ["2H_Staff"],
    weaponProp: { url: "/assets/models/props/staff.glb", bone: "handslotr" },
    attackAnim: STAFF_ATTACK,
  },
  twin_daggers: {
    id: "twin_daggers",
    name: "Twin Daggers",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { agility: 4, critChance: 0.03 },
    weaponModel: ["Knife", "Knife_Offhand"],
    weaponProp: { url: "/assets/models/props/dagger.gltf", bone: "handslotr" },
    attackAnim: DUALWIELD_ATTACK,
  },
  blessed_mace: {
    id: "blessed_mace",
    name: "Blessed Mace",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { power: 3, vitality: 1 },
    // Cleric's rig (Knight.glb) has no mace mesh, only swords/shields.
    weaponModel: ["1H_Sword", "Round_Shield"],
    weaponProp: { url: "/assets/models/props/sword_1handed.glb", bone: "handslotr" },
  },
  hunting_bow: {
    id: "hunting_bow",
    name: "Hunting Bow",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { agility: 4, critChance: 0.04 },
    // Ranger.glb doesn't bundle a bow mesh like the other rigs bundle their
    // weapons — attach the pack's standalone bow prop onto the left hand.
    // Note: THREE's GLTFLoader strips "." from node names (it's a reserved
    // separator in animation property-path syntax), so the bone is named
    // "handslotl" at runtime even though the source glTF calls it "handslot.l".
    weaponProp: { url: "/assets/models/props/bow_withString.glb", bone: "handslotl" },
    castAnim: BOW_CAST,
  },
  grove_staff: {
    id: "grove_staff",
    name: "Grove Staff",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { power: 3, vitality: 1 },
    // Druid.glb, like Ranger.glb, bundles no baked-in weapon variants --
    // attach the pack's standalone staff prop onto the right hand.
    weaponProp: { url: "/assets/models/props/staff.glb", bone: "handslotr" },
    attackAnim: STAFF_ATTACK,
  },
  sunforged_blade: {
    id: "sunforged_blade",
    name: "Sunforged Blade",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { power: 3, vitality: 2 },
    // Paladin.glb bundles no baked-in weapon variants either -- attach the
    // pack's standalone one-handed sword prop onto the right hand.
    weaponProp: { url: "/assets/models/props/sword_1handed.glb", bone: "handslotr" },
  },
  axe_1handed: {
    id: "axe_1handed",
    name: "One-Handed Axe",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { power: 3, agility: 1 },
    weaponModel: ["1H_Axe"],
    weaponProp: { url: "/assets/models/props/axe_1handed.gltf", bone: "handslotr" },
    attackAnim: AXE_1H_ATTACK,
  },
  axe_1handed_large: {
    id: "axe_1handed_large",
    name: "Large One-Handed Axe",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { power: 5, agility: 1, vitality: 1 },
    weaponModel: ["1H_Axe_Offhand"],
    weaponProp: { url: "/assets/models/props/axe_1handed_Large.gltf", bone: "handslotr" },
    attackAnim: AXE_1H_ATTACK,
  },
  axe_2handed: {
    id: "axe_2handed",
    name: "Great Axe",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { power: 6, agility: 2 },
    weaponModel: ["2H_Axe"],
    weaponProp: { url: "/assets/models/props/axe_2handed.gltf", bone: "handslotr" },
    attackAnim: AXE_2H_ATTACK,
  },
  axe_2handed_large: {
    id: "axe_2handed_large",
    name: "Behemoth Axe",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { power: 9, agility: 3, vitality: 2 },
    // Berserker's starting weapon -- the only Large-rig (Barbarian_Large.glb)
    // gear, hence the Rig_Large clip names taking priority in GREATAXE_ATTACK.
    weaponModel: ["2H_Axe"],
    weaponProp: { url: "/assets/models/props/axe_2handed_Large.gltf", bone: "handslotr" },
    attackAnim: GREATAXE_ATTACK,
  },
  bow: {
    id: "bow",
    name: "Recurve Bow",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { agility: 5, critChance: 0.04 },
    weaponProp: { url: "/assets/models/props/bow.gltf", bone: "handslotl" },
    castAnim: BOW_CAST,
  },
  crossbow_1handed: {
    id: "crossbow_1handed",
    name: "Hand Crossbow",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { agility: 3, critChance: 0.02 },
    weaponModel: ["1H_Crossbow"],
    weaponProp: { url: "/assets/models/props/crossbow_1handed.gltf", bone: "handslotr" },
    castAnim: ["Ranged_1H_Shoot", "Ranged_1H_Shooting"],
  },
  crossbow_2handed: {
    id: "crossbow_2handed",
    name: "Heavy Crossbow",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { agility: 7, critChance: 0.06 },
    weaponModel: ["2H_Crossbow"],
    weaponProp: { url: "/assets/models/props/crossbow_2handed.gltf", bone: "handslotr" },
    castAnim: ["Ranged_2H_Shoot", "Ranged_2H_Shooting"],
  },
  dagger: {
    id: "dagger",
    name: "Assassin's Dagger",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { agility: 5, critChance: 0.05 },
    weaponModel: ["Knife", "Knife_Offhand"],
    weaponProp: { url: "/assets/models/props/dagger.gltf", bone: "handslotr" },
    attackAnim: DUALWIELD_ATTACK,
  },
  druid_staff: {
    id: "druid_staff",
    name: "Druid Staff",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { power: 5, vitality: 3 },
    weaponModel: ["2H_Staff"],
    weaponProp: { url: "/assets/models/props/druid_staff.gltf", bone: "handslotr" },
    attackAnim: STAFF_ATTACK,
  },
  wand: {
    id: "wand",
    name: "Sorcerer's Wand",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { power: 4, agility: 2 },
    weaponModel: ["1H_Wand"],
    weaponProp: { url: "/assets/models/props/wand.gltf", bone: "handslotr" },
    // A quick punchy raise-and-shoot, distinct from a staff's channeled cast.
    castAnim: ["Ranged_Magic_Shoot", "Ranged_Magic_Raise"],
  },
  shield_badge: {
    id: "shield_badge",
    name: "Badge Shield",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { armor: 6, vitality: 3 },
    weaponModel: ["1H_Sword", "Badge_Shield"],
    weaponProp: { url: "/assets/models/props/shield_badge.gltf", bone: "handslotl" },
  },
  shield_round: {
    id: "shield_round",
    name: "Round Shield",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { armor: 8, vitality: 4 },
    weaponModel: ["1H_Sword", "Round_Shield"],
    weaponProp: { url: "/assets/models/props/shield_round.gltf", bone: "handslotl" },
  },
  shield_square: {
    id: "shield_square",
    name: "Tower Shield",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { armor: 14, vitality: 6 },
    weaponModel: ["1H_Sword", "Rectangle_Shield"],
    weaponProp: { url: "/assets/models/props/shield_square.gltf", bone: "handslotl" },
  },
  shield_spikes: {
    id: "shield_spikes",
    name: "Spiked Shield",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { armor: 9, power: 3, vitality: 3 },
    weaponModel: ["1H_Sword", "Spike_Shield"],
    weaponProp: { url: "/assets/models/props/shield_spikes.gltf", bone: "handslotl" },
  },
  wrench: {
    id: "wrench",
    name: "Engineer Wrench",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { power: 4, agility: 2, vitality: 2 },
    weaponProp: { url: "/assets/models/props/engineer_Wrench.gltf", bone: "handslotr" },
    attackAnim: ["Melee_1H_Attack_Chop", "1H_Melee_Attack_Chop"],
  },
  // Mob-drop-gated weapon upgrades -- each requires a trophy from a
  // specific creature plus a mineral, crafted rather than found/starting
  // gear (see recipes.ts).
  fanged_dagger: {
    id: "fanged_dagger",
    name: "Fanged Dagger",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { agility: 7, critChance: 0.07 },
    weaponModel: ["Knife", "Knife_Offhand"],
    weaponProp: { url: "/assets/models/props/dagger.gltf", bone: "handslotr" },
    attackAnim: DUALWIELD_ATTACK,
  },
  frostclaw_axe: {
    id: "frostclaw_axe",
    name: "Frostclaw Axe",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { power: 10, agility: 3, vitality: 2 },
    weaponModel: ["2H_Axe"],
    weaponProp: { url: "/assets/models/props/axe_2handed.gltf", bone: "handslotr" },
    attackAnim: GREATAXE_ATTACK,
  },
  runic_staff: {
    id: "runic_staff",
    name: "Runic Staff",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { power: 9, vitality: 2 },
    weaponModel: ["2H_Staff"],
    weaponProp: { url: "/assets/models/props/staff.glb", bone: "handslotr" },
    attackAnim: STAFF_ATTACK,
  },
  demonbone_bow: {
    id: "demonbone_bow",
    name: "Demonbone Bow",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { agility: 9, critChance: 0.06 },
    weaponProp: { url: "/assets/models/props/bow.gltf", bone: "handslotl" },
    castAnim: BOW_CAST,
  },
  dragonscale_ward: {
    id: "dragonscale_ward",
    name: "Dragonscale Ward",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { armor: 20, vitality: 8 },
    weaponModel: ["1H_Sword", "Spike_Shield"],
    weaponProp: { url: "/assets/models/props/shield_spikes.gltf", bone: "handslotl" },
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
  peasant_hood: {
    id: "peasant_hood",
    name: "Peasant Hood",
    type: "gear",
    stack: 1,
    slot: "head",
    statModifiers: { armor: 1 },
  },
  peasant_chest: {
    id: "peasant_chest",
    name: "Peasant Shirt",
    type: "gear",
    stack: 1,
    slot: "chest",
    statModifiers: { armor: 3, vitality: 1 },
  },
  peasant_arms: {
    id: "peasant_arms",
    name: "Peasant Bracers",
    type: "gear",
    stack: 1,
    slot: "arms",
    statModifiers: { armor: 1 },
  },
  peasant_legs: {
    id: "peasant_legs",
    name: "Peasant Pants",
    type: "gear",
    stack: 1,
    slot: "legs",
    statModifiers: { armor: 2 },
  },
  peasant_feet: {
    id: "peasant_feet",
    name: "Peasant Boots",
    type: "gear",
    stack: 1,
    slot: "feet",
    statModifiers: { armor: 1, moveSpeedMult: 0.05 },
  },
  ranger_hood: {
    id: "ranger_hood",
    name: "Ranger Hood",
    type: "gear",
    stack: 1,
    slot: "head",
    statModifiers: { armor: 3, agility: 2 },
  },
  ranger_chest: {
    id: "ranger_chest",
    name: "Ranger Tunic",
    type: "gear",
    stack: 1,
    slot: "chest",
    statModifiers: { armor: 7, vitality: 2, agility: 1 },
  },
  ranger_arms: {
    id: "ranger_arms",
    name: "Ranger Gloves",
    type: "gear",
    stack: 1,
    slot: "arms",
    statModifiers: { armor: 2, agility: 1 },
  },
  ranger_legs: {
    id: "ranger_legs",
    name: "Ranger Trousers",
    type: "gear",
    stack: 1,
    slot: "legs",
    statModifiers: { armor: 5, agility: 1 },
  },
  ranger_feet: {
    id: "ranger_feet",
    name: "Ranger Boots",
    type: "gear",
    stack: 1,
    slot: "feet",
    statModifiers: { armor: 2, moveSpeedMult: 0.12 },
  },
  minor_healing_potion: {
    id: "minor_healing_potion",
    name: "Minor Healing Potion",
    type: "consumable",
    stack: 10,
    restore: { hp: 40 },
    weaponProp: { url: "/assets/models/props/potion_small_red.gltf", bone: "handslotr" },
  },
  runic_healing_potion: {
    id: "runic_healing_potion",
    name: "Runic Healing Potion",
    type: "consumable",
    stack: 10,
    restore: { hp: 100 },
    weaponProp: { url: "/assets/models/props/potion_huge_red.gltf", bone: "handslotr" },
  },
  minor_mana_potion: {
    id: "minor_mana_potion",
    name: "Minor Mana Potion",
    type: "consumable",
    stack: 10,
    restore: { mana: 40 },
    weaponProp: { url: "/assets/models/props/potion_small_blue.gltf", bone: "handslotr" },
  },
  runic_mana_potion: {
    id: "runic_mana_potion",
    name: "Runic Mana Potion",
    type: "consumable",
    stack: 10,
    restore: { mana: 100 },
    weaponProp: { url: "/assets/models/props/potion_huge_blue.gltf", bone: "handslotr" },
  },
  frontline_potion: {
    id: "frontline_potion",
    name: "Frontline Potion",
    type: "consumable",
    stack: 10,
    applyAuraOnConsume: "potion_frontline",
    weaponProp: { url: "/assets/models/props/potion_large_green.gltf", bone: "handslotr" },
  },
  potion_focus: {
    id: "potion_focus",
    name: "Potion of Focus",
    type: "consumable",
    stack: 10,
    applyAuraOnConsume: "potion_focus",
    weaponProp: { url: "/assets/models/props/potion_large_orange.gltf", bone: "handslotr" },
  },
  invisibility_potion: {
    id: "invisibility_potion",
    name: "Invisibility Potion",
    type: "consumable",
    stack: 10,
    applyAuraOnConsume: "invisible",
    weaponProp: { url: "/assets/models/props/potion_medium_green.gltf", bone: "handslotr" },
  },
  free_action_potion: {
    id: "free_action_potion",
    name: "Free Action Potion",
    type: "consumable",
    stack: 10,
    applyAuraOnConsume: "free_action",
    weaponProp: { url: "/assets/models/props/potion_medium_orange.gltf", bone: "handslotr" },
  },
  flask_titan: {
    id: "flask_titan",
    name: "Flask of the Titan",
    type: "consumable",
    stack: 5,
    applyAuraOnConsume: "flask_titan",
    weaponProp: { url: "/assets/models/props/potion_huge_orange.gltf", bone: "handslotr" },
  },
  phial_quickness: {
    id: "phial_quickness",
    name: "Phial of Quickness",
    type: "consumable",
    stack: 5,
    applyAuraOnConsume: "phial_quickness",
    weaponProp: { url: "/assets/models/props/potion_small_green.gltf", bone: "handslotr" },
  },
};

export function itemDef(id: string): ItemDef {
  const def = ITEMS[id];
  if (!def) throw new Error(`Unknown item: ${id}`);
  return def;
}
