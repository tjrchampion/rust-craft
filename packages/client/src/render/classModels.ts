import type { ClassId, CharacterGender, HairStyleId, FacialHairId } from "@rustcraft/shared";

/** Quaternius Universal rig — shared by UAL and Fantasy modular outfits. */
export const UNIVERSAL_ANIMATION_LIBRARY =
  "/assets/models/animations/UAL1_Standard.glb";
/** UAL2 source pack — strafe/backpedal/dash and expanded combat clips. */
export const UNIVERSAL_ANIMATION_LIBRARY_2 =
  "/assets/models/animations/UAL2.glb";

const MODULAR = "/assets/models/modular";
const PARTS = `${MODULAR}/Modular Parts`;
const HAIR_DIR = `${MODULAR}/Hair`;

/** Default gender to assume for a class before a character with a real,
 *  player-chosen gender exists yet (e.g. seeding the creation screen's
 *  initial toggle state) -- gender itself is a per-character choice now,
 *  independent of class, not derived from it. */
export const CLASS_GENDER: Record<ClassId, CharacterGender> = {
  warrior: "male",
  cleric: "male",
  paladin: "male",
  berserker: "male",
  ranger: "male",
  druid: "female",
  mage: "male",
  rogue: "male",
  assassin: "female",
  engineer: "male",
};

export function universalBaseUrl(gender: CharacterGender): string {
  return gender === "female"
    ? `${MODULAR}/base/Regular_Female.glb`
    : `${MODULAR}/base/Regular_Male.glb`;
}

/** `{gender}` is replaced with Male or Female per the character's own chosen gender. */
export function resolveModularUrl(gender: CharacterGender, url: string | null | undefined): string | null {
  if (!url) return null;
  const token = gender === "female" ? "Female" : "Male";
  let resolved = url.replaceAll("{gender}", token);
  // Pack uses asymmetric male filenames for a few Knight/Ranger parts.
  if (resolved.endsWith("Male_Ranger_Feet.gltf")) {
    resolved = resolved.replace("Male_Ranger_Feet.gltf", "Male_Ranger_Feet_Boots.gltf");
  }
  if (resolved.endsWith("Male_Knight_Feet.gltf")) {
    resolved = resolved.replace("Male_Knight_Feet.gltf", "Male_Knight_Feet_Armor.gltf");
  }
  if (resolved.endsWith("Male_Knight_Legs.gltf")) {
    resolved = resolved.replace("Male_Knight_Legs.gltf", "Male_Knight_Legs_Armor.gltf");
  }
  // Pack uses singular "Pauldron" on male accessory files vs plural "Pauldrons" on female.
  if (resolved.endsWith("Male_Knight_Acc_Pauldrons_Round.gltf")) {
    resolved = resolved.replace(
      "Male_Knight_Acc_Pauldrons_Round.gltf",
      "Male_Knight_Acc_Pauldron_Round.gltf",
    );
  }
  if (resolved.endsWith("Male_Knight_Acc_Pauldrons_Spike.gltf")) {
    resolved = resolved.replace(
      "Male_Knight_Acc_Pauldrons_Spike.gltf",
      "Male_Knight_Acc_Pauldron_Spike.gltf",
    );
  }
  if (resolved.endsWith("Male_Ranger_Acc_Pauldrons.gltf")) {
    resolved = resolved.replace("Male_Ranger_Acc_Pauldrons.gltf", "Male_Ranger_Acc_Pauldron.gltf");
  }
  return encodeURI(resolved);
}

export function modularPart(file: string): string {
  return `${PARTS}/${file}`;
}

/** Imported Quaternius "Universal Base Characters" hairstyle pieces (see
 *  scripts/import-hairstyles.mjs) -- skinned to the same shared rig as the
 *  base body/outfits, attached via AnimatedModel.equipModularSlot("hair", ...)
 *  same as any other modular gear piece. "none" has no file (bald). */
const HAIR_STYLE_FILES: Partial<Record<HairStyleId, string>> = {
  buzzed: `${HAIR_DIR}/Hair_Buzzed.glb`,
  buzzed_female: `${HAIR_DIR}/Hair_BuzzedFemale.glb`,
  long: `${HAIR_DIR}/Hair_Long.glb`,
  simple_parted: `${HAIR_DIR}/Hair_SimpleParted.glb`,
  buns: `${HAIR_DIR}/Hair_Buns.glb`,
  bob: `${HAIR_DIR}/Hair_Bob.glb`,
  dreads: `${HAIR_DIR}/Hair_Dreads.glb`,
  long_dreads: `${HAIR_DIR}/Hair_LongDreads.glb`,
  mohawk: `${HAIR_DIR}/Hair_Mohawk.glb`,
  ponytail: `${HAIR_DIR}/Hair_Ponytail.glb`,
  ponytail_2: `${HAIR_DIR}/Hair_Ponytail_2.glb`,
  slick_back: `${HAIR_DIR}/Hair_SlickBack.glb`,
  balding: `${HAIR_DIR}/Hair_Balding.glb`,
};

const FACIAL_HAIR_FILES: Partial<Record<FacialHairId, string>> = {
  beard: `${HAIR_DIR}/Hair_Beard.glb`,
  moustache: `${HAIR_DIR}/Hair_Moustache.glb`,
  mutton_chops: `${HAIR_DIR}/Hair_MuttonChops.glb`,
};

/** Real eyebrow meshes, gender-specific -- needed because the base rig's own
 *  "Eyebrows"-named node is actually its baked-in default hairstyle (not
 *  eyebrows at all), which gets hidden the moment a real hair piece takes
 *  over (see AnimatedModel's hair-slot handling in gltf.ts). */
const EYEBROWS_FILES: Record<CharacterGender, string> = {
  male: `${HAIR_DIR}/Eyebrows_Regular.glb`,
  female: `${HAIR_DIR}/Eyebrows_Female.glb`,
};

export function hairStyleUrl(hairStyle: HairStyleId): string | null {
  return HAIR_STYLE_FILES[hairStyle] ?? null;
}

export function facialHairUrl(facialHair: FacialHairId): string | null {
  return FACIAL_HAIR_FILES[facialHair] ?? null;
}

export function eyebrowsUrl(gender: CharacterGender): string {
  return EYEBROWS_FILES[gender];
}

export function allHairStyleUrls(): string[] {
  return Object.values(HAIR_STYLE_FILES);
}

export function allFacialHairUrls(): string[] {
  return Object.values(FACIAL_HAIR_FILES);
}

/** Rigid nudge applied on top of a modular piece's normal skin deformation --
 *  see AnimatedModel.attachModularMeshes. `quaternion` (an exact rotation,
 *  used for computed bind-pose corrections) takes priority over `rotation`
 *  (an Euler-degrees approximation, for hand-tuning) if both are set. */
export interface ModularFit {
  position?: [number, number, number];
  rotation?: [number, number, number]; // degrees
  quaternion?: [number, number, number, number];
  scale?: number;
}

/** Which gender's skeleton each hairstyle piece was actually rigged/fitted
 *  against. Reported: hair renders correctly on its own authored gender, but
 *  visibly deforms (not just sits in the wrong spot) when bound to the
 *  *other* gender's differently-proportioned skeleton -- a plain position
 *  offset can't fix that, only a real bind-pose correction can (see
 *  AnimatedModel's headBindWorld/computeHairFit in gltf.ts, which uses this
 *  table to know which pieces need correcting and against which gender). */
export const HAIR_AUTHORED_GENDER: Partial<Record<HairStyleId, CharacterGender>> = {
  buzzed: "male",
  buzzed_female: "female",
  long: "female",
  simple_parted: "female",
  buns: "female",
};

/** Extra uniform scale layered on top of the computed bind-pose delta (see
 *  computeHairFit in gltf.ts) when a female-authored style is worn on male.
 *  The bind-pose delta alone corrects position/rotation from the Head
 *  bone's own transform, but the male head *mesh* is modeled visibly bigger
 *  without that being encoded on the bone itself, so the correctly-
 *  positioned hair can still have the head poke through it. First-pass
 *  guess (reported: head cuts through hair) -- adjust directly if still
 *  too small/big. */
export const MALE_HEAD_SIZE_COMPENSATION = 1.50;

export interface ModularEquipSet {
  head?: string;
  top?: string;
  bottom?: string;
  arms?: string;
  feet?: string;
}

/** Optional baked-in modular pieces applied after the base rig loads (usually empty — gear comes from items). */
export const CLASS_MODULAR_DEFAULTS: Record<ClassId, ModularEquipSet> = {
  warrior: {},
  cleric: {},
  paladin: {},
  berserker: {},
  ranger: {},
  druid: {},
  mage: {},
  rogue: {},
  assassin: {},
  engineer: {},
};

/** Every player uses the Universal Base skeleton for their own chosen gender. */
export const GENDER_MODEL_URLS: Record<CharacterGender, string> = {
  male: universalBaseUrl("male"),
  female: universalBaseUrl("female"),
};

export const BASE_CHARACTER_GLB = universalBaseUrl("male");

export function isUniversalCharacterUrl(url: string): boolean {
  return (
    url.includes("/modular/base/") ||
    url.includes("/modular/Outfits/") ||
    url.includes("/modular/Modular%20Parts/") ||
    url.includes("/modular/Modular Parts/") ||
    url.includes("/modular/Hair/")
  );
}

export function playerModelUrl(gender: CharacterGender): string {
  return GENDER_MODEL_URLS[gender] ?? GENDER_MODEL_URLS.male;
}

export async function applyClassModularDefaults(
  equip: (slot: string, url: string | null) => void | Promise<void>,
  classId: ClassId,
): Promise<void> {
  const defaults = CLASS_MODULAR_DEFAULTS[classId];
  const gender = CLASS_GENDER[classId];
  await equip("head", resolveModularUrl(gender, defaults.head ?? null));
  await equip("chest", resolveModularUrl(gender, defaults.top ?? null));
  await equip("legs", resolveModularUrl(gender, defaults.bottom ?? null));
  await equip("arms", resolveModularUrl(gender, defaults.arms ?? null));
  await equip("feet", resolveModularUrl(gender, defaults.feet ?? null));
}

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

export const CLASS_GRAPHICS: Record<ClassId, string> = {
  warrior: "/assets/ui/classes/warrior.jpg",
  berserker: "/assets/ui/classes/berserker.jpg",
  paladin: "/assets/ui/classes/paladin.jpg",
  cleric: "/assets/ui/classes/cleric.jpg",
  mage: "/assets/ui/classes/mage.jpg",
  engineer: "/assets/ui/classes/engineer.jpg",
  druid: "/assets/ui/classes/druid.jpg",
  ranger: "/assets/ui/classes/ranger.jpg",
  rogue: "/assets/ui/classes/rogue.jpg",
  assassin: "/assets/ui/classes/assassin.jpg",
};

export const CLASS_PREVIEW_ARMOR: Record<ClassId, Record<string, string>> = {
  warrior: {
    head: "knight_helmet",
    chest: "knight_chest",
    arms: "knight_arms",
    legs: "knight_legs",
    feet: "knight_feet",
    shoulders: "knight_pauldrons_spike",
    weapon: "iron_sword",
  },
  paladin: {
    head: "noble_crown",
    chest: "knight_chest_cloth",
    arms: "knight_arms",
    legs: "knight_legs",
    feet: "knight_feet",
    shoulders: "noble_pauldrons_lion",
    weapon: "sunforged_blade",
  },
  berserker: {
    head: "knight_horns",
    chest: "knight_chest_cloth",
    arms: "knight_arms",
    legs: "peasant_legs",
    feet: "peasant_feet",
    shoulders: "knight_pauldrons_spike",
    weapon: "axe_2handed_large",
  },
  mage: {
    head: "peasant_hood",
    chest: "wizard_chest",
    arms: "wizard_arms",
    legs: "wizard_legs",
    feet: "wizard_feet",
    weapon: "apprentice_staff",
  },
  cleric: {
    head: "noble_crown",
    chest: "noble_chest",
    arms: "noble_arms",
    legs: "noble_legs",
    feet: "noble_feet",
    neck: "noble_gorget",
    weapon: "blessed_mace",
  },
  ranger: {
    head: "ranger_hood",
    chest: "ranger_chest",
    arms: "ranger_arms",
    legs: "ranger_legs",
    feet: "ranger_feet",
    shoulders: "ranger_pauldrons",
    weapon: "hunting_bow",
  },
  rogue: {
    head: "peasant_hood",
    chest: "peasant_chest",
    arms: "peasant_arms",
    legs: "ranger_legs",
    feet: "ranger_feet",
    weapon: "twin_daggers",
  },
  assassin: {
    head: "ranger_hood",
    chest: "ranger_chest",
    arms: "ranger_arms",
    legs: "ranger_legs",
    feet: "ranger_feet",
    shoulders: "ranger_pauldrons",
    weapon: "twin_daggers",
  },
  druid: {
    head: "ranger_hood",
    chest: "wizard_chest",
    arms: "ranger_arms",
    legs: "wizard_legs",
    feet: "ranger_feet",
    weapon: "grove_staff",
  },
  engineer: {
    head: "noble_crown",
    chest: "noble_chest",
    arms: "peasant_arms",
    legs: "noble_legs",
    feet: "noble_feet",
    neck: "noble_gorget",
    weapon: "iron_sword",
  },
};

/** Universal rig — weapons attach via props on hand bones, not baked mesh variants. */
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

export const CLASS_HEAD_NODES: Record<ClassId, string[]> = {
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

export const CLASS_CHEST_NODES: Record<ClassId, string[]> = {
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

/** Legacy tint targets — unused on Universal modular rigs. */
export const CLASS_BODY_NODE: Record<ClassId, string> = {
  warrior: "Mannequin",
  mage: "Mannequin",
  rogue: "Mannequin",
  cleric: "Mannequin",
  ranger: "Mannequin",
  druid: "Mannequin",
  paladin: "Mannequin",
  berserker: "Mannequin",
  assassin: "Mannequin",
  engineer: "Mannequin",
};

export const CLASS_ARM_NODES: Record<ClassId, string[]> = {
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

export const CLASS_LEG_NODES: Record<ClassId, string[]> = {
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
