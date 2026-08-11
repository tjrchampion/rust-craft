/**
 * Convert external `.gltf` (+ `.bin` + `.png`) models into self-contained `.glb`
 * with KTX2 / Basis Universal textures.
 *
 * WHY: models shipped as `.gltf` + external PNG bypass BOTH of the project's
 * asset optimisations -- the `.rcpack` bundle (pack-assets only concatenates
 * `.glb`, so these load as per-file GETs) and KTX2 compression (compress-assets
 * only touches `.glb`). Their PNG maps therefore upload UNCOMPRESSED via
 * texImage2D (+ mipmap generation) on first render, a multi-hundred-ms frame
 * stall when a region streams in. Converting them to `.glb` + KTX2 routes them
 * through the pack AND uploads them compressed (GPU-native, no CPU decode).
 *
 * WHAT: for every `X.gltf` under the models dir this writes `X.glb` next to it
 * (external `.bin`/`.png` are read + embedded by gltf-transform) with the same
 * two-pass Basis encoding compress-assets uses:
 *   - baseColor (sRGB colour)          -> ETC1S  (smallest, perceptual)
 *   - normal / MR / occlusion / emissive (linear) -> UASTC (preserves data)
 * A manifest (`models/glb-manifest.json`) lists the converted source paths; the
 * client loader swaps a requested `.gltf` for its `.glb` twin when it's listed
 * (see assetPack.ts remapToGlb + gltf.ts load), so NO blueprint/content
 * references change. Sources are left in place as a fallback.
 *
 * Idempotent: a model whose `.glb` is already newer than its `.gltf` is skipped,
 * so re-runs after adding a few models finish quickly.
 *
 * Requires the KTX-Software CLI (`ktx`/`toktx`) -- bundled in tools/bin. Without
 * it, falls back to WebP-textured `.glb` (smaller download, but textures still
 * upload uncompressed -- KTX2 is the upload win, so install ktx for the real fix).
 *
 * Usage:  node scripts/convert-gltf-glb.mjs [--force]
 * (or `pnpm models:glb`)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Bundled KTX-Software binaries (toktx/ktx) used by the Basis encoders.
const toolsBin = path.resolve(__dirname, "../tools/bin");
if (fs.existsSync(toolsBin)) process.env.PATH = `${toolsBin}:${process.env.PATH}`;

const modelsDir = path.resolve(__dirname, "../packages/client/public/assets/models");
const manifestPath = path.join(modelsDir, "glb-manifest.json");
const force = process.argv.includes("--force");

function hasKtx() {
  try {
    const res = spawnSync("command", ["-v", "ktx"], { shell: true, encoding: "utf-8" });
    return res.status === 0 && res.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

function findGltfFiles(dir) {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out = out.concat(findGltfFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".gltf")) out.push(full);
  }
  return out;
}

/** True when X.glb already exists and is at least as new as X.gltf. */
function upToDate(gltfPath, glbPath) {
  if (!fs.existsSync(glbPath)) return false;
  return fs.statSync(glbPath).mtimeMs >= fs.statSync(gltfPath).mtimeMs;
}

function convert(gltfPath, glbPath, ktx) {
  const tmpMid = glbPath + ".p1.glb";
  const tmpOut = glbPath + ".tmp.glb";
  try {
    if (ktx) {
      // Two-pass Basis, matching compress-assets.mjs. ETC1S is an sRGB colour
      // codec -- running it over non-colour maps mangles them, so baseColor goes
      // ETC1S and everything else UASTC (--rdo/--zstd keep UASTC's size down).
      execSync(`npx @gltf-transform/cli etc1s "${gltfPath}" "${tmpMid}" --slots baseColorTexture`, { stdio: "ignore" });
      execSync(`npx @gltf-transform/cli uastc "${tmpMid}" "${tmpOut}" --slots '!baseColorTexture' --level 2 --rdo 4 --zstd 18`, { stdio: "ignore" });
    } else {
      // No KTX toolchain: still pack to a single .glb (kills the per-file GETs)
      // with WebP textures (smaller download). Upload stays uncompressed.
      execSync(`npx @gltf-transform/cli optimize "${gltfPath}" "${tmpOut}" --texture-compress webp`, { stdio: "ignore" });
    }
    if (!fs.existsSync(tmpOut)) return false;
    fs.renameSync(tmpOut, glbPath);
    return true;
  } catch (err) {
    console.warn(`[convert-gltf-glb] failed: ${path.relative(modelsDir, gltfPath)} -- ${err?.message ?? err}`);
    return false;
  } finally {
    for (const f of [tmpMid, tmpOut]) if (fs.existsSync(f)) fs.unlinkSync(f);
  }
}

function main() {
  if (!fs.existsSync(modelsDir)) {
    console.error(`[convert-gltf-glb] models dir not found: ${modelsDir}`);
    process.exit(1);
  }
  const ktx = hasKtx();
  console.log(`[convert-gltf-glb] KTX-Software available: ${ktx ? "YES (KTX2/Basis)" : "NO (WebP fallback -- textures still upload uncompressed)"}`);

  const gltfFiles = findGltfFiles(modelsDir);
  console.log(`[convert-gltf-glb] Found ${gltfFiles.length} .gltf model(s).`);

  const manifest = [];
  let converted = 0;
  let skipped = 0;
  let failed = 0;

  for (const gltfPath of gltfFiles) {
    const glbPath = gltfPath.slice(0, -".gltf".length) + ".glb";
    const rel = path.relative(modelsDir, gltfPath).replace(/\\/g, "/");

    if (!force && upToDate(gltfPath, glbPath)) {
      manifest.push(rel);
      skipped++;
      continue;
    }
    if (convert(gltfPath, glbPath, ktx)) {
      manifest.push(rel);
      converted++;
      if (converted % 20 === 0) console.log(`[convert-gltf-glb] Converted ${converted}...`);
    } else {
      failed++;
    }
  }

  manifest.sort();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 0) + "\n");
  console.log(
    `[convert-gltf-glb] Done: ${converted} converted, ${skipped} up-to-date, ${failed} failed. ` +
      `Manifest: ${manifest.length} model(s) -> ${path.relative(process.cwd(), manifestPath)}`,
  );
  if (converted > 0) {
    console.log("[convert-gltf-glb] Rebuild the asset pack to include the new .glb: pnpm pack:assets");
  }
}

main();
