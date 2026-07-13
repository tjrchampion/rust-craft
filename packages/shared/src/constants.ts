export const TICK_RATE = 20; // server simulation Hz
export const TICK_MS = 1000 / TICK_RATE;
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 10; // snapshots to clients Hz
export const INTEREST_RADIUS = 120; // meters
export const ZONE_SIZE = 600; // meters, square, centered on origin
export const ZONE_SEED = 1337;
export const WATER_LEVEL = 2.4; // world y of water surface

export const SPAWN_POINT = { x: 0, z: 0 };

// Movement
export const WALK_SPEED = 4.6; // m/s
export const SPRINT_SPEED = 6.8;
export const SWIM_SPEED_MULT = 0.45;
export const MOUNT_LAND_SPEED = 11.5; // horse gallop
export const RAFT_WATER_SPEED = 8.5; // raft across water
export const RAFT_LAND_SPEED = 2.6; // raft dragged on land
export const JUMP_VELOCITY = 7.5;
export const GRAVITY = 22;

// Vitals
export const BASE_MAX_HP = 100;
export const BASE_MAX_MANA = 100;
export const HP_PER_LEVEL = 5;
export const MANA_PER_LEVEL = 5;
export const MANA_REGEN_PER_S = 2.5;
export const HP_REGEN_PER_S = 0.5; // only while fed & watered
export const HUNGER_DECAY_PER_S = 100 / (25 * 60); // empty in ~25 min
export const THIRST_DECAY_PER_S = 100 / (18 * 60); // empty in ~18 min
export const STARVATION_DPS = 1.5; // hp/s while a vital is at 0
export const DRINK_RESTORE = 45; // drinking from open water
export const WATER_PROXIMITY = 3; // meters from water to drink

// Combat
export const UNARMED_DAMAGE = 6;
export const UNARMED_GATHER_POWER = 1;
export const MELEE_RANGE = 2.2;
export const MELEE_COOLDOWN_S = 0.8;
export const RESPAWN_HP_FRACTION = 0.5;

// Progression
export const MAX_LEVEL = 20;
export function xpForLevel(level: number): number {
  // total xp required to go from `level` to `level + 1`
  return Math.round(80 * Math.pow(level, 1.35));
}

// Inventory
export const INVENTORY_SLOTS = 24;
export const HOTBAR_SLOTS = 6;

export const PROTOCOL_VERSION = 1;
