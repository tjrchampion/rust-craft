/**
 * Cooperative scheduling helpers. GLTF `parse()` is a single synchronous block
 * that can't be split, but we can make sure heavy parses run during idle time
 * and never fire back-to-back without letting the render loop + input paint a
 * frame in between. That's the difference between a character screen that feels
 * frozen while assets warm and one that stays responsive.
 */

/** Resolve on the next browser idle slot (or next frame as a fallback). Use
 *  between heavy synchronous tasks so rendering/input get priority. */
export function nextIdle(timeoutMs = 60): Promise<void> {
  return new Promise((resolve) => {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
      .requestIdleCallback;
    if (typeof ric === "function") ric(() => resolve(), { timeout: timeoutMs });
    else if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

/** Resolve on the next animation frame. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 16);
  });
}

/**
 * Run async tasks with bounded concurrency, yielding to the browser (idle slot)
 * between waves so the render loop keeps painting. Lower concurrency = smoother
 * foreground; higher = faster throughput. Progress fires per completed task.
 */
export async function runCooperatively<T>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<void>,
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<void> {
  const concurrency = Math.max(1, opts.concurrency ?? 1);
  let done = 0;
  for (let i = 0; i < items.length; i += concurrency) {
    const wave = items.slice(i, i + concurrency);
    await Promise.all(
      wave.map((item, k) =>
        worker(item, i + k).finally(() => {
          done++;
          opts.onProgress?.(done, items.length);
        }),
      ),
    );
    // Let the compositor/input breathe before the next heavy wave.
    await nextIdle();
  }
}
