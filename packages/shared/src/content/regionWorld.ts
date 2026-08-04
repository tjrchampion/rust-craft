import type { Biome } from "../terrain";
import type { WorldNode } from "../worldgen";
import { hashString } from "../rng";
import { isPlaceableRegionNodeType } from "./nodes";
import type { RegionBiome, RegionBlueprint, RegionResourceNode } from "./regions";
import { pickRandomRegionTreeModel, sampleRegionHeight, sampleRegionWaterDepth } from "./regions";

/** Map authored region biomes onto the legacy tree/rock Biome palette. */
export function regionBiomeToWorldBiome(biome: RegionBiome): Biome {
  switch (biome) {
    case "forest":
    case "jungle":
      return "forest";
    case "desert":
      return "dunes";
    case "arctic":
      return "mountain";
    case "swamp":
      return "swamp";
    case "volcanic":
      return "hills";
    default:
      return "meadow";
  }
}

/** Stable gather-node id for depletion persistence across editor saves. */
export function regionResourceNodeWorldId(
  regionId: string,
  node: Pick<RegionResourceNode, "id">,
  index: number,
): string {
  const raw = node.id?.trim();
  if (raw) {
    if (raw.startsWith(`region_${regionId}_node_`)) return raw;
    if (raw.startsWith("node_")) return `region_${regionId}_${raw}`;
    return `region_${regionId}_node_${raw}`;
  }
  return `region_${regionId}_node_${index}`;
}

/** Convert authored region gather markers into gameplay WorldNodes. */
export function worldNodesFromRegion(region: RegionBlueprint): WorldNode[] {
  const biome = regionBiomeToWorldBiome(region.biome);
  const out: WorldNode[] = [];
  const list = region.resourceNodes ?? [];
  for (let i = 0; i < list.length; i++) {
    const node = list[i]!;
    if (!isPlaceableRegionNodeType(node.type)) continue;
    const world = regionLocalToWorld(region, node.localX, node.localZ);
    const y = sampleRegionHeight(region, node.localX, node.localZ);
    const id = regionResourceNodeWorldId(region.id, node, i);
    const variant =
      node.variant ?? (Math.abs(hashString(id)) % 1000) / 1000;
    const model =
      node.model ??
      (node.type === "tree" ? pickRandomRegionTreeModel(region.biome, variant) : undefined);
    out.push({
      id,
      type: node.type,
      x: world.x,
      y,
      z: world.z,
      variant,
      biome,
      ...(model ? { model } : {}),
    });
  }
  return out;
}

/** Half-extent of a region's heightmap in world units (center → edge). */
export function regionHalfSpan(bp: Pick<RegionBlueprint, "gridSize" | "pitch">): number {
  return ((bp.gridSize - 1) * bp.pitch) / 2;
}

/** World-space origin of a region's local (0,0). Falls back to 0,0. */
export function regionWorldOrigin(bp: Pick<RegionBlueprint, "worldOriginX" | "worldOriginZ">): {
  x: number;
  z: number;
} {
  return { x: bp.worldOriginX ?? 0, z: bp.worldOriginZ ?? 0 };
}

export interface RegionWorldBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  originX: number;
  originZ: number;
  half: number;
}

export function regionWorldBounds(bp: Pick<RegionBlueprint, "gridSize" | "pitch" | "worldOriginX" | "worldOriginZ">): RegionWorldBounds {
  const half = regionHalfSpan(bp);
  const { x: originX, z: originZ } = regionWorldOrigin(bp);
  return {
    minX: originX - half,
    maxX: originX + half,
    minZ: originZ - half,
    maxZ: originZ + half,
    originX,
    originZ,
    half,
  };
}

export function regionContainsWorld(
  bp: Pick<RegionBlueprint, "gridSize" | "pitch" | "worldOriginX" | "worldOriginZ">,
  wx: number,
  wz: number,
  /** Expand bounds slightly so seams don't flicker. */
  pad = 0,
): boolean {
  const b = regionWorldBounds(bp);
  return wx >= b.minX - pad && wx <= b.maxX + pad && wz >= b.minZ - pad && wz <= b.maxZ + pad;
}

export function worldToRegionLocal(
  bp: Pick<RegionBlueprint, "worldOriginX" | "worldOriginZ">,
  wx: number,
  wz: number,
): { x: number; z: number } {
  const o = regionWorldOrigin(bp);
  return { x: wx - o.x, z: wz - o.z };
}

export function regionLocalToWorld(
  bp: Pick<RegionBlueprint, "worldOriginX" | "worldOriginZ">,
  lx: number,
  lz: number,
): { x: number; z: number } {
  const o = regionWorldOrigin(bp);
  return { x: o.x + lx, z: o.z + lz };
}

/** Height at a world-space point. Returns null if outside the region. */
export function sampleRegionHeightWorld(
  bp: Pick<RegionBlueprint, "gridSize" | "pitch" | "heights" | "worldOriginX" | "worldOriginZ">,
  wx: number,
  wz: number,
): number | null {
  if (!regionContainsWorld(bp, wx, wz)) return null;
  const local = worldToRegionLocal(bp, wx, wz);
  return sampleRegionHeight(bp, local.x, local.z);
}

export function sampleRegionWaterDepthWorld(
  bp: Pick<RegionBlueprint, "gridSize" | "pitch" | "waterHeights" | "worldOriginX" | "worldOriginZ">,
  wx: number,
  wz: number,
): number {
  if (!regionContainsWorld(bp, wx, wz)) return 0;
  const local = worldToRegionLocal(bp, wx, wz);
  return sampleRegionWaterDepth(bp, local.x, local.z);
}

/**
 * Pick the region covering (wx,wz). Prefer the smallest containing region if
 * overlaps exist; otherwise null (open overworld / gap).
 */
export function findRegionAtWorld(
  regions: Iterable<RegionBlueprint>,
  wx: number,
  wz: number,
): RegionBlueprint | null {
  let best: RegionBlueprint | null = null;
  let bestArea = Infinity;
  for (const bp of regions) {
    if (!regionContainsWorld(bp, wx, wz)) continue;
    const half = regionHalfSpan(bp);
    const area = half * half;
    if (area < bestArea) {
      best = bp;
      bestArea = area;
    }
  }
  return best;
}

/** Regions whose bounds fall within a world-space radius of (wx,wz). */
export function regionsNearWorld(
  regions: Iterable<RegionBlueprint>,
  wx: number,
  wz: number,
  radius: number,
): RegionBlueprint[] {
  const out: RegionBlueprint[] = [];
  const r2 = radius * radius;
  for (const bp of regions) {
    const b = regionWorldBounds(bp);
    // Distance from point to AABB (0 if inside).
    const dx = wx < b.minX ? b.minX - wx : wx > b.maxX ? wx - b.maxX : 0;
    const dz = wz < b.minZ ? b.minZ - wz : wz > b.maxZ ? wz - b.maxZ : 0;
    if (dx * dx + dz * dz <= r2) out.push(bp);
  }
  return out;
}

/**
 * Assign packed world origins for regions that lack them — lay out left→right
 * by half-span so authored neighbors share an edge for seamless streaming.
 * Mutates blueprints in place; stable order by id.
 *
 * An "authored" origin (already set on the blueprint, e.g. persisted from a
 * previous save made before other regions existed) is kept as-is *only* if it
 * doesn't overlap anything already placed earlier in this same pass —
 * otherwise it's nudged past the running cursor. Two regions saved at
 * different times, each with the *catalog as it looked then*, can otherwise
 * end up with origins whose world-space bounds genuinely overlap (verified:
 * this happened for real between two authored regions in this project's own
 * region files) — since RegionContinent mounts every region whose bounds
 * contain the player, an overlap means whichever layer iterates first wins,
 * independent of which region the player/server actually think they're in.
 * Re-checking on every call (rather than trusting "already has a value")
 * means this self-heals the moment both regions are seen together, without
 * needing a one-off migration of already-saved JSON.
 */
export function ensureRegionWorldOrigins(regions: RegionBlueprint[]): void {
  const list = [...regions].sort((a, b) => a.id.localeCompare(b.id));
  let cursor = 0;
  for (const bp of list) {
    const half = regionHalfSpan(bp);
    if (bp.worldOriginX !== undefined && bp.worldOriginZ !== undefined) {
      const minX = bp.worldOriginX - half;
      if (minX >= cursor) {
        // Doesn't overlap anything placed so far -- keep the authored spot.
        cursor = Math.max(cursor, bp.worldOriginX + half);
        continue;
      }
      // Would overlap an earlier region in this pass -- fall through and
      // re-place it past the cursor instead of trusting the stale value.
    }
    bp.worldOriginX = cursor + half;
    bp.worldOriginZ = bp.worldOriginZ ?? 0;
    cursor += half * 2;
  }
}

/** True when two region AABBs share (or nearly share) an edge. */
export function regionsShareWorldEdge(
  a: Pick<RegionBlueprint, "gridSize" | "pitch" | "worldOriginX" | "worldOriginZ">,
  b: Pick<RegionBlueprint, "gridSize" | "pitch" | "worldOriginX" | "worldOriginZ">,
  epsilon = 1,
): boolean {
  const A = regionWorldBounds(a);
  const B = regionWorldBounds(b);
  const overlapX = A.minX <= B.maxX + epsilon && B.minX <= A.maxX + epsilon;
  const overlapZ = A.minZ <= B.maxZ + epsilon && B.minZ <= A.maxZ + epsilon;
  const touchX =
    Math.abs(A.maxX - B.minX) <= epsilon || Math.abs(A.minX - B.maxX) <= epsilon;
  const touchZ =
    Math.abs(A.maxZ - B.minZ) <= epsilon || Math.abs(A.minZ - B.maxZ) <= epsilon;
  return (touchX && overlapZ) || (touchZ && overlapX);
}

/** Catalog entries that share an edge with `edit` (excludes matching id). */
export function regionsAdjacentTo(
  edit: Pick<RegionBlueprint, "id" | "gridSize" | "pitch" | "worldOriginX" | "worldOriginZ">,
  catalog: Iterable<Pick<RegionBlueprint, "id" | "gridSize" | "pitch" | "worldOriginX" | "worldOriginZ">>,
  epsilon = 1,
): Array<Pick<RegionBlueprint, "id" | "gridSize" | "pitch" | "worldOriginX" | "worldOriginZ">> {
  const out: Array<Pick<RegionBlueprint, "id" | "gridSize" | "pitch" | "worldOriginX" | "worldOriginZ">> = [];
  for (const bp of catalog) {
    if (bp.id === edit.id) continue;
    if (regionsShareWorldEdge(edit, bp, epsilon)) out.push(bp);
  }
  return out;
}

/** How close to a region edge (world meters) before we prefetch neighbors. */
export const REGION_SEAM_PREFETCH_METERS = 80;
/** Keep neighbor region meshes resident within this world radius. */
export const REGION_STREAM_RADIUS_METERS = 220;
