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
    getRegionZoneMeta,
    hitTestRegion,
    regionTilePath,
    type MapFilters,
    type MapMarker,
    type MapViewMode,
  } from "./worldMapModel";
  import { OVERVIEW_EDGE, DETAIL_EDGE } from "./worldMapThumbnail";
  import { requestRegionThumbnailAsync, requestRegionLandMaskAsync } from "../render/worldMapThumbnailWorker";

  let regions = $state<RegionMapEntry[]>([]);
  let loadError = $state<string | null>(null);
  let loading = $state(false);
  /** Low-detail continent-overview thumbnails (region id → PNG data URL). */
  let thumbById = $state<Record<string, string>>({});
  /** Transparent land-only mask thumbnails for coastline-conforming hover glows. */
  let landMaskById = $state<Record<string, string>>({});
  /** High-detail thumbnails, rendered on demand for the region you zoom into. */
  let detailById = $state<Record<string, string>>({});

  let mode = $state<MapViewMode>("world");
  let focusRegionId = $state<string | null>(null);
  let hoverRegionId = $state<string | null>(null);
  let filters = $state<MapFilters>({ ...DEFAULT_MAP_FILTERS });
  let hoverLabel = $state<string | null>(null);
  let selectedMarkerId = $state<string | null>(null);

  let wrapEl: HTMLDivElement | undefined = $state();
  let cam = new MapCamera();


  // Match Minimap's negated X-projection for all vector markers & clicks
  const rawWorldToScreen = cam.worldToScreen.bind(cam);
  cam.worldToScreen = function (x: number, z: number) {
    const p = rawWorldToScreen(x, z);
    return { x: cam.width - p.x, y: p.y };
  };

  const rawScreenToWorld = cam.screenToWorld.bind(cam);
  cam.screenToWorld = function (sx: number, sy: number) {
    return rawScreenToWorld(cam.width - sx, sy);
  };


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
      regionId: currentRegionId ?? undefined,
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

  let blipTick = $state(0);
  $effect(() => {
    if (!game.worldMapOpen) return;
    const iv = setInterval(() => blipTick++, 250);
    return () => clearInterval(iv);
  });

  const playerMarker = $derived.by((): MapMarker | null => {
    void blipTick;
    if (!game.self) return null;
    const g = getGame();
    let x = game.playerX;
    let z = game.playerZ;
    if (g && game.selfId) {
      const realPos = g.entities.entityWorldPos(game.selfId);
      if (realPos) {
        x = realPos.x;
        z = realPos.z;
      }
    }
    return {
      id: "player",
      kind: "player",
      x,
      z,
      label: game.selfName || "You",
      regionId: currentRegionId ?? undefined,
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
    const list = mode === "region" && focusRegionId
      ? regions.filter((r) => r.id === focusRegionId)
      : regions;
    return list.map((r) => {
      const b = regionWorldBounds(r);
      const c = cam.worldToScreen(b.originX, b.originZ);

      const nw = cam.worldToScreen(b.minX, b.maxZ);
      const se = cam.worldToScreen(b.maxX, b.minZ);

      const imgX = Math.min(nw.x, se.x);
      const imgY = Math.min(nw.y, se.y);
      const imgW = Math.abs(se.x - nw.x);
      const imgH = Math.abs(se.y - nw.y);

      return {
        region: r,
        path: regionTilePath(cam, r),
        cx: c.x,
        cy: c.y,
        fill: r.colorGrading?.groundTint ?? BIOME_FILL[r.biome],
        current: r.id === currentRegionId,
        focused: r.id === focusRegionId,
        thumb: (r.id === focusRegionId ? detailById[r.id] : undefined) ?? thumbById[r.id],
        landMask: landMaskById[r.id],
        imgX,
        imgY,
        imgW,
        imgH,
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

  const mobMarkers = $derived.by(() => {
    void camTick;
    void blipTick;
    const g = getGame();
    if (!g) return [] as { sx: number; sy: number }[];
    return g.entities
      .mapBlips()
      .filter((b) => b.hostile)
      .map((b) => {
        const p = cam.worldToScreen(b.x, b.z);
        return { sx: p.x, sy: p.y };
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
        const focus = game.worldMapFocusRegionId;
        game.worldMapFocusRegionId = null;
        if (focus && regions.some((r) => r.id === focus)) openRegion(focus);
        else fitWorld();
        void loadThumbnails();
      }
    } catch (e) {
      loadError = e instanceof Error ? e.message : "Failed to load map";
    } finally {
      loading = false;
      queueMicrotask(() => {
        if (regions.length > 0 && mode === "world") fitWorld();
      });
    }
  }

  async function loadThumbnails(): Promise<void> {
    const g = getGame();
    if (g) {
      let updatedThumbs = false;
      let updatedMasks = false;
      let updatedDetails = false;
      const tMap = { ...thumbById };
      const mMap = { ...landMaskById };
      const dMap = { ...detailById };

      for (const [id, url] of g.prewarmedThumbnails) {
        if (!tMap[id]) {
          tMap[id] = url;
          updatedThumbs = true;
        }
      }
      for (const [id, mask] of g.prewarmedLandMasks) {
        if (!mMap[id]) {
          mMap[id] = mask;
          updatedMasks = true;
        }
      }
      for (const [id, detail] of g.prewarmedDetails) {
        if (!dMap[id]) {
          dMap[id] = detail;
          updatedDetails = true;
        }
      }
      if (updatedThumbs) thumbById = tMap;
      if (updatedMasks) landMaskById = mMap;
      if (updatedDetails) detailById = dMap;
    }

    await Promise.all(
      regions.map(async (r) => {
        if (thumbById[r.id] && landMaskById[r.id]) return;
        let bp = g ? await g.ensureRegionBlueprint(r.id) : null;
        const src = bp ?? {
          gridSize: r.gridSize ?? 32,
          pitch: r.pitch ?? 1,
          biome: r.biome,
          colorGrading: r.colorGrading,
        };
        const urlPromise = thumbById[r.id]
          ? Promise.resolve(thumbById[r.id])
          : requestRegionThumbnailAsync(src, { edge: OVERVIEW_EDGE });
        const maskPromise = landMaskById[r.id]
          ? Promise.resolve(landMaskById[r.id])
          : requestRegionLandMaskAsync(src, { edge: OVERVIEW_EDGE });
        const [url, maskUrl] = await Promise.all([urlPromise, maskPromise]);
        if (url && !thumbById[r.id]) thumbById = { ...thumbById, [r.id]: url };
        if (maskUrl && !landMaskById[r.id]) landMaskById = { ...landMaskById, [r.id]: maskUrl };
      }),
    );
  }

  async function ensureDetail(id: string): Promise<void> {
    if (detailById[id]) return;
    const g = getGame();
    if (g && g.prewarmedDetails.has(id)) {
      detailById = { ...detailById, [id]: g.prewarmedDetails.get(id)! };
      return;
    }
    const r = regions.find((x) => x.id === id);
    if (!r) return;
    let bp = g ? await g.ensureRegionBlueprint(id) : null;
    const src = bp ?? {
      gridSize: r.gridSize ?? 32,
      pitch: r.pitch ?? 1,
      biome: r.biome,
      colorGrading: r.colorGrading,
    };
    const url = await requestRegionThumbnailAsync(src, { edge: DETAIL_EDGE });
    if (url) detailById = { ...detailById, [id]: url };
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
    setTimeout(() => { void ensureDetail(id); }, 10);
  }

  function close(): void {
    getGame()?.setWorldMapOpen(false);
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag = { sx: e.clientX, sy: e.clientY, panX: cam.panX, panY: cam.panY };
  }

  let hoveredRegion = $state<RegionMapEntry | null>(null);
  let tooltipX = $state(0);
  let tooltipY = $state(0);

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
    hoveredRegion = hit;
    hoverLabel = hit ? `${hit.name} · ${biomeLabel(hit.biome)}` : null;
    tooltipX = Math.min(rect.width - 250, Math.max(16, sx + 20));
    tooltipY = Math.min(rect.height - 180, Math.max(16, sy + 20));
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
    thumbById = {};
    detailById = {};
    void loadCatalog();
  });

  $effect(() => {
    if (!game.worldMapOpen || !wrapEl) return;
    const el = wrapEl;
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
  <div class="wm-overlay art-map-frame" role="dialog" aria-label="World Map">
    <header class="wm-top art-map-gold-header">
      <div class="wm-brand" style="display: flex; align-items: center; gap: 16px;">
        <button
          type="button"
          class="art-map-toggle-btn"
          onclick={() => {
            if (mode === "region") fitWorld();
            else if (focusRegionId) openRegion(focusRegionId);
            else if (regions.length > 0) openRegion(regions[0]!.id);
          }}
        >
          {mode === "region" ? "World map" : "Zone map"}
        </button>

        <h1 class="wm-title" style="color: #f7e7c4; font-size: 20px; font-weight: 900; letter-spacing: 2px;">
          {#if mode === "region" && focusRegion}
            {getRegionZoneMeta(focusRegion).title}
          {:else}
            World Map
          {/if}
        </h1>
      </div>
      <div class="wm-top-actions">
        {#if mode === "region"}
          <button type="button" class="wm-back" onclick={fitWorld}>← World Map</button>
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
            {@const meta = getRegionZoneMeta(r)}
            <button
              type="button"
              class="region-row"
              class:on={focusRegionId === r.id && mode === "region"}
              class:here={r.id === currentRegionId}
              onclick={() => openRegion(r.id)}
            >
              <span class="swatch" style="background: {r.colorGrading?.groundTint ?? BIOME_FILL[r.biome]}"></span>
              <span class="rname">{meta.title}</span>
              <span class="rmeta">{meta.levelRange}</span>
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
        <svg class="wm-svg art-map-ocean" width="100%" height="100%">
          <defs>
            <pattern id="wm-grid" width="64" height="64" patternUnits="userSpaceOnUse">
              <path d="M 64 0 L 0 0 0 64" fill="none" stroke="rgba(180,220,235,0.05)" stroke-width="1" />
            </pattern>
            <!-- Deep ocean: navy matching thumbnail water depth -->
            <radialGradient id="wm-ocean" cx="48%" cy="42%" r="85%">
              <stop offset="0%" stop-color="#0a2444" />
              <stop offset="55%" stop-color="#06182e" />
              <stop offset="100%" stop-color="#030c18" />
            </radialGradient>
            <radialGradient id="wm-vignette" cx="50%" cy="50%" r="70%">
              <stop offset="0%" stop-color="rgba(0,0,0,0)" />
              <stop offset="100%" stop-color="rgba(4,12,20,0.6)" />
            </radialGradient>
          </defs>

          <rect width="100%" height="100%" fill="url(#wm-ocean)" />

          <!-- Compass Rose Ornament (Top Right) -->
          <g transform="translate({(cam.width || 800) - 90}, 90)" opacity="0.65" pointer-events="none">
            <circle r="40" fill="none" stroke="#c4a35a" stroke-width="1.5" stroke-dasharray="4 2" />
            <circle r="34" fill="none" stroke="#8a6f3a" stroke-width="1" />
            <path d="M 0 -44 L 7 -10 L 0 0 L -7 -10 Z" fill="#e8c878" />
            <path d="M 0 -44 L -7 -10 L 0 0 Z" fill="#8a6f3a" />
            <path d="M 0 44 L 7 10 L 0 0 L -7 10 Z" fill="#c4a35a" />
            <path d="M 44 0 L 10 7 L 0 0 L 10 -7 Z" fill="#c4a35a" />
            <path d="M -44 0 L -10 7 L 0 0 L -10 -7 Z" fill="#c4a35a" />
            <text y="-48" text-anchor="middle" fill="#e8c878" font-family="Cinzel" font-weight="900" font-size="13">N</text>
            <text y="58" text-anchor="middle" fill="#8a6f3a" font-family="Cinzel" font-weight="700" font-size="11">S</text>
            <text x="52" y="4" text-anchor="middle" fill="#8a6f3a" font-family="Cinzel" font-weight="700" font-size="11">E</text>
            <text x="-52" y="4" text-anchor="middle" fill="#8a6f3a" font-family="Cinzel" font-weight="700" font-size="11">W</text>
          </g>

          <!-- Cartographic Map Scale & Nautical Details (Bottom Left) -->
          <g transform="translate(30, {(cam.height || 600) - 30})" pointer-events="none" opacity="0.75">
            <line x1="0" y1="0" x2="120" y2="0" stroke="#c4a35a" stroke-width="2" />
            <line x1="0" y1="-5" x2="0" y2="5" stroke="#c4a35a" stroke-width="2" />
            <line x1="60" y1="-3" x2="60" y2="3" stroke="#c4a35a" stroke-width="1.5" />
            <line x1="120" y1="-5" x2="120" y2="5" stroke="#c4a35a" stroke-width="2" />
            <text x="0" y="-8" fill="#e8c878" font-family="Cinzel" font-size="10" font-weight="700">0</text>
            <text x="60" y="-8" text-anchor="middle" fill="#e8c878" font-family="Cinzel" font-size="10">250m</text>
            <text x="120" y="-8" text-anchor="end" fill="#e8c878" font-family="Cinzel" font-size="10" font-weight="700">500m</text>
            <text x="60" y="16" text-anchor="middle" fill="#8a6f3a" font-family="Cinzel" font-size="9" letter-spacing="1">MAP SCALE</text>
          </g>

          <rect width="100%" height="100%" fill="url(#wm-grid)" />

          {#each regionTiles as tile (tile.region.id)}
            {@const meta = getRegionZoneMeta(tile.region)}
            {@const isHovered = mode === "world" && hoveredRegion?.id === tile.region.id}
            <g
              class="tile-group"
              class:hovered={isHovered}
              class:focused={tile.focused}
              class:current={tile.current}
              onclick={() => openRegion(tile.region.id)}
              role="button"
              tabindex="0"
              onkeydown={(e) => { if (e.key === "Enter" || e.key === " ") openRegion(tile.region.id); }}
            >
              {#if tile.thumb && tile.imgW > 0 && tile.imgH > 0}
                <g transform="translate({tile.imgX + tile.imgW}, {tile.imgY}) scale(-1, 1)">
                  <image
                    class="tile-thumb"
                    class:dim={mode === "region" && !tile.focused}
                    class:hovered={isHovered}
                    href={tile.thumb}
                    x="0"
                    y="0"
                    width={tile.imgW}
                    height={tile.imgH}
                    preserveAspectRatio="none"
                  />
                </g>
              {/if}
              {#if tile.landMask && tile.imgW > 0 && tile.imgH > 0}
                <g transform="translate({tile.imgX + tile.imgW}, {tile.imgY}) scale(-1, 1)">
                  <image
                    class="tile-land-glow"
                    class:active={isHovered}
                    href={tile.landMask}
                    x="0"
                    y="0"
                    width={tile.imgW}
                    height={tile.imgH}
                    preserveAspectRatio="none"
                  />
                </g>
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
                <g transform="translate({tile.cx}, {tile.cy})" pointer-events="none">
                  <text y="-4" class="art-map-banner" class:hovered={isHovered} text-anchor="middle" font-size="16">{meta.title}</text>
                  <text y="14" class="art-map-level" text-anchor="middle" fill="#f5d48b" font-family="Cinzel" font-size="12" font-weight="700">{meta.levelRange}</text>
                </g>
              {/if}
            </g>
          {/each}

          {#each projectedMarkers as m (m.id)}
            {#if m.kind === "event" && m.rPx > 4}
              <circle cx={m.sx} cy={m.sy} r={m.rPx} class="event-radius" class:active={m.eventPhase === "active"} />
            {/if}
            {#if m.kind === "village" && m.rPx > 4}
              <circle cx={m.sx} cy={m.sy} r={m.rPx} class="village-radius" />
            {/if}
          {/each}

          <!-- Live nearby hostile mobs (red), under the interactive markers. -->
          {#each mobMarkers as mob, i (i)}
            <circle cx={mob.sx} cy={mob.sy} r="3.5" class="mob-dot" />
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
              {:else if m.kind === "mobSpawn"}
                <circle r="5" class="mk mob-spawn" />
                <text y="3" font-size="8" text-anchor="middle" fill="#ffffff" font-weight="bold" pointer-events="none">☠</text>
                {#if mode === "region"}
                  <text y="-12" class="mk-label mob-spawn">{m.label} {m.sub ? `(${m.sub})` : ''}</text>
                {/if}
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

      {#if hoveredRegion && mode === "world"}
        {@const meta = getRegionZoneMeta(hoveredRegion)}
        <div
          class="art-map-tooltip"
          style="position: absolute; left: {tooltipX}px; top: {tooltipY}px; pointer-events: none;"
        >
          <div style="font-family: var(--rc-display); font-size: 15px; font-weight: 700; color: #f7e7c4; letter-spacing: 1.5px; text-transform: uppercase;">
            {meta.title}
          </div>
          <div style="font-size: 12px; color: #e8c878; font-weight: 700; margin-top: 2px;">
            {meta.levelRange}
          </div>
          <div style="font-size: 11px; color: #b8aec8; margin-top: 6px; line-height: 1.4; max-width: 220px;">
            {meta.description}
          </div>
          <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 1px; color: var(--rc-gold-dim); margin-top: 8px; border-top: 1px solid rgba(196,163,90,0.25); padding-top: 4px;">
            Realm: {biomeLabel(hoveredRegion.biome)}
          </div>
        </div>
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

  .tile-thumb {
    image-rendering: high-quality;
    image-rendering: -webkit-optimize-contrast;
    transition: opacity 0.2s ease;
  }
  .tile-thumb.dim {
    opacity: 0.25;
  }

  .tile-group {
    cursor: pointer;
  }

  .tile {
    stroke: none !important;
    stroke-width: 0 !important;
    fill-opacity: 0.72;
    transition: fill-opacity 0.15s ease;
  }
  .tile.current,
  .tile.focused {
    stroke: none !important;
    stroke-width: 0 !important;
    fill-opacity: 0.9;
  }
  .tile.dim {
    fill-opacity: 0.18;
  }
  .tile.has-thumb {
    fill: rgba(0, 0, 0, 0.001);
    pointer-events: all;
  }
  .tile-thumb {
    pointer-events: auto;
    opacity: 0.94;
    filter: brightness(1) contrast(1);
    transition: filter 0.22s ease-out, opacity 0.22s ease-out;
  }
  .tile-group:hover .tile-thumb,
  .tile-thumb.hovered {
    opacity: 1;
    filter: brightness(1.08) contrast(1.03);
  }
  .tile-land-glow {
    pointer-events: none;
    opacity: 0;
    mix-blend-mode: screen;
    filter: drop-shadow(0 0 8px rgba(255, 230, 160, 0.45));
    transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .tile-group:hover .tile-land-glow,
  .tile-land-glow.active {
    opacity: 0.55;
  }
  .tile-thumb.dim {
    opacity: 0.28;
  }
  .art-map-banner {
    transition: fill 0.2s ease, filter 0.2s ease;
  }
  .tile-group:hover .art-map-banner,
  .art-map-banner.hovered {
    fill: #ffffff !important;
    filter: drop-shadow(0 0 10px rgba(255, 230, 140, 0.9));
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

  .mob-dot {
    fill: #e0402e;
    stroke: rgba(0, 0, 0, 0.7);
    stroke-width: 0.8;
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
  .mk.mob-spawn { fill: #e53935; stroke: #1a0505; stroke-width: 1.5; }
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
  .mk-label.mob-spawn { fill: #ff8a80; }
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