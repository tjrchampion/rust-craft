import { mulberry32, hashString } from "../rng";
import { fbm } from "../terrain";
import { clamp, smoothstep, lerp } from "../math";
import type { QuickGrassSettings } from "./quickGrass";
import type { SkyPresetId } from "./skyPresets";

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
  volcanic: "Volcanoes / Badlands",
  alien: "Alien / Otherworldly",
  underground: "Wastelands / Subterranean",
  cosmic: "Magical / Spiritual Plane",
};

export interface RegionBiomeDetail {
  id: RegionBiome;
  title: string;
  subtitle: string;
  description: string;
  icon: string;
  recommendedLevels: [number, number];
  tags: string[];
}

export const REGION_BIOME_DETAILS: Record<RegionBiome, RegionBiomeDetail> = {
  forest: {
    id: "forest",
    title: "Forests",
    subtitle: "Temperate Woodlands",
    description: "Woodland areas with paths, hidden camps, and starter quests.",
    icon: "🌲",
    recommendedLevels: [1, 5],
    tags: ["Woodlands", "Starter Quests", "Timber"],
  },
  jungle: {
    id: "jungle",
    title: "Jungles",
    subtitle: "Tropical Wilds",
    description: "Tropical zones with dense plants, wild beasts, and ruins.",
    icon: "🌴",
    recommendedLevels: [10, 20],
    tags: ["Tropical", "Wild Beasts", "Ancient Ruins"],
  },
  desert: {
    id: "desert",
    title: "Deserts",
    subtitle: "Arid Dunes & Canyons",
    description: "Dry expanses containing canyons, ruins, and high-level monsters.",
    icon: "🏜️",
    recommendedLevels: [25, 40],
    tags: ["Canyons", "Dunes", "Relics"],
  },
  arctic: {
    id: "arctic",
    title: "Tundras",
    subtitle: "Glacial Peaks & Frost Plains",
    description: "Snowy mountains and frozen plains with low visibility.",
    icon: "❄️",
    recommendedLevels: [35, 50],
    tags: ["Snowy Mountains", "Glaciers", "Frozen Beasts"],
  },
  swamp: {
    id: "swamp",
    title: "Swamps",
    subtitle: "Murky Wetlands & Fens",
    description: "Murky wetlands with fog, poison mechanics, and reptiles.",
    icon: "🍄",
    recommendedLevels: [15, 30],
    tags: ["Wetlands", "Mist & Fog", "Herbs"],
  },
  volcanic: {
    id: "volcanic",
    title: "Volcanoes",
    subtitle: "Scorched Ash & Magma",
    description: "Lava fields, blackened earth, and endgame dungeons.",
    icon: "🌋",
    recommendedLevels: [45, 60],
    tags: ["Lava Fields", "Black Earth", "Endgame"],
  },
  cosmic: {
    id: "cosmic",
    title: "Magical",
    subtitle: "Supernatural Arcane Spheres",
    description: "Supernatural zones with glowing flora and unique physics.",
    icon: "✨",
    recommendedLevels: [30, 55],
    tags: ["Glowing Flora", "Arcane Spires", "Unique Physics"],
  },
  underground: {
    id: "underground",
    title: "Wastelands",
    subtitle: "Corrupted Blightlands",
    description: "Corrupted lands filled with undead, demons, or toxins.",
    icon: "💀",
    recommendedLevels: [20, 45],
    tags: ["Corrupted Earth", "Undead", "Demons"],
  },
  grassland: {
    id: "grassland",
    title: "Grasslands",
    subtitle: "Sunlit Rolling Plains",
    description: "Rolling verdant hills, wildflowers, and peaceful meadows.",
    icon: "🌱",
    recommendedLevels: [1, 5],
    tags: ["Meadows", "Rolling Hills", "Pastures"],
  },
  alien: {
    id: "alien",
    title: "Alien",
    subtitle: "Otherworldly Xenosphere",
    description: "Strange extraterrestrial flora, crystalline formations, and eldritch growths.",
    icon: "🪐",
    recommendedLevels: [40, 60],
    tags: ["Crystals", "Eldritch", "Spiritual"],
  },
};

const MMO_NAME_PREFIXES: Record<RegionBiome, string[]> = {
  forest: ["Whispering", "Silverpine", "Elwynn", "Greenwood", "Shadowglen", "Mistwood", "Oakheart", "Briarwood", "Evergreen", "Sunvale", "Windrunner", "Amberfall", "Highpine", "Riverwood", "Deepwood", "Ravenwood", "Timberfall", "Staghorn"],
  grassland: ["Windy", "Sunstrider", "Goldshire", "Highland", "Amber", "Wildrose", "Greenfield", "Sunbreeze", "Rolling", "Meadowvale", "Brightwood", "Dawnstar", "Fairbreeze"],
  jungle: ["Stranglethorn", "Zul'Gurub", "Wildtide", "Feralas", "Jadefang", "Sunken", "Serpent", "Primal", "Viridian", "Razorfen", "Basilisk", "Emerald", "Bloodtusk", "Stormcrow", "Vinespire", "Feverwood", "Cobra", "Grizzly"],
  desert: ["Tanaris", "Shifting", "Sunstrider", "Barren", "Dustwallow", "Scorched", "Anvil Rock", "Mirage", "Dreadwaste", "Cinder", "Redrock", "Brasswind", "Dunehaven", "Sunfire", "Solitude", "Ironclast", "Oasis", "Kharanos"],
  arctic: ["Winterspring", "Frostfire", "Borean", "Stormpeaks", "Howling", "Icecrown", "Frozen", "Bitterwind", "Northrend", "Glacier", "Crystalpeak", "Snowdrift", "Rimefall", "Chillwind", "Palecrest", "Blizzard", "Everfrost"],
  swamp: ["Sorrowmoss", "Dustwallow", "Murkwater", "Gloomfang", "Deadwood", "Shadowfang", "Blackmarsh", "Weeping", "Fogfen", "Bogmire", "Rotting", "Witchwood", "Mireblood", "Darkwater", "Fetid", "Toadstool", "Viper"],
  volcanic: ["Searing", "Burning", "Molten", "Blackrock", "Fireplume", "Cinderfall", "Obsidian", "Ashwind", "Hellfire", "Inferno", "Brimstone", "Magmaforge", "Pyroclast", "Dragonspire", "Smoldering", "Dreadfire", "Igneous"],
  cosmic: ["Astral", "Netherstorm", "Celestial", "Arcane", "Voidfall", "Starlight", "Dreamgrove", "Moonshadow", "Ethereal", "Twilight", "Lumina", "Starfall", "Chrono", "Mythic", "Nexus", "Radiant", "Spiritual", "Aether"],
  underground: ["Dreadlands", "Blighted", "Plaguelands", "Corrupted", "Shadowmoon", "Felwood", "Necropolis", "Desolation", "Putrid", "Bonefield", "Ashen", "Doomspire", "Netherfell", "Scourge", "Malice", "Crypt", "Gloom"],
  alien: ["Xenon", "Zeta", "Aetherial", "Cosmo", "Starlight", "Nebula", "Void", "Prismatic", "Crystal", "Eldritch", "Astral", "Chrono"],
};

const MMO_NAME_ROOTS: Record<RegionBiome, string[]> = {
  forest: ["Glade", "Woods", "Forest", "Vale", "Grove", "Thicket", "Timberlands", "Highlands", "Valley", "Ridge", "Hollow", "Copse", "Run", "Shallows"],
  grassland: ["Plains", "Meadow", "Highlands", "Fields", "Vale", "Reach", "Pastures", "Valley", "Savanna", "Steppe", "Bluffs"],
  jungle: ["Canopy", "Wilds", "Reach", "Basin", "Jungle", "Cradle", "Depths", "Marsh", "Chasm", "Shrouds", "Coast", "Ruins", "Mire"],
  desert: ["Sands", "Wastes", "Dunes", "Expanse", "Canyon", "Badlands", "Flats", "Plateau", "Gulch", "Steppes", "Gorge", "Bluffs", "Caldera"],
  arctic: ["Peaks", "Ridge", "Tundra", "Fjord", "Pass", "Crag", "Bluffs", "Shiver", "Expanse", "Glacier", "Snowfields", "Heights", "Rift"],
  swamp: ["Fen", "Marsh", "Mire", "Bog", "Wetlands", "Quagmire", "Cove", "Hollow", "Swale", "Slough", "Delta", "Basin"],
  volcanic: ["Gorge", "Steppes", "Cauldron", "Caldera", "Ridge", "Peaks", "Crater", "Wastes", "Core", "Chasm", "Anvil", "Abyss"],
  cosmic: ["Hollow", "Veil", "Reach", "Sanctum", "Expanse", "Vale", "Spires", "Basin", "Rift", "Nexus", "Haven", "Citadel", "Vault"],
  underground: ["Barrens", "Hollow", "Wastes", "Ruins", "Basin", "Mire", "Decay", "Trench", "Graveyard", "Blight", "Reach", "Pit"],
  alien: ["Spire", "Expanse", "Domain", "Hollow", "Void", "Nexus", "Crag", "Plaza", "Sanctuary", "Rift"],
};

const MMO_EPIC_SUFFIXES = [
  "of the Ancients", "of Despair", "of Eternity", "of the Vanquished",
  "Sanctuary", "Ruins", "Dominion", "Bastion", "Stronghold", "Wilds",
];

export function generateMmoRegionName(
  biome: RegionBiome,
  minLevel = 1,
  rng: () => number = Math.random,
): string {
  const prefixes = MMO_NAME_PREFIXES[biome] ?? MMO_NAME_PREFIXES.forest;
  const roots = MMO_NAME_ROOTS[biome] ?? MMO_NAME_ROOTS.forest;
  const prefix = prefixes[Math.floor(rng() * prefixes.length)] ?? "Whispering";
  const root = roots[Math.floor(rng() * roots.length)] ?? "Glade";

  if (minLevel >= 40 && rng() < 0.35) {
    const suffix = MMO_EPIC_SUFFIXES[Math.floor(rng() * MMO_EPIC_SUFFIXES.length)]!;
    return `${prefix} ${root} ${suffix}`;
  }
  return `${prefix} ${root}`;
}

export function getBiomeLevelResourceTypes(biome: RegionBiome, minLevel = 1): string[] {
  const common = ["tree", "rock", "berry_bush"];
  if (minLevel <= 5) {
    return [...common, "copper_vein", "tin_vein"];
  } else if (minLevel <= 15) {
    return [...common, "tin_vein", "iron_deposit"];
  } else if (minLevel <= 30) {
    return [...common, "iron_deposit", "mithril_deposit"];
  } else {
    return [...common, "mithril_deposit", "thorium_vein"];
  }
}

/** Which real asset directory a RegionAsset's model lives under --
 *  unlike the dungeon editor's DungeonAsset (which only ever meant
 *  "under props/"), regions place assets from three different directories,
 *  so the category can't stay implicit. */
export type RegionAssetCategory = "building" | "foliage" | "prop";

/** Point light attached to a prop (lanterns, etc.). */
export interface RegionAssetLight {
  /** When false, the prop does not emit (overrides model defaults). */
  enabled?: boolean;
  color?: string;
  intensity?: number;
  /** Range in meters where the light falls to zero. */
  distance?: number;
  decay?: number;
  /** Local-space offset from the asset origin to the bulb (meters). */
  offsetX?: number;
  offsetY?: number;
  offsetZ?: number;
}

export interface RegionAsset {
  id?: string;
  model: string;
  category: RegionAssetCategory;
  localX: number;
  localY: number;
  localZ: number;
  yaw: number;
  /** Uniform scale (legacy). When scaleX/Y/Z are set, those win per axis. */
  scale?: number;
  /** Per-axis stretch from the editor scale gizmo. Omitted = use `scale`. */
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
  /** Optional editor grouping key -- assets that share a groupId (e.g. every
   *  piece of a procedurally-generated house) are selected/moved/deleted
   *  together when any one of them is clicked. Purely an authoring aid;
   *  the runtime renderer ignores it. Legacy houses used this; new houses
   *  are stored as RegionHouse and expanded at load time. */
  groupId?: string;
  /** Optional attached point light. Known emitter models (e.g. lanterns)
   *  get defaults when this is omitted; set `enabled: false` to turn off. */
  light?: RegionAssetLight;
  /** When true, this placement is walkable on top (and hard-blocks sides for
   *  compact props). Wide spans like bridges bake a thin deck at the mesh top
   *  so the full AABB does not wall the player off mid-volume. Omitted =
   *  model/category defaults. */
  solid?: boolean;
  /** Mesh-measured local AABB used when `solid` is true. Half-extents and
   *  center offsets are model-local (pre-scale); yaw/position come from the
   *  placement. Prefer this over the circular model override. */
  solidBox?: RegionAssetSolidBox;
  /** Forces the "thin walkable deck, no side walls" treatment regardless of
   *  the model name (see isWalkablePlatformAssetModel). Set on a bridge-like
   *  custom asset the name heuristic misses; leave unset otherwise -- solid
   *  buildings/walls/rocks hard-block by default. */
  walkableOnly?: boolean;
}

/** Resolve authored placement scale (supports legacy uniform `scale`). */
export function regionAssetScale(
  a: Pick<RegionAsset, "scale" | "scaleX" | "scaleY" | "scaleZ">,
): { x: number; y: number; z: number } {
  const fallback = a.scale ?? 1;
  return {
    x: Math.max(0.001, a.scaleX ?? fallback),
    y: Math.max(0.001, a.scaleY ?? fallback),
    z: Math.max(0.001, a.scaleZ ?? fallback),
  };
}

/** Persist scale fields: uniform → `scale` only; stretched → scale + scaleX/Y/Z. */
export function regionAssetScaleFields(
  sx: number,
  sy: number,
  sz: number,
): Pick<RegionAsset, "scale" | "scaleX" | "scaleY" | "scaleZ"> {
  const x = Math.max(0.001, sx);
  const y = Math.max(0.001, sy);
  const z = Math.max(0.001, sz);
  if (Math.abs(x - y) < 1e-4 && Math.abs(y - z) < 1e-4) return { scale: x };
  return { scale: x, scaleX: x, scaleY: y, scaleZ: z };
}

/** Local-space AABB for an authored solid placement (pre-placement-scale). */
export interface RegionAssetSolidBox {
  halfX: number;
  halfY: number;
  halfZ: number;
  /** Center offset from the placement pivot (model-local, pre-scale). */
  offsetX?: number;
  offsetY?: number;
  offsetZ?: number;
}

/** World-space oriented box fields from a placement + measured solidBox. */
export function solidBoxColliderFields(
  a: Pick<RegionAsset, "localX" | "localY" | "localZ" | "yaw" | "scale" | "scaleX" | "scaleY" | "scaleZ" | "solidBox">,
): Pick<RegionAssetCollider, "x" | "z" | "radius" | "baseY" | "topY" | "halfX" | "halfZ" | "yaw"> | null {
  const box = a.solidBox;
  if (!box) return null;
  const { x: sx, y: sy, z: sz } = regionAssetScale(a);
  const yaw = a.yaw;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const ox = (box.offsetX ?? 0) * sx;
  const oy = (box.offsetY ?? 0) * sy;
  const oz = (box.offsetZ ?? 0) * sz;
  const hx = Math.max(0.05, box.halfX * sx);
  const hy = Math.max(0.05, box.halfY * sy);
  const hz = Math.max(0.05, box.halfZ * sz);
  // THREE.js rotation-Y: x' = x·cos + z·sin, z' = −x·sin + z·cos
  return {
    x: a.localX + ox * cos + oz * sin,
    z: a.localZ - ox * sin + oz * cos,
    radius: Math.hypot(hx, hz),
    baseY: a.localY + oy - hy,
    topY: a.localY + oy + hy,
    halfX: hx,
    halfZ: hz,
    yaw,
  };
}

/** Default bulb settings for props that should glow when placed. */
export const REGION_ASSET_LIGHT_DEFAULTS: Record<
  string,
  Required<
    Pick<RegionAssetLight, "color" | "intensity" | "distance" | "decay" | "offsetX" | "offsetY" | "offsetZ">
  >
> = {
  "post_lantern.glb": {
    color: "#ffb060",
    intensity: 6,
    distance: 32,
    decay: 2,
    // Lamp head sits above the post; nudge forward a bit toward the lantern cage.
    offsetX: 0,
    offsetY: 2.55,
    offsetZ: 0.15,
  },
};

export function isRegionAssetLightModel(model: string): boolean {
  return model in REGION_ASSET_LIGHT_DEFAULTS;
}

/** Resolved light for rendering, or null when the asset should not emit. */
export function resolveRegionAssetLight(
  asset: Pick<RegionAsset, "model" | "light">,
): {
  color: string;
  intensity: number;
  distance: number;
  decay: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
} | null {
  const defaults = REGION_ASSET_LIGHT_DEFAULTS[asset.model];
  const authored = asset.light;
  if (authored?.enabled === false) return null;
  if (!defaults && !authored) return null;
  const base = defaults ?? {
    color: "#ff9933",
    intensity: 6,
    distance: 28,
    decay: 2,
    offsetX: 0,
    offsetY: 1.5,
    offsetZ: 0,
  };
  return {
    color: authored?.color ?? base.color,
    intensity: authored?.intensity ?? base.intensity,
    distance: authored?.distance ?? base.distance,
    decay: authored?.decay ?? base.decay,
    offsetX: authored?.offsetX ?? base.offsetX,
    offsetY: authored?.offsetY ?? base.offsetY,
    offsetZ: authored?.offsetZ ?? base.offsetZ,
  };
}

/** One procedural house — expands to modular wall/floor/roof pieces via
 *  expandHouseToAssets() for rendering and collision. Keeps blueprints small
 *  and lets the editor treat a house as a single movable asset. */
export interface RegionHouse {
  id?: string;
  /** Concrete archetype from houseGen (not "random" after placement). */
  type: string;
  /** Deterministic seed for generateHouseAssets. */
  seed: number;
  localX: number;
  localY: number;
  localZ: number;
  yaw: number;
  scale?: number;
}

/** Shape stamped by the region editor's volume-sculpt brush -- real 3D
 *  primitives added into the world (not heightmap deformation). */
export type TerrainVolumeShape = "boulder" | "block" | "pillar" | "spike" | "ramp";

/** Surface material for a stamped volume -- maps onto the same ground
 *  textures the heightmap terrain blends (rock/dirt/grass/sand/cobble). */
export type TerrainVolumeMaterial = "rock" | "dirt" | "grass" | "sand" | "cobble";

/** Centerline sample for a continuous terrain stroke. Optional `w`/`h` let
 *  raise/lower/mold/smooth deform the ridge locally (default 1 = authored size). */
export interface TerrainVolumePathPoint {
  x: number;
  y: number;
  z: number;
  /** Local half-width multiplier (default 1). */
  w?: number;
  /** Local height multiplier (default 1). */
  h?: number;
}

/** A single freeform terrain volume. Origin is the geometric center; scale*
 *  are half-extents in world units for box/ramp, and radius (X/Z) / half-
 *  height (Y) for boulder/pillar/spike. Climbable in playtest/gameplay via
 *  regionVolumeColliders().
 *
 *  When `path` has 2+ points, this is a continuous stroke extruded along
 *  that polyline (cross-section from `shape`); scaleX = half-width,
 *  scaleY = height, and localX/Y/Z store the path centroid. */
export interface RegionTerrainVolume {
  id: string;
  shape: TerrainVolumeShape;
  material: TerrainVolumeMaterial;
  localX: number;
  localY: number;
  localZ: number;
  yaw: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  /** World-space centerline for a drag-sculpt stroke. Absent on discrete stamps. */
  path?: TerrainVolumePathPoint[];
  /** Spherical holes punched through this volume (world space). Brush radius
   *  sets each carve's radius -- used by the Carve Hole sculpt tool. */
  carves?: TerrainVolumeCarve[];
}

/** A spherical hole carved through a terrain volume. */
export interface TerrainVolumeCarve {
  x: number;
  y: number;
  z: number;
  radius: number;
}

/** True when (x,y,z) lies inside any carve sphere on the volume. */
export function pointInVolumeCarve(
  v: Pick<RegionTerrainVolume, "carves">,
  x: number,
  y: number,
  z: number,
): boolean {
  const carves = v.carves;
  if (!carves || carves.length === 0) return false;
  for (const c of carves) {
    const dx = x - c.x;
    const dy = y - c.y;
    const dz = z - c.z;
    if (dx * dx + dy * dy + dz * dz < c.radius * c.radius) return true;
  }
  return false;
}

/** True when a walkable top sample at (x,z,topY) is punched out by a carve. */
export function carveBlocksSurface(
  v: Pick<RegionTerrainVolume, "carves">,
  x: number,
  z: number,
  topY: number,
): boolean {
  const carves = v.carves;
  if (!carves || carves.length === 0) return false;
  for (const c of carves) {
    const dx = x - c.x;
    const dz = z - c.z;
    const r = c.radius;
    if (dx * dx + dz * dz >= r * r) continue;
    const yDist = Math.abs(c.y - topY);
    if (yDist <= r) return true;
  }
  return false;
}

/** Stroke half-width at a path sample (scaleX × optional local `w`). */
export function strokePointHalfWidth(v: RegionTerrainVolume, p: TerrainVolumePathPoint): number {
  return Math.max(0.05, v.scaleX * (p.w ?? 1));
}

/** Walkable top Y at a path sample (path.y + scaleY × optional local `h`). */
export function strokePointTopY(v: RegionTerrainVolume, p: TerrainVolumePathPoint): number {
  return p.y + Math.max(0.05, v.scaleY * (p.h ?? 1));
}

export function isTerrainStroke(v: RegionTerrainVolume): boolean {
  return (v.path?.length ?? 0) >= 2;
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
  "medieval_village/Floor_Brick.gltf": { radius: 1.05, height: 0.02, climbable: true },
  "medieval_village/Floor_RedBrick.gltf": { radius: 1.05, height: 0.02, climbable: true },
  "medieval_village/Floor_UnevenBrick.gltf": { radius: 1.05, height: 0.02, climbable: true },
  "medieval_village/Floor_WoodDark.gltf": { radius: 1.05, height: 0.02, climbable: true },
  "medieval_village/Floor_WoodDark_Half1.gltf": { radius: 1.05, height: 0.02, climbable: true },
  "medieval_village/Floor_WoodDark_Half2.gltf": { radius: 1.05, height: 0.02, climbable: true },
  "medieval_village/Floor_WoodDark_Half3.gltf": { radius: 1.05, height: 0.02, climbable: true },
  "medieval_village/Floor_WoodDark_OverhangCorner.gltf": { radius: 1.05, height: 0.02, climbable: true },
  "medieval_village/Floor_WoodDark_OverhangCorner2.gltf": { radius: 1.05, height: 0.02, climbable: true },
  "medieval_village/Floor_WoodLight.gltf": { radius: 1.05, height: 0.02, climbable: true },
  "medieval_village/Floor_WoodLight_OverhangCorner.gltf": { radius: 1.05, height: 0.02, climbable: true },
  "medieval_village/Floor_WoodLight_OverhangCorner2.gltf": { radius: 1.05, height: 0.02, climbable: true },
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
  "medieval_village/Wall_Plaster_Door_Flat.gltf": null,
  "medieval_village/Wall_Plaster_Door_Round.gltf": null,
  "medieval_village/Wall_Plaster_Door_RoundInset.gltf": null,
  "medieval_village/Wall_Plaster_Straight.gltf": { radius: 0.203, height: 3.125, climbable: false },
  "medieval_village/Wall_Plaster_Straight_Base.gltf": { radius: 0.203, height: 3.123, climbable: false },
  "medieval_village/Wall_Plaster_Straight_L.gltf": { radius: 0.203, height: 3.123, climbable: false },
  "medieval_village/Wall_Plaster_Straight_R.gltf": { radius: 0.203, height: 3.123, climbable: false },
  "medieval_village/Wall_Plaster_Window_Thin_Round.gltf": { radius: 0.203, height: 3.123, climbable: false },
  "medieval_village/Wall_Plaster_Window_Wide_Flat.gltf": { radius: 0.203, height: 3.123, climbable: false },
  "medieval_village/Wall_Plaster_Window_Wide_Flat2.gltf": { radius: 0.203, height: 3.146, climbable: false },
  "medieval_village/Wall_Plaster_Window_Wide_Round.gltf": { radius: 0.203, height: 3.123, climbable: false },
  "medieval_village/Wall_Plaster_WoodGrid.gltf": { radius: 0.203, height: 3.123, climbable: false },
  "medieval_village/Wall_UnevenBrick_Door_Flat.gltf": null,
  "medieval_village/Wall_UnevenBrick_Door_Round.gltf": null,
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
  // Rocks — climbable by default; mark individual placements `solid: true`
  // in the region editor to hard-block walking through them.
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
  /** World Y of the asset base (placement localY). */
  baseY: number;
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
  /** Oriented box half-extents (XZ). When set, used instead of the circle. */
  halfX?: number;
  halfZ?: number;
  /** Yaw for oriented box colliders (radians). */
  yaw?: number;
  /** Hard solid (invisible barriers): never walk through while overlapping. */
  solid?: boolean;
}

/** Minimum barrier half-thickness (meters) so sprint steps can't tunnel. */
export const BARRIER_MIN_HALF_THICKNESS = 1.0;

/** Horizontal body radius used when testing player vs barriers/props. */
export const PLAYER_BODY_RADIUS = 0.45;

/** True if (px,pz) is inside the collider footprint (circle or oriented box). */
export function pointInColliderXZ(
  px: number,
  pz: number,
  c: RegionAssetCollider,
  pad = 0,
): boolean {
  if (c.halfX !== undefined && c.halfZ !== undefined) {
    const dx = px - c.x;
    const dz = pz - c.z;
    const yaw = c.yaw ?? 0;
    const cos = Math.cos(-yaw);
    const sin = Math.sin(-yaw);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    return Math.abs(lx) <= c.halfX + pad && Math.abs(lz) <= c.halfZ + pad;
  }
  const dx = px - c.x;
  const dz = pz - c.z;
  const r = c.radius + pad;
  return dx * dx + dz * dz < r * r;
}

/**
 * True if the movement segment from (x0,z0)→(x1,z1) enters the collider.
 * Catches thin walls that a single end-point test would tunnel through.
 */
export function segmentHitsColliderXZ(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  c: RegionAssetCollider,
  pad = PLAYER_BODY_RADIUS,
): boolean {
  if (pointInColliderXZ(x1, z1, c, pad)) return true;
  if (c.halfX !== undefined && c.halfZ !== undefined) {
    const yaw = c.yaw ?? 0;
    const cos = Math.cos(-yaw);
    const sin = Math.sin(-yaw);
    const toLocal = (x: number, z: number) => {
      const dx = x - c.x;
      const dz = z - c.z;
      return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
    };
    const a = toLocal(x0, z0);
    const b = toLocal(x1, z1);
    return segmentHitsAabb2D(a.x, a.z, b.x, b.z, c.halfX + pad, c.halfZ + pad);
  }
  // Closest point on segment to circle center.
  const dx = x1 - x0;
  const dz = z1 - z0;
  const len2 = dx * dx + dz * dz;
  let t = 0;
  if (len2 > 1e-8) {
    t = ((c.x - x0) * dx + (c.z - z0) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  const px = x0 + dx * t;
  const pz = z0 + dz * t;
  const r = c.radius + pad;
  const ex = px - c.x;
  const ez = pz - c.z;
  return ex * ex + ez * ez < r * r;
}

/** Liang-Barsky style segment vs axis-aligned box in 2D (half-extents). */
function segmentHitsAabb2D(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  halfX: number,
  halfZ: number,
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dz = z1 - z0;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, x0 + halfX) &&
    clip(dx, halfX - x0) &&
    clip(-dz, z0 + halfZ) &&
    clip(dz, halfZ - z0) &&
    t0 <= t1
  );
}

/** True for boulder/rock/stone decor models that should stay rigid (no
 *  foliage wind sway). Excludes walkable RockPath_* decals. Collision is
 *  authored per placement via RegionAsset.solid — not inferred here. */
export function isRockLikeAssetModel(model: string): boolean {
  const file = model.replace(/^.*\//, "").replace(/\.(glb|gltf)$/i, "");
  if (/^RockPath_/i.test(file)) return false;
  if (/^rocks?(_|$)/i.test(file)) return true;
  if (/^Rock(_Medium|_Large|_Small)?(_|$)/i.test(file)) return true;
  if (/^rock_single_/i.test(file)) return true;
  if (/^stone_\d+/i.test(file)) return true;
  return false;
}

/** True for small/ground-cover foliage (grass, flowers, ferns, mushrooms,
 *  bushes, dead branches, pebbles, small rocks) whose shadow contribution is
 *  visually negligible but still costs a full alpha-tested shadow-depth pass
 *  per instance in dense areas -- these skip shadow casting. Trees (oak,
 *  pine, twisted, CommonTree, etc.) are deliberately excluded; their shadows
 *  read clearly at a glance and stay on. Defaults to false (cast shadow) for
 *  anything unmatched -- the safe default when uncertain. */
export function isLowShadowValueFoliageModel(model: string): boolean {
  if (isRockLikeAssetModel(model)) return true;
  const file = model.replace(/^.*\//, "").replace(/\.(glb|gltf)$/i, "");
  return /^(bush|fern|mushroom|dead|flower|grass|pebble|plant|moss)(_|$)/i.test(file);
}

/** True for bridge/dock/walkway/platform meshes -- wide spans meant to be
 *  walked ON, not blocked BY. Everything else that's marked solid (walls,
 *  buildings, rocks) hard-blocks at its measured footprint regardless of
 *  size; only these span types get the "thin walkable deck" treatment in
 *  regionAssetColliders(). Authors can force either behavior per-instance
 *  via RegionAsset.walkableOnly. */
export function isWalkablePlatformAssetModel(model: string): boolean {
  const file = model.replace(/^.*\//, "").replace(/\.(glb|gltf)$/i, "");
  return /bridge|dock|walkway|platform/i.test(file);
}

/** Returns the per-model override for `model`, falling back to per-category
 *  defaults. Returns `null` if the model explicitly has no collision. */
export function resolveAssetCollision(
  model: string,
  category: RegionAssetCategory,
): AssetCollisionOverride | null {
  if (Object.prototype.hasOwnProperty.call(ASSET_COLLISION_OVERRIDES, model)) {
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
 *  interpolation (same mechanism as dungeon tile stairs).
 *  Pass house pieces via expandHousesToAssets(blueprint.houses) concatenated
 *  into `assets` when the region uses RegionHouse rows. */
export function regionAssetColliders(assets: RegionAsset[]): RegionAssetCollider[] {
  const out: RegionAssetCollider[] = [];
  for (const a of assets) {
    const { x: sx, y: sy, z: sz } = regionAssetScale(a);
    const scaleXZ = Math.max(sx, sz);

    // Mesh-measured oriented box (authored via Solid in the region editor).
    // Default: full volume — stand on top, hard-block sides at the exact
    // measured shape. Bridge/dock/walkway/platform spans are the deliberate
    // exception (walked ON, not blocked BY) and get a thin walk deck instead;
    // prefer a measured thin solidBox (editor raycast), or for legacy
    // full-AABB boxes estimate the deck below railing height so players
    // aren't stood on (or blocked by) the AABB lid.
    if (a.solid && a.solidBox) {
      const box = solidBoxColliderFields(a);
      if (box) {
        const walkablePlatform = a.walkableOnly ?? isWalkablePlatformAssetModel(a.model);
        if (!walkablePlatform) {
          out.push({ ...box, climbable: true, solid: true });
        } else {
          const height = box.topY - box.baseY;
          if (height <= 1.75) {
            // Short platform slab already (or small mound) — walkable soft floor.
            out.push({ ...box, climbable: true, solid: false });
          } else {
            // Legacy tall AABB: deck sits below rails (~25% down from the top).
            const deckTop = box.topY - Math.min(2.85, height * 0.28);
            const slab = 0.4;
            out.push({
              ...box,
              baseY: deckTop - slab,
              topY: deckTop,
              climbable: true,
              // Soft floor: no XZ wall through pillars under the span.
              solid: false,
            });
          }
        }
        continue;
      }
    }

    let ov = resolveAssetCollision(a.model, a.category);
    if (ov === null && !a.solid) continue; // purely visual, no collider
    // Authored solid without a measured box: hard-block cylinder, still standable.
    if (a.solid) {
      ov = ov
        ? { radius: Math.max(ov.radius, 0.35), height: ov.height, climbable: true }
        : {
            radius: REGION_ASSET_COLLISION_RADIUS[a.category],
            height: REGION_ASSET_COLLISION_HEIGHT[a.category],
            climbable: true,
          };
    }
    if (ov === null) continue;
    if (ov.radius === 0 && !ov.climbable) continue; // degenerate, skip

    const collider: RegionAssetCollider = {
      x: a.localX,
      z: a.localZ,
      radius: ov.radius * scaleXZ,
      baseY: a.localY,
      topY: a.localY + ov.height * sy,
      climbable: ov.climbable,
      ...(a.solid ? { solid: true } : {}),
    };

    if (!a.solid && ov.stairHalfLength !== undefined) {
      // Rotate the local +Z ramp direction by the placed asset's yaw so
      // stepMovement tests in world space. Same convention as
      // deriveDungeonGridFromAssets: yaw 0 -> ascending toward -Z.
      const sin = Math.sin(a.yaw);
      const cos = Math.cos(a.yaw);
      collider.stairRamp = {
        // Local +Z rotated by yaw (THREE.js Euler Y rotation: new_z = cos*z - sin*x)
        dx: -sin,
        dz: -cos,
        halfLength: ov.stairHalfLength * scaleXZ,
        rise: ov.height * sy,
      };
    }

    out.push(collider);
  }
  return out;
}

/** Horizontal footprint radius of a terrain volume (XZ plane). */
export function terrainVolumeRadius(v: RegionTerrainVolume): number {
  if (isTerrainStroke(v)) return Math.max(0.05, v.scaleX);
  switch (v.shape) {
    case "boulder":
      return Math.max(v.scaleX, v.scaleZ);
    case "pillar":
    case "spike":
      return Math.max(v.scaleX, v.scaleZ);
    case "block":
    case "ramp":
      return Math.hypot(v.scaleX, v.scaleZ) * 0.85;
  }
}

/** World Y of the walkable top surface of a terrain volume. Volumes are
 *  authored with their geometric center at localY, so the top is localY +
 *  half-extent on Y (boulder/block/pillar) or localY + scaleY for spike/ramp
 *  (which sit with their base near the center-minus-half). Strokes sit on
 *  the path (ground) and rise by scaleY × local `h`. */
export function terrainVolumeTopY(v: RegionTerrainVolume): number {
  if (isTerrainStroke(v) && v.path && v.path.length > 0) {
    let top = -Infinity;
    for (const p of v.path) top = Math.max(top, strokePointTopY(v, p));
    return top;
  }
  switch (v.shape) {
    case "boulder":
    case "block":
    case "pillar":
      return v.localY + v.scaleY;
    case "spike":
      return v.localY + v.scaleY;
    case "ramp":
      return v.localY + v.scaleY;
  }
}

/** Bottom Y of a volume (used when placing so the stamp sits on a surface). */
export function terrainVolumeHalfHeight(v: Pick<RegionTerrainVolume, "shape" | "scaleY">): number {
  return v.scaleY;
}

/** Flattens stamped terrain volumes into climbable collision circles so
 *  stepMovement / playtest can walk on sculpted cliffs and boulders.
 *  Continuous strokes are sampled along their path. */
export function regionVolumeColliders(volumes: RegionTerrainVolume[]): RegionAssetCollider[] {
  const out: RegionAssetCollider[] = [];
  for (const v of volumes) {
    if (isTerrainStroke(v) && v.path) {
      const baseW = Math.max(0.05, v.scaleX);
      const spacing = Math.max(0.4, baseW * 0.75);
      let carry = 0;
      let prev = v.path[0]!;
      const pushSample = (p: TerrainVolumePathPoint) => {
        const topY = strokePointTopY(v, p);
        if (carveBlocksSurface(v, p.x, p.z, topY)) return;
        out.push({
          x: p.x,
          z: p.z,
          radius: strokePointHalfWidth(v, p),
          baseY: p.y,
          topY,
          climbable: true,
        });
      };
      pushSample(prev);
      for (let i = 1; i < v.path.length; i++) {
        const cur = v.path[i]!;
        const seg = Math.hypot(cur.x - prev.x, cur.z - prev.z);
        carry += seg;
        while (carry >= spacing) {
          const over = carry - spacing;
          const t = seg > 1e-6 ? 1 - over / seg : 1;
          const sample: TerrainVolumePathPoint = {
            x: prev.x + (cur.x - prev.x) * t,
            y: prev.y + (cur.y - prev.y) * t,
            z: prev.z + (cur.z - prev.z) * t,
            w: (prev.w ?? 1) + ((cur.w ?? 1) - (prev.w ?? 1)) * t,
            h: (prev.h ?? 1) + ((cur.h ?? 1) - (prev.h ?? 1)) * t,
          };
          pushSample(sample);
          carry -= spacing;
        }
        prev = cur;
      }
      pushSample(v.path[v.path.length - 1]!);
      continue;
    }

    const radius = terrainVolumeRadius(v);
    if (radius <= 0.05) continue;
    const topY = terrainVolumeTopY(v);
    if (carveBlocksSurface(v, v.localX, v.localZ, topY)) continue;
    const collider: RegionAssetCollider = {
      x: v.localX,
      z: v.localZ,
      radius,
      baseY: v.localY - v.scaleY,
      topY,
      climbable: true,
    };
    if (v.shape === "ramp") {
      const sin = Math.sin(v.yaw);
      const cos = Math.cos(v.yaw);
      collider.stairRamp = {
        dx: -sin,
        dz: -cos,
        halfLength: Math.max(0.5, v.scaleZ),
        rise: v.scaleY * 2,
      };
      // Ramp base sits at localY - scaleY; top at localY + scaleY.
      collider.baseY = v.localY - v.scaleY;
      collider.topY = v.localY + v.scaleY;
    }
    out.push(collider);
  }
  return out;
}

/** Bake invisible barrier volumes into hard (non-climbable) oriented-box colliders. */
export function regionBarrierColliders(barriers: RegionBarrierVolume[] | undefined): RegionAssetCollider[] {
  if (!barriers?.length) return [];
  const out: RegionAssetCollider[] = [];
  for (const b of barriers) {
    const hx = Math.max(0.1, b.sizeX);
    const hy = Math.max(0.1, b.sizeY);
    // Paper-thin authored walls still get a minimum collision thickness so
    // sprint / large playtest frame steps can't tunnel through.
    const hz = Math.max(BARRIER_MIN_HALF_THICKNESS, b.sizeZ);
    out.push({
      x: b.localX,
      z: b.localZ,
      radius: Math.hypot(hx, hz),
      // Boundaries should block at any standing height (authors often leave
      // the box centered near y=0 while terrain sits higher).
      baseY: b.localY - hy - 200,
      topY: b.localY + hy + 200,
      climbable: false,
      solid: true,
      halfX: hx,
      halfZ: hz,
      yaw: b.yaw,
    });
  }
  return out;
}

/**
 * Push (px,pz) to the nearest point just outside an oriented-box collider.
 * Used when a solid barrier overlap must be resolved instead of ignored.
 */
export function depenetrateColliderXZ(
  px: number,
  pz: number,
  c: RegionAssetCollider,
  pad = PLAYER_BODY_RADIUS,
): { x: number; z: number } {
  if (c.halfX === undefined || c.halfZ === undefined) {
    const dx = px - c.x;
    const dz = pz - c.z;
    const dist = Math.hypot(dx, dz);
    const r = c.radius + pad + 0.02;
    if (dist < 1e-8) return { x: c.x + r, z: c.z };
    if (dist >= r) return { x: px, z: pz };
    const s = r / dist;
    return { x: c.x + dx * s, z: c.z + dz * s };
  }
  const yaw = c.yaw ?? 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const cosN = Math.cos(-yaw);
  const sinN = Math.sin(-yaw);
  const dx = px - c.x;
  const dz = pz - c.z;
  let lx = dx * cosN - dz * sinN;
  let lz = dx * sinN + dz * cosN;
  const hx = c.halfX + pad;
  const hz = c.halfZ + pad;
  if (Math.abs(lx) > hx || Math.abs(lz) > hz) return { x: px, z: pz };
  const pushX = lx >= 0 ? hx + 0.02 - lx : -hx - 0.02 - lx;
  const pushZ = lz >= 0 ? hz + 0.02 - lz : -hz - 0.02 - lz;
  if (Math.abs(pushX) <= Math.abs(pushZ)) lx += pushX;
  else lz += pushZ;
  return {
    x: c.x + lx * cos - lz * sin,
    z: c.z + lx * sin + lz * cos,
  };
}

export interface RegionMobSpawn {
  localX: number;
  localZ: number;
  /** Author-pinned specific mob type; when absent the server rolls one from
   *  the region's biome mob table at spawn time (see REGION_MOB_TABLE). */
  type?: string;
  /** Combat scale vs base mob stats (HP / damage). Default 1 when omitted. */
  difficulty?: number;
}

/** Authored gatherable node (tree/rock/ore/…). World Y comes from the heightmap. */
export interface RegionResourceNode {
  /** Stable id for depletion persistence; auto-assigned if omitted. */
  id?: string;
  /** Key into NODE_TYPES / PLACEABLE_REGION_NODE_TYPES. */
  type: string;
  localX: number;
  localZ: number;
  /** Mesh variant seed (0..1-ish). Deterministic from id when omitted. */
  variant?: number;
  /**
   * Optional foliage/prop filename (e.g. `pine_1.glb`) used for tree visuals.
   * When omitted for `tree`, a biome brush model is chosen from variant.
   */
  model?: string;
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
  /** Soft fill / bounce light color (hemisphere ground). Optional. */
  fillColor?: string;
  /** Soft fill intensity (0..4). Absent = 0 (no fill light). */
  fillIntensity?: number;
  /** Renderer exposure multiplier (0.4..2.5). Absent = 1. */
  exposure?: number;
  /**
   * WoW-style layered skydome preset (sunny / overcast / stormy / mystical).
   * Drives zenith→horizon gradient + cloud/star shells via the 24h timeline.
   * Absent = "sunny".
   */
  skyPreset?: SkyPresetId;
  /** Optional zenith override (top of gradient dome). Falls back to skyColor. */
  zenithColor?: string;
  /** Optional mid-sky override. Falls back to a blend of skyColor. */
  skyMidColor?: string;
  /** Optional horizon-sky override (dome skirt). Falls back to fogColor/skyColor. */
  horizonSkyColor?: string;
  /** Distant mountain-ring backdrop (region-local). Off by default. */
  horizonEnabled?: boolean;
  /** Multiplier tint on the horizon rock/haze. */
  horizonTint?: string;
  /** Peak height scale (0.4..2). Default 1. */
  horizonPeakScale?: number;
  /** Inner radius of the mountain ring (meters from region origin). */
  horizonInnerRadius?: number;
  /** Outer radius of the mountain ring. */
  horizonOuterRadius?: number;
}

/** Invisible (or ghosted-in-editor) solid wall the player cannot walk through. */
export interface RegionBarrierVolume {
  id?: string;
  localX: number;
  localY: number;
  localZ: number;
  yaw: number;
  /** Half-extents in meters. */
  sizeX: number;
  sizeY: number;
  sizeZ: number;
}

export type RegionCloudShape = "cumulus" | "wispy" | "flat";

/** Individual authored cloud puff that drifts over the region. */
export interface RegionCloud {
  id?: string;
  localX: number;
  localY: number;
  localZ: number;
  yaw: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  color: string;
  opacity: number;
  shape: RegionCloudShape;
  /** Drift speed along +local X before yaw (m/s). Default 1.2. */
  driftSpeed?: number;
  /** Vertical bob amplitude (meters). Default 0.4. */
  bobAmp?: number;
}

/** Placeable local fog pocket — independent of global FogExp2 color grading. */
export type RegionFogShape = "sphere" | "box";

export interface RegionFogVolume {
  id?: string;
  localX: number;
  localY: number;
  localZ: number;
  shape: RegionFogShape;
  /** Sphere radius, or box half-extent on X. */
  sizeX: number;
  /** Vertical half-extent (box) or sphere radius Y scale. */
  sizeY: number;
  /** Box half-extent Z / sphere radius Z scale. */
  sizeZ: number;
  color: string;
  /** Visual density / thickness (0..1). */
  density: number;
  /** Mesh opacity multiplier (0..1). */
  opacity: number;
  /** Soft edge width (0 = hard, 1 = very soft). */
  feather: number;
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

/** A painted grass patch: a compact stroke record, not a discrete asset.
 *  Expanded procedurally into many wind-shaded blade instances at render
 *  time (see client/render/grassField.ts's buildGrassInstances, used
 *  identically by the region editor's live preview and the runtime
 *  RegionInteriorRenderer) rather than stored as one RegionAsset per blade,
 *  which would bloat the region file badly at any real density. Also feeds
 *  the GPU-driven quickGrass field (client/render/quickGrass/field.ts's
 *  createQuickGrassField), which rasterizes these same patches (plus
 *  GrassExclusion holes) into a density texture instead of expanding them
 *  into discrete blade instances on the CPU. */
export interface GrassPatch {
  id?: string;
  localX: number;
  localZ: number;
  radius: number;
  /** 0..1 fill fraction feeding the jittered-grid inclusion roll. */
  density: number;
  /** Deterministic seed so the same patch always expands to the same blade
   *  layout on every load -- editor preview and runtime must agree, and a
   *  reload must not re-roll a different-looking field. */
  seed: number;
  /** Multiplier on the base blade height for this patch specifically --
   *  baked from the brush's Length setting at paint time, so different
   *  patches (brush strokes) can have different grass lengths. Absent on
   *  patches painted before this existed, treated as 1. */
  lengthScale?: number;
}

/** Region-wide ambient wind, affecting both grass sway (grassBlade.ts) and
 *  tree sway (windSway.ts) -- one shared direction/strength dial so both
 *  systems respond consistently to the same setting. */
export interface RegionWind {
  /** Degrees, 0..360 -- 0 blows toward +X, increasing clockwise. */
  direction: number;
  /** Multiplier on each system's own base sway amplitude -- 1 is the
   *  default calm-breeze feel; 0 is still air. */
  strength: number;
}

/** Per-region grass blade base/tip gradient colors (hex strings) -- feeds
 *  grassBlade.ts's uGrassBottom/uGrassTop uniforms. Absent on regions saved
 *  before this existed; every reader falls back to grassBlade.ts's own
 *  hardcoded defaults. */
export interface GrassColor {
  bottom: string;
  top: string;
}

/** A fine-grained "hole" carved out of the grass field by the erase-grass
 *  brush -- unlike deleting a whole GrassPatch (coarse: only removes patches
 *  whose center falls within the brush), this subtracts a small circle from
 *  the blade field at generation time, so a single large patch can be
 *  partially thinned out without losing the rest of it. */
export interface GrassExclusion {
  localX: number;
  localZ: number;
  radius: number;
  /** 0..1 fraction of blades within the circle to remove -- 1 fully clears
   *  it, lower values thin it out instead of an all-or-nothing erase. */
  strength: number;
  /** Deterministic seed so which specific blades get thinned out (at
   *  strength < 1) is stable across reloads, same rationale as
   *  GrassPatch.seed. */
  seed: number;
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
  /** Range in meters where the light falls to zero. */
  distance: number;
  /** Physically-based decay exponent (Three.js default 2). Optional. */
  decay?: number;
}

export interface RegionPortalLink {
  id: string;
  name: string;
  localX: number;
  localZ: number;
  targetRegionId: string;
  targetLocalX?: number;
  targetLocalZ?: number;
}

export type RegionQuestObjectiveKind = "kill" | "gather" | "escort";

export interface RegionQuest {
  id: string;
  name: string;
  description: string;
  tier: number; // 0..4
  minLevel: number;
  objectiveKind: RegionQuestObjectiveKind;
  objectiveTarget: string;
  objectiveCount: number;
  rewardXp: number;
  rewardItems: { itemId: string; qty: number }[];
  waypoints?: { x: number; z: number }[];
}

export interface RegionNPC {
  id: string;
  name: string;
  model: string;
  localX: number;
  localZ: number;
  yaw: number;
  title?: string;
  dialogue?: string;
  quests?: RegionQuest[];
  generateProceduralQuests?: boolean;
  /** If set, interacting opens the vendor window for this merchant id. */
  vendorId?: string;
}

/** A placeable dynamic world event (GW2-style simple fight). Authored in the
 *  region editor; the server runs cooldown → active → success/fail. */
export interface RegionWorldEvent {
  id: string;
  name: string;
  localX: number;
  localZ: number;
  /** Participation + spawn volume radius (world units). */
  radius: number;
  /** Minutes between completions (and after failure). */
  frequencyMin: number;
  /** 0.5–3 multiplier on base mob HP/dmg before proximity scaling. */
  difficulty: number;
  /** 0.5–3 multiplier on personal reward quantity. */
  lootAmount: number;
  /** MobDef ids to spawn for the fight wave. */
  mobTypes: string[];
  /** Optional elite/boss MobDef id; when set, success requires this mob dead. */
  bossType?: string;
  /** Fail timer while Active (seconds). Default 600. */
  durationSec?: number;
}

/** A discoverable landmark placed in the region editor. Interacting within
 *  interactRadius permanently reveals a revealRadius patch of map/minimap
 *  fog-of-war for that character and plays a one-shot cinematic overlook.
 *  Unlike RegionWorldEvent, discovery is binary and permanent -- no
 *  cooldown/phase runtime state, so the server resolves it directly from the
 *  blueprint on interact rather than seeding a live runtime object. */
export interface RegionPoi {
  id: string;
  name: string;
  localX: number;
  localZ: number;
  /** World-unit range required to trigger discovery via interact. Default 6
   *  (matches the shrine interact-range convention). */
  interactRadius?: number;
  /** Hand-drawn fog-of-war reveal boundary, region-local absolute coordinates
   *  (same convention as RegionRoad.points -- not offsets relative to the
   *  marker). Authored in the Continent Layout Map's polygon tool; every POI
   *  gets an auto-seeded octagon at placement time so this is never empty in
   *  practice even before it's manually redrawn. */
  revealShape: { x: number; z: number }[];
  /** XP granted on first discovery (see GameServer.discoverPoi). Default 25 --
   *  scaled like an easy achievement/low-tier mob kill, not a quest chain. */
  rewardXp?: number;
  /** Optional flavor text for the discovery toast / map tooltip. */
  description?: string;
  /** Optional icon id for map-marker rendering; falls back to a generic
   *  landmark glyph if unset. */
  icon?: string;
  /** Optional 3D asset model path (e.g. `castle_ruins/CastleRuins.glb` or `building_church.gltf`) */
  model?: string;
  /** Asset category for model resolution (building, prop, or foliage) */
  category?: RegionAssetCategory;
  /** Orientation rotation in radians around the Y axis */
  yaw?: number;
  /** Uniform scale multiplier (default 1.0) */
  scale?: number;
}

/** Personal reward tier after a successful world event. */
export type WorldEventRewardTier = "gold" | "silver" | "bronze";

/** Default personal loot table for world-event success (scaled by lootAmount). */
export const WORLD_EVENT_REWARD_TABLE: Record<
  WorldEventRewardTier,
  Array<{ itemId: string; min: number; max: number }>
> = {
  gold: [
    { itemId: "gold_ore", min: 2, max: 4 },
    { itemId: "iron_ore", min: 3, max: 6 },
    { itemId: "hide", min: 2, max: 4 },
  ],
  silver: [
    { itemId: "iron_ore", min: 2, max: 4 },
    { itemId: "hide", min: 1, max: 3 },
    { itemId: "raw_meat", min: 1, max: 2 },
  ],
  bronze: [
    { itemId: "hide", min: 1, max: 2 },
    { itemId: "raw_meat", min: 1, max: 2 },
  ],
};

export interface RegionBlueprint {
  id: string;
  name: string;
  biome: RegionBiome;
  /** Heightmap resolution per axis. */
  gridSize: number;
  /** Custom resolution along X-axis (width). Falls back to gridSize. */
  gridSizeX?: number;
  /** Custom resolution along Z-axis (height). Falls back to gridSize. */
  gridSizeZ?: number;
  /** World units between adjacent heightmap samples. */
  pitch: number;
  /** Flattened gridSize*gridSize height values, row-major (index = gz*gridSize+gx). */
  heights: number[];
  assets: RegionAsset[];
  /** Procedural houses (one row each). Expanded to modular pieces at runtime. */
  houses?: RegionHouse[];
  mobSpawns: RegionMobSpawn[];
  /** Optional authored gatherables (tree/rock/ore…). Absent on older regions. */
  resourceNodes?: RegionResourceNode[];
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
  /** World-space position of local (0,0) for seamless multi-region streaming.
   *  Absent → treated as (0,0), or packed by ensureRegionWorldOrigins(). */
  worldOriginX?: number;
  worldOriginZ?: number;
  /** Optional -- Authored camera position & orientation for the Title / Login screen. */
  titleCamera?: {
    x: number;
    y: number;
    z: number;
    pitch: number;
    yaw: number;
  };
  /** Optional -- If true, this region is designated as the default Starting Town where new players spawn. */
  isStartingRegion?: boolean;
  /** Optional -- Minimum intended character level for this region (e.g. 1, 3, 10). */
  minLevel?: number;
  /** Optional -- Maximum intended character level for this region (e.g. 3, 7, 20). */
  maxLevel?: number;
  /** Optional -- Authored inter-region portals placed inside this region. */
  portals?: RegionPortalLink[];
  /** Optional -- Authored quest giver NPCs placed in this region. */
  npcs?: RegionNPC[];
  /** Optional -- placeable dynamic world events (cooldown → fight → loot). */
  worldEvents?: RegionWorldEvent[];
  /** Optional -- discoverable landmarks (fog-of-war reveal + cinematic on interact). */
  pois?: RegionPoi[];
  /** Optional -- flattened gridSize*gridSize water depth values (in world units).
   *  If absent or 0 at a cell, there is no water surface there. */
  waterHeights?: number[];
  /** Optional -- Neighbor connectivity flags on the continent grid. */
  neighborEdges?: RegionNeighborEdges;
  /** Optional -- flattened gridSize*gridSize texture paint ID values:
   *  0=auto/biome, 1=grass, 2=dirt, 3=cobble, 4=snow, 5=rock, 6=sand. */
  customTextures?: number[];
  /** Optional -- authored point lights placed in the region. */
  lights?: RegionPointLight[];
  /** Optional -- movable local fog volumes (mist pockets independent of global fog). */
  fogVolumes?: RegionFogVolume[];
  /** Optional -- invisible solid barriers (player blocking volumes). */
  barrierVolumes?: RegionBarrierVolume[];
  /** Optional -- individual drifting cloud props. */
  clouds?: RegionCloud[];
  /** Optional -- absent on regions saved before the grass-patch brush
   *  existed; every reader falls back to an empty array. */
  grassPatches?: GrassPatch[];
  /** Optional -- fine-grained holes carved out of the grass field by the
   *  erase-grass brush. Absent on regions saved before it existed. */
  grassExclusions?: GrassExclusion[];
  /** Optional -- per-region grass blade color override, see GrassColor. */
  grassColor?: GrassColor;
  /** Optional -- how strongly grass blades respond to region wind (0 = still
   *  grass even if wind is blowing; 1 = default). Independent of RegionWind
   *  strength, which also drives trees/clouds. Absent → 1. */
  grassSway?: number;
  /** Optional -- region-wide wind direction/strength, see RegionWind. Absent
   *  means the default calm-breeze feel (direction 0, strength 1) that grass
   *  already had before this was configurable -- not still air. */
  wind?: RegionWind;
  /** Optional -- freeform 3D terrain volumes stamped by the volume-sculpt
   *  brush (spheres/boxes/etc. that ADD geometry rather than deforming the
   *  heightmap). Absent on regions saved before the tool existed. */
  terrainVolumes?: RegionTerrainVolume[];
  /** Optional -- id of the REGION_MUSIC_TRACKS entry to loop while inside this
   *  region (fades in on entry, out on exit). Absent/null means no music. */
  musicTrack?: string | null;
  /** Optional -- per-region overrides for the quickGrass field (blade shape,
   *  wind, colour, lighting -- see QuickGrassSettings). Absent falls back to
   *  DEFAULT_QUICK_GRASS_SETTINGS via mergeQuickGrassSettings(). */
  grassSettings?: Partial<QuickGrassSettings>;
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
export function sampleRegionHeight(blueprint: Pick<RegionBlueprint, "gridSize" | "pitch" | "heights"> & { gridSizeX?: number; gridSizeZ?: number }, x: number, z: number): number {
  const { gridSize, pitch, heights } = blueprint;
  const gridSizeX = blueprint.gridSizeX ?? gridSize;
  const gridSizeZ = blueprint.gridSizeZ ?? gridSize;
  const halfX = regionHalfSpan(gridSizeX, pitch);
  const halfZ = regionHalfSpan(gridSizeZ, pitch);
  const gx = (x + halfX) / pitch;
  const gz = (z + halfZ) / pitch;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const tx = clamp(gx - x0, 0, 1);
  const tz = clamp(gz - z0, 0, 1);
  const cx0 = clamp(x0, 0, gridSizeX - 1);
  const cx1 = clamp(x0 + 1, 0, gridSizeX - 1);
  const cz0 = clamp(z0, 0, gridSizeZ - 1);
  const cz1 = clamp(z0 + 1, 0, gridSizeZ - 1);
  const h00 = heights[cz0 * gridSizeX + cx0] ?? 0;
  const h10 = heights[cz0 * gridSizeX + cx1] ?? 0;
  const h01 = heights[cz1 * gridSizeX + cx0] ?? 0;
  const h11 = heights[cz1 * gridSizeX + cx1] ?? 0;
  const a = h00 + (h10 - h00) * tx;
  const b = h01 + (h11 - h01) * tx;
  return a + (b - a) * tz;
}

/** Bilinear water depth sample at local (x,z) over the blueprint's water grid.
 *  Returns 0 if no water is present. */
export function sampleRegionWaterDepth(blueprint: Pick<RegionBlueprint, "gridSize" | "pitch"> & { gridSizeX?: number; gridSizeZ?: number; waterHeights?: number[] }, x: number, z: number): number {
  const { gridSize, pitch, waterHeights } = blueprint;
  if (!waterHeights || waterHeights.length === 0) return 0;
  const gridSizeX = blueprint.gridSizeX ?? gridSize;
  const gridSizeZ = blueprint.gridSizeZ ?? gridSize;
  const halfX = regionHalfSpan(gridSizeX, pitch);
  const halfZ = regionHalfSpan(gridSizeZ, pitch);
  const gx = (x + halfX) / pitch;
  const gz = (z + halfZ) / pitch;
  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const tx = clamp(gx - x0, 0, 1);
  const tz = clamp(gz - z0, 0, 1);
  const cx0 = clamp(x0, 0, gridSizeX - 1);
  const cx1 = clamp(x0 + 1, 0, gridSizeX - 1);
  const cz0 = clamp(z0, 0, gridSizeZ - 1);
  const cz1 = clamp(z0 + 1, 0, gridSizeZ - 1);
  const w00 = waterHeights[cz0 * gridSizeX + cx0] ?? 0;
  const w10 = waterHeights[cz0 * gridSizeX + cx1] ?? 0;
  const w01 = waterHeights[cz1 * gridSizeX + cx0] ?? 0;
  const w11 = waterHeights[cz1 * gridSizeX + cx1] ?? 0;
  const a = w00 + (w10 - w00) * tx;
  const b = w01 + (w11 - w01) * tx;
  return Math.max(0, a + (b - a) * tz);
}


/** Rise-over-run slope magnitude at local (x,z), central-difference over
 *  sampleRegionHeight -- the region equivalent of shared terrain.ts's
 *  terrainSlope(), used both to keep procedural scatter off of cliff faces
 *  and to pick grass/rock/snow ground texture weights. */
export function regionSlopeAt(blueprint: Pick<RegionBlueprint, "gridSize" | "pitch" | "heights"> & { gridSizeX?: number; gridSizeZ?: number }, x: number, z: number, eps = 1.5): number {
  const hx = sampleRegionHeight(blueprint, x + eps, z) - sampleRegionHeight(blueprint, x - eps, z);
  const hz = sampleRegionHeight(blueprint, x, z + eps) - sampleRegionHeight(blueprint, x, z - eps);
  return Math.hypot(hx, hz) / (2 * eps);
}

export interface SeamStitchOptions {
  /** Width in meters of the smooth blend transition zone along touching borders. Defaults to 60m (see stitchRegionSeams's doc comment on why -- a narrower margin lets an interior lake/river dip carve right up to the connecting seam). */
  blendMargin?: number;
  /** Minimum ground elevation in meters for land borders to prevent sub-surface water sinking. Defaults to 1.5m. */
  minLandFloor?: number;
  /** Lift touching land boundaries above sea level if they previously had coastal ocean falloff. Defaults to true. */
  forceDrySeams?: boolean;
}

/**
 * Dynamically stitches and harmonizes the terrain heights along bordering edges
 * for any set of adjacent or touching regions on the world/continent layout.
 *
 * Along shared border seams (where two regions touch with 0-gap), Hermite cubic
 * spline blending is applied over a configurable border margin so the two heightmaps
 * meet at the EXACT same continuous elevation and slope, eliminating tears, cliffs,
 * and seams.
 */
export function stitchRegionSeams(
  blueprints: RegionBlueprint[],
  options: SeamStitchOptions = {},
): RegionBlueprint[] {
  // Wider than the old 28m default -- a region's own interior lake/river
  // carving is only gated by a comparatively narrow margin at generation
  // time (see generateRandomRegionBlueprint's "neighborLandSafety"), so a
  // lake seeded by noise in roughly the outer 20-40m of a bordered edge can
  // land right where two regions are meant to connect. See
  // HARD_FLOOR_MARGIN below for why the floor itself also needed
  // strengthening, not just this margin.
  const blendMargin = options.blendMargin ?? 60.0;
  const minLandFloor = options.minLandFloor ?? 1.5;
  const forceDrySeams = options.forceDrySeams !== false;
  // Within this distance of the exact border, force dry land unconditionally
  // (no averaging, no fade) -- a soft blend alone is too weak to fully
  // cancel a multi-meter-deep lake dip before it fades out, which is
  // exactly what left "only water" along seams that should have connected.
  const HARD_FLOOR_MARGIN = 20.0;

  if (!blueprints || blueprints.length <= 1) return blueprints;

  // Spatial metadata for all blueprints
  const boxes = blueprints.map((bp) => {
    const gx = bp.gridSizeX ?? bp.gridSize;
    const gz = bp.gridSizeZ ?? bp.gridSize;
    const pitch = bp.pitch;
    const halfX = regionHalfSpan(gx, pitch);
    const halfZ = regionHalfSpan(gz, pitch);
    const ox = bp.worldOriginX ?? 0;
    const oz = bp.worldOriginZ ?? 0;
    return {
      bp,
      gx,
      gz,
      pitch,
      halfX,
      halfZ,
      ox,
      oz,
      minX: ox - halfX,
      maxX: ox + halfX,
      minZ: oz - halfZ,
      maxZ: oz + halfZ,
    };
  });

  return boxes.map((boxA, idxA) => {
    const bpA = boxA.bp;
    const { gx, gz, pitch, halfX, halfZ, ox: oxA, oz: ozA } = boxA;

    // Find touching or near-border neighbors within blend reach
    const reach = blendMargin + 4.0;
    const neighbors = boxes.filter((boxB, idxB) => {
      if (idxA === idxB) return false;
      const overlapX = boxA.minX <= boxB.maxX + reach && boxA.maxX >= boxB.minX - reach;
      const overlapZ = boxA.minZ <= boxB.maxZ + reach && boxA.maxZ >= boxB.minZ - reach;
      return overlapX && overlapZ;
    });

    if (neighbors.length === 0) return bpA;

    const newHeights = new Array<number>(gx * gz);
    const newWater = new Array<number>(gx * gz);

    for (let iz = 0; iz < gz; iz++) {
      for (let ix = 0; ix < gx; ix++) {
        const localX = ix * pitch - halfX;
        const localZ = iz * pitch - halfZ;
        const worldX = oxA + localX;
        const worldZ = ozA + localZ;

        const origH = bpA.heights[iz * gx + ix] ?? 0;

        // Distance from this vertex to Region A's 4 outer boundaries
        const distWest = localX + halfX;
        const distEast = halfX - localX;
        const distSouth = localZ + halfZ;
        const distNorth = halfZ - localZ;
        const minEdgeDist = Math.min(distWest, distEast, distSouth, distNorth);

        if (minEdgeDist >= blendMargin) {
          newHeights[iz * gx + ix] = origH;
          newWater[iz * gx + ix] = origH <= 0 ? Math.max(0.6, -origH + 0.5) : 0;
          continue;
        }

        let totalWeight = 0;
        let weightedNeighborHeight = 0;

        for (const boxB of neighbors) {
          const bLocalX = worldX - boxB.ox;
          const bLocalZ = worldZ - boxB.oz;

          // Distance from this world coordinate to neighbor B's bounding box
          const dxBox = Math.max(boxB.minX - worldX, worldX - boxB.maxX, 0);
          const dzBox = Math.max(boxB.minZ - worldZ, worldZ - boxB.maxZ, 0);
          const bDistToBox = Math.hypot(dxBox, dzBox);

          if (bDistToBox <= blendMargin) {
            const hB = sampleRegionHeight(boxB.bp, bLocalX, bLocalZ);
            const influence = Math.max(0, 1.0 - (bDistToBox / blendMargin));
            if (influence > 0) {
              weightedNeighborHeight += hB * influence;
              totalWeight += influence;
            }
          }
        }

        if (totalWeight > 0) {
          const avgNeighborH = weightedNeighborHeight / totalWeight;
          const t = clamp(minEdgeDist / blendMargin, 0, 1);
          // Cubic Hermite smoothstep weight: s(t) = t^2 * (3 - 2t)
          const s = t * t * (3 - 2 * t);

          let seamH = (origH + avgNeighborH) * 0.5;
          if (forceDrySeams && seamH < minLandFloor && (origH > -2.0 || avgNeighborH > -2.0)) {
            seamH = Math.max(seamH, minLandFloor);
          }

          let blendedH = seamH * (1 - s) + origH * s;
          // The (1-s)/s taper above always fades back toward origH, which
          // can still be a multi-meter-deep interior lake/river dip that the
          // floor-raise above only partially cancels once s has grown much
          // past 0 -- exactly what left seams looking flooded. Within
          // HARD_FLOOR_MARGIN of the actual border, override that taper and
          // force dry land unconditionally, same reasoning as
          // regenRegionCoastlines's identically-named constant.
          if (forceDrySeams && minEdgeDist <= HARD_FLOOR_MARGIN && (origH > -2.0 || avgNeighborH > -2.0)) {
            blendedH = Math.max(blendedH, minLandFloor);
          }
          newHeights[iz * gx + ix] = blendedH;
          newWater[iz * gx + ix] = blendedH <= 0 ? Math.max(0.6, -blendedH + 0.5) : 0;
        } else {
          newHeights[iz * gx + ix] = origH;
          newWater[iz * gx + ix] = origH <= 0 ? Math.max(0.6, -origH + 0.5) : 0;
        }
      }
    }

    // Same delta-based resnap as regenRegionCoastlines -- see its doc comment.
    // Seam stitching reshapes the border band, so authored props sitting in
    // it need to move with the terrain instead of floating/burying.
    const oldHeightSampler = { gridSize: gx, gridSizeX: gx, gridSizeZ: gz, pitch, heights: bpA.heights };
    const newHeightSampler = { gridSize: gx, gridSizeX: gx, gridSizeZ: gz, pitch, heights: newHeights };
    const resnappedAssets = (bpA.assets ?? []).map((asset) => {
      const delta =
        sampleRegionHeight(newHeightSampler, asset.localX, asset.localZ) -
        sampleRegionHeight(oldHeightSampler, asset.localX, asset.localZ);
      return Math.abs(delta) > 0.01 ? { ...asset, localY: asset.localY + delta } : asset;
    });

    return {
      ...bpA,
      heights: newHeights,
      waterHeights: newWater,
      assets: resnappedAssets,
    };
  });
}

export interface CoastlineRegenOptions {
  /** Width in meters of the coastal falloff transition margin. Defaults to 44m. */
  coastMargin?: number;
  /** Seabed depth below sea level in meters along the open outer sea boundary. Defaults to -5.5m. */
  oceanDepth?: number;
  /** Whether to synthesize natural offshore islets and sandbars in unbordered open sea. Defaults to true. */
  generateIslands?: boolean;
}

export function detectRegionNeighborEdges(
  target: Pick<RegionBlueprint, "id" | "gridSize" | "pitch" | "worldOriginX" | "worldOriginZ"> & { gridSizeX?: number; gridSizeZ?: number },
  allRegions: Iterable<Pick<RegionBlueprint, "id" | "gridSize" | "pitch" | "worldOriginX" | "worldOriginZ"> & { gridSizeX?: number; gridSizeZ?: number }>,
  tolerance = 36.0,
): RegionNeighborEdges {
  const gx = target.gridSizeX ?? target.gridSize;
  const gz = target.gridSizeZ ?? target.gridSize;
  const pitch = target.pitch;
  const halfX = regionHalfSpan(gx, pitch);
  const halfZ = regionHalfSpan(gz, pitch);
  const ox = target.worldOriginX ?? 0;
  const oz = target.worldOriginZ ?? 0;
  const minX = ox - halfX;
  const maxX = ox + halfX;
  const minZ = oz - halfZ;
  const maxZ = oz + halfZ;

  let north = false;
  let south = false;
  let east = false;
  let west = false;

  for (const other of allRegions) {
    if (other.id === target.id) continue;
    const oGx = other.gridSizeX ?? other.gridSize;
    const oGz = other.gridSizeZ ?? other.gridSize;
    const oPitch = other.pitch;
    const oHalfX = regionHalfSpan(oGx, oPitch);
    const oHalfZ = regionHalfSpan(oGz, oPitch);
    const oOx = other.worldOriginX ?? 0;
    const oOz = other.worldOriginZ ?? 0;
    const oMinX = oOx - oHalfX;
    const oMaxX = oOx + oHalfX;
    const oMinZ = oOz - oHalfZ;
    const oMaxZ = oOz + oHalfZ;

    // Check Z-overlap for West/East adjacency (at least 4m overlap)
    const overlapZ = minZ < oMaxZ - 4.0 && maxZ > oMinZ + 4.0;
    // Check X-overlap for North/South adjacency (at least 4m overlap)
    const overlapX = minX < oMaxX - 4.0 && maxX > oMinX + 4.0;

    // West: other region borders or slightly overlaps to the west
    if (overlapZ && Math.abs(minX - oMaxX) <= tolerance) {
      west = true;
    }
    // East: other region borders or slightly overlaps to the east
    if (overlapZ && Math.abs(maxX - oMinX) <= tolerance) {
      east = true;
    }
    // South: other region borders or slightly overlaps to the south
    if (overlapX && Math.abs(minZ - oMaxZ) <= tolerance) {
      south = true;
    }
    // North: other region borders or slightly overlaps to the north
    if (overlapX && Math.abs(maxZ - oMinZ) <= tolerance) {
      north = true;
    }
  }

  return { north, south, east, west };
}

export interface RegionLandmassBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface CoastlineRegenOptions {
  coastMargin?: number;
  oceanDepth?: number;
  generateIslands?: boolean;
  allRegions?: readonly RegionLandmassBounds[];
}

/**
 * Computes the continuous distance in world space from (sampleX, sampleZ)
 * to the outer perimeter of the union of all connected continent regions.
 *
 * For any multi-region layout (grid, staggered, L-shaped, diagonal, T-shaped, or irregular):
 * - If moving along a cardinal direction (+X, -X, +Z, -Z) enters or stays within another region,
 *   the land connection is continuous (dist = distance to the outermost edge of that connected chain).
 * - Concave corners (e.g. where an outer corner of one region meets the side of another)
 *   round smoothly into natural coastal bays and coves with zero square right angles.
 * - Convex corners round into natural capes and headlands.
 */
export function computeLandmassDistanceToOcean(
  sampleX: number,
  sampleZ: number,
  localX: number,
  localZ: number,
  halfX: number,
  halfZ: number,
  neighborEdges?: RegionNeighborEdges,
  allRegions?: readonly RegionLandmassBounds[],
): { distW: number; distE: number; distS: number; distN: number } {
  if (allRegions && allRegions.length > 1) {
    let minXSpan = Infinity;
    let maxXSpan = -Infinity;
    let minZSpan = Infinity;
    let maxZSpan = -Infinity;

    // Tolerance to handle small seam overlaps or abutting region borders
    const tol = 6.0;

    for (const r of allRegions) {
      // Check if sampleZ is within this region's Z span
      if (sampleZ >= r.minZ - tol && sampleZ <= r.maxZ + tol) {
        minXSpan = Math.min(minXSpan, r.minX);
        maxXSpan = Math.max(maxXSpan, r.maxX);
      }
      // Check if sampleX is within this region's X span
      if (sampleX >= r.minX - tol && sampleX <= r.maxX + tol) {
        minZSpan = Math.min(minZSpan, r.minZ);
        maxZSpan = Math.max(maxZSpan, r.maxZ);
      }
    }

    const distW = minXSpan !== Infinity ? sampleX - minXSpan : (neighborEdges?.west ? 9999.0 : localX + halfX);
    const distE = maxXSpan !== -Infinity ? maxXSpan - sampleX : (neighborEdges?.east ? 9999.0 : halfX - localX);
    const distS = minZSpan !== Infinity ? sampleZ - minZSpan : (neighborEdges?.south ? 9999.0 : localZ + halfZ);
    const distN = maxZSpan !== -Infinity ? maxZSpan - sampleZ : (neighborEdges?.north ? 9999.0 : halfZ - localZ);

    return {
      distW: Math.max(0, distW),
      distE: Math.max(0, distE),
      distS: Math.max(0, distS),
      distN: Math.max(0, distN),
    };
  }

  // Fallback for standalone single region with 4-way boolean edges
  const edges = neighborEdges ?? { west: false, east: false, south: false, north: false };
  return {
    distW: edges.west ? 9999.0 : Math.max(0, localX + halfX),
    distE: edges.east ? 9999.0 : Math.max(0, halfX - localX),
    distS: edges.south ? 9999.0 : Math.max(0, localZ + halfZ),
    distN: edges.north ? 9999.0 : Math.max(0, halfZ - localZ),
  };
}

/**
 * Evaluates the continuous Signed Distance Field (SDF) to the outer perimeter of the continent landmass union.
 * - Negative (< 0): inside the continent landmass. (Internal seams have large negative values -> 100% solid land).
 * - Zero (= 0): the physical outer continent coastline.
 * - Positive (> 0): in the open ocean.
 *
 * Guaranteed: Internal boundaries between adjacent regions are NEVER rounded or carved into.
 * Only the outer perimeter that meets the ocean receives sweeping coastal curves.
 */
export function evaluateContinentLandmassSDF(
  worldX: number,
  worldZ: number,
  localX: number,
  localZ: number,
  halfX: number,
  halfZ: number,
  neighborEdges?: RegionNeighborEdges,
  allRegions?: readonly RegionLandmassBounds[],
): number {
  if (allRegions && allRegions.length > 1) {
    const tol = 4.0;
    let isInsideAny = false;

    // Check if point is inside any region
    for (const r of allRegions) {
      if (
        worldX >= r.minX - tol &&
        worldX <= r.maxX + tol &&
        worldZ >= r.minZ - tol &&
        worldZ <= r.maxZ + tol
      ) {
        isInsideAny = true;
        break;
      }
    }

    if (isInsideAny) {
      // Find the distance to exit the continent landmass in each cardinal direction
      let minXSpan = Infinity;
      let maxXSpan = -Infinity;
      let minZSpan = Infinity;
      let maxZSpan = -Infinity;

      for (const r of allRegions) {
        if (worldZ >= r.minZ - tol && worldZ <= r.maxZ + tol) {
          minXSpan = Math.min(minXSpan, r.minX);
          maxXSpan = Math.max(maxXSpan, r.maxX);
        }
        if (worldX >= r.minX - tol && worldX <= r.maxX + tol) {
          minZSpan = Math.min(minZSpan, r.minZ);
          maxZSpan = Math.max(maxZSpan, r.maxZ);
        }
      }

      const distW = minXSpan !== Infinity ? worldX - minXSpan : (neighborEdges?.west ? 9999.0 : localX + halfX);
      const distE = maxXSpan !== -Infinity ? maxXSpan - worldX : (neighborEdges?.east ? 9999.0 : halfX - localX);
      const distS = minZSpan !== Infinity ? worldZ - minZSpan : (neighborEdges?.south ? 9999.0 : localZ + halfZ);
      const distN = maxZSpan !== -Infinity ? maxZSpan - worldZ : (neighborEdges?.north ? 9999.0 : halfZ - localZ);

      const minExitDist = Math.min(
        Math.max(0, distW),
        Math.max(0, distE),
        Math.max(0, distS),
        Math.max(0, distN),
      );

      return -minExitDist;
    }

    // Outside all regions (in ocean): distance to closest region bounding box
    let minOceanDist = Infinity;
    for (const r of allRegions) {
      const cx = (r.minX + r.maxX) / 2;
      const cz = (r.minZ + r.maxZ) / 2;
      const bx = (r.maxX - r.minX) / 2;
      const bz = (r.maxZ - r.minZ) / 2;
      const dx = Math.max(0, Math.abs(worldX - cx) - bx);
      const dz = Math.max(0, Math.abs(worldZ - cz) - bz);
      const d = Math.hypot(dx, dz);
      if (d < minOceanDist) minOceanDist = d;
    }
    return minOceanDist;
  }

  // Single region fallback:
  let distW = neighborEdges?.west ? 9999.0 : localX + halfX;
  let distE = neighborEdges?.east ? 9999.0 : halfX - localX;
  let distS = neighborEdges?.south ? 9999.0 : localZ + halfZ;
  let distN = neighborEdges?.north ? 9999.0 : halfZ - localZ;

  const minExitDist = Math.min(
    Math.max(0, distW),
    Math.max(0, distE),
    Math.max(0, distS),
    Math.max(0, distN),
  );

  return -minExitDist;
}

/**
 * Procedurally synthesizes rich, varied maritime coastal landforms on unbordered open sea edges:
 * - Prominent Landforms: High Headlands, Promontory Cliffs, Capes, Sand Spits, Peninsulas.
 * - Water Access & Depressions: Sheltered Coves, Inlets, Bays, and Sounds.
 * - Interconnecting Paths: Sand Tombolos (wave-formed bridges to islands), Isthmuses, and Straits.
 * - Maritime Archipelagos: Stepped sea stacks, barrier island chains, and sandbars.
 *
 * Guaranteed 100% preservation of neighbored inland borders.
 */
export function evaluateCoastalLandforms(
  sampleX: number,
  sampleZ: number,
  localX: number,
  localZ: number,
  halfX: number,
  halfZ: number,
  neighborEdges: RegionNeighborEdges,
  seedH: number,
  baseMargin = 85.0,
  allRegions?: readonly RegionLandmassBounds[],
): {
  falloff: number;
  promontoryLift: number;
  coveCarve: number;
  spitRidge: number;
  islandHeight: number;
  inlandSafety: number;
} {
  // 1. Sweeping multi-scale 2D domain warping (Macro gulfs, peninsulas, sweeping coastal contours)
  const macroWarpX = (fbm(seedH + 1101, sampleX, sampleZ, 300, 3) - 0.48) * 60.0
                   + (fbm(seedH + 1102, sampleX * 1.8, sampleZ * 1.8, 120, 2) - 0.5) * 25.0;
  const macroWarpZ = (fbm(seedH + 1201, sampleX + 513, sampleZ + 871, 300, 3) - 0.48) * 60.0
                   + (fbm(seedH + 1202, (sampleX + 320) * 1.8, (sampleZ + 610) * 1.8, 120, 2) - 0.5) * 25.0;

  const bayWarpX = (fbm(seedH + 1301, sampleX * 3.2, sampleZ * 3.2, 50, 2) - 0.5) * 12.0;
  const bayWarpZ = (fbm(seedH + 1302, (sampleX + 111) * 3.2, (sampleZ + 222) * 3.2, 50, 2) - 0.5) * 12.0;

  const totalWarpX = macroWarpX + bayWarpX;
  const totalWarpZ = macroWarpZ + bayWarpZ;

  const warpedSampleX = sampleX + totalWarpX;
  const warpedSampleZ = sampleZ + totalWarpZ;
  const warpedLocalX = localX + totalWarpX;
  const warpedLocalZ = localZ + totalWarpZ;

  const dLand = evaluateContinentLandmassSDF(
    warpedSampleX,
    warpedSampleZ,
    warpedLocalX,
    warpedLocalZ,
    halfX,
    halfZ,
    neighborEdges,
    allRegions,
  );

  // Map SDF to smooth coastal falloff:
  // dLand >= 0 (perimeter & open sea) -> falloff = 0.0 (ocean floor)
  // dLand in [-baseMargin, 0] -> smooth rise through shallows, beach, and dunes
  // dLand <= -baseMargin (inland) -> falloff = 1.0 (dry continent land)
  const coastWidth = Math.max(40.0, baseMargin);
  const tCoast = clamp(-dLand / coastWidth, 0, 1);
  const falloff = smoothstep(tCoast);

  // Natural coastal interaction factor (1 in coastal shelf/water, 0 deep inland)
  const coastZone = 1.0 - smoothstep(clamp(falloff, 0, 1));

  // 2. Prominent High Headlands / Promontories / Capes (Jutting rocky vantage points like Monarch's Bluffs)
  let promontoryLift = 0;
  if (falloff > 0.10 && falloff < 0.96) {
    const headlandNoise = fbm(seedH + 1201, sampleX, sampleZ, 55, 2);
    if (headlandNoise > 0.52) {
      const tHeadland = (headlandNoise - 0.52) / 0.48;
      promontoryLift = Math.pow(tHeadland, 1.35) * 15.0 * (1.0 - Math.pow(falloff, 3.0));
    }
  }

  // 3. Deep Marine Sounds, Fjords, and Sheltered Pirate Coves (Water Access)
  let coveCarve = 0;
  if (falloff > 0.10 && falloff < 0.96) {
    // Wide ocean sounds / fjords cutting deep into coastal land
    const soundNoise = Math.abs(fbm(seedH + 1401, sampleX, sampleZ, 85, 2) - 0.5);
    const soundCarve = soundNoise < 0.08 ? Math.pow((0.08 - soundNoise) / 0.08, 1.25) * 8.0 : 0;

    // Sheltered quiet coves and boat channels
    const coveNoise = Math.abs(fbm(seedH + 1402, sampleX, sampleZ, 40, 2) - 0.5);
    const localCove = coveNoise < 0.13 ? Math.pow((0.13 - coveNoise) / 0.13, 1.3) * 6.5 : 0;

    coveCarve = (soundCarve + localCove) * (1.0 - Math.pow(falloff, 3.0));
  }

  // 4. Sand Spits, Isthmuses & Tombolos (Wave-Formed Sand Bridges Connecting Islands)
  let spitRidge = 0;
  if (falloff > 0.04 && falloff < 0.88) {
    const tomboloNoise = Math.abs(fbm(seedH + 1301, sampleX, sampleZ, 60, 2) - 0.5);
    if (tomboloNoise < 0.11) {
      const tTombolo = (0.11 - tomboloNoise) / 0.11;
      spitRidge = Math.pow(tTombolo, 1.5) * 4.6 * coastZone;
    }
  }

  // 5. Maritime Archipelagos, Keys, Stepped Sea Stacks & Barrier Islets (like Cutlass Keys)
  let islandHeight = 0;
  if (falloff > 0.04 && falloff < 0.85) {
    const islandFbm = fbm(seedH + 1501, sampleX, sampleZ, 42, 3);
    const islandDetail = fbm(seedH + 1502, sampleX, sampleZ, 16, 2);
    if (islandFbm > 0.50) {
      const tIsland = (islandFbm - 0.50) / 0.50;
      const peak = Math.pow(tIsland, 1.25) * 12.0 + (islandDetail - 0.5) * 2.2;
      islandHeight = (1.2 + peak) * coastZone;
    }
  }

  return { falloff, promontoryLift, coveCarve, spitRidge, islandHeight, inlandSafety: coastZone };
}

/**
 * Regenerates unbordered outer edges of a region into natural coastline,
 * sandy beaches, coastal shallows, and deep open ocean leading out to the horizon.
 *
 * Any edge marked false in `neighborEdges` (or not adjacent to another region)
 * is sculpted with a smooth Hermite coastal slope down to `oceanDepth`,
 * with populated water depths. Shared borders with neighboring regions are 100% preserved.
 */
export function regenRegionCoastlines(
  blueprint: RegionBlueprint,
  neighborEdges: RegionNeighborEdges = { north: false, south: false, east: false, west: false },
  options: CoastlineRegenOptions = {},
): RegionBlueprint {
  const gx = blueprint.gridSizeX ?? blueprint.gridSize;
  const gz = blueprint.gridSizeZ ?? blueprint.gridSize;
  const pitch = blueprint.pitch;
  const halfX = regionHalfSpan(gx, pitch);
  const halfZ = regionHalfSpan(gz, pitch);
  const coastMargin = options.coastMargin ?? Math.min(halfX * 0.65, halfZ * 0.65, 85.0);
  const oceanDepth = options.oceanDepth ?? -5.5;
  const generateIslands = options.generateIslands !== false;

  const newHeights = [...blueprint.heights];
  const newWater = new Array<number>(gx * gz);

  const HARD_FLOOR_MARGIN = 20.0;
  const TAPER_MARGIN = 70.0;
  const connectorFloor = 2.0;
  const seedH = hashString(blueprint.id || blueprint.name) ^ 0x9923;

  for (let iz = 0; iz < gz; iz++) {
    for (let ix = 0; ix < gx; ix++) {
      const localX = ix * pitch - halfX;
      const localZ = iz * pitch - halfZ;
      const origH = blueprint.heights[iz * gx + ix] ?? 0;
      const sampleX = (blueprint.worldOriginX ?? 0) + localX;
      const sampleZ = (blueprint.worldOriginZ ?? 0) + localZ;

      // Distance to neighbored inland boundaries (shared land seams with adjacent regions)
      let minInlandDist = Infinity;
      if (neighborEdges.west) minInlandDist = Math.min(minInlandDist, localX + halfX);
      if (neighborEdges.east) minInlandDist = Math.min(minInlandDist, halfX - localX);
      if (neighborEdges.south) minInlandDist = Math.min(minInlandDist, localZ + halfZ);
      if (neighborEdges.north) minInlandDist = Math.min(minInlandDist, halfZ - localZ);

      const coastal = evaluateCoastalLandforms(
        sampleX,
        sampleZ,
        localX,
        localZ,
        halfX,
        halfZ,
        neighborEdges,
        seedH,
        coastMargin,
        options.allRegions,
      );

      let baseH = origH;
      if (baseH <= 0 && coastal.falloff > 0.05) {
        const ox = blueprint.worldOriginX ?? 0;
        const oz = blueprint.worldOriginZ ?? 0;
        const { height: macroH } = evaluateContinentMacroTerrain(
          sampleX,
          sampleZ,
          {
            seed: blueprint.id || blueprint.name,
            minX: ox - halfX,
            maxX: ox + halfX,
            minZ: oz - halfZ,
            maxZ: oz + halfZ,
            centerX: ox,
            centerZ: oz,
            radiusX: halfX * 0.95,
            radiusZ: halfZ * 0.95,
            allRegions: options.allRegions,
          },
          blueprint.biome,
        );
        baseH = Math.max(2.0, macroH);
      }

      // On inland shared seams away from open ocean, guarantee walkable dry ground
      if (minInlandDist <= HARD_FLOOR_MARGIN && coastal.falloff >= 0.85) {
        newHeights[iz * gx + ix] = Math.max(baseH, connectorFloor);
      } else if (minInlandDist < TAPER_MARGIN && baseH < connectorFloor && coastal.falloff >= 0.85) {
        const t = clamp((minInlandDist - HARD_FLOOR_MARGIN) / (TAPER_MARGIN - HARD_FLOOR_MARGIN), 0, 1);
        const raiseBlend = 1 - t * t * (3 - 2 * t);
        newHeights[iz * gx + ix] = baseH + (connectorFloor - baseH) * raiseBlend;
      } else if (coastal.falloff >= 0.999) {
        newHeights[iz * gx + ix] = baseH;
      } else {
        let coastH = baseH + coastal.promontoryLift - coastal.coveCarve;
        coastH = oceanDepth + (coastH - oceanDepth) * coastal.falloff;
        if (coastal.spitRidge > 0) {
          coastH = Math.max(coastH, 0.8 + coastal.spitRidge);
        }
        if (generateIslands && coastal.islandHeight > 0) {
          coastH = Math.max(coastH, coastal.islandHeight);
        }
        newHeights[iz * gx + ix] = coastH;
      }

      const h = newHeights[iz * gx + ix]!;
      newWater[iz * gx + ix] = h <= 0 ? Math.max(0.6, -h + 0.5) : 0;
    }
  }

  // Reposition assets/props by the height DELTA at their position (not a
  // hard snap to the new ground) so they follow this bulk terrain rewrite
  // instead of floating/burying, while any intentional vertical offset (a
  // lantern above its post, a roof piece stacked on a wall) is preserved
  // relative to the surface under it. Ordinary sculpting intentionally
  // leaves authored localY alone (see regionInterior.ts's "do not re-snap to
  // heightmap" comment) -- but a coastline/seam regen is exactly the kind of
  // large-scale rewrite authored placements can't have anticipated, and
  // skipping this is what left trees floating over/sunk into the terrain
  // after a region's edges got reshaped.
  const oldHeightSampler = { gridSize: gx, gridSizeX: gx, gridSizeZ: gz, pitch, heights: blueprint.heights };
  const newHeightSampler = { gridSize: gx, gridSizeX: gx, gridSizeZ: gz, pitch, heights: newHeights };
  const resnappedAssets = (blueprint.assets ?? []).map((asset) => {
    const delta =
      sampleRegionHeight(newHeightSampler, asset.localX, asset.localZ) -
      sampleRegionHeight(oldHeightSampler, asset.localX, asset.localZ);
    return Math.abs(delta) > 0.01 ? { ...asset, localY: asset.localY + delta } : asset;
  });

  // Clear resources or assets that ended up underwater (water depth > 0.5m)
  const filteredAssets = resnappedAssets.filter((asset) => {
    const gxIdx = clamp(Math.floor((asset.localX + halfX) / pitch), 0, gx - 1);
    const gzIdx = clamp(Math.floor((asset.localZ + halfZ) / pitch), 0, gz - 1);
    const h = newHeights[gzIdx * gx + gxIdx] ?? 0;
    return h >= -0.5; // allow docks/piers slightly in water, but not deep seabed
  });

  const filteredNodes = (blueprint.resourceNodes ?? []).filter((node) => {
    const gxIdx = clamp(Math.floor((node.localX + halfX) / pitch), 0, gx - 1);
    const gzIdx = clamp(Math.floor((node.localZ + halfZ) / pitch), 0, gz - 1);
    const h = newHeights[gzIdx * gx + gxIdx] ?? 0;
    return h >= 0.2;
  });

  return {
    ...blueprint,
    heights: newHeights,
    waterHeights: newWater,
    neighborEdges,
    assets: filteredAssets,
    resourceNodes: filteredNodes,
  };
}

/**
 * Regenerates coastlines and open sea across an entire continent:
 * Computes neighboring contacts for every region, and for any outer edge
 * with no neighbor (perimeter), sculpts natural coastlines, beaches, and open sea.
 */
export function regenContinentCoastlines(
  blueprints: RegionBlueprint[],
  options: CoastlineRegenOptions = {},
): RegionBlueprint[] {
  if (!blueprints || blueprints.length === 0) return [];

  const allRegions: RegionLandmassBounds[] = blueprints.map((b) => {
    const gx = b.gridSizeX ?? b.gridSize;
    const gz = b.gridSizeZ ?? b.gridSize;
    const halfX = regionHalfSpan(gx, b.pitch);
    const halfZ = regionHalfSpan(gz, b.pitch);
    const ox = b.worldOriginX ?? 0;
    const oz = b.worldOriginZ ?? 0;
    return {
      minX: ox - halfX,
      maxX: ox + halfX,
      minZ: oz - halfZ,
      maxZ: oz + halfZ,
    };
  });

  return blueprints.map((bp) => {
    const neighborEdges = detectRegionNeighborEdges(bp, blueprints, 36.0);
    return regenRegionCoastlines(bp, neighborEdges, {
      ...options,
      allRegions,
    });
  });
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
  grassland: { amplitude: 17.0, cellSize: 70, octaves: 4, baseHeight: -3.8, peakThreshold: 0.72, mountainHeight: 22, jaggedAmp: 3.0 },
  forest: { amplitude: 18.0, cellSize: 65, octaves: 4, baseHeight: -3.4, peakThreshold: 0.70, mountainHeight: 26, jaggedAmp: 3.5 },
  jungle: { amplitude: 17.0, cellSize: 55, octaves: 4, baseHeight: -3.2, peakThreshold: 0.68, mountainHeight: 25, jaggedAmp: 3.5 },
  desert: { amplitude: 15.0, cellSize: 60, octaves: 3, baseHeight: -3.0, peakThreshold: 0.65, mountainHeight: 35, jaggedAmp: 4.5 },
  arctic: { amplitude: 19.0, cellSize: 45, octaves: 5, baseHeight: -3.5, peakThreshold: 0.58, mountainHeight: 50, jaggedAmp: 10.0 },
  swamp: { amplitude: 5.0, cellSize: 60, octaves: 3, baseHeight: -2.2, peakThreshold: 0.90, mountainHeight: 4, jaggedAmp: 1.0 },
  volcanic: { amplitude: 20.0, cellSize: 42, octaves: 5, baseHeight: -3.5, peakThreshold: 0.50, mountainHeight: 65, jaggedAmp: 14.0, crater: true },
  alien: { amplitude: 18.0, cellSize: 45, octaves: 5, baseHeight: -3.2, peakThreshold: 0.58, mountainHeight: 48, jaggedAmp: 10.0 },
  underground: { amplitude: 15.0, cellSize: 40, octaves: 5, baseHeight: -2.0, peakThreshold: 0.55, mountainHeight: 40, jaggedAmp: 10.0 },
  cosmic: { amplitude: 18.0, cellSize: 45, octaves: 5, baseHeight: -3.2, peakThreshold: 0.60, mountainHeight: 50, jaggedAmp: 10.0, plateau: true },
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
  desert: ["dead_1.glb", "dead_2.glb", "dead_3.glb", "rock_1.glb", "rock_2.glb", "rock_3.glb"],
  arctic: ["pine_1.glb", "pine_2.glb", "pine_3.glb", "dead_1.glb", "rock_1.glb", "rock_2.glb"],
  swamp: ["twisted_1.glb", "twisted_2.glb", "twisted_3.glb", "dead_2.glb", "bush.glb", "mushroom.glb"],
  volcanic: ["dead_1.glb", "dead_2.glb", "dead_3.glb", "rock_1.glb", "rock_2.glb", "rock_3.glb"],
  alien: ["twisted_2.glb", "twisted_3.glb", "mushroom.glb", "fern.glb", "rock_3.glb"],
  underground: ["rock_1.glb", "rock_2.glb", "rock_3.glb", "mushroom.glb", "dead_2.glb"],
  cosmic: ["rock_2.glb", "rock_3.glb", "mushroom.glb", "bush_flowers.glb", "twisted_1.glb"],
};

/**
 * Tree-placement brush catalog — trees only (no bushes/flowers/ferns/mushrooms/rocks).
 * Broader variety than REGION_FOLIAGE so the brush paints a mixed canopy.
 */
export const REGION_TREE_BRUSH: Record<RegionBiome, string[]> = {
  grassland: [
    "oak_1.glb", "oak_2.glb", "oak_3.glb", "oak_4.glb", "oak_5.glb",
    "pine_1.glb", "pine_2.glb", "pine_3.glb",
    "stylized_nature/CommonTree_1.gltf", "stylized_nature/CommonTree_2.gltf", "stylized_nature/CommonTree_3.gltf",
    "stylized_nature/CommonTree_4.gltf", "stylized_nature/CommonTree_5.gltf",
    "free_lowpoly/tree_01.gltf", "free_lowpoly/tree_02.gltf", "free_lowpoly/tree_06.gltf", "free_lowpoly/tree_07.gltf",
    "kaykit_hexagon/tree_single_A.gltf", "kaykit_hexagon/tree_single_B.gltf",
  ],
  forest: [
    "oak_1.glb", "oak_2.glb", "oak_3.glb", "oak_4.glb", "oak_5.glb",
    "pine_1.glb", "pine_2.glb", "pine_3.glb", "pine_4.glb", "pine_5.glb",
    "stylized_nature/CommonTree_1.gltf", "stylized_nature/CommonTree_2.gltf", "stylized_nature/CommonTree_3.gltf",
    "stylized_nature/CommonTree_4.gltf", "stylized_nature/CommonTree_5.gltf",
    "stylized_nature/Pine_1.gltf", "stylized_nature/Pine_2.gltf", "stylized_nature/Pine_3.gltf",
    "stylized_nature/Pine_4.gltf", "stylized_nature/Pine_5.gltf",
    "free_lowpoly/tree_01.gltf", "free_lowpoly/tree_02.gltf", "free_lowpoly/fir_02.gltf", "free_lowpoly/tree_willow.gltf",
    "kaykit_hexagon/tree_single_A.gltf", "kaykit_hexagon/tree_single_B.gltf",
  ],
  jungle: [
    "oak_2.glb", "oak_3.glb", "oak_4.glb", "oak_5.glb",
    "twisted_1.glb", "twisted_2.glb", "twisted_3.glb",
    "pine_1.glb", "pine_2.glb",
    "stylized_nature/TwistedTree_1.gltf", "stylized_nature/TwistedTree_2.gltf", "stylized_nature/TwistedTree_3.gltf",
    "stylized_nature/TwistedTree_4.gltf", "stylized_nature/TwistedTree_5.gltf",
    "stylized_nature/CommonTree_1.gltf", "stylized_nature/CommonTree_2.gltf",
    "free_lowpoly/tree_willow.gltf", "free_lowpoly/tree_01.gltf", "free_lowpoly/tree_02.gltf",
  ],
  desert: [
    "dead_1.glb", "dead_2.glb", "dead_3.glb",
    "twisted_1.glb", "twisted_2.glb", "twisted_3.glb",
    "stylized_nature/DeadTree_1.gltf", "stylized_nature/DeadTree_2.gltf", "stylized_nature/DeadTree_3.gltf",
    "stylized_nature/DeadTree_4.gltf", "stylized_nature/DeadTree_5.gltf",
    "stylized_nature/TwistedTree_1.gltf",
    "free_lowpoly/fallentree_02.gltf", "free_lowpoly/fallentree_04.gltf",
  ],
  arctic: [
    "pine_1.glb", "pine_2.glb", "pine_3.glb", "pine_4.glb", "pine_5.glb",
    "dead_1.glb", "dead_2.glb", "dead_3.glb",
    "stylized_nature/Pine_1.gltf", "stylized_nature/Pine_2.gltf", "stylized_nature/Pine_3.gltf",
    "stylized_nature/Pine_4.gltf", "stylized_nature/Pine_5.gltf",
    "stylized_nature/DeadTree_1.gltf", "stylized_nature/DeadTree_2.gltf",
    "free_lowpoly/fir_02.gltf",
  ],
  swamp: [
    "twisted_1.glb", "twisted_2.glb", "twisted_3.glb",
    "dead_1.glb", "dead_2.glb", "dead_3.glb",
    "oak_3.glb", "oak_5.glb",
    "stylized_nature/TwistedTree_1.gltf", "stylized_nature/TwistedTree_2.gltf", "stylized_nature/TwistedTree_3.gltf",
    "stylized_nature/TwistedTree_4.gltf", "stylized_nature/TwistedTree_5.gltf",
    "stylized_nature/DeadTree_1.gltf", "stylized_nature/DeadTree_3.gltf",
    "free_lowpoly/tree_willow.gltf", "free_lowpoly/fallentree_02.gltf", "free_lowpoly/fallentree_04.gltf",
  ],
  volcanic: [
    "dead_1.glb", "dead_2.glb", "dead_3.glb",
    "twisted_1.glb", "twisted_2.glb", "twisted_3.glb",
    "stylized_nature/DeadTree_1.gltf", "stylized_nature/DeadTree_2.gltf", "stylized_nature/DeadTree_3.gltf",
    "stylized_nature/DeadTree_4.gltf", "stylized_nature/DeadTree_5.gltf",
  ],
  alien: [
    "twisted_1.glb", "twisted_2.glb", "twisted_3.glb",
    "dead_1.glb", "dead_2.glb", "dead_3.glb",
    "stylized_nature/TwistedTree_1.gltf", "stylized_nature/TwistedTree_2.gltf", "stylized_nature/TwistedTree_3.gltf",
    "stylized_nature/TwistedTree_4.gltf", "stylized_nature/TwistedTree_5.gltf",
  ],
  underground: [
    "dead_1.glb", "dead_2.glb", "dead_3.glb",
    "twisted_2.glb", "twisted_3.glb",
    "stylized_nature/DeadTree_2.gltf", "stylized_nature/DeadTree_4.gltf",
  ],
  cosmic: [
    "twisted_1.glb", "twisted_2.glb", "twisted_3.glb",
    "dead_2.glb", "dead_3.glb",
    "pine_4.glb", "pine_5.glb",
    "stylized_nature/TwistedTree_3.gltf", "stylized_nature/TwistedTree_5.gltf",
  ],
};

/** Pick a biome tree brush model from a [0,1) roll (stable across clients). */
export function pickRandomRegionTreeModel(biome: RegionBiome, roll: number): string {
  const list = REGION_TREE_BRUSH[biome] ?? REGION_TREE_BRUSH.grassland;
  const i = Math.max(0, Math.min(list.length - 1, Math.floor(roll * list.length)));
  return list[i]!;
}

/** Map a placed foliage filename to a gatherable node type id, if any. */
export function foliageModelToResourceType(model: string): string | null {
  const base = model.replace(/\.(glb|gltf)$/i, "").toLowerCase();
  if (/^(oak|pine|dead|twisted)_\d+$/.test(base)) return "tree";
  if (base === "bush" || base === "bush_flowers") return "berry_bush";
  if (/^rock_\d+$/.test(base)) return "rock";
  return null;
}

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
  // Atmospheric perspective tuned for crystal clear foregrounds and stunning long-distance vistas
  grassland: { skyColor: "#8fc7ff", fogColor: "#bcd9f0", fogDensity: 0.0009, ambientColor: "#ffffff", ambientIntensity: 0.9, sunColor: "#fff3d6", sunIntensity: 1.1, groundTint: "#8aa04f", skyPreset: "sunny" },
  forest: { skyColor: "#6fa8d8", fogColor: "#9fc2a8", fogDensity: 0.0012, ambientColor: "#dcefe0", ambientIntensity: 0.8, sunColor: "#fff0c8", sunIntensity: 0.95, groundTint: "#4d7a3a", skyPreset: "overcast" },
  jungle: { skyColor: "#5c9bd1", fogColor: "#7fae7a", fogDensity: 0.0015, ambientColor: "#c9f0c0", ambientIntensity: 0.85, sunColor: "#fff8d0", sunIntensity: 1.0, groundTint: "#3c6b2f", skyPreset: "sunny" },
  desert: { skyColor: "#f5d98a", fogColor: "#f0dca0", fogDensity: 0.0010, ambientColor: "#fff2c0", ambientIntensity: 0.95, sunColor: "#fff0b0", sunIntensity: 1.2, groundTint: "#ffffff", skyPreset: "sunny" },
  arctic: { skyColor: "#c9e3f5", fogColor: "#e8f4fb", fogDensity: 0.0013, ambientColor: "#eaf6ff", ambientIntensity: 1.0, sunColor: "#fdfdff", sunIntensity: 1.15, groundTint: "#ffffff", skyPreset: "overcast" },
  swamp: { skyColor: "#7d8a73", fogColor: "#6d7a63", fogDensity: 0.0022, ambientColor: "#aab89a", ambientIntensity: 0.55, sunColor: "#d8dcc0", sunIntensity: 0.6, groundTint: "#515f3a", skyPreset: "overcast" },
  volcanic: { skyColor: "#3a1f1a", fogColor: "#5c2a1e", fogDensity: 0.0018, ambientColor: "#ff8a5c", ambientIntensity: 0.5, sunColor: "#ff6a3c", sunIntensity: 0.9, groundTint: "#6a4432", skyPreset: "stormy" },
  alien: { skyColor: "#2a1a4a", fogColor: "#4a2a6a", fogDensity: 0.0016, ambientColor: "#c08aff", ambientIntensity: 0.6, sunColor: "#8affea", sunIntensity: 0.8, groundTint: "#8a6fd6", skyPreset: "mystical" },
  underground: { skyColor: "#0d0d14", fogColor: "#1a1a24", fogDensity: 0.0035, ambientColor: "#6a7aa0", ambientIntensity: 0.35, sunColor: "#8a9ac0", sunIntensity: 0.4, groundTint: "#5a6a8a", skyPreset: "stormy" },
  cosmic: { skyColor: "#160a2e", fogColor: "#301a5a", fogDensity: 0.0014, ambientColor: "#b0a0ff", ambientIntensity: 0.55, sunColor: "#ffd0f0", sunIntensity: 0.7, groundTint: "#a090e0", skyPreset: "mystical" },
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
  blueprint: Pick<RegionBlueprint, "gridSize" | "gridSizeX" | "gridSizeZ" | "pitch" | "heights">,
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

export type LandscapeVariant =
  | "natural"        // Standard natural topography with organic offshore barrier islands & lake islets
  | "archipelago"    // Island chain, tropical/forested atolls, sandbars, and offshore islet clusters
  | "fjords"         // Deep glacial ocean inlets carving into the mainland, sea stacks & cliffs
  | "highland"       // Elevated stepped plateaus, craggy mountain ridges, and mountain passes
  | "river_valley"   // Wide meandering river basin with floodplains & river delta islands
  | "caldera"        // Sunken volcanic crater lake with a central sanctuary island
  | "badlands";      // Step mesas, deep canyons, tiered sandstone ravines

export interface RegionNeighborEdges {
  west?: boolean;  // -X edge shares a border with a neighboring region
  east?: boolean;  // +X edge shares a border with a neighboring region
  north?: boolean; // -Z edge shares a border with a neighboring region
  south?: boolean; // +Z edge shares a border with a neighboring region
}

export interface ContinentMacroContext {
  seed: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  centerX: number;
  centerZ: number;
  radiusX: number;
  radiusZ: number;
  heightScale?: number;
  layoutPattern?: ContinentLayoutPattern;
  landscapeDistribution?: string;
  allRegions?: readonly RegionLandmassBounds[];
}

/**
 * Evaluates the unified continuous continent macro terrain field at any world position (sampleX, sampleZ).
 * Guarantees 100% boundary height & normal parity between any adjacent regions on the continent,
 * while generating sweeping mountain spines, meandering continental river systems, lake basins,
 * smooth coastal ocean falloffs, beaches, and natural offshore archipelagos.
 */
export function evaluateContinentMacroTerrain(
  sampleX: number,
  sampleZ: number,
  ctx: ContinentMacroContext,
  localBiome: RegionBiome = "grassland",
  localVariant: LandscapeVariant = "natural",
): { height: number; waterHeight: number; continentLandFactor: number } {
  const seedH = hashString(ctx.seed) ^ 0x1234;
  const heightScale = ctx.heightScale ?? 1.0;

  const variant = ctx.landscapeDistribution ?? localVariant;
  const isArchipelago = variant === "archipelago" || ctx.layoutPattern === "archipelago";

  // 1. Continental Topography: Mountain Ranges, Ridges, Hills, and Plains
  // Continental mountain spine (continuous ridge noise crossing multiple regions)
  const ridge1 = 1.0 - Math.abs(fbm(seedH + 401, sampleX, sampleZ, 240, 3) - 0.5) * 2.0;
  const ridge2 = 1.0 - Math.abs(fbm(seedH + 402, sampleX * 1.4, sampleZ * 1.4, 150, 2) - 0.5) * 2.0;
  const ridgeSharp = Math.pow(Math.max(0, ridge1 * 0.7 + ridge2 * 0.3), 2.2);
  const mountainH = ridgeSharp * (26.0 * heightScale);

  // Continental rolling hills, broad plains, and micro-relief
  const macroRelief = (fbm(seedH + 201, sampleX, sampleZ, 360, 2) - 0.35) * 16.0;
  const midHills = (fbm(seedH + 301, sampleX, sampleZ, 120, 3) - 0.5) * 8.5;
  const microDetail = (fbm(seedH + 777, sampleX, sampleZ, 45, 3) - 0.5) * 3.5;

  // 2. Continental Hydrography: Meandering Rivers & Inland Lakes
  const riverVal = Math.abs(fbm(seedH + 601, sampleX * 0.55, sampleZ * 0.55, 160, 2) - 0.5);
  let riverCarve = 0;
  if (riverVal < 0.048) {
    const tR = (0.048 - riverVal) / 0.048;
    riverCarve = Math.pow(tR, 1.3) * (localVariant === "river_valley" ? 8.5 : 6.0);
  }

  const lakeNoise = fbm(seedH + 602, sampleX, sampleZ, 240, 2);
  let lakeCarve = 0;
  if (macroRelief < 1.0 && lakeNoise < 0.32) {
    const tL = (0.32 - lakeNoise) / 0.32;
    lakeCarve = Math.pow(tL, 1.4) * 6.0;
  }

  let mainlandH = macroRelief + midHills + microDetail + mountainH - riverCarve - lakeCarve + 3.8;

  // 3. Wetland & Swamp Biome Inundation (creates rich shallow marshes, murky channels, and inland pools)
  if (localBiome === "swamp") {
    const swampPond = (fbm(seedH + 661, sampleX * 0.7, sampleZ * 0.7, 45, 2) - 0.45) * 4.5;
    mainlandH -= 4.5 + swampPond;
  }

  // 4. Archipelago and Island Variations
  if (isArchipelago) {
    const lagoonNoise = fbm(seedH + 771, sampleX * 0.8, sampleZ * 0.8, 38, 2);
    mainlandH = -3.5 + (lagoonNoise - 0.5) * 4.0;
  }

  // 4. Offshore Islands & Atolls in coastal / archipelago waters
  if (isArchipelago) {
    const islandScale = 28;
    const islandThresh = 0.38;
    const islandFbm = fbm(seedH + 801, sampleX * 0.85, sampleZ * 0.85, islandScale, 3);
    const islandDetail = fbm(seedH + 901, sampleX * 2.2, sampleZ * 2.2, 16, 2);

    if (islandFbm > islandThresh) {
      const tPeak = (islandFbm - islandThresh) / (1.0 - islandThresh);
      const peakHeight = 9.5;
      const islandElevation = Math.pow(tPeak, 1.2) * peakHeight + (islandDetail - 0.5) * 1.4;
      const islandH = 1.2 + islandElevation; // Elevated dry land (+1.2m to +10.5m)
      const islandBlend = smoothstep(clamp((islandFbm - islandThresh) / 0.08, 0, 1));
      mainlandH = mainlandH * (1 - islandBlend) + islandH * islandBlend;
    }
  }

  const finalH = mainlandH;
  const waterHeight = finalH <= 0 ? Math.max(0.6, -finalH + 0.5) : 0;
  return { height: finalH, waterHeight, continentLandFactor: 1.0 };
}

export interface RegionGenerateOptions {
  heightScale: number;
  treeDensity: number;
  worldSize: number;
  mobDensity?: number;
  resourceDensity?: number;
  resourceVariety?: string[];
  minLevel?: number;
  maxLevel?: number;
  gridSizeX?: number;
  gridSizeZ?: number;
  gridSize?: number;
  pitch?: number;
  worldOriginX?: number;
  worldOriginZ?: number;
  worldSeed?: string;
  neighborEdges?: RegionNeighborEdges;
  landscapeVariant?: LandscapeVariant;
  continentContext?: ContinentMacroContext;
}

export const DEFAULT_REGION_GENERATE_OPTIONS: RegionGenerateOptions = {
  heightScale: 1,
  treeDensity: 1,
  mobDensity: 1,
  resourceDensity: 1,
  worldSize: 282,
  minLevel: 1,
  maxLevel: 5,
  landscapeVariant: "natural",
};

const REGION_PITCH = 2.5;

export function generateRandomRegionBlueprint(
  seed: string,
  biome: RegionBiome,
  name: string,
  options: Partial<RegionGenerateOptions> = {},
): RegionBlueprint {
  const opts = { ...DEFAULT_REGION_GENERATE_OPTIONS, ...options };
  const rng = mulberry32(hashString(seed) ^ 0x8d3a1f);
  const variant: LandscapeVariant = opts.landscapeVariant ?? "natural";

  const pitch = opts.pitch ?? REGION_PITCH;
  const gridSizeX = opts.gridSizeX ?? opts.gridSize ?? clamp(Math.round(opts.worldSize / pitch) + 1, 16, 160);
  const gridSizeZ = opts.gridSizeZ ?? opts.gridSize ?? clamp(Math.round(opts.worldSize / pitch) + 1, 16, 160);
  const halfX = regionHalfSpan(gridSizeX, pitch);
  const halfZ = regionHalfSpan(gridSizeZ, pitch);

  const originX = opts.worldOriginX ?? 0;
  const originZ = opts.worldOriginZ ?? 0;

  const hasNeighborWest = opts.neighborEdges?.west === true;
  const hasNeighborEast = opts.neighborEdges?.east === true;
  const hasNeighborSouth = opts.neighborEdges?.south === true;
  const hasNeighborNorth = opts.neighborEdges?.north === true;

  // Derive or use the continent macro context
  const continentCtx: ContinentMacroContext = opts.continentContext ?? {
    seed: opts.worldSeed ?? seed,
    minX: originX - halfX,
    maxX: originX + halfX,
    minZ: originZ - halfZ,
    maxZ: originZ + halfZ,
    centerX: originX,
    centerZ: originZ,
    radiusX: halfX * 0.95,
    radiusZ: halfZ * 0.95,
    heightScale: opts.heightScale ?? 1.0,
    landscapeDistribution: variant,
  };

  const margin = Math.min(halfX * 0.65, halfZ * 0.65, 85.0);

  const heights: number[] = new Array(gridSizeX * gridSizeZ);
  const waterHeights = new Float32Array(gridSizeX * gridSizeZ);

  const regionMinX = originX - halfX;
  const regionMaxX = originX + halfX;
  const regionMinZ = originZ - halfZ;
  const regionMaxZ = originZ + halfZ;

  const neighborEdges = opts.neighborEdges ?? { west: false, east: false, south: false, north: false };
  const seedH = continentCtx ? hashString(continentCtx.seed) ^ 0x47a9 : hashString(`${seed}_coast`) ^ 0x47a9;

  // Sample the unified world-space continent macro terrain
  for (let gz = 0; gz < gridSizeZ; gz++) {
    const z = gz * pitch - halfZ;
    const sampleZ = originZ + z;

    for (let gx = 0; gx < gridSizeX; gx++) {
      const x = gx * pitch - halfX;
      const sampleX = originX + x;

      const { height: sampledH } = evaluateContinentMacroTerrain(
        sampleX,
        sampleZ,
        continentCtx,
        biome,
        variant,
      );

      const coastal = evaluateCoastalLandforms(
        sampleX,
        sampleZ,
        x,
        z,
        halfX,
        halfZ,
        neighborEdges,
        seedH,
        margin,
        continentCtx.allRegions,
      );

      let h = sampledH + coastal.promontoryLift - coastal.coveCarve;

      // Outer coastline ocean falloff on unbordered edges
      if (coastal.falloff < 1.0) {
        const oceanFloor = -5.5;
        h = oceanFloor + (h - oceanFloor) * coastal.falloff;
      }

      // Spit / Tombolo sand ridges connecting to shore/islands
      if (coastal.spitRidge > 0) {
        h = Math.max(h, 0.8 + coastal.spitRidge);
      }

      // Maritime barrier islands & sea stacks
      if (coastal.islandHeight > 0) {
        h = Math.max(h, coastal.islandHeight);
      }

      // Ensure dry ground around entry point (0, 0)
      const distToSpawn = Math.hypot(x, z);
      if (distToSpawn < 22) {
        const spawnSafety = smoothstep(clamp(distToSpawn / 22, 0, 1));
        const spawnFloor = 1.5;
        h = Math.max(h, spawnFloor * (1 - spawnSafety) + h * spawnSafety);
      }

      heights[gz * gridSizeX + gx] = h;
      waterHeights[gz * gridSizeX + gx] = h <= 0 ? Math.max(0.6, -h + 0.5) : 0;
    }
  }
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i]!;
    if (h <= 0) {
      waterHeights[i] = Math.max(0.6, -h + 0.5);
    }
  }

  const blueprint: RegionBlueprint = {
    id: "",
    name,
    biome,
    minLevel: opts.minLevel ?? 1,
    maxLevel: opts.maxLevel ?? (opts.minLevel ? opts.minLevel + 4 : 5),
    gridSize: Math.max(gridSizeX, gridSizeZ),
    gridSizeX,
    gridSizeZ,
    pitch,
    heights,
    waterHeights: Array.from(waterHeights),
    assets: [],
    mobSpawns: [],
    resourceNodes: [],
    villages: [],
    roads: [],
    portals: [],
    npcs: [],
    colorGrading: { ...REGION_COLOR_PRESETS[biome] },
    entryLocal: { x: 0, z: 0 },
    portalWorldX: 0,
    portalWorldZ: 0,
    worldOriginX: opts.worldOriginX ?? 0,
    worldOriginZ: opts.worldOriginZ ?? 0,
  };

  // Reject candidate placements that land in water, near beach/shorelines, or on steep cliff faces
  const maxScatterSlope = REGION_MAX_SCATTER_SLOPE[biome];
  const minElevation = biome === "swamp" || biome === "underground" ? 0.15 : 1.0;
  const minPerimeterY = biome === "swamp" || biome === "underground" ? 0.05 : 0.35;

  function placeOnDryTerrain(bufferRadius = 5): { x: number; z: number } | null {
    const minBoundX = -halfX + bufferRadius + 2;
    const maxBoundX = halfX - bufferRadius - 2;
    const minBoundZ = -halfZ + bufferRadius + 2;
    const maxBoundZ = halfZ - bufferRadius - 2;

    const spanX = Math.max(2, maxBoundX - minBoundX);
    const spanZ = Math.max(2, maxBoundZ - minBoundZ);

    for (let attempt = 0; attempt < 16; attempt++) {
      const x = minBoundX + rng() * spanX;
      const z = minBoundZ + rng() * spanZ;

      // 1. Center check: must be dry ground well above water and beaches (sea level = 0)
      const waterDepth = sampleRegionWaterDepth(blueprint, x, z);
      const y = sampleRegionHeight(blueprint, x, z);
      const slope = regionSlopeAt(blueprint, x, z);
      if (waterDepth > 0.01 || y < minElevation || slope > maxScatterSlope) {
        continue;
      }

      // 2. Radial clearance checks: 4 cardinal samples around perimeter
      const pN = sampleRegionWaterDepth(blueprint, x, z + bufferRadius);
      const pS = sampleRegionWaterDepth(blueprint, x, z - bufferRadius);
      const pE = sampleRegionWaterDepth(blueprint, x + bufferRadius, z);
      const pW = sampleRegionWaterDepth(blueprint, x - bufferRadius, z);
      if (pN > 0.01 || pS > 0.01 || pE > 0.01 || pW > 0.01) {
        continue;
      }

      return { x, z };
    }
    return null;
  }

  const areaScale = Math.max(0.1, ((gridSizeX - 1) * pitch * ((gridSizeZ - 1) * pitch)) / (282 * 282));

  // 2. Tree Scatter (strictly placed on dry ground with diverse models and natural size variance)
  const treeDensity = opts.treeDensity ?? 1.0;
  if (treeDensity > 0.01) {
    const treeModels = REGION_TREE_BRUSH[biome] ?? REGION_TREE_BRUSH.grassland;
    const treeCount = Math.min(260, Math.max(8, Math.round((110 + Math.floor(rng() * 50)) * treeDensity * areaScale)));

    for (let i = 0; i < treeCount; i++) {
      const scaleRoll = rng();
      let scale: number;
      if (scaleRoll < 0.25) {
        scale = 0.55 + rng() * 0.35;
      } else if (scaleRoll < 0.75) {
        scale = 0.95 + rng() * 0.55;
      } else if (scaleRoll < 0.93) {
        scale = 1.55 + rng() * 0.65;
      } else {
        scale = 2.25 + rng() * 0.85;
      }

      const clearance = Math.max(4.0, scale * 2.6);
      const pos = placeOnDryTerrain(clearance);
      if (!pos) continue;

      const model = pick(treeModels, rng);
      blueprint.assets.push({
        model,
        category: "foliage",
        localX: pos.x,
        localY: sampleRegionHeight(blueprint, pos.x, pos.z),
        localZ: pos.z,
        yaw: rng() * Math.PI * 2,
        scale: Math.round(scale * 100) / 100,
      });
    }
  }

  // 3. Mob Spawns
  const mobDensity = opts.mobDensity ?? 1.0;
  if (mobDensity > 0.01) {
    const mobCount = Math.min(36, Math.max(2, Math.round((14 + Math.floor(rng() * 10)) * mobDensity * areaScale)));
    for (let i = 0; i < mobCount; i++) {
      const pos = placeOnDryTerrain(3.0);
      if (pos) {
        blueprint.mobSpawns.push({
          localX: pos.x,
          localZ: pos.z,
          difficulty: Math.max(0.5, Math.min(3.0, (blueprint.minLevel ?? 1) / 10)),
        });
      }
    }
  }

  // 4. Resource Node Scatter
  const resourceDensity = opts.resourceDensity ?? 1.0;
  if (resourceDensity > 0.01) {
    const nodeVariety = (opts.resourceVariety && opts.resourceVariety.length > 0)
      ? opts.resourceVariety
      : getBiomeLevelResourceTypes(biome, blueprint.minLevel ?? 1);

    const resourceNodes: RegionResourceNode[] = [];
    const nodeCount = Math.min(48, Math.max(3, Math.round((26 + Math.floor(rng() * 14)) * resourceDensity * areaScale)));
    for (let i = 0; i < nodeCount; i++) {
      const type = pick(nodeVariety, rng);
      const pos = placeOnDryTerrain(2.5);
      if (pos) {
        resourceNodes.push({
          id: `res_${i}_${Math.floor(rng() * 100000)}`,
          type,
          localX: pos.x,
          localZ: pos.z,
          variant: Math.round(rng() * 100) / 100,
        });
      }
    }
    blueprint.resourceNodes = resourceNodes;
  }

  return blueprint;
}

export type ContinentLayoutPattern =
  | "continent"
  | "grid"
  | "linear"
  | "rectangle_wide"
  | "rectangle_tall"
  | "isthmus"
  | "archipelago";

export type ContinentSizeVariation = "uniform" | "varied" | "rectangular" | "organic";
export type ContinentBiomeDistribution = "thematic_continent" | "single_biome" | "diverse_mosaic";
export type ContinentLevelProgression = "tiered" | "uniform";
export type ContinentScalePreset =
  | "micro"
  | "compact"
  | "small"
  | "medium"
  | "large"
  | "massive"
  | "colossal"
  | "titanic"
  | "mythic";

export interface MultiRegionContinentOptions {
  seed?: string;
  regionCount: number;
  layout: ContinentLayoutPattern;
  sizeVariation: ContinentSizeVariation;
  continentScale?: ContinentScalePreset;
  baseGridSize?: number;
  biomeDistribution: ContinentBiomeDistribution;
  primaryBiome?: RegionBiome;
  levelProgression: ContinentLevelProgression;
  baseMinLevel?: number;
  baseMaxLevel?: number;
  heightScale?: number;
  treeDensity?: number;
  mobDensity?: number;
  resourceDensity?: number;
  pitch?: number;
  landscapeDistribution?: "auto" | LandscapeVariant;
}

export function continentScaleToGridSize(scale: ContinentScalePreset = "massive"): number {
  switch (scale) {
    case "micro": return 32;     // ~190m/zone
    case "compact": return 48;   // ~288m/zone
    case "small": return 64;     // ~384m/zone
    case "medium": return 80;    // ~480m/zone
    case "large": return 96;     // ~570m/zone
    case "colossal": return 160; // ~954m/zone
    case "titanic": return 192;  // ~1146m/zone
    case "mythic": return 256;   // ~1536m/zone
    case "massive":
    default: return 128;         // ~762m/zone
  }
}

export const DEFAULT_CONTINENT_OPTIONS: MultiRegionContinentOptions = {
  regionCount: 4,
  layout: "continent",
  sizeVariation: "varied",
  continentScale: "massive",
  biomeDistribution: "thematic_continent",
  primaryBiome: "forest",
  levelProgression: "tiered",
  baseMinLevel: 1,
  baseMaxLevel: 5,
  heightScale: 1.0,
  treeDensity: 1.0,
  mobDensity: 1.0,
  resourceDensity: 1.0,
  pitch: 6,
  landscapeDistribution: "auto",
};

const THEMATIC_BIOMES_CYCLE: RegionBiome[] = [
  "forest",
  "grassland",
  "swamp",
  "desert",
  "jungle",
  "arctic",
  "volcanic",
  "underground",
  "cosmic",
  "alien",
];

export interface ContinentPlannedSlot {
  index: number;
  col: number;
  row: number;
  gridSizeX: number;
  gridSizeZ: number;
  worldOriginX: number;
  worldOriginZ: number;
  biome: RegionBiome;
  minLevel: number;
  maxLevel: number;
  isStartingRegion: boolean;
  name: string;
  seed: string;
  neighborEdges: RegionNeighborEdges;
  landscapeVariant: LandscapeVariant;
}

export function planMultiRegionContinent(
  options: Partial<MultiRegionContinentOptions> = {},
): {
  planned: ContinentPlannedSlot[];
  continentSeed: string;
  pitch: number;
  opts: MultiRegionContinentOptions;
  continentContext: ContinentMacroContext;
} {
  const opts = { ...DEFAULT_CONTINENT_OPTIONS, ...options };
  const continentSeed = opts.seed || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const rng = mulberry32(hashString(continentSeed) ^ 0x4f882a);
  const count = clamp(opts.regionCount, 2, 16);
  const pitch = opts.pitch ?? 6;
  const baseSize = opts.baseGridSize ?? continentScaleToGridSize(opts.continentScale);

  // Determine grid dimensions
  let cols: number;
  let rows: number;
  if (opts.layout === "linear") {
    cols = count;
    rows = 1;
  } else if (opts.layout === "rectangle_wide") {
    if (count <= 3) {
      cols = count; rows = 1;
    } else if (count <= 6) {
      cols = Math.ceil(count / 2); rows = 2;
    } else if (count <= 10) {
      cols = Math.ceil(count / 2); rows = 2;
    } else {
      cols = Math.ceil(count / 3); rows = 3;
    }
  } else if (opts.layout === "rectangle_tall") {
    if (count <= 3) {
      cols = 1; rows = count;
    } else if (count <= 6) {
      cols = 2; rows = Math.ceil(count / 2);
    } else if (count <= 10) {
      cols = 2; rows = Math.ceil(count / 2);
    } else {
      cols = 3; rows = Math.ceil(count / 3);
    }
  } else if (opts.layout === "isthmus") {
    cols = Math.max(3, count <= 4 ? 3 : Math.ceil(count / 2));
    rows = count <= 3 ? 1 : 2;
  } else if (count === 2) {
    cols = 2; rows = 1;
  } else if (count === 3) {
    cols = 3; rows = 1;
  } else if (count <= 4) {
    cols = 2; rows = 2;
  } else if (count <= 6) {
    cols = 3; rows = 2;
  } else if (count <= 9) {
    cols = 3; rows = 3;
  } else if (count <= 12) {
    cols = 4; rows = 3;
  } else {
    cols = 4; rows = 4;
  }

  // Column X-grid sizes & Row Z-grid sizes (keeps all adjacent column/row seams 100% flush)
  const colGridX: number[] = new Array(cols).fill(baseSize);
  const rowGridZ: number[] = new Array(rows).fill(baseSize);

  if (opts.layout === "rectangle_wide") {
    for (let c = 0; c < cols; c++) {
      colGridX[c] = Math.min(256, Math.max(32, Math.round(baseSize * 1.2)));
    }
  } else if (opts.layout === "rectangle_tall") {
    for (let r = 0; r < rows; r++) {
      rowGridZ[r] = Math.min(256, Math.max(32, Math.round(baseSize * 1.2)));
    }
  }

  if (opts.sizeVariation === "varied") {
    const centerCol = Math.floor(cols / 2);
    const centerRow = Math.floor(rows / 2);

    for (let c = 0; c < cols; c++) {
      if (c === centerCol) {
        colGridX[c] = Math.min(256, Math.round(colGridX[c]! * 1.25));
      } else if ((c === 0 || c === cols - 1) && cols >= 4) {
        colGridX[c] = Math.max(32, Math.round(colGridX[c]! * 0.85));
      }
    }

    for (let r = 0; r < rows; r++) {
      if (r === centerRow) {
        rowGridZ[r] = Math.min(256, Math.round(rowGridZ[r]! * 1.25));
      } else if ((r === 0 || r === rows - 1) && rows >= 4) {
        rowGridZ[r] = Math.max(32, Math.round(rowGridZ[r]! * 0.85));
      }
    }
  } else if (opts.sizeVariation === "rectangular") {
    // Individual zones generated with distinct rectangular aspect ratios
    for (let c = 0; c < cols; c++) {
      const colMult = c % 2 === 0 ? 1.25 : 0.85;
      colGridX[c] = Math.min(256, Math.max(32, Math.round(baseSize * colMult)));
    }
    for (let r = 0; r < rows; r++) {
      const rowMult = r % 2 === 0 ? 0.85 : 1.25;
      rowGridZ[r] = Math.min(256, Math.max(32, Math.round(baseSize * rowMult)));
    }
  } else if (opts.sizeVariation === "organic") {
    for (let c = 0; c < cols; c++) {
      const rJitter = 0.85 + (((rng() * 1000) % 35) / 100);
      colGridX[c] = Math.min(256, Math.max(32, Math.round(baseSize * rJitter)));
    }
    for (let r = 0; r < rows; r++) {
      const rJitter = 0.85 + (((rng() * 1000) % 35) / 100);
      rowGridZ[r] = Math.min(256, Math.max(32, Math.round(baseSize * rJitter)));
    }
  }

  // Calculate contiguous column widths and row heights in world meters
  const colWidthMeters: number[] = new Array(cols).fill(0);
  for (let c = 0; c < cols; c++) {
    colWidthMeters[c] = (colGridX[c]! - 1) * pitch;
  }
  const rowHeightMeters: number[] = new Array(rows).fill(0);
  for (let r = 0; r < rows; r++) {
    rowHeightMeters[r] = (rowGridZ[r]! - 1) * pitch;
  }

  // Cumulative edge coordinates so touching columns/rows have ZERO gaps
  const colEdgeX: number[] = new Array(cols + 1).fill(0);
  const colCenterX: number[] = new Array(cols).fill(0);
  for (let c = 0; c < cols; c++) {
    colCenterX[c] = colEdgeX[c]! + colWidthMeters[c]! / 2;
    colEdgeX[c + 1] = colEdgeX[c]! + colWidthMeters[c]!;
  }
  const totalWidth = colEdgeX[cols]!;

  const rowEdgeZ: number[] = new Array(rows + 1).fill(0);
  const rowCenterZ: number[] = new Array(rows).fill(0);
  for (let r = 0; r < rows; r++) {
    rowCenterZ[r] = rowEdgeZ[r]! + rowHeightMeters[r]! / 2;
    rowEdgeZ[r + 1] = rowEdgeZ[r]! + rowHeightMeters[r]!;
  }
  const totalHeight = rowEdgeZ[rows]!;

  // Plan region slot positions and metadata
  const plannedRaw: Array<Omit<ContinentPlannedSlot, "neighborEdges" | "seed">> = [];
  let currentIdx = 0;
  for (let r = 0; r < rows && currentIdx < count; r++) {
    for (let c = 0; c < cols && currentIdx < count; c++) {
      const sizeX = colGridX[c]!;
      const sizeZ = rowGridZ[r]!;
      const worldOriginX = colCenterX[c]! - totalWidth / 2;
      const worldOriginZ = rowCenterZ[r]! - totalHeight / 2;

      // Biome assignment
      let regionBiome: RegionBiome = opts.primaryBiome ?? "forest";
      if (opts.biomeDistribution === "thematic_continent") {
        if (worldOriginZ < -totalHeight * 0.2) {
          regionBiome = "arctic";
        } else if (worldOriginZ > totalHeight * 0.2) {
          regionBiome = worldOriginX > 0 ? "jungle" : "desert";
        } else if (worldOriginX > totalWidth * 0.2) {
          regionBiome = "swamp";
        } else if (worldOriginX < -totalWidth * 0.2) {
          regionBiome = "volcanic";
        } else {
          regionBiome = currentIdx === 0 ? "forest" : "grassland";
        }
      } else if (opts.biomeDistribution === "diverse_mosaic") {
        regionBiome = THEMATIC_BIOMES_CYCLE[currentIdx % THEMATIC_BIOMES_CYCLE.length]!;
      }

      // Level assignment
      let minLvl = opts.baseMinLevel ?? 1;
      let maxLvl = opts.baseMaxLevel ?? 5;
      const isStarting = currentIdx === 0;

      if (opts.levelProgression === "tiered") {
        if (isStarting) {
          minLvl = 1;
          maxLvl = 5;
        } else {
          const distFromStart = Math.hypot(
            worldOriginX - (plannedRaw[0]?.worldOriginX ?? 0),
            worldOriginZ - (plannedRaw[0]?.worldOriginZ ?? 0),
          );
          const tier = Math.min(3, Math.floor(distFromStart / 600) + 1);
          if (tier === 1) {
            minLvl = 10;
            maxLvl = 20;
          } else if (tier === 2) {
            minLvl = 25;
            maxLvl = 40;
          } else {
            minLvl = 45;
            maxLvl = 60;
          }
        }
      }

      // Landscape Variant determination
      let landscapeVariant: LandscapeVariant = "natural";
      if (opts.landscapeDistribution && opts.landscapeDistribution !== "auto") {
        landscapeVariant = opts.landscapeDistribution;
      } else if (opts.layout === "archipelago") {
        landscapeVariant = "archipelago";
      } else {
        const isOuterCoast = c === 0 || c === cols - 1 || r === 0 || r === rows - 1;
        const roll = rng();
        if (isOuterCoast) {
          if (roll < 0.35) landscapeVariant = "archipelago";
          else if (roll < 0.60) landscapeVariant = "fjords";
          else if (roll < 0.80) landscapeVariant = "river_valley";
          else landscapeVariant = "natural";
        } else {
          if (roll < 0.30) landscapeVariant = "highland";
          else if (roll < 0.55) landscapeVariant = "river_valley";
          else if (roll < 0.72) landscapeVariant = "caldera";
          else if (roll < 0.86) landscapeVariant = "badlands";
          else landscapeVariant = "natural";
        }
      }

      const name = generateMmoRegionName(regionBiome, minLvl, rng);
      plannedRaw.push({
        index: currentIdx,
        col: c,
        row: r,
        gridSizeX: sizeX,
        gridSizeZ: sizeZ,
        worldOriginX,
        worldOriginZ,
        biome: regionBiome,
        minLevel: minLvl,
        maxLevel: maxLvl,
        isStartingRegion: isStarting,
        name,
        landscapeVariant,
      });

      currentIdx++;
    }
  }

  // Calculate neighbor edges for each region
  const eps = 4.0; // edge adjacency threshold
  const planned: ContinentPlannedSlot[] = [];

  for (let i = 0; i < plannedRaw.length; i++) {
    const p = plannedRaw[i]!;
    const halfX = ((p.gridSizeX - 1) * pitch) / 2;
    const halfZ = ((p.gridSizeZ - 1) * pitch) / 2;
    const minX = p.worldOriginX - halfX;
    const maxX = p.worldOriginX + halfX;
    const minZ = p.worldOriginZ - halfZ;
    const maxZ = p.worldOriginZ + halfZ;

    const neighborEdges: RegionNeighborEdges = {
      west: false,
      east: false,
      north: false,
      south: false,
    };

    for (let j = 0; j < plannedRaw.length; j++) {
      if (i === j) continue;
      const other = plannedRaw[j]!;
      const otherHalfX = ((other.gridSizeX - 1) * pitch) / 2;
      const otherHalfZ = ((other.gridSizeZ - 1) * pitch) / 2;
      const oMinX = other.worldOriginX - otherHalfX;
      const oMaxX = other.worldOriginX + otherHalfX;
      const oMinZ = other.worldOriginZ - otherHalfZ;
      const oMaxZ = other.worldOriginZ + otherHalfZ;

      const overlapZ = minZ <= oMaxZ + eps && maxZ >= oMinZ - eps;
      const overlapX = minX <= oMaxX + eps && maxX >= oMinX - eps;

      if (overlapZ) {
        if (Math.abs(minX - oMaxX) <= eps) neighborEdges.west = true;
        if (Math.abs(maxX - oMinX) <= eps) neighborEdges.east = true;
      }
      if (overlapX) {
        if (Math.abs(minZ - oMaxZ) <= eps) neighborEdges.south = true;
        if (Math.abs(maxZ - oMinZ) <= eps) neighborEdges.north = true;
      }
    }

    const regionSeed = `${continentSeed}_r${i}`;
    planned.push({
      ...p,
      seed: regionSeed,
      neighborEdges,
    });
  }

  let minWorldX = Infinity;
  let maxWorldX = -Infinity;
  let minWorldZ = Infinity;
  let maxWorldZ = -Infinity;

  for (const p of planned) {
    const halfX = ((p.gridSizeX - 1) * pitch) / 2;
    const halfZ = ((p.gridSizeZ - 1) * pitch) / 2;
    if (p.worldOriginX - halfX < minWorldX) minWorldX = p.worldOriginX - halfX;
    if (p.worldOriginX + halfX > maxWorldX) maxWorldX = p.worldOriginX + halfX;
    if (p.worldOriginZ - halfZ < minWorldZ) minWorldZ = p.worldOriginZ - halfZ;
    if (p.worldOriginZ + halfZ > maxWorldZ) maxWorldZ = p.worldOriginZ + halfZ;
  }

  const allRegionsBounds: RegionLandmassBounds[] = planned.map((p) => {
    const hX = ((p.gridSizeX - 1) * pitch) / 2;
    const hZ = ((p.gridSizeZ - 1) * pitch) / 2;
    return {
      minX: p.worldOriginX - hX,
      maxX: p.worldOriginX + hX,
      minZ: p.worldOriginZ - hZ,
      maxZ: p.worldOriginZ + hZ,
    };
  });

  const continentContext: ContinentMacroContext = {
    seed: continentSeed,
    minX: minWorldX,
    maxX: maxWorldX,
    minZ: minWorldZ,
    maxZ: maxWorldZ,
    centerX: (minWorldX + maxWorldX) / 2,
    centerZ: (minWorldZ + maxWorldZ) / 2,
    radiusX: (maxWorldX - minWorldX) / 2 + 50,
    radiusZ: (maxWorldZ - minWorldZ) / 2 + 50,
    heightScale: opts.heightScale ?? 1.0,
    layoutPattern: opts.layout,
    landscapeDistribution: opts.landscapeDistribution,
    allRegions: allRegionsBounds,
  };

  return { planned, continentSeed, pitch, opts, continentContext };
}

export function generateMultiRegionContinent(
  options: Partial<MultiRegionContinentOptions> = {},
): RegionBlueprint[] {
  const { planned, continentSeed, pitch, opts, continentContext } = planMultiRegionContinent(options);
  const results: RegionBlueprint[] = [];

  for (let i = 0; i < planned.length; i++) {
    const p = planned[i]!;
    const bp = generateRandomRegionBlueprint(p.seed, p.biome, p.name, {
      heightScale: opts.heightScale ?? 1.0,
      treeDensity: opts.treeDensity ?? 1.0,
      mobDensity: opts.mobDensity ?? 1.0,
      resourceDensity: opts.resourceDensity ?? 1.0,
      gridSizeX: p.gridSizeX,
      gridSizeZ: p.gridSizeZ,
      pitch,
      minLevel: p.minLevel,
      maxLevel: p.maxLevel,
      worldOriginX: p.worldOriginX,
      worldOriginZ: p.worldOriginZ,
      worldSeed: continentSeed,
      neighborEdges: p.neighborEdges,
      landscapeVariant: p.landscapeVariant,
      continentContext,
    });

    bp.id = `region_${Date.now()}_${i}`;
    bp.isStartingRegion = p.isStartingRegion;
    results.push(bp);
  }

  return results;
}

