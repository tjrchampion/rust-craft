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
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/import-hairstyles.mjs "<Universal Base Characters[Standard] folder>"');
  process.exit(1);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "packages/client/public/assets/models/modular/Hair");
const srcDir = path.join(path.resolve(input), "Hairstyles", "Rigged to Head Bone", "glTF (Godot -Unreal)");

if (!fs.existsSync(srcDir)) {
  console.error(`Could not find "${srcDir}" -- check the input folder is the pack's top-level dir.`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

// Quaternius glTF sometimes references *_png.png; symlink to the real file,
// same fixup import-universal-base.mjs applies to the body meshes.
function fixTextureAliases(dir) {
  for (const bad of ["T_Hair_1_Normal_png.png", "T_Hair_2_Normal_png.png", "T_Hair_1_BaseColor_png.png", "T_Hair_2_BaseColor_png.png"]) {
    const good = bad.replace("_png.png", ".png");
    const target = path.join(dir, good);
    const link = path.join(dir, bad);
    if (fs.existsSync(target) && !fs.existsSync(link)) fs.symlinkSync(good, link);
  }
}
fixTextureAliases(srcDir);

const PIECES = [
  "Hair_Buzzed",
  "Hair_BuzzedFemale",
  "Hair_Long",
  "Hair_SimpleParted",
  "Hair_Buns",
  "Hair_Beard",
  "Eyebrows_Regular",
  "Eyebrows_Female",
];

for (const name of PIECES) {
  const src = path.join(srcDir, `${name}.gltf`);
  if (!fs.existsSync(src)) {
    console.warn(`! ${name}.gltf not found in pack, skipping`);
    continue;
  }
  const dest = path.join(outDir, `${name}.glb`);
  execSync(`npx --yes @gltf-transform/cli copy "${src}" "${dest}"`, { stdio: "inherit", cwd: root });
  console.log("Imported", name);
}

console.log("Done — hair/eyebrow pieces are in packages/client/public/assets/models/modular/Hair/");
