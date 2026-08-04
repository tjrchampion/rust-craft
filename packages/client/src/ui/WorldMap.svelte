<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { game } from "./gameState.svelte";
  import { app } from "./appState.svelte";
  import { getGame } from "../game/instance";
  import {
    regionLocalToWorld,
    regionWorldBounds,
    type RegionMapEntry,
  } from "@rustcraft/shared";
  import {
    BIOME_FILL,
    DEFAULT_MAP_FILTERS,
    MapCamera,
    biomeLabel,
    buildStaticMarkers,
    hitTestRegion,
    regionTilePath,
    type MapFilters,
    type MapMarker,
    type MapViewMode,
  } from "./worldMapModel";
  import { renderRegionThumbnail, OVERVIEW_EDGE, DETAIL_EDGE } from "./worldMapThumbnail";

  let regions = $state<RegionMapEntry[]>([]);
  let loadError = $state<string | null>(null);
  let loading = $state(false);
  /** Low-detail continent-overview thumbnails (region id → PNG data URL). */
  let thumbById = $state<Record<string, string>>({});
  /** High-detail thumbnails, rendered on demand for the region you zoom into. */
  let detailById = $state<Record<string, string>>({});

  let mode = $state<MapViewMode>("world");
  let focusRegionId = $state<string | null>(null);
  let filters = $state<MapFilters>({ ...DEFAULT_MAP_FILTERS });
  let hoverLabel = $state<string | null>(null);
  let selectedMarkerId = $state<string | null>(null);

  let wrapEl: HTMLDivElement | undefined = $state();
  let cam = new MapCamera();
  // Reactive tick so SVG updates when camera mutates.
  let camTick = $state(0);
  function bumpCam(): void {
    camTick++;
  }

  let drag: { sx: number; sy: number; panX: number; panY: number } | null = null;

  const heading = $derived((((-game.compassYaw * 180) / Math.PI) % 360 + 360) % 360);
  const focusRegion = $derived(regions.find((r) => r.id === focusRegionId) ?? null);
  const currentRegionId = $derived(game.regionState?.regionId ?? null);

  const staticMarkers = $derived(
    buildStaticMarkers(regions, filters, mode === "region" ? focusRegionId : null),
  );

  const liveQuestMarkers = $derived.by((): MapMarker[] => {
    if (!filters.quests) return [];
    return game.questMarkers.map((m) => ({
      id: `live-q:${m.id}`,
      kind: "quest" as const,
      x: m.x,
      z: m.z,
      label: m.name || m.id,
      questMarker: m.marker as MapMarker["questMarker"],
    }));
  });

  const liveEventMarkers = $derived.by((): MapMarker[] => {
    if (!filters.events) return [];
    const byId = new Map(regions.map((r) => [r.id, r]));
    return game.worldEvents
      .filter((e) => e.phase === "active" || e.phase === "success" || e.phase === "failed")
      .map((e) => {
        const region = byId.get(e.regionId);
        const w = region
          ? regionLocalToWorld(region, e.localX, e.localZ)
          : { x: e.localX, z: e.localZ };
        return {
          id: `live-e:${e.id}`,
          kind: "event" as const,
          x: w.x,
          z: w.z,
          label: e.name,
          radius: e.radius,
          regionId: e.regionId,
          eventPhase: e.phase,
        };
      });
  });

  const partyMarkers = $derived.by((): MapMarker[] => {
    const list: MapMarker[] = [];
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
        id: `party:${member.id}`,
        kind: "party",
        x,
        z,
        label: member.name,
      });
    }
    return list;
  });

  const playerMarker = $derived.by((): MapMarker | null => {
    if (!game.self) return null;
    return {
      id: "player",
      kind: "player",
      x: game.playerX,
      z: game.playerZ,
      label: game.selfName || "You",
    };
  });

  const allMarkers = $derived.by(() => {
    void camTick;
    const liveEventKeys = new Set(
      liveEventMarkers.map((m) => m.id.replace(/^live-e:/, "")),
    );
    const merged: MapMarker[] = [];
    for (const m of staticMarkers) {
      if (m.kind === "event") {
        const raw = m.id.replace(/^evt:[^:]+:/, "");
        if (liveEventKeys.has(raw)) continue;
      }
      merged.push(m);
    }
    merged.push(...liveQuestMarkers, ...liveEventMarkers, ...partyMarkers);
    if (playerMarker) merged.push(playerMarker);
    return merged;
  });

  const regionTiles = $derived.by(() => {
    void camTick;
    return regions.map((r) => {
      const b = regionWorldBounds(r);
      const c = cam.worldToScreen(b.originX, b.originZ);
      // Region rects are axis-aligned on screen (north-up, no rotation), so an
      // <image> at (west,north)→(east,south) fits the tile exactly.
      const tl = cam.worldToScreen(b.minX, b.maxZ);
      const br = cam.worldToScreen(b.maxX, b.minZ);
      return {
        region: r,
        path: regionTilePath(cam, r),
        cx: c.x,
        cy: c.y,
        fill: r.colorGrading?.groundTint ?? BIOME_FILL[r.biome],
        current: r.id === currentRegionId,
        focused: r.id === focusRegionId,
        // Zoomed-into region uses its high-detail render; everything else the
        // cheap overview thumbnail.
        thumb: (r.id === focusRegionId ? detailById[r.id] : undefined) ?? thumbById[r.id],
        imgX: tl.x,
        imgY: tl.y,
        imgW: br.x - tl.x,
        imgH: br.y - tl.y,
      };
    });
  });

  const projectedMarkers = $derived.by(() => {
    void camTick;
    return allMarkers.map((m) => {
      const p = cam.worldToScreen(m.x, m.z);
      return { ...m, sx: p.x, sy: p.y, rPx: m.radius ? cam.metersToPixels(m.radius) : 0 };
    });
  });

  function normalizeRegion(raw: Partial<RegionMapEntry> & { id: string; name: string }): RegionMapEntry {
    return {
      id: raw.id,
      name: raw.name,
      biome: raw.biome ?? "grassland",
      gridSize: raw.gridSize ?? 2,
      pitch: raw.pitch ?? 1,
      worldOriginX: raw.worldOriginX ?? 0,
      worldOriginZ: raw.worldOriginZ ?? 0,
      portalWorldX: raw.portalWorldX ?? 0,
      portalWorldZ: raw.portalWorldZ ?? 0,
      isStartingRegion: raw.isStartingRegion,
      entryLocal: raw.entryLocal ?? { x: 0, z: 0 },
      colorGrading: raw.colorGrading,
      villages: raw.villages ?? [],
      portals: raw.portals ?? [],
      worldEvents: raw.worldEvents ?? [],
      npcs: raw.npcs ?? [],
    };
  }

  async function loadCatalog(): Promise<void> {
    loading = true;
    loadError = null;
    try {
      // Prefer the live game catalog (already fetched for continent streaming),
      // then refresh from /api/regions for overlay fields (villages/npcs/etc).
      const g = getGame();
      const fromGame = g ? await g.ensureRegionMapCatalog() : [];
      let fromApi: RegionMapEntry[] = [];
      try {
        const res = await fetch(app.apiUrl("/api/regions"), { credentials: "include" });
        if (res.ok) {
          const data = (await res.json()) as { regions?: Partial<RegionMapEntry>[] };
          fromApi = (data.regions ?? []).map((r) =>
            normalizeRegion(r as Partial<RegionMapEntry> & { id: string; name: string }),
          );
        }
      } catch {
        /* fall through to game catalog */
      }

      const byId = new Map<string, RegionMapEntry>();
      for (const r of fromGame) byId.set(r.id, normalizeRegion(r));
      for (const r of fromApi) {
        const prev = byId.get(r.id);
        byId.set(r.id, prev ? { ...prev, ...r, villages: r.villages, portals: r.portals, worldEvents: r.worldEvents, npcs: r.npcs } : r);
      }
      regions = [...byId.values()];

      if (regions.length === 0) {
        loadError = "No regions found. Is the server running, and have any regions been saved?";
      } else {
        // Always open on the continent overview so navigation is obvious.
        fitWorld();
        void loadThumbnails();
      }
    } catch (e) {
      loadError = e instanceof Error ? e.message : "Failed to load map";
    } finally {
      loading = false;
      // Stage may have just finished mounting — refit once size is known.
      queueMicrotask(() => {
        if (regions.length > 0 && mode === "world") fitWorld();
      });
    }
  }

  /** Fetch each region's full blueprint (heights) and render a painted
   *  relief thumbnail. Cheap + cached; failures leave the flat biome fill. */
  async function loadThumbnails(): Promise<void> {
    const g = getGame();
    if (!g) return;
    const ids = regions.map((r) => r.id);
    await Promise.all(
      ids.map(async (id) => {
        if (thumbById[id]) return;
        try {
          const bp = await g.ensureRegionBlueprint(id);
          if (!bp) return;
          const url = renderRegionThumbnail(bp, { edge: OVERVIEW_EDGE });
          if (url) thumbById = { ...thumbById, [id]: url };
        } catch {
          /* keep flat fill */
        }
      }),
    );
  }

  /** Render the high-detail relief for a region on demand (when zoomed into
   *  it) so its enlarged tile stays crisp instead of a stretched overview. */
  async function ensureDetail(id: string): Promise<void> {
    if (detailById[id]) return;
    const g = getGame();
    if (!g) return;
    try {
      const bp = await g.ensureRegionBlueprint(id);
      if (!bp) return;
      const url = renderRegionThumbnail(bp, { edge: DETAIL_EDGE });
      if (url) detailById = { ...detailById, [id]: url };
    } catch {
      /* keep overview thumbnail */
    }
  }

  function resize(): void {
    if (!wrapEl) return;
    cam.resize(wrapEl.clientWidth, wrapEl.clientHeight);
    bumpCam();
  }

  function fitWorld(): void {
    mode = "world";
    focusRegionId = null;
    resize();
    if (regions.length > 0) cam.fitContinent(regions, 72);
    bumpCam();
  }

  function openRegion(id: string): void {
    const r = regions.find((x) => x.id === id);
    if (!r) return;
    mode = "region";
    focusRegionId = id;
    resize();
    cam.fitRegion(r, 56);
    bumpCam();
    // Zoomed in → render the crisp high-detail relief for this region.
    void ensureDetail(id);
  }

  function close(): void {
    getGame()?.setWorldMapOpen(false);
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { sx: e.clientX, sy: e.clientY, panX: cam.panX, panY: cam.panY };
  }

  function onPointerMove(e: PointerEvent): void {
    if (!wrapEl) return;
    const rect = wrapEl.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (drag) {
      cam.panX = drag.panX + (e.clientX - drag.sx);
      cam.panY = drag.panY + (e.clientY - drag.sy);
      bumpCam();
      return;
    }

    const world = cam.screenToWorld(sx, sy);
    const hit = hitTestRegion(regions, world.x, world.z);
    hoverLabel = hit ? `${hit.name} · ${biomeLabel(hit.biome)}` : null;
  }

  function onPointerUp(e: PointerEvent): void {
    const wasDrag = drag;
    drag = null;
    if (!wasDrag || !wrapEl) return;
    const moved = Math.hypot(e.clientX - wasDrag.sx, e.clientY - wasDrag.sy);
    if (moved > 6) return;
    const rect = wrapEl.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = cam.screenToWorld(sx, sy);
    const hit = hitTestRegion(regions, world.x, world.z);
    if (hit && mode === "world") openRegion(hit.id);
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (!wrapEl) return;
    const rect = wrapEl.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = e.deltaY > 0 ? 0.9 : 1.11;
    cam.zoomAt(sx, sy, factor);
    bumpCam();
  }

  function toggleFilter(key: keyof MapFilters): void {
    filters = { ...filters, [key]: !filters[key] };
  }

  function zoomIn(): void {
    cam.zoomAt(cam.width / 2, cam.height / 2, 1.2);
    bumpCam();
  }
  function zoomOut(): void {
    cam.zoomAt(cam.width / 2, cam.height / 2, 0.83);
    bumpCam();
  }

  function recenterOnPlayer(): void {
    if (!playerMarker) return;
    cam.focusX = playerMarker.x;
    cam.focusZ = playerMarker.z;
    cam.panX = 0;
    cam.panY = 0;
    bumpCam();
  }

  $effect(() => {
    if (!game.worldMapOpen) return;
    void loadCatalog();
  });

  $effect(() => {
    if (!game.worldMapOpen || !wrapEl) return;
    const el = wrapEl;
    // Frame the current view once per open. Untracked so writing mode /
    // focusRegionId (via fitWorld / openRegion) and reading regions doesn't
    // re-trigger this effect into an infinite resize→bumpCam loop.
    untrack(() => {
      resize();
      if (regions.length > 0) {
        if (mode === "region" && focusRegionId) openRegion(focusRegionId);
        else fitWorld();
      }
    });
    const ro = new ResizeObserver(() => {
      resize();
      if (regions.length === 0) return;
      if (mode === "region" && focusRegionId) {
        const r = regions.find((x) => x.id === focusRegionId);
        if (r) cam.fitRegion(r, 56);
      } else {
        cam.fitContinent(regions, 72);
      }
      bumpCam();
    });
    ro.observe(el);
    return () => ro.disconnect();
  });

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!game.worldMapOpen) return;
      if (e.key === "Escape") {
        if (mode === "region") {
          e.stopPropagation();
          fitWorld();
        } else {
          close();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const QUEST_GLYPH: Record<string, string> = {
    available: "!",
    complete: "?",
    active: "•",
    escort: "S",
  };
</script>

{#if game.worldMapOpen}
  <div class="wm-overlay" role="dialog" aria-label="World Map">
    <header class="wm-top">
      <div class="wm-brand">
        <span class="wm-kicker">Atlas</span>
        <h1 class="wm-title">
          {#if mode === "region" && focusRegion}
            {focusRegion.name}
          {:else}
            Continent
          {/if}
        </h1>
        <nav class="wm-crumb" aria-label="Map breadcrumb">
          <button type="button" class:on={mode === "world"} onclick={fitWorld}>Continent</button>
          {#if focusRegion}
            <span class="sep">/</span>
            <button type="button" class:on={mode === "region"} onclick={() => openRegion(focusRegion.id)}>
              {focusRegion.name}
            </button>
          {/if}
        </nav>
      </div>
      <div class="wm-top-actions">
        {#if mode === "region"}
          <button type="button" class="wm-back" onclick={fitWorld}>← Continent</button>
        {/if}
        {#if hoverLabel}<span class="wm-hover">{hoverLabel}</span>{/if}
        <button type="button" class="rc-close" onclick={close} aria-label="Close map">✕</button>
      </div>
    </header>

    <aside class="wm-side">
      <div class="side-section">
        <div class="side-label">Navigate</div>
        <div class="region-list">
          <button
            type="button"
            class="region-row"
            class:on={mode === "world"}
            onclick={fitWorld}
          >
            <span class="swatch all"></span>
            <span class="rname">Continent</span>
            <span class="rmeta">{regions.length}</span>
          </button>
          {#each regions as r (r.id)}
            <button
              type="button"
              class="region-row"
              class:on={focusRegionId === r.id && mode === "region"}
              class:here={r.id === currentRegionId}
              onclick={() => openRegion(r.id)}
            >
              <span class="swatch" style="background: {r.colorGrading?.groundTint ?? BIOME_FILL[r.biome]}"></span>
              <span class="rname">{r.name}</span>
              <span class="rmeta">{biomeLabel(r.biome)}</span>
            </button>
          {:else}
            {#if !loading}
              <div class="empty-regions">No regions loaded</div>
            {/if}
          {/each}
        </div>
      </div>

      <div class="side-section">
        <div class="side-label">Filters</div>
        <div class="filter-grid">
          {#each Object.keys(filters) as key (key)}
            {@const k = key as keyof MapFilters}
            <label class="filter">
              <input type="checkbox" checked={filters[k]} onchange={() => toggleFilter(k)} />
              <span>{k}</span>
            </label>
          {/each}
        </div>
      </div>

      <div class="side-section legend">
        <div class="side-label">Legend</div>
        <div class="legend-row"><span class="lg village"></span>Village</div>
        <div class="legend-row"><span class="lg quest">!</span>Quest</div>
        <div class="legend-row"><span class="lg event"></span>World Event</div>
        <div class="legend-row"><span class="lg portal"></span>Portal</div>
        <div class="legend-row"><span class="lg player"></span>You</div>
        <div class="legend-row"><span class="lg party"></span>Party</div>
      </div>

      <div class="side-hint">Scroll to zoom · Drag to pan · Click a region to enter · Esc / M to close</div>
    </aside>

    <div
      class="wm-stage"
      bind:this={wrapEl}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={() => (drag = null)}
      onwheel={onWheel}
      role="application"
      aria-label="Map canvas"
    >
      {#if loading}
        <div class="wm-status">Charting the continent…</div>
      {:else if loadError}
        <div class="wm-status error">{loadError}</div>
      {:else if regions.length === 0}
        <div class="wm-status error">No regions to display</div>
      {:else}
        <svg class="wm-svg" width="100%" height="100%">
          <defs>
            <pattern id="wm-grid" width="64" height="64" patternUnits="userSpaceOnUse">
              <path d="M 64 0 L 0 0 0 64" fill="none" stroke="rgba(180,220,235,0.05)" stroke-width="1" />
            </pattern>
            <!-- Deep ocean: teal near the middle fading to dark navy at the edges. -->
            <radialGradient id="wm-ocean" cx="48%" cy="42%" r="75%">
              <stop offset="0%" stop-color="#1a5566" />
              <stop offset="45%" stop-color="#123f52" />
              <stop offset="100%" stop-color="#08202f" />
            </radialGradient>
            <radialGradient id="wm-vignette" cx="50%" cy="50%" r="70%">
              <stop offset="0%" stop-color="rgba(0,0,0,0)" />
              <stop offset="100%" stop-color="rgba(4,12,20,0.6)" />
            </radialGradient>
            <!-- Coastal shallows glow (wide blur) + beach ring (tight blur). -->
            <filter id="wm-coast" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="26" />
            </filter>
            <filter id="wm-beach" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="8" />
            </filter>
          </defs>

          <rect width="100%" height="100%" fill="url(#wm-ocean)" />

          <!-- Continent backdrop: each region radiates a shallow-water halo,
               then a sandy coast, so the terrain tiles sit on land in the sea.
               Overlapping regions' halos merge into one landmass (GW2-style). -->
          <g class="wm-shallows" filter="url(#wm-coast)">
            {#each regionTiles as tile (tile.region.id)}
              <rect
                x={tile.imgX - 40}
                y={tile.imgY - 40}
                width={tile.imgW + 80}
                height={tile.imgH + 80}
                rx="26"
              />
            {/each}
          </g>
          <g class="wm-coast" filter="url(#wm-beach)">
            {#each regionTiles as tile (tile.region.id)}
              <rect
                x={tile.imgX - 13}
                y={tile.imgY - 13}
                width={tile.imgW + 26}
                height={tile.imgH + 26}
                rx="12"
              />
            {/each}
          </g>

          <rect width="100%" height="100%" fill="url(#wm-grid)" />

          {#each regionTiles as tile (tile.region.id)}
            {#if tile.thumb && tile.imgW > 0 && tile.imgH > 0}
              <image
                class="tile-thumb"
                class:dim={mode === "region" && !tile.focused}
                href={tile.thumb}
                x={tile.imgX}
                y={tile.imgY}
                width={tile.imgW}
                height={tile.imgH}
                preserveAspectRatio="none"
              />
            {/if}
            <path
              d={tile.path}
              class="tile"
              class:current={tile.current}
              class:focused={tile.focused}
              class:dim={mode === "region" && !tile.focused}
              class:has-thumb={!!tile.thumb}
              style="fill: {tile.thumb ? 'none' : tile.fill}"
            />
            {#if mode === "world" || tile.focused}
              <text x={tile.cx} y={tile.cy} class="tile-label">{tile.region.name}</text>
              <text x={tile.cx} y={tile.cy + 16} class="tile-biome">{biomeLabel(tile.region.biome)}</text>
            {/if}
          {/each}

          {#each projectedMarkers as m (m.id)}
            {#if m.kind === "event" && m.rPx > 4}
              <circle cx={m.sx} cy={m.sy} r={m.rPx} class="event-radius" class:active={m.eventPhase === "active"} />
            {/if}
            {#if m.kind === "village" && m.rPx > 4}
              <circle cx={m.sx} cy={m.sy} r={m.rPx} class="village-radius" />
            {/if}
          {/each}

          {#each projectedMarkers as m (m.id)}
            <g
              class="marker"
              class:selected={selectedMarkerId === m.id}
              transform="translate({m.sx} {m.sy})"
              role="button"
              tabindex="0"
              onclick={(e) => {
                e.stopPropagation();
                selectedMarkerId = m.id;
              }}
              onkeydown={(e) => {
                if (e.key === "Enter" || e.key === " ") selectedMarkerId = m.id;
              }}
            >
              {#if m.kind === "village"}
                <circle r="6" class="mk village" />
                {#if mode === "region"}
                  <text y="-12" class="mk-label">{m.label}</text>
                {/if}
              {:else if m.kind === "quest" || m.kind === "questNpc"}
                <circle r="8" class="mk quest mk-{m.questMarker ?? 'available'}" />
                <text y="3.5" class="mk-glyph">{QUEST_GLYPH[m.questMarker ?? "available"]}</text>
                {#if mode === "region"}
                  <text y="-14" class="mk-label">{m.label}</text>
                {/if}
              {:else if m.kind === "event"}
                <circle r="7" class="mk event" class:active={m.eventPhase === "active"} />
                {#if mode === "region"}
                  <text y="-14" class="mk-label event">{m.label}</text>
                {/if}
              {:else if m.kind === "portal"}
                <rect x="-5" y="-5" width="10" height="10" transform="rotate(45)" class="mk portal" />
                {#if mode === "region"}
                  <text y="-14" class="mk-label">{m.label}</text>
                {/if}
              {:else if m.kind === "npc"}
                <circle r="4" class="mk npc" />
              {:else if m.kind === "entry"}
                <circle r="5" class="mk entry" />
                <text y="-12" class="mk-label">Entry</text>
              {:else if m.kind === "party"}
                <circle r="7" class="mk party" />
                <text y="-13" class="mk-label party">{m.label}</text>
              {:else if m.kind === "player"}
                <g transform="rotate({heading})">
                  <path d="M 0 -11 L 7 8 L 0 4 L -7 8 Z" class="mk player" />
                </g>
                <text y="-16" class="mk-label player">{m.label}</text>
              {/if}
            </g>
          {/each}

          <rect width="100%" height="100%" fill="url(#wm-vignette)" pointer-events="none" />
        </svg>
      {/if}

      <div class="wm-fab">
        <button type="button" title="Zoom in" onclick={zoomIn}>+</button>
        <button type="button" title="Zoom out" onclick={zoomOut}>−</button>
        <button type="button" title="Recenter on you" onclick={recenterOnPlayer}>◎</button>
        {#if mode === "region"}
          <button type="button" title="Back to continent" onclick={fitWorld}>⧉</button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .wm-overlay {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    grid-template-columns: 260px 1fr;
    grid-template-rows: auto 1fr;
    grid-template-areas:
      "top top"
      "side stage";
    background:
      radial-gradient(ellipse at 20% 0%, rgba(80, 40, 110, 0.35), transparent 50%),
      #0a0810;
    color: var(--rc-ink);
    pointer-events: auto;
    font-family: var(--rc-body);
  }

  .wm-top {
    grid-area: top;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px 10px;
    border-bottom: 1px solid rgba(196, 163, 90, 0.28);
    background: linear-gradient(180deg, rgba(36, 28, 48, 0.95), rgba(16, 12, 22, 0.9));
  }
  .wm-kicker {
    display: block;
    font-family: var(--rc-display);
    font-size: 10px;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: var(--rc-gold);
    margin-bottom: 2px;
  }
  .wm-title {
    margin: 0;
    font-family: var(--rc-display);
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 2px;
    text-transform: uppercase;
  }
  .wm-crumb {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
  }
  .wm-crumb button {
    background: none;
    border: none;
    color: var(--rc-ink-dim);
    font-family: var(--rc-display);
    font-size: 11px;
    letter-spacing: 1px;
    text-transform: uppercase;
    padding: 0;
    cursor: pointer;
  }
  .wm-crumb button.on,
  .wm-crumb button:hover {
    color: var(--rc-gold-bright);
  }
  .wm-crumb .sep {
    color: var(--rc-ink-dim);
    opacity: 0.5;
  }
  .wm-top-actions {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .wm-hover {
    font-size: 12px;
    color: var(--rc-ink-dim);
    letter-spacing: 0.5px;
  }
  .wm-back {
    background: linear-gradient(180deg, #3a2e48, #1c1628);
    border: 1px solid rgba(196, 163, 90, 0.5);
    color: var(--rc-ink);
    font-family: var(--rc-display);
    font-size: 11px;
    letter-spacing: 1px;
    text-transform: uppercase;
    padding: 6px 12px;
    border-radius: 3px;
    cursor: pointer;
  }
  .wm-back:hover {
    border-color: var(--rc-gold-bright);
    color: var(--rc-gold-bright);
  }
  .empty-regions {
    font-size: 11px;
    color: var(--rc-ink-dim);
    padding: 8px;
    font-style: italic;
  }

  .wm-side {
    grid-area: side;
    border-right: 1px solid rgba(196, 163, 90, 0.22);
    background: rgba(14, 10, 20, 0.92);
    padding: 14px 12px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .side-label {
    font-family: var(--rc-display);
    font-size: 11px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--rc-gold);
    margin-bottom: 8px;
  }
  .region-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .region-row {
    display: grid;
    grid-template-columns: 12px 1fr auto;
    gap: 8px;
    align-items: center;
    width: 100%;
    text-align: left;
    padding: 8px 8px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    color: var(--rc-ink);
    cursor: pointer;
  }
  .region-row:hover {
    background: rgba(80, 40, 110, 0.25);
    border-color: rgba(196, 163, 90, 0.25);
  }
  .region-row.on {
    background: rgba(80, 40, 110, 0.4);
    border-color: rgba(196, 163, 90, 0.45);
  }
  .region-row.here .rname::after {
    content: " · here";
    color: var(--rc-magenta-bright);
    font-size: 10px;
  }
  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 2px;
    border: 1px solid rgba(0, 0, 0, 0.5);
  }
  .swatch.all {
    background: linear-gradient(135deg, #3d6b32, #6a8fa8 50%, #7a3228);
  }
  .rname {
    font-size: 12px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rmeta {
    font-size: 10px;
    color: var(--rc-ink-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .filter-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .filter {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    text-transform: capitalize;
    color: var(--rc-ink-dim);
    cursor: pointer;
  }
  .filter input {
    accent-color: var(--rc-magenta);
  }

  .legend-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: var(--rc-ink-dim);
    margin-bottom: 4px;
  }
  .lg {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    font-weight: 900;
  }
  .lg.village { background: #efe6d4; }
  .lg.quest { background: #ffd400; color: #1a1408; border-radius: 50%; }
  .lg.event { background: #ff8800; }
  .lg.portal { background: #c583ff; border-radius: 1px; transform: rotate(45deg); }
  .lg.player { background: var(--rc-gold-bright); }
  .lg.party { background: #3b82f6; }

  .side-hint {
    margin-top: auto;
    font-size: 10px;
    line-height: 1.45;
    color: var(--rc-ink-dim);
    opacity: 0.85;
  }

  .wm-stage {
    grid-area: stage;
    position: relative;
    overflow: hidden;
    touch-action: none;
    cursor: grab;
  }
  .wm-stage:active {
    cursor: grabbing;
  }
  .wm-svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  /* Coastal shallows halo around the landmass (wide, translucent teal). */
  .wm-shallows rect {
    fill: #2f93a8;
    fill-opacity: 0.5;
  }
  /* Sandy coast under the tiles so terrain meets a beach, not open water. */
  .wm-coast rect {
    fill: #a89162;
    fill-opacity: 0.85;
  }
  .wm-status {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--rc-display);
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--rc-ink-dim);
  }
  .wm-status.error {
    color: #ff8a80;
  }

  .tile {
    stroke: rgba(196, 163, 90, 0.45);
    stroke-width: 1.5;
    fill-opacity: 0.72;
    transition: fill-opacity 0.15s ease, stroke 0.15s ease;
  }
  .tile.current {
    stroke: var(--rc-magenta-bright);
    stroke-width: 2.5;
    fill-opacity: 0.85;
  }
  .tile.focused {
    stroke: var(--rc-gold-bright);
    stroke-width: 2.5;
    fill-opacity: 0.9;
  }
  .tile.dim {
    fill-opacity: 0.18;
    stroke-opacity: 0.25;
  }
  /* With a painted thumbnail the fill is transparent; the stroke + states
     still convey current / focused / dim. */
  .tile.has-thumb {
    fill: none;
  }
  .tile-thumb {
    pointer-events: none;
    opacity: 0.96;
    transition: opacity 0.15s ease;
  }
  .tile-thumb.dim {
    opacity: 0.28;
  }
  .tile-label {
    fill: #f4eef8;
    font-family: var(--rc-display);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 1px;
    text-anchor: middle;
    pointer-events: none;
    paint-order: stroke;
    stroke: rgba(0, 0, 0, 0.75);
    stroke-width: 3px;
  }
  .tile-biome {
    fill: rgba(232, 200, 120, 0.85);
    font-family: var(--rc-body);
    font-size: 10px;
    letter-spacing: 1px;
    text-transform: uppercase;
    text-anchor: middle;
    pointer-events: none;
  }

  .village-radius {
    fill: rgba(239, 230, 212, 0.08);
    stroke: rgba(239, 230, 212, 0.25);
    stroke-width: 1;
    pointer-events: none;
  }
  .event-radius {
    fill: rgba(255, 136, 0, 0.08);
    stroke: rgba(255, 136, 0, 0.35);
    stroke-width: 1.2;
    pointer-events: none;
  }
  .event-radius.active {
    fill: rgba(255, 136, 0, 0.16);
    stroke: rgba(255, 180, 80, 0.7);
  }

  .marker {
    cursor: pointer;
  }
  .mk {
    stroke: rgba(0, 0, 0, 0.7);
    stroke-width: 1;
  }
  .mk.village { fill: #efe6d4; }
  .mk.quest { fill: #ffd400; }
  .mk.quest.mk-active { fill: #b0b0b0; }
  .mk.quest.mk-complete { fill: #ffd400; }
  .mk.event { fill: #ff8800; }
  .mk.event.active { fill: #ffb060; }
  .mk.portal { fill: #c583ff; stroke-width: 0.8; }
  .mk.npc { fill: #9ab0c8; }
  .mk.entry { fill: var(--rc-gold); }
  .mk.party { fill: #3b82f6; }
  .mk.player {
    fill: var(--rc-gold-bright);
    stroke: rgba(0, 0, 0, 0.75);
    stroke-width: 0.8;
  }
  .mk-glyph {
    fill: #1a1408;
    font-family: var(--rc-display);
    font-weight: 900;
    font-size: 10px;
    text-anchor: middle;
    pointer-events: none;
  }
  .mk-label {
    fill: #f4eef8;
    font-family: var(--rc-display);
    font-size: 11px;
    font-weight: 700;
    text-anchor: middle;
    pointer-events: none;
    paint-order: stroke;
    stroke: rgba(0, 0, 0, 0.8);
    stroke-width: 2.5px;
  }
  .mk-label.event { fill: #ffb060; }
  .mk-label.party { fill: #93c5fd; }
  .mk-label.player { fill: var(--rc-gold-bright); }

  .wm-fab {
    position: absolute;
    right: 16px;
    bottom: 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .wm-fab button {
    width: 36px;
    height: 36px;
    border-radius: 3px;
    border: 1px solid rgba(196, 163, 90, 0.5);
    background: linear-gradient(180deg, #3a2e48, #1c1628);
    color: var(--rc-ink);
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
  }
  .wm-fab button:hover {
    border-color: var(--rc-gold-bright);
    color: var(--rc-gold-bright);
  }

  @media (max-width: 820px) {
    .wm-overlay {
      grid-template-columns: 1fr;
      grid-template-rows: auto auto 1fr;
      grid-template-areas:
        "top"
        "side"
        "stage";
    }
    .wm-side {
      border-right: none;
      border-bottom: 1px solid rgba(196, 163, 90, 0.22);
      max-height: 160px;
      flex-direction: row;
      flex-wrap: wrap;
      gap: 10px;
    }
    .side-section {
      min-width: 140px;
      flex: 1;
    }
    .side-hint { display: none; }
  }
</style>
