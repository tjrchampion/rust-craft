#!/usr/bin/env node
import { NodeIO } from "@gltf-transform/core";
import path from "node:path";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/strip-glb-animations.mjs <file.glb>");
  process.exit(1);
}

const io = new NodeIO();
const doc = await io.read(path.resolve(file));
for (const anim of doc.getRoot().listAnimations()) anim.dispose();
await io.write(path.resolve(file), doc);
console.log(`Stripped animations from ${file}`);
