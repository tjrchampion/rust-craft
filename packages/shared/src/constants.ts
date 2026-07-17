export const TICK_RATE = 20; // server simulation Hz
export const TICK_MS = 1000 / TICK_RATE;
export const TICK_DT = 1 / TICK_RATE;
export const SNAPSHOT_RATE = 10; // snapshots to clients Hz
export const INTEREST_RADIUS = 120; // meters
export const ZONE_SIZE = 600; // meters, square, centered on origin
export const ZONE_SEED = 1337;
export const WATER_LEVEL = 2.4; // world y of water surface

export const SPAWN_POINT = { x: 0, z: 0 };

// Ashenpeak: a second, higher-tier region north of Greenlands (the original
// zone), reached through a steep valley. One continuous coordinate space —
// north is +z (matches the client's minimap/horizon-ring convention).
export const VALLEY_START_Z = ZONE_SIZE / 2; // 300 — Greenlands' original north edge
export const VALLEY_END_Z = VALLEY_START_Z + 400; // 700 — a long, gradual climb, not a sudden one
export const REGION_TWO_MAX_Z = VALLEY_END_Z + ZONE_SIZE; // 1300 — same footprint as Greenlands
export const WORLD_MIN_X = -ZONE_SIZE / 2;
export const WORLD_MAX_X = ZONE_SIZE / 2;
export const WORLD_MIN_Z = -ZONE_SIZE / 2;
export const WORLD_MAX_Z = REGION_TWO_MAX_Z;
export const VALLEY_MOUTH_HALF_WIDTH = 45; // where it meets Greenlands, before widening as it climbs
export const REGION_TWO_GATE_X = 0;
export const REGION_TWO_GATE_Z = VALLEY_START_Z; // (0, 300) — lazy-activation trigger point
export const REGION_TWO_TRIGGER_RADIUS = 200;

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
export const SIT_MANA_REGEN_MULT = 4; // resting at a campfire
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
// Hold-E-to-revive a dead player. Shared so the client's progress bar
// duration and interact-range detection can't drift from the server's own
// authoritative hold-time/range checks.
export const REVIVE_HOLD_S = 3;
export const REVIVE_RANGE = 4.5;
export const REVIVE_HP_FRACTION = 0.5;

// A quick directional burst movement. Charge-based (not a flat cooldown):
// up to DODGE_MAX_CHARGES uses banked at once, each recharging individually
// over DODGE_CHARGE_REGEN_S -- so spamming drains the bank, then you're
// waiting on a per-charge trickle instead of one long shared cooldown.
export const DODGE_DISTANCE = 2.5;
export const DODGE_MAX_CHARGES = 4;
export const DODGE_CHARGE_REGEN_S = 4;

// Dungeons: instanced encounters reached via a shrine portal. Every
// concurrent run of a given portal reuses the exact same reserved arena
// rectangle and mob-spawn layout -- there's no per-instance coordinate
// space, so "instancing" is purely server-side visibility filtering by
// instanceId (see GameServer's sameInstance guard). These constants keep
// the client's exclusion-radius/activation-radius math in lockstep with
// the server's own authoritative checks.
export const DUNGEON_ARENA_RADIUS = 45; // exclusion radius from normal node/mob/POI scatter
export const DUNGEON_PORTAL_ACTIVATION_RADIUS = 8; // must be this close to the portal to start/join
export const DUNGEON_MOB_MULT_PER_EXTRA_PLAYER = 0.35; // +35% hp/damage per player beyond the first
export const DUNGEON_ABANDON_TIMEOUT_MS = 5 * 60 * 1000; // GC an instance nobody is connected to
export const DUNGEON_WIPE_EJECT_MS = 15 * 1000; // eject a fully-dead party if nobody revives in time

// Every portal's arena is a real enclosed room built on top of the same
// reserved rectangle above -- these size the walls/floor/ceiling, inside
// the larger DUNGEON_ARENA_RADIUS exclusion buffer.
export const DUNGEON_WALL_RADIUS = 38; // interior room radius
export const DUNGEON_WALL_HEIGHT = 16; // tall enough to fully occlude sky/horizon
export const DUNGEON_DOORWAY_HALF_ANGLE = 0.28; // radians, gap in the wall ring for the entrance

// Progression
export const MAX_LEVEL = 20;
export function xpForLevel(level: number): number {
  // total xp required to go from `level` to `level + 1`
  return Math.round(80 * Math.pow(level, 1.35));
}

// Inventory
export const INVENTORY_SLOTS = 24;
// Slots 0-5 = number keys 1-6; slots 6-9 = Q/Z/X/C. A single unified action
// bar -- every slot can independently hold either an item or a spell.
export const HOTBAR_SLOTS = 10;

export const PROTOCOL_VERSION = 1;
