import type { RegionAsset } from "./regions";

/**
 * Procedural castle assembler for the 3d Castle Pack pieces under
 * `buildings/castle_pack/`. Dimensions come from Blender export bounds
 * (Z-up height → Y-up in Three/glTF).
 */

const DIR = "castle_pack/";

/** Wall segment length along the curtain (wall_large). */
const WALL_LEN = 12.5;
/** Round / square body storey height. */
const BODY_H_ROUND = 10.656;
const BODY_H_SQUARE = 10.304;
/** Optional plinth under the first storey. */
const BOTTOM_H_ROUND = 7.627;
const BOTTOM_H_SQUARE = 7.647;
/** Roof heights. */
const ROOF_H_CONE = 6.157;
const ROOF_H_SQUARE = 5.665;

export type CastleStyle = "round" | "square" | "random";

export type CastleSize = 1 | 2 | 3 | 4;
export type CastleHeight = 1 | 2 | 3 | 4;

export interface CastleOptions {
  seed?: number;
  /** Curtain segments per side (1=keep, 4=citadel). */
  size?: CastleSize;
  /** Tower storeys stacked above the plinth (1–4). */
  height?: CastleHeight;
  style?: CastleStyle;
  /** Include a gate on the +Z (south) wall. Default true. */
  gate?: boolean;
  groupId?: string;
}

export const CASTLE_SIZE_OPTIONS: readonly { id: CastleSize; label: string }[] = [
  { id: 1, label: "Keep (small)" },
  { id: 2, label: "Fort" },
  { id: 3, label: "Castle" },
  { id: 4, label: "Citadel" },
];

export const CASTLE_HEIGHT_OPTIONS: readonly { id: CastleHeight; label: string }[] = [
  { id: 1, label: "1 storey" },
  { id: 2, label: "2 storeys" },
  { id: 3, label: "3 storeys" },
  { id: 4, label: "4 storeys" },
];

export const CASTLE_STYLE_OPTIONS: readonly { id: CastleStyle; label: string }[] = [
  { id: "random", label: "Random style" },
  { id: "round", label: "Round towers" },
  { id: "square", label: "Square towers" },
];

type GenAsset = Omit<RegionAsset, "id">;

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

function clampSize(n: number | undefined): CastleSize {
  const v = Math.round(n ?? 2);
  return Math.max(1, Math.min(4, v)) as CastleSize;
}

function clampHeight(n: number | undefined): CastleHeight {
  const v = Math.round(n ?? 2);
  return Math.max(1, Math.min(4, v)) as CastleHeight;
}

export function resolveCastleStyle(style: CastleStyle, seed: number): "round" | "square" {
  if (style === "round" || style === "square") return style;
  return mulberry32(seed)() < 0.5 ? "round" : "square";
}

/**
 * Generate modular castle pieces centered on (originX, originZ) with feet on
 * groundY. Coordinates are local to the placement (yaw applied by the caller
 * when using a parent group, or baked by the editor when placing assets).
 */
export function generateCastleAssets(
  originX: number,
  originZ: number,
  groundY: number,
  opts: CastleOptions = {},
): GenAsset[] {
  const seed = opts.seed ?? (Math.random() * 0xffffffff) >>> 0;
  const rand = mulberry32(seed);
  const size = clampSize(opts.size ?? (1 + Math.floor(rand() * 4)) as CastleSize);
  const height = clampHeight(opts.height ?? (1 + Math.floor(rand() * 3)) as CastleHeight);
  const style = resolveCastleStyle(opts.style ?? "random", seed);
  const wantGate = opts.gate !== false;
  const groupId = opts.groupId;

  const body = style === "round" ? `${DIR}tower_round.gltf` : `${DIR}tower_square.gltf`;
  const bottom = style === "round" ? `${DIR}tower_round_bottom.gltf` : `${DIR}tower_square_bottom.gltf`;
  const bodyH = style === "round" ? BODY_H_ROUND : BODY_H_SQUARE;
  const bottomH = style === "round" ? BOTTOM_H_ROUND : BOTTOM_H_SQUARE;
  const roofPool =
    style === "round"
      ? [`${DIR}roof_cone.gltf`, `${DIR}roof_round_stone.gltf`, `${DIR}roof_round_extension.gltf`]
      : [`${DIR}roof_square.gltf`, `${DIR}roof_square_hollow.gltf`, `${DIR}roof_square_block.gltf`];
  const roof = pick(rand, roofPool);
  const roofH =
    roof.includes("roof_cone") || roof.includes("roof_square.gltf") || roof.includes("hollow")
      ? style === "round"
        ? ROOF_H_CONE
        : ROOF_H_SQUARE
      : style === "round"
        ? 1.28
        : 1.51;
  const wallModel = `${DIR}wall_large.gltf`;
  const wallAlt = `${DIR}wall_shoot.gltf`;
  const gateModel = size >= 3 ? `${DIR}gate.gltf` : `${DIR}gate_small.gltf`;

  // Edge length between adjacent tower centers.
  const edge = size * WALL_LEN;
  const half = edge / 2;
  const corners: { x: number; z: number }[] = [
    { x: -half, z: -half },
    { x: half, z: -half },
    { x: half, z: half },
    { x: -half, z: half },
  ];

  const out: GenAsset[] = [];
  const push = (model: string, x: number, y: number, z: number, yaw: number, scale = 1) => {
    out.push({
      model,
      category: "building",
      localX: originX + x,
      localY: groundY + y,
      localZ: originZ + z,
      yaw,
      scale,
      ...(groupId ? { groupId } : {}),
    });
  };

  // --- Corner towers ---
  for (const c of corners) {
    let y = 0;
    push(bottom, c.x, y, c.z, 0);
    y += bottomH;
    for (let storey = 0; storey < height; storey++) {
      push(body, c.x, y, c.z, (storey * Math.PI) / 2); // slight variation
      y += bodyH;
    }
    if (style === "square" && rand() > 0.4) {
      push(`${DIR}tower_square_top.gltf`, c.x, y, c.z, 0);
      y += 2.144;
    }
    push(roof, c.x, y, c.z, rand() * Math.PI * 2);
  }

  // --- Curtain walls on 4 edges (N, E, S, W). South (+Z) may host the gate. ---
  type Edge = { ax: number; az: number; bx: number; bz: number; yaw: number; south?: boolean };
  const edges: Edge[] = [
    { ax: -half, az: -half, bx: half, bz: -half, yaw: 0 }, // north (-Z), wall along +X
    { ax: half, az: -half, bx: half, bz: half, yaw: Math.PI / 2 }, // east
    { ax: half, az: half, bx: -half, bz: half, yaw: Math.PI, south: true }, // south
    { ax: -half, az: half, bx: -half, bz: -half, yaw: -Math.PI / 2 }, // west
  ];

  for (const e of edges) {
    const dx = e.bx - e.ax;
    const dz = e.bz - e.az;
    for (let i = 0; i < size; i++) {
      const t = (i + 0.5) / size;
      const x = e.ax + dx * t;
      const z = e.az + dz * t;
      const isGateSlot = Boolean(e.south && wantGate && i === Math.floor((size - 1) / 2));
      if (isGateSlot) {
        push(gateModel, x, 0, z, e.yaw);
      } else {
        const model = rand() > 0.72 ? wallAlt : wallModel;
        push(model, x, 0, z, e.yaw);
      }
    }
  }

  // Inner keep for larger castles
  if (size >= 3) {
    const keep = `${DIR}tower_small.gltf`;
    push(keep, 0, 0, 0, rand() * Math.PI * 2);
  }

  return out;
}
