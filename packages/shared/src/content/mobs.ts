export interface MobRender {
  /** Client model key -> resolved to a GLB + animation set on the client. */
  model: "wolf" | "skeleton_warrior" | "skeleton_minion" | "skeleton_rogue" | "skeleton_mage";
  /** Target height in meters after normalization. */
  height: number;
  /** Optional multiplicative tint applied to materials (hex), for variants. */
  tint?: number;
  /** Nameplate color. */
  color: string;
}

export interface MobDef {
  id: string;
  name: string;
  /** Difficulty tier 0 (trivial) .. 4 (elite). Drives nameplate/scaling. */
  tier: number;
  family: "beast" | "undead";
  maxHp: number;
  damage: number;
  speed: number;
  wanderSpeed: number;
  aggroRange: number;
  leashRange: number;
  attackRange: number;
  attackCooldownS: number;
  xp: number;
  respawnS: number;
  loot: { itemId: string; min: number; max: number; chance?: number }[];
  render: MobRender;
}

export const MOBS: Record<string, MobDef> = {
  wolf: {
    id: "wolf",
    name: "Gray Wolf",
    tier: 1,
    family: "beast",
    maxHp: 60,
    damage: 9,
    speed: 5.6,
    wanderSpeed: 1.6,
    aggroRange: 13,
    leashRange: 45,
    attackRange: 1.9,
    attackCooldownS: 1.4,
    xp: 28,
    respawnS: 60,
    loot: [
      { itemId: "raw_meat", min: 2, max: 3 },
      { itemId: "hide", min: 1, max: 2 },
    ],
    render: { model: "wolf", height: 1.15, color: "#d7b48a" },
  },

  dire_wolf: {
    id: "dire_wolf",
    name: "Dire Wolf",
    tier: 3,
    family: "beast",
    maxHp: 140,
    damage: 19,
    speed: 6.3,
    wanderSpeed: 1.8,
    aggroRange: 17,
    leashRange: 60,
    attackRange: 2.1,
    attackCooldownS: 1.5,
    xp: 78,
    respawnS: 150,
    loot: [
      { itemId: "raw_meat", min: 3, max: 5 },
      { itemId: "hide", min: 2, max: 4 },
    ],
    render: { model: "wolf", height: 2.0, tint: 0x26262f, color: "#ff6f5e" },
  },

  skeleton_minion: {
    id: "skeleton_minion",
    name: "Skeleton",
    tier: 0,
    family: "undead",
    maxHp: 34,
    damage: 6,
    speed: 4.4,
    wanderSpeed: 1.3,
    aggroRange: 11,
    leashRange: 40,
    attackRange: 2.0,
    attackCooldownS: 1.6,
    xp: 16,
    respawnS: 45,
    loot: [
      { itemId: "bone", min: 1, max: 2 },
      { itemId: "ancient_dust", min: 0, max: 1, chance: 0.3 },
    ],
    render: { model: "skeleton_minion", height: 1.7, color: "#cfd6dd" },
  },

  skeleton_warrior: {
    id: "skeleton_warrior",
    name: "Skeletal Warrior",
    tier: 2,
    family: "undead",
    maxHp: 100,
    damage: 15,
    speed: 4.3,
    wanderSpeed: 1.2,
    aggroRange: 13,
    leashRange: 50,
    attackRange: 2.2,
    attackCooldownS: 1.8,
    xp: 48,
    respawnS: 100,
    loot: [
      { itemId: "bone", min: 2, max: 4 },
      { itemId: "stone", min: 0, max: 2, chance: 0.5 },
      { itemId: "ancient_dust", min: 1, max: 2 },
    ],
    render: { model: "skeleton_warrior", height: 1.9, color: "#e6d18a" },
  },

  skeleton_rogue: {
    id: "skeleton_rogue",
    name: "Skeletal Stalker",
    tier: 2,
    family: "undead",
    maxHp: 62,
    damage: 12,
    speed: 6.6,
    wanderSpeed: 1.5,
    aggroRange: 16,
    leashRange: 58,
    attackRange: 1.9,
    attackCooldownS: 1.1,
    xp: 42,
    respawnS: 80,
    loot: [
      { itemId: "bone", min: 1, max: 3 },
      { itemId: "hide", min: 0, max: 1, chance: 0.5 },
      { itemId: "ancient_dust", min: 1, max: 1 },
    ],
    render: { model: "skeleton_rogue", height: 1.75, color: "#b7e08a" },
  },
};

export function mobDef(id: string): MobDef {
  const def = MOBS[id];
  if (!def) throw new Error(`Unknown mob: ${id}`);
  return def;
}

export const MOB_IDS = Object.keys(MOBS);
