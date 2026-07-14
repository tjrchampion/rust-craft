<script lang="ts">
  import { game } from "./gameState.svelte";
  import { getGame } from "../game/instance";
  import { generateVillages, generatePois, ZONE_SIZE, type PoiType } from "@rustcraft/shared";

  const SIZE = 640;
  const CENTER = SIZE / 2;
  const PADDING = 20;
  const WORLD_HALF = ZONE_SIZE / 2 + 20; // a bit beyond the playable square
  const SCALE = (CENTER - PADDING) / WORLD_HALF;
  const BOUNDS = (ZONE_SIZE / 2) * SCALE;

  const villages = generateVillages();
  const pois = generatePois();

  // Same heading convention as TopBar's compass / MiniMap's player arrow.
  const heading = $derived((((-game.compassYaw * 180) / Math.PI) % 360 + 360) % 360);

  // Fixed world-origin-centered projection — unlike the minimap, the map
  // itself never moves; only the player marker's position within it changes.
  function project(wx: number, wz: number): { x: number; y: number } {
    return { x: CENTER - wx * SCALE, y: CENTER - wz * SCALE };
  }

  const villagePoints = $derived(villages.map((v) => ({ id: v.id, name: v.name, p: project(v.x, v.z) })));
  const poiPoints = $derived(pois.map((poi) => ({ id: poi.id, type: poi.type, p: project(poi.x, poi.z) })));
  const questPoints = $derived(game.questMarkers.map((m) => ({ ...m, p: project(m.x, m.z) })));
  const playerPoint = $derived(project(game.playerX, game.playerZ));

  const GLYPH: Record<string, string> = { available: "!", complete: "?", active: "?" };
  const POI_COLOR: Record<PoiType, string> = {
    shrine: "#c39bf2",
    tower: "#b9c2cf",
    camp: "#f2a65a",
    ruins: "#a9836a",
  };

  function close(): void {
    getGame()?.setWorldMapOpen(false);
  }
</script>

{#if game.worldMapOpen}
  <div class="backdrop">
    <div class="panel rc-frame">
      <div class="panel-head">
        <div class="rc-frame-title">World Map</div>
        <button type="button" class="close-btn" onclick={close}>✕</button>
      </div>
      <svg viewBox="0 0 {SIZE} {SIZE}" class="worldmap">
        <rect x="0" y="0" width={SIZE} height={SIZE} class="wm-bg" />
        <rect
          x={CENTER - BOUNDS}
          y={CENTER - BOUNDS}
          width={BOUNDS * 2}
          height={BOUNDS * 2}
          class="wm-bounds"
        />
        {#each poiPoints as poi (poi.id)}
          <rect
            x={poi.p.x - 4}
            y={poi.p.y - 4}
            width="8"
            height="8"
            transform="rotate(45 {poi.p.x} {poi.p.y})"
            class="wm-poi"
            style="fill: {POI_COLOR[poi.type]}"
          />
        {/each}
        {#each villagePoints as v (v.id)}
          <circle cx={v.p.x} cy={v.p.y} r="6" class="wm-village" />
          <text x={v.p.x} y={v.p.y - 11} class="wm-village-label">{v.name}</text>
        {/each}
        {#each questPoints as q (q.id)}
          <circle cx={q.p.x} cy={q.p.y} r="8" class="wm-quest-dot wm-{q.marker}" />
          <text x={q.p.x} y={q.p.y + 3.5} class="wm-quest-glyph">{GLYPH[q.marker]}</text>
        {/each}
        <g transform="translate({playerPoint.x} {playerPoint.y}) rotate({heading})">
          <path d="M 0 -12 L 8 9 L 0 5 L -8 9 Z" class="wm-player" />
        </g>
        <text x={CENTER} y={CENTER - BOUNDS - 8} class="wm-cardinal">N</text>
        <text x={CENTER} y={CENTER + BOUNDS + 16} class="wm-cardinal">S</text>
        <text x={CENTER - BOUNDS - 10} y={CENTER + 4} class="wm-cardinal">W</text>
        <text x={CENTER + BOUNDS + 10} y={CENTER + 4} class="wm-cardinal">E</text>
      </svg>
      <div class="legend">
        <span><span class="dot" style="background:#ffd400"></span>Quest</span>
        <span><span class="dot" style="background:{POI_COLOR.shrine}"></span>Shrine</span>
        <span><span class="dot" style="background:{POI_COLOR.tower}"></span>Tower</span>
        <span><span class="dot" style="background:{POI_COLOR.camp}"></span>Camp</span>
        <span><span class="dot" style="background:{POI_COLOR.ruins}"></span>Ruins</span>
      </div>
      <div class="hint">M or Esc to close</div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(6, 5, 4, 0.6);
    pointer-events: auto;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 20px;
    width: min(84vw, 640px);
  }
  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .close-btn {
    background: transparent;
    border: 1px solid var(--rc-gold-dim);
    color: var(--rc-ink-dim);
    border-radius: 4px;
    width: 26px;
    height: 26px;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
  }
  .close-btn:hover {
    border-color: var(--rc-gold-bright);
    color: var(--rc-gold-bright);
  }
  .worldmap {
    display: block;
    width: 100%;
    aspect-ratio: 1 / 1;
    border-radius: 6px;
  }
  .wm-bg {
    fill: rgba(8, 8, 12, 0.7);
  }
  .wm-bounds {
    fill: none;
    stroke: var(--rc-gold-dim);
    stroke-width: 1.5;
    stroke-dasharray: 5 4;
  }
  .wm-cardinal {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 13px;
    fill: var(--rc-gold-bright);
    text-anchor: middle;
  }
  .wm-village {
    fill: var(--rc-parchment);
    stroke: rgba(0, 0, 0, 0.7);
    stroke-width: 1;
  }
  .wm-village-label {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 13px;
    fill: var(--rc-gold-bright);
    text-anchor: middle;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
  }
  .wm-poi {
    stroke: rgba(0, 0, 0, 0.6);
    stroke-width: 0.8;
  }
  .wm-quest-dot {
    stroke: rgba(0, 0, 0, 0.7);
    stroke-width: 1;
  }
  .wm-quest-dot.wm-available,
  .wm-quest-dot.wm-complete {
    fill: #ffd400;
  }
  .wm-quest-dot.wm-active {
    fill: #9a9a9a;
  }
  .wm-quest-dot.wm-complete {
    animation: wm-pulse 1.6s ease-in-out infinite;
  }
  @keyframes wm-pulse {
    0%,
    100% {
      r: 8;
      opacity: 1;
    }
    50% {
      r: 10;
      opacity: 0.7;
    }
  }
  .wm-quest-glyph {
    font-family: var(--rc-display);
    font-weight: 900;
    font-size: 10px;
    fill: #1a1408;
    text-anchor: middle;
  }
  .wm-player {
    fill: var(--rc-gold-bright);
    stroke: rgba(0, 0, 0, 0.7);
    stroke-width: 0.8;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
    font-size: 12px;
    color: var(--rc-ink-dim);
  }
  .legend .dot {
    display: inline-block;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    margin-right: 5px;
    vertical-align: middle;
  }
  .hint {
    text-align: center;
    font-size: 11px;
    color: var(--rc-ink-dim);
  }
</style>
