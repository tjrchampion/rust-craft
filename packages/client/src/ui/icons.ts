const ICONS: Record<string, string> = {
  wood: "🪵",
  stone: "🪨",
  hide: "🟤",
  bone: "🦴",
  ancient_dust: "✨",
  berries: "🫐",
  raw_meat: "🥩",
  cooked_meat: "🍖",
  bandage: "🩹",
  axe: "🪓",
  pickaxe: "⛏️",
  spear: "🔱",
  torch: "🔥",
  campfire: "🏕️",
  tome_firebolt: "📕",
  firebolt: "🔥",
  saddle: "🐴",
  raft: "🛶",
};

const MOB_ICONS: Record<string, string> = {
  wolf: "🐺",
  dire_wolf: "🐺",
  skeleton_minion: "💀",
  skeleton_warrior: "💀",
  skeleton_rogue: "💀",
};

export function itemIcon(itemId: string): string {
  return ICONS[itemId] ?? "❔";
}

export function mobIcon(mobType: string): string {
  return MOB_ICONS[mobType] ?? "👹";
}
