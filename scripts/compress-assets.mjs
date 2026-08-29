import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const toolsBin = path.resolve(__dirname, "../tools/bin");
if (fs.existsSync(toolsBin)) {
  process.env.PATH = `${toolsBin}:${process.env.PATH}`;
}

const modelsDir = path.resolve(__dirname, "../packages/client/public/assets/models");
const outputDir = path.resolve(__dirname, "../packages/client/public/assets");
const indexPath = path.join(outputDir, "assets_index.json");
const packPath = path.join(outputDir, "assets.rcpack");

function checkKtxAvailable() {
  try {
    const res = spawnSync("command", ["-v", "ktx"], { shell: true, encoding: "utf-8" });
    return res.status === 0 && res.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

// modular/base/*.glb (the shared player-body rigs -- Regular/Teen/Superhero
// Male/Female) visibly broke after KTX2 compression (reported in-game after
// running this script against the full library) -- skip them until that's
// root-caused. Every other modular/* piece (Hair, etc.) compressed fine.
const EXCLUDED_DIRS = [path.join("modular", "base")];

function findGlbFiles(dir) {
  let files = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.some((excluded) => fullPath.includes(excluded))) continue;
      files = files.concat(findGlbFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".glb")) {
      files.push(fullPath);
    }
  }
  return files;
}

async function compressAndPack() {
  const hasKtx = checkKtxAvailable();
  console.log(`[compress-assets] KTX-Software (Basis Universal) CLI available: ${hasKtx ? "YES (using KTX2 Basis Universal)" : "NO (using WebP + Meshopt)"}`);

  const glbFiles = findGlbFiles(modelsDir);
  console.log(`[compress-assets] Found ${glbFiles.length} .glb model files.`);

  let totalBefore = 0;
  let totalAfter = 0;
  let processed = 0;

  let skipped = 0;
  for (const file of glbFiles) {
    const statBefore = fs.statSync(file);
    totalBefore += statBefore.size;

    // Idempotency: when compressing to KTX2, skip models whose textures are
    // already Basis-encoded (the KHR_texture_basisu extension id lives in the
    // glTF JSON chunk near the file head). Lets re-runs after adding a few new
    // models finish in seconds instead of re-encoding the whole library.
    if (hasKtx) {
      const headLen = Math.min(statBefore.size, 65536);
      const head = Buffer.alloc(headLen);
      const fd = fs.openSync(file, "r");
      fs.readSync(fd, head, 0, headLen, 0);
      fs.closeSync(fd);
      if (head.includes("KHR_texture_basisu")) {
        totalAfter += statBefore.size;
        skipped++;
        processed++;
        continue;
      }
    }

    // Use a temp file for output before replacing (plus an intermediate for
    // the KTX2 two-pass).
    const tmpFile = file + ".tmp.glb";
    const tmpMid = file + ".p1.glb";

    try {
      if (hasKtx) {
        // Two-pass KTX2 so each texture gets the correct Basis bitstream:
        //  - baseColor (sRGB colour data) -> ETC1S: smallest, perceptual.
        //  - everything else (normal, metallic-roughness, occlusion, emissive
        //    -- linear / non-colour data) -> UASTC.
        // ETC1S is an sRGB colour codec: running it over non-colour maps
        // mangles them, and a corrupted metallic-roughness map makes skin
        // render as flat grey metal (there's no env map to reflect). UASTC
        // preserves those maps; --rdo + --zstd keep the size reasonable.
        execSync(`npx @gltf-transform/cli etc1s "${file}" "${tmpMid}" --slots baseColorTexture`, { stdio: "ignore" });
        execSync(`npx @gltf-transform/cli uastc "${tmpMid}" "${tmpFile}" --slots '!baseColorTexture' --level 2 --rdo 4 --zstd 18`, { stdio: "ignore" });
      } else {
        execSync(`npx @gltf-transform/cli optimize "${file}" "${tmpFile}" --texture-compress webp`, { stdio: "ignore" });
      }
      if (fs.existsSync(tmpFile)) {
        const statAfter = fs.statSync(tmpFile);
        if (statAfter.size < statBefore.size) {
          fs.renameSync(tmpFile, file);
          totalAfter += statAfter.size;
        } else {
          // Keep original if compressed version ended up larger (still correct
          // -- an uncompressed PNG renders fine, just bigger).
          fs.unlinkSync(tmpFile);
          totalAfter += statBefore.size;
        }
      } else {
        totalAfter += statBefore.size;
      }
    } catch (err) {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      totalAfter += statBefore.size;
    } finally {
      if (fs.existsSync(tmpMid)) fs.unlinkSync(tmpMid);
    }

    processed++;
    if (processed % 25 === 0 || processed === glbFiles.length) {
      console.log(`[compress-assets] Processed ${processed}/${glbFiles.length} models...`);
    }
  }

  const mbBefore = (totalBefore / (1024 * 1024)).toFixed(2);
  const mbAfter = (totalAfter / (1024 * 1024)).toFixed(2);
  const percent = (((totalBefore - totalAfter) / totalBefore) * 100).toFixed(1);

  console.log(`[compress-assets] Compression summary: ${mbBefore} MB -> ${mbAfter} MB (${percent}% reduction)${skipped ? `, ${skipped} already-KTX2 skipped` : ""}`);

  console.log("[compress-assets] Rebuilding assets.rcpack...");
  execSync("node scripts/pack-assets.mjs", { stdio: "inherit" });
}

compressAndPack().catch((err) => {
  console.error("[compress-assets] Error:", err);
  process.exit(1);
});
