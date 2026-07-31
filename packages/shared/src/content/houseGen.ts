import type { RegionAsset, RegionHouse } from "./regions";

export type { RegionHouse };

/** Expand a RegionHouse into modular RegionAssets for rendering + collision. */
export function expandHouseToAssets(house: RegionHouse): RegionAsset[] {
  // Generate in house-local space (origin at feet), then bake world transform.
  const pieces = generateHouseAssets(0, 0, 0, {
    type: (house.type === "random" ? "random" : house.type) as HouseType,
    seed: house.seed,
    groupId: house.id,
  });
  const scale = house.scale ?? 1;
  const cos = Math.cos(house.yaw);
  const sin = Math.sin(house.yaw);
  return pieces.map((p, i) => {
    const lx = p.localX;
    const lz = p.localZ;
    const rx = lx * cos - lz * sin;
    const rz = lx * sin + lz * cos;
    return {
      ...p,
      id: house.id ? `${house.id}_${i}` : undefined,
      localX: house.localX + rx * scale,
      localY: house.localY + p.localY * scale,
      localZ: house.localZ + rz * scale,
      yaw: p.yaw + house.yaw,
      scale: (p.scale ?? 1) * scale,
      groupId: house.id,
    };
  });
}

export function expandHousesToAssets(houses: readonly RegionHouse[] | undefined): RegionAsset[] {
  if (!houses || houses.length === 0) return [];
  const out: RegionAsset[] = [];
  for (const h of houses) out.push(...expandHouseToAssets(h));
  return out;
}

/** Procedurally assembles a single house out of the buildings/medieval_village/
 *  modular kit. Draws from the full pack -- plaster / wood-grid / brick wall
 *  families, flat & round doors/windows, open/closed shutters, multiple floor
 *  materials, gable fronts, dormers, chimneys, balconies, vines, fences,
 *  exterior stairs, overhangs, and interior clutter -- so repeated clicks
 *  produce visibly different buildings instead of reskins of one layout.
 *
 *  Grid: wall/floor modules are 2m wide × 3.123m tall (from Wall_Plaster_
 *  Straight.gltf's POSITION accessor). Footprints must match an available
 *  Roof_RoundTiles_{w}x{d}.gltf (6x4 excluded -- asymmetric bbox). */

const WALL_WIDTH = 2;
const WALL_HEIGHT = 3.123;
const MODEL_DIR = "medieval_village/";

export type HouseType =
  | "cottage"
  | "townhouse"
  | "workshop"
  | "tavern"
  | "manor"
  | "storehouse"
  | "villa"
  | "random";

export const HOUSE_TYPE_OPTIONS: readonly { id: HouseType; label: string }[] = [
  { id: "random", label: "🎲 Random House" },
  { id: "cottage", label: "🏠 Cottage" },
  { id: "townhouse", label: "🏘️ Townhouse" },
  { id: "villa", label: "🌿 Villa" },
  { id: "workshop", label: "🛠️ Workshop" },
  { id: "storehouse", label: "📦 Storehouse" },
  { id: "tavern", label: "🍻 Tavern" },
  { id: "manor", label: "🏰 Manor (2-storey)" },
];

/** Material-family palette. Each style lists *pools* of interchangeable
 *  pieces so a single style still rolls different doors/windows/shutters
 *  between generations. */
interface HouseStyle {
  id: string;
  walls: readonly string[];
  wallDoors: readonly string[];
  wallWindows: readonly string[];
  corners: readonly string[];
  doorFrames: readonly string[];
  doors: readonly string[];
  shutters: readonly string[];
  floors: readonly string[];
  chimneys: readonly string[];
  overhangLong: string;
  overhangShort: string;
  overhangCorner: string;
  /** Prefer round openings (arched doors/windows) when available. */
  preferRound?: boolean;
}

const STYLES: readonly HouseStyle[] = [
  {
    id: "plaster",
    walls: ["Wall_Plaster_Straight.gltf", "Wall_Plaster_Straight_Base.gltf"],
    wallDoors: ["Wall_Plaster_Door_Flat.gltf", "Wall_Plaster_Door_Round.gltf", "Wall_Plaster_Door_RoundInset.gltf"],
    wallWindows: [
      "Wall_Plaster_Window_Wide_Flat.gltf",
      "Wall_Plaster_Window_Wide_Flat2.gltf",
      "Wall_Plaster_Window_Wide_Round.gltf",
      "Wall_Plaster_Window_Thin_Round.gltf",
    ],
    corners: ["Corner_Exterior_Wood.gltf", "Corner_ExteriorWide_Wood.gltf"],
    doorFrames: ["DoorFrame_Flat_WoodDark.gltf", "DoorFrame_Round_WoodDark.gltf"],
    doors: ["Door_1_Flat.gltf", "Door_2_Flat.gltf", "Door_1_Round.gltf", "Door_2_Round.gltf"],
    shutters: [
      "WindowShutters_Wide_Flat_Closed.gltf",
      "WindowShutters_Wide_Flat_Open.gltf",
      "WindowShutters_Wide_Round_Closed.gltf",
      "WindowShutters_Wide_Round_Open.gltf",
      "WindowShutters_Thin_Round_Closed.gltf",
      "WindowShutters_Thin_Round_Open.gltf",
    ],
    floors: ["Floor_WoodDark.gltf", "Floor_WoodLight.gltf"],
    chimneys: ["Prop_Chimney.gltf", "Prop_Chimney2.gltf"],
    overhangLong: "Overhang_Plaster_Long.gltf",
    overhangShort: "Overhang_Plaster_Short.gltf",
    overhangCorner: "Overhang_Plaster_Corner.gltf",
  },
  {
    id: "woodgrid",
    walls: ["Wall_Plaster_WoodGrid.gltf", "Wall_Plaster_Straight.gltf"],
    wallDoors: ["Wall_Plaster_Door_Flat.gltf", "Wall_Plaster_Door_RoundInset.gltf"],
    wallWindows: [
      "Wall_Plaster_Window_Wide_Flat.gltf",
      "Wall_Plaster_Window_Wide_Flat2.gltf",
      "Wall_Plaster_Window_Wide_Round.gltf",
    ],
    corners: ["Corner_Exterior_Wood.gltf", "Corner_ExteriorWide_Wood.gltf"],
    doorFrames: ["DoorFrame_Flat_WoodDark.gltf", "DoorFrame_Round_WoodDark.gltf"],
    doors: ["Door_2_Flat.gltf", "Door_4_Flat.gltf", "Door_2_Round.gltf", "Door_4_Round.gltf"],
    shutters: [
      "WindowShutters_Wide_Flat_Open.gltf",
      "WindowShutters_Wide_Round_Open.gltf",
      "WindowShutters_Wide_Flat_Closed.gltf",
    ],
    floors: ["Floor_WoodLight.gltf", "Floor_WoodDark.gltf"],
    chimneys: ["Prop_Chimney.gltf"],
    overhangLong: "Overhang_Plaster_Long.gltf",
    overhangShort: "Overhang_Plaster_Short.gltf",
    overhangCorner: "Overhang_Plaster_Corner_Front.gltf",
  },
  {
    id: "brick",
    walls: ["Wall_UnevenBrick_Straight.gltf"],
    wallDoors: ["Wall_UnevenBrick_Door_Flat.gltf", "Wall_UnevenBrick_Door_Round.gltf"],
    wallWindows: [
      "Wall_UnevenBrick_Window_Wide_Flat.gltf",
      "Wall_UnevenBrick_Window_Wide_Round.gltf",
      "Wall_UnevenBrick_Window_Thin_Round.gltf",
    ],
    corners: ["Corner_Exterior_Brick.gltf", "Corner_ExteriorWide_Brick.gltf"],
    doorFrames: ["DoorFrame_Flat_Brick.gltf", "DoorFrame_Round_Brick.gltf"],
    doors: ["Door_1_Flat.gltf", "Door_1_Round.gltf", "Door_8_Flat.gltf", "Door_8_Round.gltf"],
    shutters: [
      "WindowShutters_Wide_Flat_Closed.gltf",
      "WindowShutters_Wide_Round_Closed.gltf",
      "WindowShutters_Thin_Round_Closed.gltf",
      "WindowShutters_Wide_Flat_Open.gltf",
    ],
    floors: ["Floor_Brick.gltf", "Floor_RedBrick.gltf", "Floor_UnevenBrick.gltf"],
    chimneys: ["Prop_Chimney2.gltf", "Prop_Chimney.gltf"],
    overhangLong: "Overhang_UnevenBrick_Long.gltf",
    overhangShort: "Overhang_UnevenBrick_Short.gltf",
    overhangCorner: "Overhang_UnevenBrick_Corner.gltf",
  },
];

type InteriorKind = "home" | "workshop" | "tavern" | "sparse" | "store" | "manor";

interface TypeDef {
  footprints: readonly { w: number; d: number }[];
  /** Preferred style ids; empty = any. */
  styles: readonly string[];
  interior: InteriorKind;
  stories: 1 | 2;
  windowsPerSide: number;
  vines: boolean;
  fence: boolean;
  balcony: boolean;
  dormer: boolean;
  stairs: boolean;
  overhangs: boolean;
  wagon: boolean;
}

const TYPE_DEFS: Record<Exclude<HouseType, "random">, TypeDef> = {
  cottage: {
    footprints: [
      { w: 4, d: 4 },
      { w: 4, d: 6 },
      { w: 6, d: 6 },
    ],
    styles: ["plaster", "woodgrid"],
    interior: "home",
    stories: 1,
    windowsPerSide: 1,
    vines: true,
    fence: true,
    balcony: false,
    dormer: false,
    stairs: false,
    overhangs: false,
    wagon: false,
  },
  townhouse: {
    footprints: [
      { w: 4, d: 6 },
      { w: 4, d: 8 },
      { w: 6, d: 8 },
      { w: 6, d: 10 },
    ],
    styles: ["plaster", "brick", "woodgrid"],
    interior: "home",
    stories: 1,
    windowsPerSide: 2,
    vines: true,
    fence: false,
    balcony: true,
    dormer: true,
    stairs: true,
    overhangs: true,
    wagon: false,
  },
  villa: {
    footprints: [
      { w: 6, d: 8 },
      { w: 6, d: 10 },
      { w: 8, d: 8 },
      { w: 8, d: 10 },
    ],
    styles: ["woodgrid", "plaster"],
    interior: "home",
    stories: 1,
    windowsPerSide: 2,
    vines: true,
    fence: true,
    balcony: true,
    dormer: true,
    stairs: true,
    overhangs: true,
    wagon: false,
  },
  workshop: {
    footprints: [
      { w: 6, d: 8 },
      { w: 6, d: 10 },
      { w: 8, d: 8 },
      { w: 8, d: 10 },
    ],
    styles: ["brick"],
    interior: "workshop",
    stories: 1,
    windowsPerSide: 1,
    vines: false,
    fence: false,
    balcony: false,
    dormer: false,
    stairs: false,
    overhangs: false,
    wagon: true,
  },
  storehouse: {
    footprints: [
      { w: 6, d: 8 },
      { w: 6, d: 10 },
      { w: 6, d: 12 },
      { w: 8, d: 10 },
      { w: 8, d: 12 },
    ],
    styles: ["brick", "plaster"],
    interior: "store",
    stories: 1,
    windowsPerSide: 1,
    vines: false,
    fence: true,
    balcony: false,
    dormer: false,
    stairs: false,
    overhangs: false,
    wagon: true,
  },
  tavern: {
    footprints: [
      { w: 6, d: 10 },
      { w: 6, d: 12 },
      { w: 6, d: 14 },
      { w: 8, d: 12 },
      { w: 8, d: 14 },
    ],
    styles: ["brick", "woodgrid", "plaster"],
    interior: "tavern",
    stories: 1,
    windowsPerSide: 2,
    vines: true,
    fence: false,
    balcony: false,
    dormer: true,
    stairs: true,
    overhangs: true,
    wagon: false,
  },
  manor: {
    footprints: [
      { w: 6, d: 10 },
      { w: 6, d: 12 },
      { w: 8, d: 10 },
      { w: 8, d: 12 },
      { w: 8, d: 14 },
    ],
    styles: ["woodgrid", "plaster"],
    interior: "manor",
    stories: 2,
    windowsPerSide: 2,
    vines: true,
    fence: true,
    balcony: true,
    dormer: true,
    stairs: true,
    overhangs: true,
    wagon: false,
  },
};

const INTERIOR_PROPS: Record<InteriorKind, readonly { model: string; scale: number }[]> = {
  sparse: [
    { model: "crate_A_small.gltf", scale: 1.2 },
    { model: "barrel.gltf", scale: 1.2 },
  ],
  home: [
    { model: "crate_A_small.gltf", scale: 1.2 },
    { model: "crate_B_small.gltf", scale: 1.2 },
    { model: "barrel.gltf", scale: 1.2 },
    { model: "bucket_water.gltf", scale: 1.2 },
    { model: "medieval_village/Prop_Crate.gltf", scale: 1 },
  ],
  workshop: [
    { model: "crate_A_big.gltf", scale: 1.3 },
    { model: "crate_A_small.gltf", scale: 1.2 },
    { model: "crate_B_small.gltf", scale: 1.2 },
    { model: "barrel.gltf", scale: 1.3 },
    { model: "medieval_village/Prop_Crate.gltf", scale: 1 },
    { model: "medieval_village/Prop_Support.gltf", scale: 1 },
    { model: "medieval_village/Prop_Brick1.gltf", scale: 1 },
    { model: "medieval_village/Prop_Brick2.gltf", scale: 1 },
  ],
  store: [
    { model: "crate_A_big.gltf", scale: 1.4 },
    { model: "crate_A_big.gltf", scale: 1.3 },
    { model: "crate_A_small.gltf", scale: 1.2 },
    { model: "barrel.gltf", scale: 1.4 },
    { model: "barrel.gltf", scale: 1.3 },
    { model: "medieval_village/Prop_Crate.gltf", scale: 1 },
  ],
  tavern: [
    { model: "crate_A_big.gltf", scale: 1.3 },
    { model: "crate_A_small.gltf", scale: 1.2 },
    { model: "barrel.gltf", scale: 1.4 },
    { model: "barrel.gltf", scale: 1.3 },
    { model: "bucket_water.gltf", scale: 1.2 },
    { model: "medieval_village/Prop_Crate.gltf", scale: 1 },
  ],
  manor: [
    { model: "crate_A_small.gltf", scale: 1.2 },
    { model: "crate_B_small.gltf", scale: 1.2 },
    { model: "barrel.gltf", scale: 1.2 },
    { model: "bucket_water.gltf", scale: 1.2 },
    { model: "medieval_village/Prop_Crate.gltf", scale: 1 },
    { model: "medieval_village/Prop_Support.gltf", scale: 1 },
  ],
};

const VINES = ["Prop_Vine1.gltf", "Prop_Vine2.gltf", "Prop_Vine4.gltf", "Prop_Vine5.gltf", "Prop_Vine6.gltf", "Prop_Vine9.gltf"] as const;
const FENCE_PIECES = ["Prop_WoodenFence_Single.gltf", "Prop_WoodenFence_Extension1.gltf", "Prop_WoodenFence_Extension2.gltf"] as const;
const METAL_FENCE = ["Prop_MetalFence_Simple.gltf", "Prop_MetalFence_Ornament.gltf"] as const;

export interface HouseOptions {
  seed?: number;
  footprint?: { w: number; d: number };
  /** @deprecated Prefer `type`; kept so older callers still compile. */
  styleIndex?: number;
  type?: HouseType;
  groupId?: string;
}

type GenAsset = Omit<RegionAsset, "id">;
type PushFn = (model: string, x: number, y: number, z: number, yaw: number, scale?: number) => void;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)]!;
}

function wallOffset(yaw: number, t: number): { dx: number; dz: number } {
  return { dx: t * Math.cos(yaw), dz: -t * Math.sin(yaw) };
}

function outward(yaw: number): { dx: number; dz: number } {
  return { dx: Math.sin(yaw), dz: Math.cos(yaw) };
}

function pickType(rand: () => number, requested: HouseType): Exclude<HouseType, "random"> {
  if (requested !== "random") return requested;
  const keys = Object.keys(TYPE_DEFS) as Exclude<HouseType, "random">[];
  return keys[Math.floor(rand() * keys.length)]!;
}

/** Resolve `random` to a concrete archetype using the same seed as generation. */
export function resolveHouseType(requested: HouseType, seed: number): Exclude<HouseType, "random"> {
  return pickType(mulberry32(seed), requested);
}

/** All assets for collision/render: hand-placed + expanded procedural houses. */
export function regionAllAssets(bp: { assets: RegionAsset[]; houses?: RegionHouse[] }): RegionAsset[] {
  const houses = bp.houses;
  if (!houses || houses.length === 0) return bp.assets;
  return bp.assets.concat(expandHousesToAssets(houses));
}

function pickStyle(rand: () => number, def: TypeDef, styleIndex?: number): HouseStyle {
  if (styleIndex !== undefined && STYLES[styleIndex]) return STYLES[styleIndex]!;
  const pool = def.styles.length > 0
    ? STYLES.filter((s) => def.styles.includes(s.id))
    : STYLES;
  return pick(rand, pool.length > 0 ? pool : STYLES);
}

function roofFrontFor(w: number): string | null {
  return [4, 6, 8].includes(w) ? `Roof_Front_Brick${w}.gltf` : null;
}

/** Generates one house centered at (originX, originZ), base at groundY. */
export function generateHouseAssets(originX: number, originZ: number, groundY: number, opts: HouseOptions = {}): GenAsset[] {
  const rand = mulberry32(opts.seed ?? Math.floor(Math.random() * 0xffffffff));
  const type = pickType(rand, opts.type ?? "random");
  const def = TYPE_DEFS[type];
  const { w, d } = opts.footprint ?? pick(rand, def.footprints);
  const style = pickStyle(rand, def, opts.styleIndex);
  const groupId = opts.groupId;
  const stories = def.stories;

  const assets: GenAsset[] = [];
  const pushMv: PushFn = (model, localX, localY, localZ, yaw, scale = 1) => {
    assets.push({
      model: MODEL_DIR + model,
      category: "building",
      localX: originX + localX,
      localY: groundY + localY,
      localZ: originZ + localZ,
      yaw,
      scale,
      groupId,
    });
  };
  const pushRoot: PushFn = (model, localX, localY, localZ, yaw, scale = 1) => {
    assets.push({
      model,
      category: "building",
      localX: originX + localX,
      localY: groundY + localY,
      localZ: originZ + localZ,
      yaw,
      scale,
      groupId,
    });
  };

  // Roll concrete pieces once per house so walls/doors stay coherent.
  const wall = pick(rand, style.walls);
  const wallDoor = pick(rand, style.wallDoors);
  const wallWindow = pick(rand, style.wallWindows);
  const corner = pick(rand, style.corners);
  const doorFrame = pick(rand, style.doorFrames);
  const door = pick(rand, style.doors);
  const shutters = pick(rand, style.shutters);
  const floor = pick(rand, style.floors);
  const chimney = pick(rand, style.chimneys);

  // Floors for every storey.
  for (let story = 0; story < stories; story++) {
    const y = story * WALL_HEIGHT;
    for (let ix = 0; ix < w / 2; ix++) {
      for (let iz = 0; iz < d / 2; iz++) {
        pushMv(floor, -w / 2 + 1 + ix * WALL_WIDTH, y, -d / 2 + 1 + iz * WALL_WIDTH, 0);
      }
    }
  }

  const wCount = w / WALL_WIDTH;
  const dCount = d / WALL_WIDTH;
  const doorSide = Math.floor(rand() * 4);
  const doorIdx = Math.floor(rand() * (doorSide < 2 ? wCount : dCount));

  const sides: { baseX: number; baseZ: number; yaw: number; count: number }[] = [
    { baseX: 0, baseZ: d / 2, yaw: 0, count: wCount },
    { baseX: 0, baseZ: -d / 2, yaw: Math.PI, count: wCount },
    { baseX: w / 2, baseZ: 0, yaw: Math.PI / 2, count: dCount },
    { baseX: -w / 2, baseZ: 0, yaw: -Math.PI / 2, count: dCount },
  ];

  const buildWallSide = (
    baseX: number,
    baseZ: number,
    yaw: number,
    count: number,
    storyY: number,
    doorIndex: number | null,
    windowIndices: Set<number>,
  ) => {
    for (let i = 0; i < count; i++) {
      const t = -(count - 1) + i * 2;
      const { dx, dz } = wallOffset(yaw, t);
      const x = baseX + dx;
      const z = baseZ + dz;
      if (doorIndex !== null && i === doorIndex && storyY === 0) {
        pushMv(wallDoor, x, storyY, z, yaw);
        pushMv(doorFrame, x, storyY, z, yaw);
        pushMv(door, x, storyY, z, yaw);
      } else if (windowIndices.has(i)) {
        pushMv(wallWindow, x, storyY, z, yaw);
        pushMv(shutters, x, storyY, z, yaw);
      } else {
        pushMv(wall, x, storyY, z, yaw);
      }
    }
  };

  for (let story = 0; story < stories; story++) {
    const storyY = story * WALL_HEIGHT;
    sides.forEach((side, sideIdx) => {
      const isDoorSide = sideIdx === doorSide && story === 0;
      const doorIndex = isDoorSide ? doorIdx % side.count : null;
      const windowIndices = new Set<number>();
      const wantWindows = Math.min(def.windowsPerSide, Math.max(0, side.count - (doorIndex !== null ? 1 : 0)));
      for (let n = 0; n < wantWindows; n++) {
        let idx = Math.floor(rand() * side.count);
        let guard = 0;
        while ((windowIndices.has(idx) || idx === doorIndex) && guard++ < 12) {
          idx = Math.floor(rand() * side.count);
        }
        if (idx !== doorIndex) windowIndices.add(idx);
      }
      buildWallSide(side.baseX, side.baseZ, side.yaw, side.count, storyY, doorIndex, windowIndices);
    });

    // Corners per storey.
    pushMv(corner, w / 2, storyY, d / 2, 0);
    pushMv(corner, w / 2, storyY, -d / 2, -Math.PI / 2);
    pushMv(corner, -w / 2, storyY, -d / 2, Math.PI);
    pushMv(corner, -w / 2, storyY, d / 2, Math.PI / 2);
  }

  const roofY = stories * WALL_HEIGHT;
  pushMv(`Roof_RoundTiles_${w}x${d}.gltf`, 0, roofY, 0, 0);

  const gable = roofFrontFor(w);
  if (gable) {
    pushMv(gable, 0, roofY, d / 2, 0);
    pushMv(gable, 0, roofY, -d / 2, Math.PI);
  }

  // Chimney -- manors/taverns sometimes get two.
  const chimCount = (type === "manor" || type === "tavern") && rand() > 0.45 ? 2 : 1;
  for (let c = 0; c < chimCount; c++) {
    const chimX = (c === 0 ? 1 : -1) * (w / 4) * (rand() > 0.3 ? 1 : 0.6);
    const chimZ = (rand() - 0.5) * (d / 2.5);
    pushMv(chimney, chimX, roofY, chimZ, 0);
  }

  // Roof dormer on the long sides when the type wants one and depth ≥ 8.
  if (def.dormer && d >= 8 && rand() > 0.35) {
    const side = rand() > 0.5 ? 1 : -1;
    pushMv("Roof_Dormer_RoundTile.gltf", (rand() - 0.5) * (w / 3), roofY, side * (d / 4), side > 0 ? 0 : Math.PI);
    if (rand() > 0.5) {
      pushMv("Window_Roof_Wide.gltf", (rand() - 0.5) * (w / 4), roofY + 0.8, side * (d / 3.5), side > 0 ? 0 : Math.PI);
    }
  }

  // Eave overhangs along the long walls.
  if (def.overhangs && rand() > 0.4) {
    for (const side of [sides[0]!, sides[1]!]) {
      const out = outward(side.yaw);
      for (let i = 0; i < side.count; i++) {
        const t = -(side.count - 1) + i * 2;
        const { dx, dz } = wallOffset(side.yaw, t);
        pushMv(
          side.count >= 3 ? style.overhangLong : style.overhangShort,
          side.baseX + dx + out.dx * 0.15,
          roofY - 0.05,
          side.baseZ + dz + out.dz * 0.15,
          side.yaw,
        );
      }
    }
  }

  // Balcony on a non-door long wall (1st floor for 2-storey, ground for villa).
  if (def.balcony && wCount >= 2 && rand() > 0.4) {
    const balconySide = sides[(doorSide + 1 + Math.floor(rand() * 3)) % 4]!;
    const balconyY = stories === 2 ? WALL_HEIGHT : 0;
    const out = outward(balconySide.yaw);
    const mid = Math.floor(balconySide.count / 2);
    const t = -(balconySide.count - 1) + mid * 2;
    const { dx, dz } = wallOffset(balconySide.yaw, t);
    const bx = balconySide.baseX + dx + out.dx * 1.1;
    const bz = balconySide.baseZ + dz + out.dz * 1.1;
    pushMv(rand() > 0.5 ? "Balcony_Simple_Straight.gltf" : "Balcony_Cross_Straight.gltf", bx, balconyY, bz, balconySide.yaw);
  }

  // Exterior stairs leading up to the door.
  if (def.stairs && rand() > 0.35) {
    const doorSideInfo = sides[doorSide]!;
    const out = outward(doorSideInfo.yaw);
    const t = -(doorSideInfo.count - 1) + (doorIdx % doorSideInfo.count) * 2;
    const { dx, dz } = wallOffset(doorSideInfo.yaw, t);
    pushMv(
      pick(rand, ["Stairs_Exterior_Straight.gltf", "Stairs_Exterior_Straight_Center.gltf", "Stairs_Exterior_NoFirstStep.gltf"] as const),
      doorSideInfo.baseX + dx + out.dx * 2.2,
      0,
      doorSideInfo.baseZ + dz + out.dz * 2.2,
      doorSideInfo.yaw + Math.PI,
    );
  }

  // Vines clinging to a couple of wall modules.
  if (def.vines && rand() > 0.3) {
    const vineCount = 1 + Math.floor(rand() * 3);
    for (let v = 0; v < vineCount; v++) {
      const side = pick(rand, sides);
      const i = Math.floor(rand() * side.count);
      const t = -(side.count - 1) + i * 2;
      const { dx, dz } = wallOffset(side.yaw, t);
      const out = outward(side.yaw);
      pushMv(pick(rand, VINES), side.baseX + dx + out.dx * 0.2, rand() > 0.5 ? WALL_HEIGHT * 0.3 : 0, side.baseZ + dz + out.dz * 0.2, side.yaw);
    }
  }

  // Small fence ring / front yard.
  if (def.fence && rand() > 0.4) {
    placeFence(pushMv, w, d, doorSide, rand);
  }

  // Interior stair for multi-storey — against a non-door wall so the doorway stays clear.
  if (stories === 2) {
    const stairSide = sides[(doorSide + 2) % 4]!;
    const out = outward(stairSide.yaw);
    const mid = Math.floor(stairSide.count / 2);
    const t = -(stairSide.count - 1) + mid * 2;
    const { dx, dz } = wallOffset(stairSide.yaw, t);
    // Pull inward from the wall so the stair sits inside the room.
    pushMv(
      pick(rand, ["Stair_Interior_Simple.gltf", "Stair_Interior_Solid.gltf"] as const),
      stairSide.baseX + dx - out.dx * 1.6,
      0,
      stairSide.baseZ + dz - out.dz * 1.6,
      stairSide.yaw + Math.PI,
    );
  }

  // Interior clutter on the ground floor (and a lighter set upstairs for manor).
  placeInterior(pushMv, pushRoot, w, d, 0, def.interior, rand);
  if (stories === 2) {
    placeInterior(pushMv, pushRoot, w, d, WALL_HEIGHT, "sparse", rand);
  }

  // Wagon / outdoor crates for workshop & storehouse.
  if (def.wagon) {
    const doorSideInfo = sides[doorSide]!;
    const out = outward(doorSideInfo.yaw);
    pushMv("Prop_Wagon.gltf", doorSideInfo.baseX + out.dx * 5, 0, doorSideInfo.baseZ + out.dz * 5, doorSideInfo.yaw + Math.PI / 2);
    if (rand() > 0.4) {
      pushRoot("crate_A_big.gltf", doorSideInfo.baseX + out.dx * 3.5 + 1.5, 0, doorSideInfo.baseZ + out.dz * 3.5, rand() * Math.PI * 2, 1.3);
    }
  }

  return assets;
}

function placeFence(pushMv: PushFn, w: number, d: number, doorSide: number, rand: () => number): void {
  const margin = 3.5;
  const fw = w + margin * 2;
  const fd = d + margin * 2;
  const useMetal = rand() > 0.75;
  const pieces = useMetal ? METAL_FENCE : FENCE_PIECES;
  const step = 2;
  const fenceSides: { x0: number; z0: number; x1: number; z1: number; yaw: number; skipDoor: boolean }[] = [
    { x0: -fw / 2, z0: fd / 2, x1: fw / 2, z1: fd / 2, yaw: 0, skipDoor: doorSide === 0 },
    { x0: -fw / 2, z0: -fd / 2, x1: fw / 2, z1: -fd / 2, yaw: Math.PI, skipDoor: doorSide === 1 },
    { x0: fw / 2, z0: -fd / 2, x1: fw / 2, z1: fd / 2, yaw: Math.PI / 2, skipDoor: doorSide === 2 },
    { x0: -fw / 2, z0: -fd / 2, x1: -fw / 2, z1: fd / 2, yaw: -Math.PI / 2, skipDoor: doorSide === 3 },
  ];
  for (const side of fenceSides) {
    const alongX = Math.abs(side.x1 - side.x0) > Math.abs(side.z1 - side.z0);
    const len = alongX ? Math.abs(side.x1 - side.x0) : Math.abs(side.z1 - side.z0);
    const count = Math.max(1, Math.floor(len / step));
    for (let i = 0; i < count; i++) {
      // Leave a gap on the door-facing fence for an entrance.
      if (side.skipDoor && i >= count / 2 - 1 && i <= count / 2) continue;
      const t = (i + 0.5) / count;
      const x = side.x0 + (side.x1 - side.x0) * t;
      const z = side.z0 + (side.z1 - side.z0) * t;
      pushMv(pick(rand, pieces), x, 0, z, side.yaw);
    }
  }
  // Corner posts.
  pushMv("Prop_ExteriorBorder_Corner.gltf", fw / 2, 0, fd / 2, 0);
  pushMv("Prop_ExteriorBorder_Corner.gltf", fw / 2, 0, -fd / 2, -Math.PI / 2);
  pushMv("Prop_ExteriorBorder_Corner.gltf", -fw / 2, 0, -fd / 2, Math.PI);
  pushMv("Prop_ExteriorBorder_Corner.gltf", -fw / 2, 0, fd / 2, Math.PI / 2);
}

function placeInterior(
  pushMv: PushFn,
  pushRoot: PushFn,
  w: number,
  d: number,
  floorY: number,
  kind: InteriorKind,
  rand: () => number,
): void {
  const props = INTERIOR_PROPS[kind];
  const inset = 1.4;
  const innerW = Math.max(0.5, w - inset * 2);
  const innerD = Math.max(0.5, d - inset * 2);
  const count =
    kind === "sparse" ? 1 + Math.floor(rand() * 2)
    : kind === "home" ? 2 + Math.floor(rand() * 3)
    : kind === "workshop" || kind === "store" ? 5 + Math.floor(rand() * 4)
    : kind === "manor" ? 3 + Math.floor(rand() * 3)
    : 5 + Math.floor(rand() * 4);

  for (let i = 0; i < count; i++) {
    const prop = pick(rand, props);
    const x = (rand() - 0.5) * innerW;
    const z = (rand() - 0.5) * innerD;
    const yaw = rand() * Math.PI * 2;
    if (prop.model.startsWith("medieval_village/")) {
      pushMv(prop.model.slice(MODEL_DIR.length), x, floorY, z, yaw, prop.scale);
    } else {
      pushRoot(prop.model, x, floorY, z, yaw, prop.scale);
    }
  }
}
