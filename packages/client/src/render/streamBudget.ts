/**
 * Shared per-frame time slice for ADT / grass streaming so tile builds don't
 * stall movement. Workers can't own the game's WebGL context, so Mesh
 * creation stays on the main thread — we yield after one build / deadline.
 */
export class StreamBudget {
  private readonly deadline: number;
  private buildsLeft: number;

  constructor(ms: number, maxBuilds = 1) {
    this.deadline = performance.now() + ms;
    this.buildsLeft = maxBuilds;
  }

  get ok(): boolean {
    return this.buildsLeft > 0 && performance.now() < this.deadline;
  }

  /** Reserve one heavy mesh build. Call only when about to construct geometry. */
  takeBuild(): boolean {
    if (!this.ok) return false;
    this.buildsLeft -= 1;
    return true;
  }
}

/** Soft wall-clock slice after paint for all region ADT + grass work. */
export const REGION_STREAM_BUDGET_MS = 2.5;
