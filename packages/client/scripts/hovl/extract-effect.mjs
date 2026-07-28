#!/usr/bin/env node
/**
 * Extract one Hovl Studio "Magic effects pack" .prefab into a normalized
 * JSON effect description, and copy whatever textures it references into
 * this repo. This is the proof-of-concept extractor -- it covers the module
 * set actually exercised by simple, single-particle-system prefabs (main/
 * initial, shape, emission, size/rotation/color/velocity/force over
 * lifetime, texture-sheet flipbook, renderer/material). Composite prefabs
 * (multiple stacked ParticleSystems, mesh-based sub-objects, trails,
 * sub-emitters, lights, collision) aren't attempted yet -- any *enabled*
 * module this script doesn't translate is listed in the output's
 * `skippedModules` so nothing goes missing silently.
 *
 * Usage (from packages/client):
 *   node scripts/hovl/extract-effect.mjs "<path to .prefab>" <effectId>
 *
 * Writes:
 *   public/assets/vfx/textures/<effectId>__<original texture name>.png
 *   public/assets/vfx/effects/<effectId>.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readUnityFile, buildGuidIndex, resolveMainTexture } from "./unity-yaml.mjs";
import { normalizeCurve, normalizeGradient } from "./curves.mjs";

const HOVL_PACK_ROOT = "/Users/champion/My project/Assets/Hovl Studio/Magic effects pack";
const CLIENT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT_TEXTURES = path.join(CLIENT_ROOT, "public/assets/vfx/textures");
const OUT_EFFECTS = path.join(CLIENT_ROOT, "public/assets/vfx/effects");

const [, , prefabArg, effectIdArg] = process.argv;
if (!prefabArg || !effectIdArg) {
  console.error('Usage: node extract-effect.mjs "<prefab path>" <effectId>');
  process.exit(1);
}
const prefabPath = path.isAbsolute(prefabArg) ? prefabArg : path.join(HOVL_PACK_ROOT, prefabArg);
const effectId = effectIdArg;

fs.mkdirSync(OUT_TEXTURES, { recursive: true });
fs.mkdirSync(OUT_EFFECTS, { recursive: true });

console.log("Indexing pack GUIDs...");
const guidIndex = buildGuidIndex(HOVL_PACK_ROOT);
console.log(`  ${guidIndex.size} assets indexed`);

const objects = readUnityFile(prefabPath);
const particleSystems = [...objects.values()].filter((o) => o.classId === 198);
if (particleSystems.length === 0) {
  console.error("No ParticleSystem found in", prefabPath);
  process.exit(1);
}
if (particleSystems.length > 1) {
  console.warn(
    `! ${particleSystems.length} ParticleSystems in this prefab -- extracting only the first. ` +
      `Composite/multi-layer prefabs aren't supported by this pass yet.`,
  );
}

const gameObjectId = particleSystems[0].data.ParticleSystem.m_GameObject.fileID;
const renderer = [...objects.entries()].find(
  ([, o]) => o.classId === 199 && String(o.data.ParticleSystemRenderer.m_GameObject.fileID) === String(gameObjectId),
);

const pd = particleSystems[0].data.ParticleSystem;
const skippedModules = [];
function checkSkipped(name, mod) {
  if (mod?.enabled) skippedModules.push(name);
}
for (const [name, mod] of [
  ["Noise", pd.NoiseModule],
  ["Collision", pd.CollisionModule],
  ["Trigger", pd.TriggerModule],
  ["SubEmitters", pd.SubModule],
  ["Lights", pd.LightsModule],
  ["Trails", pd.TrailModule],
  ["CustomData", pd.CustomDataModule],
  ["SizeBySpeed", pd.SizeBySpeedModule],
  ["RotationBySpeed", pd.RotationBySpeedModule],
  ["ColorBySpeed", pd.ColorBySpeedModule],
  ["ExternalForces", pd.ExternalForcesModule],
  ["InheritVelocity", pd.InheritVelocityModule],
]) {
  checkSkipped(name, mod);
}

const SHAPE_TYPE_NAMES = { 0: "cone", 1: "coneVolume", 4: "sphere", 5: "hemisphere", 7: "box", 3: "circle", 10: "edge" };

const effect = {
  id: effectId,
  sourcePrefab: path.relative(HOVL_PACK_ROOT, prefabPath),
  duration: pd.lengthInSec,
  looping: !!pd.looping,
  simulationSpace: pd.moveWithTransform ? "local" : "world",
  maxParticles: pd.InitialModule.maxNumParticles,
  initial: {
    lifetime: normalizeCurve(pd.InitialModule.startLifetime),
    speed: normalizeCurve(pd.InitialModule.startSpeed),
    size: normalizeCurve(pd.InitialModule.startSize),
    size3D: !!pd.InitialModule.size3D,
    sizeY: pd.InitialModule.size3D ? normalizeCurve(pd.InitialModule.startSizeY) : null,
    sizeZ: pd.InitialModule.size3D ? normalizeCurve(pd.InitialModule.startSizeZ) : null,
    rotation: normalizeCurve(pd.InitialModule.startRotation),
    color: normalizeGradient(pd.InitialModule.startColor),
    gravityModifier: normalizeCurve(pd.InitialModule.gravityModifier),
  },
  shape: pd.ShapeModule.enabled
    ? {
        type: SHAPE_TYPE_NAMES[pd.ShapeModule.type] ?? `unknown(${pd.ShapeModule.type})`,
        angle: pd.ShapeModule.angle,
        radius: pd.ShapeModule.radius?.value ?? pd.ShapeModule.radius,
        arc: pd.ShapeModule.arc?.value ?? pd.ShapeModule.arc,
        length: pd.ShapeModule.length,
        box: pd.ShapeModule.boxThickness,
      }
    : null,
  emission: {
    rateOverTime: normalizeCurve(pd.EmissionModule.rateOverTime),
    bursts: (pd.EmissionModule.m_Bursts ?? []).map((b) => ({
      time: b.time,
      count: normalizeCurve(b.countCurve),
      cycleCount: b.cycleCount,
      repeatInterval: b.repeatInterval,
    })),
  },
  sizeOverLifetime: pd.SizeModule.enabled
    ? {
        curve: normalizeCurve(pd.SizeModule.curve),
        separateAxes: !!pd.SizeModule.separateAxes,
        y: pd.SizeModule.separateAxes ? normalizeCurve(pd.SizeModule.y) : null,
        z: pd.SizeModule.separateAxes ? normalizeCurve(pd.SizeModule.z) : null,
      }
    : null,
  rotationOverLifetime: pd.RotationModule.enabled
    ? { curve: normalizeCurve(pd.RotationModule.curve) }
    : null,
  colorOverLifetime: pd.ColorModule.enabled ? normalizeGradient(pd.ColorModule.gradient) : null,
  velocityOverLifetime: pd.VelocityModule.enabled
    ? {
        space: pd.VelocityModule.inWorldSpace ? "world" : "local",
        x: normalizeCurve(pd.VelocityModule.x),
        y: normalizeCurve(pd.VelocityModule.y),
        z: normalizeCurve(pd.VelocityModule.z),
      }
    : null,
  forceOverLifetime: pd.ForceModule.enabled
    ? {
        space: pd.ForceModule.inWorldSpace ? "world" : "local",
        x: normalizeCurve(pd.ForceModule.x),
        y: normalizeCurve(pd.ForceModule.y),
        z: normalizeCurve(pd.ForceModule.z),
      }
    : null,
  textureSheet: pd.UVModule.enabled
    ? {
        tilesX: pd.UVModule.tilesX,
        tilesY: pd.UVModule.tilesY,
        cycles: pd.UVModule.cycles,
        frameOverTime: normalizeCurve(pd.UVModule.frameOverTime),
      }
    : null,
  renderer: null,
  skippedModules,
};

if (renderer) {
  const rd = renderer[1].data.ParticleSystemRenderer;
  const materialGuid = rd.m_Materials?.[0]?.guid;
  const resolved = materialGuid ? resolveMainTexture(materialGuid, guidIndex) : null;
  let texturePublicPath = null;
  if (resolved?.texturePath && fs.existsSync(resolved.texturePath)) {
    const ext = path.extname(resolved.texturePath);
    const destName = `${effectId}${ext}`;
    fs.copyFileSync(resolved.texturePath, path.join(OUT_TEXTURES, destName));
    texturePublicPath = `/assets/vfx/textures/${destName}`;
    console.log(`  copied texture: ${path.basename(resolved.texturePath)} -> ${destName}`);
  } else {
    console.warn("  ! could not resolve a main texture for this effect's material");
  }
  const additive = (resolved?.keywords ?? []).includes("_ADDITIVE_ON") || resolved?.materialName?.toLowerCase().includes("additive");
  effect.renderer = {
    renderMode: rd.m_RenderMode, // 0 Billboard, 1 Stretch, 2 HorizontalBillboard, 3 VerticalBillboard, 4 Mesh
    lengthScale: rd.m_LengthScale,
    velocityScale: rd.m_VelocityScale,
    materialName: resolved?.materialName ?? null,
    texture: texturePublicPath,
    blend: additive ? "additive" : "alpha",
    sortingFudge: rd.m_SortingFudge,
  };
}

if (skippedModules.length) {
  console.warn(`! enabled modules not yet translated: ${skippedModules.join(", ")}`);
}

const outPath = path.join(OUT_EFFECTS, `${effectId}.json`);
fs.writeFileSync(outPath, JSON.stringify(effect, null, 2));
console.log("Wrote", path.relative(CLIENT_ROOT, outPath));
