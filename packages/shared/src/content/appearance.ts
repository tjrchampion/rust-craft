/** Character appearance -- chosen at creation, independent of class (unlike
 *  the old CLASS_GENDER-derives-everything setup, gender is now a real
 *  per-character choice, same as hairstyle/facial hair/colors below). Kept
 *  in shared (not client-only) since the server validates against these
 *  same id lists on character creation. */

export type CharacterGender = "male" | "female";
export const GENDERS: CharacterGender[] = ["male", "female"];

/** "none" = bald, using whatever the base rig ships baked in with no
 *  overlay. Every other id maps to one of the imported Hair_*.glb pieces
 *  (see scripts/import-hairstyles.mjs / classModels.ts's HAIR_STYLE_FILES)
 *  -- deliberately not gender-restricted, any style with any gender. */
export type HairStyleId = "none" | "buzzed" | "buzzed_female" | "long" | "simple_parted" | "buns";
export const HAIR_STYLES: HairStyleId[] = ["none", "buzzed", "buzzed_female", "long", "simple_parted", "buns"];

export type FacialHairId = "none" | "beard";
export const FACIAL_HAIR_OPTIONS: FacialHairId[] = ["none", "beard"];

export interface CharacterAppearance {
  gender: CharacterGender;
  hairStyle: HairStyleId;
  facialHair: FacialHairId;
  /** 0xRRGGBB, multiplied onto the base mesh color -- same mechanism as
   *  item gearTint (see AnimatedModel.setGearTint in the client). */
  hairColor: number;
  eyeColor: number;
  /** Multiplied onto equipped gear's own tint -- 0xffffff (identity) means
   *  "no additional tint", gear renders at its natural authored color. */
  outfitHue: number;
}

export const GENDER_HAIR_STYLES: Record<CharacterGender, HairStyleId[]> = {
  male: ["none", "buzzed", "simple_parted"],
  female: ["none", "buzzed_female", "long", "simple_parted", "buns"],
};

export const GENDER_FACIAL_HAIR: Record<CharacterGender, FacialHairId[]> = {
  male: ["none", "beard"],
  female: ["none"],
};

export function isHairStyleAllowedForGender(style: HairStyleId, gender: CharacterGender): boolean {
  return GENDER_HAIR_STYLES[gender]?.includes(style) ?? false;
}

export function isFacialHairAllowedForGender(facial: FacialHairId, gender: CharacterGender): boolean {
  return GENDER_FACIAL_HAIR[gender]?.includes(facial) ?? false;
}

export function isCharacterGender(v: unknown): v is CharacterGender {
  return typeof v === "string" && (GENDERS as string[]).includes(v);
}
export function isHairStyleId(v: unknown): v is HairStyleId {
  return typeof v === "string" && (HAIR_STYLES as string[]).includes(v);
}
export function isFacialHairId(v: unknown): v is FacialHairId {
  return typeof v === "string" && (FACIAL_HAIR_OPTIONS as string[]).includes(v);
}
/** 24-bit color validation for the hair/eye/outfit hue fields -- guards
 *  against garbage input landing in the DB as a color that renders as
 *  black/undefined rather than the picker's intended swatch. */
export function isColor24(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 0xffffff;
}

