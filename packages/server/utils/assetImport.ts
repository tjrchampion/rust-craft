/**
 * In-app asset importer backing the Region Editor's drag-and-drop uploader.
 * Saves an uploaded .glb into packages/client/public/assets/models/, extracts
 * its BVH collision soup the same way scripts/extract-collision.mjs does
 * (same binary format + index.json, merged in rather than a full rewrite so
 * concurrent/repeat imports don't clobber the existing library's entries),
 * and best-effort KTX2-compresses its textures via the same tools/bin/ktx +
 * @gltf-transform/cli pipeline scripts/compress-assets.mjs uses. Both steps
 * only ever touch the single uploaded file -- nothing here rebuilds
 * assets.rcpack; a freshly written model is absent from that pack's index,
 * which the client's asset loader already handles by falling back to a plain
 * per-file GET (see render/assetPack.ts), so it's placeable immediately
 * without a pack rebuild.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { NodeIO, type Document } from "@gltf-transform/core";
import type { RegionAssetCategory } from "@rustcraft/shared";
import { CATEGORY_ASSET_DIR, invalidateCollisionCache } from "./collision";

const exec = promisify(execCb);

function repoRoot(): string {
  // Nitro's cwd is the repo root under `pnpm dev`, but differs for other
  // invocation shapes -- same 3-candidate resolver pattern as utils/regions.ts
  // and utils/collision.ts, generalized to walk up from whichever candidate
  // for packages/client/public exists.
  const cwd = process.cwd();
  const candidates = [cwd, resolve(cwd, ".."), resolve(cwd, "../..")];
  for (const dir of candidates) {
    if (existsSync(resolve(dir, "packages/client/public/assets/models"))) return dir;
  }
  return cwd;
}

function modelsDir(): string {
  return resolve(repoRoot(), "packages/client/public/assets/models");
}

function collisionDir(): string {
  return resolve(repoRoot(), "packages/client/public/assets/collision");
}

/** "My Prop!! v2.glb" -> "my_prop_v2.glb"; always ends in .glb, never empty. */
export function sanitizeAssetFilename(rawName: string): string {
  const base = rawName.split(/[/\\]/).pop() ?? "";
  const withoutExt = base.replace(/\.(glb|gltf)$/i, "");
  const safe = withoutExt
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${safe || `asset_${Date.now()}`}.glb`;
}

export function isValidCategory(v: unknown): v is RegionAssetCategory {
  return v === "building" || v === "foliage" || v === "prop";
}

/** Binary glTF files start with the 4-byte magic "glTF" (0x46546C67 LE). */
export function isBinaryGlb(data: Buffer): boolean {
  return data.length >= 4 && data.readUInt32LE(0) === 0x46546c67;
}

export interface SavedModel {
  /** Path relative to the category's model dir, e.g. "imported/my_prop.glb". */
  relPath: string;
  absPath: string;
  url: string;
}

export function saveUploadedModel(
  category: RegionAssetCategory,
  filename: string,
  data: Buffer,
  overwrite: boolean,
): SavedModel {
  const dir = join(modelsDir(), CATEGORY_ASSET_DIR[category], "imported");
  mkdirSync(dir, { recursive: true });
  const absPath = join(dir, filename);
  if (existsSync(absPath) && !overwrite) {
    throw Object.assign(new Error("An asset with this name already exists."), { code: "EXISTS" });
  }
  writeFileSync(absPath, data);
  const relPath = `imported/${filename}`;
  return {
    relPath,
    absPath,
    url: `/assets/models/${CATEGORY_ASSET_DIR[category]}/${relPath}`,
  };
}

/** Remove a previously imported .glb and its collision data. Scoped to
 *  imported/ so this can never be pointed at the curated library. */
export function deleteUploadedModel(category: RegionAssetCategory, relPath: string): void {
  if (!relPath.startsWith("imported/") || relPath.includes("..")) {
    throw Object.assign(new Error("Only imported assets can be deleted."), { code: "NOT_IMPORTED" });
  }
  const absPath = join(modelsDir(), CATEGORY_ASSET_DIR[category], relPath);
  if (!existsSync(absPath)) {
    throw Object.assign(new Error("Model file not found."), { code: "NOT_FOUND" });
  }
  unlinkSync(absPath);
  removeCollisionEntry(category, relPath);
}

// ---- Collision extraction (mirrors scripts/extract-collision.mjs) ----

interface CollisionIndexEntry { file: string; tris: number; verts: number; aabb: { min: number[]; max: number[] } }
interface CollisionIndex { generatedAt: string; count: number; models: Record<string, CollisionIndexEntry> }

function applyMat4(m: ArrayLike<number>, x: number, y: number, z: number, out: number[]): void {
  out[0] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
  out[1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  out[2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
}

function extractSoup(doc: Document): { verts: number[]; indices: number[]; min: number[]; max: number[] } {
  const root = doc.getRoot();
  const verts: number[] = [];
  const indices: number[] = [];
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
        applyMat4(wm, el[0]!, el[1]!, el[2]!, w);
        verts.push(w[0]!, w[1]!, w[2]!);
        if (w[0]! < min[0]!) min[0] = w[0]!;
        if (w[0]! > max[0]!) max[0] = w[0]!;
        if (w[1]! < min[1]!) min[1] = w[1]!;
        if (w[1]! > max[1]!) max[1] = w[1]!;
        if (w[2]! < min[2]!) min[2] = w[2]!;
        if (w[2]! > max[2]!) max[2] = w[2]!;
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

const ROUND = 1e4;
const rnd = (v: number) => Math.round(v * ROUND) / ROUND;

function packBinary(verts: number[], indices: number[]): Buffer {
  const vc = verts.length / 3;
  const ic = indices.length;
  const buf = new ArrayBuffer(8 + vc * 3 * 4 + ic * 4);
  const head = new Uint32Array(buf, 0, 2);
  head[0] = vc;
  head[1] = ic;
  const pos = new Float32Array(buf, 8, vc * 3);
  for (let i = 0; i < pos.length; i++) pos[i] = rnd(verts[i]!);
  const idx = new Uint32Array(buf, 8 + vc * 3 * 4, ic);
  for (let i = 0; i < ic; i++) idx[i] = indices[i]!;
  return Buffer.from(buf);
}

/** Drop a model's collision entry (+ its .bin blob) from the shared index,
 *  used by deleteUploadedModel. No-ops if the model never got collision data
 *  (e.g. extraction failed or found no geometry at import time). */
function removeCollisionEntry(category: RegionAssetCategory, relPath: string): void {
  const dir = collisionDir();
  const key = `${CATEGORY_ASSET_DIR[category]}/${relPath}`;
  const index = loadCollisionIndex(dir);
  const entry = index.models[key];
  if (!entry) return;
  delete index.models[key];
  index.generatedAt = new Date().toISOString();
  index.count = Object.keys(index.models).length;
  writeFileSync(join(dir, "index.json"), JSON.stringify(index) + "\n");
  const binPath = join(dir, entry.file);
  if (existsSync(binPath)) rmSync(binPath, { force: true });
  invalidateCollisionCache();
}

function loadCollisionIndex(dir: string): CollisionIndex {
  const path = join(dir, "index.json");
  if (!existsSync(path)) return { generatedAt: new Date().toISOString(), count: 0, models: {} };
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as CollisionIndex;
  } catch {
    return { generatedAt: new Date().toISOString(), count: 0, models: {} };
  }
}

export type CollisionResult =
  | { ok: true; tris: number; verts: number }
  | { ok: false; reason: string };

/** Extract + merge collision data for one already-saved model. The importer
 *  always runs this regardless of asset category/name (unlike the batch
 *  script's rock-name filter for props/foliage, which exists to spare
 *  decorative canopies full-mesh collision in the curated library) --
 *  someone importing a new solid prop on purpose wants it solid. */
export async function extractCollisionForModel(
  category: RegionAssetCategory,
  relPath: string,
  absPath: string,
): Promise<CollisionResult> {
  try {
    const io = new NodeIO().setLogger({ debug() {}, info() {}, warn() {}, error: () => {} });
    const doc = await io.read(absPath);
    const soup = extractSoup(doc);
    const triCount = soup.indices.length / 3;
    if (triCount === 0) return { ok: false, reason: "Model has no triangle geometry" };

    const key = `${CATEGORY_ASSET_DIR[category]}/${relPath}`;
    const safe = key.replace(/[/]/g, "__");
    const dir = collisionDir();
    mkdirSync(join(dir, "data"), { recursive: true });
    const blob = packBinary(soup.verts, soup.indices);
    writeFileSync(join(dir, "data", `${safe}.bin`), blob);

    const index = loadCollisionIndex(dir);
    index.models[key] = {
      file: `data/${safe}.bin`,
      tris: triCount,
      verts: soup.verts.length / 3,
      aabb: { min: soup.min.map(rnd), max: soup.max.map(rnd) },
    };
    index.generatedAt = new Date().toISOString();
    index.count = Object.keys(index.models).length;
    writeFileSync(join(dir, "index.json"), JSON.stringify(index) + "\n");

    invalidateCollisionCache();
    return { ok: true, tris: triCount, verts: soup.verts.length / 3 };
  } catch (e) {
    // Meshopt-compressed uploads (no decoder here, same as the batch script)
    // and any other read failure fall back to the analytic box/circle
    // collider at placement time -- not a fatal error for the import itself.
    return { ok: false, reason: e instanceof Error ? e.message : "Collision extraction failed" };
  }
}

// ---- KTX2 compression (mirrors scripts/compress-assets.mjs, one file) ----

function toolsBinPath(): string {
  return resolve(repoRoot(), "tools/bin");
}

async function checkKtxAvailable(): Promise<boolean> {
  try {
    const bin = toolsBinPath();
    return existsSync(join(bin, "ktx")) && statSync(join(bin, "ktx")).isFile();
  } catch {
    return false;
  }
}

/** Number of `images` entries in a .glb's JSON chunk, read directly off the
 *  raw bytes (no gltf-transform NodeIO involved) so this works whether or not
 *  the file uses KTX2 (`KHR_texture_basisu`) -- NodeIO refuses to even parse
 *  a doc that uses an extension it doesn't have registered, which a plain
 *  `new NodeIO()` doesn't for that one. Returns -1 if unreadable/not a glb. */
function glbImageCount(absPath: string): number {
  try {
    const buf = readFileSync(absPath);
    if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) return -1;
    const jsonLen = buf.readUInt32LE(12);
    if (buf.readUInt32LE(16) !== 0x4e4f534a) return -1; // "JSON" chunk type
    const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf-8")) as { images?: unknown[] };
    return Array.isArray(json.images) ? json.images.length : 0;
  } catch {
    return -1;
  }
}

export type CompressionResult =
  | { ok: true; skipped?: boolean; beforeBytes: number; afterBytes: number }
  | { ok: false; reason: string };

/** Best-effort in-place KTX2 (Basis Universal) texture compression for one
 *  uploaded .glb. Never throws for the caller -- a missing `ktx` toolchain or
 *  a failed encode just means the import keeps the uncompressed original,
 *  same as compress-assets.mjs's per-file catch. Uses async exec (not
 *  execSync) so the encode subprocess doesn't block the game loop's event
 *  loop while it runs. */
export async function compressModelKtx2(absPath: string): Promise<CompressionResult> {
  const beforeBytes = statSync(absPath).size;
  const hasKtx = await checkKtxAvailable();
  if (!hasKtx) return { ok: false, reason: "KTX-Software (tools/bin/ktx) not available on this machine" };

  const head = readFileSync(absPath, { encoding: null }).subarray(0, Math.min(beforeBytes, 65536));
  if (head.includes("KHR_texture_basisu")) {
    return { ok: true, skipped: true, beforeBytes, afterBytes: beforeBytes };
  }

  const beforeImages = glbImageCount(absPath);
  const env = { ...process.env, PATH: `${toolsBinPath()}:${process.env.PATH ?? ""}` };
  const tmpMid = `${absPath}.p1.glb`;
  const tmpFile = `${absPath}.tmp.glb`;
  try {
    await exec(`npx @gltf-transform/cli etc1s "${absPath}" "${tmpMid}" --slots baseColorTexture`, { env });
    await exec(
      `npx @gltf-transform/cli uastc "${tmpMid}" "${tmpFile}" --slots '!baseColorTexture' --level 2 --rdo 4 --zstd 18`,
      { env },
    );
    if (!existsSync(tmpFile)) return { ok: false, reason: "Compression produced no output" };
    // Never trust "the encode succeeded" alone -- verify it didn't silently
    // drop any of the original's textures (a real failure mode we hit: a
    // baked-texture upload came out untextured after this pipeline, even
    // though the etc1s/uastc commands both exited 0). Reject and keep the
    // original whenever the image count regresses.
    const afterImages = glbImageCount(tmpFile);
    if (beforeImages > 0 && afterImages < beforeImages) {
      rmSync(tmpFile, { force: true });
      return { ok: false, reason: `Compression dropped textures (${beforeImages} -> ${afterImages}); kept original` };
    }
    const afterBytes = statSync(tmpFile).size;
    if (afterBytes < beforeBytes) {
      renameSync(tmpFile, absPath);
      return { ok: true, beforeBytes, afterBytes };
    }
    rmSync(tmpFile, { force: true });
    return { ok: true, skipped: true, beforeBytes, afterBytes: beforeBytes };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "KTX2 compression failed" };
  } finally {
    rmSync(tmpMid, { force: true });
    rmSync(tmpFile, { force: true });
  }
}
