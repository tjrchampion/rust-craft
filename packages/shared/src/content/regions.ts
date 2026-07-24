import { mulberry32, hashString } from "../rng";
import { fbm } from "../terrain";
import { clamp, smoothstep, lerp } from "../math";

/** Ten selectable region biomes -- covers the user's requested category list
 *  (Grasslands & Savannas, Deserts, Arctic & Tundra, Forests & Jungles,
 *  Swamps & Wetlands, Volcanic/Badlands, Alien/Otherworldly,
 *  Underground/Subterranean, Cosmic/Spiritual) with "Forests & Jungles"
 *  split into two selectable flavors (temperate vs tropical) since they use
 *  visibly different foliage sets. The four fantastical biomes (volcanic,
 *  alien, underground, cosmic) have no unique art in the project yet, so
 *  they reuse the closest existing prop sets (mountain rock/dead-tree
 *  foliage) and lean on distinct sky/fog/ambient color grading to read as
 *  their own place -- see REGION_COLOR_PRESETS. */
export type RegionBiome =
  | "grassland" | "forest" | "jungle" | "desert" | "arctic"
  | "swamp" | "volcanic" | "alien" | "underground" | "cosmic";

export const REGION_BIOMES: RegionBiome[] = [
  "grassland", "forest", "jungle", "desert", "arctic",
  "swamp", "volcanic", "alien", "underground", "cosmic",
];

export const REGION_BIOME_LABELS: Record<RegionBiome, string> = {
  grassland: "Grasslands & Savannas",
  forest: "Forests (Temperate)",
  jungle: "Jungles (Tropical)",
  desert: "Deserts",
  arctic: "Arctic & Tundra",
  swamp: "Swamps & Wetlands",
  volcanic: "Volcanic / Badlands",
  alien: "Alien / Otherworldly",
  underground: "Underground / Subterranean",
  cosmic: "Cosmic / Spiritual Plane",
};

/** Which real asset directory a RegionAsset's model lives under --
 *  unlike the dungeon editor's DungeonAsset (which only ever meant
 *  "under props/"), regions place assets from three different directories,
 *  so the category can't stay implicit. */
export type RegionAssetCategory = "building" | "foliage" | "prop";

export interface RegionAsset {
  id?: string;
  model: string;
  category: RegionAssetCategory;
  localX: number;
  localY: number;
  localZ: number;
  yaw: number;
  scale?: number;
}

/** Fallback collision-circle radius per category, used when a model has no
 *  entry in ASSET_COLLISION_OVERRIDES (world units, before `scale`). */
export const REGION_ASSET_COLLISION_RADIUS: Record<RegionAssetCategory, number> = {
  building: 3.5,
  prop: 1.1,
  foliage: 0.7,
};

/** Fallback collision height per category (world units, before `scale`). */
export const REGION_ASSET_COLLISION_HEIGHT: Record<RegionAssetCategory, number> = {
  building: 6,
  prop: 1.0,
  foliage: 1.6,
};

/** Fallback climbable flag per category. */
export const REGION_ASSET_CLIMBABLE: Record<RegionAssetCategory, boolean> = {
  building: false,
  prop: true,
  foliage: false,
};

// ── Per-model collision overrides ─────────────────────────────────────────────
// Keyed by the `model` field on RegionAsset (the same string used by the
// palette/loader, e.g. "building_home_A.gltf" or
// "medieval_village/Wall_Plaster_Straight.gltf").
//
// • null  = skip spawning a collider entirely (purely visual / walkable decal).
// • radius 0 + climbable true = walkable floor tile (no horizontal block).
// • stairHalfLength present = stair ramp: stepMovement interpolates height
//   smoothly along the ramp instead of using a flat topY, so stairs are
//   walkable rather than a solid wall.
//
// Any model NOT in this table falls back to the per-category defaults above.
export interface AssetCollisionOverride {
  /** XZ cylinder half-extent. 0 = no horizontal collision. */
  radius: number;
  /** Y-height of the solid or top surface (model-local, pre-scale). */
  height: number;
  /** True = player can stand on top; false = pure impassable wall. */
  climbable: boolean;
  /** Present on stair models: half-length of the ramp along local +Z
   *  (model-local units, pre-scale). stepMovement rotates by the placed
   *  asset's yaw before testing. */
  stairHalfLength?: number;
}

export const ASSET_COLLISION_OVERRIDES: Record<string, AssetCollisionOverride | null> = {
  // ── Existing KayKit buildings / clutter ────────────────────────────────
  "barrel.gltf": { radius: 0.55, height: 0.212, climbable: true },
  "bucket_water.gltf": { radius: 0.3, height: 0.105, climbable: false },
  "building_blacksmith.gltf": { radius: 0.547, height: 0.69, climbable: false },
  "building_bridge_A.gltf": { radius: 0.818, height: 0.875, climbable: false },
  "building_bridge_B.gltf": { radius: 0.818, height: 0.875, climbable: false },
  "building_church.gltf": { radius: 0.491, height: 1.151, climbable: false },
  "building_destroyed.gltf": { radius: 0.654, height: 0.696, climbable: false },
  "building_grain.gltf": { radius: 0.89, height: 0.276, climbable: false },
  "building_home_A.gltf": { radius: 0.363, height: 0.651, climbable: false },
  "building_home_B.gltf": { radius: 0.467, height: 0.896, climbable: false },
  "building_lumbermill.gltf": { radius: 0.581, height: 0.906, climbable: false },
  "building_market.gltf": { radius: 0.765, height: 0.687, climbable: false },
  "building_tavern.gltf": { radius: 0.566, height: 0.978, climbable: false },
  "building_tower_A.gltf": { radius: 0.49, height: 1.534, climbable: false },
  "building_well.gltf": { radius: 0.319, height: 0.578, climbable: false },
  "building_windmill.gltf": { radius: 0.478, height: 0.836, climbable: false },
  "crate_A_big.gltf": { radius: 0.55, height: 0.21, climbable: true },
  "crate_A_small.gltf": { radius: 0.55, height: 0.14, climbable: true },
  "crate_B_small.gltf": { radius: 0.55, height: 0.14, climbable: true },
  "fence_stone_straight.gltf": { radius: 0.12, height: 0.269, climbable: false },
  "fence_wood_straight.gltf": { radius: 0.12, height: 0.55, climbable: false },
  "fence_wood_straight_gate.gltf": { radius: 0.12, height: 0.65, climbable: false },
  "flag_blue.gltf": { radius: 0.1, height: 0.083, climbable: false },
  "flag_red.gltf": { radius: 0.1, height: 0.083, climbable: false },
  // ── Existing KayKit props (rocks) ─────────────────────────────────────
  "rocks.gltf": { radius: 1.207, height: 1.556, climbable: true },
  "rocks_decorated.gltf": { radius: 1.334, height: 2.434, climbable: true },
  "rocks_gold.gltf": { radius: 1.207, height: 1.599, climbable: true },
  "rocks_small.gltf": { radius: 0.915, height: 0.813, climbable: true },
  // ── Existing KayKit foliage ───────────────────────────────────────────
  // Trees: trunk radius only (not the canopy width which is huge).
  "oak_1.glb": { radius: 0.35, height: 0.55, climbable: false },
  "oak_2.glb": { radius: 0.35, height: 0.6, climbable: false },
  "oak_3.glb": { radius: 0.35, height: 0.5, climbable: false },
  "oak_4.glb": { radius: 0.35, height: 0.65, climbable: false },
  "oak_5.glb": { radius: 0.35, height: 0.55, climbable: false },
  "pine_1.glb": { radius: 0.3, height: 0.7, climbable: false },
  "pine_2.glb": { radius: 0.3, height: 0.8, climbable: false },
  "pine_3.glb": { radius: 0.3, height: 0.65, climbable: false },
  "pine_4.glb": { radius: 0.3, height: 0.75, climbable: false },
  "pine_5.glb": { radius: 0.3, height: 0.55, climbable: false },
  "dead_1.glb": { radius: 0.3, height: 0.45, climbable: false },
  "dead_2.glb": { radius: 0.3, height: 0.5, climbable: false },
  "dead_3.glb": { radius: 0.3, height: 0.4, climbable: false },
  "twisted_1.glb": { radius: 0.35, height: 0.5, climbable: false },
  "twisted_2.glb": { radius: 0.35, height: 0.45, climbable: false },
  "twisted_3.glb": { radius: 0.35, height: 0.55, climbable: false },
  "bush.glb": { radius: 0.4, height: 1.1, climbable: false },
  "bush_flowers.glb": { radius: 0.4, height: 1.2, climbable: false },
  "fern.glb": { radius: 0.3, height: 0.6, climbable: false },
  "mushroom.glb": { radius: 0.15, height: 0.35, climbable: false },
  "rock_1.glb": { radius: 0.5, height: 0.9, climbable: true },
  "rock_2.glb": { radius: 0.5, height: 1.1, climbable: true },
  "rock_3.glb": { radius: 0.5, height: 0.7, climbable: true },
  // ── Medieval Village MegaKit modular pieces ───────────────────────────
  // Balconies: walkable elevated platforms
  "medieval_village/Balcony_Cross_Corner.gltf": { radius: 1.052, height: 1.23, climbable: true },
  "medieval_village/Balcony_Cross_Straight.gltf": { radius: 1.0, height: 1.23, climbable: true },
  "medieval_village/Balcony_Simple_Corner.gltf": { radius: 1.052, height: 1.23, climbable: true },
  "medieval_village/Balcony_Simple_Straight.gltf": { radius: 1.0, height: 1.23, climbable: true },
  // Corners: thin vertical posts
  "medieval_village/Corner_ExteriorWide_Brick.gltf": { radius: 0.23, height: 3.043, climbable: false },
  "medieval_village/Corner_ExteriorWide_Wood.gltf": { radius: 0.10, height: 3.0, climbable: false },
  "medieval_village/Corner_Exterior_Brick.gltf": { radius: 0.17, height: 3.016, climbable: false },
  "medieval_village/Corner_Exterior_TopDown.gltf": { radius: 0.03, height: 2.467, climbable: false },
  "medieval_village/Corner_Exterior_TopOnly.gltf": { radius: 0.03, height: 0.234, climbable: false },
  "medieval_village/Corner_Exterior_Wood.gltf": { radius: 0.07, height: 3.0, climbable: false },
  "medieval_village/Corner_Interior_Big.gltf": { radius: 0.11, height: 3.0, climbable: false },
  "medieval_village/Corner_Interior_Small.gltf": { radius: 0.07, height: 3.0, climbable: false },
  // Floors: walkable surfaces, no horizontal blocking
  "medieval_village/Floor_Brick.gltf": { radius: 0, height: 0.02, climbable: true },
  "medieval_village/Floor_RedBrick.gltf": { radius: 0, height: 0.02, climbable: true },
  "medieval_village/Floor_UnevenBrick.gltf": { radius: 0, height: 0.02, climbable: true },
  "medieval_village/Floor_WoodDark.gltf": { radius: 0, height: 0.02, climbable: true },
  "medieval_village/Floor_WoodDark_Half1.gltf": { radius: 0, height: 0.02, climbable: true },
  "medieval_village/Floor_WoodDark_Half2.gltf": { radius: 0, height: 0.02, climbable: true },
  "medieval_village/Floor_WoodDark_Half3.gltf": { radius: 0, height: 0.02, climbable: true },
  "medieval_village/Floor_WoodDark_OverhangCorner.gltf": { radius: 0, height: 0.02, climbable: true },
  "medieval_village/Floor_WoodDark_OverhangCorner2.gltf": { radius: 0, height: 0.02, climbable: true },
  "medieval_village/Floor_WoodLight.gltf": { radius: 0, height: 0.02, climbable: true },
  "medieval_village/Floor_WoodLight_OverhangCorner.gltf": { radius: 0, height: 0.02, climbable: true },
  "medieval_village/Floor_WoodLight_OverhangCorner2.gltf": { radius: 0, height: 0.02, climbable: true },
  "medieval_village/HoleCover_90Angle.gltf": { radius: 0, height: 0.21, climbable: true },
  "medieval_village/HoleCover_90Half.gltf": { radius: 0, height: 0.21, climbable: true },
  "medieval_village/HoleCover_90Stairs.gltf": { radius: 0, height: 0.21, climbable: true },
  "medieval_village/HoleCover_Straight.gltf": { radius: 0, height: 0.21, climbable: true },
  "medieval_village/HoleCover_StraightHalf.gltf": { radius: 0, height: 0.21, climbable: true },
  // Stairs (exterior): 2m wide, 1m rise, ~2m depth -- ramp colliders
  "medieval_village/Stairs_Exterior_NoFirstStep.gltf": { radius: 1.0, height: 1.0, climbable: true, stairHalfLength: 1.04 },
  "medieval_village/Stairs_Exterior_Platform.gltf": { radius: 1.0, height: 1.0, climbable: true, stairHalfLength: 1.0 },
  "medieval_village/Stairs_Exterior_Platform45.gltf": { radius: 1.0, height: 1.0, climbable: true, stairHalfLength: 1.0 },
  "medieval_village/Stairs_Exterior_Platform45Clean.gltf": { radius: 1.0, height: 1.0, climbable: true, stairHalfLength: 1.0 },
  "medieval_village/Stairs_Exterior_PlatformU.gltf": { radius: 1.0, height: 1.0, climbable: true, stairHalfLength: 1.0 },
  "medieval_village/Stairs_Exterior_SidePlatform.gltf": { radius: 1.0, height: 1.0, climbable: true, stairHalfLength: 1.0 },
  "medieval_village/Stairs_Exterior_Sides.gltf": { radius: 1.0, height: 1.0, climbable: true, stairHalfLength: 1.0 },
  "medieval_village/Stairs_Exterior_Sides45.gltf": { radius: 1.0, height: 1.0, climbable: true, stairHalfLength: 1.0 },
  "medieval_village/Stairs_Exterior_SidesU.gltf": { radius: 1.0, height: 1.0, climbable: true, stairHalfLength: 1.0 },
  "medieval_village/Stairs_Exterior_SingleSide.gltf": { radius: 0.1, height: 1.0, climbable: true, stairHalfLength: 1.0 },
  "medieval_village/Stairs_Exterior_SingleSideThick.gltf": { radius: 0.2, height: 1.0, climbable: true, stairHalfLength: 1.0 },
  "medieval_village/Stairs_Exterior_Straight.gltf": { radius: 1.0, height: 1.204, climbable: true, stairHalfLength: 1.04 },
  "medieval_village/Stairs_Exterior_Straight_Center.gltf": { radius: 1.0, height: 1.022, climbable: true, stairHalfLength: 1.04 },
  "medieval_village/Stairs_Exterior_Straight_L.gltf": { radius: 1.0, height: 1.204, climbable: true, stairHalfLength: 1.04 },
  "medieval_village/Stairs_Exterior_Straight_R.gltf": { radius: 1.0, height: 1.204, climbable: true, stairHalfLength: 1.04 },
  // Stairs (interior): taller rise, deeper run
  "medieval_village/Stair_Interior_Rails.gltf": { radius: 0.86, height: 3.931, climbable: true, stairHalfLength: 2.28 },
  "medieval_village/Stair_Interior_Simple.gltf": { radius: 0.84, height: 3.035, climbable: true, stairHalfLength: 2.31 },
  "medieval_village/Stair_Interior_Solid.gltf": { radius: 0.88, height: 3.046, climbable: true, stairHalfLength: 2.36 },
  "medieval_village/Stair_Interior_SolidExtended.gltf": { radius: 0.88, height: 3.046, climbable: true, stairHalfLength: 3.08 },
  // Props
  "medieval_village/Prop_Brick1.gltf": { radius: 0.138, height: 0.208, climbable: true },
  "medieval_village/Prop_Brick2.gltf": { radius: 0.158, height: 0.245, climbable: true },
  "medieval_village/Prop_Brick3.gltf": { radius: 0.153, height: 0.25, climbable: true },
  "medieval_village/Prop_Brick4.gltf": { radius: 0.103, height: 0.25, climbable: true },
  "medieval_village/Prop_Chimney.gltf": { radius: 0.4, height: 2.0, climbable: false },
  "medieval_village/Prop_Chimney2.gltf": { radius: 0.3, height: 1.5, climbable: false },
  "medieval_village/Prop_Crate.gltf": { radius: 0.6, height: 1.06, climbable: true },
  "medieval_village/Prop_ExteriorBorder_Corner.gltf": { radius: 0.1, height: 0.134, climbable: false },
  "medieval_village/Prop_ExteriorBorder_Straight1.gltf": { radius: 0.1, height: 0.134, climbable: false },
  "medieval_village/Prop_ExteriorBorder_Straight2.gltf": { radius: 0.1, height: 0.134, climbable: false },
  "medieval_village/Prop_MetalFence_Ornament.gltf": { radius: 0.1, height: 2.852, climbable: false },
  "medieval_village/Prop_MetalFence_Simple.gltf": { radius: 0.1, height: 2.868, climbable: false },
  "medieval_village/Prop_Support.gltf": { radius: 0.15, height: 1.709, climbable: false },
  "medieval_village/Prop_Wagon.gltf": { radius: 1.8, height: 1.529, climbable: false },
  "medieval_village/Prop_WoodenFence_Extension1.gltf": { radius: 0.1, height: 0.838, climbable: false },
  "medieval_village/Prop_WoodenFence_Extension2.gltf": { radius: 0.1, height: 0.838, climbable: false },
  "medieval_village/Prop_WoodenFence_Single.gltf": { radius: 0.1, height: 0.838, climbable: false },
  // Walls: thin slab collision matching actual panel depth
  "medieval_village/Wall_Arch.gltf": { radius: 0.125, height: 3.0, climbable: false },
  "medieval_village/Wall_BottomCover.gltf": { radius: 0.216, height: 0.237, climbable: false },
  "medieval_village/Wall_Plaster_Door_Flat.gltf": { radius: 0.203, height: 3.123, climbable: false },
  "medieval_village/Wall_Plaster_Door_Round.gltf": { radius: 0.203, height: 3.123, climbable: false },
  "medieval_village/Wall_Plaster_Door_RoundInset.gltf": { radius: 0.546, height: 3.123, climbable: false },
  "medieval_village/Wall_Plaster_Straight.gltf": { radius: 0.203, height: 3.125, climbable: false },
  "medieval_village/Wall_Plaster_Straight_Base.gltf": { radius: 0.203, height: 3.123, climbable: false },
  "medieval_village/Wall_Plaster_Straight_L.gltf": { radius: 0.203, height: 3.123, climbable: false },
  "medieval_village/Wall_Plaster_Straight_R.gltf": { radius: 0.203, height: 3.123, climbable: false },
  "medieval_village/Wall_Plaster_Window_Thin_Round.gltf": { radius: 0.203, height: 3.123, climbable: false },
  "medieval_village/Wall_Plaster_Window_Wide_Flat.gltf": { radius: 0.203, height: 3.123, climbable: false },
  "medieval_village/Wall_Plaster_Window_Wide_Flat2.gltf": { radius: 0.203, height: 3.146, climbable: false },
  "medieval_village/Wall_Plaster_Window_Wide_Round.gltf": { radius: 0.203, height: 3.123, climbable: false },
  "medieval_village/Wall_Plaster_WoodGrid.gltf": { radius: 0.203, height: 3.123, climbable: false },
  "medieval_village/Wall_UnevenBrick_Door_Flat.gltf": { radius: 0.203, height: 3.123, climbable: false },
  "medieval_village/Wall_UnevenBrick_Door_Round.gltf": { radius: 0.203, height: 3.123, climbable: false },
  "medieval_village/Wall_UnevenBrick_Straight.gltf": { radius: 0.203, height: 3.123, climbable: false },
  "medieval_village/Wall_UnevenBrick_Window_Thin_Round.gltf": { radius: 0.203, height: 3.123, climbable: false },
  "medieval_village/Wall_UnevenBrick_Window_Wide_Flat.gltf": { radius: 0.203, height: 3.123, climbable: false },
  "medieval_village/Wall_UnevenBrick_Window_Wide_Round.gltf": { radius: 0.203, height: 3.123, climbable: false },
  // ── Stylized Nature MegaKit ───────────────────────────────────────────
  // Trees: trunk-only radius
  "stylized_nature/CommonTree_1.gltf": { radius: 0.35, height: 0.872, climbable: false },
  "stylized_nature/CommonTree_2.gltf": { radius: 0.35, height: 0.917, climbable: false },
  "stylized_nature/CommonTree_3.gltf": { radius: 0.35, height: 1.131, climbable: false },
  "stylized_nature/CommonTree_4.gltf": { radius: 0.35, height: 1.133, climbable: false },
  "stylized_nature/CommonTree_5.gltf": { radius: 0.35, height: 0.841, climbable: false },
  "stylized_nature/DeadTree_1.gltf": { radius: 0.35, height: 1.139, climbable: false },
  "stylized_nature/DeadTree_2.gltf": { radius: 0.35, height: 1.379, climbable: false },
  "stylized_nature/DeadTree_3.gltf": { radius: 0.35, height: 1.594, climbable: false },
  "stylized_nature/DeadTree_4.gltf": { radius: 0.35, height: 1.533, climbable: false },
  "stylized_nature/DeadTree_5.gltf": { radius: 0.35, height: 1.972, climbable: false },
  "stylized_nature/Pine_1.gltf": { radius: 0.35, height: 0.878, climbable: false },
  "stylized_nature/Pine_2.gltf": { radius: 0.35, height: 0.885, climbable: false },
  "stylized_nature/Pine_3.gltf": { radius: 0.35, height: 0.887, climbable: false },
  "stylized_nature/Pine_4.gltf": { radius: 0.35, height: 1.228, climbable: false },
  "stylized_nature/Pine_5.gltf": { radius: 0.35, height: 1.047, climbable: false },
  "stylized_nature/TwistedTree_1.gltf": { radius: 0.35, height: 2.007, climbable: false },
  "stylized_nature/TwistedTree_2.gltf": { radius: 0.35, height: 2.274, climbable: false },
  "stylized_nature/TwistedTree_3.gltf": { radius: 0.35, height: 1.929, climbable: false },
  "stylized_nature/TwistedTree_4.gltf": { radius: 0.35, height: 2.249, climbable: false },
  "stylized_nature/TwistedTree_5.gltf": { radius: 0.35, height: 1.879, climbable: false },
  // Bushes / ground cover
  "stylized_nature/Bush_Common.gltf": { radius: 0.393, height: 0.949, climbable: false },
  "stylized_nature/Bush_Common_Flowers.gltf": { radius: 0.393, height: 0.949, climbable: false },
  "stylized_nature/Clover_1.gltf": { radius: 0.16, height: 0.687, climbable: false },
  "stylized_nature/Clover_2.gltf": { radius: 0.17, height: 0.758, climbable: false },
  "stylized_nature/Fern_1.gltf": { radius: 0.35, height: 1.613, climbable: false },
  "stylized_nature/Mushroom_Common.gltf": { radius: 0.234, height: 0.464, climbable: false },
  "stylized_nature/Mushroom_Laetiporus.gltf": { radius: 0.41, height: 0.767, climbable: false },
  "stylized_nature/Plant_1.gltf": { radius: 0.277, height: 0.608, climbable: false },
  "stylized_nature/Plant_1_Big.gltf": { radius: 0.45, height: 2.254, climbable: false },
  "stylized_nature/Plant_7.gltf": { radius: 0.21, height: 0.15, climbable: false },
  "stylized_nature/Plant_7_Big.gltf": { radius: 0.27, height: 0.152, climbable: false },
  // Rocks — climbable
  "stylized_nature/Rock_Medium_1.gltf": { radius: 1.371, height: 2.26, climbable: true },
  "stylized_nature/Rock_Medium_2.gltf": { radius: 1.296, height: 1.899, climbable: true },
  "stylized_nature/Rock_Medium_3.gltf": { radius: 1.477, height: 2.316, climbable: true },
  // null = purely visual / walkable decal, no collider spawned
  "medieval_village/DoorFrame_Flat_Brick.gltf": null,
  "medieval_village/DoorFrame_Flat_WoodDark.gltf": null,
  "medieval_village/DoorFrame_Round_Brick.gltf": null,
  "medieval_village/DoorFrame_Round_WoodDark.gltf": null,
  "medieval_village/Door_1_Flat.gltf": null,
  "medieval_village/Door_1_Round.gltf": null,
  "medieval_village/Door_2_Flat.gltf": null,
  "medieval_village/Door_2_Round.gltf": null,
  "medieval_village/Door_4_Flat.gltf": null,
  "medieval_village/Door_4_Round.gltf": null,
  "medieval_village/Door_8_Flat.gltf": null,
  "medieval_village/Door_8_Round.gltf": null,
  "medieval_village/Overhang_Plaster_Corner.gltf": null,
  "medieval_village/Overhang_Plaster_Corner_Front.gltf": null,
  "medieval_village/Overhang_Plaster_Long.gltf": null,
  "medieval_village/Overhang_Plaster_Short.gltf": null,
  "medieval_village/Overhang_RoofIncline_Plaster.gltf": null,
  "medieval_village/Overhang_RoofIncline_UnevenBricks.gltf": null,
  "medieval_village/Overhang_Roof_Plaster.gltf": null,
  "medieval_village/Overhang_Roof_UnevenBricks.gltf": null,
  "medieval_village/Overhang_Side_Plaster_Long_L.gltf": null,
  "medieval_village/Overhang_Side_Plaster_Long_R.gltf": null,
  "medieval_village/Overhang_Side_Plaster_Short_L.gltf": null,
  "medieval_village/Overhang_Side_Plaster_Short_R.gltf": null,
  "medieval_village/Overhang_Side_UnevenBrick_Long_L.gltf": null,
  "medieval_village/Overhang_Side_UnevenBrick_Long_R.gltf": null,
  "medieval_village/Overhang_Side_UnevenBrick_Short_L.gltf": null,
  "medieval_village/Overhang_Side_UnevenBrick_Short_R.gltf": null,
  "medieval_village/Overhang_UnevenBrick_Corner.gltf": null,
  "medieval_village/Overhang_UnevenBrick_Corner_Front.gltf": null,
  "medieval_village/Overhang_UnevenBrick_Long.gltf": null,
  "medieval_village/Overhang_UnevenBrick_Short.gltf": null,
  "medieval_village/Prop_Vine1.gltf": null,
  "medieval_village/Prop_Vine2.gltf": null,
  "medieval_village/Prop_Vine4.gltf": null,
  "medieval_village/Prop_Vine5.gltf": null,
  "medieval_village/Prop_Vine6.gltf": null,
  "medieval_village/Prop_Vine9.gltf": null,
  "medieval_village/Roof_2x4_RoundTile.gltf": null,
  "medieval_village/Roof_Dormer_RoundTile.gltf": null,
  "medieval_village/Roof_FrontSupports.gltf": null,
  "medieval_village/Roof_Front_Brick2.gltf": null,
  "medieval_village/Roof_Front_Brick4.gltf": null,
  "medieval_village/Roof_Front_Brick4_Half_L.gltf": null,
  "medieval_village/Roof_Front_Brick4_Half_R.gltf": null,
  "medieval_village/Roof_Front_Brick6.gltf": null,
  "medieval_village/Roof_Front_Brick6_Half_L.gltf": null,
  "medieval_village/Roof_Front_Brick6_Half_R.gltf": null,
  "medieval_village/Roof_Front_Brick8.gltf": null,
  "medieval_village/Roof_Front_Brick8_Half_L.gltf": null,
  "medieval_village/Roof_Front_Brick8_Half_R.gltf": null,
  "medieval_village/Roof_Log.gltf": null,
  "medieval_village/Roof_Modular_RoundTiles.gltf": null,
  "medieval_village/Roof_RoundTile_2x1.gltf": null,
  "medieval_village/Roof_RoundTile_2x1_Long.gltf": null,
  "medieval_village/Roof_RoundTiles_4x4.gltf": null,
  "medieval_village/Roof_RoundTiles_4x6.gltf": null,
  "medieval_village/Roof_RoundTiles_4x8.gltf": null,
  "medieval_village/Roof_RoundTiles_6x10.gltf": null,
  "medieval_village/Roof_RoundTiles_6x12.gltf": null,
  "medieval_village/Roof_RoundTiles_6x14.gltf": null,
  "medieval_village/Roof_RoundTiles_6x4.gltf": null,
  "medieval_village/Roof_RoundTiles_6x6.gltf": null,
  "medieval_village/Roof_RoundTiles_6x8.gltf": null,
  "medieval_village/Roof_RoundTiles_8x10.gltf": null,
  "medieval_village/Roof_RoundTiles_8x12.gltf": null,
  "medieval_village/Roof_RoundTiles_8x14.gltf": null,
  "medieval_village/Roof_RoundTiles_8x8.gltf": null,
  "medieval_village/Roof_Support2.gltf": null,
  "medieval_village/Roof_Tower_RoundTiles.gltf": null,
  "medieval_village/Roof_Wooden_2x1.gltf": null,
  "medieval_village/Roof_Wooden_2x1_Center.gltf": null,
  "medieval_village/Roof_Wooden_2x1_Center_Mirror.gltf": null,
  "medieval_village/Roof_Wooden_2x1_Corner.gltf": null,
  "medieval_village/Roof_Wooden_2x1_L.gltf": null,
  "medieval_village/Roof_Wooden_2x1_Middle.gltf": null,
  "medieval_village/Roof_Wooden_2x1_R.gltf": null,
  "medieval_village/WindowShutters_Thin_Flat_Closed.gltf": null,
  "medieval_village/WindowShutters_Thin_Flat_Open.gltf": null,
  "medieval_village/WindowShutters_Thin_Round_Closed.gltf": null,
  "medieval_village/WindowShutters_Thin_Round_Open.gltf": null,
  "medieval_village/WindowShutters_Wide_Flat_Closed.gltf": null,
  "medieval_village/WindowShutters_Wide_Flat_Open.gltf": null,
  "medieval_village/WindowShutters_Wide_Round_Closed.gltf": null,
  "medieval_village/WindowShutters_Wide_Round_Open.gltf": null,
  "medieval_village/Window_Roof_Thin.gltf": null,
  "medieval_village/Window_Roof_Wide.gltf": null,
  "medieval_village/Window_Thin_Flat1.gltf": null,
  "medieval_village/Window_Thin_Round1.gltf": null,
  "medieval_village/Window_Wide_Flat1.gltf": null,
  "medieval_village/Window_Wide_Round1.gltf": null,
  "stylized_nature/Flower_3_Group.gltf": null,
  "stylized_nature/Flower_3_Single.gltf": null,
  "stylized_nature/Flower_4_Group.gltf": null,
  "stylized_nature/Flower_4_Single.gltf": null,
  "stylized_nature/Grass_Common_Short.gltf": null,
  "stylized_nature/Grass_Common_Tall.gltf": null,
  "stylized_nature/Grass_Wispy_Short.gltf": null,
  "stylized_nature/Grass_Wispy_Tall.gltf": null,
  "stylized_nature/Pebble_Round_1.gltf": null,
  "stylized_nature/Pebble_Round_2.gltf": null,
  "stylized_nature/Pebble_Round_3.gltf": null,
  "stylized_nature/Pebble_Round_4.gltf": null,
  "stylized_nature/Pebble_Round_5.gltf": null,
  "stylized_nature/Pebble_Square_1.gltf": null,
  "stylized_nature/Pebble_Square_2.gltf": null,
  "stylized_nature/Pebble_Square_3.gltf": null,
  "stylized_nature/Pebble_Square_4.gltf": null,
  "stylized_nature/Pebble_Square_5.gltf": null,
  "stylized_nature/Pebble_Square_6.gltf": null,
  "stylized_nature/RockPath_Round_Small_1.gltf": null,
  "stylized_nature/RockPath_Round_Small_2.gltf": null,
  "stylized_nature/RockPath_Round_Small_3.gltf": null,
  "stylized_nature/RockPath_Round_Thin.gltf": null,
  "stylized_nature/RockPath_Round_Wide.gltf": null,
  "stylized_nature/RockPath_Square_Small_1.gltf": null,
  "stylized_nature/RockPath_Square_Small_2.gltf": null,
  "stylized_nature/RockPath_Square_Small_3.gltf": null,
  "stylized_nature/RockPath_Square_Thin.gltf": null,
  "stylized_nature/RockPath_Square_Wide.gltf": null,
};

export interface RegionAssetCollider {
  x: number;
  z: number;
  radius: number;
  /** World Y of the surface a player standing on top of this asset rests
   *  at (base localY + its own climb height * scale). Only load-bearing
   *  when `climbable` is true. */
  topY: number;
  climbable: boolean;
  /** Present on stair-ramp assets: the ramp ascends from `topY - rise*scale`
   *  at the foot end to `topY` at the top end, along this world-space
   *  direction (unit vector, already rotated by the placed asset's yaw).
   *  halfLength is the half-extent of the ramp rectangle along that direction
   *  (world units, already scaled). stepMovement uses this to interpolate
   *  height linearly along the ramp instead of treating it as a flat topY. */
  stairRamp?: { dx: number; dz: number; halfLength: number; rise: number };
}

/** Returns the per-model override for `model`, falling back to per-category
 *  defaults. Returns `null` if the model explicitly has no collision. */
function resolveCollisionOverride(
  model: string,
  category: RegionAssetCategory,
): AssetCollisionOverride | null {
  if (model in ASSET_COLLISION_OVERRIDES) {
    return ASSET_COLLISION_OVERRIDES[model] ?? null;
  }
  return {
    radius: REGION_ASSET_COLLISION_RADIUS[category],
    height: REGION_ASSET_COLLISION_HEIGHT[category],
    climbable: REGION_ASSET_CLIMBABLE[category],
  };
}

/** Flattens a region's placed assets into the collision shapes
 *  stepMovement() (and the region editor's own Playtest mode) check player
 *  movement against. Assets with null collision (purely visual decals) are
 *  omitted. Stair assets get a stairRamp descriptor for smooth ramp height
 *  interpolation (same mechanism as dungeon tile stairs). */
export function regionAssetColliders(assets: RegionAsset[]): RegionAssetCollider[] {
  const out: RegionAssetCollider[] = [];
  for (const a of assets) {
    const scale = a.scale ?? 1;
    const ov = resolveCollisionOverride(a.model, a.category);
    if (ov === null) continue; // purely visual, no collider
    if (ov.radius === 0 && !ov.climbable) continue; // degenerate, skip

    const collider: RegionAssetCollider = {
      x: a.localX,
      z: a.localZ,
      radius: ov.radius * scale,
      topY: a.localY + ov.height * scale,
      climbable: ov.climbable,
    };

    if (ov.stairHalfLength !== undefined) {
      // Rotate the local +Z ramp direction by the placed asset's yaw so
      // stepMovement tests in world space. Same convention as
      // deriveDungeonGridFromAssets: yaw 0 -> ascending toward -Z.
      const sin = Math.sin(a.yaw);
      const cos = Math.cos(a.yaw);
      collider.stairRamp = {
        // Local +Z rotated by yaw (THREE.js Euler Y rotation: new_z = cos*z - sin*x)
        dx: -sin,
        dz: -cos,
        halfLength: ov.stairHalfLength * scale,
        rise: ov.height * scale,
      };
    }

    out.push(collider);
  }
  return out;
}

export interface RegionMobSpawn {
  localX: number;
  localZ: number;
  /** Author-pinned specific mob type; when absent the server rolls one from
   *  the region's biome mob table at spawn time (see REGION_MOB_TABLE). */
  type?: string;
}

export interface RegionVillage {
  id?: string;
  name: string;
  localX: number;
  localZ: number;
  radius: number;
}

export interface RegionColorGrading {
  skyColor: string;
  fogColor: string;
  fogDensity: number;
  ambientColor: string;
  ambientIntensity: number;
  sunColor: string;
  sunIntensity: number;
  /** Tint applied to the terrain's grass-weighted ground texture (see
   *  regionGroundWeights in client/render/terrain.ts) -- optional so regions
   *  saved before this existed still load, falling back to a per-biome
   *  default there rather than requiring a migration. */
  groundTint?: string;
}

/** A hand-painted road: a polyline of local (x,z) points the terrain shader
 *  blends toward a dirt texture near, mirroring how the open world's
 *  generatePaths() segments carve dirt into its own ground shader -- see
 *  regionRoadBlendAt in client/render/terrain.ts. Purely cosmetic (no
 *  height/collision effect), so this lives only in the visual data, not
 *  anything movement.ts reads. */
export interface RegionRoad {
  points: { x: number; z: number }[];
  /** Full width in world units -- the dirt blend fades out over ~1.5 units past width/2. */
  width: number;
}

/** Hand-authored (or procedurally-drafted) standalone zone, produced by the
 *  in-browser region editor (packages/client/src/render/RegionEditorScene.ts)
 *  and saved to packages/shared/src/content/regionBlueprints/<id>.json.
 *  Unlike the open world's terrain (an infinite noise function, no stored
 *  heightmap anywhere), a region's ground is a real authored/generated
 *  heightmap grid so it can be sculpted and persisted. */
export interface RegionPointLight {
  id?: string;
  localX: number;
  localY: number;
  localZ: number;
  color: string;
  intensity: number;
  distance: number;
}

export interface RegionBlueprint {
  id: string;
  name: string;
  biome: RegionBiome;
  /** Heightmap resolution per axis. */
  gridSize: number;
  /** World units between adjacent heightmap samples. */
  pitch: number;
  /** Flattened gridSize*gridSize height values, row-major (index = gz*gridSize+gx). */
  heights: number[];
  assets: RegionAsset[];
  mobSpawns: RegionMobSpawn[];
  villages: RegionVillage[];
  /** Optional -- absent on regions saved before roads existed; every reader
   *  falls back to an empty array rather than requiring a migration. */
  roads?: RegionRoad[];
  colorGrading: RegionColorGrading;
  /** Where a player spawns after walking through this region's portal. */
  entryLocal: { x: number; z: number };
  /** Where this region's portal prop sits in the main open world. Both left
   *  at 0 mean "not placed in the world yet" (editor-only draft). */
  portalWorldX: number;
  portalWorldZ: number;
  /** Optional -- flattened gridSize*gridSize water depth values (in world units).
   *  If absent or 0 at a cell, there is no water surface there. */
  waterHeights?: number[];
  /** Optional -- flattened gridSize*gridSize texture paint ID values:
   *  0=auto/biome, 1=grass, 2=dirt, 3=cobble, 4=snow, 5=rock, 6=sand. */
  customTextures?: number[];
  /** Optional -- authored point lights placed in the region. */
  lights?: RegionPointLight[];
  /** Optional -- id of the REGION_MUSIC_TRACKS entry to loop while inside this
   *  region (fades in on entry, out on exit). Absent/null means no music. */
  musicTrack?: string | null;
}

/** A single loopable background-music track available to the region editor,
 *  backed by a real mp3 under public/assets/audio/music/. */
export interface RegionMusicTrack {
  id: string;
  label: string;
  file: string;
}

export const REGION_MUSIC_TRACKS: RegionMusicTrack[] = [
  { id: "action-1", label: "Action 1", file: "action-1.mp3" },
  { id: "action-2", label: "Action 2", file: "action-2.mp3" },
  { id: "action-3", label: "Action 3", file: "action-3.mp3" },
  { id: "action-4", label: "Action 4", file: "action-4.mp3" },
  { id: "action-5", label: "Action 5", file: "action-5.mp3" },
  { id: "ambient-1", label: "Ambient 1", file: "ambient-1.mp3" },
  { id: "ambient-2", label: "Ambient 2", file: "ambient-2.mp3" },
  { id: "ambient-3", label: "Ambient 3", file: "ambient-3.mp3" },
  { id: "ambient-4", label: "Ambient 4", file: "ambient-4.mp3" },
  { id: "ambient-5", label: "Ambient 5", file: "ambient-5.mp3" },
  { id: "ambient-6", label: "Ambient 6", file: "ambient-6.mp3" },
  { id: "ambient-7", label: "Ambient 7", file: "ambient-7.mp3" },
  { id: "ambient-8", label: "Ambient 8", file: "ambient-8.mp3" },
  { id: "ambient-9", label: "Ambient 9", file: "ambient-9.mp3" },
  { id: "ambient-10", label: "Ambient 10", file: "ambient-10.mp3" },
  { id: "dark-ambient-1", label: "Dark Ambient 1", file: "dark-ambient-1.mp3" },
  { id: "dark-ambient-2", label: "Dark Ambient 2", file: "dark-ambient-2.mp3" },
  { id: "dark-ambient-3", label: "Dark Ambient 3", file: "dark-ambient-3.mp3" },
  { id: "dark-ambient-4", label: "Dark Ambient 4", file: "dark-ambient-4.mp3" },
  { id: "dark-ambient-5", label: "Dark Ambient 5", file: "dark-ambient-5.mp3" },
  { id: "light-ambience-1", label: "Light Ambience 1", file: "light-ambience-1.mp3" },
  { id: "light-ambience-2", label: "Light Ambience 2", file: "light-ambience-2.mp3" },
  { id: "light-ambience-3", label: "Light Ambience 3", file: "light-ambience-3.mp3" },
  { id: "light-ambience-4", label: "Light Ambience 4", file: "light-ambience-4.mp3" },
  { id: "light-ambience-5", label: "Light Ambience 5", file: "light-ambience-5.mp3" },
];

export function regionMusicTrackUrl(trackId: string | null | undefined): string | null {
  if (!trackId) return null;
  const track = REGION_MUSIC_TRACKS.find((t) => t.id === trackId);
  return track ? `/assets/audio/music/${track.file}` : null;
}

function regionHalfSpan(gridSize: number, pitch: number): number {
  return ((gridSize - 1) * pitch) / 2;
}

/** Bilinear height sample at local (x,z) over the blueprint's heightmap --
 *  the region equivalent of shared terrain.ts's terrainHeight(), used by
 *  both the client's region terrain mesh builder and anything placing
 *  assets/mobs/players onto the ground. Coordinates outside the grid clamp
 *  to the nearest edge rather than extrapolating. */
export function sampleRegionHeight(blueprint: Pick<RegionBlueprint, "gridSize" | "pitch" | "heights">, x: number, z: number): number {
  const { gridSize, pitch, heights } = blueprint;
  const half = regionHalfSpan(gridSize, pitch);
  const gx = (x + half) / pitch;
  const gz = (z + half) / pitch;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const tx = clamp(gx - x0, 0, 1);
  const tz = clamp(gz - z0, 0, 1);
  const cx0 = clamp(x0, 0, gridSize - 1);
  const cx1 = clamp(x0 + 1, 0, gridSize - 1);
  const cz0 = clamp(z0, 0, gridSize - 1);
  const cz1 = clamp(z0 + 1, 0, gridSize - 1);
  const h00 = heights[cz0 * gridSize + cx0] ?? 0;
  const h10 = heights[cz0 * gridSize + cx1] ?? 0;
  const h01 = heights[cz1 * gridSize + cx0] ?? 0;
  const h11 = heights[cz1 * gridSize + cx1] ?? 0;
  const a = h00 + (h10 - h00) * tx;
  const b = h01 + (h11 - h01) * tx;
  return a + (b - a) * tz;
}

/** Bilinear water depth sample at local (x,z) over the blueprint's water grid.
 *  Returns 0 if no water is present. */
export function sampleRegionWaterDepth(blueprint: Pick<RegionBlueprint, "gridSize" | "pitch"> & { waterHeights?: number[] }, x: number, z: number): number {
  const { gridSize, pitch, waterHeights } = blueprint;
  if (!waterHeights || waterHeights.length === 0) return 0;
  const half = regionHalfSpan(gridSize, pitch);
  const gx = (x + half) / pitch;
  const gz = (z + half) / pitch;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const tx = clamp(gx - x0, 0, 1);
  const tz = clamp(gz - z0, 0, 1);
  const cx0 = clamp(x0, 0, gridSize - 1);
  const cx1 = clamp(x0 + 1, 0, gridSize - 1);
  const cz0 = clamp(z0, 0, gridSize - 1);
  const cz1 = clamp(z0 + 1, 0, gridSize - 1);
  const w00 = waterHeights[cz0 * gridSize + cx0] ?? 0;
  const w10 = waterHeights[cz0 * gridSize + cx1] ?? 0;
  const w01 = waterHeights[cz1 * gridSize + cx0] ?? 0;
  const w11 = waterHeights[cz1 * gridSize + cx1] ?? 0;
  const a = w00 + (w10 - w00) * tx;
  const b = w01 + (w11 - w01) * tx;
  return Math.max(0, a + (b - a) * tz);
}


/** Rise-over-run slope magnitude at local (x,z), central-difference over
 *  sampleRegionHeight -- the region equivalent of shared terrain.ts's
 *  terrainSlope(), used both to keep procedural scatter off of cliff faces
 *  and to pick grass/rock/snow ground texture weights. */
export function regionSlopeAt(blueprint: Pick<RegionBlueprint, "gridSize" | "pitch" | "heights">, x: number, z: number, eps = 1.5): number {
  const hx = sampleRegionHeight(blueprint, x + eps, z) - sampleRegionHeight(blueprint, x - eps, z);
  const hz = sampleRegionHeight(blueprint, x, z + eps) - sampleRegionHeight(blueprint, x, z - eps);
  return Math.hypot(hx, hz) / (2 * eps);
}

export function slugifyRegionName(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return slug || "region";
}

interface HeightPreset {
  /** Broad rolling variation (valleys/foothills) driven directly by the
   *  elevation field -- this is what makes low ground read as a valley and
   *  high ground read as a rise, even before any mountain bump is added. */
  amplitude: number;
  /** Feature size (world units) of the elevation field -- smaller means more
   *  distinct hills/valleys fit across the region instead of one giant bump. */
  cellSize: number;
  octaves: number;
  baseHeight: number;
  /** Elevation (0-1) above which the mountain bump + jagged detail kick in.
   *  Lower = more of the map reads as mountainous; >=1 disables mountains
   *  entirely (flat biomes like swamp). */
  peakThreshold: number;
  /** Extra height piled on top of the rolling terrain once elevation clears
   *  peakThreshold -- this is what turns a gentle rise into an actual peak. */
  mountainHeight: number;
  /** Fine ridge/crag noise amplitude, gated by mountain strength so valleys
   *  stay smooth and only the peaks themselves look craggy. */
  jaggedAmp: number;
  crater?: boolean;
  plateau?: boolean;
}

const REGION_HEIGHT_PRESETS: Record<RegionBiome, HeightPreset> = {
  grassland: { amplitude: 9.0, cellSize: 65, octaves: 4, baseHeight: 0, peakThreshold: 0.72, mountainHeight: 28, jaggedAmp: 6.0 },
  forest: { amplitude: 12.0, cellSize: 55, octaves: 4, baseHeight: 0, peakThreshold: 0.68, mountainHeight: 42, jaggedAmp: 9.0 },
  jungle: { amplitude: 11.0, cellSize: 50, octaves: 4, baseHeight: 0, peakThreshold: 0.70, mountainHeight: 38, jaggedAmp: 8.0 },
  desert: { amplitude: 10.0, cellSize: 60, octaves: 3, baseHeight: 0, peakThreshold: 0.65, mountainHeight: 48, jaggedAmp: 6.0 },
  arctic: { amplitude: 16.0, cellSize: 45, octaves: 5, baseHeight: 1, peakThreshold: 0.50, mountainHeight: 75, jaggedAmp: 16.0 },
  swamp: { amplitude: 3.5, cellSize: 65, octaves: 2, baseHeight: -1.2, peakThreshold: 1.1, mountainHeight: 0, jaggedAmp: 0 },
  volcanic: { amplitude: 20.0, cellSize: 40, octaves: 5, baseHeight: 1, peakThreshold: 0.45, mountainHeight: 90, jaggedAmp: 20.0, crater: true },
  alien: { amplitude: 15.0, cellSize: 45, octaves: 5, baseHeight: 0.5, peakThreshold: 0.52, mountainHeight: 70, jaggedAmp: 15.0 },
  underground: { amplitude: 14.0, cellSize: 40, octaves: 5, baseHeight: -1, peakThreshold: 0.50, mountainHeight: 65, jaggedAmp: 16.0 },
  cosmic: { amplitude: 16.0, cellSize: 45, octaves: 5, baseHeight: 0.5, peakThreshold: 0.55, mountainHeight: 72, jaggedAmp: 14.0, plateau: true },
};

/** Max slope a scatter placement will tolerate before it's considered "on a
 *  cliff" and resampled -- keeps foliage from planting sideways out of a
 *  rock face and makes the scatter visibly hug the terrain's own contours
 *  (denser in valleys/foothills, thinning out toward jagged peaks). */
const REGION_MAX_SCATTER_SLOPE: Record<RegionBiome, number> = {
  grassland: 0.6, forest: 0.65, jungle: 0.65, desert: 0.7, arctic: 0.85,
  swamp: 0.5, volcanic: 0.9, alien: 0.9, underground: 0.85, cosmic: 0.8,
};

/** Real, already-shipped model filenames per biome -- foliage lives under
 *  assets/models/foliage/ (see packages/client/src/render/models.ts's
 *  buildBiomeTree, which already renders these same files for the open
 *  world). Fantastical biomes with no unique art reuse whichever real set
 *  reads closest (rock/dead-tree heavy). */
export const REGION_FOLIAGE: Record<RegionBiome, string[]> = {
  grassland: ["oak_1.glb", "oak_2.glb", "oak_4.glb", "bush.glb", "bush_flowers.glb", "fern.glb"],
  forest: ["oak_1.glb", "oak_2.glb", "oak_3.glb", "oak_4.glb", "oak_5.glb", "pine_1.glb", "pine_2.glb", "fern.glb", "mushroom.glb"],
  jungle: ["oak_2.glb", "oak_3.glb", "oak_5.glb", "twisted_1.glb", "bush_flowers.glb", "fern.glb", "mushroom.glb"],
  desert: ["dead_1.glb", "dead_2.glb", "dead_3.glb", "rock_1.glb", "rock_2.glb"],
  arctic: ["pine_1.glb", "pine_2.glb", "pine_3.glb", "pine_4.glb", "dead_1.glb", "dead_2.glb", "rock_2.glb"],
  swamp: ["twisted_1.glb", "twisted_2.glb", "twisted_3.glb", "dead_1.glb", "dead_2.glb", "mushroom.glb", "fern.glb", "bush.glb"],
  volcanic: ["dead_1.glb", "dead_2.glb", "dead_3.glb", "rock_1.glb", "rock_2.glb", "rock_3.glb"],
  alien: ["rock_1.glb", "rock_2.glb", "rock_3.glb", "dead_3.glb", "twisted_3.glb", "mushroom.glb"],
  underground: ["rock_1.glb", "rock_2.glb", "rock_3.glb", "mushroom.glb", "dead_2.glb"],
  cosmic: ["rock_2.glb", "rock_3.glb", "mushroom.glb", "bush_flowers.glb", "twisted_1.glb"],
};

/** Low ground-cover clutter for the grass brush -- denser and smaller-scale
 *  than REGION_FOLIAGE's trees/shrubs. Biomes without real grass/flower art
 *  (desert, volcanic, alien, underground, cosmic) fall back to whichever
 *  sparse clutter they already use for foliage. */
export const REGION_GRASS_COVER: Record<RegionBiome, string[]> = {
  grassland: [
    "stylized_nature/Grass_Common_Short.gltf", "stylized_nature/Grass_Common_Tall.gltf",
    "stylized_nature/Grass_Wispy_Short.gltf", "stylized_nature/Grass_Wispy_Tall.gltf",
    "stylized_nature/Flower_3_Single.gltf", "stylized_nature/Flower_4_Single.gltf",
  ],
  forest: [
    "stylized_nature/Grass_Common_Short.gltf", "stylized_nature/Grass_Wispy_Short.gltf",
    "stylized_nature/Grass_Wispy_Tall.gltf", "fern.glb",
  ],
  jungle: ["fern.glb", "stylized_nature/Grass_Wispy_Tall.gltf", "stylized_nature/Flower_4_Group.gltf", "mushroom.glb"],
  desert: ["dead_1.glb", "rock_1.glb"],
  arctic: ["dead_1.glb", "dead_2.glb"],
  swamp: ["fern.glb", "mushroom.glb", "bush.glb"],
  volcanic: ["rock_1.glb", "rock_2.glb"],
  alien: ["mushroom.glb", "bush_flowers.glb"],
  underground: ["mushroom.glb"],
  cosmic: ["mushroom.glb", "bush_flowers.glb"],
};

/** Real props/ directory rock decor, layered on top of the foliage rocks
 *  above for bigger set-dressing clusters. */
const REGION_ROCK_PROPS: Record<RegionBiome, string[]> = {
  grassland: ["rocks_small.gltf", "rocks.gltf"],
  forest: ["rocks_small.gltf", "rocks.gltf", "rocks_decorated.gltf"],
  jungle: ["rocks.gltf", "rocks_decorated.gltf", "rocks_gold.gltf"],
  desert: ["rocks_small.gltf", "rocks.gltf"],
  arctic: ["rocks.gltf", "rocks_decorated.gltf"],
  swamp: ["rocks_small.gltf", "rocks.gltf"],
  volcanic: ["rocks.gltf", "rocks_decorated.gltf", "rocks_gold.gltf"],
  alien: ["rocks_decorated.gltf", "rocks_gold.gltf"],
  underground: ["rocks.gltf", "rocks_gold.gltf"],
  cosmic: ["rocks_decorated.gltf", "rocks_gold.gltf"],
};

const VILLAGE_BUILDING_MODELS = [
  "building_home_A.gltf", "building_home_B.gltf", "building_tavern.gltf",
  "building_blacksmith.gltf", "building_church.gltf", "building_windmill.gltf",
  "building_lumbermill.gltf", "building_tower_A.gltf", "building_grain.gltf",
];

const VILLAGE_CLUTTER_MODELS = [
  "barrel.gltf", "bucket_water.gltf", "crate_A_big.gltf", "crate_A_small.gltf",
  "crate_B_small.gltf", "fence_wood_straight.gltf", "fence_stone_straight.gltf",
];

const REGION_VILLAGE_FIRST = ["Wind", "Star", "Frost", "Ember", "Moon", "Sun", "Shadow", "Silver", "Iron", "Thorn"];
const REGION_VILLAGE_SECOND = ["fall", "reach", "spire", "hollow", "crest", "vale", "watch", "gate", "hearth", "mire"];

/** Weighted mob-roster tables per region biome, mirroring worldgen.ts's
 *  BIOME_MOB_TABLE/pickFromWeights pattern for the open world -- reused by
 *  the server to roll a mob type at spawn time for any RegionMobSpawn that
 *  doesn't pin a specific `type`. Existing mob ids only (content/mobs.ts);
 *  no new mob content needed. */
export const REGION_MOB_TABLE: Record<RegionBiome, [string, number][]> = {
  grassland: [["fox", 0.25], ["stag", 0.45], ["alpaca", 0.62], ["wolf", 0.8], ["goblin", 1.0]],
  forest: [["fox", 0.15], ["wolf", 0.35], ["stag", 0.5], ["goblin", 0.7], ["spider", 0.88], ["skeleton_minion", 1.0]],
  jungle: [["frog", 0.2], ["spider", 0.4], ["velociraptor", 0.6], ["tribal", 0.8], ["goblin", 1.0]],
  desert: [["velociraptor", 0.2], ["orc", 0.4], ["orcenemy", 0.58], ["skeleton_warrior", 0.72], ["dire_wolf", 0.86], ["demon", 1.0]],
  arctic: [["yeti", 0.25], ["yetialt", 0.45], ["dire_wolf", 0.65], ["golem", 0.85], ["giant", 1.0]],
  swamp: [["frog", 0.2], ["ooze", 0.4], ["ghost", 0.6], ["tribal", 0.8], ["skeleton_rogue", 1.0]],
  volcanic: [["demon", 0.25], ["demonalt", 0.45], ["orcenemy", 0.65], ["skeleton_warrior", 0.85], ["dragon", 1.0]],
  alien: [["ghost", 0.25], ["ooze", 0.45], ["demonalt", 0.65], ["golem", 0.85], ["dragon", 1.0]],
  underground: [["skeleton_minion", 0.2], ["skeleton_warrior", 0.4], ["skeleton_rogue", 0.6], ["golem", 0.8], ["giant", 1.0]],
  cosmic: [["ghost", 0.3], ["demonalt", 0.55], ["dragon", 0.8], ["golem", 1.0]],
};

export function pickRegionMob(biome: RegionBiome, roll: number): string {
  const table = REGION_MOB_TABLE[biome];
  for (const [type, w] of table) if (roll < w) return type;
  return table[table.length - 1]![0];
}

export const REGION_COLOR_PRESETS: Record<RegionBiome, RegionColorGrading> = {
  grassland: { skyColor: "#8fc7ff", fogColor: "#bcd9f0", fogDensity: 0.006, ambientColor: "#ffffff", ambientIntensity: 0.9, sunColor: "#fff3d6", sunIntensity: 1.1, groundTint: "#8aa04f" },
  forest: { skyColor: "#6fa8d8", fogColor: "#9fc2a8", fogDensity: 0.01, ambientColor: "#dcefe0", ambientIntensity: 0.8, sunColor: "#fff0c8", sunIntensity: 0.95, groundTint: "#4d7a3a" },
  jungle: { skyColor: "#5c9bd1", fogColor: "#7fae7a", fogDensity: 0.014, ambientColor: "#c9f0c0", ambientIntensity: 0.85, sunColor: "#fff8d0", sunIntensity: 1.0, groundTint: "#3c6b2f" },
  desert: { skyColor: "#f5d98a", fogColor: "#f0dca0", fogDensity: 0.01, ambientColor: "#fff2c0", ambientIntensity: 0.95, sunColor: "#fff0b0", sunIntensity: 1.2, groundTint: "#ffffff" },
  arctic: { skyColor: "#c9e3f5", fogColor: "#e8f4fb", fogDensity: 0.012, ambientColor: "#eaf6ff", ambientIntensity: 1.0, sunColor: "#fdfdff", sunIntensity: 1.15, groundTint: "#ffffff" },
  swamp: { skyColor: "#7d8a73", fogColor: "#6d7a63", fogDensity: 0.02, ambientColor: "#aab89a", ambientIntensity: 0.55, sunColor: "#d8dcc0", sunIntensity: 0.6, groundTint: "#515f3a" },
  volcanic: { skyColor: "#3a1f1a", fogColor: "#5c2a1e", fogDensity: 0.018, ambientColor: "#ff8a5c", ambientIntensity: 0.5, sunColor: "#ff6a3c", sunIntensity: 0.9, groundTint: "#6a4432" },
  alien: { skyColor: "#2a1a4a", fogColor: "#4a2a6a", fogDensity: 0.016, ambientColor: "#c08aff", ambientIntensity: 0.6, sunColor: "#8affea", sunIntensity: 0.8, groundTint: "#8a6fd6" },
  underground: { skyColor: "#0d0d14", fogColor: "#1a1a24", fogDensity: 0.03, ambientColor: "#6a7aa0", ambientIntensity: 0.35, sunColor: "#8a9ac0", sunIntensity: 0.4, groundTint: "#5a6a8a" },
  cosmic: { skyColor: "#160a2e", fogColor: "#301a5a", fogDensity: 0.014, ambientColor: "#b0a0ff", ambientIntensity: 0.55, sunColor: "#ffd0f0", sunIntensity: 0.7, groundTint: "#a090e0" },
};

function pick<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

/** Smooths the heightmap toward a single center height within `radius`,
 *  falling off toward the edge -- carves a level clearing for a village so
 *  its buildings don't end up planted on a slope, mirroring the sculpt
 *  brush's own falloff shape in the region editor. */
function flattenHeights(
  heights: number[],
  gridSize: number,
  pitch: number,
  half: number,
  blueprint: Pick<RegionBlueprint, "gridSize" | "pitch" | "heights">,
  cx: number,
  cz: number,
  radius: number,
): void {
  const centerH = sampleRegionHeight(blueprint, cx, cz);
  for (let gz = 0; gz < gridSize; gz++) {
    const wz = gz * pitch - half;
    for (let gx = 0; gx < gridSize; gx++) {
      const wx = gx * pitch - half;
      const d = Math.hypot(wx - cx, wz - cz);
      if (d > radius) continue;
      const idx = gz * gridSize + gx;
      heights[idx] = lerp(heights[idx]!, centerH, (1 - d / radius) * 0.85);
    }
  }
}

/** Author-facing knobs for the "Generate" button, exposed as sliders in the
 *  editor before a draft is rolled -- heightScale multiplies every vertical
 *  dimension of the height formula (rolling amplitude, mountain bump, jagged
 *  crag detail) so the same biome can read as gentle hills or a full-blown
 *  mountain range; treeDensity multiplies the foliage/rock scatter counts;
 *  worldSize is the region's total span (both axes) in world units. Both
 *  heightScale/treeDensity are plain multipliers on the biome preset, not
 *  new noise fields, so the biome's own character (grassland vs volcanic)
 *  is preserved either way. */
export interface RegionGenerateOptions {
  heightScale: number;
  treeDensity: number;
  worldSize: number;
}

export const DEFAULT_REGION_GENERATE_OPTIONS: RegionGenerateOptions = { heightScale: 1, treeDensity: 1, worldSize: 282 };

/** Heightmap sample spacing -- fixed regardless of worldSize so a bigger
 *  world just means more grid cells at the same resolution, not blockier
 *  terrain. gridSize is derived from worldSize/pitch below. */
const REGION_PITCH = 6;

/** Fraction of the half-span, at the outer edge, given over to the
 *  boundary mountain ring (see below). */
const BOUNDARY_RING_FRACTION = 0.15;
/** How tall the boundary ring rises at the very edge (scaled by
 *  heightScale like every other vertical dimension) -- steep enough that
 *  stepMovement's per-step height-delta check (>2.5 units) rejects any
 *  attempt to climb it well before the peak, making it a real impassable
 *  wall rather than just a tall backdrop. */
const BOUNDARY_MOUNTAIN_HEIGHT = 130;
const BOUNDARY_JAGGED_AMP = 18;

/** Random single-biome standalone region for the region editor's "Generate"
 *  button -- fills a real sculpted heightmap (not the open world's infinite
 *  noise function) with biome-appropriate foliage/rock scatter, 1-3 named
 *  villages, mob spawns, and a default (still fully editable) color-grading
 *  preset. Pass a fresh seed each click for a different draft. */
export function generateRandomRegionBlueprint(
  seed: string,
  biome: RegionBiome,
  name: string,
  options: Partial<RegionGenerateOptions> = {},
): RegionBlueprint {
  const opts = { ...DEFAULT_REGION_GENERATE_OPTIONS, ...options };
  const rng = mulberry32(hashString(seed) ^ 0x8d3a1f);
  const noiseSeed = hashString(`${seed}_h`) ^ 0x1234;
  const pitch = REGION_PITCH;
  const gridSize = clamp(Math.round(opts.worldSize / pitch) + 1, 16, 160);
  const half = regionHalfSpan(gridSize, pitch);
  const preset = REGION_HEIGHT_PRESETS[biome];
  const amplitude = preset.amplitude * opts.heightScale;
  const mountainHeight = preset.mountainHeight * opts.heightScale;
  const jaggedAmp = preset.jaggedAmp * opts.heightScale;

  const heights: number[] = new Array(gridSize * gridSize);
  const craterX = (rng() - 0.5) * half;
  const craterZ = (rng() - 0.5) * half;
  const craterRadius = 30 + rng() * 20;
  for (let gz = 0; gz < gridSize; gz++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const x = gx * pitch - half;
      const z = gz * pitch - half;
      // Elevation field (0-1): the primary shape driver. Low elevation reads
      // as a valley (h dips below baseHeight below), high elevation rises
      // into foothills and, once it clears peakThreshold, a real mountain.
      const e = fbm(noiseSeed, x, z, preset.cellSize, 2);
      const detail = fbm(noiseSeed + 777, x, z, preset.cellSize * 0.35, preset.octaves);
      let h = preset.baseHeight + (e - 0.5) * amplitude * 2 + (detail - 0.5) * amplitude * 0.8;

      const mountainT = smoothstep(clamp((e - preset.peakThreshold) / Math.max(0.001, 1 - preset.peakThreshold), 0, 1));
      if (mountainT > 0) {
        const jagged = fbm(noiseSeed + 999, x, z, preset.cellSize * 0.18, 3) - 0.5;
        h += mountainT * mountainHeight + jagged * jaggedAmp * mountainT;
      }

      if (preset.crater) {
        const d = Math.hypot(x - craterX, z - craterZ);
        if (d < craterRadius) h -= (1 - d / craterRadius) * amplitude * 1.5;
      }
      if (preset.plateau) {
        const d = Math.hypot(x, z);
        if (d < half * 0.4) h += (1 - d / (half * 0.4)) * amplitude * 0.8;
      }

      // Outer Ocean Water Ring -- surrounds the map with open ocean water.
      const edgeDist = half - Math.max(Math.abs(x), Math.abs(z));
      const ringBand = half * BOUNDARY_RING_FRACTION;
      const ringT = smoothstep(clamp(1 - edgeDist / ringBand, 0, 1));
      if (ringT > 0) {
        h = lerp(h, -2.5, ringT * 0.95);
      }

      heights[gz * gridSize + gx] = h;
    }
  }

  // Water depth grid
  const waterHeights = new Float32Array(gridSize * gridSize);

  // Fill outer ocean water depth
  for (let gz = 0; gz < gridSize; gz++) {
    const wz = gz * pitch - half;
    for (let gx = 0; gx < gridSize; gx++) {
      const wx = gx * pitch - half;
      const edgeDist = half - Math.max(Math.abs(wx), Math.abs(wz));
      const ringBand = half * BOUNDARY_RING_FRACTION;
      const ringT = smoothstep(clamp(1 - edgeDist / ringBand, 0, 1));
      if (ringT > 0) {
        waterHeights[gz * gridSize + gx] = ringT * 3.5 + 0.5;
      }
    }
  }

  // 1. Procedural Lakes in Valley Depressions
  const lakeCount = 1 + Math.floor(rng() * 2);
  const lakeCenters: { x: number; z: number; radius: number }[] = [];

  for (let l = 0; l < lakeCount; l++) {
    const lx = (rng() - 0.5) * half * 1.1;
    const lz = (rng() - 0.5) * half * 1.1;
    const lakeRadius = 24 + rng() * 16;
    lakeCenters.push({ x: lx, z: lz, radius: lakeRadius });

    for (let gz = 0; gz < gridSize; gz++) {
      const wz = gz * pitch - half;
      for (let gx = 0; gx < gridSize; gx++) {
        const wx = gx * pitch - half;
        const dist = Math.hypot(wx - lx, wz - lz);
        if (dist < lakeRadius) {
          const falloff = 1 - dist / lakeRadius;
          const idx = gz * gridSize + gx;
          // Carve ground basin into heights
          heights[idx]! -= falloff * falloff * 4.5;
          // Fill water depth
          const waterDepth = falloff * 3.2 + 0.6;
          if (waterDepth > waterHeights[idx]!) {
            waterHeights[idx] = waterDepth;
          }
        }
      }
    }
  }

  // 2. Procedural Long Winding River Spanning Across the Entire Map
  if (biome !== "desert" && biome !== "volcanic") {
    // Pick start near one outer edge of the map and end at the opposite edge (or main lake)
    const angle = rng() * Math.PI * 2;
    const sx = Math.cos(angle) * half * 0.88;
    const sz = Math.sin(angle) * half * 0.88;

    let ex = -sx;
    let ez = -sz;

    if (lakeCenters.length > 0 && rng() > 0.3) {
      ex = lakeCenters[0]!.x;
      ez = lakeCenters[0]!.z;
    }

    // Generate 6 control points across the map for sweeping S-curve meanders
    const riverControlPoints: { x: number; z: number }[] = [];
    const numControl = 6;
    const perpX = -Math.sin(angle);
    const perpZ = Math.cos(angle);

    for (let c = 0; c <= numControl; c++) {
      const t = c / numControl;
      const basePx = sx + (ex - sx) * t;
      const basePz = sz + (ez - sz) * t;
      // Swaying meander perpendicular to general flow
      const wave = Math.sin(t * Math.PI * 3.5 + (noiseSeed % 100)) * (32.0 + rng() * 16.0);
      riverControlPoints.push({
        x: basePx + perpX * wave,
        z: basePz + perpZ * wave,
      });
    }

    // High resolution spline interpolation across the whole map (250 steps)
    const channelWidth = 8.5;
    const bankWidth = 22.0;
    const riverSteps = 250;

    for (let s = 0; s <= riverSteps; s++) {
      const t = s / riverSteps;
      const segIndex = clamp(Math.floor(t * numControl), 0, numControl - 1);
      const segT = t * numControl - segIndex;
      const p0 = riverControlPoints[Math.max(0, segIndex - 1)]!;
      const p1 = riverControlPoints[segIndex]!;
      const p2 = riverControlPoints[Math.min(numControl, segIndex + 1)]!;
      const p3 = riverControlPoints[Math.min(numControl, segIndex + 2)]!;

      // Catmull-Rom spline curve formula
      const tt = segT * segT;
      const ttt = tt * segT;
      const px = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * segT +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * tt +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * ttt
      );
      const pz = 0.5 * (
        (2 * p1.z) +
        (-p0.z + p2.z) * segT +
        (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * tt +
        (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * ttt
      );

      // Sample base uncarved terrain height along the river path
      const pathBaseH = Math.max(0, heights[clamp(Math.floor((pz + half) / pitch), 0, gridSize - 1) * gridSize + clamp(Math.floor((px + half) / pitch), 0, gridSize - 1)] ?? 0);

      for (let gz = 0; gz < gridSize; gz++) {
        const wz = gz * pitch - half;
        for (let gx = 0; gx < gridSize; gx++) {
          const wx = gx * pitch - half;
          const dist = Math.hypot(wx - px, wz - pz);
          const idx = gz * gridSize + gx;

          if (dist <= channelWidth) {
            const falloff = 1 - (dist / channelWidth) * (dist / channelWidth);
            // Smooth riverbed carving: target river surface level follows valley gradient
            const targetRiverBed = Math.min(heights[idx]!, Math.min(pathBaseH * 0.3, 2.0)) - falloff * 1.8;
            heights[idx] = targetRiverBed;

            // Dynamically set water depth so water surface sits flush at riverbanks
            const waterDepth = falloff * 2.2 + 0.6;
            if (waterDepth > waterHeights[idx]!) {
              waterHeights[idx] = waterDepth;
            }
          } else if (dist <= bankWidth) {
            // Smooth natural banks sloping gently into river channel
            const bankT = (dist - channelWidth) / (bankWidth - channelWidth);
            const targetBankH = Math.min(pathBaseH * 0.4 + 1.2, heights[idx]!);
            heights[idx] = lerp(heights[idx]!, targetBankH, (1 - bankT) * 0.7);
          }
        }
      }
    }
  }

  const blueprint: RegionBlueprint = {
    id: "",
    name,
    biome,
    gridSize,
    pitch,
    heights,
    waterHeights: Array.from(waterHeights),
    assets: [],
    mobSpawns: [],
    villages: [],
    roads: [],
    colorGrading: { ...REGION_COLOR_PRESETS[biome] },
    entryLocal: { x: 0, z: 0 },
    portalWorldX: 0,
    portalWorldZ: 0,
  };

  // Reject candidate placements that land in water (depth > 0.05) or on steep cliff faces
  const maxScatterSlope = REGION_MAX_SCATTER_SLOPE[biome];
  function placeOnDryTerrain(): { x: number; z: number } {
    let x = 0;
    let z = 0;
    for (let attempt = 0; attempt < 12; attempt++) {
      x = (rng() - 0.5) * half * 1.8;
      z = (rng() - 0.5) * half * 1.8;
      const waterDepth = sampleRegionWaterDepth(blueprint, x, z);
      const slope = regionSlopeAt(blueprint, x, z);
      if (waterDepth <= 0.05 && slope <= maxScatterSlope) break;
    }
    return { x, z };
  }

  // 3. Foliage & Rock Scatter (strictly placed on dry ground)
  const foliage = REGION_FOLIAGE[biome];
  const rocks = REGION_ROCK_PROPS[biome];
  const foliageCount = Math.round((110 + Math.floor(rng() * 70)) * opts.treeDensity);
  for (let i = 0; i < foliageCount; i++) {
    const { x, z } = placeOnDryTerrain();
    const model = pick(foliage, rng);
    blueprint.assets.push({
      model, category: "foliage", localX: x, localY: sampleRegionHeight(blueprint, x, z), localZ: z,
      yaw: rng() * Math.PI * 2, scale: 0.8 + rng() * 0.5,
    });
  }
  const rockCount = Math.round((25 + Math.floor(rng() * 20)) * opts.treeDensity);
  for (let i = 0; i < rockCount; i++) {
    const { x, z } = placeOnDryTerrain();
    const model = pick(rocks, rng);
    blueprint.assets.push({
      model, category: "prop", localX: x, localY: sampleRegionHeight(blueprint, x, z), localZ: z,
      yaw: rng() * Math.PI * 2, scale: 0.8 + rng() * 0.8,
    });
  }

  // 4. Procedural Village Building at Village Markers
  const villageCount = 1 + Math.floor(rng() * 3);
  for (let v = 0; v < villageCount; v++) {
    const vx = (rng() - 0.5) * half * 1.2;
    const vz = (rng() - 0.5) * half * 1.2;
    const vname = pick(REGION_VILLAGE_FIRST, rng) + pick(REGION_VILLAGE_SECOND, rng);

    // Carve level clearing for village AND drain any water in village clearing
    flattenHeights(heights, gridSize, pitch, half, blueprint, vx, vz, 28);
    for (let gz = 0; gz < gridSize; gz++) {
      const wz = gz * pitch - half;
      for (let gx = 0; gx < gridSize; gx++) {
        const wx = gx * pitch - half;
        if (Math.hypot(wx - vx, wz - vz) <= 28) {
          waterHeights[gz * gridSize + gx] = 0;
          if (blueprint.waterHeights) blueprint.waterHeights[gz * gridSize + gx] = 0;
        }
      }
    }
    blueprint.villages.push({ name: vname, localX: vx, localZ: vz, radius: 24 });

    // Central Landmark Plaza (Well or Market)
    const centerLandmark = rng() > 0.5 ? "building_well.gltf" : "building_market.gltf";
    blueprint.assets.push({
      model: centerLandmark,
      category: "building",
      localX: vx,
      localY: sampleRegionHeight(blueprint, vx, vz),
      localZ: vz,
      yaw: rng() * Math.PI * 2,
      scale: 2.4,
    });

    // Ring of Medieval Buildings facing center plaza (scaled up to full imposing house height)
    const buildingCount = 5 + Math.floor(rng() * 4); // 5-8 houses per village
    const villageRoadPoints: { x: number; z: number }[] = [{ x: vx, z: vz }];

    for (let b = 0; b < buildingCount; b++) {
      const angle = (b / buildingCount) * Math.PI * 2 + (rng() - 0.5) * 0.35;
      const dist = 12 + rng() * 8;
      const bx = vx + Math.cos(angle) * dist;
      const bz = vz + Math.sin(angle) * dist;
      const buildingModel = pick(VILLAGE_BUILDING_MODELS, rng);

      // Rotate facing central plaza
      const facingYaw = angle + Math.PI + (rng() - 0.5) * 0.2;

      blueprint.assets.push({
        model: buildingModel,
        category: "building",
        localX: bx,
        localY: sampleRegionHeight(blueprint, bx, bz),
        localZ: bz,
        yaw: facingYaw,
        scale: 3.8 + rng() * 0.6,
      });

      villageRoadPoints.push({ x: bx, z: bz });

      // Clutter & Set-Dressing (barrels, crates, fences, buckets)
      const clutterCount = 2 + Math.floor(rng() * 3);
      for (let c = 0; c < clutterCount; c++) {
        const cAngle = facingYaw + (rng() - 0.5) * 1.5;
        const cDist = 3.5 + rng() * 3;
        const cx = bx + Math.cos(cAngle) * cDist;
        const cz = bz + Math.sin(cAngle) * cDist;
        const clutterModel = pick(VILLAGE_CLUTTER_MODELS, rng);

        blueprint.assets.push({
          model: clutterModel,
          category: "building",
          localX: cx,
          localY: sampleRegionHeight(blueprint, cx, cz),
          localZ: cz,
          yaw: rng() * Math.PI * 2,
          scale: 1.4 + rng() * 0.3,
        });
      }
    }

    // Connect village building roads
    if (villageRoadPoints.length >= 2) {
      blueprint.roads?.push({ points: villageRoadPoints, width: 4.5 });
    }
  }

  const mobCount = 12 + Math.floor(rng() * 10);
  for (let i = 0; i < mobCount; i++) {
    const x = (rng() - 0.5) * half * 1.7;
    const z = (rng() - 0.5) * half * 1.7;
    const nearVillage = blueprint.villages.some((v) => Math.hypot(x - v.localX, z - v.localZ) < v.radius + 15);
    if (nearVillage) continue;
    blueprint.mobSpawns.push({ localX: x, localZ: z });
  }

  return blueprint;
}
