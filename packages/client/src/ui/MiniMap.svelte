<script lang="ts">
  import { game } from "./gameState.svelte";
  import { generateVillages } from "@rustcraft/shared";

  /** World-space radius (meters) shown edge-to-edge on the map. */
  const MAP_RADIUS_WORLD = 160;
  const SIZE = 200;
  const CENTER = SIZE / 2;
  const RADIUS = 90;
  const SCALE = RADIUS / MAP_RADIUS_WORLD;
  const EDGE_INSET = 6;

  const villages = generateVillages();

  // Same heading convention as TopBar's compass, so the two always agree.
  const heading = $derived((((-game.compassYaw * 180) / Math.PI) % 360 + 360) % 360);

  interface Projected {
    x: number;
    y: number;
    onMap: boolean;
    angleDeg: number;
    worldDist: number;
  }

  function project(wx: number, wz: number): Projected {
    // North (heading 0) is world +z, and screen-right is world -x — the same
    // handedness the movement code and TopBar's compass already use.
    const dx = -(wx - game.playerX) * SCALE;
    const dy = -(wz - game.playerZ) * SCALE;
    const dist = Math.hypot(dx, dy);
    if (dist <= RADIUS - EDGE_INSET) {
      return { x: CENTER + dx, y: CENTER + dy, onMap: true, angleDeg: 0, worldDist: dist / SCALE };
    }
    const angle = Math.atan2(dy, dx);
    return {
      x: CENTER + Math.cos(angle) * (RADIUS - EDGE_INSET),
      y: CENTER + Math.sin(angle) * (RADIUS - EDGE_INSET),
      onMap: false,
      angleDeg: (angle * 180) / Math.PI + 90,
      worldDist: dist / SCALE,
    };
  }

  const villagePoints = $derived(villages.map((v) => ({ id: v.id, p: project(v.x, v.z) })));
  const questPoints = $derived(game.questMarkers.map((m) => ({ ...m, p: project(m.x, m.z) })));

  const GLYPH: Record<string, string> = { available: "!", complete: "?", active: "?" };
</script>

<div class="minimap-wrap rc-frame">
  <svg viewBox="0 0 {SIZE} {SIZE}" class="minimap">
    <defs>
      <clipPath id="mm-clip">
        <circle cx={CENTER} cy={CENTER} r={RADIUS} />
      </clipPath>
    </defs>
    <circle cx={CENTER} cy={CENTER} r={RADIUS} class="mm-bg" />
    <g clip-path="url(#mm-clip)">
      {#each villagePoints as v (v.id)}
        {#if v.p.onMap}
          <circle cx={v.p.x} cy={v.p.y} r="2.6" class="mm-village" />
        {/if}
      {/each}
      {#each questPoints as q (q.id)}
        {#if q.p.onMap}
          <circle cx={q.p.x} cy={q.p.y} r="6.5" class="mm-quest-dot mm-{q.marker}" />
          <text x={q.p.x} y={q.p.y + 3.2} class="mm-quest-glyph">{GLYPH[q.marker]}</text>
        {/if}
      {/each}
    </g>
    <circle cx={CENTER} cy={CENTER} r={RADIUS} class="mm-rim" />
    <text x={CENTER} y="15" class="mm-cardinal">N</text>
    <text x={CENTER} y="193" class="mm-cardinal">S</text>
    <text x="10" y={CENTER + 4} class="mm-cardinal">W</text>
    <text x="190" y={CENTER + 4} class="mm-cardinal">E</text>
    {#each questPoints as q (q.id)}
      {#if !q.p.onMap}
        <g transform="translate({q.p.x} {q.p.y}) rotate({q.p.angleDeg})">
          <path d="M 0 -7 L 5.5 6 L 0 3 L -5.5 6 Z" class="mm-arrow mm-{q.marker}" />
        </g>
        <text x={q.p.x} y={q.p.y > CENTER ? q.p.y + 12 : q.p.y - 8} class="mm-dist">
          {Math.round(q.p.worldDist)}m
        </text>
      {/if}
    {/each}
    <g transform="translate({CENTER} {CENTER}) rotate({heading})">
      <path d="M 0 -10 L 7 8 L 0 4 L -7 8 Z" class="mm-player" />
    </g>
  </svg>
</div>

<style>
  .minimap-wrap {
    position: absolute;
    top: 14px;
    right: 16px;
    width: 180px;
    height: 180px;
    padding: 0;
    border-radius: 50%;
    overflow: hidden;
    pointer-events: none;
  }
  .minimap {
    display: block;
    width: 100%;
    height: 100%;
  }
  .mm-bg {
    fill: rgba(8, 8, 12, 0.55);
  }
  .mm-rim {
    fill: none;
    stroke: var(--rc-gold-dim);
    stroke-width: 2.5;
  }
  .mm-cardinal {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 11px;
    fill: var(--rc-gold-bright);
    text-anchor: middle;
  }
  .mm-village {
    fill: var(--rc-ink-dim);
    stroke: rgba(0, 0, 0, 0.6);
    stroke-width: 0.5;
  }
  .mm-player {
    fill: var(--rc-gold-bright);
    stroke: rgba(0, 0, 0, 0.7);
    stroke-width: 0.7;
  }
  .mm-quest-dot {
    stroke: rgba(0, 0, 0, 0.7);
    stroke-width: 0.8;
  }
  .mm-quest-dot.mm-available,
  .mm-quest-dot.mm-complete {
    fill: #ffd400;
  }
  .mm-quest-dot.mm-active {
    fill: #9a9a9a;
  }
  .mm-quest-dot.mm-complete {
    animation: mm-pulse 1.6s ease-in-out infinite;
  }
  @keyframes mm-pulse {
    0%,
    100% {
      r: 6.5;
      opacity: 1;
    }
    50% {
      r: 8.5;
      opacity: 0.7;
    }
  }
  .mm-quest-glyph {
    font-family: var(--rc-display);
    font-weight: 900;
    font-size: 8px;
    fill: #1a1408;
    text-anchor: middle;
    pointer-events: none;
  }
  .mm-arrow.mm-available,
  .mm-arrow.mm-complete {
    fill: #ffd400;
  }
  .mm-arrow.mm-active {
    fill: #9a9a9a;
  }
  .mm-dist {
    font-size: 7px;
    fill: var(--rc-ink-dim);
    text-anchor: middle;
  }
</style>
