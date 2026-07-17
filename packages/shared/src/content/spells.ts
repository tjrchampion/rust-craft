export type DamageType = "physical" | "fire" | "frost" | "holy" | "nature" | "arcane" | "shadow";
export type SpellTargetKind = "projectile" | "melee" | "self" | "aoe";

export interface SpellTargeting {
  kind: SpellTargetKind;
  range: number;
  /** Projectile only: travel speed before the homing curve-in kicks in. */
  projectileSpeed?: number;
  /** AoE only: burst radius centered on the caster (no ground-targeting
   *  system exists, so all AoE is a self-centered nova). */
  radius?: number;
}

export interface SpellEffect {
  type: "damage" | "heal" | "applyAura";
  /** damage/heal: flat + (casterPower * powerScale). */
  base?: number;
  powerScale?: number;
  damageType?: DamageType;
  /** applyAura: which aura def (see content/auras.ts) this effect applies. */
  auraId?: string;
  /** Who the effect lands on. Defaults to "target" for projectile/melee, "caster" for self. */
  landsOn?: "caster" | "target";
  /** damage only: fraction of the dealt damage returned to the caster as
   *  healing -- a vampiric/drain hit rather than a plain nuke. */
  lifestealPct?: number;
  /** damage only: extra damage multiplier that scales with the target's
   *  missing HP fraction (0 at full HP, up to +executeScale*base at 0 HP) --
   *  an execute-style finisher rather than flat burst. */
  executeScale?: number;
}

export interface SpellDef {
  id: string;
  name: string;
  castTimeS: number;
  /** Deducted from the caster's resource pool (still `mana` on the wire —
   *  class.resourceLabel is purely a display flavor: Mana/Stamina/Energy). */
  resourceCost: number;
  cooldownS: number;
  targeting: SpellTargeting;
  effects: SpellEffect[];
  /** Spawns (or replaces) a companion pet fighting alongside the caster --
   *  a spell-level effect, not a per-target one, so it lives here rather
   *  than in `effects`. `petType` keys into content/mobs.ts for model/stats. */
  summon?: { petType: string };
  requiredLevel?: number;
}

export const SPELLS: Record<string, SpellDef> = {
  firebolt: {
    id: "firebolt",
    name: "Firebolt",
    castTimeS: 1.2,
    resourceCost: 25,
    cooldownS: 3,
    targeting: { kind: "projectile", range: 30, projectileSpeed: 26 },
    effects: [
      { type: "damage", base: 8, powerScale: 1.9, damageType: "fire" },
      { type: "applyAura", auraId: "burning" },
    ],
    requiredLevel: 1,
  },
  frostbolt: {
    id: "frostbolt",
    name: "Frostbolt",
    castTimeS: 1.4,
    resourceCost: 20,
    cooldownS: 4,
    targeting: { kind: "projectile", range: 28, projectileSpeed: 22 },
    effects: [
      { type: "damage", base: 6, powerScale: 1.6, damageType: "frost" },
      { type: "applyAura", auraId: "chilled" },
    ],
    requiredLevel: 2,
  },
  rend: {
    id: "rend",
    name: "Rend",
    castTimeS: 0,
    resourceCost: 15,
    cooldownS: 6,
    targeting: { kind: "melee", range: 2.6 },
    effects: [
      { type: "damage", base: 4, powerScale: 0.8, damageType: "physical" },
      { type: "applyAura", auraId: "bleeding" },
    ],
    requiredLevel: 1,
  },
  charge: {
    id: "charge",
    name: "Battle Fury",
    castTimeS: 0,
    resourceCost: 20,
    cooldownS: 12,
    targeting: { kind: "self", range: 0 },
    effects: [{ type: "applyAura", auraId: "battle_fury", landsOn: "caster" }],
    requiredLevel: 2,
  },
  backstab: {
    id: "backstab",
    name: "Backstab",
    castTimeS: 0,
    resourceCost: 18,
    cooldownS: 5,
    targeting: { kind: "melee", range: 2.2 },
    effects: [{ type: "damage", base: 8, powerScale: 2.6, damageType: "physical" }],
    requiredLevel: 1,
  },
  poison_strike: {
    id: "poison_strike",
    name: "Poison Strike",
    castTimeS: 0,
    resourceCost: 15,
    cooldownS: 6,
    targeting: { kind: "melee", range: 2.2 },
    effects: [
      { type: "damage", base: 3, powerScale: 0.7, damageType: "physical" },
      { type: "applyAura", auraId: "poisoned" },
    ],
    requiredLevel: 2,
  },
  heal: {
    id: "heal",
    name: "Heal",
    castTimeS: 1.5,
    resourceCost: 30,
    cooldownS: 4,
    targeting: { kind: "self", range: 0 },
    effects: [{ type: "heal", base: 10, powerScale: 2.4, landsOn: "caster" }],
    requiredLevel: 1,
  },
  smite: {
    id: "smite",
    name: "Smite",
    castTimeS: 1,
    resourceCost: 22,
    cooldownS: 3,
    targeting: { kind: "projectile", range: 26, projectileSpeed: 30 },
    effects: [{ type: "damage", base: 9, powerScale: 1.9, damageType: "holy" }],
    requiredLevel: 1,
  },
  quick_shot: {
    id: "quick_shot",
    name: "Quick Shot",
    castTimeS: 0.6,
    resourceCost: 15,
    cooldownS: 2,
    targeting: { kind: "projectile", range: 32, projectileSpeed: 34 },
    effects: [{ type: "damage", base: 7, powerScale: 1.7, damageType: "physical" }],
    requiredLevel: 1,
  },
  piercing_shot: {
    id: "piercing_shot",
    name: "Piercing Shot",
    castTimeS: 1.6,
    resourceCost: 26,
    cooldownS: 5,
    targeting: { kind: "projectile", range: 30, projectileSpeed: 28 },
    effects: [
      { type: "damage", base: 11, powerScale: 2.1, damageType: "physical" },
      { type: "applyAura", auraId: "bleeding" },
    ],
    requiredLevel: 6,
  },
  wrath: {
    id: "wrath",
    name: "Wrath",
    castTimeS: 1.3,
    resourceCost: 22,
    cooldownS: 3,
    targeting: { kind: "projectile", range: 28, projectileSpeed: 24 },
    effects: [{ type: "damage", base: 9, powerScale: 2.0, damageType: "nature" }],
    requiredLevel: 1,
  },
  regrowth: {
    id: "regrowth",
    name: "Regrowth",
    castTimeS: 1.0,
    resourceCost: 20,
    cooldownS: 6,
    targeting: { kind: "self", range: 0 },
    effects: [{ type: "applyAura", auraId: "regrowth", landsOn: "caster" }],
    requiredLevel: 2,
  },
  crusader_strike: {
    id: "crusader_strike",
    name: "Crusader Strike",
    castTimeS: 0,
    resourceCost: 18,
    cooldownS: 5,
    targeting: { kind: "melee", range: 2.4 },
    effects: [{ type: "damage", base: 8, powerScale: 2.0, damageType: "holy" }],
    requiredLevel: 1,
  },
  divine_favor: {
    id: "divine_favor",
    name: "Divine Favor",
    castTimeS: 0,
    resourceCost: 20,
    cooldownS: 12,
    targeting: { kind: "self", range: 0 },
    effects: [{ type: "applyAura", auraId: "divine_favor", landsOn: "caster" }],
    requiredLevel: 2,
  },
  whirlwind: {
    id: "whirlwind",
    name: "Whirlwind",
    castTimeS: 0,
    resourceCost: 25,
    cooldownS: 8,
    targeting: { kind: "aoe", range: 0, radius: 4 },
    effects: [{ type: "damage", base: 5, powerScale: 1.1, damageType: "physical" }],
    requiredLevel: 4,
  },
  flame_nova: {
    id: "flame_nova",
    name: "Flame Nova",
    castTimeS: 0.8,
    resourceCost: 30,
    cooldownS: 8,
    targeting: { kind: "aoe", range: 0, radius: 5 },
    effects: [
      { type: "damage", base: 5, powerScale: 1.2, damageType: "fire" },
      { type: "applyAura", auraId: "burning" },
    ],
    requiredLevel: 4,
  },
  fan_of_knives: {
    id: "fan_of_knives",
    name: "Fan of Knives",
    castTimeS: 0,
    resourceCost: 22,
    cooldownS: 8,
    targeting: { kind: "aoe", range: 0, radius: 4 },
    effects: [{ type: "damage", base: 4, powerScale: 1.2, damageType: "physical" }],
    requiredLevel: 4,
  },
  circle_of_healing: {
    id: "circle_of_healing",
    name: "Circle of Healing",
    castTimeS: 1.2,
    resourceCost: 35,
    cooldownS: 10,
    targeting: { kind: "aoe", range: 0, radius: 8 },
    effects: [{ type: "heal", base: 8, powerScale: 1.8 }],
    requiredLevel: 4,
  },
  volley: {
    id: "volley",
    name: "Volley",
    castTimeS: 1.0,
    resourceCost: 28,
    cooldownS: 8,
    targeting: { kind: "aoe", range: 0, radius: 6 },
    effects: [{ type: "damage", base: 6, powerScale: 1.3, damageType: "physical" }],
    requiredLevel: 4,
  },
  thorn_burst: {
    id: "thorn_burst",
    name: "Thorn Burst",
    castTimeS: 0.8,
    resourceCost: 26,
    cooldownS: 8,
    targeting: { kind: "aoe", range: 0, radius: 5 },
    effects: [{ type: "damage", base: 6, powerScale: 1.4, damageType: "nature" }],
    requiredLevel: 4,
  },
  consecration: {
    id: "consecration",
    name: "Consecration",
    castTimeS: 0.8,
    resourceCost: 28,
    cooldownS: 8,
    targeting: { kind: "aoe", range: 0, radius: 5 },
    effects: [{ type: "damage", base: 6, powerScale: 1.3, damageType: "holy" }],
    requiredLevel: 4,
  },
  execute: {
    id: "execute",
    name: "Execute",
    castTimeS: 0,
    resourceCost: 25,
    cooldownS: 10,
    targeting: { kind: "melee", range: 2.6 },
    effects: [{ type: "damage", base: 8, powerScale: 1.4, damageType: "physical", executeScale: 3.0 }],
    requiredLevel: 6,
  },
  shield_wall: {
    id: "shield_wall",
    name: "Shield Wall",
    castTimeS: 0,
    resourceCost: 20,
    cooldownS: 16,
    targeting: { kind: "self", range: 0 },
    effects: [{ type: "applyAura", auraId: "shield_wall", landsOn: "caster" }],
    requiredLevel: 8,
  },
  arcane_blast: {
    id: "arcane_blast",
    name: "Arcane Blast",
    castTimeS: 1.6,
    resourceCost: 30,
    cooldownS: 5,
    targeting: { kind: "projectile", range: 28, projectileSpeed: 30 },
    effects: [
      { type: "damage", base: 11, powerScale: 2.2, damageType: "arcane" },
      { type: "applyAura", auraId: "arcane_silence" },
    ],
    requiredLevel: 6,
  },
  blizzard: {
    id: "blizzard",
    name: "Blizzard",
    castTimeS: 1.2,
    resourceCost: 32,
    cooldownS: 10,
    targeting: { kind: "aoe", range: 0, radius: 6 },
    effects: [
      { type: "damage", base: 5, powerScale: 1.2, damageType: "frost" },
      { type: "applyAura", auraId: "chilled" },
    ],
    requiredLevel: 8,
  },
  eviscerate: {
    id: "eviscerate",
    name: "Eviscerate",
    castTimeS: 0,
    resourceCost: 22,
    cooldownS: 8,
    targeting: { kind: "melee", range: 2.2 },
    effects: [{ type: "damage", base: 7, powerScale: 1.3, damageType: "shadow", executeScale: 2.6 }],
    requiredLevel: 6,
  },
  garrote: {
    id: "garrote",
    name: "Garrote",
    castTimeS: 0,
    resourceCost: 16,
    cooldownS: 6,
    targeting: { kind: "melee", range: 2.2 },
    effects: [
      { type: "damage", base: 3, powerScale: 0.6, damageType: "shadow", lifestealPct: 0.5 },
      { type: "applyAura", auraId: "bleeding" },
    ],
    requiredLevel: 8,
  },
  holy_fire: {
    id: "holy_fire",
    name: "Holy Fire",
    castTimeS: 1.4,
    resourceCost: 26,
    cooldownS: 6,
    targeting: { kind: "projectile", range: 26, projectileSpeed: 28 },
    effects: [
      { type: "damage", base: 7, powerScale: 1.6, damageType: "holy" },
      { type: "applyAura", auraId: "holy_burn" },
    ],
    requiredLevel: 6,
  },
  renew: {
    id: "renew",
    name: "Renew",
    castTimeS: 0,
    resourceCost: 22,
    cooldownS: 8,
    targeting: { kind: "self", range: 0 },
    effects: [{ type: "applyAura", auraId: "renew", landsOn: "caster" }],
    requiredLevel: 2,
  },
  aimed_shot: {
    id: "aimed_shot",
    name: "Aimed Shot",
    castTimeS: 2.0,
    resourceCost: 28,
    cooldownS: 8,
    targeting: { kind: "projectile", range: 34, projectileSpeed: 36 },
    effects: [{ type: "damage", base: 8, powerScale: 1.5, damageType: "physical", executeScale: 2.4 }],
    requiredLevel: 8,
  },
  serpent_sting: {
    id: "serpent_sting",
    name: "Serpent Sting",
    castTimeS: 0.8,
    resourceCost: 18,
    cooldownS: 6,
    targeting: { kind: "projectile", range: 30, projectileSpeed: 30 },
    effects: [
      { type: "damage", base: 4, powerScale: 0.9, damageType: "nature" },
      { type: "applyAura", auraId: "poisoned" },
    ],
    requiredLevel: 2,
  },
  moonfire: {
    id: "moonfire",
    name: "Moonfire",
    castTimeS: 1.0,
    resourceCost: 20,
    cooldownS: 5,
    targeting: { kind: "projectile", range: 28, projectileSpeed: 26 },
    effects: [
      { type: "damage", base: 5, powerScale: 1.1, damageType: "arcane" },
      { type: "applyAura", auraId: "moonfire_burn" },
    ],
    requiredLevel: 6,
  },
  entangling_roots: {
    id: "entangling_roots",
    name: "Entangling Roots",
    castTimeS: 1.0,
    resourceCost: 18,
    cooldownS: 10,
    targeting: { kind: "projectile", range: 24, projectileSpeed: 24 },
    effects: [
      { type: "damage", base: 3, powerScale: 0.6, damageType: "nature" },
      { type: "applyAura", auraId: "entangled" },
    ],
    requiredLevel: 8,
  },
  hammer_of_wrath: {
    id: "hammer_of_wrath",
    name: "Hammer of Wrath",
    castTimeS: 1.0,
    resourceCost: 26,
    cooldownS: 7,
    targeting: { kind: "projectile", range: 26, projectileSpeed: 30 },
    effects: [{ type: "damage", base: 6, powerScale: 1.3, damageType: "holy", executeScale: 2.8 }],
    requiredLevel: 6,
  },
  holy_shield: {
    id: "holy_shield",
    name: "Holy Shield",
    castTimeS: 0,
    resourceCost: 20,
    cooldownS: 16,
    targeting: { kind: "self", range: 0 },
    effects: [{ type: "applyAura", auraId: "holy_shield", landsOn: "caster" }],
    requiredLevel: 8,
  },
  beast_mastery: {
    id: "beast_mastery",
    name: "Beast Mastery",
    castTimeS: 0,
    resourceCost: 30,
    cooldownS: 45,
    targeting: { kind: "self", range: 0 },
    effects: [{ type: "applyAura", auraId: "beast_mastery_buff", landsOn: "caster" }],
    summon: { petType: "wolf" },
    requiredLevel: 10,
  },
};

export function spellDef(id: string): SpellDef {
  const def = SPELLS[id];
  if (!def) throw new Error(`Unknown spell: ${id}`);
  return def;
}
