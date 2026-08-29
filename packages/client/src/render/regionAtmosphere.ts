import * as THREE from "three";
import {
  type RegionBlueprint,
  type RegionColorGrading,
  type SkyPresetId,
  type SkyCloudSheet,
  regionWorldBounds,
  REGION_SEAM_PREFETCH_METERS,
  resolveSkyPresetId,
  sampleSkyTimeline,
  pickDominantSkyPreset,
} from "@rustcraft/shared";

/** How wide the colour cross-fade is across a region edge (world meters). */
export const REGION_ATMOSPHERE_BLEND_METERS = Math.max(110, REGION_SEAM_PREFETCH_METERS * 1.4);

/** Temporal ease rate toward the spatially blended target (higher = snappier). */
export const REGION_ATMOSPHERE_LERP_RATE = 2.2;

/** Skydome layer state (cloud/star shells) resolved with the color sample. */
export interface SkyLayerState {
  presetId: SkyPresetId;
  cloudSheet: SkyCloudSheet;
  cloudOpacity: number;
  cloudTint: THREE.Color;
  cloudScroll: number;
  starOpacity: number;
  sunElevation: number;
  /** 0..1 how "daylit" the scene should feel (drives light scale + grass). */
  dayness: number;
}

/** Resolved numeric grading used for lighting / fog / sky. */
export interface AtmosphereSample {
  skyColor: THREE.Color;
  fogColor: THREE.Color;
  fogDensity: number;
  ambientColor: THREE.Color;
  ambientIntensity: number;
  sunColor: THREE.Color;
  sunIntensity: number;
  fillColor: THREE.Color;
  fillIntensity: number;
  exposure: number;
  groundTint: THREE.Color;
  /** Gradient dome: top. */
  zenithColor: THREE.Color;
  /** Gradient dome: equator band. */
  skyMidColor: THREE.Color;
  /** Gradient dome: near horizon (before fog skirt). */
  horizonSkyColor: THREE.Color;
  layers: SkyLayerState;
}

/**
 * Deep-copy an AtmosphereSample. atmosphereFromGrading/sampleBlendedAtmosphere
 * can return a cached, shared instance (see gradingCache below) -- callers
 * that intend to hold onto the result across frames and mutate it in place
 * (lerpAtmosphere does exactly this) must clone it first so they don't
 * corrupt the shared cache.
 */
export function cloneAtmosphere(a: AtmosphereSample): AtmosphereSample {
  return {
    skyColor: a.skyColor.clone(),
    fogColor: a.fogColor.clone(),
    fogDensity: a.fogDensity,
    ambientColor: a.ambientColor.clone(),
    ambientIntensity: a.ambientIntensity,
    sunColor: a.sunColor.clone(),
    sunIntensity: a.sunIntensity,
    fillColor: a.fillColor.clone(),
    fillIntensity: a.fillIntensity,
    exposure: a.exposure,
    groundTint: a.groundTint.clone(),
    zenithColor: a.zenithColor.clone(),
    skyMidColor: a.skyMidColor.clone(),
    horizonSkyColor: a.horizonSkyColor.clone(),
    layers: {
      presetId: a.layers.presetId,
      cloudSheet: a.layers.cloudSheet,
      cloudOpacity: a.layers.cloudOpacity,
      cloudTint: a.layers.cloudTint.clone(),
      cloudScroll: a.layers.cloudScroll,
      starOpacity: a.layers.starOpacity,
      sunElevation: a.layers.sunElevation,
      dayness: a.layers.dayness,
    },
  };
}

function parseColor(c: string | number | undefined, fallback: string): THREE.Color {
  const out = new THREE.Color();
  try {
    if (typeof c === "number") out.set(c);
    else if (typeof c === "string" && c.length > 0) out.set(c);
    else out.set(fallback);
  } catch {
    out.set(fallback);
  }
  return out;
}

function emptyLayers(presetId: SkyPresetId = "sunny"): SkyLayerState {
  return {
    presetId,
    cloudSheet: "soft",
    cloudOpacity: 0.4,
    cloudTint: new THREE.Color(0xffffff),
    cloudScroll: 0.01,
    starOpacity: 0,
    sunElevation: 45,
    dayness: 1,
  };
}

function emptySample(): AtmosphereSample {
  return {
    skyColor: new THREE.Color(0, 0, 0),
    fogColor: new THREE.Color(0, 0, 0),
    fogDensity: 0,
    ambientColor: new THREE.Color(0, 0, 0),
    ambientIntensity: 0,
    sunColor: new THREE.Color(0, 0, 0),
    sunIntensity: 0,
    fillColor: new THREE.Color(0, 0, 0),
    fillIntensity: 0,
    exposure: 0,
    groundTint: new THREE.Color(0, 0, 0),
    zenithColor: new THREE.Color(0, 0, 0),
    skyMidColor: new THREE.Color(0, 0, 0),
    horizonSkyColor: new THREE.Color(0, 0, 0),
    layers: emptyLayers(),
  };
}

/**
 * Build an atmosphere sample from region grading + optional time-of-day.
 *
 * Sky preset timeline owns the skydome gradient (zenith/mid/horizon) and
 * cloud/star layers — that's what "Sky Preset" in the editor is for.
 * Explicit zenithColor / skyMidColor / horizonSkyColor overrides win when set.
 *
 * Mesh lights stay on region color grading (+ mild dayness) so swapping
 * mystical↔sunny does not recolor every prop.
 */
export function atmosphereFromGrading(
  cg: RegionColorGrading,
  timeOfDay01 = 0.5,
): AtmosphereSample {
  const presetId = resolveSkyPresetId(cg.skyPreset);
  const timeline = sampleSkyTimeline(presetId, timeOfDay01);

  const skyFallback = cg.skyColor || timeline.skyMidColor || "#87b5d9";
  const fogFallback = cg.fogColor || timeline.fogColor || skyFallback;

  const presetZenith = parseColor(timeline.zenithColor, skyFallback);
  const presetMid = parseColor(timeline.skyMidColor, skyFallback);
  const presetHorizon = parseColor(timeline.horizonSkyColor, fogFallback);
  const presetFog = parseColor(timeline.fogColor, fogFallback);

  // Needed early: fogColor below gets its own night-darkening multiply
  // (rather than relying solely on presetFog's per-keyframe variation), same
  // dayness curve sun/ambient intensity already use.
  const elev = timeline.sunElevation;
  const dayness = Math.min(1, Math.max(0.28, (elev + 12) / 55));

  // Overrides tint the preset (don't replace it) so a saved zenithColor can't
  // fully hide the chosen skyPreset in-game. horizonSkyColor is the one
  // exception -- its whole job is blending into the fog skirt (see
  // AtmosphereSample's "near horizon (before fog skirt)" doc comment), which
  // is already 100% cg.fogColor with no dilution, so keeping it mostly
  // preset-locked made a clean sky/fog match structurally impossible to
  // author. Weighted much closer to the chosen color instead -- zenith/mid
  // stay lightly tinted since preset identity still matters higher in the
  // sky, away from the ground-level fog seam.
  const zenith = cg.zenithColor
    ? presetZenith.clone().lerp(parseColor(cg.zenithColor, skyFallback), 0.45)
    : presetZenith.clone().lerp(parseColor(cg.skyColor, skyFallback), 0.15);
  const mid = cg.skyMidColor
    ? presetMid.clone().lerp(parseColor(cg.skyMidColor, skyFallback), 0.45)
    : presetMid.clone().lerp(parseColor(cg.skyColor, skyFallback), 0.2);
  const horizon = cg.horizonSkyColor
    ? presetHorizon.clone().lerp(parseColor(cg.horizonSkyColor, fogFallback), 0.85)
    : presetHorizon.clone().lerp(parseColor(cg.fogColor ?? cg.skyColor, fogFallback), 0.6);
  // fogColor used to be a 100% raw override with no time-of-day blending at
  // all (unlike every other color here) -- an authored fogColor stayed fixed
  // through sunrise/day/sunset/night while the sky/ambient/sun around it kept
  // shifting with the timeline, so fog visibly stopped tracking the night
  // cycle. Same dominant-but-not-absolute weight as horizonSkyColor above so
  // the region's authored intent still wins, but the timeline can still
  // darken/shift it appropriately at night.
  const fogColor = cg.fogColor
    ? presetFog.clone().lerp(parseColor(cg.fogColor, fogFallback), 0.85)
    : presetFog;
  // Night-darken regardless of authored hue: an author's fogColor is tuned
  // to match the sky dome in daylight (see the horizon-blend fix above), so
  // the 85%-author-weighted blend above still stayed noticeably bright after
  // dark -- presetFog's own per-keyframe variation alone wasn't pulling it
  // down enough. Stronger falloff than sun/ambient's (0.35/0.55 floors)
  // since fog specifically reading as "too bright at night" was the report.
  fogColor.multiplyScalar(0.2 + 0.8 * dayness);

  const sunIntensity = (cg.sunIntensity ?? 1) * (0.35 + 0.65 * dayness);
  const ambientIntensity = (cg.ambientIntensity ?? 0.85) * (0.55 + 0.45 * dayness);

  return {
    skyColor: mid.clone(),
    fogColor,
    fogDensity: cg.fogDensity,
    ambientColor: parseColor(cg.ambientColor, "#ffffff"),
    ambientIntensity,
    sunColor: parseColor(cg.sunColor, "#fff3d6"),
    sunIntensity,
    fillColor: parseColor(cg.fillColor ?? cg.ambientColor, "#3a4a2a"),
    fillIntensity: cg.fillIntensity ?? 0,
    exposure: cg.exposure ?? 1,
    groundTint: parseColor(cg.groundTint, "#6b8f4e"),
    zenithColor: zenith,
    skyMidColor: mid,
    horizonSkyColor: horizon,
    layers: {
      presetId,
      cloudSheet: timeline.cloudSheet,
      cloudOpacity: timeline.cloudOpacity,
      cloudTint: parseColor(timeline.cloudTint, "#ffffff").lerp(mid, 0.15),
      cloudScroll: timeline.cloudScroll,
      starOpacity: timeline.starOpacity,
      sunElevation: timeline.sunElevation,
      dayness,
    },
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Soft presence of a region at (wx,wz): 1 deep inside, 0.5 on the boundary,
 * 0 once more than `blendMeters` outside. Shared edges therefore mix ~50/50.
 */
export function regionAtmosphereWeight(
  bp: Pick<RegionBlueprint, "gridSize" | "pitch" | "worldOriginX" | "worldOriginZ">,
  wx: number,
  wz: number,
  blendMeters = REGION_ATMOSPHERE_BLEND_METERS,
): number {
  const b = regionWorldBounds(bp);
  const insetX = Math.min(wx - b.minX, b.maxX - wx);
  const insetZ = Math.min(wz - b.minZ, b.maxZ - wz);
  const inset = Math.min(insetX, insetZ);
  return smoothstep(-blendMeters, blendMeters, inset);
}

/** Weighted blend of several regions' colour grading at a world point. */
export function sampleBlendedAtmosphere(
  regions: Iterable<RegionBlueprint>,
  wx: number,
  wz: number,
  blendMeters = REGION_ATMOSPHERE_BLEND_METERS,
  timeOfDay01 = 0.5,
): AtmosphereSample | null {
  const parts: { w: number; a: AtmosphereSample; presetId: SkyPresetId }[] = [];
  let sum = 0;
  for (const bp of regions) {
    if (!bp.colorGrading) continue;
    if ((bp.gridSize ?? 0) < 2 || !(bp.pitch > 0)) continue;
    const w = regionAtmosphereWeight(bp, wx, wz, blendMeters);
    if (w <= 0.001) continue;
    const a = atmosphereFromGrading(bp.colorGrading, timeOfDay01);
    parts.push({ w, a, presetId: resolveSkyPresetId(bp.colorGrading.skyPreset) });
    sum += w;
  }
  if (parts.length === 0 || sum <= 0) return null;
  if (parts.length === 1) return parts[0]!.a;

  const out = emptySample();
  const dominant = pickDominantSkyPreset(parts.map((p) => ({ weight: p.w, presetId: p.presetId })));

  for (const { w, a } of parts) {
    const k = w / sum;
    out.skyColor.r += a.skyColor.r * k;
    out.skyColor.g += a.skyColor.g * k;
    out.skyColor.b += a.skyColor.b * k;
    out.fogColor.r += a.fogColor.r * k;
    out.fogColor.g += a.fogColor.g * k;
    out.fogColor.b += a.fogColor.b * k;
    out.ambientColor.r += a.ambientColor.r * k;
    out.ambientColor.g += a.ambientColor.g * k;
    out.ambientColor.b += a.ambientColor.b * k;
    out.sunColor.r += a.sunColor.r * k;
    out.sunColor.g += a.sunColor.g * k;
    out.sunColor.b += a.sunColor.b * k;
    out.fillColor.r += a.fillColor.r * k;
    out.fillColor.g += a.fillColor.g * k;
    out.fillColor.b += a.fillColor.b * k;
    out.groundTint.r += a.groundTint.r * k;
    out.groundTint.g += a.groundTint.g * k;
    out.groundTint.b += a.groundTint.b * k;
    out.zenithColor.r += a.zenithColor.r * k;
    out.zenithColor.g += a.zenithColor.g * k;
    out.zenithColor.b += a.zenithColor.b * k;
    out.skyMidColor.r += a.skyMidColor.r * k;
    out.skyMidColor.g += a.skyMidColor.g * k;
    out.skyMidColor.b += a.skyMidColor.b * k;
    out.horizonSkyColor.r += a.horizonSkyColor.r * k;
    out.horizonSkyColor.g += a.horizonSkyColor.g * k;
    out.horizonSkyColor.b += a.horizonSkyColor.b * k;
    out.fogDensity += a.fogDensity * k;
    out.ambientIntensity += a.ambientIntensity * k;
    out.sunIntensity += a.sunIntensity * k;
    out.fillIntensity += a.fillIntensity * k;
    out.exposure += a.exposure * k;
    out.layers.cloudOpacity += a.layers.cloudOpacity * k;
    out.layers.cloudTint.r += a.layers.cloudTint.r * k;
    out.layers.cloudTint.g += a.layers.cloudTint.g * k;
    out.layers.cloudTint.b += a.layers.cloudTint.b * k;
    out.layers.cloudScroll += a.layers.cloudScroll * k;
    out.layers.starOpacity += a.layers.starOpacity * k;
    out.layers.sunElevation += a.layers.sunElevation * k;
    out.layers.dayness += a.layers.dayness * k;
  }

  // Non-lerpable sheet/preset: dominant weight wins.
  const dom = parts.find((p) => p.presetId === dominant) ?? parts[0]!;
  out.layers.presetId = dominant;
  out.layers.cloudSheet = dom.a.layers.cloudSheet;
  return out;
}

/**
 * Frame-to-frame ease so ownership flips don't pop even mid-blend.
 * Mutates and returns `from` in place.
 */
export function lerpAtmosphere(from: AtmosphereSample, to: AtmosphereSample, t: number): AtmosphereSample {
  const k = Math.min(1, Math.max(0, t));
  from.skyColor.lerp(to.skyColor, k);
  from.fogColor.lerp(to.fogColor, k);
  from.fogDensity += (to.fogDensity - from.fogDensity) * k;
  from.ambientColor.lerp(to.ambientColor, k);
  from.ambientIntensity += (to.ambientIntensity - from.ambientIntensity) * k;
  from.sunColor.lerp(to.sunColor, k);
  from.sunIntensity += (to.sunIntensity - from.sunIntensity) * k;
  from.fillColor.lerp(to.fillColor, k);
  from.fillIntensity += (to.fillIntensity - from.fillIntensity) * k;
  from.exposure += (to.exposure - from.exposure) * k;
  from.groundTint.lerp(to.groundTint, k);
  from.zenithColor.lerp(to.zenithColor, k);
  from.skyMidColor.lerp(to.skyMidColor, k);
  from.horizonSkyColor.lerp(to.horizonSkyColor, k);
  from.layers.cloudOpacity += (to.layers.cloudOpacity - from.layers.cloudOpacity) * k;
  from.layers.cloudTint.lerp(to.layers.cloudTint, k);
  from.layers.cloudScroll += (to.layers.cloudScroll - from.layers.cloudScroll) * k;
  from.layers.starOpacity += (to.layers.starOpacity - from.layers.starOpacity) * k;
  from.layers.sunElevation += (to.layers.sunElevation - from.layers.sunElevation) * k;
  from.layers.dayness += (to.layers.dayness - from.layers.dayness) * k;
  if (k >= 0.5) {
    from.layers.presetId = to.layers.presetId;
    from.layers.cloudSheet = to.layers.cloudSheet;
  }
  return from;
}
