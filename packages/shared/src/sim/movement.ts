import { terrainHeight } from "../terrain";
import { bridgeHeightAt, dungeonFloorHeightAt } from "../worldgen";
import { sampleRegionHeight, sampleRegionWaterDepth, type RegionBlueprint, type RegionAssetCollider } from "../content/regions";
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

  const regionWaterDepth = input.regionHeightmap ? sampleRegionWaterDepth(input.regionHeightmap, x, z) : 0;
  const regionGround = input.regionHeightmap ? sampleRegionHeight(input.regionHeightmap, x, z) : null;
  const regionWaterLevel = regionGround !== null && regionWaterDepth > 0 ? regionGround + regionWaterDepth : -Infinity;
  const swimming = y < WATER_LEVEL - 0.4 || y < regionWaterLevel - 0.4;
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
      // Only non-ramp assets can hard-block XZ movement.
      if (!asset.stairRamp) {
        if (asset.climbable && y >= asset.topY - 0.3) continue;
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
        if (rampY > ground) ground = rampY;
      } else if (asset.climbable && asset.topY > ground) {
        ground = asset.topY;
      }
    }
  }
  // A raft rides on the surface; a swimmer treads just below it.
  const activeWaterLevel = regionWaterLevel > -Infinity ? regionWaterLevel : WATER_LEVEL;
  const surfaceY = mount === "raft" ? activeWaterLevel - 0.1 : activeWaterLevel - 1.1;
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
    if (y < activeWaterLevel - 1.1 && ground < activeWaterLevel - 1.1) {
      y = activeWaterLevel - 1.1;
      vy = 0;
    }
  }

  return { x, y, z, vy, grounded };
}
