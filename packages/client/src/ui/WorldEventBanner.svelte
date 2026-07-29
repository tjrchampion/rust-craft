<script lang="ts">
  import { game } from "./gameState.svelte";

  function fmtRemain(ms: number): string {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m > 0 ? `${m}:${r.toString().padStart(2, "0")}` : `${r}s`;
  }

  let now = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => {
      now = Date.now();
    }, 250);
    return () => clearInterval(id);
  });

  const nearby = $derived.by(() => {
    const events = game.worldEvents;
    if (!events.length) return null;
    let best: (typeof events)[number] | null = null;
    let bestDist = Infinity;
    for (const ev of events) {
      if (ev.phase === "cooldown" && !ev.nextActiveAt) continue;
      const d = Math.hypot(ev.localX - game.playerX, ev.localZ - game.playerZ);
      if (d < bestDist && d <= ev.radius * 1.35) {
        best = ev;
        bestDist = d;
      }
    }
    // Prefer any active event in region even if slightly outside radius for map awareness.
    if (!best) {
      best = events.find((e) => e.phase === "active") ?? null;
      if (best) bestDist = Math.hypot(best.localX - game.playerX, best.localZ - game.playerZ);
    }
    if (!best) return null;
    return { ev: best, dist: bestDist };
  });

  const phaseLabel = $derived.by(() => {
    const ev = nearby?.ev;
    if (!ev) return "";
    if (ev.phase === "active") return "ACTIVE";
    if (ev.phase === "success") return "SUCCESS";
    if (ev.phase === "failed") return "FAILED";
    return "COOLDOWN";
  });

  const timerText = $derived.by(() => {
    const ev = nearby?.ev;
    if (!ev) return "";
    const serverNow = now - game.serverTimeOffset;
    if (ev.phase === "active" && ev.endsAt != null) return fmtRemain(ev.endsAt - serverNow);
    if (ev.phase === "cooldown" && ev.nextActiveAt != null) return `in ${fmtRemain(ev.nextActiveAt - serverNow)}`;
    return "";
  });
</script>

{#if nearby}
  {@const ev = nearby.ev}
  <div class="banner" class:active={ev.phase === "active"} class:ok={ev.phase === "success"} class:fail={ev.phase === "failed"}>
    <div class="row">
      <span class="phase">{phaseLabel}</span>
      <span class="name">{ev.name}</span>
    </div>
    <div class="meta">
      {#if timerText}<span>{timerText}</span>{/if}
      <span>{ev.playerCount} nearby</span>
      {#if ev.phase === "active" && (ev.myScore ?? 0) > 0}
        <span class="score">
          {Math.round(ev.myScore ?? 0)}
          {#if ev.myTier}<span class="tier tier-{ev.myTier}">{ev.myTier}</span>{/if}
        </span>
      {/if}
    </div>
  </div>
{/if}

<style>
  .banner {
    position: absolute;
    top: 72px;
    left: 50%;
    transform: translateX(-50%);
    min-width: 220px;
    max-width: 340px;
    padding: 8px 14px;
    background: rgba(12, 10, 8, 0.72);
    border: 1px solid rgba(255, 140, 40, 0.45);
    border-radius: 4px;
    pointer-events: none;
    text-align: center;
  }
  .banner.active {
    border-color: rgba(255, 160, 50, 0.85);
    box-shadow: 0 0 18px rgba(255, 120, 20, 0.25);
  }
  .banner.ok {
    border-color: rgba(120, 220, 100, 0.7);
  }
  .banner.fail {
    border-color: rgba(220, 80, 80, 0.7);
  }
  .row {
    display: flex;
    gap: 8px;
    justify-content: center;
    align-items: baseline;
  }
  .phase {
    font-family: var(--rc-display);
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 1px;
    color: #ff9a3c;
  }
  .banner.ok .phase {
    color: #8fef7a;
  }
  .banner.fail .phase {
    color: #ff7a7a;
  }
  .name {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 14px;
    color: var(--rc-ink);
  }
  .meta {
    margin-top: 3px;
    display: flex;
    gap: 10px;
    justify-content: center;
    font-size: 11px;
    color: var(--rc-ink-dim);
  }
  .score {
    color: var(--rc-gold-bright);
  }
  .tier {
    text-transform: uppercase;
    font-weight: 800;
    margin-left: 4px;
    font-size: 10px;
  }
  .tier-gold {
    color: #ffd45a;
  }
  .tier-silver {
    color: #c8d0dc;
  }
  .tier-bronze {
    color: #c9854a;
  }
</style>
