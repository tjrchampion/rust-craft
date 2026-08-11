/**
 * Pool of ADT geometry workers. A blueprint is registered once (its heights /
 * roads / customTextures are copied to every worker); tile builds are then
 * dispatched round-robin and returned as transferable typed arrays. Assembly
 * into a THREE mesh happens on the caller's side (assembleAdtTileMesh).
 *
 * Falls back to a null pool when Workers aren't available (SSR / old runtime),
 * so callers can compute synchronously on the main thread instead.
 */
import type { AdtLiteBlueprint, AdtTileGeometryData, AdtTileSpan } from "./adtTileGeometry";

interface BuildMsg {
  type: "built";
  reqId: number;
  data: AdtTileGeometryData | null;
}

const HARD_CAP = 4;

/** Choose a sensible worker count: leave a core for the render/main thread. */
function poolSize(): number {
  const hc = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(HARD_CAP, hc - 1));
}

export class AdtWorkerPool {
  private workers: Worker[] = [];
  private next = 0;
  private reqId = 1;
  private blueprintId = 1;
  private readonly pending = new Map<number, (data: AdtTileGeometryData | null) => void>();
  readonly available: boolean;

  constructor() {
    let ok = false;
    try {
      if (typeof Worker !== "undefined") {
        const n = poolSize();
        for (let i = 0; i < n; i++) {
          const w = new Worker(new URL("./adtTile.worker.ts", import.meta.url), { type: "module" });
          w.onmessage = (e: MessageEvent<BuildMsg>) => this.onMessage(e.data);
          w.onerror = () => {
            /* a dead worker just means its in-flight builds resolve elsewhere on retry */
          };
          this.workers.push(w);
        }
        ok = this.workers.length > 0;
      }
    } catch {
      ok = false;
    }
    this.available = ok;
  }

  private onMessage(msg: BuildMsg): void {
    if (msg.type !== "built") return;
    const resolve = this.pending.get(msg.reqId);
    if (!resolve) return;
    this.pending.delete(msg.reqId);
    resolve(msg.data);
  }

  /** Register a blueprint with every worker; returns its id (or -1 if no pool). */
  registerBlueprint(bp: AdtLiteBlueprint): number {
    if (!this.available) return -1;
    const id = this.blueprintId++;
    // heights/customTextures are large — copy per worker (structured clone).
    for (const w of this.workers) w.postMessage({ type: "register", blueprintId: id, bp });
    return id;
  }

  dropBlueprint(id: number): void {
    if (!this.available || id < 0) return;
    for (const w of this.workers) w.postMessage({ type: "drop", blueprintId: id });
  }

  /** Build one tile off-thread. `positions` (a copy of the skeleton buffer) is
   *  transferred to the worker. Resolves null if the tile is empty or no pool. */
  build(blueprintId: number, span: AdtTileSpan, positions: Float32Array): Promise<AdtTileGeometryData | null> {
    if (!this.available || blueprintId < 0) return Promise.resolve(null);
    const reqId = this.reqId++;
    const w = this.workers[this.next]!;
    this.next = (this.next + 1) % this.workers.length;
    return new Promise((resolve) => {
      this.pending.set(reqId, resolve);
      w.postMessage({ type: "build", blueprintId, reqId, span, positions }, [positions.buffer]);
    });
  }

  get inFlight(): number {
    return this.pending.size;
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    for (const resolve of this.pending.values()) resolve(null);
    this.pending.clear();
  }
}

let shared: AdtWorkerPool | null = null;

/** Process-wide shared pool (terrain streamers come and go per region). */
export function getAdtWorkerPool(): AdtWorkerPool {
  if (!shared) shared = new AdtWorkerPool();
  return shared;
}
