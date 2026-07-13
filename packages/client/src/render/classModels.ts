import type { ClassId } from "@rustcraft/shared";

/** Cosmetic model used for each class in the character-creation preview. */
export const CLASS_MODEL_URLS: Record<ClassId, string> = {
  warrior: "/assets/models/Barbarian.glb",
  mage: "/assets/models/Mage.glb",
  rogue: "/assets/models/Rogue.glb",
  cleric: "/assets/models/Knight.glb",
};

export const CLASS_ICONS: Record<ClassId, string> = {
  warrior: "⚔️",
  mage: "🔮",
  rogue: "🗡️",
  cleric: "☀️",
};
