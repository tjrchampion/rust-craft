<script lang="ts">
  import { game } from "./gameState.svelte";
  import { generateVillages } from "@rustcraft/shared";
  import { getGame } from "../game/instance";

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
  const isDay = $derived(game.timeOfDay > 0.02 && game.timeOfDay < 0.48);
  const locationName = $derived(
    game.regionState?.regionName ||
      game.zoneBanner?.name ||
      (game.dungeonState ? "Dungeon" : "Wilderness"),
  );

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
  const worldEventPoints = $derived.by(() => {
    const gameInstance = getGame();
    return game.worldEvents
      .filter((e) => e.phase === "active" || e.phase === "success" || e.phase === "failed")
      .map((e) => {
        const origin = gameInstance?.regionWorldOriginOf(e.regionId);
        const wx = (origin?.x ?? 0) + e.localX;
        const wz = (origin?.z ?? 0) + e.localZ;
        return { ...e, p: project(wx, wz) };
      });
  });

  interface PartyPoint {
    id: string;
    name: string;
    p: Projected;
  }

  const partyPoints = $derived.by(() => {
    const list: PartyPoint[] = [];
    const party = game.party ?? [];
    const selfId = game.selfId;
    const gameInstance = getGame();

    for (const member of party) {
      if (member.id === selfId || !member.online) continue;

      let x = member.x ?? 0;
      let z = member.z ?? 0;

      const realPos = gameInstance?.entities.entityWorldPos(member.id);
      if (realPos) {
        x = realPos.x;
        z = realPos.z;
      }

      list.push({
        id: member.id,
        name: member.name,
        p: project(x, z),
      });
    }
    return list;
  });

  const GLYPH: Record<string, string> = { available: "!", complete: "?", active: "?", escort: "🛡️" };

  function openRegionMap(): void {
    if (game.self?.dead) return;
    const g = getGame();
    if (!g) return;
    if (game.inventoryOpen || game.questOffer || game.chatOpen) return;
    g.setWorldMapOpen(!game.worldMapOpen);
  }
</script>

<div class="minimap-stack">
  <div class="location-row">
    <span class="tod" title={isDay ? "Day" : "Night"}>{isDay ? "☀" : "☾"}</span>
    <span class="location">{locationName}</span>
  </div>
  <div class="minimap-wrap">
    <svg viewBox="0 0 {SIZE} {SIZE}" class="minimap">
      <defs>
        <clipPath id="mm-clip">
          <circle cx={CENTER} cy={CENTER} r={RADIUS} />
        </clipPath>
        <radialGradient id="mm-bg-grad" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stop-color="rgba(40, 48, 58, 0.75)" />
          <stop offset="100%" stop-color="rgba(8, 10, 14, 0.88)" />
        </radialGradient>
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
            <text x={q.p.x} y={q.p.y + 3.2} class="mm-quest-glyph">{GLYPH[q.marker] ?? "!"}</text>
          {/if}
        {/each}
        {#each partyPoints as pm (pm.id)}
          {#if pm.p.onMap}
            <circle cx={pm.p.x} cy={pm.p.y} r="4" class="mm-party-dot" />
          {/if}
        {/each}
        {#each worldEventPoints as ev (ev.id)}
          {#if ev.p.onMap}
            <circle cx={ev.p.x} cy={ev.p.y} r="7" class="mm-event-ring" />
            <circle cx={ev.p.x} cy={ev.p.y} r="3.5" class="mm-event-dot mm-event-{ev.phase}" />
          {/if}
        {/each}
      </g>
      <circle cx={CENTER} cy={CENTER} r={RADIUS} class="mm-rim" />
      <circle cx={CENTER} cy={CENTER} r={RADIUS + 4} class="mm-outer" />
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
      {#each partyPoints as pm (pm.id)}
        {#if !pm.p.onMap}
          <g transform="translate({pm.p.x} {pm.p.y}) rotate({pm.p.angleDeg})">
            <path d="M 0 -6 L 4.5 5 L 0 2.5 L -4.5 5 Z" class="mm-party-arrow" />
          </g>
          <text x={pm.p.x} y={pm.p.y > CENTER ? pm.p.y + 11 : pm.p.y - 7} class="mm-party-dist">
            {pm.name.slice(0, 3)}
          </text>
        {/if}
      {/each}
      {#each worldEventPoints as ev (ev.id)}
        {#if !ev.p.onMap}
          <g transform="translate({ev.p.x} {ev.p.y}) rotate({ev.p.angleDeg})">
            <path d="M 0 -7 L 5.5 6 L 0 3 L -5.5 6 Z" class="mm-event-arrow" />
          </g>
        {/if}
      {/each}
      <g transform="translate({CENTER} {CENTER}) rotate({heading})">
        <path d="M 0 -10 L 7 8 L 0 4 L -7 8 Z" class="mm-player" />
      </g>
    </svg>
    <button type="button" class="region-btn" onclick={openRegionMap} title="Open world map (M)">
      REGION
    </button>
  </div>
</div>

<style>
  .minimap-stack {
    position: absolute;
    top: 10px;
    right: 14px;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    pointer-events: none;
    z-index: 4;
  }
  .location-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    max-width: 200px;
  }
  .tod {
    font-size: 13px;
    color: var(--rc-gold-bright);
    text-shadow: 0 1px 3px #000;
    line-height: 1;
  }
  .location {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    color: var(--rc-gold-bright);
    text-shadow: 0 1px 3px #000, 0 0 8px rgba(0, 0, 0, 0.8);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .minimap-wrap {
    position: relative;
    width: 168px;
    height: 168px;
    border-radius: 50%;
    overflow: visible;
    pointer-events: none;
    background: rgba(12, 10, 18, 0.55);
    box-shadow:
      0 0 0 2px rgba(196, 163, 90, 0.55),
      0 0 0 4px rgba(20, 14, 28, 0.95),
      0 0 18px rgba(160, 80, 200, 0.18),
      0 8px 24px rgba(0, 0, 0, 0.55);
  }
  .minimap {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    overflow: hidden;
  }
  .mm-bg {
    fill: url(#mm-bg-grad);
  }
  .mm-rim {
    fill: none;
    stroke: rgba(196, 163, 90, 0.75);
    stroke-width: 2.5;
  }
  .mm-outer {
    fill: none;
    stroke: rgba(0, 0, 0, 0.55);
    stroke-width: 1.2;
  }
  .mm-cardinal {
    font-family: var(--rc-body);
    font-weight: 800;
    font-size: 10px;
    fill: var(--rc-metal-bright);
    text-anchor: middle;
  }
  .mm-village {
    fill: var(--rc-ink-dim);
    stroke: rgba(0, 0, 0, 0.6);
    stroke-width: 0.5;
  }
  .mm-player {
    fill: var(--rc-magenta-bright);
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
  .mm-quest-dot.mm-escort {
    fill: #33b5e5;
    stroke: #ffffff;
    stroke-width: 1.2;
    animation: mm-pulse 1.2s ease-in-out infinite;
  }
  .mm-arrow.mm-escort {
    fill: #33b5e5;
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
    font-family: var(--rc-body);
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
  .mm-party-dot {
    fill: #3b82f6;
    stroke: rgba(0, 0, 0, 0.7);
    stroke-width: 0.8;
  }
  .mm-party-arrow {
    fill: #3b82f6;
    stroke: rgba(0, 0, 0, 0.7);
    stroke-width: 0.8;
  }
  .mm-party-dist {
    font-size: 7px;
    fill: #93c5fd;
    font-weight: bold;
    text-anchor: middle;
  }
  .mm-event-dot {
    stroke: rgba(0, 0, 0, 0.75);
    stroke-width: 0.8;
  }
  .mm-event-dot.mm-event-active {
    fill: #ff8800;
    animation: mm-pulse 1.1s ease-in-out infinite;
  }
  .mm-event-dot.mm-event-success {
    fill: #7adf5a;
  }
  .mm-event-dot.mm-event-failed {
    fill: #e06060;
  }
  .mm-event-ring {
    fill: none;
    stroke: rgba(255, 136, 0, 0.55);
    stroke-width: 1.4;
  }
  .mm-event-arrow {
    fill: #ff8800;
    stroke: rgba(0, 0, 0, 0.7);
    stroke-width: 0.7;
  }
  .region-btn {
    position: absolute;
    left: 50%;
    bottom: -6px;
    transform: translateX(-50%);
    pointer-events: auto;
    font-family: var(--rc-display);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1.5px;
    color: var(--rc-ink);
    background: linear-gradient(180deg, #3a2e48, #1c1628);
    border: 1px solid rgba(196, 163, 90, 0.65);
    border-radius: 2px;
    padding: 3px 10px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.55);
    cursor: pointer;
  }
  .region-btn:hover {
    border-color: var(--rc-gold-bright);
    color: var(--rc-gold-bright);
    box-shadow: 0 0 12px rgba(196, 77, 154, 0.35);
  }
</style>
