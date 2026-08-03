import type { CharacterGender } from "@rustcraft/shared";
import { EQUIP_SLOTS, itemDef, type ItemSnap } from "@rustcraft/shared";
import type { AnimatedModel, PropAttachConfig } from "./gltf";
import { resolveModularUrl } from "./classModels";

type ModularPart = keyof NonNullable<ReturnType<typeof itemDef>["modularModel"]>;

export interface EquipSnap {
  headId?: string | null;
  chestId?: string | null;
  armsId?: string | null;
  legsId?: string | null;
  feetId?: string | null;
  shouldersId?: string | null;
  neckId?: string | null;
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
  shoulders: string | null;
  neck: string | null;
  armsCoversHands: boolean;
  headCoversHead: boolean;
  /** Tint applied to the base rig's still-visible Thigh mesh so gaps in
   *  plate-style legs pieces (e.g. Knight greaves) read as a matching
   *  underlayer instead of bare skin -- see AnimatedModel.autoManageBodySkin. */
  legsTint: number | null;
} {
  const arms = modularUrlForItem(gender, snap.armsId, "arms");
  const head = modularUrlForItem(gender, snap.headId, "head");
  return {
    head,
    chest: modularUrlForItem(gender, snap.chestId, "chest"),
    chestArmorProp: snap.chestId ? (itemDef(snap.chestId).armorProp ?? null) : null,
    arms,
    legs: modularUrlForItem(gender, snap.legsId, "legs"),
    feet: modularUrlForItem(gender, snap.feetId, "feet"),
    shoulders: modularUrlForItem(gender, snap.shouldersId, "shoulders"),
    neck: modularUrlForItem(gender, snap.neckId, "neck"),
    armsCoversHands: arms && snap.armsId ? !!itemDef(snap.armsId).coversHands : false,
    headCoversHead: head && snap.headId ? !!itemDef(snap.headId).coversHead : false,
    legsTint: snap.legsId ? (itemDef(snap.legsId).gearTint ?? null) : null,
  };
}

export async function applyModularGearFromSnapAsync(
  model: AnimatedModel,
  gender: CharacterGender,
  snap: EquipSnap,
): Promise<void> {
  const slots = resolveSlots(gender, snap);
  await model.equipModularSlot("head", slots.head, { coversHead: slots.headCoversHead });
  await model.equipModularSlot("chest", slots.chest);
  await model.setArmorProp(slots.chestArmorProp);
  await model.equipModularSlot("arms", slots.arms, { coversHands: slots.armsCoversHands });
  await model.equipModularSlot("legs", slots.legs, { tint: slots.legsTint });
  await model.equipModularSlot("feet", slots.feet);
  await model.equipModularSlot("shoulders", slots.shoulders);
  await model.equipModularSlot("neck", slots.neck);
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
    shouldersId: itemInSlot(items, "shoulders")?.itemId,
    neckId: itemInSlot(items, "neck")?.itemId,
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
    shouldersId: itemInSlot(items, "shoulders")?.itemId,
    neckId: itemInSlot(items, "neck")?.itemId,
  });
}

export function applyModularGearFromSnap(
  model: AnimatedModel,
  gender: CharacterGender,
  snap: EquipSnap,
): void {
  const slots = resolveSlots(gender, snap);
  void model.equipModularSlot("head", slots.head, { coversHead: slots.headCoversHead });
  void model.equipModularSlot("chest", slots.chest);
  void model.setArmorProp(slots.chestArmorProp);
  void model.equipModularSlot("arms", slots.arms, { coversHands: slots.armsCoversHands });
  void model.equipModularSlot("legs", slots.legs, { tint: slots.legsTint });
  void model.equipModularSlot("feet", slots.feet);
  void model.equipModularSlot("shoulders", slots.shoulders);
  void model.equipModularSlot("neck", slots.neck);
}
