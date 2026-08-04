/**
 * Per-level care packages shown in the HUD chest until the player opens them.
 * Levels not listed fall back to a small consumable bundle scaled by level.
 */

export interface LevelRewardItem {
  itemId: string;
  qty: number;
}

const BY_LEVEL: Record<number, LevelRewardItem[]> = {
  2: [
    { itemId: "bandage", qty: 3 },
    { itemId: "berries", qty: 5 },
  ],
  3: [
    { itemId: "cooked_meat", qty: 3 },
    { itemId: "bandage", qty: 2 },
  ],
  4: [{ itemId: "minor_healing_potion", qty: 2 }],
  5: [
    { itemId: "minor_mana_potion", qty: 2 },
    { itemId: "bandage", qty: 3 },
  ],
  6: [
    { itemId: "ancient_dust", qty: 5 },
    { itemId: "cooked_meat", qty: 3 },
  ],
  7: [
    { itemId: "iron_ore", qty: 4 },
    { itemId: "bandage", qty: 4 },
  ],
  8: [
    { itemId: "frontline_potion", qty: 1 },
    { itemId: "minor_healing_potion", qty: 2 },
  ],
  9: [
    { itemId: "potion_focus", qty: 1 },
    { itemId: "ancient_dust", qty: 6 },
  ],
  10: [
    { itemId: "runic_healing_potion", qty: 2 },
    { itemId: "cooked_meat", qty: 5 },
  ],
  11: [
    { itemId: "free_action_potion", qty: 1 },
    { itemId: "bandage", qty: 5 },
  ],
  12: [
    { itemId: "runic_mana_potion", qty: 2 },
    { itemId: "iron_ore", qty: 6 },
  ],
  13: [
    { itemId: "phial_quickness", qty: 1 },
    { itemId: "ancient_dust", qty: 8 },
  ],
  14: [
    { itemId: "mithril_ore", qty: 3 },
    { itemId: "runic_healing_potion", qty: 1 },
  ],
  15: [
    { itemId: "flask_titan", qty: 1 },
    { itemId: "runic_mana_potion", qty: 2 },
  ],
  16: [
    { itemId: "invisibility_potion", qty: 1 },
    { itemId: "ancient_dust", qty: 10 },
  ],
  17: [
    { itemId: "phial_quickness", qty: 1 },
    { itemId: "runic_healing_potion", qty: 2 },
  ],
  18: [
    { itemId: "flask_titan", qty: 1 },
    { itemId: "mithril_ore", qty: 5 },
  ],
  19: [
    { itemId: "runic_healing_potion", qty: 3 },
    { itemId: "runic_mana_potion", qty: 3 },
  ],
  20: [
    { itemId: "flask_titan", qty: 1 },
    { itemId: "phial_quickness", qty: 1 },
    { itemId: "ancient_dust", qty: 20 },
    { itemId: "runic_healing_potion", qty: 3 },
  ],
};

/** Items granted when the player reaches `level` (2+). Empty at level 1. */
export function levelUpRewards(level: number): LevelRewardItem[] {
  if (level <= 1) return [];
  const specific = BY_LEVEL[level];
  if (specific) return specific.map((i) => ({ ...i }));
  // Fallback for any levels beyond the table.
  return [
    { itemId: "bandage", qty: Math.min(8, 2 + Math.floor(level / 3)) },
    { itemId: "cooked_meat", qty: Math.min(6, 2 + Math.floor(level / 4)) },
    { itemId: "ancient_dust", qty: Math.min(12, level) },
  ];
}
