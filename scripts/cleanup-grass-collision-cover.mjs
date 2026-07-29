#!/usr/bin/env node
/**
 * Removes leftover "ground cover" assets left over from the old grass brush
 * (deleted this session, replaced by the GrassPatch/grassField procedural
 * system). For every biome except grassland, that brush's fill list used
 * real 3D models -- bush.glb, bush_flowers.glb, fern.glb, mushroom.glb,
 * dead_*.glb, rock_*.glb, twisted_*.glb -- which carry real collision radii
 * in ASSET_COLLISION_OVERRIDES (meant for when they're placed deliberately
 * as actual bushes/ferns via the Random Tree Brush). Scattered densely as
 * grass filler, they turn walkable ground into a field of small invisible
 * obstacles -- this is the "grass has hitboxes" bug.
 *
 * These same models are ALSO legitimately placed by the Random Tree Brush
 * (REGION_FOLIAGE), so a plain "delete every instance of this model name"
 * pass would also remove real, intentional placements. There's no per-asset
 * flag recording which brush placed it, so this uses a density heuristic
 * instead: the grass brush fires every ~240ms while dragging and rolls a
 * random model from its biome list per cell, so a painted swath mixes
 * several ground-cover models tightly together -- a signature a few manual
 * tree-brush clicks (dispersed randomly over an 8m+ radius) essentially
 * never produces. An asset is treated as grass-brush leftover (and removed)
 * only if it has at least CLUSTER_MIN_NEIGHBORS neighbors of ANY
 * ground-cover model (not just the same one) within CLUSTER_RADIUS meters --
 * an isolated bush/fern/mushroom stays untouched.
 *
 * Writes a .bak copy of each region file before modifying it, and prints a
 * per-model before/after count so the result is reviewable.
 *
 * Usage:
 *   node scripts/cleanup-grass-collision-cover.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const regionsDir = path.join(root, "packages/shared/src/content/regionBlueprints");
const dryRun = process.argv.includes("--dry-run");

// Models the old grass brush used as biome ground-cover fill (see
// REGION_GRASS_COVER in the pre-patch-system git history) that also carry
// real collision in ASSET_COLLISION_OVERRIDES.
const GROUND_COVER_MODELS = new Set([
  "bush.glb",
  "bush_flowers.glb",
  "fern.glb",
  "mushroom.glb",
  "dead_1.glb",
  "dead_2.glb",
  "dead_3.glb",
  "rock_1.glb",
  "rock_2.glb",
  "rock_3.glb",
  "twisted_1.glb",
  "twisted_2.glb",
  "twisted_3.glb",
]);

const CLUSTER_RADIUS = 3;
const CLUSTER_MIN_NEIGHBORS = 3;

function dist2D(ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  return Math.sqrt(dx * dx + dz * dz);
}

function cleanupBlueprint(bp) {
  const assets = bp.assets ?? [];
  const removedIds = new Set();
  const perModel = new Map();

  // All ground-cover-tagged assets together, regardless of specific model --
  // the old brush rolled a random model per cell, so a painted swath mixes
  // several of these models tightly rather than clustering by exact model.
  const coverAssets = assets.filter((a) => GROUND_COVER_MODELS.has(a.model));

  for (const a of coverAssets) {
    let neighbors = 0;
    for (const b of coverAssets) {
      if (b === a) continue;
      if (dist2D(a.localX, a.localZ, b.localX, b.localZ) <= CLUSTER_RADIUS) neighbors++;
      if (neighbors >= CLUSTER_MIN_NEIGHBORS) break;
    }
    const entry = perModel.get(a.model) ?? { total: 0, removed: 0 };
    entry.total++;
    if (neighbors >= CLUSTER_MIN_NEIGHBORS) {
      removedIds.add(a.id);
      entry.removed++;
    }
    perModel.set(a.model, entry);
  }

  bp.assets = assets.filter((a) => !removedIds.has(a.id));
  return { removedCount: removedIds.size, perModel };
}

const files = fs.readdirSync(regionsDir).filter((f) => f.endsWith(".json"));
if (files.length === 0) {
  console.error(`No region blueprint files found in ${regionsDir}`);
  process.exit(1);
}

for (const file of files) {
  const filePath = path.join(regionsDir, file);
  const bp = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const { removedCount, perModel } = cleanupBlueprint(bp);

  if (removedCount === 0) {
    console.log(`${file}: no clustered ground-cover found, nothing to do.`);
    continue;
  }

  console.log(`${file}: removing ${removedCount} clustered ground-cover asset(s)`);
  for (const [model, { total, removed }] of perModel.entries()) {
    if (removed === 0) continue;
    console.log(`   ${model}: ${removed}/${total} removed (${total - removed} isolated instance(s) kept)`);
  }

  if (dryRun) {
    console.log(`   (dry run -- ${file} not modified)`);
    continue;
  }

  fs.copyFileSync(filePath, `${filePath}.bak`);
  fs.writeFileSync(filePath, JSON.stringify(bp, null, 2) + "\n");
  console.log(`   wrote ${file} (backup at ${file}.bak)`);
}
