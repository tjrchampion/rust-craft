export type DamageType = "physical" | "fire" | "frost" | "holy" | "nature";
export type SpellTargetKind = "projectile" | "melee" | "self";

export interface SpellTargeting {
  kind: SpellTargetKind;
  range: number;
  /** Projectile only: travel speed before the homing curve-in kicks in. */
  projectileSpeed?: number;
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
}

export const SPELLS: Record<string, SpellDef> = {
  firebolt: {
    id: "firebolt",
    name: "Firebolt",
    castTimeS: 1.2,
    resourceCost: 25,
    cooldownS: 3,
    targeting: { kind: "projectile", range: 30, projectileSpeed: 26 },
    effects: [{ type: "damage", base: 10, powerScale: 2.2, damageType: "fire" }],
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
  },
  charge: {
    id: "charge",
    name: "Battle Fury",
    castTimeS: 0,
    resourceCost: 20,
    cooldownS: 12,
    targeting: { kind: "self", range: 0 },
    effects: [{ type: "applyAura", auraId: "battle_fury", landsOn: "caster" }],
  },
  backstab: {
    id: "backstab",
    name: "Backstab",
    castTimeS: 0,
    resourceCost: 18,
    cooldownS: 5,
    targeting: { kind: "melee", range: 2.2 },
    effects: [{ type: "damage", base: 8, powerScale: 2.6, damageType: "physical" }],
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
  },
  heal: {
    id: "heal",
    name: "Heal",
    castTimeS: 1.5,
    resourceCost: 30,
    cooldownS: 4,
    targeting: { kind: "self", range: 0 },
    effects: [{ type: "heal", base: 10, powerScale: 2.4, landsOn: "caster" }],
  },
  smite: {
    id: "smite",
    name: "Smite",
    castTimeS: 1,
    resourceCost: 22,
    cooldownS: 3,
    targeting: { kind: "projectile", range: 26, projectileSpeed: 30 },
    effects: [{ type: "damage", base: 9, powerScale: 1.9, damageType: "holy" }],
  },
  quick_shot: {
    id: "quick_shot",
    name: "Quick Shot",
    castTimeS: 0.6,
    resourceCost: 15,
    cooldownS: 2,
    targeting: { kind: "projectile", range: 32, projectileSpeed: 34 },
    effects: [{ type: "damage", base: 7, powerScale: 1.7, damageType: "physical" }],
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
  },
  wrath: {
    id: "wrath",
    name: "Wrath",
    castTimeS: 1.3,
    resourceCost: 22,
    cooldownS: 3,
    targeting: { kind: "projectile", range: 28, projectileSpeed: 24 },
    effects: [{ type: "damage", base: 9, powerScale: 2.0, damageType: "nature" }],
  },
  regrowth: {
    id: "regrowth",
    name: "Regrowth",
    castTimeS: 1.0,
    resourceCost: 20,
    cooldownS: 6,
    targeting: { kind: "self", range: 0 },
    effects: [{ type: "applyAura", auraId: "regrowth", landsOn: "caster" }],
  },
  crusader_strike: {
    id: "crusader_strike",
    name: "Crusader Strike",
    castTimeS: 0,
    resourceCost: 18,
    cooldownS: 5,
    targeting: { kind: "melee", range: 2.4 },
    effects: [{ type: "damage", base: 8, powerScale: 2.0, damageType: "holy" }],
  },
  divine_favor: {
    id: "divine_favor",
    name: "Divine Favor",
    castTimeS: 0,
    resourceCost: 20,
    cooldownS: 12,
    targeting: { kind: "self", range: 0 },
    effects: [{ type: "applyAura", auraId: "divine_favor", landsOn: "caster" }],
  },
};

export function spellDef(id: string): SpellDef {
  const def = SPELLS[id];
  if (!def) throw new Error(`Unknown spell: ${id}`);
  return def;
}
