/// <reference lib="webworker" />
/**
 * Region collision BVH worker (client). Owns the ENTIRE collision pipeline off
 * the render thread: fetch the per-model triangle-soup `.bin` files, parse them,
 * bake every solid placement into one merged mesh, build its MeshBVH, and
 * serialize it back. Baking + the MeshBVH build are synchronous and ~0.5s on a
 * dense region; doing all of it here (including the fetch/parse) means the main
 * thread only ever sends a tiny {keys, placed, origin} message -- no mesh data
 * is structured-cloned across the boundary, which was itself a main-thread stall
 * for building-heavy regions.
 *
 * Protocol:
 *   in : { type:"build", reqId, keys, placed, origin }
 *   out: { type:"built", reqId, data: SerializedRegionCollision | null }
 */
import {
  buildRegionCollisionBVH,
  serializeRegionCollision,
  type PlacedCollider,
} from "@rustcraft/shared/collision";
import { preloadCollision, getCollisionMesh } from "./collisionData";

interface BuildMsg {
  type: "build";
  reqId: number;
  keys: string[];
  placed: PlacedCollider[];
  origin: { x: number; z: number };
}

const post = (msg: unknown, transfer?: ArrayBuffer[]) =>
  (self as unknown as Worker).postMessage(msg, transfer ?? []);

self.onmessage = async (e: MessageEvent<BuildMsg>) => {
  const msg = e.data;
  if (msg.type !== "build") return;
  try {
    // Fetch + parse the referenced collision meshes here (worker-side cache).
    await preloadCollision(msg.keys);
    const col = buildRegionCollisionBVH(msg.placed, getCollisionMesh, msg.origin);
    if (!col) {
      post({ type: "built", reqId: msg.reqId, data: null });
      return;
    }
    const { data, transfer } = serializeRegionCollision(col);
    post({ type: "built", reqId: msg.reqId, data }, transfer);
  } catch {
    // Any failure -> null result; the caller keeps the analytic-collider fallback.
    post({ type: "built", reqId: msg.reqId, data: null });
  }
};
