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
    // Warrior's rig (Barbarian.glb) has no sword mesh, only axes.
    weaponModel: ["2H_Axe"],
  },
  apprentice_staff: {
    id: "apprentice_staff",
    name: "Apprentice Staff",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { power: 4 },
    weaponModel: ["2H_Staff"],
  },
  twin_daggers: {
    id: "twin_daggers",
    name: "Twin Daggers",
    type: "gear",
    stack: 1,
    slot: "weapon",
    statModifiers: { agility: 4, critChance: 0.03 },
    weaponModel: ["Knife", "Knife_Offhand"],
    attackAnim: ["Dualwield_Melee_Attack_Chop"],
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
    castAnim: ["2H_Ranged_Shoot", "Spellcast_Shoot"],
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
  minor_healing_potion: {
    id: "minor_healing_potion",
    name: "Minor Healing Potion",
    type: "consumable",
    stack: 10,
    restore: { hp: 40 },
  },
  runic_healing_potion: {
    id: "runic_healing_potion",
    name: "Runic Healing Potion",
    type: "consumable",
    stack: 10,
    restore: { hp: 100 },
  },
  minor_mana_potion: {
    id: "minor_mana_potion",
    name: "Minor Mana Potion",
    type: "consumable",
    stack: 10,
    restore: { mana: 40 },
  },
  runic_mana_potion: {
    id: "runic_mana_potion",
    name: "Runic Mana Potion",
    type: "consumable",
    stack: 10,
    restore: { mana: 100 },
  },
  frontline_potion: {
    id: "frontline_potion",
    name: "Frontline Potion",
    type: "consumable",
    stack: 10,
    applyAuraOnConsume: "potion_frontline",
  },
  potion_focus: {
    id: "potion_focus",
    name: "Potion of Focus",
    type: "consumable",
    stack: 10,
    applyAuraOnConsume: "potion_focus",
  },
  invisibility_potion: {
    id: "invisibility_potion",
    name: "Invisibility Potion",
    type: "consumable",
    stack: 10,
    applyAuraOnConsume: "invisible",
  },
  free_action_potion: {
    id: "free_action_potion",
    name: "Free Action Potion",
    type: "consumable",
    stack: 10,
    applyAuraOnConsume: "free_action",
  },
  flask_titan: {
    id: "flask_titan",
    name: "Flask of the Titan",
    type: "consumable",
    stack: 5,
    applyAuraOnConsume: "flask_titan",
  },
  phial_quickness: {
    id: "phial_quickness",
    name: "Phial of Quickness",
    type: "consumable",
    stack: 5,
    applyAuraOnConsume: "phial_quickness",
  },
};

export function itemDef(id: string): ItemDef {
  const def = ITEMS[id];
  if (!def) throw new Error(`Unknown item: ${id}`);
  return def;
}
