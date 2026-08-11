/**
 * Pool of World Map / Minimap thumbnail rasterization workers.
 * Offloads 100% of the expensive 2D canvas elevation sampling, hillshading,
 * water caustics, and texture blending off the main thread so that map and
 * minimap updates never freeze gameplay frames.
 */
import type { ThumbnailSource, ThumbnailOptions } from "../ui/worldMapThumbnail";
import { renderRegionThumbnail as renderRegionThumbnailSync, renderRegionLandMask as renderRegionLandMaskSync } from "../ui/worldMapThumbnail";

interface OutMsg {
  reqId: number;
  blob: Blob | null;
  error?: string;
}

const HARD_CAP = 2;

function poolSize(): number {
  const hc = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4;
  return Math.max(1, Math.min(HARD_CAP, hc > 2 ? 2 : 1));
}

class WorldMapThumbnailWorkerPool {
  private workers: Worker[] = [];
  private next = 0;
  private reqId = 1;
  private readonly pending = new Map<number, (url: string | null) => void>();
  readonly available: boolean;

  constructor() {
    let ok = false;
    try {
      if (typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined") {
        const n = poolSize();
        for (let i = 0; i < n; i++) {
          const w = new Worker(new URL("./worldMapThumbnail.worker.ts", import.meta.url), { type: "module" });
          w.onmessage = (e: MessageEvent<OutMsg>) => this.onMessage(e.data);
          w.onerror = () => {
            /* worker errors resolve pending requests with null */
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

  private onMessage(msg: OutMsg): void {
    const resolve = this.pending.get(msg.reqId);
    if (!resolve) return;
    this.pending.delete(msg.reqId);
    if (msg.blob) {
      try {
        const url = URL.createObjectURL(msg.blob);
        resolve(url);
      } catch {
        resolve(null);
      }
    } else {
      resolve(null);
    }
  }

  requestThumbnail(src: ThumbnailSource, opts?: ThumbnailOptions): Promise<string | null> {
    if (!this.available) {
      return Promise.resolve(renderRegionThumbnailSync(src, opts));
    }
    const reqId = this.reqId++;
    const w = this.workers[this.next]!;
    this.next = (this.next + 1) % this.workers.length;
    return new Promise((resolve) => {
      this.pending.set(reqId, resolve);
      w.postMessage({ reqId, kind: "thumbnail", src, opts });
    });
  }

  requestLandMask(src: ThumbnailSource, opts?: ThumbnailOptions): Promise<string | null> {
    if (!this.available) {
      return Promise.resolve(renderRegionLandMaskSync(src, opts));
    }
    const reqId = this.reqId++;
    const w = this.workers[this.next]!;
    this.next = (this.next + 1) % this.workers.length;
    return new Promise((resolve) => {
      this.pending.set(reqId, resolve);
      w.postMessage({ reqId, kind: "mask", src, opts });
    });
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    for (const resolve of this.pending.values()) resolve(null);
    this.pending.clear();
  }
}

let sharedPool: WorldMapThumbnailWorkerPool | null = null;

export function getWorldMapThumbnailPool(): WorldMapThumbnailWorkerPool {
  if (!sharedPool) sharedPool = new WorldMapThumbnailWorkerPool();
  return sharedPool;
}

export function requestRegionThumbnailAsync(src: ThumbnailSource, opts?: ThumbnailOptions): Promise<string | null> {
  return getWorldMapThumbnailPool().requestThumbnail(src, opts);
}

export function requestRegionLandMaskAsync(src: ThumbnailSource, opts?: ThumbnailOptions): Promise<string | null> {
  return getWorldMapThumbnailPool().requestLandMask(src, opts);
}
