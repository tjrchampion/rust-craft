#!/usr/bin/env node
/**
 * Import Quaternius Universal Base Characters' Hairstyles pack (the same
 * "Universal Base Characters[Standard]" download import-universal-base.mjs
 * pulls the body meshes from -- CC0, see that pack's License_Standard.txt)
 * into the client asset tree as modular hair/eyebrow pieces.
 *
 * Usage:
 *   node scripts/import-hairstyles.mjs "~/Downloads/Universal Base Characters[Standard]"
 *
 * Expects the pack's own folder layout: "<input>/Hairstyles/Rigged to Head
 * Bone/glTF (Godot -Unreal)/*.gltf" -- these are already skinned to the same
 * shared Universal rig skeleton as Regular_Male.glb/Regular_Female.glb (same
 * bone names: Head, spine_01/02/03, hand_l, etc, verified directly against
 * one file's skin/joints before writing this), so they attach via the exact
 * mechanism modularGear.ts already uses for outfit pieces -- no retargeting.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/import-hairstyles.mjs "<Universal Base Characters folder>"');
  process.exit(1);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "packages/client/public/assets/models/modular/Hair");

const candidateDirs = [
  path.join(path.resolve(input), "Hairstyles", "Rigged to Head Bone", "glTF (Godot -Unreal)"),
  path.join(path.resolve(input), "Hairstyles", "Origin at 0", "glTF (Godot)"),
];

const srcDir = candidateDirs.find((d) => fs.existsSync(d));

if (!srcDir) {
  console.error(`Could not find Hairstyles glTF folder in "${input}".`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

function fixTextureAliases(dir) {
  for (const bad of ["T_Hair_1_Normal_png.png", "T_Hair_2_Normal_png.png", "T_Hair_1_BaseColor_png.png", "T_Hair_2_BaseColor_png.png"]) {
    const good = bad.replace("_png.png", ".png");
    const target = path.join(dir, good);
    const link = path.join(dir, bad);
    if (fs.existsSync(target) && !fs.existsSync(link)) fs.symlinkSync(good, link);
  }
}

function findGltfFiles(dir) {
  let results = [];
  fixTextureAliases(dir);
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      results = results.concat(findGltfFiles(p));
    } else if (ent.isFile() && ent.name.endsWith(".gltf")) {
      results.push(p);
    }
  }
  return results;
}

const gltfFiles = findGltfFiles(srcDir);
const require = createRequire(path.join(root, "packages/client/package.json"));
const { NodeIO } = await import(pathToFileURL(require.resolve("@gltf-transform/core")).href);
const io = new NodeIO();

for (const src of gltfFiles) {
  const baseName = path.basename(src, ".gltf");
  const dest = path.join(outDir, `${baseName}.glb`);
  try {
    const doc = await io.read(src);
    await io.write(dest, doc);
    console.log("Imported", baseName);
  } catch (err) {
    console.warn(`Could not import ${baseName}:`, err.message);
  }
}

console.log(`Done — ${gltfFiles.length} hair/eyebrow pieces are in packages/client/public/assets/models/modular/Hair/`);
