import { terrainHeight } from "../terrain";
import { bridgeHeightAt, dungeonFloorHeightAt } from "../worldgen";
import { sampleRegionHeight, sampleRegionWaterDepth, type RegionBlueprint, type RegionAssetCollider } from "../content/regions";
import { clamp } from "../math";
import {
  WALK_SPEED,
  SPRINT_SPEED,
  SWIM_SPEED_MULT,
  WADE_DEPTH,
  WADE_SPEED_MULT,
  SWIM_BODY_OFFSET,
  SWIM_FLOAT_OFFSET,
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
}

/** Water surface Y and column depth at (x,z). Depth 0 means dry / bridged. */
export function waterAt(
  x: number,
  z: number,
  regionHeightmap?: MoveInput["regionHeightmap"],
): { surface: number; depth: number } {
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
export function isSwimmingAt(x: number, y: number, z: number, regionHeightmap?: MoveInput["regionHeightmap"]): boolean {
  const { surface, depth } = waterAt(x, z, regionHeightmap);
  return surface > -Infinity && depth >= WADE_DEPTH && y < surface - SWIM_BODY_OFFSET;
}

/** Standing in shallow water / near the shoreline for drink prompts. */
export function isNearWaterAt(x: number, y: number, z: number, regionHeightmap?: MoveInput["regionHeightmap"], proximity = 3): boolean {
  const here = waterAt(x, z, regionHeightmap);
  if (here.depth > 0.05 && y < here.surface + 0.5) return true;
  for (const [dx, dz] of [
    [proximity, 0],
    [-proximity, 0],
    [0, proximity],
    [0, -proximity],
  ] as const) {
    if (waterAt(x + dx, z + dz, regionHeightmap).depth > 0.05) return true;
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

  const waterHere = waterAt(x, z, input.regionHeightmap);
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

  if (input.regionHeightmap) {
    const { gridSize, pitch } = input.regionHeightmap;
    const regionHalf = ((gridSize - 1) * pitch) / 2 - 4.0;
    nextX = clamp(nextX, -regionHalf, regionHalf);
    nextZ = clamp(nextZ, -regionHalf, regionHalf);

    const oldHeight = sampleRegionHeight(input.regionHeightmap, state.x, state.z);
    const newHeight = sampleRegionHeight(input.regionHeightmap, nextX, nextZ);
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
  // Climbable assets (rocks/props) are the exception: once the player is
  // already at or above the asset's own top surface (having jumped up),
  // they're standing on top of it rather than walking into its side, so
  // horizontal movement across it is never blocked -- the ground-height
  // check below is what actually keeps them resting on top.
  if (input.regionAssets) {
    for (const asset of input.regionAssets) {
      // Stair ramps are never fully blocked -- you walk up or down them.
      // Climbable floors/props never hard-block XZ either (upper-storey floor
      // discs must not cage the room below). Only solid walls/trees block.
      if (asset.stairRamp || asset.climbable) continue;
      const dx = nextX - asset.x;
      const dz = nextZ - asset.z;
      if (dx * dx + dz * dz < asset.radius * asset.radius) {
        const oldDx = state.x - asset.x;
        const oldDz = state.z - asset.z;
        const alreadyInside = oldDx * oldDx + oldDz * oldDz < asset.radius * asset.radius;
        if (!alreadyInside) {
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
  let ground = input.regionHeightmap
    ? sampleRegionHeight(input.regionHeightmap, x, z)
    : bridgeHeightAt(x, z) ?? (input.inDungeon ? dungeonFloorHeightAt(x, z) : null) ?? terrainHeight(x, z);

  // A climbable asset's own top surface overrides the ground beneath it,
  // exactly like a bridge deck overrides the river trench -- this is what
  // actually lets a player rest standing on top of a rock instead of
  // falling straight through it once they've jumped up.
  if (input.regionAssets) {
    for (const asset of input.regionAssets) {
      const dx = x - asset.x;
      const dz = z - asset.z;
      if (dx * dx + dz * dz >= asset.radius * asset.radius) continue;

      if (asset.stairRamp) {
        // Project the player's local (dx,dz) onto the ramp axis to get a
        // 0..1 parameter (foot=0, top=1). Clamp so the height is valid
        // anywhere within the ramp footprint.
        const { dx: rdx, dz: rdz, halfLength, rise } = asset.stairRamp;
        const proj = (dx * rdx + dz * rdz) / halfLength; // -1..+1 along ramp
        const t = Math.max(0, Math.min(1, (proj + 1) / 2));
        const rampY = asset.topY - rise + t * rise;
        // Only surfaces at/below the player — don't snap up to a floor above.
        if (rampY <= y + 0.45 && rampY > ground) ground = rampY;
      } else if (asset.climbable && asset.topY > ground && asset.topY <= y + 0.45) {
        // Multi-storey floors: stand on the highest surface beneath/near feet,
        // never pull the player up onto the storey above.
        ground = asset.topY;
      }
    }
  }

  const waterNext = waterAt(x, z, input.regionHeightmap);
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
    // Deep water: lock to tread height (or ground if the floor is higher).
    vy = 0;
    const floatY = Math.max(ground, activeWaterLevel - SWIM_FLOAT_OFFSET);
    y = Math.max(y, floatY);
    grounded = false;
    if (ground > y) y = ground; // walked up out of the water
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
