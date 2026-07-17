import { terrainHeight } from "../terrain";
import { bridgeHeightAt, dungeonFloorHeightAt } from "../worldgen";
import { clamp } from "../math";
import {
  WALK_SPEED,
  SPRINT_SPEED,
  SWIM_SPEED_MULT,
  MOUNT_LAND_SPEED,
  RAFT_WATER_SPEED,
  RAFT_LAND_SPEED,
  JUMP_VELOCITY,
  GRAVITY,
  WATER_LEVEL,
  WORLD_MIN_X,
  WORLD_MAX_X,
  WORLD_MIN_Z,
  WORLD_MAX_Z,
} from "../constants";

export type MountKind = "horse" | "raft" | null;

export interface MoveState {
  x: number;
  y: number;
  z: number;
  vy: number;
  grounded: boolean;
}

export interface MoveInput {
  /** Normalized intent in world space, magnitude <= 1. */
  moveX: number;
  moveZ: number;
  jump: boolean;
  sprint: boolean;
  /** Server-authoritative mount state, injected identically on client + server. */
  mount?: MountKind;
  inDungeon?: boolean;
}

/**
 * Advance one movement step. Pure and deterministic — used verbatim for
 * client prediction and server authority so they can't disagree.
 */
export function stepMovement(state: MoveState, input: MoveInput, dt: number): MoveState {
  let { x, y, z, vy } = state;

  const mag = Math.hypot(input.moveX, input.moveZ);
  let mx = input.moveX;
  let mz = input.moveZ;
  if (mag > 1) {
    mx /= mag;
    mz /= mag;
  }

  const swimming = y < WATER_LEVEL - 0.4;
  const mount = input.mount ?? null;
  let speed: number;
  if (mount === "horse") {
    // Gallops on land; wades slowly through deep water.
    speed = swimming ? WALK_SPEED * SWIM_SPEED_MULT : MOUNT_LAND_SPEED;
  } else if (mount === "raft") {
    // Skims across water; drags on dry land.
    speed = swimming ? RAFT_WATER_SPEED : RAFT_LAND_SPEED;
  } else {
    speed = (input.sprint ? SPRINT_SPEED : WALK_SPEED) * (swimming ? SWIM_SPEED_MULT : 1);
  }
  x += mx * speed * dt;
  z += mz * speed * dt;

  x = clamp(x, WORLD_MIN_X, WORLD_MAX_X);
  z = clamp(z, WORLD_MIN_Z, WORLD_MAX_Z);

  // A bridge deck overrides the carved river trench so players walk the
  // span instead of wading through the water beneath it; a dungeon's flat
  // interior floor overrides the outdoor noise-based terrain the same way.
  const ground = bridgeHeightAt(x, z) ?? (input.inDungeon ? dungeonFloorHeightAt(x, z) : null) ?? terrainHeight(x, z);
  // A raft rides on the surface; a swimmer treads just below it.
  const surfaceY = mount === "raft" ? WATER_LEVEL - 0.1 : WATER_LEVEL - 1.1;
  const floatY = Math.max(ground, surfaceY);

  let grounded = state.grounded;
  if (swimming) {
    vy = 0;
    y = Math.max(y, floatY);
    grounded = false;
    if (ground > y) y = ground; // walked up out of the water
  } else {
    if (grounded && input.jump) {
      vy = JUMP_VELOCITY;
      grounded = false;
    }
    vy -= GRAVITY * dt;
    y += vy * dt;
    if (y <= ground) {
      y = ground;
      vy = 0;
      grounded = true;
    } else {
      grounded = false;
    }
    // Entering water: settle to swim height.
    if (y < WATER_LEVEL - 1.1 && ground < WATER_LEVEL - 1.1) {
      y = WATER_LEVEL - 1.1;
      vy = 0;
    }
  }

  return { x, y, z, vy, grounded };
}
