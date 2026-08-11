import {
  buildRegionCollisionBVH,
  deserializeRegionCollision,
  type PlacedCollider,
  type RegionCollision,
  type SerializedRegionCollision,
} from "@rustcraft/shared/collision";
import { preloadCollision, getCollisionMesh } from "./collisionData";

/**
 * Off-thread builder for region collision BVHs. The worker owns the whole
 * pipeline (fetch .bin -> parse -> bake -> build -> serialize), so the main
 * thread only sends a tiny {keys, placed, origin} message -- no mesh data is
 * cloned across the boundary and the ~0.5s synchronous MeshBVH build never
 * touches the render thread.
 *
 * Falls back to a synchronous main-thread build (fetching the meshes here first)
 * when Workers are unavailable, so callers always get a correct result.
 */
interface BuiltMsg {
  type: "built";
  reqId: number;
  data: SerializedRegionCollision | null;
}

class RegionCollisionWorker {
  private worker: Worker | null = null;
  private reqId = 1;
  private readonly pending = new Map<number, (data: SerializedRegionCollision | null) => void>();
  readonly available: boolean;

  constructor() {
    let ok = false;
    try {
      if (typeof Worker !== "undefined") {
        this.worker = new Worker(new URL("./regionCollision.worker.ts", import.meta.url), { type: "module" });
        this.worker.onmessage = (e: MessageEvent<BuiltMsg>) => {
          if (e.data.type !== "built") return;
          const resolve = this.pending.get(e.data.reqId);
          if (!resolve) return;
          this.pending.delete(e.data.reqId);
          resolve(e.data.data);
        };
        this.worker.onerror = (err) => {
          // eslint-disable-next-line no-console
          console.warn("[collision] worker error — falling back to main-thread builds:", err.message);
          this.worker = null;
        };
        ok = true;
      }
    } catch {
      ok = false;
    }
    this.available = ok;
    // eslint-disable-next-line no-console
    console.log(`[collision] BVH worker ${ok ? "ready (off-thread builds)" : "UNAVAILABLE — building on the main thread"}`);
  }

  /** Build a region's collision BVH off-thread from its solid-asset keys +
   *  placements. Resolves the live RegionCollision, or null if nothing bakeable. */
  async build(
    keys: string[],
    placed: PlacedCollider[],
    origin: { x: number; z: number },
  ): Promise<RegionCollision | null> {
    const dbg = !!(globalThis as { __rcPerf?: boolean }).__rcPerf;
    if (!this.worker) {
      // Fallback: fetch meshes + build synchronously on the main thread.
      const t0 = performance.now();
      await preloadCollision(keys);
      const bt = performance.now();
      const col = buildRegionCollisionBVH(placed, getCollisionMesh, origin);
      if (dbg) {
        // eslint-disable-next-line no-console
        console.warn(
          `[collision] SYNC main-thread build ${(performance.now() - bt).toFixed(0)}ms (+${(bt - t0).toFixed(0)}ms fetch) — worker UNAVAILABLE (${placed.length} solids)`,
        );
      }
      return col;
    }
    const reqId = this.reqId++;
    const t0 = performance.now();
    // Tiny message — keys/placements only, no mesh buffers to clone.
    this.worker.postMessage({ type: "build", reqId, keys, placed, origin });
    return new Promise<RegionCollision | null>((resolve) => {
      this.pending.set(reqId, (data) => {
        const d0 = performance.now();
        const col = data ? deserializeRegionCollision(data) : null;
        if (dbg) {
          // eslint-disable-next-line no-console
          console.warn(
            `[collision] worker OK: deserialize ${(performance.now() - d0).toFixed(0)}ms, roundtrip ${(performance.now() - t0).toFixed(0)}ms (${placed.length} solids) — no main-thread bake`,
          );
        }
        resolve(col);
      });
    });
  }
}

let singleton: RegionCollisionWorker | null = null;
export function getRegionCollisionWorker(): RegionCollisionWorker {
  if (!singleton) singleton = new RegionCollisionWorker();
  return singleton;
}
