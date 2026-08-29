/// <reference lib="webworker" />
import type { RegionBiome } from "@rustcraft/shared";
import type { ThumbnailSource, ThumbnailOptions } from "../ui/worldMapThumbnail";

const BIOME_FILL: Record<RegionBiome, string> = {
  grassland: "#3b6b47",
  forest: "#2a4d33",
  jungle: "#1f5438",
  desert: "#b89a5b",
  arctic: "#8ba3b8",
  swamp: "#384733",
  volcanic: "#3d2d2a",
  alien: "#5a2d6b",
  underground: "#232330",
  cosmic: "#1a2238",
};

interface LoadedTexture {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const textureCache: Record<string, LoadedTexture> = {};

let texturesPromise: Promise<void> | null = null;

async function preloadTextureWorker(key: string, url: string): Promise<void> {
  if (textureCache[key]) return;
  try {
    const origin = typeof self !== "undefined" && self.location?.origin ? self.location.origin : "";
    const fullUrl = url.startsWith("http") ? url : `${origin}${url}`;
    const res = await fetch(fullUrl);
    if (!res.ok) return;
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const cvs = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = cvs.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(bitmap, 0, 0);
    const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    textureCache[key] = {
      data: imgData.data,
      width: bitmap.width,
      height: bitmap.height,
    };
  } catch (e) {
    console.warn(`[ThumbnailWorker] Texture load error for ${key}:`, e);
  }
}

function ensureTexturesLoaded(): Promise<void> {
  if (!texturesPromise) {
    texturesPromise = Promise.all([
      preloadTextureWorker("grass", "/assets/textures/terrain/Grass001_Color.jpg"),
      preloadTextureWorker("dirt", "/assets/textures/terrain/Ground023_Color.jpg"),
      preloadTextureWorker("sand", "/assets/textures/terrain/Ground080_Color.jpg"),
      preloadTextureWorker("rock", "/assets/textures/terrain/Rock026_Color.jpg"),
      preloadTextureWorker("snow", "/assets/textures/terrain/Snow010A_Color.jpg"),
      preloadTextureWorker("cobble", "/assets/textures/terrain/PavingStones046_Color.jpg"),
      preloadTextureWorker("mud", "/assets/textures/terrain/Ground071_Color.jpg"),
      preloadTextureWorker("lava", "/assets/textures/terrain/Lava004_Color.jpg"),
      preloadTextureWorker("gravel", "/assets/textures/terrain/Gravel024_Color.jpg"),
      preloadTextureWorker("water", "/assets/textures/water/waternormals.jpg"),
    ]).then(() => undefined);
  }
  return texturesPromise;
}

// Start loading immediately
void ensureTexturesLoaded();

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h.padEnd(6, "0").slice(0, 6);
  const int = parseInt(n, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const l2 = (bx - ax) * (bx - ax) + (bz - az) * (bz - az);
  if (l2 === 0) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * (bx - ax)), pz - (az + t * (bz - az)));
}

function sampleCustomTexture(src: ThumbnailSource, fx: number, fz: number, gx: number, gz: number): number {
  const custom = src.customTextures;
  if (!custom || custom.length === 0) return 0;
  const cx = Math.max(0, Math.min(gx - 1, Math.round(fx)));
  const cz = Math.max(0, Math.min(gz - 1, Math.round(fz)));
  return custom[cz * gx + cx] ?? 0;
}

function sampleRoadBlend(src: ThumbnailSource, fx: number, fz: number, gx: number, gz: number): number {
  if (!src.roads || src.roads.length === 0) return 0;
  const pitch = src.pitch || 2.5;
  const halfX = ((gx - 1) * pitch) / 2;
  const halfZ = ((gz - 1) * pitch) / 2;
  const wx = fx * pitch - halfX;
  const wz = fz * pitch - halfZ;

  let maxBlend = 0;
  for (const road of src.roads) {
    const halfW = (road.width || 4) / 2;
    const pts = road.points;
    if (!pts || pts.length < 2) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i]!;
      const p2 = pts[i + 1]!;
      const dist = distToSegment(wx, wz, p1.x, p1.z, p2.x, p2.z);
      if (dist <= halfW + 1.8) {
        const blend = 1.0 - clamp01((dist - (halfW - 0.4)) / 2.2);
        if (blend > maxBlend) maxBlend = blend;
      }
    }
  }
  return maxBlend;
}

function sampleImageTexture(key: string, u: number, v: number): [number, number, number] | null {
  const tex = textureCache[key];
  if (!tex) return null;
  const su = Math.floor((((u % 1) + 1) % 1) * tex.width);
  const sv = Math.floor((((v % 1) + 1) % 1) * tex.height);
  const idx = (sv * tex.width + su) * 4;
  return [tex.data[idx]!, tex.data[idx + 1]!, tex.data[idx + 2]!];
}

async function renderThumbnail(src: ThumbnailSource, opts?: ThumbnailOptions): Promise<Blob | null> {
  await ensureTexturesLoaded();
  const gx = src.gridSizeX ?? src.gridSize ?? 32;
  const gz = src.gridSizeZ ?? src.gridSize ?? 32;
  const totalCells = gx * gz;
  let heights: ArrayLike<number> = src.heights ?? [];
  if (heights.length < totalCells) {
    const gen = new Float32Array(totalCells);
    for (let z = 0; z < gz; z++) {
      for (let x = 0; x < gx; x++) {
        const nx = (x / gx) * 4;
        const nz = (z / gz) * 4;
        const island = Math.sin(nx * 0.75) * Math.sin(nz * 0.75);
        const mtn1 = Math.exp(-Math.hypot(nx - 2.0, nz - 2.8) * 2.5) * 22;
        const mtn2 = Math.exp(-Math.hypot(nx - 1.4, nz - 1.2) * 2.2) * 18;
        const mtn3 = Math.exp(-Math.hypot(nx - 2.8, nz - 1.6) * 2.8) * 16;
        const valley = Math.sin(nx * 2.2 + nz * 1.5) * 4;
        gen[z * gx + x] = Math.max(-2, (mtn1 + mtn2 + mtn3 + valley + 6) * island - 1);
      }
    }
    heights = gen;
  }

  const maxDimension = Math.max(gx, gz);
  const size = Math.max(16, Math.min(opts?.edge ?? 192, 768));
  const sizeX = Math.max(16, Math.round(size * (gx / maxDimension)));
  const sizeY = Math.max(16, Math.round(size * (gz / maxDimension)));

  const canvas = new OffscreenCanvas(sizeX, sizeY);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0; i < totalCells; i++) {
    const v = heights[i] ?? 0;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = Math.max(0.001, hi - lo);

  const waterArr = src.waterHeights && src.waterHeights.length >= totalCells ? src.waterHeights : null;
  const biome = src.biome || "grassland";
  const base = hexToRgb(src.colorGrading?.groundTint ?? BIOME_FILL[biome] ?? "#3b6b47");
  const snowy = biome === "arctic";

  const sampleGrid = (arr: ArrayLike<number>, fx: number, fz: number): number => {
    const x = fx < 0 ? 0 : fx > gx - 1 ? gx - 1 : fx;
    const z = fz < 0 ? 0 : fz > gz - 1 ? gz - 1 : fz;
    const x0 = Math.floor(x),
      z0 = Math.floor(z);
    const x1 = Math.min(gx - 1, x0 + 1);
    const z1 = Math.min(gz - 1, z0 + 1);
    const tx = x - x0,
      tz = z - z0;
    const a = arr[z0 * gx + x0]! + (arr[z0 * gx + x1]! - arr[z0 * gx + x0]!) * tx;
    const b = arr[z1 * gx + x0]! + (arr[z1 * gx + x1]! - arr[z1 * gx + x0]!) * tx;
    return a + (b - a) * tz;
  };
  const H = (fx: number, fz: number): number => sampleGrid(heights, fx, fz);

  const relief = 3.5;
  const lx = -1.2,
    ly = 2.2,
    lz = 1.0;
  const ll = Math.hypot(lx, ly, lz);
  const gstep = 0.5;

  const img = ctx.createImageData(sizeX, sizeY);
  const data = img.data;
  const pitch = src.pitch || 2.5;

  for (let py = 0; py < sizeY; py++) {
    const fz = (1 - py / (sizeY - 1)) * (gz - 1);
    for (let px = 0; px < sizeX; px++) {
      const fx = (px / (sizeX - 1)) * (gx - 1);
      const h = H(fx, fz);

      const dhx = (H(fx + gstep, fz) - H(fx - gstep, fz)) / (2 * gstep);
      const dhz = (H(fx, fz + gstep) - H(fx, fz - gstep)) / (2 * gstep);
      const slope = Math.hypot(dhx, dhz) / pitch;

      let r = 0,
        g = 0,
        b = 0;

      const u = (fx * pitch) / 16;
      const v = (fz * pitch) / 16;

      const grassTex = sampleImageTexture("grass", u, v);
      const sandTex = sampleImageTexture("sand", u, v);
      const rockTex = sampleImageTexture("rock", u, v);

      const customTex = sampleCustomTexture(src, fx, fz, gx, gz);
      const roadBlend = sampleRoadBlend(src, fx, fz, gx, gz);
      const waterDepth = waterArr ? sampleGrid(waterArr, fx, fz) : 0;

      if (h <= 0 || waterDepth > 0.05) {
        const wd = waterDepth > 0.05 ? waterDepth : -h;
        const depth = clamp01(wd / 4.5);
        const shallowCyan = [40, 180, 215];
        const deepOcean = [8, 16, 30];
        const tDepth = Math.pow(depth, 0.5);
        r = mix(shallowCyan[0]!, deepOcean[0]!, tDepth);
        g = mix(shallowCyan[1]!, deepOcean[1]!, tDepth);
        b = mix(shallowCyan[2]!, deepOcean[2]!, tDepth);

        if (wd < 0.5) {
          const foam = (1.0 - wd / 0.5) * 0.75;
          r = mix(r, 240, foam);
          g = mix(g, 250, foam);
          b = mix(b, 255, foam);
        }
      } else {
        let customTexKey = "";
        if (customTex === 1) customTexKey = "grass";
        else if (customTex === 2) customTexKey = "dirt";
        else if (customTex === 3) customTexKey = "cobble";
        else if (customTex === 4) customTexKey = "snow";
        else if (customTex === 5) customTexKey = "rock";
        else if (customTex === 6) customTexKey = "sand";
        else if (customTex === 7) customTexKey = "mud";
        else if (customTex === 8) customTexKey = "lava";
        else if (customTex === 9) customTexKey = "gravel";

        if (customTexKey) {
          const painted = sampleImageTexture(customTexKey, u, v);
          if (painted) {
            r = painted[0];
            g = painted[1];
            b = painted[2];
          }
        } else {
          const rockSlope = clamp01((slope - 0.42) / 0.32);
          const alpineRock = clamp01((h - 35) / 30);
          const alpineSnow = clamp01((h - 60) / 20);
          const effectiveRock = Math.max(rockSlope * 0.9, alpineRock);

          if (biome === "desert") {
            const sandVal = sandTex ? sandTex[0] / 255 : 0.95;
            r = mix(230 * sandVal, 160, effectiveRock);
            g = mix(205 * sandVal, 145, effectiveRock);
            b = mix(150 * sandVal, 130, effectiveRock);
          } else if (snowy) {
            r = mix(235, 175, effectiveRock);
            g = mix(245, 180, effectiveRock);
            b = mix(255, 190, effectiveRock);
          } else if (biome === "volcanic") {
            r = mix(55, 120, effectiveRock);
            g = mix(40, 70, effectiveRock);
            b = mix(35, 55, effectiveRock);
          } else if (biome === "swamp") {
            r = mix(65, 95, effectiveRock);
            g = mix(85, 90, effectiveRock);
            b = mix(60, 80, effectiveRock);
          } else {
            const grassR = grassTex ? mix(grassTex[0] * 0.85, base[0], 0.5) : base[0];
            const grassG = grassTex ? mix(grassTex[1] * 0.85, base[1], 0.5) : base[1];
            const grassB = grassTex ? mix(grassTex[2] * 0.85, base[2], 0.5) : base[2];

            const rockR = rockTex ? rockTex[0] : 130;
            const rockG = rockTex ? rockTex[1] : 125;
            const rockB = rockTex ? rockTex[2] : 118;

            r = mix(grassR, rockR, effectiveRock);
            g = mix(grassG, rockG, effectiveRock);
            b = mix(grassB, rockB, effectiveRock);

            if (alpineSnow > 0) {
              r = mix(r, 245, alpineSnow);
              g = mix(g, 250, alpineSnow);
              b = mix(b, 255, alpineSnow);
            }
          }

          // Coastal beach sand blend
          if (h < 1.8 && !snowy && biome !== "desert") {
            const tBeach = clamp01((1.8 - h) / 1.8);
            const sandR = sandTex ? sandTex[0] : 222;
            const sandG = sandTex ? sandTex[1] : 196;
            const sandB = sandTex ? sandTex[2] : 142;
            r = mix(r, sandR, tBeach * 0.85);
            g = mix(g, sandG, tBeach * 0.85);
            b = mix(b, sandB, tBeach * 0.85);
          }
        }

        if (roadBlend > 0) {
          const dirtSample = sampleImageTexture("dirt", u, v) ?? [160, 130, 95];
          r = mix(r, dirtSample[0], roadBlend * 0.9);
          g = mix(g, dirtSample[1], roadBlend * 0.9);
          b = mix(b, dirtSample[2], roadBlend * 0.9);
        }
      }

      // Hillshading with 3D normal vector
      const nx = -dhx * relief;
      const ny = 1.0;
      const nz = -dhz * relief;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const dot = (nx * lx + ny * ly + nz * lz) / (nl * ll);
      const direct = clamp01(dot);
      const ambient = 0.58;
      const shade = clamp01(ambient + 0.62 * direct);

      const o = (py * sizeX + px) * 4;
      data[o] = clamp01((r * shade) / 255) * 255;
      data[o + 1] = clamp01((g * shade) / 255) * 255;
      data[o + 2] = clamp01((b * shade) / 255) * 255;
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  if (src.roads && src.roads.length > 0) {
    const halfX = (gx * pitch) / 2;
    const halfZ = (gz * pitch) / 2;
    const worldToCanvas = (wx: number, wz: number): [number, number] => {
      const px = ((wx + halfX) / (gx * pitch)) * sizeX;
      const py = (1 - (wz + halfZ) / (gz * pitch)) * sizeY;
      return [clamp01(px / sizeX) * sizeX, clamp01(py / sizeY) * sizeY];
    };

    ctx.lineWidth = Math.max(2, sizeX / 80);
    ctx.strokeStyle = "rgba(180, 140, 85, 0.85)";
    for (const road of src.roads) {
      if (!road.points || road.points.length < 2) continue;
      ctx.beginPath();
      const p0 = worldToCanvas(road.points[0]!.x, road.points[0]!.z);
      ctx.moveTo(p0[0], p0[1]);
      for (let i = 1; i < road.points.length; i++) {
        const pt = worldToCanvas(road.points[i]!.x, road.points[i]!.z);
        ctx.lineTo(pt[0], pt[1]);
      }
      ctx.stroke();
    }
  }

  return canvas.convertToBlob({ type: "image/png" });
}

async function renderLandMask(src: ThumbnailSource, opts?: ThumbnailOptions): Promise<Blob | null> {
  const gx = src.gridSizeX ?? src.gridSize ?? 32;
  const gz = src.gridSizeZ ?? src.gridSize ?? 32;
  const totalCells = gx * gz;
  const heights = src.heights ?? [];
  if (heights.length < totalCells) return null;

  const maxDimension = Math.max(gx, gz);
  const size = Math.max(16, Math.min(opts?.edge ?? 192, 768));
  const sizeX = Math.max(16, Math.round(size * (gx / maxDimension)));
  const sizeY = Math.max(16, Math.round(size * (gz / maxDimension)));

  const canvas = new OffscreenCanvas(sizeX, sizeY);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const waterArr = src.waterHeights && src.waterHeights.length >= totalCells ? src.waterHeights : null;

  const sampleGrid = (arr: ArrayLike<number>, fx: number, fz: number): number => {
    const x = fx < 0 ? 0 : fx > gx - 1 ? gx - 1 : fx;
    const z = fz < 0 ? 0 : fz > gz - 1 ? gz - 1 : fz;
    const x0 = Math.floor(x),
      z0 = Math.floor(z);
    const x1 = Math.min(gx - 1, x0 + 1);
    const z1 = Math.min(gz - 1, z0 + 1);
    const tx = x - x0,
      tz = z - z0;
    const a = arr[z0 * gx + x0]! + (arr[z0 * gx + x1]! - arr[z0 * gx + x0]!) * tx;
    const b = arr[z1 * gx + x0]! + (arr[z1 * gx + x1]! - arr[z1 * gx + x0]!) * tx;
    return a + (b - a) * tz;
  };

  const img = ctx.createImageData(sizeX, sizeY);
  const data = img.data;

  for (let py = 0; py < sizeY; py++) {
    const fz = (1 - py / (sizeY - 1)) * (gz - 1);
    for (let px = 0; px < sizeX; px++) {
      const fx = (px / (sizeX - 1)) * (gx - 1);
      const h = sampleGrid(heights, fx, fz);
      const wd = waterArr ? sampleGrid(waterArr, fx, fz) : 0;

      const isDryLand = h > 0.05 && wd <= 0.05;
      const idx = (py * sizeX + px) * 4;

      if (isDryLand) {
        data[idx] = 255;
        data[idx + 1] = 235;
        data[idx + 2] = 160;
        data[idx + 3] = 255;
      } else {
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0;
      }
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

function drawPainterlyStroke(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  len: number,
  width: number,
  angleRad: number,
  r: number,
  g: number,
  b: number,
  alpha: number = 0.85,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angleRad);

  ctx.fillStyle = `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha * 0.75})`;
  ctx.beginPath();
  ctx.ellipse(0, 0, Math.max(1, len / 2), Math.max(1, width / 2), 0, 0, Math.PI * 2);
  ctx.fill();

  const numBristles = Math.max(2, Math.floor(width / 3.5));
  for (let i = 0; i < numBristles; i++) {
    const offset = ((i / (numBristles - 1)) - 0.5) * width * 0.75;
    const toneJitter = (i % 2 === 0 ? 1 : -1) * 16;
    const br = Math.max(0, Math.min(255, Math.round(r + toneJitter)));
    const bg = Math.max(0, Math.min(255, Math.round(g + toneJitter)));
    const bb = Math.max(0, Math.min(255, Math.round(b + toneJitter)));
    ctx.strokeStyle = `rgba(${br}, ${bg}, ${bb}, ${alpha * 0.4})`;
    ctx.lineWidth = Math.max(1, width / 4.5);
    ctx.beginPath();
    ctx.moveTo(-len * 0.42, offset);
    ctx.lineTo(len * 0.42, offset);
    ctx.stroke();
  }
  ctx.restore();
}

async function renderArtistMap(src: ThumbnailSource, opts?: ThumbnailOptions): Promise<Blob | null> {
  const gx = src.gridSizeX ?? src.gridSize ?? 32;
  const gz = src.gridSizeZ ?? src.gridSize ?? 32;
  const totalCells = gx * gz;
  const heights = src.heights ?? [];
  if (heights.length < totalCells) return null;

  const maxDimension = Math.max(gx, gz);
  const size = Math.max(32, Math.min(opts?.edge ?? 512, 768));
  const sizeX = Math.max(32, Math.round(size * (gx / maxDimension)));
  const sizeY = Math.max(32, Math.round(size * (gz / maxDimension)));
  const pitch = src.pitch || 2.5;

  const canvas = new OffscreenCanvas(sizeX, sizeY);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const waterArr = src.waterHeights && src.waterHeights.length >= totalCells ? src.waterHeights : null;
  const biome = src.biome || "grassland";

  const sampleGrid = (arr: ArrayLike<number>, fx: number, fz: number): number => {
    const x = fx < 0 ? 0 : fx > gx - 1 ? gx - 1 : fx;
    const z = fz < 0 ? 0 : fz > gz - 1 ? gz - 1 : fz;
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const x1 = Math.min(gx - 1, x0 + 1);
    const z1 = Math.min(gz - 1, z0 + 1);
    const tx = x - x0, tz = z - z0;
    const a = arr[z0 * gx + x0]! + (arr[z0 * gx + x1]! - arr[z0 * gx + x0]!) * tx;
    const b = arr[z1 * gx + x0]! + (arr[z1 * gx + x1]! - arr[z1 * gx + x0]!) * tx;
    return a + (b - a) * tz;
  };

  // 1. Primed Canvas Undertone with subtle texture
  ctx.fillStyle = "#edd9bc";
  ctx.fillRect(0, 0, sizeX, sizeY);

  ctx.fillStyle = "rgba(120, 90, 60, 0.05)";
  for (let ly = 0; ly < sizeY; ly += 4) {
    ctx.fillRect(0, ly, sizeX, 1);
  }
  for (let lx = 0; lx < sizeX; lx += 4) {
    ctx.fillRect(lx, 0, 1, sizeY);
  }

  const halfX = (gx * pitch) / 2;
  const halfZ = (gz * pitch) / 2;
  const worldToCanvas = (wx: number, wz: number): [number, number] => {
    const px = ((wx + halfX) / (gx * pitch)) * sizeX;
    const py = (1 - (wz + halfZ) / (gz * pitch)) * sizeY;
    return [clamp01(px / sizeX) * sizeX, clamp01(py / sizeY) * sizeY];
  };

  const getImpressionColor = (h: number, wd: number, slope: number, fx: number, fz: number): [number, number, number] => {
    const isWater = h <= 0 || wd > 0.05;
    if (isWater) {
      const depth = clamp01((wd > 0.05 ? wd : -h) / 5.0);
      if (depth < 0.18) {
        return [72, 168, 178];
      } else if (depth < 0.55) {
        return [45, 102, 160];
      } else {
        return [28, 52, 98];
      }
    }

    let r = 136, g = 172, b = 82;

    if (h > 42) {
      r = 246; g = 244; b = 238;
    } else if (h > 18 || slope > 0.38) {
      if (slope > 0.45) { r = 98; g = 76; b = 70; }
      else { r = 142; g = 116; b = 92; }
    } else if (biome === "desert") {
      if (h < 2.5) { r = 235; g = 204; b = 138; }
      else { r = 216; g = 175; b = 110; }
    } else if (biome === "arctic") {
      r = 222; g = 226; b = 224;
    } else if (biome === "volcanic") {
      r = 92; g = 70; b = 62;
    } else if (biome === "swamp") {
      r = 118; g = 136; b = 96;
    } else if (biome === "forest" || biome === "jungle") {
      if (h > 8) { r = 74; g = 122; b = 62; }
      else { r = 92; g = 142; b = 72; }
    } else {
      if (h < 2.0) { r = 218; g = 194; b = 142; }
      else if (h > 8.0) { r = 178; g = 162; b = 92; }
      else { r = 136; g = 172; b = 82; }
    }
    return [r, g, b];
  };

  // 2. LAYER 1: Broad Impressionist Underpainting Strokes
  const stepBroad = Math.max(12, Math.floor(sizeX / 24));
  for (let py = 0; py < sizeY + stepBroad; py += stepBroad) {
    for (let px = 0; px < sizeX + stepBroad; px += stepBroad) {
      const jx = px + ((Math.sin(px * 3.7 + py * 7.1) * 43758.5) % stepBroad) * 0.75;
      const jy = py + ((Math.cos(px * 9.2 + py * 4.3) * 43758.5) % stepBroad) * 0.75;

      const fz = (1 - clamp01(jy / sizeY)) * (gz - 1);
      const fx = clamp01(jx / sizeX) * (gx - 1);
      const h = sampleGrid(heights, fx, fz);
      const wd = waterArr ? sampleGrid(waterArr, fx, fz) : 0;
      const [r, g, b] = getImpressionColor(h, wd, 0.1, fx, fz);

      const angle = -0.55 + ((Math.sin(jx * 0.05 + jy * 0.05) * 0.35));
      const len = stepBroad * 2.2;
      const wid = stepBroad * 1.3;
      drawPainterlyStroke(ctx, jx, jy, len, wid, angle, r, g, b, 0.75);
    }
  }

  // 3. LAYER 2: Mid-Tier Directional Brushstrokes (Terrain Form & Contours)
  const stepMid = Math.max(6, Math.floor(sizeX / 48));
  for (let py = 0; py < sizeY + stepMid; py += stepMid) {
    for (let px = 0; px < sizeX + stepMid; px += stepMid) {
      const jx = px + ((Math.sin(px * 11.2 + py * 13.7) * 43758.5) % stepMid) * 0.7;
      const jy = py + ((Math.cos(px * 17.1 + py * 5.9) * 43758.5) % stepMid) * 0.7;

      const fz = (1 - clamp01(jy / sizeY)) * (gz - 1);
      const fx = clamp01(jx / sizeX) * (gx - 1);
      const h = sampleGrid(heights, fx, fz);
      const wd = waterArr ? sampleGrid(waterArr, fx, fz) : 0;

      const hR = sampleGrid(heights, Math.min(gx - 1, fx + 1), fz);
      const hL = sampleGrid(heights, Math.max(0, fx - 1), fz);
      const hU = sampleGrid(heights, fx, Math.min(gz - 1, fz + 1));
      const hD = sampleGrid(heights, fx, Math.max(0, fz - 1));
      const dhx = (hR - hL) / (2 * pitch);
      const dhz = (hU - hD) / (2 * pitch);
      const slope = Math.hypot(dhx, dhz);

      let [r, g, b] = getImpressionColor(h, wd, slope, fx, fz);

      let strokeAngle = -0.5;
      if (slope > 0.15) {
        strokeAngle = Math.atan2(-dhx, dhz);
      }

      const isSunlit = (-dhx + dhz) > 0.1;
      if (h > 0 && wd <= 0.05) {
        if (isSunlit) {
          r = Math.min(255, r + 24);
          g = Math.min(255, g + 20);
        } else if (slope > 0.25) {
          r = Math.max(0, r - 22);
          g = Math.max(0, g - 18);
          b = Math.min(255, b + 15);
        }
      }

      const len = stepMid * 2.1;
      const wid = stepMid * 1.1;
      drawPainterlyStroke(ctx, jx, jy, len, wid, strokeAngle, r, g, b, 0.8);
    }
  }

  // 4. LAYER 3: Impasto Palette-Knife Mountain Crests
  const stepPeak = Math.max(4, Math.floor(gx / 32));
  for (let cz = 1; cz < gz - 1; cz += stepPeak) {
    for (let cx = 1; cx < gx - 1; cx += stepPeak) {
      const h = heights[cz * gx + cx] ?? 0;
      const wd = waterArr ? waterArr[cz * gx + cx] ?? 0 : 0;
      if (h > 14 && wd <= 0.05) {
        const wx = cx * pitch - halfX;
        const wz = cz * pitch - halfZ;
        const [cpx, cpy] = worldToCanvas(wx, wz);

        const mSize = Math.min(24, Math.max(8, (h / 42) * 20));
        drawPainterlyStroke(ctx, cpx, cpy, mSize * 1.5, mSize * 0.6, -0.65, 185, 145, 110, 0.9);
        drawPainterlyStroke(ctx, cpx - 2, cpy - 2, mSize * 0.9, mSize * 0.4, -0.65, 252, 248, 238, 0.95);
        drawPainterlyStroke(ctx, cpx + 3, cpy + 2, mSize * 0.8, mSize * 0.35, -0.35, 78, 62, 72, 0.85);
      }
    }
  }

  // 5. LAYER 4: Expressive Foliage / Tree Dab Clusters
  if (src.assets && src.assets.length > 0) {
    const maxFoliage = 160;
    let count = 0;
    for (const asset of src.assets) {
      if (asset.category !== "foliage" || !asset.model.includes("tree")) continue;
      if (++count > maxFoliage) break;
      const [tpx, tpy] = worldToCanvas(asset.localX, asset.localZ);

      drawPainterlyStroke(ctx, tpx, tpy, 9, 7, 0, 36, 68, 38, 0.9);
      drawPainterlyStroke(ctx, tpx - 1, tpy - 2, 7, 5, -0.4, 92, 154, 64, 0.95);
    }
  }

  // 6. LAYER 5: Sweeping Road & Path Ribbon Strokes
  if (src.roads && src.roads.length > 0) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const road of src.roads) {
      if (!road.points || road.points.length < 2) continue;
      ctx.strokeStyle = "rgba(164, 115, 68, 0.75)";
      ctx.lineWidth = Math.max(3, sizeX / 65);
      ctx.beginPath();
      const p0 = worldToCanvas(road.points[0]!.x, road.points[0]!.z);
      ctx.moveTo(p0[0], p0[1]);
      for (let i = 1; i < road.points.length; i++) {
        const pt = worldToCanvas(road.points[i]!.x, road.points[i]!.z);
        ctx.lineTo(pt[0], pt[1]);
      }
      ctx.stroke();

      ctx.strokeStyle = "rgba(224, 185, 130, 0.85)";
      ctx.lineWidth = Math.max(1.5, sizeX / 110);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 7. LAYER 6: Impressionist Village & Settlement Marks
  if (src.villages && src.villages.length > 0) {
    for (const v of src.villages) {
      const [vpx, vpy] = worldToCanvas(v.localX, v.localZ);
      drawPainterlyStroke(ctx, vpx - 2, vpy, 12, 8, -0.2, 195, 65, 45, 0.95);
      drawPainterlyStroke(ctx, vpx + 3, vpy - 2, 10, 6, 0.4, 210, 85, 50, 0.95);
      drawPainterlyStroke(ctx, vpx, vpy, 4, 4, 0, 255, 220, 110, 0.98);
    }
  }

  // Seamless edge blend (no harsh per-tile vignette, so adjacent tiles connect into 1 continuous map)
  return canvas.convertToBlob({ type: "image/png" });
}

interface InMsg {
  reqId: number;
  kind: "thumbnail" | "mask" | "artist";
  src: ThumbnailSource;
  opts?: ThumbnailOptions;
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const { reqId, kind, src, opts } = e.data;
  try {
    const blob =
      kind === "mask"
        ? await renderLandMask(src, opts)
        : kind === "artist"
          ? await renderArtistMap(src, opts)
          : await renderThumbnail(src, opts);
    (self as unknown as Worker).postMessage({ reqId, blob });
  } catch (err) {
    (self as unknown as Worker).postMessage({ reqId, blob: null, error: String(err) });
  }
};
