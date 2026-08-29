/**
 * Client graphics preferences — quality presets + per-option knobs.
 * Persisted per account (server) with a localStorage cache for fast boot /
 * offline. Designed so a future desktop shell can reuse the same schema.
 */

import { ADT_RING, ADT_SIZE, adtRingRadiusMeters } from "../adt";

export type GraphicsQualityPreset = "low" | "medium" | "high" | "ultra" | "custom";

export type ShadowMapSize = 512 | 1024 | 2048;

export interface GraphicsSettings {
  preset: GraphicsQualityPreset;
  /** Multiplier on devicePixelRatio before the maxPixelRatio clamp (0.5–1.5). */
  resolutionScale: number;
  /** Cap on effective pixel ratio after scale (0.75–2). */
  maxPixelRatio: number;
  antialias: boolean;
  shadowsEnabled: boolean;
  shadowMapSize: ShadowMapSize;
  /** Terrain / foliage Chebyshev stream ring (2–5). Default matches ADT_RING. */
  streamRing: number;
  /** Quick Grass draw distance in meters (40–160). */
  grassDrawDistance: number;
  /** Multiplier on region FogExp2 density (0.5–1.5). */
  fogScale: number;
}

export type GraphicsPresetId = Exclude<GraphicsQualityPreset, "custom">;

export const GRAPHICS_PRESET_IDS: readonly GraphicsPresetId[] = [
  "low",
  "medium",
  "high",
  "ultra",
] as const;

export const GRAPHICS_PRESET_LABELS: Record<GraphicsPresetId, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  ultra: "Ultra",
};

// Fragment/fill-rate cost scales with (resolutionScale * min(devicePixelRatio,
// maxPixelRatio))^2 -- these two knobs dominate GPU cost far more than any
// other setting here. A prior edit had bumped resolutionScale to 1.0 and
// maxPixelRatio to 2 on low/medium/high, which on a 2x-DPR display means
// rendering at full native 2x resolution even on "Low" -- the opposite of
// what a weak-hardware preset needs. Restored to genuinely cheap values,
// measured this session: dropping effective pixel ratio from 1.5 to 1.0 alone
// recovered a large chunk of frame time on a mid-range laptop GPU.
const PRESET_BODY: Record<GraphicsPresetId, Omit<GraphicsSettings, "preset">> = {
  low: {
    resolutionScale: 0.75,
    maxPixelRatio: 1,
    antialias: false,
    shadowsEnabled: false,
    shadowMapSize: 512,
    streamRing: 3,
    grassDrawDistance: 80,
    fogScale: 1.0,
  },
  medium: {
    resolutionScale: 0.9,
    maxPixelRatio: 1.25,
    antialias: true,
    shadowsEnabled: true,
    shadowMapSize: 1024,
    streamRing: 4,
    grassDrawDistance: 120,
    fogScale: 0.95,
  },
  high: {
    resolutionScale: 1,
    maxPixelRatio: 1.5,
    antialias: true,
    shadowsEnabled: true,
    shadowMapSize: 1024,
    streamRing: 5,
    grassDrawDistance: 160,
    fogScale: 0.85,
  },
  ultra: {
    resolutionScale: 1,
    maxPixelRatio: 2,
    antialias: true,
    shadowsEnabled: true,
    shadowMapSize: 2048,
    streamRing: 6,
    grassDrawDistance: 200,
    fogScale: 0.75,
  },
};

/** Default graphics profile for smooth browser-first gameplay out of the box.
 *  Medium, not High -- this is a browser game that should feel smooth on a
 *  mid-range laptop the moment someone opens it, not just on a gaming rig.
 *  Only affects brand-new accounts / cleared localStorage; existing players
 *  keep their persisted choice. */
export const DEFAULT_GRAPHICS_SETTINGS: GraphicsSettings = {
  preset: "medium",
  ...PRESET_BODY.medium,
};

/** Account-scoped blob stored in `accounts.settings` jsonb. */
export interface AccountSettings {
  graphics?: Partial<GraphicsSettings>;
}

const SHADOW_SIZES: readonly ShadowMapSize[] = [512, 1024, 2048];

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function clampShadowSize(v: unknown, fallback: ShadowMapSize): ShadowMapSize {
  const n = typeof v === "number" ? v : Number(v);
  return (SHADOW_SIZES as readonly number[]).includes(n) ? (n as ShadowMapSize) : fallback;
}

/** Normalize partial / untrusted input into a full GraphicsSettings. */
export function clampGraphicsSettings(
  partial: Partial<GraphicsSettings> | null | undefined,
): GraphicsSettings {
  const base = DEFAULT_GRAPHICS_SETTINGS;
  const p = partial ?? {};
  const presetRaw = p.preset;
  const preset: GraphicsQualityPreset =
    presetRaw === "low" ||
    presetRaw === "medium" ||
    presetRaw === "high" ||
    presetRaw === "ultra" ||
    presetRaw === "custom"
      ? presetRaw
      : base.preset;

  return {
    preset,
    resolutionScale: clampNum(p.resolutionScale, 0.5, 1.5, base.resolutionScale),
    maxPixelRatio: clampNum(p.maxPixelRatio, 0.75, 2, base.maxPixelRatio),
    antialias: typeof p.antialias === "boolean" ? p.antialias : base.antialias,
    shadowsEnabled: typeof p.shadowsEnabled === "boolean" ? p.shadowsEnabled : base.shadowsEnabled,
    shadowMapSize: clampShadowSize(p.shadowMapSize, base.shadowMapSize),
    streamRing: Math.round(clampNum(p.streamRing, 2, 5, base.streamRing)),
    grassDrawDistance: clampNum(p.grassDrawDistance, 40, 160, base.grassDrawDistance),
    fogScale: clampNum(p.fogScale, 0.5, 1.5, base.fogScale),
  };
}

export function graphicsFromPreset(preset: GraphicsPresetId): GraphicsSettings {
  return { preset, ...PRESET_BODY[preset] };
}

/**
 * Resolve settings LOADED FROM PERSISTENCE (account settings / localStorage
 * cache) -- as opposed to a live in-session edit (see patchGraphics, which
 * must keep trusting literal field values so dragging a slider actually
 * changes something).
 *
 * A saved named preset ("low"/"medium"/"high"/"ultra") is treated as a LIVE
 * reference to that preset's *current* PRESET_BODY, not a frozen snapshot of
 * whatever the numbers were the moment it was saved. Without this, retuning a
 * preset here (as this pass did for Low/Medium/High) would never reach a
 * player who had already saved that preset — every previously-saved "Medium"
 * keeps shipping the old numbers forever unless the player happens to
 * re-click the button. Only `preset: "custom"` (an explicit manual edit)
 * trusts the persisted literal values, since that's the whole point of it.
 */
export function resolvePersistedGraphics(
  partial: Partial<GraphicsSettings> | null | undefined,
): GraphicsSettings {
  const preset = partial?.preset;
  if (preset && preset !== "custom" && (GRAPHICS_PRESET_IDS as readonly string[]).includes(preset)) {
    return graphicsFromPreset(preset as GraphicsPresetId);
  }
  return clampGraphicsSettings(partial);
}

/** Merge overlays onto defaults, then clamp. */
export function mergeGraphicsSettings(
  ...parts: Array<Partial<GraphicsSettings> | null | undefined>
): GraphicsSettings {
  let acc: Partial<GraphicsSettings> = { ...DEFAULT_GRAPHICS_SETTINGS };
  for (const p of parts) {
    if (p) acc = { ...acc, ...p };
  }
  return clampGraphicsSettings(acc);
}

/** If individual knobs no longer match a named preset, mark as custom. */
export function resolveGraphicsPreset(settings: GraphicsSettings): GraphicsQualityPreset {
  if (settings.preset === "custom") return "custom";
  for (const id of GRAPHICS_PRESET_IDS) {
    const body = PRESET_BODY[id];
    if (
      settings.resolutionScale === body.resolutionScale &&
      settings.maxPixelRatio === body.maxPixelRatio &&
      settings.antialias === body.antialias &&
      settings.shadowsEnabled === body.shadowsEnabled &&
      settings.shadowMapSize === body.shadowMapSize &&
      settings.streamRing === body.streamRing &&
      settings.grassDrawDistance === body.grassDrawDistance &&
      settings.fogScale === body.fogScale
    ) {
      return id;
    }
  }
  return "custom";
}

export function effectivePixelRatio(settings: GraphicsSettings, devicePixelRatio: number): number {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return Math.min(dpr * settings.resolutionScale, settings.maxPixelRatio);
}

/** Perspective camera far plane scaled with stream ring (2400m - 4800m). */
export function cameraFarForStreamRing(ring: number): number {
  const r = Math.max(2, Math.min(6, ring));
  return Math.max(2000, 1200 + r * 600);
}

/** Approximate world meters covered by a Chebyshev stream ring (for UI labels). */
export function streamRingMeters(ring: number): number {
  return Math.round(adtRingRadiusMeters(ring));
}

/** Detail LOD distance derived from grass draw distance. */
export function grassDetailDistance(drawDistance: number): number {
  return Math.max(12, Math.min(32, drawDistance * 0.22));
}

/** Linear fog distances for the non-region overworld path, scaled by ring. */
export function overworldFogForRing(ring: number): { near: number; far: number } {
  const r = Math.max(2, Math.min(6, ring));
  return {
    near: 300,
    far: 2400 + r * 350,
  };
}

export function parseAccountSettings(raw: unknown): AccountSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const graphics =
    o.graphics && typeof o.graphics === "object" && !Array.isArray(o.graphics)
      ? clampGraphicsSettings(o.graphics as Partial<GraphicsSettings>)
      : undefined;
  return graphics ? { graphics } : {};
}
