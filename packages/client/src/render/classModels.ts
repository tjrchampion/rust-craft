import type { ClassId } from "@rustcraft/shared";

/** Cosmetic model used for each class in the character-creation preview. */
export const CLASS_MODEL_URLS: Record<ClassId, string> = {
  warrior: "/assets/models/Barbarian.glb",
  mage: "/assets/models/Mage.glb",
  rogue: "/assets/models/Rogue.glb",
  cleric: "/assets/models/Knight.glb",
  ranger: "/assets/models/Ranger.glb",
  druid: "/assets/models/Druid.glb",
  paladin: "/assets/models/Paladin.glb",
  berserker: "/assets/models/Barbarian_Large.glb",
  assassin: "/assets/models/Rogue_Hooded.glb",
  engineer: "/assets/models/Engineer.glb",
};

export const CLASS_ICONS: Record<ClassId, string> = {
  warrior: "⚔️",
  mage: "🔮",
  rogue: "🗡️",
  cleric: "☀️",
  ranger: "🏹",
  druid: "🌿",
  paladin: "🛡️",
  berserker: "🪓",
  assassin: "🥷",
  engineer: "🔧",
};

/** Every weapon/shield/accessory node name present in each class's rig — the
 *  universe AnimatedModel.setWeapon() hides from except whatever's currently
 *  equipped (confirmed via direct GLTF JSON inspection of each rig). */
export const CLASS_WEAPON_NODES: Record<ClassId, string[]> = {
  warrior: ["1H_Axe", "2H_Axe", "1H_Axe_Offhand", "Barbarian_Round_Shield", "Mug"],
  mage: ["1H_Wand", "2H_Staff", "Spellbook", "Spellbook_open"],
  rogue: ["Knife", "Knife_Offhand", "Throwable", "1H_Crossbow", "2H_Crossbow"],
  cleric: [
    "1H_Sword",
    "2H_Sword",
    "1H_Sword_Offhand",
    "Badge_Shield",
    "Rectangle_Shield",
    "Round_Shield",
    "Spike_Shield",
  ],
  // Ranger/Druid/Paladin.glb don't bundle any baked-in weapon variants (unlike
  // the other 4 rigs) — their weapons attach separately via ItemDef.weaponProp.
  ranger: [],
  druid: [],
  paladin: [],
  berserker: ["1H_Axe", "2H_Axe", "1H_Axe_Offhand", "Barbarian_Round_Shield", "Mug"],
  assassin: ["Knife", "Knife_Offhand", "Throwable", "1H_Crossbow", "2H_Crossbow"],
  engineer: [],
};
