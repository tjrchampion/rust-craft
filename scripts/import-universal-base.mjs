#!/usr/bin/env node
/**
 * Import Quaternius Universal Base Characters into the client asset tree.
 *
 * Accepts either the [Standard] zip or an extracted folder, e.g.:
 *   node scripts/import-universal-base.mjs ~/Downloads/Universal\ Base\ Characters\[Standard]
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const input = process.argv[2];
if (!input) {
  console.error(
    "Usage: node scripts/import-universal-base.mjs <Universal Base Characters[Standard].zip|folder>",
  );
  process.exit(1);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "packages/client/public/assets/models/modular/base");
let workDir = path.resolve(input);
let tmpDir = null;

if (input.endsWith(".zip")) {
  tmpDir = fs.mkdtempSync(path.join(root, ".tmp-ubc-"));
  execSync(`unzip -q "${path.resolve(input)}" -d "${tmpDir}"`, { stdio: "inherit" });
  workDir = tmpDir;
}

function findFile(...names) {
  const hits = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (names.includes(ent.name)) hits.push(p);
    }
  };
  walk(workDir);
  return hits[0] ?? null;
}

/** Quaternius glTF sometimes references *_png.png; symlink to the real file. */
function fixTextureAliases(dir) {
  const pairs = [
    ["T_Hair_1_Normal_png.png", "T_Hair_1_Normal.png"],
    ["T_Eye_Normal_png.png", "T_Eye_Normal.png"],
  ];
  for (const [bad, good] of pairs) {
    const target = path.join(dir, good);
    const link = path.join(dir, bad);
    if (fs.existsSync(target) && !fs.existsSync(link)) {
      fs.symlinkSync(good, link);
    }
  }
}

const targets = [
  ["Regular_Male_FullBody.gltf", "Regular_Male.glb"],
  ["Regular_Female_FullBody.gltf", "Regular_Female.glb"],
  ["Superhero_Male_FullBody.gltf", "Superhero_Male.glb"],
  ["Superhero_Female_FullBody.gltf", "Superhero_Female.glb"],
  ["Teen_Male_FullBody.gltf", "Teen_Male.glb"],
  ["Teen_Female_FullBody.gltf", "Teen_Female.glb"],
];

const importsToPerform = [];
for (const [gltfName, destName] of targets) {
  const src = findFile(gltfName);
  if (src) {
    fixTextureAliases(path.dirname(src));
    importsToPerform.push([src, destName]);
  } else {
    console.warn(`! Warning: ${gltfName} not found in ${input}`);
  }
}

if (importsToPerform.length === 0) {
  console.error("Could not find any base character glTF files in", input);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

const require = createRequire(path.join(root, "packages/client/package.json"));
const { NodeIO } = await import(pathToFileURL(require.resolve("@gltf-transform/core")).href);
const io = new NodeIO();

for (const [src, destName] of importsToPerform) {
  const dest = path.join(outDir, destName);
  const doc = await io.read(src);
  for (const anim of doc.getRoot().listAnimations()) anim.dispose();
  await io.write(dest, doc);
  console.log("Imported", destName, "from", path.basename(src));
}

if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });

// The freshly-imported base is one monolithic full-body mesh; split it into
// per-region nodes so modular clothing can swap out (hide) exactly the skin
// it covers instead of overlaying on top of it. See that script's header
// comment for why, and gltf.ts's autoManageBodySkin() for the runtime side.
execSync("node scripts/split-universal-base.mjs", { stdio: "inherit", cwd: root });

console.log("Done — players now use these meshes from modular/base/Regular_*.glb");
