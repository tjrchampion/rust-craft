/**
 * Painted-relief minimap thumbnails for the world map. Renders a region's
 * heightmap to a small raster — biome-tinted elevation ramp + NW hillshade +
 * water — so each tile reads as real terrain art instead of a flat polygon.
 *
 * Coordinate convention (matches sampleRegionHeight in content/regions.ts):
 * heights[cz*N + cx] with cx = west→east (0..N-1), cz = south→north (0..N-1).
 * The map tile's screen top-left is (west, north), so the thumbnail's top row
 * is north (cz = N-1) and its left column is west (cx = 0).
 */
import type { RegionBiome, RegionBlueprint } from "@rustcraft/shared";
import { BIOME_FILL } from "./worldMapModel";

export type ThumbnailSource = Pick<
  RegionBlueprint,
  "gridSize" | "pitch" | "heights" | "waterHeights" | "biome" | "colorGrading"
>;

/** Longest thumbnail edge in pixels; larger heightmaps are downsampled. */
const MAX_EDGE = 192;

/** Per-biome water tint (RGB). */
const WATER_RGB: Record<RegionBiome, [number, number, number]> = {
  grassland: [40, 96, 150],
  forest: [32, 82, 120],
  jungle: [26, 96, 108],
  desert: [58, 120, 150],
  arctic: [120, 165, 195],
  swamp: [46, 84, 70],
  volcanic: [120, 60, 40],
  alien: [70, 50, 120],
  underground: [40, 44, 66],
  cosmic: [50, 60, 130],
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = h.length === 3
    ? h.split("").map((c) => c + c).join("")
    : h.padEnd(6, "0").slice(0, 6);
  const int = parseInt(n, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Render a region thumbnail as a PNG data URL, or null when there is no usable
 * heightmap (caller keeps the flat biome fill). Cheap enough to call per region
 * when the map opens; cache the result by region id upstream.
 */
export interface ThumbnailOptions {
  /**
   * Target raster edge in pixels. The heightmap is sampled BILINEARLY at this
   * resolution, so a larger edge yields smoother, more detailed relief (crisp
   * shaded slopes instead of blocky cells) — this is the level-of-detail knob:
   * a small edge (~160) for the continent overview, a large one (~512) for the
   * region you zoom into. Clamped to [16, 768].
   */
  edge?: number;
}

/** Longest thumbnail edge for the low-detail continent-overview tier. */
export const OVERVIEW_EDGE = 176;
/** Longest thumbnail edge for the high-detail focused-region tier. */
export const DETAIL_EDGE = 512;

export function renderRegionThumbnail(src: ThumbnailSource, opts?: ThumbnailOptions): string | null {
  const N = src.gridSize;
  const heights = src.heights;
  if (!N || N < 2 || !heights || heights.length < N * N) return null;
  if (typeof document === "undefined") return null;

  const size = Math.max(16, Math.min(opts?.edge ?? MAX_EDGE, 768));
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Elevation range for normalization.
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < N * N; i++) {
    const h = heights[i]!;
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  const span = Math.max(1e-3, hi - lo);

  const base = hexToRgb(src.colorGrading?.groundTint ?? BIOME_FILL[src.biome]);
  const waterArr = src.waterHeights && src.waterHeights.length >= N * N ? src.waterHeights : null;
  const waterRgb = WATER_RGB[src.biome];
  const snowy = src.biome === "arctic";

  // Bilinear sampler over grid space fx,fz ∈ [0, N-1] (matches the runtime
  // terrain's sampleRegionHeight so detail renders read as the real surface).
  const sampleGrid = (arr: ArrayLike<number>, fx: number, fz: number): number => {
    const x = fx < 0 ? 0 : fx > N - 1 ? N - 1 : fx;
    const z = fz < 0 ? 0 : fz > N - 1 ? N - 1 : fz;
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const x1 = x0 + 1 > N - 1 ? N - 1 : x0 + 1;
    const z1 = z0 + 1 > N - 1 ? N - 1 : z0 + 1;
    const tx = x - x0, tz = z - z0;
    const a = arr[z0 * N + x0]! + (arr[z0 * N + x1]! - arr[z0 * N + x0]!) * tx;
    const b = arr[z1 * N + x0]! + (arr[z1 * N + x1]! - arr[z1 * N + x0]!) * tx;
    return a + (b - a) * tz;
  };
  const H = (fx: number, fz: number): number => sampleGrid(heights, fx, fz);

  // Light from the NW, above. Vertical exaggeration keeps low-relief legible.
  const lx = -0.6, ly = 1.0, lz = -0.6;
  const ll = Math.hypot(lx, ly, lz);
  const relief = 2.4 / Math.max(0.5, src.pitch);
  // Sample the gradient ~1 output pixel apart in grid space, so hillshade
  // stays smooth at any edge instead of quantizing to the heightmap cells.
  const gstep = Math.max(0.35, (N - 1) / (size - 1));

  const img = ctx.createImageData(size, size);
  const data = img.data;
  for (let py = 0; py < size; py++) {
    // top row (py=0) → north → fz = N-1
    const fz = (1 - py / (size - 1)) * (N - 1);
    for (let px = 0; px < size; px++) {
      const fx = (px / (size - 1)) * (N - 1);
      const h = H(fx, fz);
      const t = clamp01((h - lo) / span);

      // Elevation ramp: valleys darker, peaks lighter; peaks trend toward
      // rock/snow for a painted-relief look while keeping biome identity.
      const shadeLow = 0.68;
      let r = mix(base[0] * shadeLow, mix(base[0], snowy ? 244 : 210, 0.4), t);
      let g = mix(base[1] * shadeLow, mix(base[1], snowy ? 248 : 200, 0.4), t);
      let b = mix(base[2] * shadeLow, mix(base[2], snowy ? 255 : 190, 0.4), t);

      // Water overlay.
      if (waterArr) {
        const wd = sampleGrid(waterArr, fx, fz);
        if (wd > 0.05) {
          const m = mix(0.5, 0.82, clamp01(wd / 6));
          r = mix(r, waterRgb[0], m);
          g = mix(g, waterRgb[1], m);
          b = mix(b, waterRgb[2], m);
        }
      }

      // NW hillshade from the (interpolated) height gradient.
      const dhx = H(fx + gstep, fz) - H(fx - gstep, fz);
      const dhz = H(fx, fz + gstep) - H(fx, fz - gstep);
      const nx = -dhx * relief;
      const ny = 2 * gstep;
      const nz = -dhz * relief;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const dot = (nx * lx + ny * ly + nz * lz) / (nl * ll);
      const shade = clamp01(0.62 + 0.85 * dot) + 0.12;

      const o = (py * size + px) * 4;
      data[o] = clamp01((r * shade) / 255) * 255;
      data[o + 1] = clamp01((g * shade) / 255) * 255;
      data[o + 2] = clamp01((b * shade) / 255) * 255;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}
