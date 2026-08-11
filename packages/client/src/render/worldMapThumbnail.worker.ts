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
      preloadTextureWorker("grass", "/assets/textures/terrain/grass.jpg"),
      preloadTextureWorker("dirt", "/assets/textures/terrain/dirt.jpg"),
      preloadTextureWorker("sand", "/assets/textures/terrain/sand.jpg"),
      preloadTextureWorker("rock", "/assets/textures/terrain/rock.jpg"),
      preloadTextureWorker("snow", "/assets/textures/terrain/snow.jpg"),
      preloadTextureWorker("cobble", "/assets/textures/terrain/cobble.png"),
      preloadTextureWorker("water", "/assets/textures/water/water_normal.jpg"),
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

function sampleCustomTexture(src: ThumbnailSource, fx: number, fz: number): number {
  const custom = src.customTextures;
  if (!custom || custom.length === 0) return 0;
  const N = src.gridSize || 32;
  const cx = Math.max(0, Math.min(N - 1, Math.round(fx)));
  const cz = Math.max(0, Math.min(N - 1, Math.round(fz)));
  return custom[cz * N + cx] ?? 0;
}

function sampleRoadBlend(src: ThumbnailSource, fx: number, fz: number): number {
  if (!src.roads || src.roads.length === 0) return 0;
  const pitch = src.pitch || 2;
  const N = src.gridSize || 32;
  const originOffset = ((N - 1) * pitch) / 2;
  const wx = fx * pitch - originOffset;
  const wz = fz * pitch - originOffset;

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
  const N = Math.max(16, src.gridSize || 32);
  let heights: ArrayLike<number> = src.heights ?? [];
  if (heights.length < N * N) {
    const gen = new Float32Array(N * N);
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        const nx = (x / N) * 4;
        const nz = (z / N) * 4;
        const island = Math.sin(nx * 0.75) * Math.sin(nz * 0.75);
        const mtn1 = Math.exp(-Math.hypot(nx - 2.0, nz - 2.8) * 2.5) * 22;
        const mtn2 = Math.exp(-Math.hypot(nx - 1.4, nz - 1.2) * 2.2) * 18;
        const mtn3 = Math.exp(-Math.hypot(nx - 2.8, nz - 1.6) * 2.8) * 16;
        const valley = Math.sin(nx * 2.2 + nz * 1.5) * 4;
        gen[z * N + x] = Math.max(-2, (mtn1 + mtn2 + mtn3 + valley + 6) * island - 1);
      }
    }
    heights = gen;
  }

  const size = Math.max(16, Math.min(opts?.edge ?? 192, 768));
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  let lo = Infinity,
    hi = -Infinity;
  for (let i = 0; i < N * N; i++) {
    const v = heights[i] ?? 0;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = Math.max(0.001, hi - lo);

  const waterArr = src.waterHeights && src.waterHeights.length >= N * N ? src.waterHeights : null;
  const biome = src.biome || "grassland";
  const base = hexToRgb(src.colorGrading?.groundTint ?? BIOME_FILL[biome] ?? "#3b6b47");
  const snowy = biome === "arctic";

  const sampleGrid = (arr: ArrayLike<number>, fx: number, fz: number): number => {
    const x = fx < 0 ? 0 : fx > N - 1 ? N - 1 : fx;
    const z = fz < 0 ? 0 : fz > N - 1 ? N - 1 : fz;
    const x0 = Math.floor(x),
      z0 = Math.floor(z);
    const x1 = x0 + 1 > N - 1 ? N - 1 : x0 + 1;
    const z1 = z0 + 1 > N - 1 ? N - 1 : z0 + 1;
    const tx = x - x0,
      tz = z - z0;
    const a = arr[z0 * N + x0]! + (arr[z0 * N + x1]! - arr[z0 * N + x0]!) * tx;
    const b = arr[z1 * N + x0]! + (arr[z1 * N + x1]! - arr[z1 * N + x0]!) * tx;
    return a + (b - a) * tz;
  };
  const H = (fx: number, fz: number): number => sampleGrid(heights, fx, fz);

  const relief = 2.5;
  const lx = -1,
    ly = 2,
    lz = 1;
  const ll = Math.hypot(lx, ly, lz);
  const gstep = 0.5;

  const img = ctx.createImageData(size, size);
  const data = img.data;
  const contourSteps = 12;

  for (let py = 0; py < size; py++) {
    const fz = (1 - py / (size - 1)) * (N - 1);
    for (let px = 0; px < size; px++) {
      const fx = (px / (size - 1)) * (N - 1);
      const h = H(fx, fz);
      const t = clamp01((h - lo) / span);

      const contourFrac = (t * contourSteps) % 1;
      const isContour = contourFrac < 0.08;

      let r = 0,
        g = 0,
        b = 0;

      const pitch = src.pitch || 2;
      const u = (fx * pitch) / 16;
      const v = (fz * pitch) / 16;
      const tx = fx * pitch * 0.3;
      const tz = fz * pitch * 0.3;
      const n1 = Math.sin(tx * 0.85) * Math.cos(tz * 0.85);
      const n2 = Math.sin(tx * 2.4 + 1.2) * Math.sin(tz * 2.4 + 0.8);
      const n3 = Math.cos(tx * 5.2) * Math.sin(tz * 5.2);

      const grassTex = sampleImageTexture("grass", u, v);
      const sandTex = sampleImageTexture("sand", u, v);
      const rockTex = sampleImageTexture("rock", u, v);
      const snowTex = sampleImageTexture("snow", u, v);
      const waterTex = sampleImageTexture("water", u * 2, v * 2);

      const customTex = sampleCustomTexture(src, fx, fz);
      const roadBlend = sampleRoadBlend(src, fx, fz);

      if (h <= 0) {
        const depth = clamp01(-h / 3.5);
        const shallowCyan = [158, 242, 255];
        const deepOcean = [10, 36, 68];

        const tDepth = Math.pow(depth, 0.6);
        r = mix(shallowCyan[0]!, deepOcean[0]!, tDepth);
        g = mix(shallowCyan[1]!, deepOcean[1]!, tDepth);
        b = mix(shallowCyan[2]!, deepOcean[2]!, tDepth);

        const caustics = waterTex ? (waterTex[0] + waterTex[1]) / 510 : clamp01((n1 + n2) * 0.5 + 0.5);
        if (depth < 0.5) {
          const causticGlow = (1.0 - depth * 2.0) * caustics * 35;
          r = Math.min(255, r + causticGlow);
          g = Math.min(255, g + causticGlow);
          b = Math.min(255, b + causticGlow);
        }

        const waveDist = Math.abs(h);
        if (waveDist < 0.45) {
          const edgeFoam = (1.0 - waveDist / 0.45) * 0.75;
          r = mix(r, 255, edgeFoam);
          g = mix(g, 255, edgeFoam);
          b = mix(b, 255, edgeFoam);
        }
      } else {
        let customTexKey = "";
        if (customTex === 1) customTexKey = "grass";
        else if (customTex === 2) customTexKey = "dirt";
        else if (customTex === 3) customTexKey = "cobble";
        else if (customTex === 4) customTexKey = "snow";
        else if (customTex === 5) customTexKey = "rock";
        else if (customTex === 6) customTexKey = "sand";

        if (customTexKey) {
          const painted = sampleImageTexture(customTexKey, u, v);
          if (painted) {
            if (customTexKey === "grass") {
              r = mix(painted[0] * 0.85, base[0], 0.4);
              g = mix(painted[1] * 0.85, base[1], 0.4);
              b = mix(painted[2] * 0.85, base[2], 0.4);
            } else {
              r = painted[0];
              g = painted[1];
              b = painted[2];
            }
          }
        } else {
          const isBeach = h <= 1.2 && !snowy;
          if (isBeach) {
            if (sandTex) {
              r = sandTex[0];
              g = sandTex[1];
              b = sandTex[2];
            } else {
              const sandVal = 0.88 + (n1 * 0.08 + n2 * 0.04);
              r = 224 * sandVal;
              g = 198 * sandVal;
              b = 142 * sandVal;
            }
          } else if (snowy) {
            if (snowTex) {
              r = mix(snowTex[0], 255, 0.35);
              g = mix(snowTex[1], 255, 0.35);
              b = mix(snowTex[2], 255, 0.35);
            } else {
              const snowVal = 0.94 + (n1 * 0.04 + n2 * 0.02);
              r = mix(225, 255, t) * snowVal;
              g = mix(230, 255, t) * snowVal;
              b = mix(242, 255, t) * snowVal;
            }
          } else {
            if (grassTex) {
              r = mix(grassTex[0] * 0.85, base[0], 0.4);
              g = mix(grassTex[1] * 0.85, base[1], 0.4);
              b = mix(grassTex[2] * 0.85, base[2], 0.4);
            } else {
              const grassVal = 0.82 + (n1 * 0.12 + n2 * 0.06 + n3 * 0.03);
              r = mix(base[0] * 0.65, mix(base[0], 210, 0.4), t) * grassVal;
              g = mix(base[1] * 0.65, mix(base[1], 200, 0.4), t) * grassVal;
              b = mix(base[2] * 0.65, mix(base[2], 185, 0.4), t) * grassVal;
            }
          }

          if (t > 0.55) {
            const rf = clamp01((t - 0.55) / 0.45);
            if (rockTex && !snowy) {
              r = mix(r, rockTex[0], rf * 0.85);
              g = mix(g, rockTex[1], rf * 0.85);
              b = mix(b, rockTex[2], rf * 0.85);
            } else {
              const rockVal = 0.76 + (n1 * 0.16 + n2 * 0.08);
              const rock = snowy ? [190, 195, 205] : [135 * rockVal, 128 * rockVal, 120 * rockVal];
              r = mix(r, rock[0]!, rf);
              g = mix(g, rock[1]!, rf);
              b = mix(b, rock[2]!, rf);
            }
          }
        }

        if (roadBlend > 0) {
          const dirtSample = sampleImageTexture("dirt", u, v) ?? [160, 130, 95];
          r = mix(r, dirtSample[0], roadBlend * 0.9);
          g = mix(g, dirtSample[1], roadBlend * 0.9);
          b = mix(b, dirtSample[2], roadBlend * 0.9);
        }
      }

      if (waterArr && h > 0) {
        const wd = sampleGrid(waterArr, fx, fz);
        if (wd > 0.05) {
          const shallowCyan = [158, 242, 255];
          const deepWater = [15, 55, 105];
          const depthRatio = Math.min(1.0, Math.pow(wd / 2.5, 0.6));
          const wr = mix(shallowCyan[0]!, deepWater[0]!, depthRatio);
          const wg = mix(shallowCyan[1]!, deepWater[1]!, depthRatio);
          const wb = mix(shallowCyan[2]!, deepWater[2]!, depthRatio);
          const m = mix(0.7, 0.95, clamp01(wd / 4));
          r = mix(r, wr, m);
          g = mix(g, wg, m);
          b = mix(b, wb, m);

          const caustics = clamp01((n1 + n2) * 0.5 + 0.5) * 30 * (1.0 - depthRatio);
          r = Math.min(255, r + caustics);
          g = Math.min(255, g + caustics);
          b = Math.min(255, b + caustics);
        }
      }

      const dhx = H(fx + gstep, fz) - H(fx - gstep, fz);
      const dhz = H(fx, fz + gstep) - H(fx, fz - gstep);
      const nx = -dhx * relief;
      const ny = 2 * gstep;
      const nz = -dhz * relief;
      const nl = Math.hypot(nx, ny, nz) || 1;
      const dot = (nx * lx + ny * ly + nz * lz) / (nl * ll);
      let shade = clamp01(0.65 + 0.85 * dot) + 0.12;

      if (isContour && h > 0) {
        shade *= 0.82;
      }

      let edgeAlpha = 1.0;
      if (h <= 0) {
        const marginX = Math.min(px, size - 1 - px) / (size * 0.06);
        const marginY = Math.min(py, size - 1 - py) / (size * 0.06);
        const margin = Math.min(1.0, Math.min(marginX, marginY));
        edgeAlpha = Math.pow(margin, 0.7);
      }

      const o = (py * size + px) * 4;
      data[o] = clamp01((r * shade) / 255) * 255;
      data[o + 1] = clamp01((g * shade) / 255) * 255;
      data[o + 2] = clamp01((b * shade) / 255) * 255;
      data[o + 3] = Math.round(edgeAlpha * 255);
    }
  }
  ctx.putImageData(img, 0, 0);

  const halfSpan = (N * src.pitch) / 2;
  const worldToCanvas = (lx: number, lz: number): [number, number] => {
    const px = ((lx + halfSpan) / (N * src.pitch)) * size;
    const py = (1 - (lz + halfSpan) / (N * src.pitch)) * size;
    return [clamp01(px / size) * size, clamp01(py / size) * size];
  };

  const villages = src.villages ?? [];
  const villageCoords = villages.map((v) => worldToCanvas(v.localX, v.localZ));

  if (villageCoords.length >= 2) {
    ctx.lineWidth = Math.max(3, size / 60);
    ctx.strokeStyle = "rgba(70, 48, 24, 0.85)";
    ctx.beginPath();
    ctx.moveTo(villageCoords[0]![0], villageCoords[0]![1]);
    for (let i = 1; i < villageCoords.length; i++) {
      const prev = villageCoords[i - 1]!;
      const curr = villageCoords[i]!;
      const mx = (prev[0] + curr[0]) / 2 + 10;
      const my = (prev[1] + curr[1]) / 2 - 10;
      ctx.quadraticCurveTo(mx, my, curr[0], curr[1]);
    }
    ctx.stroke();

    ctx.lineWidth = Math.max(1.5, size / 120);
    ctx.strokeStyle = "rgba(215, 175, 95, 0.95)";
    ctx.stroke();
  }

  const isVillageStructure = (localX: number, localZ: number): boolean =>
    villages.some((v) => Math.hypot(localX - v.localX, localZ - v.localZ) <= v.radius + 12);
  const isHouseModel = (model: string): boolean =>
    /^building_(home_[ab]|tavern|blacksmith|church|windmill|lumbermill|tower_a|grain)\.gltf$/i.test(model);
  const houseAssets = (src.assets ?? []).filter(
    (asset) =>
      asset.category === "building" &&
      isHouseModel(asset.model) &&
      isVillageStructure(asset.localX, asset.localZ),
  );
  const proceduralHouses = (src.houses ?? []).filter((house) =>
    isVillageStructure(house.localX, house.localZ),
  );
  const houseSide = Math.max(3, Math.min(9, size / 72));
  ctx.fillStyle = "rgba(115, 119, 124, 0.94)";
  ctx.strokeStyle = "rgba(45, 48, 53, 0.9)";
  ctx.lineWidth = Math.max(0.75, size / 420);
  for (const building of [...houseAssets, ...proceduralHouses]) {
    const [x, y] = worldToCanvas(building.localX, building.localZ);
    ctx.fillRect(x - houseSide / 2, y - houseSide / 2, houseSide, houseSide);
    ctx.strokeRect(x - houseSide / 2, y - houseSide / 2, houseSide, houseSide);
  }

  for (const [vx, vy] of villageCoords) {
    ctx.fillStyle = "rgba(165, 115, 60, 0.95)";
    ctx.strokeStyle = "rgba(50, 30, 10, 0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(vx, vy, Math.max(6, size / 32), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  const drawMtnPeak = (cx: number, cy: number, w: number, h: number) => {
    ctx.strokeStyle = "rgba(60, 65, 75, 0.75)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, cy + h / 2);
    ctx.lineTo(cx, cy - h / 2);
    ctx.lineTo(cx + w / 2, cy + h / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy - h / 2);
    ctx.lineTo(cx + w * 0.2, cy + h / 2);
    ctx.stroke();
  };

  const mtnW = Math.max(12, size / 18);
  const mtnH = Math.max(10, size / 22);
  const peakThreshold = hi * 0.65;
  const step = Math.max(4, Math.floor(N / 8));

  for (let z = step; z < N - step; z += step) {
    for (let x = step; x < N - step; x += step) {
      const hVal = heights[z * N + x]!;
      if (hVal > peakThreshold) {
        const isPeak =
          hVal >= heights[(z - 1) * N + x]! &&
          hVal >= heights[(z + 1) * N + x]! &&
          hVal >= heights[z * N + (x - 1)]! &&
          hVal >= heights[z * N + (x + 1)]!;
        if (isPeak) {
          const px = (x / (N - 1)) * size;
          const py = (1 - z / (N - 1)) * size;
          drawMtnPeak(px, py, mtnW, mtnH);
        }
      }
    }
  }

  return canvas.convertToBlob({ type: "image/png" });
}

async function renderLandMask(src: ThumbnailSource, opts?: ThumbnailOptions): Promise<Blob | null> {
  const N = Math.max(16, src.gridSize || 32);
  const heights = src.heights ?? [];
  if (heights.length < N * N) return null;

  const size = Math.max(16, Math.min(opts?.edge ?? 192, 768));
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const waterArr = src.waterHeights && src.waterHeights.length >= N * N ? src.waterHeights : null;

  const sampleGrid = (arr: ArrayLike<number>, fx: number, fz: number): number => {
    const x = fx < 0 ? 0 : fx > N - 1 ? N - 1 : fx;
    const z = fz < 0 ? 0 : fz > N - 1 ? N - 1 : fz;
    const x0 = Math.floor(x),
      z0 = Math.floor(z);
    const x1 = x0 + 1 > N - 1 ? N - 1 : x0 + 1;
    const z1 = z0 + 1 > N - 1 ? N - 1 : z0 + 1;
    const tx = x - x0,
      tz = z - z0;
    const a = arr[z0 * N + x0]! + (arr[z0 * N + x1]! - arr[z0 * N + x0]!) * tx;
    const b = arr[z1 * N + x0]! + (arr[z1 * N + x1]! - arr[z1 * N + x0]!) * tx;
    return a + (b - a) * tz;
  };

  const img = ctx.createImageData(size, size);
  const data = img.data;

  for (let py = 0; py < size; py++) {
    const fz = (1 - py / (size - 1)) * (N - 1);
    for (let px = 0; px < size; px++) {
      const fx = (px / (size - 1)) * (N - 1);
      const h = sampleGrid(heights, fx, fz);
      const wd = waterArr ? sampleGrid(waterArr, fx, fz) : 0;

      const isDryLand = h > 0.05 && wd <= 0.05;
      const idx = (py * size + px) * 4;

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

interface InMsg {
  reqId: number;
  kind: "thumbnail" | "mask";
  src: ThumbnailSource;
  opts?: ThumbnailOptions;
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const { reqId, kind, src, opts } = e.data;
  try {
    const blob = kind === "mask" ? await renderLandMask(src, opts) : await renderThumbnail(src, opts);
    (self as unknown as Worker).postMessage({ reqId, blob });
  } catch (err) {
    (self as unknown as Worker).postMessage({ reqId, blob: null, error: String(err) });
  }
};
