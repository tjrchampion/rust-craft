<script lang="ts">
  import { game } from "./gameState.svelte";

  const DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

  const heading = $derived((((-game.compassYaw * 180) / Math.PI) % 360 + 360) % 360);
  const dir = $derived(DIRS[Math.round(heading / 45) % 8]);

  const hour = $derived((game.timeOfDay * 24 + 6) % 24);
  const isDay = $derived(game.timeOfDay > 0.02 && game.timeOfDay < 0.48);
  const clock = $derived(
    `${String(Math.floor(hour)).padStart(2, "0")}:${String(Math.floor((hour % 1) * 60)).padStart(2, "0")}`,
  );
</script>

<div class="topbar rc-frame">
  <span class="icon">{isDay ? "☀️" : "🌙"}</span>
  <span class="clock">{clock}</span>
  <span class="sep"></span>
  <span class="dir">{dir}</span>
  <span class="deg">{Math.round(heading)}°</span>
</div>

<style>
  .topbar {
    position: absolute;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 16px;
    pointer-events: none;
    font-family: var(--rc-display);
    font-weight: 700;
  }
  .icon {
    font-size: 14px;
  }
  .clock {
    font-size: 14px;
    color: var(--rc-parchment);
    letter-spacing: 1px;
  }
  .sep {
    width: 1px;
    height: 16px;
    background: var(--rc-gold-dim);
  }
  .dir {
    font-size: 16px;
    color: var(--rc-gold-bright);
    min-width: 26px;
    text-align: center;
  }
  .deg {
    font-size: 11px;
    color: var(--rc-ink-dim);
    min-width: 32px;
  }
</style>
