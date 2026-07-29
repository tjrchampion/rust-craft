/**
 * EDITABLE sound catalog — map gameplay cues to one or more audio files.
 *
 * How to use:
 * - Put files under `packages/client/public/assets/sfx/…`
 * - Add/replace paths in `SFX_MAP` (shared defaults) or `CLASS_SFX` (per class)
 * - One file is picked at random each play (variation)
 * - Empty array `[]` = silence for that cue
 *
 * Resolution order for a cue:
 *   1. CLASS_SFX[classId][key] if present
 *   2. SFX_MAP[key]
 *
 * Footsteps: same clips for walk and sprint. Speed only changes cadence.
 */

import type { ClassId } from "@rustcraft/shared";

function seq(prefix: string, count: number, ext = "ogg"): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}_${i + 1}.${ext}`);
}

const SWORD_SWING = seq("/assets/sfx/combat/sword/sword_attack", 3);
const SWORD_HIT = seq("/assets/sfx/combat/sword/sword_impact_hit", 3);
const BOW_SHOT = seq("/assets/sfx/combat/bow/bow_attack", 2);
const BOW_HIT = seq("/assets/sfx/combat/bow/bow_impact_hit", 3);
const STAFF_SWING = [
  "/assets/sfx/spells/spell_impact_1.ogg",
  "/assets/sfx/spells/spell_impact_2.ogg",
  "/assets/sfx/spells/rock_meteor_throw_1.ogg",
];
const HOLY_SWING = [
  "/assets/sfx/spells/firebuff_1.ogg",
  "/assets/sfx/spells/firebuff_2.ogg",
  "/assets/sfx/spells/spell_impact_1.ogg",
];
const NATURE_SWING = [
  "/assets/sfx/spells/waterspray_1.ogg",
  "/assets/sfx/spells/wave_attack_1.ogg",
  "/assets/sfx/spells/waterspray_2.ogg",
];
const STEALTH_SWING = [
  "/assets/sfx/combat/sword/sword_attack_2.ogg",
  "/assets/sfx/combat/sword/sword_attack_3.ogg",
  "/assets/sfx/combat/sword/sword_sheath_1.ogg",
];
const WRENCH_SWING = [
  "/assets/sfx/gather/mine_1.ogg",
  "/assets/sfx/gather/mine_2.ogg",
  "/assets/sfx/combat/sword/sword_attack_1.ogg",
];

/**
 * Shared defaults (any class without an override uses these).
 */
export const SFX_MAP = {
  // —— Footsteps by ground surface (shared for walk + run) ——
  footstep_dirt: seq("/assets/sfx/footsteps/dirt/dirt_walk", 5),
  footstep_stone: seq("/assets/sfx/footsteps/stone/stone_walk", 5),
  footstep_wood: seq("/assets/sfx/footsteps/wood/wood_walk", 5),
  footstep_water: seq("/assets/sfx/footsteps/water/water_walk", 5),

  // —— Melee / ranged (generic fallback) ——
  swing: SWORD_SWING,
  bow_shot: BOW_SHOT,
  hit_flesh: SWORD_HIT,
  hit_taken: SWORD_HIT,
  block: ["/assets/sfx/combat/sword/sword_blocked_1.ogg", "/assets/sfx/combat/sword/sword_parry_1.ogg"],
  dodge: ["/assets/sfx/combat/sword/sword_attack_2.ogg"],

  // —— Mobs ——
  mob_attack: SWORD_SWING,
  mob_death: SWORD_HIT,
  death: ["/assets/sfx/combat/sword/sword_impact_hit_3.ogg", "/assets/sfx/combat/sword/sword_blocked_1.ogg"],

  // —— Gathering ——
  chop: seq("/assets/sfx/gather/chop", 4),
  mine: seq("/assets/sfx/gather/mine", 4),
  pick: seq("/assets/sfx/gather/mine", 4),

  // —— Loot / UI / misc ——
  loot: [
    "/assets/sfx/loot/chest_open_1.ogg",
    "/assets/sfx/loot/chest_open_2.ogg",
    "/assets/sfx/loot/lock_unlock.ogg",
  ],
  loot_drop: ["/assets/sfx/loot/chest_close_1.ogg", "/assets/sfx/loot/door_open_1.ogg"],
  equip: ["/assets/sfx/combat/sword/sword_unsheath_1.ogg", "/assets/sfx/ui/light_torch_1.ogg"],
  craft: ["/assets/sfx/loot/lock_unlock.ogg", "/assets/sfx/ui/light_torch_1.ogg"],
  ui: ["/assets/sfx/ui/light_torch_1.ogg"],
  target: ["/assets/sfx/ui/light_torch_1.ogg"],
  eat: ["/assets/sfx/loot/chest_close_1.ogg"],
  levelup: ["/assets/sfx/spells/firebuff_1.ogg", "/assets/sfx/spells/spell_impact_1.ogg"],

  // —— Spells: cast ——
  spell_cast_fire: [
    "/assets/sfx/spells/fireball_1.ogg",
    "/assets/sfx/spells/fireball_2.ogg",
    "/assets/sfx/spells/firespray_1.ogg",
  ],
  spell_cast_frost: [
    "/assets/sfx/spells/ice_throw_1.ogg",
    "/assets/sfx/spells/ice_throw_2.ogg",
    "/assets/sfx/spells/ice_barrage_1.ogg",
  ],
  spell_cast_nature: ["/assets/sfx/spells/waterspray_1.ogg", "/assets/sfx/spells/wave_attack_1.ogg"],
  spell_cast_heal: [
    "/assets/sfx/spells/waterspray_1.ogg",
    "/assets/sfx/spells/waterspray_2.ogg",
    "/assets/sfx/spells/firebuff_2.ogg",
  ],
  spell_cast_holy: HOLY_SWING,
  spell_cast_arcane: ["/assets/sfx/spells/rock_meteor_throw_1.ogg", "/assets/sfx/spells/spell_impact_2.ogg"],
  spell_cast_shadow: ["/assets/sfx/spells/rock_meteor_swarm_1.ogg", "/assets/sfx/spells/ice_freeze_1.ogg"],
  spell_cast_physical: SWORD_SWING,
  spell_cast_buff: ["/assets/sfx/spells/firebuff_1.ogg", "/assets/sfx/spells/firebuff_2.ogg"],

  // —— Spells: impact ——
  spell_hit_fire: [
    "/assets/sfx/spells/fireball_3.ogg",
    "/assets/sfx/spells/spell_impact_1.ogg",
    "/assets/sfx/spells/firespray_1.ogg",
  ],
  spell_hit_frost: [
    "/assets/sfx/spells/ice_freeze_1.ogg",
    "/assets/sfx/spells/ice_wall_1.ogg",
    "/assets/sfx/spells/spell_impact_2.ogg",
  ],
  spell_hit_nature: [
    "/assets/sfx/spells/wave_attack_1.ogg",
    "/assets/sfx/spells/waterspray_2.ogg",
    "/assets/sfx/spells/spell_impact_3.ogg",
  ],
  spell_hit_heal: ["/assets/sfx/spells/waterspray_2.ogg", "/assets/sfx/spells/firebuff_2.ogg"],
  spell_hit_holy: ["/assets/sfx/spells/spell_impact_1.ogg", "/assets/sfx/spells/firebuff_1.ogg"],
  spell_hit_arcane: [
    "/assets/sfx/spells/rock_wall_1.ogg",
    "/assets/sfx/spells/spell_impact_2.ogg",
    "/assets/sfx/spells/spell_impact_3.ogg",
  ],
  spell_hit_shadow: ["/assets/sfx/spells/ice_freeze_1.ogg", "/assets/sfx/spells/spell_impact_3.ogg"],
  spell_hit_physical: SWORD_HIT,
  spell_hit_buff: ["/assets/sfx/spells/firebuff_2.ogg", "/assets/sfx/spells/spell_impact_1.ogg"],
} as const satisfies Record<string, readonly string[]>;

export type SfxMapKey = keyof typeof SFX_MAP;

/**
 * Per-class overrides — only list cues you want different from SFX_MAP.
 * You can override any key (swing, bow_shot, spell_cast_fire, …).
 */
export const CLASS_SFX: Record<ClassId, Partial<Record<SfxMapKey, readonly string[]>>> = {
  warrior: {
    swing: SWORD_SWING,
    hit_flesh: SWORD_HIT,
    hit_taken: SWORD_HIT,
    block: ["/assets/sfx/combat/sword/sword_blocked_1.ogg", "/assets/sfx/combat/sword/sword_parry_1.ogg"],
    dodge: ["/assets/sfx/combat/sword/sword_attack_2.ogg"],
    equip: ["/assets/sfx/combat/sword/sword_unsheath_1.ogg"],
    death: ["/assets/sfx/combat/sword/sword_impact_hit_3.ogg", "/assets/sfx/combat/sword/sword_blocked_1.ogg"],
  },
  berserker: {
    swing: SWORD_SWING,
    hit_flesh: SWORD_HIT,
    hit_taken: SWORD_HIT,
    dodge: ["/assets/sfx/combat/sword/sword_attack_1.ogg", "/assets/sfx/combat/sword/sword_attack_3.ogg"],
    equip: ["/assets/sfx/combat/sword/sword_unsheath_1.ogg"],
    death: ["/assets/sfx/combat/sword/sword_impact_hit_3.ogg"],
  },
  paladin: {
    swing: [...SWORD_SWING, ...HOLY_SWING],
    hit_flesh: [...SWORD_HIT, "/assets/sfx/spells/spell_impact_1.ogg"],
    hit_taken: SWORD_HIT,
    block: ["/assets/sfx/combat/sword/sword_parry_1.ogg", "/assets/sfx/spells/firebuff_1.ogg"],
    dodge: ["/assets/sfx/combat/sword/sword_attack_2.ogg"],
    equip: ["/assets/sfx/combat/sword/sword_unsheath_1.ogg", "/assets/sfx/spells/firebuff_2.ogg"],
    spell_cast_physical: [...SWORD_SWING, ...HOLY_SWING],
    spell_hit_physical: [...SWORD_HIT, "/assets/sfx/spells/spell_impact_1.ogg"],
  },
  rogue: {
    swing: STEALTH_SWING,
    hit_flesh: SWORD_HIT,
    hit_taken: SWORD_HIT,
    dodge: ["/assets/sfx/combat/sword/sword_sheath_1.ogg", "/assets/sfx/combat/sword/sword_attack_2.ogg"],
    equip: ["/assets/sfx/combat/sword/sword_sheath_1.ogg", "/assets/sfx/combat/sword/sword_unsheath_1.ogg"],
    death: ["/assets/sfx/combat/sword/sword_impact_hit_2.ogg"],
  },
  assassin: {
    swing: STEALTH_SWING,
    hit_flesh: [...SWORD_HIT, "/assets/sfx/spells/ice_freeze_1.ogg"],
    hit_taken: SWORD_HIT,
    dodge: ["/assets/sfx/combat/sword/sword_sheath_1.ogg", "/assets/sfx/combat/sword/sword_attack_3.ogg"],
    equip: ["/assets/sfx/combat/sword/sword_sheath_1.ogg"],
    spell_cast_physical: STEALTH_SWING,
    spell_hit_physical: [...SWORD_HIT, "/assets/sfx/spells/ice_freeze_1.ogg"],
  },
  ranger: {
    swing: SWORD_SWING,
    bow_shot: BOW_SHOT,
    hit_flesh: BOW_HIT,
    hit_taken: SWORD_HIT,
    dodge: ["/assets/sfx/combat/bow/bow_attack_1.ogg", "/assets/sfx/combat/sword/sword_attack_2.ogg"],
    equip: ["/assets/sfx/combat/bow/bow_attack_2.ogg", "/assets/sfx/combat/sword/sword_unsheath_1.ogg"],
    spell_cast_physical: BOW_SHOT,
    spell_hit_physical: BOW_HIT,
  },
  mage: {
    swing: STAFF_SWING,
    hit_flesh: [
      "/assets/sfx/spells/spell_impact_1.ogg",
      "/assets/sfx/spells/spell_impact_2.ogg",
      "/assets/sfx/spells/spell_impact_3.ogg",
    ],
    hit_taken: ["/assets/sfx/spells/spell_impact_2.ogg", "/assets/sfx/combat/sword/sword_impact_hit_1.ogg"],
    dodge: ["/assets/sfx/spells/spell_impact_1.ogg"],
    equip: ["/assets/sfx/spells/firebuff_1.ogg", "/assets/sfx/ui/light_torch_1.ogg"],
    death: ["/assets/sfx/spells/rock_meteor_swarm_1.ogg", "/assets/sfx/spells/spell_impact_3.ogg"],
  },
  cleric: {
    swing: HOLY_SWING,
    hit_flesh: ["/assets/sfx/spells/spell_impact_1.ogg", "/assets/sfx/spells/firebuff_1.ogg", ...SWORD_HIT],
    hit_taken: SWORD_HIT,
    dodge: ["/assets/sfx/spells/firebuff_2.ogg"],
    equip: ["/assets/sfx/spells/firebuff_1.ogg", "/assets/sfx/combat/sword/sword_unsheath_1.ogg"],
    spell_cast_physical: HOLY_SWING,
    spell_hit_physical: ["/assets/sfx/spells/spell_impact_1.ogg", "/assets/sfx/spells/firebuff_1.ogg"],
  },
  druid: {
    swing: NATURE_SWING,
    hit_flesh: [
      "/assets/sfx/spells/wave_attack_1.ogg",
      "/assets/sfx/spells/waterspray_2.ogg",
      "/assets/sfx/spells/spell_impact_3.ogg",
    ],
    hit_taken: ["/assets/sfx/spells/waterspray_1.ogg", ...SWORD_HIT],
    dodge: ["/assets/sfx/spells/waterspray_1.ogg"],
    equip: ["/assets/sfx/spells/waterspray_2.ogg", "/assets/sfx/ui/light_torch_1.ogg"],
    spell_cast_physical: NATURE_SWING,
    spell_hit_physical: [
      "/assets/sfx/spells/wave_attack_1.ogg",
      "/assets/sfx/spells/waterspray_2.ogg",
      "/assets/sfx/spells/spell_impact_3.ogg",
    ],
  },
  engineer: {
    swing: WRENCH_SWING,
    hit_flesh: ["/assets/sfx/gather/mine_3.ogg", "/assets/sfx/gather/mine_4.ogg", ...SWORD_HIT],
    hit_taken: SWORD_HIT,
    dodge: ["/assets/sfx/gather/mine_1.ogg", "/assets/sfx/combat/sword/sword_attack_2.ogg"],
    equip: ["/assets/sfx/loot/lock_unlock.ogg", "/assets/sfx/gather/mine_2.ogg"],
    block: ["/assets/sfx/combat/sword/sword_blocked_1.ogg", "/assets/sfx/gather/mine_1.ogg"],
    spell_cast_physical: WRENCH_SWING,
    spell_hit_physical: ["/assets/sfx/gather/mine_3.ogg", ...SWORD_HIT],
  },
};

/** Biome → footstep surface key suffix (`footstep_${surface}`). Edit freely. */
export type FootSurface = "dirt" | "stone" | "wood" | "water";

export const BIOME_FOOT_SURFACE: Record<string, FootSurface> = {
  meadow: "dirt",
  forest: "dirt",
  swamp: "water",
  hills: "stone",
  mountain: "stone",
  dunes: "stone",
};

/** Resolve a bank: class override → shared map. */
export function resolveSfxBank(key: SfxMapKey, classId?: string | null): readonly string[] {
  if (classId) {
    const override = CLASS_SFX[classId as ClassId]?.[key];
    if (override !== undefined) return override;
  }
  return SFX_MAP[key] ?? [];
}

/** Every unique URL referenced by the catalogs (for preload). */
export function allSfxUrls(): string[] {
  const urls = new Set<string>();
  for (const bank of Object.values(SFX_MAP)) {
    for (const u of bank) urls.add(u);
  }
  for (const byClass of Object.values(CLASS_SFX)) {
    for (const bank of Object.values(byClass)) {
      if (!bank) continue;
      for (const u of bank) urls.add(u);
    }
  }
  return [...urls];
}
