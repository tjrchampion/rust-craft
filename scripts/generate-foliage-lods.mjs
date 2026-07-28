#!/usr/bin/env node
/**
 * Generate a low-poly "distant LOD" variant of every foliage asset (trees,
 * rocks, bushes), used by RegionInteriorRenderer's always-on impostor layer
 * so far-away foliage keeps its real silhouette instead of a generic
 * cone-and-trunk placeholder. Run once whenever a foliage asset is added or
 * replaced -- output is committed, not regenerated at build time (same
 * convention as the other one-off scripts/*.mjs asset-processing scripts).
 *
 * Parameters below were picked by inspecting oak_1.glb's actual simplify
 * output: --simplify-error 0.15 keeps the bounding box within ~10% of the
 * original (silhouette intact) while cutting vertex count ~85%; error
 * tolerances above ~0.3 started visibly shrinking the tree's shape, so this
 * stays well under that.
 *
 * Usage:
 *   node scripts/generate-foliage-lods.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = path.join(root, "packages/client/public/assets/models/foliage");
const outDir = path.join(srcDir, "lod");

fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(srcDir).filter((f) => f.endsWith(".glb"));
if (files.length === 0) {
  console.error(`No .glb files found in ${srcDir}`);
  process.exit(1);
}

for (const file of files) {
  const src = path.join(srcDir, file);
  const dest = path.join(outDir, file);
  execSync(
    `npx --yes @gltf-transform/cli optimize "${src}" "${dest}" ` +
      `--simplify-ratio 0.05 --simplify-error 0.15 --texture-compress false`,
    { stdio: "inherit", cwd: root },
  );
  console.log("Generated LOD for", file);
}

console.log(`Done — ${files.length} foliage LOD variants written to ${path.relative(root, outDir)}/`);
