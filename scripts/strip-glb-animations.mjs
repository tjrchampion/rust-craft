import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, "..", "packages/client/package.json"));
const { NodeIO } = await import(pathToFileURL(require.resolve("@gltf-transform/core")).href);

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
