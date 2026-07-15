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
  iron_sword: "⚔️",
  apprentice_staff: "🪄",
  twin_daggers: "🔪",
  blessed_mace: "🔨",
  hunting_bow: "🏹",
  grove_staff: "🌳",
  sunforged_blade: "⚔️",
  leather_armor: "🥋",
  cloth_robe: "👘",
};

const SPELL_ICONS: Record<string, string> = {
  firebolt: "🔥",
  frostbolt: "❄️",
  rend: "🩸",
  charge: "💢",
  backstab: "🗡️",
  poison_strike: "☠️",
  heal: "💚",
  smite: "⚡",
  quick_shot: "🏹",
  piercing_shot: "🎯",
  wrath: "🍃",
  regrowth: "🌿",
  crusader_strike: "🔨",
  divine_favor: "✨",
};

const MOB_ICONS: Record<string, string> = {
  wolf: "🐺",
  dire_wolf: "🐺",
  skeleton_minion: "💀",
  skeleton_warrior: "💀",
  skeleton_rogue: "💀",
};

/** Illustrated CraftPix icon art, overriding the emoji fallback where we have a matching piece. */
const ITEM_IMAGES: Record<string, string> = {
  bone: "/assets/ui/item_bone.png",
  stone: "/assets/ui/item_stone.png",
  tome_firebolt: "/assets/ui/item_tome_firebolt.png",
  twin_daggers: "/assets/ui/weapon_twin_daggers.png",
};

const SPELL_IMAGES: Record<string, string> = {
  firebolt: "/assets/ui/spell_firebolt.png",
  frostbolt: "/assets/ui/spell_frostbolt.png",
  rend: "/assets/ui/spell_rend.png",
  charge: "/assets/ui/spell_battle_fury.png",
  backstab: "/assets/ui/weapon_twin_daggers.png",
  poison_strike: "/assets/ui/spell_poison_strike.png",
  heal: "/assets/ui/spell_heal.png",
  smite: "/assets/ui/spell_smite.png",
};

/** True for values returned by itemIcon/spellIcon/mobIcon that are image paths, not emoji glyphs. */
export function isIconImage(value: string): boolean {
  return value.startsWith("/assets/");
}

export function itemIcon(itemId: string): string {
  return ITEM_IMAGES[itemId] ?? ICONS[itemId] ?? "❔";
}

export function mobIcon(mobType: string): string {
  return MOB_ICONS[mobType] ?? "👹";
}

export function spellIcon(spellId: string): string {
  return SPELL_IMAGES[spellId] ?? SPELL_ICONS[spellId] ?? "✨";
}
