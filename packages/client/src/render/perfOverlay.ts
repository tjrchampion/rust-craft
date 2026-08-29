import { recentPerfEvents, type PerfEvent } from "./perfBus";

/** Plain data snapshot the overlay needs to draw one frame -- Game.ts builds
 *  this from its private `perf`/`renderer` state each samplePerf() tick (a
 *  `PerfOverlayHost` reference type isn't used here since Game's `renderer`
 *  field is private, which TS's structural typing can't satisfy from outside
 *  the class). */
export interface PerfOverlaySnapshot {
  frame: number[];
  /** performance.now() at each frame[i] -- parallel array, same index. Lets
   *  exportReport() find WHEN the single worst frame happened, not just its
   *  value, so it can be lined up against nearby perfBus events even when
   *  nothing in the log itself accounts for the stall (see the ~1.1s frame
   *  investigation this was added for -- renderMs/logicMs summed nowhere
   *  near that, meaning the time was spent somewhere wholly uninstrumented). */
  frameTs: number[];
  render: number[];
  logic: number[];
  /** Post-paint updateZoneAndStreaming() task ms -- runs in a setTimeout(0)
   *  after frame() returns, so it's invisible to render/logic above, but it
   *  still occupies the main thread between one paint and the next rAF tick,
   *  which means it DOES show up in `frame`'s delta. A frame-vs-render+logic
   *  gap that doesn't correlate with a program compile is a candidate for
   *  this (see the ~11ms/frame steady-state gap investigation this was added
   *  for -- a dense 7.5M-triangle region where render+logic summed nowhere
   *  near frame's average). */
  stream: number[];
  programJumps: { ts: number; from: number; to: number }[];
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}
function fmt(n: number): string {
  return n.toFixed(1);
}
function findWorstFrame(frame: number[], frameTs: number[]): { ms: number; ts: number } | null {
  let bestIdx = -1;
  let bestMs = -Infinity;
  for (let i = 0; i < frame.length; i++) {
    if (frame[i]! > bestMs) {
      bestMs = frame[i]!;
      bestIdx = i;
    }
  }
  if (bestIdx === -1 || frameTs[bestIdx] === undefined) return null;
  return { ms: bestMs, ts: frameTs[bestIdx]! };
}
/** {avg, p95, max} rounded to 0.1ms -- mirrors Game.ts's private stat() helper
 *  (duplicated here rather than exported/shared, since it's ~8 lines). */
function stat(arr: number[]): { avg: number; p95: number; max: number } {
  if (arr.length === 0) return { avg: 0, p95: 0, max: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
  const r = (n: number) => Math.round(n * 10) / 10;
  return { avg: r(avg(arr)), p95: r(p95), max: r(sorted[sorted.length - 1]!) };
}

/** How close a perfBus event's timestamp has to land before a program-count
 *  jump to be flagged as its likely cause. Generous -- the jump is observed
 *  one samplePerf() tick (one frame) after the render() call that caused it,
 *  and async loads (loadFrom/applyAppearance) resolve at an arbitrary point
 *  relative to the frame boundary that first draws their result -- a
 *  streamed-in mesh can sit in the scene for a few frames before it's first
 *  actually drawn (entering the camera frustum / render list), which is when
 *  the real compile happens. Widened from 120ms after a real capture showed
 *  a tileAdded mark landing 169ms before its matching jump. */
const CORRELATION_WINDOW_MS = 400;

/** DEV-only on-screen panel: rolling frame timings, renderer.info counters,
 *  and a live log of streaming/compile events from perfBus, with any event
 *  that lines up with a renderer.info.programs.length jump flagged -- that
 *  jump is a real GPU shader link happening on the render() hot path, so an
 *  event next to one is very likely what triggered it. Built to answer "what
 *  just streamed in that made the frame hitch" without guessing from a
 *  one-off browser profiler capture. Toggle with the backtick key (see
 *  Game.ts's bindOverlayToggle) or `__rc.perfOverlay.setVisible(true)`. */
export class PerfOverlay {
  private root: HTMLDivElement;
  private visible = false;
  private nextRenderAt = 0;
  /** Redraw at most this often -- the overlay must not itself become the
   *  main-thread cost it's built to diagnose. */
  private static readonly REDRAW_INTERVAL_MS = 250;
  /** Kept up to date every update() call (even while hidden) so exportReport/
   *  copyReport() work immediately after toggling the panel on. */
  private lastSnapshot: PerfOverlaySnapshot | null = null;
  private statusText = "";
  private statusUntil = 0;

  constructor() {
    this.root = document.createElement("div");
    this.root.style.cssText = [
      "position:fixed",
      "top:8px",
      "right:8px",
      "z-index:99999",
      "width:420px",
      "max-height:80vh",
      "overflow-y:auto",
      "background:rgba(10,12,16,0.88)",
      "color:#c8f0c8",
      "font:11px/1.4 'SF Mono',Menlo,Consolas,monospace",
      "padding:8px 10px",
      "border:1px solid #2a3a2a",
      "border-radius:4px",
      "white-space:pre",
      "pointer-events:none",
      "display:none",
    ].join(";");
    document.body.appendChild(this.root);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.style.display = v ? "block" : "none";
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  destroy(): void {
    this.root.remove();
  }

  update(snap: PerfOverlaySnapshot): void {
    this.lastSnapshot = snap;
    if (!this.visible) return;
    const now = performance.now();
    if (now < this.nextRenderAt) return;
    this.nextRenderAt = now + PerfOverlay.REDRAW_INTERVAL_MS;
    this.renderNow(snap);
  }

  private renderNow(snap: PerfOverlaySnapshot): void {
    const now = performance.now();
    const fps = 1000 / (avg(snap.frame) || 16.7);

    const recentJumps = snap.programJumps.filter((j) => now - j.ts < 5000);
    const jumpTimes = recentJumps.map((j) => j.ts);
    const events = recentPerfEvents(5000).slice(-40).reverse();

    const lines: string[] = [];
    if (now < this.statusUntil) lines.push(this.statusText, "");
    lines.push(`FPS ${fps.toFixed(0)}  frame ${fmt(avg(snap.frame))}ms  render ${fmt(avg(snap.render))}ms  logic ${fmt(avg(snap.logic))}ms`);
    lines.push(`draws ${snap.drawCalls}  tris ${snap.triangles}  geo ${snap.geometries}  tex ${snap.textures}`);
    const progLine = `programs ${snap.programs}`;
    lines.push(recentJumps.length > 0 ? `${progLine}  ⚡ +${recentJumps.length} compiled in last 5s` : progLine);
    lines.push("");
    lines.push(`-- streaming/compile events (last 5s, newest first) --  [~ to copy full log]`);
    if (events.length === 0) lines.push("(none)");
    for (const e of events) {
      const flagged = jumpTimes.some((t) => Math.abs(t - e.ts) < CORRELATION_WINDOW_MS);
      lines.push(formatEvent(e, now, flagged));
    }

    this.root.textContent = lines.join("\n");
  }

  private flashStatus(text: string): void {
    this.statusText = text;
    this.statusUntil = performance.now() + 4000;
    if (this.lastSnapshot) this.renderNow(this.lastSnapshot);
  }

  /** Full JSON report: perfBus events from just before the earliest
   *  program-count jump onward (not just the last-5s slice the on-screen
   *  panel shows), plus every jump and current perf stats, with each event
   *  flagged if it lands within CORRELATION_WINDOW_MS of a jump. Anchoring
   *  on the jumps (rather than exporting the whole 3000-entry buffer)
   *  keeps the pasted report focused on the window that actually explains
   *  them, even if something noisy fired many more events since. Meant to
   *  be pasted straight into chat for debugging -- see copyReport(). */
  exportReport(): string {
    const jumps = this.lastSnapshot?.programJumps ?? [];
    const jumpTimes = jumps.map((j) => j.ts);
    const earliestJump = jumpTimes.length > 0 ? Math.min(...jumpTimes) : undefined;
    const windowStart = earliestJump !== undefined ? earliestJump - 2000 : performance.now() - 120000;
    const events = recentPerfEvents()
      .filter((e) => e.ts >= windowStart)
      .slice(-1500);
    const worstFrame = this.lastSnapshot ? findWorstFrame(this.lastSnapshot.frame, this.lastSnapshot.frameTs) : null;
    const report = {
      capturedAt: new Date().toISOString(),
      summary: this.lastSnapshot
        ? {
            fps: Math.round(1000 / (avg(this.lastSnapshot.frame) || 16.7)),
            frameMs: stat(this.lastSnapshot.frame),
            renderMs: stat(this.lastSnapshot.render),
            logicMs: stat(this.lastSnapshot.logic),
            streamMs: stat(this.lastSnapshot.stream),
            drawCalls: this.lastSnapshot.drawCalls,
            triangles: this.lastSnapshot.triangles,
            geometries: this.lastSnapshot.geometries,
            textures: this.lastSnapshot.textures,
            programs: this.lastSnapshot.programs,
            // Pinpoints WHEN the max frameMs above happened -- ageMs lines up
            // directly against events[].ageMs below, even when nothing in the
            // event log itself explains the stall (that gap is itself the finding).
            worstFrame: worstFrame ? { ms: Math.round(worstFrame.ms * 10) / 10, ageMs: Math.round(performance.now() - worstFrame.ts) } : null,
          }
        : null,
      programJumps: jumps.map((j) => ({ ...j, ageMs: Math.round(performance.now() - j.ts) })),
      events: events.map((e) => ({
        ...e,
        ageMs: Math.round(performance.now() - e.ts),
        likelyShaderCompile: jumpTimes.some((t) => Math.abs(t - e.ts) < CORRELATION_WINDOW_MS),
      })),
    };
    return JSON.stringify(report, null, 2);
  }

  /** Copies exportReport() to the clipboard (falls back to console.log if
   *  clipboard access is denied) and flashes a confirmation in the panel. */
  async copyReport(): Promise<void> {
    const json = this.exportReport();
    try {
      await navigator.clipboard.writeText(json);
      this.flashStatus(`✓ copied perf report to clipboard (${recentPerfEvents().length} events)`);
    } catch {
      // eslint-disable-next-line no-console
      console.log("[perfOverlay] clipboard write failed -- report below:\n" + json);
      this.flashStatus("clipboard blocked -- report logged to devtools console instead");
    }
  }
}

function formatEvent(e: PerfEvent, now: number, flagged: boolean): string {
  const age = Math.round(now - e.ts);
  const ms = e.ms > 0.05 ? ` ${e.ms.toFixed(1)}ms` : "";
  const detail = e.detail ? ` (${e.detail})` : "";
  const mark = flagged ? " ⚡ likely shader compile" : "";
  return `-${age}ms  ${e.label}${ms}${detail}${mark}`;
}
