/**
 * WoW-style sky presets — 24h color timelines + cloud/star layer params.
 * Regions pick a preset via RegionColorGrading.skyPreset; the client samples
 * by time-of-day and spatially blends the resulting numeric fields.
 */

export type SkyPresetId = "sunny" | "overcast" | "stormy" | "mystical";

export const SKY_PRESET_IDS: readonly SkyPresetId[] = [
  "sunny",
  "overcast",
  "stormy",
  "mystical",
] as const;

export const SKY_PRESET_LABELS: Record<SkyPresetId, string> = {
  sunny: "Sunny / Heroic",
  overcast: "Cloudy / Overcast",
  stormy: "Stormy / Apocalyptic",
  mystical: "Mystical / Arcane",
};

/** Which tiling cloud sheet to use under /assets/textures/sky/. */
export type SkyCloudSheet = "soft" | "storm";

/** One keyframe on the 24h track (t in [0,1) = fraction of day). */
export interface SkyTimelineKey {
  /** Day fraction 0..1 (0 = midnight, 0.25 = dawn, 0.5 = noon, …). */
  t: number;
  zenithColor: string;
  skyMidColor: string;
  horizonSkyColor: string;
  fogColor: string;
  sunColor: string;
  sunIntensity: number;
  ambientColor: string;
  ambientIntensity: number;
  cloudOpacity: number;
  cloudTint: string;
  cloudScroll: number;
  starOpacity: number;
  /** Sun elevation in degrees above horizon (−20..90). */
  sunElevation: number;
}

export interface SkyPresetDef {
  id: SkyPresetId;
  cloudSheet: SkyCloudSheet;
  keys: SkyTimelineKey[];
}

/** Resolved sample at a moment of day — all numeric / string fields ready to apply. */
export interface SkyTimelineSample {
  presetId: SkyPresetId;
  cloudSheet: SkyCloudSheet;
  zenithColor: string;
  skyMidColor: string;
  horizonSkyColor: string;
  fogColor: string;
  sunColor: string;
  sunIntensity: number;
  ambientColor: string;
  ambientIntensity: number;
  cloudOpacity: number;
  cloudTint: string;
  cloudScroll: number;
  starOpacity: number;
  sunElevation: number;
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Linear RGB mix of #rrggbb (or css) via simple channel lerp in sRGB space. */
function lerpHex(a: string, b: string, t: number): string {
  const pa = parseRgb(a);
  const pb = parseRgb(b);
  const r = Math.round(lerpNum(pa.r, pb.r, t));
  const g = Math.round(lerpNum(pa.g, pb.g, t));
  const bl = Math.round(lerpNum(pa.b, pb.b, t));
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

function parseRgb(c: string): { r: number; g: number; b: number } {
  const s = c.trim();
  if (s.startsWith("#") && (s.length === 7 || s.length === 4)) {
    if (s.length === 4) {
      const r = parseInt(s[1]! + s[1]!, 16);
      const g = parseInt(s[2]! + s[2]!, 16);
      const b = parseInt(s[3]! + s[3]!, 16);
      return { r, g, b };
    }
    return {
      r: parseInt(s.slice(1, 3), 16),
      g: parseInt(s.slice(3, 5), 16),
      b: parseInt(s.slice(5, 7), 16),
    };
  }
  return { r: 128, g: 160, b: 200 };
}

function wrap01(t: number): number {
  const x = t % 1;
  return x < 0 ? x + 1 : x;
}

function mixKeys(a: SkyTimelineKey, b: SkyTimelineKey, u: number): Omit<SkyTimelineSample, "presetId" | "cloudSheet"> {
  return {
    zenithColor: lerpHex(a.zenithColor, b.zenithColor, u),
    skyMidColor: lerpHex(a.skyMidColor, b.skyMidColor, u),
    horizonSkyColor: lerpHex(a.horizonSkyColor, b.horizonSkyColor, u),
    fogColor: lerpHex(a.fogColor, b.fogColor, u),
    sunColor: lerpHex(a.sunColor, b.sunColor, u),
    sunIntensity: lerpNum(a.sunIntensity, b.sunIntensity, u),
    ambientColor: lerpHex(a.ambientColor, b.ambientColor, u),
    ambientIntensity: lerpNum(a.ambientIntensity, b.ambientIntensity, u),
    cloudOpacity: lerpNum(a.cloudOpacity, b.cloudOpacity, u),
    cloudTint: lerpHex(a.cloudTint, b.cloudTint, u),
    cloudScroll: lerpNum(a.cloudScroll, b.cloudScroll, u),
    starOpacity: lerpNum(a.starOpacity, b.starOpacity, u),
    sunElevation: lerpNum(a.sunElevation, b.sunElevation, u),
  };
}

export const SKY_PRESETS: Record<SkyPresetId, SkyPresetDef> = {
  sunny: {
    id: "sunny",
    cloudSheet: "soft",
    keys: [
      {
        t: 0,
        zenithColor: "#0a1228",
        skyMidColor: "#1a2a48",
        horizonSkyColor: "#2a3040",
        fogColor: "#1e2438",
        sunColor: "#a8b8ff",
        sunIntensity: 0.15,
        ambientColor: "#405080",
        ambientIntensity: 0.35,
        cloudOpacity: 0.15,
        cloudTint: "#8a9ab8",
        cloudScroll: 0.004,
        starOpacity: 0.85,
        sunElevation: -18,
      },
      {
        t: 0.22,
        zenithColor: "#4a7ab8",
        skyMidColor: "#e8a070",
        horizonSkyColor: "#ffb090",
        fogColor: "#d8b098",
        sunColor: "#ffc090",
        sunIntensity: 0.7,
        ambientColor: "#ffd0b0",
        ambientIntensity: 0.55,
        cloudOpacity: 0.35,
        cloudTint: "#ffe0d0",
        cloudScroll: 0.008,
        starOpacity: 0.05,
        sunElevation: 8,
      },
      {
        t: 0.5,
        zenithColor: "#3a8fd9",
        skyMidColor: "#6eb4ef",
        horizonSkyColor: "#c8e0f8",
        fogColor: "#bcd9f0",
        sunColor: "#fff3d6",
        sunIntensity: 1.15,
        ambientColor: "#ffffff",
        ambientIntensity: 0.9,
        cloudOpacity: 0.4,
        cloudTint: "#ffffff",
        cloudScroll: 0.012,
        starOpacity: 0,
        sunElevation: 55,
      },
      {
        t: 0.78,
        zenithColor: "#2a4a78",
        skyMidColor: "#e87850",
        horizonSkyColor: "#ff9060",
        fogColor: "#c88870",
        sunColor: "#ffb070",
        sunIntensity: 0.65,
        ambientColor: "#ffc8a0",
        ambientIntensity: 0.5,
        cloudOpacity: 0.45,
        cloudTint: "#ffd0b8",
        cloudScroll: 0.008,
        starOpacity: 0.1,
        sunElevation: 6,
      },
      {
        t: 0.92,
        zenithColor: "#0c1528",
        skyMidColor: "#1a2848",
        horizonSkyColor: "#302838",
        fogColor: "#1a2030",
        sunColor: "#8898c0",
        sunIntensity: 0.2,
        ambientColor: "#384868",
        ambientIntensity: 0.38,
        cloudOpacity: 0.2,
        cloudTint: "#7888a8",
        cloudScroll: 0.005,
        starOpacity: 0.7,
        sunElevation: -12,
      },
    ],
  },
  overcast: {
    id: "overcast",
    cloudSheet: "soft",
    keys: [
      {
        t: 0,
        zenithColor: "#1a1e24",
        skyMidColor: "#2a3038",
        horizonSkyColor: "#3a4048",
        fogColor: "#2a3038",
        sunColor: "#a0a8b0",
        sunIntensity: 0.12,
        ambientColor: "#606870",
        ambientIntensity: 0.4,
        cloudOpacity: 0.75,
        cloudTint: "#687078",
        cloudScroll: 0.006,
        starOpacity: 0.15,
        sunElevation: -15,
      },
      {
        t: 0.25,
        zenithColor: "#6a7888",
        skyMidColor: "#9aa8b0",
        horizonSkyColor: "#c8c0b0",
        fogColor: "#b0b8c0",
        sunColor: "#e8e0d0",
        sunIntensity: 0.45,
        ambientColor: "#d0d4d8",
        ambientIntensity: 0.7,
        cloudOpacity: 0.85,
        cloudTint: "#d8dce0",
        cloudScroll: 0.01,
        starOpacity: 0,
        sunElevation: 12,
      },
      {
        t: 0.5,
        zenithColor: "#7a8898",
        skyMidColor: "#a8b4bc",
        horizonSkyColor: "#d0c8b8",
        fogColor: "#c0c8d0",
        sunColor: "#f0ece0",
        sunIntensity: 0.55,
        ambientColor: "#e8ecef",
        ambientIntensity: 0.85,
        cloudOpacity: 0.9,
        cloudTint: "#e8ecf0",
        cloudScroll: 0.014,
        starOpacity: 0,
        sunElevation: 40,
      },
      {
        t: 0.75,
        zenithColor: "#5a6878",
        skyMidColor: "#889098",
        horizonSkyColor: "#b8a898",
        fogColor: "#a0a8b0",
        sunColor: "#d8d0c0",
        sunIntensity: 0.4,
        ambientColor: "#c8ccd0",
        ambientIntensity: 0.65,
        cloudOpacity: 0.88,
        cloudTint: "#c8d0d8",
        cloudScroll: 0.01,
        starOpacity: 0,
        sunElevation: 10,
      },
      {
        t: 0.9,
        zenithColor: "#181c22",
        skyMidColor: "#282e36",
        horizonSkyColor: "#383840",
        fogColor: "#242830",
        sunColor: "#9098a0",
        sunIntensity: 0.14,
        ambientColor: "#505860",
        ambientIntensity: 0.42,
        cloudOpacity: 0.8,
        cloudTint: "#606870",
        cloudScroll: 0.006,
        starOpacity: 0.2,
        sunElevation: -10,
      },
    ],
  },
  stormy: {
    id: "stormy",
    cloudSheet: "storm",
    keys: [
      {
        t: 0,
        zenithColor: "#0a0c10",
        skyMidColor: "#141820",
        horizonSkyColor: "#1a2028",
        fogColor: "#12161c",
        sunColor: "#607080",
        sunIntensity: 0.08,
        ambientColor: "#304050",
        ambientIntensity: 0.3,
        cloudOpacity: 0.95,
        cloudTint: "#3a4858",
        cloudScroll: 0.02,
        starOpacity: 0.05,
        sunElevation: -20,
      },
      {
        t: 0.3,
        zenithColor: "#2a3038",
        skyMidColor: "#3a4850",
        horizonSkyColor: "#4a5860",
        fogColor: "#3a4850",
        sunColor: "#90a0a8",
        sunIntensity: 0.25,
        ambientColor: "#607080",
        ambientIntensity: 0.45,
        cloudOpacity: 1,
        cloudTint: "#4a5868",
        cloudScroll: 0.028,
        starOpacity: 0,
        sunElevation: 15,
      },
      {
        t: 0.5,
        zenithColor: "#1e2830",
        skyMidColor: "#2a3848",
        horizonSkyColor: "#3a4858",
        fogColor: "#2a3840",
        sunColor: "#a8b8c0",
        sunIntensity: 0.35,
        ambientColor: "#586878",
        ambientIntensity: 0.5,
        cloudOpacity: 1,
        cloudTint: "#3a4858",
        cloudScroll: 0.035,
        starOpacity: 0,
        sunElevation: 28,
      },
      {
        t: 0.7,
        zenithColor: "#241828",
        skyMidColor: "#382840",
        horizonSkyColor: "#483848",
        fogColor: "#302838",
        sunColor: "#c0a080",
        sunIntensity: 0.3,
        ambientColor: "#685868",
        ambientIntensity: 0.42,
        cloudOpacity: 0.98,
        cloudTint: "#484058",
        cloudScroll: 0.03,
        starOpacity: 0,
        sunElevation: 12,
      },
      {
        t: 0.92,
        zenithColor: "#080a0e",
        skyMidColor: "#10141a",
        horizonSkyColor: "#181c24",
        fogColor: "#0e1218",
        sunColor: "#506070",
        sunIntensity: 0.1,
        ambientColor: "#283848",
        ambientIntensity: 0.32,
        cloudOpacity: 0.96,
        cloudTint: "#303848",
        cloudScroll: 0.022,
        starOpacity: 0.08,
        sunElevation: -16,
      },
    ],
  },
  mystical: {
    id: "mystical",
    cloudSheet: "soft",
    keys: [
      {
        t: 0,
        zenithColor: "#0a0618",
        skyMidColor: "#1a0a30",
        horizonSkyColor: "#2a1040",
        fogColor: "#180828",
        sunColor: "#c0a0ff",
        sunIntensity: 0.25,
        ambientColor: "#6050a0",
        ambientIntensity: 0.45,
        cloudOpacity: 0.35,
        cloudTint: "#a080e0",
        cloudScroll: 0.006,
        starOpacity: 1,
        sunElevation: -10,
      },
      {
        t: 0.25,
        zenithColor: "#1a1040",
        skyMidColor: "#4a2080",
        horizonSkyColor: "#8030a0",
        fogColor: "#502868",
        sunColor: "#ffa0e0",
        sunIntensity: 0.55,
        ambientColor: "#c090ff",
        ambientIntensity: 0.6,
        cloudOpacity: 0.45,
        cloudTint: "#e0b0ff",
        cloudScroll: 0.01,
        starOpacity: 0.55,
        sunElevation: 18,
      },
      {
        t: 0.5,
        zenithColor: "#201050",
        skyMidColor: "#3a2080",
        horizonSkyColor: "#6040a0",
        fogColor: "#402868",
        sunColor: "#80ffe8",
        sunIntensity: 0.7,
        ambientColor: "#b0a0ff",
        ambientIntensity: 0.65,
        cloudOpacity: 0.4,
        cloudTint: "#d0c0ff",
        cloudScroll: 0.012,
        starOpacity: 0.7,
        sunElevation: 42,
      },
      {
        t: 0.75,
        zenithColor: "#180828",
        skyMidColor: "#401060",
        horizonSkyColor: "#702080",
        fogColor: "#481858",
        sunColor: "#ff80d0",
        sunIntensity: 0.5,
        ambientColor: "#a070d0",
        ambientIntensity: 0.55,
        cloudOpacity: 0.5,
        cloudTint: "#e090ff",
        cloudScroll: 0.01,
        starOpacity: 0.8,
        sunElevation: 14,
      },
      {
        t: 0.92,
        zenithColor: "#080412",
        skyMidColor: "#140820",
        horizonSkyColor: "#200830",
        fogColor: "#12061c",
        sunColor: "#a080ff",
        sunIntensity: 0.22,
        ambientColor: "#504088",
        ambientIntensity: 0.42,
        cloudOpacity: 0.38,
        cloudTint: "#9070c8",
        cloudScroll: 0.007,
        starOpacity: 1,
        sunElevation: -8,
      },
    ],
  },
};

export function isSkyPresetId(v: unknown): v is SkyPresetId {
  return typeof v === "string" && (SKY_PRESET_IDS as readonly string[]).includes(v);
}

export function resolveSkyPresetId(id: string | undefined | null): SkyPresetId {
  return isSkyPresetId(id) ? id : "sunny";
}

/**
 * Sample a preset's timeline at day fraction `timeOfDay01` (0..1).
 * Keys wrap across midnight.
 */
export function sampleSkyTimeline(
  presetId: SkyPresetId | string | undefined,
  timeOfDay01: number,
): SkyTimelineSample {
  const id = resolveSkyPresetId(presetId);
  const def = SKY_PRESETS[id];
  const keys = def.keys;
  const t = wrap01(timeOfDay01);
  if (keys.length === 0) {
    return {
      presetId: id,
      cloudSheet: def.cloudSheet,
      zenithColor: "#3a8fd9",
      skyMidColor: "#6eb4ef",
      horizonSkyColor: "#c8e0f8",
      fogColor: "#bcd9f0",
      sunColor: "#fff3d6",
      sunIntensity: 1,
      ambientColor: "#ffffff",
      ambientIntensity: 0.85,
      cloudOpacity: 0.4,
      cloudTint: "#ffffff",
      cloudScroll: 0.01,
      starOpacity: 0,
      sunElevation: 45,
    };
  }
  if (keys.length === 1) {
    const k = keys[0]!;
    return { presetId: id, cloudSheet: def.cloudSheet, ...mixKeys(k, k, 0) };
  }

  // Build circular segment: last → first wraps past 1.0
  let i0 = keys.length - 1;
  for (let i = 0; i < keys.length; i++) {
    if (keys[i]!.t > t) break;
    i0 = i;
  }
  const a = keys[i0]!;
  const b = keys[(i0 + 1) % keys.length]!;
  let span = b.t - a.t;
  if (span <= 0) span += 1;
  let u = t - a.t;
  if (u < 0) u += 1;
  u = Math.min(1, Math.max(0, u / span));

  return { presetId: id, cloudSheet: def.cloudSheet, ...mixKeys(a, b, u) };
}

/** Dominant-weight pick for non-lerpable preset IDs across region seams. */
export function pickDominantSkyPreset(
  candidates: { weight: number; presetId: SkyPresetId | undefined }[],
): SkyPresetId {
  let best: SkyPresetId = "sunny";
  let bestW = -1;
  for (const c of candidates) {
    if (c.weight > bestW) {
      bestW = c.weight;
      best = resolveSkyPresetId(c.presetId);
    }
  }
  return best;
}
