/**
 * Off-thread region collision BVH builder for the authoritative server.
 *
 * Baking a region's solid assets into one merged mesh + building its MeshBVH is
 * synchronous and heavy (~0.5s on a dense region). On the single-threaded game
 * loop that stalls EVERY connected player (the tick can't run, so no snapshots
 * go out) the first time anyone enters a region. This moves the build to a Node
 * worker_thread so the loop keeps ticking; analytic colliders cover movement
 * until the BVH resolves, exactly like the client.
 *
 * The worker is created from an INLINE eval string rather than a separate file:
 * Nitro bundles the server, and a standalone worker file (.ts won't run without
 * a loader; a .mjs wouldn't be copied into `.output`) is fragile to ship. `three`
 * and `three-mesh-bvh` are externalized (present in node_modules at runtime), so
 * the worker dynamic-imports them by name. The bake math is duplicated here to
 * stay self-contained -- keep it in lockstep with buildRegionCollisionBVH in
 * @rustcraft/shared/collision (packages/shared/src/sim/meshCollision.ts).
 */
import { Worker } from "node:worker_threads";
import {
  buildRegionCollisionBVH,
  deserializeRegionCollision,
  type CollisionMeshData,
  type PlacedCollider,
  type RegionCollision,
  type SerializedRegionCollision,
} from "@rustcraft/shared/collision";

// CommonJS eval worker: `require` for worker_threads, dynamic import() for the
// externalized three packages (works whether the host is ESM or CJS).
const WORKER_CODE = /* js */ `
const { parentPort } = require('worker_threads');
parentPort.on('message', async (msg) => {
  try {
    const THREE = await import('three');
    const { MeshBVH } = await import('three-mesh-bvh');
    const { reqId, placed, meshes, origin } = msg;
    const positions = [];
    const indices = [];
    const _mat = new THREE.Matrix4();
    const _pos = new THREE.Vector3();
    const _quat = new THREE.Quaternion();
    const _scl = new THREE.Vector3();
    const _v = new THREE.Vector3();
    const _yAxis = new THREE.Vector3(0, 1, 0);
    let baked = 0;
    for (const p of placed) {
      const data = meshes[p.modelKey];
      if (!data) continue;
      const vs = data.verts, is = data.indices;
      const vc = vs.length / 3;
      if (vc === 0 || is.length === 0) continue;
      _pos.set(p.x + origin.x, p.y, p.z + origin.z);
      _quat.setFromAxisAngle(_yAxis, p.yaw);
      _scl.set(p.scaleX || 1, p.scaleY || 1, p.scaleZ || 1);
      _mat.compose(_pos, _quat, _scl);
      const base = positions.length / 3;
      for (let i = 0; i < vc; i++) {
        _v.set(vs[i * 3], vs[i * 3 + 1], vs[i * 3 + 2]).applyMatrix4(_mat);
        positions.push(_v.x, _v.y, _v.z);
      }
      for (let i = 0; i < is.length; i++) indices.push(base + is[i]);
      baked++;
    }
    if (baked === 0 || indices.length === 0) {
      parentPort.postMessage({ reqId, ok: true, data: null });
      return;
    }
    const posArr = new Float32Array(positions);
    const idxArr = posArr.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geometry.setIndex(new THREE.BufferAttribute(idxArr, 1));
    const bvh = new MeshBVH(geometry);
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const ser = MeshBVH.serialize(bvh, { cloneBuffers: false });
    const roots = ser.roots;
    const data = {
      positions: posArr,
      index: idxArr,
      roots,
      aabb: [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z],
      bakedCount: baked,
    };
    parentPort.postMessage({ reqId, ok: true, data }, [posArr.buffer, idxArr.buffer, ...roots]);
  } catch (err) {
    parentPort.postMessage({ reqId: msg && msg.reqId, ok: false, error: String((err && err.stack) || err) });
  }
});
`;

interface BuildResult {
  reqId: number;
  ok: boolean;
  data?: SerializedRegionCollision | null;
  error?: string;
}

interface Pending {
  resolve: (col: RegionCollision | null) => void;
  placed: PlacedCollider[];
  meshes: Record<string, CollisionMeshData>;
  origin: { x: number; z: number };
}

class RegionCollisionWorker {
  private worker: Worker | null = null;
  private dead = false;
  private reqId = 1;
  private readonly pending = new Map<number, Pending>();

  private ensureWorker(): Worker | null {
    if (this.worker || this.dead) return this.worker;
    try {
      const w = new Worker(WORKER_CODE, { eval: true });
      w.on("message", (msg: BuildResult) => this.onMessage(msg));
      w.on("error", (err) => this.onFatal(err));
      w.on("exit", (code) => {
        if (code !== 0) this.onFatal(new Error(`region collision worker exited (${code})`));
      });
      // Don't keep the process alive for this worker on shutdown.
      w.unref();
      this.worker = w;
    } catch (err) {
      console.warn("[collision] worker unavailable, building on main thread:", err);
      this.dead = true;
    }
    return this.worker;
  }

  private onMessage(msg: BuildResult): void {
    const p = this.pending.get(msg.reqId);
    if (!p) return;
    this.pending.delete(msg.reqId);
    if (msg.ok) {
      p.resolve(msg.data ? deserializeRegionCollision(msg.data) : null);
    } else {
      console.warn("[collision] worker build failed, falling back to main thread:", msg.error);
      p.resolve(buildRegionCollisionBVH(p.placed, (k) => p.meshes[k], p.origin));
    }
  }

  /** Worker crashed: build every outstanding request synchronously and stop
   *  using the worker for the rest of this process (sync fallback). */
  private onFatal(err: unknown): void {
    console.warn("[collision] worker error, building on main thread from now on:", err);
    this.dead = true;
    this.worker = null;
    for (const [, p] of this.pending) {
      p.resolve(buildRegionCollisionBVH(p.placed, (k) => p.meshes[k], p.origin));
    }
    this.pending.clear();
  }

  build(
    placed: PlacedCollider[],
    meshes: Record<string, CollisionMeshData>,
    origin: { x: number; z: number },
  ): Promise<RegionCollision | null> {
    const worker = this.ensureWorker();
    if (!worker) {
      return Promise.resolve(buildRegionCollisionBVH(placed, (k) => meshes[k], origin));
    }
    const reqId = this.reqId++;
    return new Promise<RegionCollision | null>((resolve) => {
      this.pending.set(reqId, { resolve, placed, meshes, origin });
      worker.postMessage({ type: "build", reqId, placed, meshes, origin });
    });
  }
}

let singleton: RegionCollisionWorker | null = null;
export function getRegionCollisionWorker(): RegionCollisionWorker {
  if (!singleton) singleton = new RegionCollisionWorker();
  return singleton;
}
