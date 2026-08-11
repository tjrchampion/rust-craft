const ICONS: Record<string, string> = {
  reward_chest: "🎁",
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
  axe_1handed: "🪓",
  axe_1handed_large: "🪓",
  axe_2handed: "🪓",
  axe_2handed_large: "🪓",
  bow: "🏹",
  crossbow_1handed: "🏹",
  crossbow_2handed: "🏹",
  dagger: "🗡️",
  druid_staff: "🌲",
  wand: "🪄",
  shield_badge: "🛡️",
  shield_round: "🛡️",
  shield_square: "🛡️",
  shield_spikes: "🛡️",
  wrench: "🔧",
  leather_armor: "🥋",
  cloth_robe: "👘",
  minor_healing_potion: "🧪",
  runic_healing_potion: "🍷",
  minor_mana_potion: "🧪",
  runic_mana_potion: "🥣",
  frontline_potion: "🧉",
  potion_focus: "🍹",
  invisibility_potion: "🌫️",
  free_action_potion: "👟",
  flask_titan: "🏺",
  phial_quickness: "🫙",
  copper_ore: "🟠",
  tin_ore: "⚪",
  iron_ore: "🔩",
  mithril_ore: "🔵",
  thorium_ore: "🟢",
  silver_ore: "🥈",
  gold_ore: "🥇",
  mithril_pickaxe: "⛏️",
  thorium_pickaxe: "⛏️",
  wolf_fang: "🦷",
  yeti_claw: "🐾",
  golem_core: "🔮",
  demon_horn: "😈",
  dragon_scale: "🐉",
  fanged_dagger: "🗡️",
  frostclaw_axe: "🪓",
  runic_staff: "🪄",
  demonbone_bow: "🏹",
  dragonscale_ward: "🛡️",
  short_sword: "⚔️",
  broadsword: "⚔️",
  runeblade: "⚔️",
  battle_axe: "🪓",
  war_axe: "🪓",
  short_bow: "🏹",
  longbow: "🏹",
  oak_staff: "🪄",
  arcane_rod: "🪄",
  crystal_wand: "🪄",
  curved_dagger: "🗡️",
  serrated_dagger: "🗡️",
  kite_shield: "🛡️",
  heater_shield: "🛡️",
  halberd: "⚜️",
  reaper_scythe: "⚜️",
  brass_knuckles: "🥊",
  war_gauntlets: "🥊",
  iron_spear: "🔱",
  peasant_hood: "🧢",
  peasant_chest: "👕",
  peasant_arms: "🧤",
  peasant_legs: "👖",
  peasant_feet: "🥾",
  ranger_hood: "🧢",
  ranger_chest: "🥋",
  ranger_arms: "🧤",
  ranger_legs: "👖",
  ranger_feet: "🥾",
  ranger_pauldrons: "🛡️",
  noble_crown: "👑",
  noble_chest: "🧥",
  noble_arms: "🧤",
  noble_legs: "👖",
  noble_feet: "👞",
  noble_pauldrons: "🛡️",
  noble_pauldrons_lion: "🦁",
  noble_gorget: "🧣",
  wizard_chest: "👘",
  wizard_arms: "🧤",
  wizard_legs: "👖",
  wizard_feet: "🥾",
  knight_helmet: "⛑️",
  knight_horns: "😈",
  knight_chest: "🛡️",
  knight_chest_cloth: "🧥",
  knight_arms: "🥊",
  knight_legs: "🦿",
  knight_feet: "🥾",
  knight_pauldrons_round: "🛡️",
  knight_pauldrons_spike: "🗡️",
  knight_scarf: "🧣",
};

function makeSvgIcon(bg1: string, bg2: string, border: string, symbolSvg: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${bg1}"/><stop offset="100%" stop-color="${bg2}"/></linearGradient></defs><rect width="64" height="64" rx="4" fill="url(#g)"/><rect x="1" y="1" width="62" height="62" rx="3" fill="none" stroke="${border}" stroke-width="2" opacity="0.75"/>${symbolSvg}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const SVG_SPELL_GRAPHICS: Record<string, string> = {
  // Fire
  fireball: makeSvgIcon("#3a0800", "#7a1a00", "#ff6600", `<circle cx="32" cy="32" r="16" fill="#ffaa00"/><path fill="#ff3300" d="M32 10 Q40 24 32 38 Q24 24 32 10 Z"/>`),
  pyroblast: makeSvgIcon("#4a0500", "#9a1000", "#ffaa00", `<circle cx="32" cy="32" r="20" fill="#ff4400"/><circle cx="32" cy="32" r="12" fill="#ffff44"/>`),
  flame_nova: makeSvgIcon("#300a00", "#701800", "#ff8800", `<circle cx="32" cy="32" r="18" fill="none" stroke="#ff4400" stroke-width="4"/><path fill="#ffaa00" d="M32 16 L35 27 L46 32 L35 37 L32 48 L29 37 L18 32 L29 27 Z"/>`),
  holy_fire: makeSvgIcon("#3a2000", "#7a4800", "#ffcc00", `<path fill="#ffee44" d="M32 10 Q44 26 32 44 Q20 26 32 10 Z"/><path fill="#ffffff" d="M32 18 Q38 28 32 40 Q26 28 32 18 Z"/>`),

  // Frost
  frost_nova: makeSvgIcon("#00203a", "#00487a", "#44eeff", `<path stroke="#88eeff" stroke-width="3" fill="none" d="M32 12 V52 M12 32 H52 M18 18 L46 46 M46 18 L18 46"/>`),
  ice_block: makeSvgIcon("#00304a", "#00608a", "#88eeff", `<polygon points="32,10 48,22 48,42 32,54 16,42 16,22" fill="#44ccff" opacity="0.8" stroke="#ffffff" stroke-width="2"/>`),
  blizzard: makeSvgIcon("#051828", "#0a3858", "#66ddee", `<path stroke="#ffffff" stroke-width="2.5" fill="none" d="M22 18 L42 46 M42 18 L22 46 M32 14 V50"/>`),

  // Physical / Melee
  cleave: makeSvgIcon("#3a1a00", "#7a3a00", "#ffaa22", `<path fill="#ffaa00" d="M14 48 Q32 12 50 16 Q32 30 14 48 Z"/>`),
  whirlwind: makeSvgIcon("#282015", "#584428", "#ddaa44", `<path stroke="#ffeeaa" stroke-width="3.5" fill="none" d="M32 32 M24 24 A12 12 0 1 1 40 40 A18 18 0 1 1 16 28"/>`),
  executing_blow: makeSvgIcon("#4a0000", "#8a0000", "#ff2222", `<path fill="#ff4444" d="M16 16 L48 48 M48 16 L16 48" stroke="#ff2222" stroke-width="6"/>`),
  execute: makeSvgIcon("#4a0000", "#8a0000", "#ff2222", `<path fill="#ff3333" d="M16 16 L48 48 M48 16 L16 48" stroke="#ff3333" stroke-width="6"/>`),
  recklessness: makeSvgIcon("#4a0800", "#8a1800", "#ff4400", `<circle cx="32" cy="32" r="18" fill="none" stroke="#ff3300" stroke-width="4"/><path fill="#ffff00" d="M32 14 L36 28 L50 32 L36 36 L32 50 L28 36 L14 32 L28 28 Z"/>`),
  shield_wall: makeSvgIcon("#202028", "#404058", "#aaaacc", `<path fill="#6688aa" stroke="#ffffff" stroke-width="2" d="M18 16 L46 16 L46 36 Q32 52 18 36 Z"/>`),

  // Ranger
  quick_shot: makeSvgIcon("#3a2800", "#7a5800", "#ffcc33", `<path stroke="#ffdd44" stroke-width="3" fill="none" d="M16 48 L48 16 M48 16 H34 M48 16 V30"/>`),
  piercing_shot: makeSvgIcon("#3a2800", "#7a5800", "#ffcc33", `<path stroke="#ffffff" stroke-width="4" fill="none" d="M12 52 L52 12 M52 12 H36 M52 12 V28"/>`),
  aimed_shot: makeSvgIcon("#3a2800", "#7a5800", "#ffaa00", `<circle cx="32" cy="32" r="18" fill="none" stroke="#ffcc00" stroke-width="3"/><circle cx="32" cy="32" r="8" fill="#ff4400"/>`),
  volley: makeSvgIcon("#282000", "#584800", "#ddcc44", `<path stroke="#ffdd44" stroke-width="2.5" fill="none" d="M20 16 L32 44 M32 16 L44 44 M44 16 L20 44"/>`),
  serpent_sting: makeSvgIcon("#0a3010", "#186020", "#44ff66", `<path stroke="#44ff66" stroke-width="3" fill="none" d="M16 40 Q32 16 48 40 M24 24 Q32 40 40 24"/>`),
  beast_mastery: makeSvgIcon("#2a1a08", "#5a3a18", "#ddaa66", `<circle cx="32" cy="32" r="16" fill="#cc8844"/><path fill="#ffffff" d="M24 24 L28 32 L20 32 Z M40 24 L44 32 L36 32 Z"/>`),

  // Holy
  flash_heal: makeSvgIcon("#3a3000", "#7a6800", "#ffee66", `<path fill="#ffee44" d="M26 12 H38 V26 H52 V38 H38 V52 H26 V38 H12 V26 H26 Z"/>`),
  circle_of_healing: makeSvgIcon("#3a3000", "#7a6800", "#ffee66", `<circle cx="32" cy="32" r="18" fill="none" stroke="#ffee44" stroke-width="4"/><path fill="#ffffff" d="M28 18 H36 V28 H46 V36 H36 V46 H28 V36 H18 V28 H28 Z"/>`),
  crusader_strike: makeSvgIcon("#3a2800", "#7a5000", "#ffbb22", `<path fill="#ffcc33" d="M18 16 H46 V26 H36 V48 H28 V26 H18 Z"/>`),
  divine_favor: makeSvgIcon("#3a3000", "#7a6800", "#ffffff", `<path fill="#ffffff" d="M32 10 L36 26 L52 32 L36 38 L32 54 L28 38 L12 32 L28 26 Z"/>`),
  consecration: makeSvgIcon("#3a2a00", "#7a5a00", "#ffaa00", `<ellipse cx="32" cy="36" rx="20" ry="10" fill="none" stroke="#ffee44" stroke-width="3"/><path fill="#ffaa00" d="M32 14 L35 26 L32 34 L29 26 Z"/>`),
  renew: makeSvgIcon("#103020", "#206040", "#66ffaa", `<circle cx="32" cy="32" r="16" fill="none" stroke="#66ffaa" stroke-width="3"/><path fill="#ffffff" d="M29 20 H35 V29 H44 V35 H35 V44 H29 V35 H20 V29 H29 Z"/>`),
  hammer_of_wrath: makeSvgIcon("#3a2800", "#7a5000", "#ffee44", `<path fill="#ffee44" d="M16 16 H48 V30 H16 Z M28 30 H36 V52 H28 Z"/>`),
  holy_shield: makeSvgIcon("#3a3000", "#7a6000", "#ffee66", `<path fill="#ffdd44" stroke="#ffffff" stroke-width="2" d="M18 16 L46 16 L46 36 Q32 52 18 36 Z"/><path fill="#ffffff" d="M29 22 H35 V29 H42 V35 H35 V42 H29 V35 H22 V29 H29 Z"/>`),

  // Druid
  wrath: makeSvgIcon("#0a3818", "#187830", "#66ff88", `<circle cx="32" cy="32" r="16" fill="#44ff66"/><path fill="#ffffff" d="M32 16 Q40 28 32 42 Q24 28 32 16 Z"/>`),
  moonfire: makeSvgIcon("#00283a", "#00587a", "#88eeff", `<path fill="#88eeff" d="M36 14 A18 18 0 1 0 50 36 A14 14 0 1 1 36 14 Z"/>`),
  regrowth: makeSvgIcon("#083018", "#106030", "#55ff77", `<path fill="#44ff66" d="M32 14 C44 24 40 44 32 50 C24 44 20 24 32 14 Z"/>`),
  thorn_burst: makeSvgIcon("#202810", "#405020", "#88dd44", `<path fill="#aadd44" d="M32 12 L36 26 L48 20 L38 32 L50 40 L36 40 L32 52 L28 40 L14 40 L26 32 L16 20 L28 26 Z"/>`),
  entangling_roots: makeSvgIcon("#182810", "#305020", "#66cc44", `<path stroke="#88ee44" stroke-width="3.5" fill="none" d="M16 48 Q24 24 32 36 T48 16"/>`),

  // Rogue / Assassin
  fan_of_knives: makeSvgIcon("#281030", "#582060", "#cc66ff", `<path fill="#dd88ff" d="M32 14 L36 28 L50 32 L36 36 L32 50 L28 36 L14 32 L28 28 Z"/>`),
  eviscerate: makeSvgIcon("#3a0010", "#7a0020", "#ff3366", `<path fill="#ff2255" d="M18 46 L46 18 M24 16 L48 40" stroke="#ff2255" stroke-width="5"/>`),
  garrote: makeSvgIcon("#300018", "#600030", "#ff2266", `<path stroke="#ff3377" stroke-width="4" fill="none" d="M16 24 C32 12 48 24 48 40"/>`),

  // Shadow / Arcane
  shadowbolt: makeSvgIcon("#200030", "#450065", "#cc44ff", `<circle cx="32" cy="32" r="16" fill="#aa22ee"/><circle cx="32" cy="32" r="10" fill="#220044"/>`),
  arcane_blast: makeSvgIcon("#180038", "#380070", "#dd66ff", `<polygon points="32,12 46,24 46,40 32,52 18,40 18,24" fill="none" stroke="#dd66ff" stroke-width="3"/><circle cx="32" cy="32" r="8" fill="#ffffff"/>`),
  curse_of_agony: makeSvgIcon("#280030", "#580060", "#ff44cc", `<circle cx="32" cy="32" r="16" fill="none" stroke="#ff44cc" stroke-width="3"/><path fill="#ff44cc" d="M26 24 A4 4 0 1 1 26 24.1 M38 24 A4 4 0 1 1 38 24.1 M24 40 Q32 30 40 40"/>`),

  // Engineer / Steam
  steam_blast: makeSvgIcon("#302010", "#604020", "#ffaa44", `<circle cx="32" cy="32" r="18" fill="none" stroke="#ffaa44" stroke-width="4"/><path fill="#ffffff" opacity="0.6" d="M22 40 Q32 20 42 40"/>`),
  repair_pulse: makeSvgIcon("#202830", "#405060", "#66ccff", `<path fill="#44aaff" d="M18 18 H46 V28 H36 V46 H26 V28 H18 Z"/>`),
  steam_focus: makeSvgIcon("#302818", "#605030", "#ffcc66", `<circle cx="32" cy="32" r="18" fill="none" stroke="#ffcc44" stroke-width="4"/><circle cx="32" cy="32" r="8" fill="#ffcc44"/>`),
  overcharge: makeSvgIcon("#3a2800", "#7a5800", "#ffee44", `<path fill="#ffee44" d="M36 10 L18 34 H32 L28 54 L46 30 H32 Z"/>`),
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
  return value.startsWith("/assets/") || value.startsWith("data:image/");
}

export function itemIcon(itemId: string): string {
  return ITEM_IMAGES[itemId] ?? ICONS[itemId] ?? "❔";
}

export function mobIcon(mobType: string): string {
  return MOB_ICONS[mobType] ?? "👹";
}

export function spellIcon(spellId: string): string {
  return SPELL_IMAGES[spellId] ?? SVG_SPELL_GRAPHICS[spellId] ?? SPELL_IMAGES.firebolt ?? "❔";
}

export function rewardChestIcon(): string {
  return ICONS.reward_chest ?? "🎁";
}
