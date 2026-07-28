import type { CharacterGender } from "@rustcraft/shared";
import { EQUIP_SLOTS, itemDef, type ItemSnap } from "@rustcraft/shared";
import type { AnimatedModel, PropAttachConfig } from "./gltf";
import { modularPart, resolveModularUrl } from "./classModels";

type ModularPart = keyof NonNullable<ReturnType<typeof itemDef>["modularModel"]>;

export interface EquipSnap {
  headId?: string | null;
  chestId?: string | null;
  armsId?: string | null;
  legsId?: string | null;
  feetId?: string | null;
}

function itemInSlot(items: ItemSnap[], slot: (typeof EQUIP_SLOTS)[number]): ItemSnap | undefined {
  const idx = EQUIP_SLOTS.indexOf(slot);
  return items.find((i) => i.container === "equip" && i.slot === idx);
}

function modularUrlForItem(
  gender: CharacterGender,
  itemId: string | null | undefined,
  part: ModularPart,
): string | null {
  if (!itemId) return null;
  const raw = itemDef(itemId).modularModel?.[part] ?? null;
  return resolveModularUrl(gender, raw);
}

/** Fantasy outfit pieces are authored for the Regular body; fill bare slots so skin does not poke through.
 *  `hasChest` covers *either* a skinned modular tunic or a rigid armorProp chest piece -- either way the
 *  wearer has committed to "not bare torso," so bare arms/legs/feet underneath would look just as wrong. */
function fillOutfitGaps(
  gender: CharacterGender,
  hasChest: boolean,
  legs: string | null,
  arms: string | null,
  feet: string | null,
): { legs: string | null; arms: string | null; feet: string | null; armsIsPeasantFallback: boolean } {
  if (!hasChest) return { legs, arms, feet, armsIsPeasantFallback: false };
  const peasantLegs = resolveModularUrl(gender, modularPart("{gender}_Peasant_Legs.gltf"));
  const peasantArms = resolveModularUrl(gender, modularPart("{gender}_Peasant_Arms.gltf"));
  const peasantFeet = resolveModularUrl(gender, modularPart("{gender}_Peasant_Feet.gltf"));
  return {
    legs: legs ?? peasantLegs,
    arms: arms ?? peasantArms,
    feet: feet ?? peasantFeet,
    // Peasant_Arms.gltf isn't just a wrist-length bracer -- ~88% of its
    // second primitive's vertices are dominant-weighted to hand/finger
    // bones, i.e. it's authored as a full glove (see peasant_arms'
    // coversHands in items.ts). Leaving the base rig's bare-hand region
    // visible underneath it (the old assumption) produced two overlapping
    // hand shapes ("duplicate hands").
    armsIsPeasantFallback: !arms,
  };
}

function resolveSlots(
  gender: CharacterGender,
  snap: EquipSnap,
): {
  head: string | null;
  chest: string | null;
  /** Rigid (unskinned) chest armor prop from the equipped chest item, if
   *  any -- see ItemDef.armorProp. Mutually exclusive with `chest` (a
   *  chest item is either a skinned modular tunic or a rigid prop). */
  chestArmorProp: PropAttachConfig | null;
  arms: string | null;
  legs: string | null;
  feet: string | null;
  /** Whether the *actually equipped* (not gap-filled) arms piece covers the
   *  hand/fingers -- see ItemDef.coversHands. Gap-filled Peasant Bracers
   *  never do, so this stays false in that case. */
  armsCoversHands: boolean;
} {
  const chest = modularUrlForItem(gender, snap.chestId, "chest");
  const chestArmorProp = snap.chestId ? (itemDef(snap.chestId).armorProp ?? null) : null;
  const legs = modularUrlForItem(gender, snap.legsId, "legs");
  const arms = modularUrlForItem(gender, snap.armsId, "arms");
  const feet = modularUrlForItem(gender, snap.feetId, "feet");
  const filled = fillOutfitGaps(gender, !!chest || !!chestArmorProp, legs, arms, feet);
  const armsCoversHands = filled.armsIsPeasantFallback
    ? !!itemDef("peasant_arms").coversHands
    : arms
      ? !!itemDef(snap.armsId!).coversHands
      : false;
  return {
    head: modularUrlForItem(gender, snap.headId, "head"),
    chest,
    chestArmorProp,
    arms: filled.arms,
    legs: filled.legs,
    feet: filled.feet,
    armsCoversHands,
  };
}

export async function applyModularGearFromSnapAsync(
  model: AnimatedModel,
  gender: CharacterGender,
  snap: EquipSnap,
): Promise<void> {
  const slots = resolveSlots(gender, snap);
  await model.equipModularSlot("head", slots.head);
  await model.equipModularSlot("chest", slots.chest);
  await model.setArmorProp(slots.chestArmorProp);
  await model.equipModularSlot("arms", slots.arms, { coversHands: slots.armsCoversHands });
  await model.equipModularSlot("legs", slots.legs);
  await model.equipModularSlot("feet", slots.feet);
}

/** Apply equipped modular glTF pieces onto a Universal-base avatar. */
export function applyModularGearFromInventory(
  model: AnimatedModel,
  gender: CharacterGender,
  items: ItemSnap[],
): void {
  applyModularGearFromSnap(model, gender, {
    headId: itemInSlot(items, "head")?.itemId,
    chestId: itemInSlot(items, "chest")?.itemId,
    armsId: itemInSlot(items, "arms")?.itemId,
    legsId: itemInSlot(items, "legs")?.itemId,
    feetId: itemInSlot(items, "feet")?.itemId,
  });
}

export async function applyModularGearFromInventoryAsync(
  model: AnimatedModel,
  gender: CharacterGender,
  items: ItemSnap[],
): Promise<void> {
  await applyModularGearFromSnapAsync(model, gender, {
    headId: itemInSlot(items, "head")?.itemId,
    chestId: itemInSlot(items, "chest")?.itemId,
    armsId: itemInSlot(items, "arms")?.itemId,
    legsId: itemInSlot(items, "legs")?.itemId,
    feetId: itemInSlot(items, "feet")?.itemId,
  });
}

export function applyModularGearFromSnap(
  model: AnimatedModel,
  gender: CharacterGender,
  snap: EquipSnap,
): void {
  const slots = resolveSlots(gender, snap);
  void model.equipModularSlot("head", slots.head);
  void model.equipModularSlot("chest", slots.chest);
  void model.setArmorProp(slots.chestArmorProp);
  void model.equipModularSlot("arms", slots.arms, { coversHands: slots.armsCoversHands });
  void model.equipModularSlot("legs", slots.legs);
  void model.equipModularSlot("feet", slots.feet);
}
