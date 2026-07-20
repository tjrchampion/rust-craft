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

/** Every weapon/shield/accessory node name baked into each class's rig --
 *  the universe AnimatedModel.setWeapon() hides from except whatever's
 *  currently equipped. The KayKit "Adventurers 2.0" rig refresh stripped all
 *  baked weapon-variant meshes out of every character file (re-confirmed by
 *  direct GLTF JSON inspection of each current rig: only Body/Arm/Leg/Head
 *  and cosmetic accessory nodes remain, no "1H_Axe"/"Knife"/etc.) -- every
 *  class is empty now, and every weapon-slot item attaches its own model
 *  via ItemDef.weaponProp instead. Leaving a stale non-empty list here (as
 *  this used to be, pre-refresh) is actively harmful: setWeapon() would
 *  wrongly think a weaponModel item's baked mesh exists, take that branch,
 *  and explicitly clear the weaponProp attachment that would have actually
 *  rendered it -- leaving the character holding nothing at all. */
export const CLASS_WEAPON_NODES: Record<ClassId, string[]> = {
  warrior: [],
  mage: [],
  rogue: [],
  cleric: [],
  ranger: [],
  druid: [],
  paladin: [],
  berserker: [],
  assassin: [],
  engineer: [],
};

/** Baked head-cosmetic node name(s) per class's rig (hat/helmet/mask),
 *  hidden once any head-slot item is equipped -- confirmed via direct GLTF
 *  JSON inspection of each rig file (node names, not just mesh names). */
export const CLASS_HEAD_NODES: Record<ClassId, string[]> = {
  warrior: ["Barbarian_BearHat"],
  mage: ["Mage_Hat"],
  rogue: [],
  cleric: ["Knight_Helmet", "Knight_HelmetVisor"],
  ranger: [],
  druid: [],
  paladin: [],
  berserker: ["Barbarian_Large_BearHat"],
  assassin: ["RogueHooded_Mask"],
  engineer: ["Engineer_Goggles"],
};

/** Baked chest/back-cosmetic node name(s) per class's rig (cape/backpack/
 *  pelt/shoulderpads) -- there's no separate "back" equip slot in this game,
 *  so these hide once any chest-slot item is equipped. */
export const CLASS_CHEST_NODES: Record<ClassId, string[]> = {
  warrior: [],
  mage: ["Mage_Cape"],
  rogue: ["Rogue_Cape"],
  cleric: ["Knight_Cape"],
  ranger: ["Ranger_Cape"],
  druid: ["Druid_Backpack"],
  paladin: ["Paladin_Cape"],
  berserker: ["Barbarian_Large_BearPelt", "Barbarian_Large_ShoulderpadLeft", "Barbarian_Large_ShoulderpadRight"],
  assassin: ["RogueHooded_Cape"],
  engineer: ["Engineer_Backpack"],
};

/** The rig's single torso mesh, tinted (not hidden -- there's no bare-skin
 *  mesh underneath) once any chest-slot item is equipped. */
export const CLASS_BODY_NODE: Record<ClassId, string> = {
  warrior: "Barbarian_Body",
  mage: "Mage_Body",
  rogue: "Rogue_Body",
  cleric: "Knight_Body",
  ranger: "Ranger_Body",
  druid: "Druid_Body",
  paladin: "Paladin_Body",
  berserker: "Barbarian_Large_Body",
  assassin: "RogueHooded_Body",
  engineer: "Engineer_Body",
};

/** The rig's two arm meshes (sleeve/glove fused in), tinted once any
 *  arms-slot item is equipped. */
export const CLASS_ARM_NODES: Record<ClassId, string[]> = {
  warrior: ["Barbarian_ArmLeft", "Barbarian_ArmRight"],
  mage: ["Mage_ArmLeft", "Mage_ArmRight"],
  rogue: ["Rogue_ArmLeft", "Rogue_ArmRight"],
  cleric: ["Knight_ArmLeft", "Knight_ArmRight"],
  ranger: ["Ranger_ArmLeft", "Ranger_ArmRight"],
  druid: ["Druid_ArmLeft", "Druid_ArmRight"],
  paladin: ["Paladin_ArmLeft", "Paladin_ArmRight"],
  berserker: ["Barbarian_Large_ArmLeft", "Barbarian_Large_ArmRight"],
  assassin: ["RogueHooded_ArmLeft", "RogueHooded_ArmRight"],
  engineer: ["Engineer_ArmLeft", "Engineer_ArmRight"],
};

/** The rig's two leg meshes (pants/boot fused in) -- there's no separate
 *  foot mesh, so both the legs slot and the feet slot tint this same pair;
 *  whichever is equipped wins (legs takes priority if both are), resolved
 *  by the caller before calling setGearTint. */
export const CLASS_LEG_NODES: Record<ClassId, string[]> = {
  warrior: ["Barbarian_LegLeft", "Barbarian_LegRight"],
  mage: ["Mage_LegLeft", "Mage_LegRight"],
  rogue: ["Rogue_LegLeft", "Rogue_LegRight"],
  cleric: ["Knight_LegLeft", "Knight_LegRight"],
  ranger: ["Ranger_LegLeft", "Ranger_LegRight"],
  druid: ["Druid_LegLeft", "Druid_LegRight"],
  paladin: ["Paladin_LegLeft", "Paladin_LegRight"],
  berserker: ["Barbarian_Large_LegLeft", "Barbarian_Large_LegRight"],
  assassin: ["RogueHooded_LegLeft", "RogueHooded_LegRight"],
  engineer: ["Engineer_LegLeft", "Engineer_LegRight"],
};
