export interface VendorItem {
  itemId: string;
  price: number; // in Copper (100c = 1s, 10,000c = 1g)
}

export interface VendorDef {
  id: string;
  name: string;
  title: string;
  items: VendorItem[];
}

export type VendorId = "vendor_alchemist" | "vendor_blacksmith" | "vendor_merchant";

export const VENDORS: Record<VendorId, VendorDef> = {
  vendor_alchemist: {
    id: "vendor_alchemist",
    name: "Eldrin the Alchemist",
    title: "Potions & Alchemy Remedies",
    items: [
      { itemId: "minor_healing_potion", price: 50 },    // 50c
      { itemId: "minor_mana_potion", price: 50 },       // 50c
      { itemId: "runic_healing_potion", price: 250 },   // 2s 50c
      { itemId: "runic_mana_potion", price: 250 },      // 2s 50c
      { itemId: "bandage", price: 20 },                 // 20c
      { itemId: "berries", price: 15 },                 // 15c
      { itemId: "frontline_potion", price: 400 },       // 4s
      { itemId: "potion_focus", price: 400 },           // 4s
    ],
  },
  vendor_blacksmith: {
    id: "vendor_blacksmith",
    name: "Grom Ironhand",
    title: "Weaponsmith & Armorer",
    items: [
      { itemId: "iron_sword", price: 500 },             // 5s
      { itemId: "spear", price: 400 },                  // 4s
      { itemId: "kite_shield", price: 450 },            // 4s 50c
      { itemId: "leather_armor", price: 600 },          // 6s
      { itemId: "peasant_chest", price: 300 },          // 3s
      { itemId: "peasant_legs", price: 250 },           // 2s 50c
      { itemId: "knight_helmet", price: 800 },          // 8s
      { itemId: "knight_chest", price: 1500 },          // 15s
      { itemId: "axe", price: 350 },                    // 3s 50c
      { itemId: "pickaxe", price: 200 },                // 2s
    ],
  },
  vendor_merchant: {
    id: "vendor_merchant",
    name: "Lyra Moonshadow",
    title: "General Provisions & Artifacts",
    items: [
      { itemId: "wood", price: 10 },                    // 10c
      { itemId: "stone", price: 15 },                   // 15c
      { itemId: "iron_ore", price: 30 },                // 30c
      { itemId: "torch", price: 25 },                   // 25c
      { itemId: "bandage", price: 20 },                 // 20c
      { itemId: "minor_healing_potion", price: 50 },    // 50c
      { itemId: "minor_mana_potion", price: 50 },       // 50c
      { itemId: "saddle", price: 2000 },                // 20s
      { itemId: "tome_firebolt", price: 5000 },         // 50s
    ],
  },
};

export function vendorDef(vendorId: string): VendorDef {
  return VENDORS[vendorId as VendorId] ?? VENDORS.vendor_merchant;
}

export function resolveVendorId(npc: { vendorId?: string; title?: string; name?: string }): string | undefined {
  if (npc.vendorId) return npc.vendorId;
  const str = `${npc.title ?? ""} ${npc.name ?? ""}`.toLowerCase();
  if (str.includes("alchemist") || str.includes("potion") || str.includes("elixir") || str.includes("remedy")) {
    return "vendor_alchemist";
  }
  if (str.includes("weaponsmith") || str.includes("blacksmith") || str.includes("armorer") || str.includes("smith")) {
    return "vendor_blacksmith";
  }
  if (str.includes("merchant") || str.includes("trader") || str.includes("vendor") || str.includes("provisions") || str.includes("goods")) {
    return "vendor_merchant";
  }
  return undefined;
}

