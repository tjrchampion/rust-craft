#!/usr/bin/env node
/**
 * Offline collision-geometry extractor (Phase A of the BVH-collision plan).
 *
 * Walks the region-placeable model files, merges every mesh primitive's
 * triangles into a single MODEL-LOCAL, pre-scale indexed soup (applying each
 * gltf node's world matrix so nested/instanced transforms are baked exactly
 * as three.js would render them), and writes a compact BINARY blob per model
 * plus a small JSON index into packages/client/public/assets/collision/.
 *
 * The runtime (client fetch + headless server fs-read) transforms this local
 * soup by each placed asset's live TRS + region world origin to build a
 * three-mesh-bvh MeshBVH per region. Stored per-MODEL (not per-placement) and
 * as generated, GIT-IGNORED data — collision is a pure function of the
 * already-committed source models, so there is no reason to bloat git. Run via
 * `pnpm collision:extract` (also wired into predev/prebuild). If the data is
 * absent, the runtime falls back to the analytic box/circle colliders.
 *
 * Scope: structural/solid assets only — all of buildings, plus rock-like
 * models (rocks, Rock_, rock_single_, stone_N) under props|nature|foliage.
 * Trees/decor keep the analytic trunk-circle fallback (full-mesh collision on
 * a canopy would wrongly block the player on leaves). Expand SCAN below to add
 * more. Meshopt-compressed models are skipped (no decoder here) and fall back.
 *
 * Binary per-model format (little-endian):
 *   u32 vertCount | u32 indexCount | f32[vertCount*3] xyz | u32[indexCount]
 *
 * Usage:  node scripts/extract-collision.mjs [--verbose]
 */
import { readdirSync, statSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { resolve, relative, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MODELS_DIR = resolve(REPO, "packages/client/public/assets/models");
const OUT_DIR = resolve(REPO, "packages/client/public/assets/collision");
const DATA_DIR = resolve(OUT_DIR, "data");
const VERBOSE = process.argv.includes("--verbose");

// Rock-like predicate — mirrors isRockLikeAssetModel() in shared/content/regions.ts.
const ROCK_RE = /(^|[/])(rocks?(_|\.|$)|rock(_medium|_large|_small)?(_|\.|$)|rock_single_|stone_\d+)/i;

/** Which files to extract. dir = subdir under assets/models; filter optional. */
const SCAN = [
  { dir: "buildings", filter: () => true },
  { dir: "props", filter: (rel) => ROCK_RE.test(rel) },
  { dir: "nature", filter: (rel) => ROCK_RE.test(rel) },
  { dir: "foliage", filter: (rel) => ROCK_RE.test(rel) },
];

const QUIET_LOGGER = { debug() {}, info() {}, warn() {}, error: (m) => console.error(m) };

function loadNodeIO() {
  const core = require.resolve("@gltf-transform/core", { paths: [resolve(REPO, "packages/client")] });
  return import(pathToFileURL(core).href).then((m) => m.NodeIO);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (/\.(gltf|glb)$/i.test(name)) out.push(full);
  }
  return out;
}

/** Column-major mat4 (gltf/three convention) applied to a vec3, into `out`. */
function applyMat4(m, x, y, z, out) {
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
}

/** Merge all triangles of a gltf Document into one world-baked local soup. */
function extractSoup(doc) {
  const root = doc.getRoot();
  const verts = []; // flat x,y,z
  const indices = [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const el = [0, 0, 0];
  const w = [0, 0, 0];

  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const wm = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const mode = prim.getMode?.();
      if (mode !== undefined && mode !== 4) continue; // triangles only
      const pos = prim.getAttribute("POSITION");
      if (!pos) continue;
      const base = verts.length / 3;
      const count = pos.getCount();
      for (let i = 0; i < count; i++) {
        pos.getElement(i, el);
        applyMat4(wm, el[0], el[1], el[2], w);
        verts.push(w[0], w[1], w[2]);
        if (w[0] < min[0]) min[0] = w[0]; if (w[0] > max[0]) max[0] = w[0];
        if (w[1] < min[1]) min[1] = w[1]; if (w[1] > max[1]) max[1] = w[1];
        if (w[2] < min[2]) min[2] = w[2]; if (w[2] > max[2]) max[2] = w[2];
      }
      const idxAcc = prim.getIndices();
      if (idxAcc) {
        const n = idxAcc.getCount();
        for (let i = 0; i < n; i++) indices.push(base + idxAcc.getScalar(i));
      } else {
        for (let i = 0; i < count; i++) indices.push(base + i);
      }
    }
  }
  return { verts, indices, min, max };
}

const R = 1e4;
const rnd = (v) => Math.round(v * R) / R;

/** Pack a soup into the little-endian binary blob. */
function packBinary(verts, indices) {
  const vc = verts.length / 3;
  const ic = indices.length;
  const buf = new ArrayBuffer(8 + vc * 3 * 4 + ic * 4);
  const head = new Uint32Array(buf, 0, 2);
  head[0] = vc; head[1] = ic;
  const pos = new Float32Array(buf, 8, vc * 3);
  for (let i = 0; i < pos.length; i++) pos[i] = rnd(verts[i]);
  const idx = new Uint32Array(buf, 8 + vc * 3 * 4, ic);
  for (let i = 0; i < ic; i++) idx[i] = indices[i];
  return Buffer.from(buf);
}

async function main() {
  // predev fast-path: skip regeneration when data already exists.
  if (process.argv.includes("--if-missing") && existsSync(join(OUT_DIR, "index.json"))) {
    console.log("collision extraction: index.json present, skipping (--if-missing).");
    return;
  }

  const NodeIO = await loadNodeIO();
  const io = new NodeIO().setLogger(QUIET_LOGGER);

  if (existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });

  const index = {};
  let processed = 0, skippedEmpty = 0, failed = 0, totalTris = 0, totalBytes = 0;

  for (const { dir, filter } of SCAN) {
    const rootDir = join(MODELS_DIR, dir);
    if (!existsSync(rootDir)) continue;
    for (const file of walk(rootDir)) {
      const key = relative(MODELS_DIR, file).split(sep).join("/");
      const relInDir = relative(rootDir, file).split(sep).join("/");
      if (!filter(relInDir)) continue;
      try {
        const doc = await io.read(file);
        const soup = extractSoup(doc);
        const triCount = soup.indices.length / 3;
        if (triCount === 0) { skippedEmpty++; continue; }
        const safe = key.replace(/[/]/g, "__");
        const blob = packBinary(soup.verts, soup.indices);
        writeFileSync(join(DATA_DIR, `${safe}.bin`), blob);
        index[key] = {
          file: `data/${safe}.bin`,
          tris: triCount,
          verts: soup.verts.length / 3,
          aabb: { min: soup.min.map(rnd), max: soup.max.map(rnd) },
        };
        totalTris += triCount;
        totalBytes += blob.length;
        processed++;
        if (VERBOSE) console.log(`  ${key}  (${triCount} tris, ${blob.length} B)`);
      } catch (e) {
        failed++;
        if (VERBOSE || !/EXT_meshopt_compression/.test(e.message)) {
          console.warn(`  ! skipped ${key}: ${e.message}`);
        }
      }
    }
  }

  writeFileSync(
    join(OUT_DIR, "index.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), count: processed, models: index }) + "\n",
  );

  console.log(
    `collision extraction: ${processed} models, ${totalTris} tris, ` +
    `${(totalBytes / 1e6).toFixed(1)} MB (${skippedEmpty} empty, ${failed} skipped) ` +
    `→ ${relative(REPO, OUT_DIR)}`,
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
