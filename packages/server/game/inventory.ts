import { itemDef, INVENTORY_SLOTS, HOTBAR_SLOTS, EQUIP_SLOTS, type ItemSnap } from "@rustcraft/shared";

export type Container = "inventory" | "hotbar" | "equip";

export { EQUIP_SLOTS };

export interface InvItem {
  container: Container;
  slot: number;
  itemId: string;
  qty: number;
  durability: number | null;
}

function slotCount(container: Container): number {
  if (container === "inventory") return INVENTORY_SLOTS;
  if (container === "hotbar") return HOTBAR_SLOTS;
  return EQUIP_SLOTS.length;
}

export function findItem(items: InvItem[], container: Container, slot: number): InvItem | undefined {
  return items.find((i) => i.container === container && i.slot === slot);
}

export function countItem(items: InvItem[], itemId: string): number {
  return items.reduce((sum, i) => (i.itemId === itemId ? sum + i.qty : sum), 0);
}

/**
 * Add qty of an item, stacking first then filling empty slots
 * (hotbar last). Returns the quantity that did NOT fit.
 */
export function addItem(items: InvItem[], itemId: string, qty: number): number {
  const def = itemDef(itemId);
  let remaining = qty;

  // Stack onto existing piles.
  for (const item of items) {
    if (remaining <= 0) break;
    if (item.itemId !== itemId || item.qty >= def.stack) continue;
    const take = Math.min(def.stack - item.qty, remaining);
    item.qty += take;
    remaining -= take;
  }

  // Fill empty slots: inventory first, then hotbar.
  for (const container of ["inventory", "hotbar"] as const) {
    for (let slot = 0; slot < slotCount(container); slot++) {
      if (remaining <= 0) break;
      if (findItem(items, container, slot)) continue;
      const take = Math.min(def.stack, remaining);
      items.push({
        container,
        slot,
        itemId,
        qty: take,
        durability: def.maxDurability ?? null,
      });
      remaining -= take;
    }
  }

  return remaining;
}

/** Remove a total quantity of an item across slots. Returns false if not enough. */
export function removeItem(items: InvItem[], itemId: string, qty: number): boolean {
  if (countItem(items, itemId) < qty) return false;
  let remaining = qty;
  for (let i = items.length - 1; i >= 0 && remaining > 0; i--) {
    const item = items[i]!;
    if (item.itemId !== itemId) continue;
    const take = Math.min(item.qty, remaining);
    item.qty -= take;
    remaining -= take;
    if (item.qty <= 0) items.splice(i, 1);
  }
  return true;
}

/** Decrement one unit from a specific slot (consumables). */
export function decrementSlot(items: InvItem[], container: Container, slot: number): void {
  const item = findItem(items, container, slot);
  if (!item) return;
  item.qty -= 1;
  if (item.qty <= 0) {
    const idx = items.indexOf(item);
    items.splice(idx, 1);
  }
}

/** Apply durability loss; removes the item when it breaks. Returns true if broke. */
export function damageDurability(items: InvItem[], item: InvItem, amount: number): boolean {
  if (item.durability === null) return false;
  item.durability -= amount;
  if (item.durability <= 0) {
    const idx = items.indexOf(item);
    if (idx >= 0) items.splice(idx, 1);
    return true;
  }
  return false;
}

export function moveItem(
  items: InvItem[],
  fromContainer: Container,
  fromSlot: number,
  toContainer: Container,
  toSlot: number,
): boolean {
  if (toSlot >= slotCount(toContainer) || fromSlot >= slotCount(fromContainer)) return false;
  const from = findItem(items, fromContainer, fromSlot);
  if (!from) return false;
  // Equip slots only accept gear matching that slot (weapon/head/chest).
  if (toContainer === "equip" && itemDef(from.itemId).slot !== EQUIP_SLOTS[toSlot]) return false;
  const to = findItem(items, toContainer, toSlot);

  if (to && to.itemId === from.itemId) {
    // Merge stacks.
    const def = itemDef(from.itemId);
    const take = Math.min(def.stack - to.qty, from.qty);
    to.qty += take;
    from.qty -= take;
    if (from.qty <= 0) items.splice(items.indexOf(from), 1);
    return true;
  }

  // Swap (or move into empty slot).
  from.container = toContainer;
  from.slot = toSlot;
  if (to) {
    to.container = fromContainer;
    to.slot = fromSlot;
  }
  return true;
}

export function toSnaps(items: InvItem[]): ItemSnap[] {
  return items.map((i) => ({
    container: i.container,
    slot: i.slot,
    itemId: i.itemId,
    qty: i.qty,
    durability: i.durability,
  }));
}
