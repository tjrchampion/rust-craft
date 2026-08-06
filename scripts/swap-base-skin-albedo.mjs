#!/usr/bin/env node
/**
 * The Universal Base "Superhero" GLBs ship with the painted costume albedo
 * (Dark). The pack also includes Light albedos that are bare skin (+ minimal
 * underwear). Swap Dark → Light so unequipped characters look unclothed
 * instead of wearing the baked green suit.
 *
 * Usage: node scripts/swap-base-skin-albedo.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const baseDir = path.join(root, "packages/client/public/assets/models/modular/base");

const require = createRequire(path.join(root, "packages/client/package.json"));
const { NodeIO } = await import(pathToFileURL(require.resolve("@gltf-transform/core")).href);

const candidates = [
  path.join("/Users/champion/Development/Assets/Universal Base Characters[Source]/Base Characters/Textures"),
  path.join("/Users/champion/Downloads/Universal Base Characters[Standard]/Base Characters/Textures"),
  path.join("/Users/champion/Development/Assets/Universal Base Characters[Standard]/Base Characters/Textures"),
];

function findTex(name) {
  for (const dir of candidates) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`Texture not found: ${name}`);
}

async function swap(glbName, lightFile, matMatch) {
  const glbPath = path.join(baseDir, glbName);
  if (!fs.existsSync(glbPath)) return;
  const lightBytes = fs.readFileSync(findTex(lightFile));
  const io = new NodeIO();
  const doc = await io.read(glbPath);
  let swapped = 0;
  for (const mat of doc.getRoot().listMaterials()) {
    const name = mat.getName() ?? "";
    if (matMatch && !matMatch.test(name)) continue;
    const tex = mat.getBaseColorTexture();
    if (!tex) continue;
    tex.setImage(lightBytes);
    tex.setMimeType("image/png");
    tex.setName(lightFile.replace(/\.[^.]+$/, ""));
    swapped++;
  }
  if (swapped > 0) {
    await io.write(glbPath, doc);
    console.log(`Updated ${glbName} → ${lightFile} (${swapped} material(s))`);
  }
}

await swap("Regular_Male.glb", "T_Superhero_Male_Ligh.png", /Superhero_Male|Regular_Male/i);
await swap("Regular_Female.glb", "T_Superhero_Female_Light_BaseColor.png", /Superhero_Female|Regular_Female/i);
await swap("Superhero_Male.glb", "T_Superhero_Male_Ligh.png", /Superhero_Male/i);
await swap("Superhero_Female.glb", "T_Superhero_Female_Light_BaseColor.png", /Superhero_Female/i);
await swap("Teen_Male.glb", "T_Teen_Male_Light_BaseColor.png", /Teen_Male/i);
await swap("Teen_Female.glb", "T_Teen_Female_Light_BaseColor.png", /Teen_Female/i);
console.log("Done. Hard-refresh the client to pick up the new base GLBs.");
