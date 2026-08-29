/** Lightweight main-thread streaming/compile event log (DEV only — every
 *  function here is a no-op in production builds). Call sites that load
 *  models, tint materials, build terrain tiles, or precompile shaders wrap
 *  their work in perfTime/perfTimeAsync; PerfOverlay (perfOverlay.ts) reads
 *  the resulting ring buffer each frame and lines it up against
 *  renderer.info.programs.length jumps to show which streamed asset
 *  triggered a real GPU shader compile on the hot render path. */

export interface PerfEvent {
  label: string;
  /** performance.now() when the event finished. */
  ts: number;
  ms: number;
  detail?: string;
}

// Generous headroom -- a single noisy source (e.g. compileNewLayer's old
// per-mesh logging) could otherwise flood this ring buffer in ~2s and evict
// every other streaming event from the window that actually mattered. Each
// entry is a handful of primitive fields, so even a few thousand is trivial
// memory for a DEV-only tool.
const MAX_EVENTS = 3000;
const events: PerfEvent[] = [];

export function perfMark(label: string, ms: number, detail?: string): void {
  if (!import.meta.env.DEV) return;
  events.push({ label, ts: performance.now(), ms, detail });
  if (events.length > MAX_EVENTS) events.shift();
}

/** Wrap a synchronous call, recording its duration. */
export function perfTime<T>(label: string, fn: () => T, detail?: string): T {
  if (!import.meta.env.DEV) return fn();
  const start = performance.now();
  const result = fn();
  perfMark(label, performance.now() - start, detail);
  return result;
}

/** Wrap a promise-returning call, recording end-to-end duration once it settles. */
export function perfTimeAsync<T>(label: string, fn: () => Promise<T>, detail?: string): Promise<T> {
  if (!import.meta.env.DEV) return fn();
  const start = performance.now();
  return fn().finally(() => perfMark(label, performance.now() - start, detail));
}

export function recentPerfEvents(sinceMs?: number): PerfEvent[] {
  if (sinceMs === undefined) return events.slice();
  const cutoff = performance.now() - sinceMs;
  return events.filter((e) => e.ts >= cutoff);
}

export function clearPerfEvents(): void {
  events.length = 0;
}
