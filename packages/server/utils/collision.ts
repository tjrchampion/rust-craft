/**
 * Server-side loader for the offline collision geometry (see
 * scripts/extract-collision.mjs). Reads the same per-model triangle-soup
 * binaries the client fetches, but from disk, so the authoritative server can
 * build the identical three-mesh-bvh MeshBVH per region and reproduce the
 * client's capsule collision exactly (no rubber-banding, hacked clients can't
 * noclip). Models absent from the index return undefined and the caller keeps
 * the analytic box/circle fallback.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CollisionMeshData } from "@rustcraft/shared/collision";
import type { RegionAssetCategory } from "@rustcraft/shared";

interface CollisionIndexEntry { file: string; tris: number; verts: number }
interface CollisionIndex { models: Record<string, CollisionIndexEntry> }

export const CATEGORY_ASSET_DIR: Record<RegionAssetCategory, string> = {
  building: "buildings",
  foliage: "foliage",
  prop: "props",
};
const DIR = CATEGORY_ASSET_DIR;

function getCollisionDir(): string | null {
  const cwd = process.cwd();
  const candidates = [
    resolve(cwd, "packages/client/public/assets/collision"),
    resolve(cwd, "../client/public/assets/collision"),
    resolve(cwd, "client/public/assets/collision"),
  ];
  for (const dir of candidates) if (existsSync(resolve(dir, "index.json"))) return dir;
  return null;
}

let indexCache: CollisionIndex | null | undefined;
const meshCache = new Map<string, CollisionMeshData | null>();

function loadIndex(): CollisionIndex | null {
  if (indexCache !== undefined) return indexCache;
  const dir = getCollisionDir();
  if (!dir) {
    console.warn("[collision] no collision index found — assets fall back to analytic colliders");
    indexCache = null;
    return null;
  }
  try {
    indexCache = JSON.parse(readFileSync(resolve(dir, "index.json"), "utf-8")) as CollisionIndex;
  } catch {
    indexCache = null;
  }
  return indexCache;
}

export function collisionModelKey(category: RegionAssetCategory, model: string): string {
  return `${DIR[category]}/${model}`;
}

/** Model-local collision soup for a key, or undefined if absent. Cached. */
export function getServerCollisionMesh(key: string): CollisionMeshData | undefined {
  const cached = meshCache.get(key);
  if (cached !== undefined) return cached ?? undefined;
  const index = loadIndex();
  const dir = getCollisionDir();
  const entry = index?.models[key];
  if (!index || !dir || !entry) {
    meshCache.set(key, null);
    return undefined;
  }
  try {
    const buf = readFileSync(resolve(dir, entry.file));
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const vc = dv.getUint32(0, true);
    const ic = dv.getUint32(4, true);
    const verts = new Float32Array(vc * 3);
    for (let i = 0; i < vc * 3; i++) verts[i] = dv.getFloat32(8 + i * 4, true);
    const idxBase = 8 + vc * 3 * 4;
    const indices = new Uint32Array(ic);
    for (let i = 0; i < ic; i++) indices[i] = dv.getUint32(idxBase + i * 4, true);
    const data: CollisionMeshData = { verts, indices };
    meshCache.set(key, data);
    return data;
  } catch {
    meshCache.set(key, null);
    return undefined;
  }
}

/** True once the index is loaded and the key is known to have data. */
export function hasServerCollisionMesh(key: string): boolean {
  return getServerCollisionMesh(key) != null;
}

/** Drop the cached index/meshes so a freshly written index.json (e.g. from
 *  the asset importer) is picked up without restarting the server. */
export function invalidateCollisionCache(): void {
  indexCache = undefined;
  meshCache.clear();
}
