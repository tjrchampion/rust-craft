<script lang="ts">
  import { game } from "./gameState.svelte";

  const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

  const heading = $derived((((-game.compassYaw * 180) / Math.PI) % 360 + 360) % 360);
  const dir = $derived(DIRS[Math.round(heading / 45) % 8]);

  const hour = $derived((game.timeOfDay * 24 + 6) % 24);
  const clock = $derived(
    `${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.floor((hour % 1) * 60)).padStart(2, "0")}`,
  );
</script>

<div class="topbar rc-hud-panel">
  <span class="clock">{clock}</span>
  <span class="sep"></span>
  <span class="dir">{dir}</span>
  <span class="deg">{Math.round(heading)}°</span>
</div>

<style>
  .topbar {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px;
    pointer-events: none;
    font-family: var(--rc-display);
    font-weight: 700;
    z-index: 3;
  }
  .clock {
    font-size: 12px;
    color: var(--rc-ink);
    letter-spacing: 1px;
    text-shadow: 0 1px 2px #000;
  }
  .sep {
    width: 1px;
    height: 12px;
    background: rgba(196, 163, 90, 0.4);
  }
  .dir {
    font-size: 13px;
    color: var(--rc-gold-bright);
    min-width: 24px;
    text-align: center;
    text-shadow: 0 1px 2px #000;
  }
  .deg {
    font-size: 10px;
    color: var(--rc-ink-dim);
    min-width: 28px;
  }
</style>
