/**
 * Client loader for the offline collision geometry (see
 * scripts/extract-collision.mjs). Fetches the per-model triangle-soup binaries
 * from /assets/collision and caches them so the region BVH (via
 * buildRegionCollisionBVH in @rustcraft/shared/collision) can be built from the
 * exact same source triangles the authoritative server uses. Models absent
 * from the index (e.g. meshopt-compressed rocks, trees) return undefined and
 * the caller keeps the analytic box/circle fallback.
 */
import type { CollisionMeshData } from "@rustcraft/shared/collision";
import type { RegionAssetCategory } from "@rustcraft/shared";

interface CollisionIndexEntry {
  file: string;
  tris: number;
  verts: number;
  aabb: { min: [number, number, number]; max: [number, number, number] };
}
interface CollisionIndex {
  models: Record<string, CollisionIndexEntry>;
}

const DIR: Record<RegionAssetCategory, string> = {
  building: "buildings",
  foliage: "foliage",
  prop: "props",
};

const BASE = "/assets/collision";

let indexPromise: Promise<CollisionIndex | null> | null = null;
let loadedIndex: CollisionIndex | null = null;
const meshCache = new Map<string, CollisionMeshData | null>();
const inflight = new Map<string, Promise<CollisionMeshData | null>>();

/** Blueprint (category, model) → collision index key, e.g. "buildings/x.gltf". */
export function collisionModelKey(category: RegionAssetCategory, model: string): string {
  return `${DIR[category]}/${model}`;
}

function loadIndex(): Promise<CollisionIndex | null> {
  if (!indexPromise) {
    indexPromise = fetch(`${BASE}/index.json`)
      .then((r) => (r.ok ? (r.json() as Promise<CollisionIndex>) : null))
      .then((idx) => {
        loadedIndex = idx;
        return idx;
      })
      .catch(() => null);
  }
  return indexPromise;
}

/** Load just the small collision index (not the per-model .bin meshes). Enough
 *  for hasCollisionEntry() to drive the analytic-vs-BVH partition without every
 *  client re-fetching mesh data the collision worker already fetches. */
export async function preloadCollisionIndex(): Promise<void> {
  await loadIndex();
}

/** True when the index lists collision data for this key. Synchronous — returns
 *  false until preloadCollisionIndex() has resolved. Presence only; does NOT
 *  require the mesh .bin to be fetched on this thread. */
export function hasCollisionEntry(key: string): boolean {
  return !!loadedIndex?.models[key];
}

function parseBin(buf: ArrayBuffer): CollisionMeshData {
  const head = new Uint32Array(buf, 0, 2);
  const vc = head[0]!;
  const ic = head[1]!;
  const verts = new Float32Array(buf, 8, vc * 3);
  const indices = new Uint32Array(buf, 8 + vc * 3 * 4, ic);
  return { verts, indices };
}

async function fetchMesh(key: string, entry: CollisionIndexEntry): Promise<CollisionMeshData | null> {
  try {
    const res = await fetch(`${BASE}/${entry.file}`);
    if (!res.ok) return null;
    return parseBin(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Preload collision meshes for the given index keys. Resolves once all are
 * cached (missing ones cached as null). Safe to call repeatedly — already
 * cached / in-flight keys are skipped.
 */
export async function preloadCollision(keys: Iterable<string>): Promise<void> {
  const index = await loadIndex();
  if (!index) return;
  const jobs: Promise<unknown>[] = [];
  for (const key of keys) {
    if (meshCache.has(key) || inflight.has(key)) continue;
    const entry = index.models[key];
    if (!entry) {
      meshCache.set(key, null);
      continue;
    }
    const p = fetchMesh(key, entry).then((m) => {
      meshCache.set(key, m);
      inflight.delete(key);
      return m;
    });
    inflight.set(key, p);
    jobs.push(p);
  }
  await Promise.all(jobs);
}

/** Cached collision mesh for a model key, or undefined if absent/not loaded. */
export function getCollisionMesh(key: string): CollisionMeshData | undefined {
  return meshCache.get(key) ?? undefined;
}

/** True once the index is loaded and the key is known to have (or lack) data. */
export function hasCollisionData(key: string): boolean {
  return meshCache.get(key) != null;
}
