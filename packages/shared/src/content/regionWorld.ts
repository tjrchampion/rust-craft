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

export function getRegionGridSizeX(bp: { gridSize: number; gridSizeX?: number }): number {
  return bp.gridSizeX ?? bp.gridSize ?? 32;
}

export function getRegionGridSizeZ(bp: { gridSize: number; gridSizeZ?: number }): number {
  return bp.gridSizeZ ?? bp.gridSize ?? 32;
}

/** Half-extent along X-axis (width) in world units. */
export function regionHalfSpanX(bp: { gridSize: number; gridSizeX?: number; pitch: number }): number {
  const sizeX = getRegionGridSizeX(bp);
  return ((sizeX - 1) * bp.pitch) / 2;
}

/** Half-extent along Z-axis (height) in world units. */
export function regionHalfSpanZ(bp: { gridSize: number; gridSizeZ?: number; pitch: number }): number {
  const sizeZ = getRegionGridSizeZ(bp);
  return ((sizeZ - 1) * bp.pitch) / 2;
}

/** Max half-extent of a region's heightmap in world units (center → edge). */
export function regionHalfSpan(bp: { gridSize: number; gridSizeX?: number; gridSizeZ?: number; pitch: number }): number {
  return Math.max(regionHalfSpanX(bp), regionHalfSpanZ(bp));
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
  halfX: number;
  halfZ: number;
  half: number;
}

export function regionWorldBounds(
  bp: { gridSize: number; gridSizeX?: number; gridSizeZ?: number; pitch: number; worldOriginX?: number; worldOriginZ?: number }
): RegionWorldBounds {
  const halfX = regionHalfSpanX(bp);
  const halfZ = regionHalfSpanZ(bp);
  const { x: originX, z: originZ } = regionWorldOrigin(bp);
  return {
    minX: originX - halfX,
    maxX: originX + halfX,
    minZ: originZ - halfZ,
    maxZ: originZ + halfZ,
    originX,
    originZ,
    halfX,
    halfZ,
    half: Math.max(halfX, halfZ),
  };
}

export function regionContainsWorld(
  bp: { gridSize: number; gridSizeX?: number; gridSizeZ?: number; pitch: number; worldOriginX?: number; worldOriginZ?: number },
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

/** Squared distance from a world point to a region's AABB (0 if inside). */
function regionDistance2(bp: RegionBlueprint, wx: number, wz: number): number {
  const b = regionWorldBounds(bp);
  const dx = wx < b.minX ? b.minX - wx : wx > b.maxX ? wx - b.maxX : 0;
  const dz = wz < b.minZ ? b.minZ - wz : wz > b.maxZ ? wz - b.maxZ : 0;
  return dx * dx + dz * dz;
}

/** Regions whose bounds fall within a world-space radius of (wx,wz), nearest
 *  first when capped. `maxCount` bounds the result regardless of how many
 *  regions the radius alone would match (see MAX_ACTIVE_REGIONS) -- pass
 *  `mustIncludeId` to force one region (e.g. the one underfoot) into the
 *  result even if it would otherwise be trimmed. */
export function regionsNearWorld(
  regions: Iterable<RegionBlueprint>,
  wx: number,
  wz: number,
  radius: number,
  maxCount?: number,
  mustIncludeId?: string,
): RegionBlueprint[] {
  const out: RegionBlueprint[] = [];
  const r2 = radius * radius;
  for (const bp of regions) {
    if (regionDistance2(bp, wx, wz) <= r2) out.push(bp);
  }
  if (maxCount === undefined || out.length <= maxCount) return out;
  const sorted = out.sort((a, b) => regionDistance2(a, wx, wz) - regionDistance2(b, wx, wz));
  if (!mustIncludeId || sorted.slice(0, maxCount).some((r) => r.id === mustIncludeId)) {
    return sorted.slice(0, maxCount);
  }
  const forced = sorted.find((r) => r.id === mustIncludeId)!;
  return [forced, ...sorted.filter((r) => r.id !== mustIncludeId).slice(0, maxCount - 1)];
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
/**
 * Ensures all regions have a defined worldOriginX and worldOriginZ.
 * Authored positions set by the user in the Continent Layout Editor are ALWAYS preserved.
 * Unplaced regions (where origin is undefined) are given a clean position next to existing regions.
 */
export function ensureRegionWorldOrigins(regions: Array<Pick<RegionBlueprint, "worldOriginX" | "worldOriginZ" | "gridSize" | "gridSizeX" | "gridSizeZ" | "pitch">>): void {
  let maxRight = 0;
  for (const r of regions) {
    if (r.worldOriginX !== undefined && r.worldOriginZ !== undefined) {
      const b = regionWorldBounds(r);
      maxRight = Math.max(maxRight, b.maxX);
    }
  }

  for (const r of regions) {
    if (r.worldOriginX === undefined || r.worldOriginZ === undefined) {
      const halfX = regionHalfSpanX(r);
      r.worldOriginX = Math.round(maxRight + halfX + 10);
      r.worldOriginZ = 0;
      maxRight = r.worldOriginX + halfX;
    }
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
export const REGION_SEAM_PREFETCH_METERS = 160;
/** Mount a neighbor region once the player is within this world radius
 *  (also the radius the server keeps regions loaded/simulated at). */
export const REGION_STREAM_RADIUS_METERS = 1400;
/** Don't unload a mounted neighbor until they're this far out -- meaningfully
 *  wider than REGION_STREAM_RADIUS_METERS to avoid mount/unmount thrash. */
export const REGION_UNLOAD_RADIUS_METERS = REGION_STREAM_RADIUS_METERS + 400; // 1800m

/** Hard cap on simultaneously-active regions, independent of the meter
 *  radii above. Those were tuned for the original hand-authored continent
 *  (2-3 large regions); an authored grid of many SMALL regions packed
 *  edge-to-edge can put a dozen-plus of them inside the same fixed-meter
 *  radius at once. Every active region pays a real per-tick/per-frame cost on
 *  both sides (client: terrain/water streaming, grass, prop/NPC distance
 *  culling; server: rebuilding that region's collider set every tick per
 *  player in continentCollidersNear), so an unbounded count under dense
 *  layouts is a real perf cliff, not just bookkeeping churn. Nearest-K keeps
 *  the worst case bounded regardless of how densely a continent is authored. */
export const MAX_ACTIVE_REGIONS = 8;
/** Client mount-retention gets a little slack over MAX_ACTIVE_REGIONS (like
 *  the meter-radius hysteresis above) so a region doesn't unmount the instant
 *  it drops out of the strict top-K on ordinary movement. */
export const MAX_KEPT_REGIONS = MAX_ACTIVE_REGIONS + 3;
