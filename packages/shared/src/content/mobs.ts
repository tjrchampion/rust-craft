export interface MobRender {
  /** Client model key -> resolved to a GLB + animation set on the client. */
  model:
    | "wolf"
    | "skeleton_warrior"
    | "skeleton_minion"
    | "skeleton_rogue"
    | "skeleton_mage"
    | "fox"
    | "stag"
    | "alpaca"
    | "bull"
    | "spider"
    | "velociraptor"
    | "goblin"
    | "giant"
    | "orc"
    | "orcenemy"
    | "yeti"
    | "yetialt"
    | "frog"
    | "demon"
    | "demonalt"
    | "dragon"
    | "ghost"
    | "ooze"
    | "golem"
    | "tribal";
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
  family: "beast" | "undead" | "humanoid" | "elemental" | "demon";
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
      { itemId: "wolf_fang", min: 1, max: 1, chance: 0.2 },
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
      { itemId: "wolf_fang", min: 1, max: 1, chance: 0.3 },
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

  // --- Wildlife (tier 0-1, mostly meadow/forest/hills) ---
  fox: {
    id: "fox",
    name: "Red Fox",
    tier: 0,
    family: "beast",
    maxHp: 24,
    damage: 5,
    speed: 6.0,
    wanderSpeed: 1.8,
    aggroRange: 8,
    leashRange: 30,
    attackRange: 1.6,
    attackCooldownS: 1.5,
    xp: 10,
    respawnS: 40,
    loot: [
      { itemId: "hide", min: 0, max: 1 },
      { itemId: "raw_meat", min: 1, max: 1 },
    ],
    render: { model: "fox", height: 0.6, color: "#e8935a" },
  },

  frog: {
    id: "frog",
    name: "Bog Frog",
    tier: 0,
    family: "beast",
    maxHp: 18,
    damage: 3,
    speed: 3.0,
    wanderSpeed: 1.0,
    aggroRange: 6,
    leashRange: 20,
    attackRange: 1.3,
    attackCooldownS: 1.8,
    xp: 6,
    respawnS: 30,
    loot: [{ itemId: "raw_meat", min: 0, max: 1, chance: 0.6 }],
    render: { model: "frog", height: 0.45, color: "#7fae5a" },
  },

  alpaca: {
    id: "alpaca",
    name: "Alpaca",
    tier: 0,
    family: "beast",
    maxHp: 30,
    damage: 4,
    speed: 4.0,
    wanderSpeed: 1.4,
    aggroRange: 7,
    leashRange: 25,
    attackRange: 1.7,
    attackCooldownS: 1.6,
    xp: 12,
    respawnS: 45,
    loot: [{ itemId: "hide", min: 1, max: 2 }],
    render: { model: "alpaca", height: 1.1, color: "#e8dfc8" },
  },

  stag: {
    id: "stag",
    name: "Stag",
    tier: 1,
    family: "beast",
    maxHp: 70,
    damage: 10,
    speed: 6.2,
    wanderSpeed: 1.7,
    aggroRange: 10,
    leashRange: 40,
    attackRange: 2.0,
    attackCooldownS: 1.4,
    xp: 30,
    respawnS: 70,
    loot: [
      { itemId: "hide", min: 1, max: 3 },
      { itemId: "raw_meat", min: 2, max: 3 },
    ],
    render: { model: "stag", height: 1.5, color: "#a97a4a" },
  },

  bull: {
    id: "bull",
    name: "Wild Bull",
    tier: 1,
    family: "beast",
    maxHp: 85,
    damage: 14,
    speed: 5.4,
    wanderSpeed: 1.5,
    aggroRange: 11,
    leashRange: 42,
    attackRange: 2.0,
    attackCooldownS: 1.5,
    xp: 34,
    respawnS: 75,
    loot: [
      { itemId: "hide", min: 1, max: 2 },
      { itemId: "raw_meat", min: 2, max: 3 },
    ],
    render: { model: "bull", height: 1.5, color: "#6b5344" },
  },

  velociraptor: {
    id: "velociraptor",
    name: "Velociraptor",
    tier: 2,
    family: "beast",
    maxHp: 110,
    damage: 18,
    speed: 7.2,
    wanderSpeed: 2.0,
    aggroRange: 15,
    leashRange: 55,
    attackRange: 2.0,
    attackCooldownS: 1.2,
    xp: 55,
    respawnS: 100,
    loot: [
      { itemId: "raw_meat", min: 2, max: 4 },
      { itemId: "hide", min: 1, max: 2 },
    ],
    render: { model: "velociraptor", height: 1.4, color: "#5a8f6a" },
  },

  spider: {
    id: "spider",
    name: "Giant Spider",
    tier: 2,
    family: "beast",
    maxHp: 90,
    damage: 16,
    speed: 5.0,
    wanderSpeed: 1.5,
    aggroRange: 13,
    leashRange: 48,
    attackRange: 1.8,
    attackCooldownS: 1.3,
    xp: 46,
    respawnS: 90,
    loot: [
      { itemId: "hide", min: 1, max: 2 },
      { itemId: "ancient_dust", min: 0, max: 1, chance: 0.4 },
    ],
    render: { model: "spider", height: 1.0, color: "#3a2f3a" },
  },

  // --- Humanoid raiders (tier 1-3, hills/mountain/swamp/dunes) ---
  goblin: {
    id: "goblin",
    name: "Goblin Raider",
    tier: 1,
    family: "humanoid",
    maxHp: 55,
    damage: 9,
    speed: 4.8,
    wanderSpeed: 1.4,
    aggroRange: 12,
    leashRange: 44,
    attackRange: 1.8,
    attackCooldownS: 1.4,
    xp: 26,
    respawnS: 60,
    loot: [
      { itemId: "hide", min: 0, max: 1, chance: 0.5 },
      { itemId: "stone", min: 0, max: 2, chance: 0.4 },
      { itemId: "ancient_dust", min: 0, max: 1, chance: 0.3 },
    ],
    render: { model: "goblin", height: 1.2, color: "#8fbf6a" },
  },

  orc: {
    id: "orc",
    name: "Orc Marauder",
    tier: 2,
    family: "humanoid",
    maxHp: 130,
    damage: 20,
    speed: 5.0,
    wanderSpeed: 1.4,
    aggroRange: 14,
    leashRange: 52,
    attackRange: 2.1,
    attackCooldownS: 1.6,
    xp: 60,
    respawnS: 110,
    loot: [
      { itemId: "stone", min: 1, max: 3 },
      { itemId: "hide", min: 1, max: 2 },
      { itemId: "ancient_dust", min: 0, max: 1, chance: 0.4 },
    ],
    render: { model: "orc", height: 1.9, color: "#6f8f4a" },
  },

  orcenemy: {
    id: "orcenemy",
    name: "Orc Berserker",
    tier: 2,
    family: "humanoid",
    maxHp: 120,
    damage: 19,
    speed: 5.2,
    wanderSpeed: 1.4,
    aggroRange: 14,
    leashRange: 52,
    attackRange: 2.0,
    attackCooldownS: 1.5,
    xp: 58,
    respawnS: 105,
    loot: [
      { itemId: "stone", min: 1, max: 2 },
      { itemId: "ancient_dust", min: 1, max: 1 },
    ],
    render: { model: "orcenemy", height: 1.9, color: "#8f6f4a" },
  },

  tribal: {
    id: "tribal",
    name: "Marsh Tribal",
    tier: 2,
    family: "humanoid",
    maxHp: 115,
    damage: 19,
    speed: 5.0,
    wanderSpeed: 1.5,
    aggroRange: 13,
    leashRange: 50,
    attackRange: 2.0,
    attackCooldownS: 1.5,
    xp: 58,
    respawnS: 105,
    loot: [
      { itemId: "hide", min: 1, max: 2 },
      { itemId: "bone", min: 0, max: 2, chance: 0.5 },
      { itemId: "ancient_dust", min: 0, max: 1, chance: 0.3 },
    ],
    render: { model: "tribal", height: 1.8, color: "#5a6f4a" },
  },

  giant: {
    id: "giant",
    name: "Hill Giant",
    tier: 3,
    family: "humanoid",
    maxHp: 260,
    damage: 32,
    speed: 4.0,
    wanderSpeed: 1.2,
    aggroRange: 15,
    leashRange: 55,
    attackRange: 2.5,
    attackCooldownS: 1.9,
    xp: 120,
    respawnS: 180,
    loot: [
      { itemId: "stone", min: 2, max: 4 },
      { itemId: "bone", min: 1, max: 3 },
      { itemId: "ancient_dust", min: 1, max: 2 },
    ],
    render: { model: "giant", height: 3.2, color: "#9f8f7a" },
  },

  // --- Cold mountain (tier 3) ---
  yeti: {
    id: "yeti",
    name: "Yeti",
    tier: 3,
    family: "beast",
    maxHp: 190,
    damage: 26,
    speed: 4.6,
    wanderSpeed: 1.3,
    aggroRange: 15,
    leashRange: 55,
    attackRange: 2.2,
    attackCooldownS: 1.7,
    xp: 90,
    respawnS: 150,
    loot: [
      { itemId: "hide", min: 2, max: 4 },
      { itemId: "raw_meat", min: 2, max: 3 },
      { itemId: "ancient_dust", min: 0, max: 1, chance: 0.5 },
      { itemId: "yeti_claw", min: 1, max: 1, chance: 0.25 },
    ],
    render: { model: "yeti", height: 2.4, color: "#e6eef2" },
  },

  yetialt: {
    id: "yetialt",
    name: "Frost Yeti",
    tier: 3,
    family: "beast",
    maxHp: 210,
    damage: 29,
    speed: 4.8,
    wanderSpeed: 1.3,
    aggroRange: 16,
    leashRange: 58,
    attackRange: 2.2,
    attackCooldownS: 1.6,
    xp: 100,
    respawnS: 160,
    loot: [
      { itemId: "hide", min: 2, max: 4 },
      { itemId: "ancient_dust", min: 1, max: 2 },
      { itemId: "yeti_claw", min: 1, max: 1, chance: 0.25 },
    ],
    render: { model: "yetialt", height: 2.4, color: "#c9dcf0" },
  },

  golem: {
    id: "golem",
    name: "Stone Goleling",
    tier: 3,
    family: "elemental",
    maxHp: 230,
    damage: 24,
    speed: 3.5,
    wanderSpeed: 1.0,
    aggroRange: 12,
    leashRange: 45,
    attackRange: 2.3,
    attackCooldownS: 1.9,
    xp: 100,
    respawnS: 160,
    loot: [
      { itemId: "stone", min: 3, max: 5 },
      { itemId: "ancient_dust", min: 1, max: 2 },
      { itemId: "golem_core", min: 1, max: 1, chance: 0.2 },
    ],
    render: { model: "golem", height: 2.0, color: "#8a8a8a" },
  },

  // --- Swamp haunts (tier 1-2) ---
  ooze: {
    id: "ooze",
    name: "Bog Ooze",
    tier: 1,
    family: "elemental",
    maxHp: 105,
    damage: 15,
    speed: 3.8,
    wanderSpeed: 1.2,
    aggroRange: 11,
    leashRange: 42,
    attackRange: 1.7,
    attackCooldownS: 1.7,
    xp: 50,
    respawnS: 95,
    loot: [
      { itemId: "ancient_dust", min: 1, max: 1 },
      { itemId: "stone", min: 0, max: 2, chance: 0.5 },
    ],
    render: { model: "ooze", height: 1.3, color: "#6a8f5a" },
  },

  ghost: {
    id: "ghost",
    name: "Marsh Wraith",
    tier: 2,
    family: "undead",
    maxHp: 100,
    damage: 17,
    speed: 5.5,
    wanderSpeed: 1.6,
    aggroRange: 14,
    leashRange: 50,
    attackRange: 1.9,
    attackCooldownS: 1.4,
    xp: 55,
    respawnS: 100,
    loot: [
      { itemId: "ancient_dust", min: 1, max: 2 },
      { itemId: "bone", min: 0, max: 2, chance: 0.5 },
    ],
    render: { model: "ghost", height: 1.8, color: "#cfe0e8" },
  },

  // --- Demonic elites (tier 4) ---
  demon: {
    id: "demon",
    name: "Lesser Demon",
    tier: 4,
    family: "demon",
    maxHp: 320,
    damage: 38,
    speed: 5.8,
    wanderSpeed: 1.5,
    aggroRange: 18,
    leashRange: 65,
    attackRange: 2.2,
    attackCooldownS: 1.3,
    xp: 180,
    respawnS: 240,
    loot: [
      { itemId: "ancient_dust", min: 2, max: 4 },
      { itemId: "stone", min: 2, max: 3 },
      { itemId: "demon_horn", min: 1, max: 1, chance: 0.15 },
    ],
    render: { model: "demon", height: 2.2, color: "#b83a3a" },
  },

  demonalt: {
    id: "demonalt",
    name: "Blood Demon",
    tier: 4,
    family: "demon",
    maxHp: 350,
    damage: 42,
    speed: 5.5,
    wanderSpeed: 1.5,
    aggroRange: 18,
    leashRange: 65,
    attackRange: 2.2,
    attackCooldownS: 1.4,
    xp: 200,
    respawnS: 260,
    loot: [
      { itemId: "ancient_dust", min: 3, max: 4 },
      { itemId: "bone", min: 1, max: 3 },
      { itemId: "demon_horn", min: 1, max: 1, chance: 0.15 },
    ],
    render: { model: "demonalt", height: 2.0, color: "#7a2020" },
  },

  dragon: {
    id: "dragon",
    name: "Young Wyrm",
    tier: 4,
    family: "demon",
    maxHp: 420,
    damage: 48,
    speed: 6.5,
    wanderSpeed: 1.6,
    aggroRange: 20,
    leashRange: 70,
    attackRange: 2.5,
    attackCooldownS: 1.5,
    xp: 260,
    respawnS: 300,
    loot: [
      { itemId: "ancient_dust", min: 3, max: 5 },
      { itemId: "stone", min: 3, max: 5 },
      { itemId: "hide", min: 2, max: 3 },
      { itemId: "dragon_scale", min: 1, max: 2, chance: 0.25 },
    ],
    render: { model: "dragon", height: 2.6, color: "#4a7a4a" },
  },
};

export function mobDef(id: string): MobDef {
  const def = MOBS[id];
  if (!def) throw new Error(`Unknown mob: ${id}`);
  return def;
}

export const MOB_IDS = Object.keys(MOBS);
