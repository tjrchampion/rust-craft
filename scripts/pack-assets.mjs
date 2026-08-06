import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const modelsDir = path.resolve(__dirname, "../packages/client/public/assets/models");
const outputDir = path.resolve(__dirname, "../packages/client/public/assets");
const indexPath = path.join(outputDir, "assets_index.json");
const packPath = path.join(outputDir, "assets.rcpack");

function findGlbFiles(dir, baseDir = dir) {
  let files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(findGlbFiles(fullPath, baseDir));
    } else if (entry.isFile() && entry.name.endsWith(".glb")) {
      const relPath = "/assets/models/" + path.relative(baseDir, fullPath).replace(/\\/g, "/");
      files.push({ fullPath, relPath });
    }
  }
  return files;
}

async function buildPack() {
  // `--if-missing`: skip the (multi-hundred-MB) rebuild when the pack + index
  // already exist. The pack is a gitignored build artifact, so this makes dev
  // startup instant after the first build; run `pnpm pack:assets` (no flag) to
  // force a rebuild after changing/adding .glb models.
  if (process.argv.includes("--if-missing") && fs.existsSync(packPath) && fs.existsSync(indexPath)) {
    console.log("[pack-assets] Pack already present — skipping (pass no --if-missing to force a rebuild).");
    return;
  }
  console.log(`[pack-assets] Scanning ${modelsDir} for .glb models...`);
  const files = findGlbFiles(modelsDir);
  console.log(`[pack-assets] Found ${files.length} .glb model files.`);

  const index = {};
  const chunks = [];
  let currentOffset = 0;

  for (const file of files) {
    const buffer = fs.readFileSync(file.fullPath);
    const size = buffer.length;
    index[file.relPath] = {
      offset: currentOffset,
      size,
    };
    chunks.push(buffer);
    currentOffset += size;
  }

  const packedBuffer = Buffer.concat(chunks);

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  fs.writeFileSync(packPath, packedBuffer);

  const mb = (packedBuffer.length / (1024 * 1024)).toFixed(2);
  console.log(`[pack-assets] Complete! Created ${packPath} (${mb} MB, ${files.length} assets packed).`);
}

buildPack().catch((err) => {
  console.error("[pack-assets] Error building pack:", err);
  process.exit(1);
});
