import type { RegionAsset } from "./regions";

/**
 * Procedural building assembler for the whimsical "Fantastic Village" pack
 * under `buildings|props/fantastic_village/`. Unlike the medieval_village kit
 * (flat 2m wall segments with door/window cutouts, see houseGen.ts), each
 * "body" piece here is already a complete, capped building shell (walls +
 * roof baked into one mesh) sized 7-13m across and 8-14m tall — there's no
 * separate roof category in the pack. So one generated building = one base
 * (plinth) + one body (shell), dressed with door/window/chimney/etc. meshes
 * attached to its exterior faces, not swapped into wall cutouts.
 *
 * Dimensions below are read straight from the pack's manifest.json (Blender
 * export bounds) so door/window/sail offsets land flush against each body's
 * actual footprint instead of guessing.
 */

const DIR = "fantastic_village/";

export type FantasticBuildingType = "tower" | "cottage" | "manor" | "windmill" | "watermill" | "random";

export const FANTASTIC_BUILDING_TYPE_OPTIONS: readonly { id: FantasticBuildingType; label: string }[] = [
  { id: "random", label: "🎲 Random Building" },
  { id: "cottage", label: "🏡 Cottage" },
  { id: "tower", label: "🗼 Tower" },
  { id: "manor", label: "🏯 Manor" },
  { id: "windmill", label: "🌬️ Windmill" },
  { id: "watermill", label: "💧 Watermill" },
];

export interface FantasticBuildingOptions {
  seed?: number;
  type?: FantasticBuildingType;
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
  return arr[Math.floor(rand() * arr.length) % arr.length]!;
}

interface Piece {
  file: string;
  h: number;
  w: number;
  d: number;
}

// --- Bases (plinths) — footprint ~6-6.6m regardless of variant. ---
const BASES_LOW: readonly Piece[] = [
  { file: "base_v01_01.gltf", h: 1.095, w: 6.4694, d: 6.4285 },
  { file: "base_v02_01.gltf", h: 0.634, w: 6.2005, d: 6.2214 },
  { file: "base_v03_01.gltf", h: 0.412, w: 6.0, d: 6.0974 },
];
const BASES_TALL: readonly Piece[] = [
  { file: "base_v04_01.gltf", h: 2.346, w: 6.5271, d: 6.6568 },
  { file: "base_v04_02.gltf", h: 2.346, w: 6.2069, d: 6.2005 },
  { file: "base_v05_01.gltf", h: 2.346, w: 6.2214, d: 6.2005 },
];

// --- Bodies (complete capped shells). ---
const BODY_GRAND: Piece = { file: "body_v01_01.gltf", h: 14.285, w: 8.2118, d: 7.1107 };
const BODIES_COMPACT: readonly Piece[] = [
  { file: "body_v02_01.gltf", h: 8.47, w: 7.9085, d: 7.8831 },
  { file: "body_v02_02.gltf", h: 8.47, w: 7.9085, d: 7.8831 },
  { file: "body_v03_01.gltf", h: 8.364, w: 7.2248, d: 6.8975 },
  { file: "body_v03_02.gltf", h: 8.364, w: 7.2248, d: 6.8975 },
];
const BODIES_LARGE: readonly Piece[] = [
  { file: "body_v04_01.gltf", h: 10.784, w: 7.5858, d: 12.8751 },
  { file: "body_v05_01.gltf", h: 10.784, w: 10.2369, d: 12.8751 },
  { file: "body_v06_01.gltf", h: 10.784, w: 10.2369, d: 10.2142 },
  { file: "body_v07_01.gltf", h: 10.784, w: 12.8751, d: 12.8751 },
];

const DOORS: readonly Piece[] = [
  { file: "door_v01_01.gltf", h: 3.191, w: 3.2065, d: 2.0102 },
  { file: "door_v02_01.gltf", h: 3.286, w: 2.45, d: 1.9387 },
  { file: "door_v03_01.gltf", h: 2.905, w: 1.9537, d: 1.7719 },
  { file: "door_v04_01.gltf", h: 2.845, w: 2.2098, d: 0.708 },
];
const WINDOWS: readonly Piece[] = [
  { file: "window_v01_01.gltf", h: 3.324, w: 2.3907, d: 2.021 },
  { file: "window_v02_01.gltf", h: 2.832, w: 2.1474, d: 2.2152 },
  { file: "window_v06_01.gltf", h: 1.3, w: 1.2138, d: 0.5178 },
  { file: "window_v07_01.gltf", h: 1.187, w: 1.2242, d: 0.4124 },
  { file: "window_v08_01.gltf", h: 0.867, w: 1.128, d: 0.5222 },
  { file: "window_v09_01.gltf", h: 0.97, w: 1.25, d: 0.6235 },
];
const CHIMNEYS_SMALL: readonly Piece[] = [
  { file: "chimney_v01_01.gltf", h: 5.699, w: 1.4243, d: 1.4243 },
  { file: "chimney_v01_02.gltf", h: 5.699, w: 1.4243, d: 1.4243 },
];
const CHIMNEYS_TALL: readonly Piece[] = [
  { file: "chimney_v02_01.gltf", h: 10.313, w: 1.3582, d: 1.3815 },
  { file: "chimney_v02_02.gltf", h: 10.313, w: 1.3582, d: 1.3815 },
];
const STAIRS: readonly Piece[] = [
  { file: "stairs_v02_01.gltf", h: 5.866, w: 3.1474, d: 5.08 },
  { file: "stairs_v03_v1.gltf", h: 3.225, w: 3.0771, d: 5.08 },
  { file: "stairs_v04_v1.gltf", h: 3.256, w: 3.1233, d: 5.08 },
];
const BALCONIES: readonly Piece[] = [
  { file: "balcony_v01_01.gltf", h: 6.561, w: 3.162, d: 5.2072 },
  { file: "balcony_v02_01.gltf", h: 7.985, w: 5.3491, d: 4.8232 },
];
const WINDMILL_SAIL: Piece = { file: "windmill_sail.gltf", h: 17.067, w: 17.0665, d: 3.4799 };
const WATERWHEEL: Piece = { file: "waterwheel_construct.gltf", h: 7.357, w: 6.2373, d: 5.7733 };

const GROUND_PROPS = ["barrel_01.gltf", "barrel_02.gltf", "crate_01.gltf", "crate_02.gltf", "sack_01.gltf", "box_01.gltf", "planks_01.gltf", "hay_01.gltf"] as const;

interface TypeDef {
  bases: readonly Piece[];
  bodies: readonly Piece[];
  chimney: "none" | "small" | "tall";
  balconyChance: number;
  stairsChance: number;
  windowCount: [min: number, max: number];
  windmill: boolean;
  watermill: boolean;
}

const TYPE_DEFS: Record<Exclude<FantasticBuildingType, "random">, TypeDef> = {
  cottage: {
    bases: BASES_LOW,
    bodies: BODIES_COMPACT,
    chimney: "small",
    balconyChance: 0.25,
    stairsChance: 0.15,
    windowCount: [1, 3],
    windmill: false,
    watermill: false,
  },
  tower: {
    bases: BASES_TALL,
    bodies: [BODY_GRAND, ...BODIES_COMPACT],
    chimney: "tall",
    balconyChance: 0.5,
    stairsChance: 0.6,
    windowCount: [2, 4],
    windmill: false,
    watermill: false,
  },
  manor: {
    bases: BASES_TALL,
    bodies: BODIES_LARGE,
    chimney: "tall",
    balconyChance: 0.6,
    stairsChance: 0.7,
    windowCount: [3, 5],
    windmill: false,
    watermill: false,
  },
  windmill: {
    bases: BASES_TALL,
    bodies: [BODY_GRAND, ...BODIES_COMPACT],
    chimney: "none",
    balconyChance: 0.15,
    stairsChance: 0.4,
    windowCount: [1, 3],
    windmill: true,
    watermill: false,
  },
  watermill: {
    bases: BASES_LOW,
    bodies: BODIES_COMPACT,
    chimney: "small",
    balconyChance: 0.1,
    stairsChance: 0.2,
    windowCount: [1, 3],
    windmill: false,
    watermill: true,
  },
};

function pickType(rand: () => number, requested: FantasticBuildingType): Exclude<FantasticBuildingType, "random"> {
  if (requested !== "random") return requested;
  const keys = Object.keys(TYPE_DEFS) as Exclude<FantasticBuildingType, "random">[];
  return keys[Math.floor(rand() * keys.length)]!;
}

/** Resolve `random` to a concrete type using the same seed as generation. */
export function resolveFantasticBuildingType(
  requested: FantasticBuildingType,
  seed: number,
): Exclude<FantasticBuildingType, "random"> {
  return pickType(mulberry32(seed), requested);
}

/** Outward unit normal for a face yaw (matches houseGen.ts's convention). */
function outward(yaw: number): { dx: number; dz: number } {
  return { dx: Math.sin(yaw), dz: Math.cos(yaw) };
}

/** Generates one building centered at (originX, originZ), base at groundY. */
export function generateFantasticBuildingAssets(
  originX: number,
  originZ: number,
  groundY: number,
  opts: FantasticBuildingOptions = {},
): GenAsset[] {
  const rand = mulberry32(opts.seed ?? Math.floor(Math.random() * 0xffffffff));
  const type = pickType(rand, opts.type ?? "random");
  const def = TYPE_DEFS[type];
  const groupId = opts.groupId;

  const assets: GenAsset[] = [];
  const push: PushFn = (model, localX, localY, localZ, yaw, scale = 1) => {
    assets.push({
      model: DIR + model,
      category: "building",
      localX: originX + localX,
      localY: groundY + localY,
      localZ: originZ + localZ,
      yaw,
      scale,
      groupId,
    });
  };
  const pushProp: PushFn = (model, localX, localY, localZ, yaw, scale = 1) => {
    assets.push({
      model: DIR + model,
      category: "prop",
      localX: originX + localX,
      localY: groundY + localY,
      localZ: originZ + localZ,
      yaw,
      scale,
      groupId,
    });
  };

  const base = pick(rand, def.bases);
  const body = pick(rand, def.bodies);
  push(base.file, 0, 0, 0, rand() * Math.PI * 2);

  const bodyY = base.h;
  push(body.file, 0, bodyY, 0, 0);

  // Four cardinal faces of the body -- yaw is the outward-facing direction,
  // half-extent is the footprint dimension that face pushes out along.
  const faces = [
    { yaw: 0, half: body.d / 2 }, // +Z front
    { yaw: Math.PI, half: body.d / 2 }, // -Z back
    { yaw: Math.PI / 2, half: body.w / 2 }, // +X right
    { yaw: -Math.PI / 2, half: body.w / 2 }, // -X left
  ];
  const doorFace = faces[0]!;

  // Door, flush against the front face.
  const door = pick(rand, DOORS);
  {
    const out = outward(doorFace.yaw);
    const ox = out.dx * (doorFace.half + door.d / 2);
    const oz = out.dz * (doorFace.half + door.d / 2);
    push(door.file, ox, bodyY, oz, doorFace.yaw);
  }

  // Windows scattered on the non-door faces (and occasionally either side of
  // the door on the front face too) at varied heights.
  const [wMin, wMax] = def.windowCount;
  const windowCount = wMin + Math.floor(rand() * (wMax - wMin + 1));
  for (let i = 0; i < windowCount; i++) {
    const win = pick(rand, WINDOWS);
    const face = pick(rand, faces);
    const out = outward(face.yaw);
    // Offset sideways along the face so windows on the door's face don't sit
    // on top of the door itself.
    const sideT = face === doorFace ? (rand() > 0.5 ? 1 : -1) * (0.25 + rand() * 0.35) : (rand() - 0.5) * 0.6;
    const sideYaw = face.yaw + Math.PI / 2;
    const sideOut = outward(sideYaw);
    const alongFace = face === doorFace ? doorFace.half * 2 * sideT : face.half * 2 * sideT;
    const wy = bodyY + Math.min(body.h - win.h, Math.max(1, body.h * (0.25 + rand() * 0.45)));
    const wx = out.dx * (face.half + win.d / 2) + sideOut.dx * alongFace;
    const wz = out.dz * (face.half + win.d / 2) + sideOut.dz * alongFace;
    push(win.file, wx, wy, wz, face.yaw);
  }

  // Chimney poking through the roof near the ridge.
  if (def.chimney !== "none") {
    const chimney = pick(rand, def.chimney === "tall" ? CHIMNEYS_TALL : CHIMNEYS_SMALL);
    const insetX = (rand() - 0.5) * body.w * 0.4;
    const insetZ = (rand() - 0.5) * body.d * 0.4;
    push(chimney.file, insetX, bodyY + body.h - chimney.h * 0.3, insetZ, rand() * Math.PI * 2);
  }

  // Balcony on a non-door face, partway up.
  if (rand() < def.balconyChance) {
    const balcony = pick(rand, BALCONIES);
    const face = pick(rand, faces.filter((f) => f !== doorFace));
    const out = outward(face.yaw);
    const by = bodyY + body.h * 0.4;
    push(balcony.file, out.dx * (face.half + balcony.d / 2), by, out.dz * (face.half + balcony.d / 2), face.yaw);
  }

  // Exterior stairs leading up to the door (only worth it on a tall plinth).
  if (base.h > 1.5 && rand() < def.stairsChance) {
    const stairs = pick(rand, STAIRS);
    const out = outward(doorFace.yaw);
    const sx = out.dx * (doorFace.half + door.d + stairs.d / 2);
    const sz = out.dz * (doorFace.half + door.d + stairs.d / 2);
    push(stairs.file, sx, 0, sz, doorFace.yaw + Math.PI);
  }

  // Windmill sail mounted on a face away from the door, near the top.
  if (def.windmill) {
    const face = pick(rand, faces.filter((f) => f !== doorFace));
    const out = outward(face.yaw);
    const sailY = bodyY + body.h * (0.55 + rand() * 0.2);
    push(
      WINDMILL_SAIL.file,
      out.dx * (face.half + WINDMILL_SAIL.d / 2),
      sailY,
      out.dz * (face.half + WINDMILL_SAIL.d / 2),
      face.yaw,
    );
  }

  // Waterwheel hanging off a side face near ground level.
  if (def.watermill) {
    const face = pick(rand, faces.filter((f) => f !== doorFace));
    const out = outward(face.yaw);
    push(
      WATERWHEEL.file,
      out.dx * (face.half + WATERWHEEL.d / 2),
      bodyY,
      out.dz * (face.half + WATERWHEEL.d / 2),
      face.yaw,
    );
  }

  // A little clutter by the entrance.
  const propCount = 2 + Math.floor(rand() * 3);
  for (let i = 0; i < propCount; i++) {
    const prop = pick(rand, GROUND_PROPS);
    const out = outward(doorFace.yaw);
    const spread = (rand() - 0.5) * 4;
    const dist = doorFace.half + 2 + rand() * 2.5;
    const sideYaw = doorFace.yaw + Math.PI / 2;
    const sideOut = outward(sideYaw);
    pushProp(
      prop,
      out.dx * dist + sideOut.dx * spread,
      0,
      out.dz * dist + sideOut.dz * spread,
      rand() * Math.PI * 2,
    );
  }

  return assets;
}
