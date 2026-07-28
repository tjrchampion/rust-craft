#!/usr/bin/env node
/**
 * Optional dev mesh from the UAL file (yellow mannequin). Do NOT use as the player base —
 * run import-universal-base.mjs for Regular_Male/Female from Quaternius Universal Base.
 */
import { NodeIO } from "@gltf-transform/core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ual = path.join(root, "packages/client/public/assets/models/animations/UAL1_Standard.glb");
const outDir = path.join(root, "packages/client/public/assets/models/modular/base");

const io = new NodeIO();
const doc = await io.read(ual);
for (const anim of doc.getRoot().listAnimations()) anim.dispose();
await io.write(path.join(outDir, "UAL_Mannequin_Mesh.glb"), doc);
console.log("Wrote UAL_Mannequin_Mesh.glb (rig reference only — not used in-game).");
