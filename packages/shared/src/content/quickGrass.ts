/** Quick Grass settings — ported from quick-grass-1.html demo defaults. */
export interface QuickGrassSettings {
  bladesPerPatch: number;
  patchSize: number;
  drawDistance: number;
  detailDistance: number;
  segments: number;
  bladeWidth: number;
  bladeHeight: number;
  heightVariation: number;
  curvature: number;
  tipTaper: number;
  roundness: number;
  thickening: number;
  windStrength: number;
  windSpeed: number;
  gustScale: number;
  windDrift: number;
  pushRadius: number;
  pushStrength: number;
  baseColour: string;
  tipColour: string;
  colourVariation: number;
  sunElevation: number;
  sunAzimuth: number;
  sunIntensity: number;
  ambient: number;
  translucency: number;
  normalFlatten: number;
  haze: number;
  exposure: number;
  showLod: boolean;
  wireframe: boolean;
  freezeWind: boolean;
}

export const DEFAULT_QUICK_GRASS_SETTINGS: QuickGrassSettings = {
  bladesPerPatch: 1536,
  patchSize: 10,
  drawDistance: 80,
  detailDistance: 18,
  segments: 3,
  bladeWidth: 0.1,
  bladeHeight: 1.5,
  heightVariation: 0.55,
  curvature: 0.45,
  tipTaper: 2.0,
  roundness: 0.3,
  thickening: 1.0,
  windStrength: 1.0,
  windSpeed: 1.0,
  gustScale: 0.25,
  windDrift: 0.05,
  pushRadius: 2.5,
  pushStrength: 0.45,
  baseColour: "#0a2a10",
  tipColour: "#a8cc3f",
  colourVariation: 0.6,
  sunElevation: 24,
  sunAzimuth: 214,
  sunIntensity: 1.35,
  ambient: 0.85,
  translucency: 0.9,
  normalFlatten: 1.0,
  haze: 1.0,
  exposure: 1.5,
  showLod: false,
  wireframe: false,
  freezeWind: false,
};

export const QUICK_GRASS_PRESETS: Record<string, Partial<QuickGrassSettings>> = {
  "Still morning": {
    windStrength: 0.28,
    windSpeed: 0.45,
    gustScale: 0.14,
    sunElevation: 9,
    sunAzimuth: 96,
    sunIntensity: 1.9,
    ambient: 0.7,
    haze: 1.5,
    exposure: 1.55,
    tipColour: "#c2cf52",
    baseColour: "#0e2a12",
    curvature: 0.3,
    translucency: 1.5,
  },
  Gale: {
    windStrength: 2.2,
    windSpeed: 2.6,
    gustScale: 0.42,
    windDrift: 0.12,
    curvature: 0.85,
    sunElevation: 31,
    sunIntensity: 1.1,
    ambient: 1.1,
    haze: 1.8,
    exposure: 1.4,
    tipColour: "#93b84a",
  },
  "Deep meadow": {
    bladesPerPatch: 6144,
    patchSize: 8,
    bladeHeight: 2.1,
    heightVariation: 0.8,
    detailDistance: 26,
    drawDistance: 110,
    curvature: 0.55,
    colourVariation: 0.9,
    baseColour: "#07240f",
    tipColour: "#9dc93c",
  },
  Xenoturf: {
    baseColour: "#12063a",
    tipColour: "#57e0c8",
    bladeWidth: 0.055,
    bladeHeight: 2.6,
    curvature: 0.9,
    sunElevation: 6,
    sunAzimuth: 300,
    sunIntensity: 2.2,
    ambient: 0.6,
    haze: 2.2,
    translucency: 2.0,
    colourVariation: 1.1,
    windSpeed: 0.6,
    exposure: 1.7,
  },
};

export function mergeQuickGrassSettings(
  partial?: Partial<QuickGrassSettings> | null,
  legacy?: { grassColor?: { bottom: string; top: string }; grassSway?: number },
): QuickGrassSettings {
  const out: QuickGrassSettings = { ...DEFAULT_QUICK_GRASS_SETTINGS, ...(partial ?? {}) };
  if (!partial?.baseColour && legacy?.grassColor?.bottom) out.baseColour = legacy.grassColor.bottom;
  if (!partial?.tipColour && legacy?.grassColor?.top) out.tipColour = legacy.grassColor.top;
  if (partial?.windStrength === undefined && typeof legacy?.grassSway === "number") {
    out.windStrength = Math.max(0, legacy.grassSway);
  }
  return out;
}
