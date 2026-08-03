import { terrainHeight } from "../terrain";
import { bridgeHeightAt, dungeonFloorHeightAt } from "../worldgen";
import {
  sampleRegionHeight,
  sampleRegionWaterDepth,
  pointInColliderXZ,
  segmentHitsColliderXZ,
  depenetrateColliderXZ,
  PLAYER_BODY_RADIUS,
  type RegionBlueprint,
  type RegionAssetCollider,
} from "../content/regions";
import { clamp } from "../math";
import {
  WALK_SPEED,
  SPRINT_SPEED,
  SWIM_SPEED_MULT,
  WADE_DEPTH,
  WADE_SPEED_MULT,
  SWIM_BODY_OFFSET,
  SWIM_FLOAT_OFFSET,
  SWIM_VERTICAL_SPEED,
  PLAYER_EYE_HEIGHT,
  MOUNT_LAND_SPEED,
  RAFT_WATER_SPEED,
  RAFT_LAND_SPEED,
  JUMP_VELOCITY,
  GRAVITY,
  MAX_STEP_DOWN,
  WATER_LEVEL,
  WORLD_MIN_X,
  WORLD_MAX_X,
  WORLD_MIN_Z,
  WORLD_MAX_Z,
} from "../constants";

/** Max height the player can step onto (rocks, bridge decks, curbs). */
const STEP_UP = 1.15;

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
  /** Dive while swimming (Ctrl). Ignored on land. */
  crouch?: boolean;
  /**
   * Camera pitch in the client convention (negative = looking down).
   * While swimming, steers vertical movement along the look direction.
   */
  lookPitch?: number;
  /** Server-authoritative mount state, injected identically on client + server. */
  mount?: MountKind;
  inDungeon?: boolean;
  /** When present, ground height comes from this region's own heightmap
   *  instead of the open-world terrain function or dungeon floor grid --
   *  set by the server/client while the player is inside an instanced
   *  region (see content/regions.ts's sampleRegionHeight). */
  regionHeightmap?: Pick<RegionBlueprint, "gridSize" | "pitch" | "heights"> & { waterHeights?: number[] };
  /** Placed trees/rocks/buildings to block movement against -- see
   *  content/regions.ts's regionAssetColliders(). Only meaningful alongside
   *  regionHeightmap (open-world/dungeon movement has no placed-asset
   *  collision yet). */
  regionAssets?: RegionAssetCollider[];
  /** World-space ground sampler for seamless multi-region continents.
   *  When set, overrides regionHeightmap / outdoor terrain for height stick
   *  and disables the single-region edge clamp. */
  groundAt?: (x: number, z: number) => number;
  /** Water column depth in the same space as `groundAt`. */
  waterDepthAt?: (x: number, z: number) => number;
}

/** Water surface Y and column depth at (x,z). Depth 0 means dry / bridged. */
export function waterAt(
  x: number,
  z: number,
  regionHeightmap?: MoveInput["regionHeightmap"],
  groundAt?: MoveInput["groundAt"],
  waterDepthAt?: MoveInput["waterDepthAt"],
): { surface: number; depth: number } {
  if (groundAt && waterDepthAt) {
    const depth = waterDepthAt(x, z);
    if (depth <= 0) return { surface: -Infinity, depth: 0 };
    return { surface: groundAt(x, z) + depth, depth };
  }
  if (regionHeightmap) {
    const depth = sampleRegionWaterDepth(regionHeightmap, x, z);
    if (depth <= 0) return { surface: -Infinity, depth: 0 };
    const ground = sampleRegionHeight(regionHeightmap, x, z);
    return { surface: ground + depth, depth };
  }
  if (bridgeHeightAt(x, z) !== null) return { surface: -Infinity, depth: 0 };
  const ground = terrainHeight(x, z);
  const depth = Math.max(0, WATER_LEVEL - ground);
  return depth > 0.01 ? { surface: WATER_LEVEL, depth } : { surface: -Infinity, depth: 0 };
}

/** True when the body is deep enough to swim (not just wade). */
export function isSwimmingAt(
  x: number,
  y: number,
  z: number,
  regionHeightmap?: MoveInput["regionHeightmap"],
  groundAt?: MoveInput["groundAt"],
  waterDepthAt?: MoveInput["waterDepthAt"],
): boolean {
  const { surface, depth } = waterAt(x, z, regionHeightmap, groundAt, waterDepthAt);
  return surface > -Infinity && depth >= WADE_DEPTH && y < surface - SWIM_BODY_OFFSET;
}

/** True when the character's head is below the water surface (breath drains). */
export function isUnderwaterAt(
  x: number,
  y: number,
  z: number,
  regionHeightmap?: MoveInput["regionHeightmap"],
  groundAt?: MoveInput["groundAt"],
  waterDepthAt?: MoveInput["waterDepthAt"],
): boolean {
  const { surface, depth } = waterAt(x, z, regionHeightmap, groundAt, waterDepthAt);
  if (surface <= -Infinity || depth < WADE_DEPTH) return false;
  return y + PLAYER_EYE_HEIGHT < surface - 0.08;
}

/** Standing in shallow water / near the shoreline for drink prompts. */
export function isNearWaterAt(
  x: number,
  y: number,
  z: number,
  regionHeightmap?: MoveInput["regionHeightmap"],
  proximity = 3,
  groundAt?: MoveInput["groundAt"],
  waterDepthAt?: MoveInput["waterDepthAt"],
): boolean {
  const here = waterAt(x, z, regionHeightmap, groundAt, waterDepthAt);
  if (here.depth > 0.05 && y < here.surface + 0.5) return true;
  for (const [dx, dz] of [
    [proximity, 0],
    [-proximity, 0],
    [0, proximity],
    [0, -proximity],
  ] as const) {
    if (waterAt(x + dx, z + dz, regionHeightmap, groundAt, waterDepthAt).depth > 0.05) return true;
  }
  return false;
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

  const waterHere = waterAt(x, z, input.regionHeightmap, input.groundAt, input.waterDepthAt);
  const swimming = waterHere.surface > -Infinity && waterHere.depth >= WADE_DEPTH && y < waterHere.surface - SWIM_BODY_OFFSET;
  const wading = !swimming && waterHere.depth > 0.05 && y < waterHere.surface - 0.05;
  const mount = input.mount ?? null;
  const waterSpeedMult = swimming ? SWIM_SPEED_MULT : wading ? WADE_SPEED_MULT : 1;
  let speed: number;
  if (mount === "horse") {
    // Gallops on land; wades/swims slowly through water.
    speed = swimming || wading ? WALK_SPEED * waterSpeedMult : MOUNT_LAND_SPEED;
  } else if (mount === "raft") {
    // Skims across any wet cell; drags on dry land.
    speed = waterHere.depth > 0.05 && y < waterHere.surface + 0.35 ? RAFT_WATER_SPEED : RAFT_LAND_SPEED;
  } else {
    speed = (input.sprint ? SPRINT_SPEED : WALK_SPEED) * waterSpeedMult;
  }
  let nextX = x + mx * speed * dt;
  let nextZ = z + mz * speed * dt;

  /** Terrain (or sampler) raised to any climbable top within a step-up of the
   *  player's feet — used for cliff checks so bridge decks over a trench are
   *  walkable instead of rejected as a cliff into the riverbed. */
  const walkHeightAt = (wx: number, wz: number, terrainY: number): number => {
    let ground = terrainY;
    if (!input.regionAssets) return ground;
    const maxSurface = state.y + STEP_UP;
    for (const asset of input.regionAssets) {
      if (!pointInColliderXZ(wx, wz, asset, 0)) continue;
      if (asset.stairRamp) {
        const dx = wx - asset.x;
        const dz = wz - asset.z;
        const { dx: rdx, dz: rdz, halfLength, rise } = asset.stairRamp;
        const proj = (dx * rdx + dz * rdz) / halfLength;
        const t = Math.max(0, Math.min(1, (proj + 1) / 2));
        const rampY = asset.topY - rise + t * rise;
        if (rampY <= maxSurface && rampY > ground) ground = rampY;
      } else if (asset.climbable && asset.topY > ground && asset.topY <= maxSurface) {
        ground = asset.topY;
      }
    }
    return ground;
  };

  if (input.groundAt) {
    // Seamless continent: no single-region edge clamp; still block cliffs.
    const oldHeight = walkHeightAt(state.x, state.z, input.groundAt(state.x, state.z));
    const newHeight = walkHeightAt(nextX, nextZ, input.groundAt(nextX, nextZ));
    if (Math.abs(newHeight - oldHeight) > 2.5) {
      nextX = state.x;
      nextZ = state.z;
    }
  } else if (input.regionHeightmap) {
    const { gridSize, pitch } = input.regionHeightmap;
    const regionHalf = ((gridSize - 1) * pitch) / 2 - 4.0;
    nextX = clamp(nextX, -regionHalf, regionHalf);
    nextZ = clamp(nextZ, -regionHalf, regionHalf);

    const oldHeight = walkHeightAt(state.x, state.z, sampleRegionHeight(input.regionHeightmap, state.x, state.z));
    const newHeight = walkHeightAt(nextX, nextZ, sampleRegionHeight(input.regionHeightmap, nextX, nextZ));
    if (Math.abs(newHeight - oldHeight) > 2.5) {
      nextX = state.x;
      nextZ = state.z;
    }
  } else if (input.inDungeon) {
    const oldHeight = dungeonFloorHeightAt(state.x, state.z);
    const newHeight = dungeonFloorHeightAt(nextX, nextZ);
    if (newHeight === null || (oldHeight !== null && Math.abs(newHeight - oldHeight) > 2.5)) {
      nextX = state.x;
      nextZ = state.z;
    }
  } else {
    nextX = clamp(nextX, WORLD_MIN_X, WORLD_MAX_X);
    nextZ = clamp(nextZ, WORLD_MIN_Z, WORLD_MAX_Z);
  }

  // Placed trees/rocks/buildings block movement the same way steep terrain
  // does -- reject the whole step rather than sliding, consistent with the
  // slope checks above. Only blocks entering a collider from outside it --
  // if the player is already inside one (e.g. an entry point or persisted
  // position that happens to land near an asset), every direction must stay
  // walkable or they'd be stuck forever the instant collision was added.
  // Climbable floors (no solid) never hard-block XZ — upper-storey floor
  // discs must not cage the room below. Solid climbable props (rocks) block
  // from the side but allow standing / stepping on the top surface.
  if (input.regionAssets) {
    for (const asset of input.regionAssets) {
      // Stair ramps are never fully blocked -- you walk up or down them.
      if (asset.stairRamp) continue;
      // Soft climbable (floors/props): no XZ wall.
      if (asset.climbable && !asset.solid) continue;
      // On top of a solid rock/prop: free XZ; ground snap keeps you there.
      if (asset.solid && state.y >= asset.topY - 0.05) continue;
      // Step onto a low solid top without side-blocking (same STEP_UP as ground snap).
      if (asset.solid && asset.climbable && asset.topY <= state.y + STEP_UP) continue;
      // Oriented barriers use a tall vertical range; still honor authored
      // base/top when they look like short props (rare). Circles ignore Y.
      if (asset.halfX !== undefined && asset.halfZ !== undefined) {
        const headY = state.y + 1.7;
        if (headY <= asset.baseY || state.y >= asset.topY) continue;
      }
      const pad = asset.halfX !== undefined || asset.solid ? PLAYER_BODY_RADIUS : 0;
      const wasInside = pointInColliderXZ(state.x, state.z, asset, pad);
      // Solid barriers / rocks: never allow walking through while overlapping.
      if (asset.solid) {
        if (wasInside) {
          const out = depenetrateColliderXZ(state.x, state.z, asset, pad);
          nextX = out.x;
          nextZ = out.z;
          break;
        }
        if (segmentHitsColliderXZ(state.x, state.z, nextX, nextZ, asset, pad)) {
          nextX = state.x;
          nextZ = state.z;
          break;
        }
        continue;
      }
      // Sweep the step so thin walls can't be tunneled through.
      if (segmentHitsColliderXZ(state.x, state.z, nextX, nextZ, asset, pad)) {
        if (!wasInside) {
          nextX = state.x;
          nextZ = state.z;
          break;
        }
      }
    }
  }

  x = nextX;
  z = nextZ;

  // A region's own heightmap overrides everything else; a bridge deck
  // overrides the carved river trench so players walk the span instead of
  // wading through the water beneath it; a dungeon's flat interior floor
  // overrides the outdoor noise-based terrain the same way.
  let ground = input.groundAt
    ? input.groundAt(x, z)
    : input.regionHeightmap
      ? sampleRegionHeight(input.regionHeightmap, x, z)
      : bridgeHeightAt(x, z) ?? (input.inDungeon ? dungeonFloorHeightAt(x, z) : null) ?? terrainHeight(x, z);

  // A climbable asset's own top surface overrides the ground beneath it,
  // exactly like a bridge deck overrides the river trench -- this is what
  // actually lets a player rest standing on top of a rock instead of
  // falling straight through it once they've jumped (or stepped) up.
  if (input.regionAssets) {
    for (const asset of input.regionAssets) {
      if (!pointInColliderXZ(x, z, asset, 0)) continue;

      if (asset.stairRamp) {
        // Project the player's local (dx,dz) onto the ramp axis to get a
        // 0..1 parameter (foot=0, top=1). Clamp so the height is valid
        // anywhere within the ramp footprint.
        const dx = x - asset.x;
        const dz = z - asset.z;
        const { dx: rdx, dz: rdz, halfLength, rise } = asset.stairRamp;
        const proj = (dx * rdx + dz * rdz) / halfLength; // -1..+1 along ramp
        const t = Math.max(0, Math.min(1, (proj + 1) / 2));
        const rampY = asset.topY - rise + t * rise;
        // Only surfaces at/below the player — don't snap up to a floor above.
        if (rampY <= y + STEP_UP && rampY > ground) ground = rampY;
      } else if (asset.climbable && asset.topY > ground && asset.topY <= y + STEP_UP) {
        // Multi-storey floors + solid rocks: stand on the highest surface
        // beneath/near feet, never pull the player up onto the storey above.
        ground = asset.topY;
      }
    }
  }

  const waterNext = waterAt(x, z, input.regionHeightmap, input.groundAt, input.waterDepthAt);
  const activeWaterLevel = waterNext.surface;
  const waterColumn = waterNext.depth;
  const swimmingNow =
    activeWaterLevel > -Infinity && waterColumn >= WADE_DEPTH && y < activeWaterLevel - SWIM_BODY_OFFSET;

  let grounded = state.grounded;

  // Raft rides the surface whenever the cell is wet.
  if (mount === "raft" && activeWaterLevel > -Infinity && waterColumn > 0.05) {
    vy = 0;
    y = Math.max(ground, activeWaterLevel - 0.1);
    grounded = false;
  } else if (swimmingNow) {
    // Deep water: aim the camera down to dive, up to ascend. Space / Ctrl
    // still nudge. Idle drifts to surface tread with head & shoulders out.
    vy = 0;
    grounded = false;
    const floatY = Math.max(ground, activeWaterLevel - SWIM_FLOAT_OFFSET);
    const minY = ground;
    // Upper bound is the tread height — do not clamp below floatY or the
    // body sits too deep and shoulders never clear the surface.
    const maxY = floatY;
    const pitch = input.lookPitch ?? 0;
    // Client: more negative = looking down. Deadzone around the default orbit
    // pitch (~-0.35) so normal swimming doesn't force a constant sink.
    const DIVE_START = -0.42;
    const ASCEND_START = 0.06;
    let pitchSteer = 0;
    if (pitch <= DIVE_START) {
      pitchSteer = clamp((pitch - DIVE_START) / 0.95, -1, 0);
    } else if (pitch >= ASCEND_START) {
      pitchSteer = clamp((pitch - ASCEND_START) / 0.45, 0, 1);
    }
    let vert = pitchSteer;
    vert += (input.jump ? 1 : 0) - (input.crouch ? 1 : 0);
    vert = clamp(vert, -1, 1);

    if (Math.abs(vert) > 0.04) {
      y = clamp(y + vert * SWIM_VERTICAL_SPEED * dt, minY, maxY);
    } else {
      // No dive intent — ease back to surface tread (head/shoulders out).
      const toward = floatY - y;
      if (Math.abs(toward) > 0.02) {
        const step = Math.sign(toward) * Math.min(Math.abs(toward), SWIM_VERTICAL_SPEED * 0.55 * dt);
        y = clamp(y + step, minY, maxY);
      } else {
        y = floatY;
      }
    }
    if (ground > y) y = ground;
  } else {
    if (grounded && input.jump) {
      vy = JUMP_VELOCITY;
      grounded = false;
    }
    if (grounded) {
      // Stick to the heightfield after the XZ step. Gravity alone can't keep up
      // with downhill sprint drops (~0.05 m/tick vs meters of slope), which left
      // vy nonzero and flipped run/sprint into the jump anim every frame.
      if (ground >= y - MAX_STEP_DOWN) {
        y = ground;
        vy = 0;
        grounded = true;
      } else {
        grounded = false;
        vy -= GRAVITY * dt;
        y += vy * dt;
        if (y <= ground) {
          y = ground;
          vy = 0;
          grounded = true;
        }
      }
    } else {
      vy -= GRAVITY * dt;
      y += vy * dt;
      if (y <= ground) {
        y = ground;
        vy = 0;
        grounded = true;
      }
    }
    // Entering deep water: settle to swim height.
    if (
      mount !== "raft" &&
      activeWaterLevel > -Infinity &&
      waterColumn >= WADE_DEPTH &&
      y < activeWaterLevel - SWIM_FLOAT_OFFSET &&
      ground < activeWaterLevel - SWIM_FLOAT_OFFSET
    ) {
      y = activeWaterLevel - SWIM_FLOAT_OFFSET;
      vy = 0;
    }
  }

  return { x, y, z, vy, grounded };
}
