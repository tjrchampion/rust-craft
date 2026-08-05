/**
 * Declarative 3D Spell VFX Specifications
 *
 * Defines the visual identity (color palette, windup, trail style, impact shockwaves,
 * ground decals, and buff orbits) for all spells in the game.
 */

export interface SpellVfxPalette {
  primary: number;
  secondary: number;
  emissive?: number;
}

export type WindupStyle = "orb" | "gather" | "swirl" | "charge" | "holy_light" | "none";
export type TrailStyle = "comet" | "lightning" | "ribbon" | "arc_slash" | "none";
export type DecalStyle = "scorch" | "frost" | "holy" | "shadow" | "cracked_earth" | "none";
export type BuffOrbitStyle = "halo" | "shields" | "runes" | "wings" | "weapon_glow" | "none";

export interface SpellVfxSpec {
  palette: SpellVfxPalette;
  windup?: {
    style: WindupStyle;
    duration?: number;
    scale?: number;
  };
  trail?: {
    style: TrailStyle;
    scale?: number;
  };
  impact?: {
    ringRadius?: number;
    burstCount?: number;
    decal?: DecalStyle;
    shakeIntensity?: number;
  };
  buffOrbit?: {
    style: BuffOrbitStyle;
    count?: number;
  };
}

export const SCHOOL_PALETTES: Record<string, SpellVfxPalette> = {
  physical: { primary: 0xffcc44, secondary: 0xaa7722, emissive: 0xffaa00 },
  fire: { primary: 0xff4400, secondary: 0xffaa00, emissive: 0xff2200 },
  frost: { primary: 0x44ccff, secondary: 0x88eeff, emissive: 0x0088ff },
  holy: { primary: 0xffdd44, secondary: 0xffffff, emissive: 0xffaa00 },
  nature: { primary: 0x44ff66, secondary: 0x88ffaa, emissive: 0x00cc44 },
  arcane: { primary: 0xcc44ff, secondary: 0xee88ff, emissive: 0xaa00ff },
  shadow: { primary: 0x8822cc, secondary: 0x440066, emissive: 0x660099 },
};

export const SPELL_VFX_SPECS: Record<string, SpellVfxSpec> = {
  // --- Physical / Melee / Warrior / Berserker ---
  attack: {
    palette: SCHOOL_PALETTES.physical,
    trail: { style: "arc_slash", scale: 1.0 },
    impact: { ringRadius: 0.8, burstCount: 8, decal: "cracked_earth" },
  },
  cleave: {
    palette: { primary: 0xffaa00, secondary: 0xff3300 },
    trail: { style: "arc_slash", scale: 1.8 },
    impact: { ringRadius: 1.8, burstCount: 16, decal: "cracked_earth" },
  },
  rend: {
    palette: { primary: 0xcc1100, secondary: 0x660000 },
    trail: { style: "arc_slash", scale: 1.5 },
    impact: { ringRadius: 1.5, burstCount: 14, decal: "scorch" },
  },
  execute: {
    palette: { primary: 0xff0000, secondary: 0x880000 },
    windup: { style: "charge", scale: 1.5 },
    trail: { style: "arc_slash", scale: 2.5 },
    impact: { ringRadius: 3.0, burstCount: 30, decal: "scorch", shakeIntensity: 0.6 },
  },
  executing_blow: {
    palette: { primary: 0xff2200, secondary: 0x880000 },
    windup: { style: "charge", scale: 1.5 },
    trail: { style: "arc_slash", scale: 2.2 },
    impact: { ringRadius: 2.5, burstCount: 24, decal: "scorch", shakeIntensity: 0.5 },
  },
  whirlwind: {
    palette: SCHOOL_PALETTES.physical,
    trail: { style: "arc_slash", scale: 2.5 },
    impact: { ringRadius: 3.5, burstCount: 30, decal: "cracked_earth" },
  },
  charge: {
    palette: { primary: 0xffaa22, secondary: 0xff4400 },
    windup: { style: "charge", scale: 1.2 },
    trail: { style: "ribbon", scale: 1.5 },
    impact: { ringRadius: 2.0, burstCount: 18, decal: "cracked_earth", shakeIntensity: 0.4 },
  },
  recklessness: {
    palette: { primary: 0xff2200, secondary: 0xffaa00 },
    windup: { style: "swirl", scale: 1.5 },
    buffOrbit: { style: "weapon_glow", count: 2 },
    impact: { ringRadius: 2.5, burstCount: 20, decal: "cracked_earth" },
  },

  // --- Ranger / Hunter ---
  quick_shot: {
    palette: SCHOOL_PALETTES.physical,
    trail: { style: "comet", scale: 0.8 },
    impact: { ringRadius: 0.9, burstCount: 10, decal: "cracked_earth" },
  },
  piercing_shot: {
    palette: { primary: 0xffcc33, secondary: 0xff8800 },
    windup: { style: "gather", scale: 1.1 },
    trail: { style: "lightning", scale: 1.2 },
    impact: { ringRadius: 1.8, burstCount: 18, decal: "cracked_earth" },
  },
  aimed_shot: {
    palette: { primary: 0xffdd44, secondary: 0xcc6600 },
    windup: { style: "gather", scale: 1.8 },
    trail: { style: "comet", scale: 1.6 },
    impact: { ringRadius: 2.5, burstCount: 25, decal: "scorch", shakeIntensity: 0.3 },
  },
  volley: {
    palette: SCHOOL_PALETTES.physical,
    impact: { ringRadius: 4.0, burstCount: 35, decal: "cracked_earth" },
  },
  serpent_sting: {
    palette: SCHOOL_PALETTES.nature,
    trail: { style: "comet", scale: 1.0 },
    impact: { ringRadius: 1.4, burstCount: 14, decal: "frost" },
    buffOrbit: { style: "runes", count: 2 },
  },

  // --- Druid ---
  wrath: {
    palette: SCHOOL_PALETTES.nature,
    windup: { style: "swirl", scale: 1.2 },
    trail: { style: "comet", scale: 1.3 },
    impact: { ringRadius: 1.8, burstCount: 18, decal: "frost" },
  },
  moonfire: {
    palette: { primary: 0x88eeff, secondary: 0xcc44ff },
    windup: { style: "holy_light", scale: 1.4 },
    impact: { ringRadius: 2.2, burstCount: 22, decal: "holy" },
  },
  regrowth: {
    palette: SCHOOL_PALETTES.nature,
    windup: { style: "holy_light", scale: 1.3 },
    buffOrbit: { style: "halo", count: 2 },
    impact: { ringRadius: 1.8, burstCount: 16 },
  },
  thorn_burst: {
    palette: SCHOOL_PALETTES.nature,
    impact: { ringRadius: 3.0, burstCount: 28, decal: "cracked_earth" },
  },

  // --- Rogue / Assassin ---
  backstab: {
    palette: { primary: 0x9922ff, secondary: 0x440066 },
    trail: { style: "arc_slash", scale: 1.3 },
    impact: { ringRadius: 1.2, burstCount: 12, decal: "shadow" },
  },
  poison_strike: {
    palette: SCHOOL_PALETTES.nature,
    trail: { style: "arc_slash", scale: 1.2 },
    impact: { ringRadius: 1.3, burstCount: 14, decal: "frost" },
  },
  fan_of_knives: {
    palette: SCHOOL_PALETTES.physical,
    impact: { ringRadius: 3.2, burstCount: 30, decal: "cracked_earth" },
  },
  eviscerate: {
    palette: { primary: 0xff0033, secondary: 0x880011 },
    trail: { style: "arc_slash", scale: 2.0 },
    impact: { ringRadius: 2.2, burstCount: 22, decal: "scorch" },
  },

  // --- Fire ---
  firebolt: {
    palette: SCHOOL_PALETTES.fire,
    windup: { style: "orb", scale: 1.0 },
    trail: { style: "comet", scale: 1.2 },
    impact: { ringRadius: 1.5, burstCount: 16, decal: "scorch" },
  },
  fireball: {
    palette: { primary: 0xff3300, secondary: 0xffff00 },
    windup: { style: "gather", scale: 1.6 },
    trail: { style: "comet", scale: 2.0 },
    impact: { ringRadius: 3.0, burstCount: 32, decal: "scorch", shakeIntensity: 0.4 },
  },
  pyroblast: {
    palette: { primary: 0xff1100, secondary: 0xff8800 },
    windup: { style: "gather", scale: 2.5 },
    trail: { style: "comet", scale: 3.0 },
    impact: { ringRadius: 4.5, burstCount: 50, decal: "scorch", shakeIntensity: 0.8 },
  },

  // --- Frost ---
  frostbolt: {
    palette: SCHOOL_PALETTES.frost,
    windup: { style: "orb", scale: 1.0 },
    trail: { style: "comet", scale: 1.1 },
    impact: { ringRadius: 1.4, burstCount: 14, decal: "frost" },
  },
  frost_nova: {
    palette: { primary: 0x66eefd, secondary: 0x0088ff },
    windup: { style: "swirl", scale: 1.8 },
    impact: { ringRadius: 4.0, burstCount: 36, decal: "frost" },
  },
  ice_block: {
    palette: SCHOOL_PALETTES.frost,
    buffOrbit: { style: "shields", count: 4 },
    impact: { ringRadius: 2.0, burstCount: 20, decal: "frost" },
  },

  // --- Holy ---
  heal: {
    palette: SCHOOL_PALETTES.holy,
    windup: { style: "holy_light", scale: 1.4 },
    impact: { ringRadius: 2.0, burstCount: 20, decal: "holy" },
    buffOrbit: { style: "halo", count: 1 },
  },
  flash_heal: {
    palette: SCHOOL_PALETTES.holy,
    windup: { style: "holy_light", scale: 1.0 },
    impact: { ringRadius: 1.5, burstCount: 15, decal: "holy" },
  },
  smite: {
    palette: { primary: 0xffee66, secondary: 0xff8800 },
    windup: { style: "holy_light", scale: 1.5 },
    trail: { style: "lightning", scale: 1.5 },
    impact: { ringRadius: 2.2, burstCount: 24, decal: "holy" },
  },
  power_word_shield: {
    palette: SCHOOL_PALETTES.holy,
    buffOrbit: { style: "shields", count: 3 },
    impact: { ringRadius: 1.8, burstCount: 16 },
  },

  // --- Shadow / Arcane ---
  shadowbolt: {
    palette: SCHOOL_PALETTES.shadow,
    windup: { style: "orb", scale: 1.1 },
    trail: { style: "comet", scale: 1.3 },
    impact: { ringRadius: 1.6, burstCount: 18, decal: "shadow" },
  },
  arcane_blast: {
    palette: SCHOOL_PALETTES.arcane,
    windup: { style: "swirl", scale: 1.3 },
    impact: { ringRadius: 2.2, burstCount: 22, decal: "shadow" },
  },
  curse_of_agony: {
    palette: SCHOOL_PALETTES.shadow,
    buffOrbit: { style: "runes", count: 3 },
    impact: { ringRadius: 1.5, burstCount: 12, decal: "shadow" },
  },
};

export function getSpellVfxSpec(spellId: string, school: string = "physical"): SpellVfxSpec {
  return SPELL_VFX_SPECS[spellId] ?? {
    palette: SCHOOL_PALETTES[school] ?? SCHOOL_PALETTES.physical,
    impact: { ringRadius: 1.5, burstCount: 12, decal: "cracked_earth" },
  };
}
