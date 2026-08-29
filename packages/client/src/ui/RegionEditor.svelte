<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "./appState.svelte";
  import {
    REGION_BIOMES,
    REGION_BIOME_LABELS,
    REGION_BIOME_DETAILS,
    generateMmoRegionName,
    getBiomeLevelResourceTypes,
    generateMultiRegionContinent,
    planMultiRegionContinent,
    REGION_COLOR_PRESETS,
    REGION_MUSIC_TRACKS,
    REGION_FOG_DENSITY_MIN,
    SKY_PRESET_IDS,
    SKY_PRESET_LABELS,
    generateRandomRegionBlueprint,
    regionsAdjacentTo,
    MOBS,
    PLACEABLE_REGION_NODE_TYPES,
    REGION_TREE_BRUSH,
    nodeTypeDef,
    DEFAULT_QUICK_GRASS_SETTINGS,
    QUICK_GRASS_PRESETS,
    type RegionBiome,
    type RegionBiomeDetail,
    type RegionBlueprint,
    type RegionColorGrading,
    type SkyPresetId,
    type RegionQuest,
    type RegionQuestObjectiveKind,
    type RegionNPC,
    type QuickGrassSettings,
    type RegionMapPoi,
    type ContinentLayoutPattern,
    type ContinentSizeVariation,
    type ContinentBiomeDistribution,
    type ContinentLevelProgression,
    type ContinentScalePreset,
    type RegionNeighborEdges,
    type LandscapeVariant,
    stitchRegionSeams,
    regenRegionCoastlines,
    regenContinentCoastlines,
    detectRegionNeighborEdges,
    regionHalfSpanX,
    regionHalfSpanZ,
    VENDORS,
  } from "@rustcraft/shared";
  import {
    RegionEditorScene,
    type EditorSelection,
    type EditorTransformMode,
    type EditorMarkerKind,
    type EditorContextMenuState,
    type SculptMode,
    type WaterBrushMode,
  } from "../render/RegionEditorScene";
  import {
    REGION_PROP_PALETTE,
    REGION_PALETTE_PACKS,
    POI_LANDMARK_PRESETS,
    regionAssetDisplayName,
    regionGroupPack,
  } from "../render/regionPropPalette";
  import { HOUSE_TYPE_OPTIONS, type HouseType } from "../render/houseGen";
  import {
    CASTLE_SIZE_OPTIONS,
    CASTLE_HEIGHT_OPTIONS,
    CASTLE_STYLE_OPTIONS,
    type CastleSize,
    type CastleHeight,
    type CastleStyle,
  } from "../render/castleGen";
  import { FANTASTIC_BUILDING_TYPE_OPTIONS, type FantasticBuildingType } from "../render/fantasticBuildingGen";
  import {
    TERRAIN_VOLUME_SHAPES,
    TERRAIN_VOLUME_MATERIALS,
    CLAY_SCULPT_SHAPES,
  } from "../render/terrainVolumes";
  import type { TerrainVolumeShape, TerrainVolumeMaterial } from "@rustcraft/shared";
  import ContinentLayoutMap from "./ContinentLayoutMap.svelte";
  import type { LayoutTile } from "./continentLayout";
  import AssetExplorer from "./AssetExplorer.svelte";

  let canvas: HTMLCanvasElement;
  let fileInput: HTMLInputElement;
  let scene = $state<RegionEditorScene | null>(null);

  let regionList = $state<
    {
      id: string;
      name: string;
      biome: RegionBiome;
      gridSize: number;
      gridSizeX?: number;
      gridSizeZ?: number;
      pitch: number;
      worldOriginX: number;
      worldOriginZ: number;
      minLevel?: number;
      maxLevel?: number;
      pois?: RegionMapPoi[];
    }[]
  >([]);
  let regionId = $state<string>("");
  let regionName = $state("New Region");
  let biome = $state<RegionBiome>("grassland");
  let minLevel = $state(1);
  let maxLevel = $state(5);
  let regionSizeX = $state(32);
  let regionSizeZ = $state(32);
  let regionPitch = $state(6);
  let portalWorldX = $state(0);
  let portalWorldZ = $state(0);
  let worldOriginX = $state(0);
  let worldOriginZ = $state(0);
  let isStartingRegion = $state(false);
  let musicTrack = $state<string | null>(null);
  let showContinentMap = $state(false);
  let layoutTiles = $state<LayoutTile[]>([]);
  let layoutSaving = $state(false);
  /** Live progress for the Stitch Borders / Regen Coastlines batch tools --
   *  each is a fetch phase (0-50%) then a save phase (50-100%), tracked by a
   *  counter incremented as each per-region request resolves (not a fake
   *  timer) so the bar/percentage reflect real work happening. null hides
   *  the overlay. */
  let opProgress = $state<{ label: string; current: number; total: number; pct: number } | null>(null);
  /** Load edge-adjacent regions into the 3D view (read-only) for seam moulding. */
  let showNeighborRegions = $state(false);
  let neighborLoading = $state(false);
  let neighborCount = $state(0);

  let selection = $state<EditorSelection[]>([]);
  let marqueeBox = $state<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  let transformMode = $state<EditorTransformMode>("translate");
  let transformSnap = $state(true);
  let sculptMode = $state<SculptMode>(null);
  let volumeStampShape = $state<TerrainVolumeShape | null>(null);
  let volumeSculptBrushActive = $state(false);
  let volumeClaySculptActive = $state(false);
  let volumeSculptOp = $state<"add" | "sub">("add");
  let volumeMaterial = $state<TerrainVolumeMaterial>("rock");
  let waterBrushMode = $state<WaterBrushMode>(null);
  let waterPhysicsSimulating = $state(true);
  let brushRadius = $state(8);
  let brushStrength = $state(1);
  let armedModel = $state<string | null>(null);
  let armedMarker = $state<EditorMarkerKind | null>(null);
  let mobSpawnDifficulty = $state(1);
  let mobSpawnType = $state("");
  let resourceNodeType = $state<string>("rock");
  let contextMenu = $state<EditorContextMenuState | null>(null);
  let paletteSearch = $state("");
  let palettePack = $state<string>("all");
  let showAssetExplorer = $state(false);
  let roadPaintActive = $state(false);
  let roadWidth = $state(4);
  let heightScale = $state(1);
  let treeDensity = $state(1);
  let worldSize = $state(282);
  let playtestActive = $state(false);
  /** Default editor nav — Minecraft creative fly. Orbit is opt-in via World menu. */
  let flyNav = $state(true);
  let openGroups = $state<Set<string>>(new Set([REGION_PROP_PALETTE[0]?.label ?? ""]));
  let colorGrading = $state<RegionColorGrading>({ ...REGION_COLOR_PRESETS.grassland });
  let grassColor = $state<{ bottom: string; top: string }>({ bottom: "#4f7c13", top: "#79a01c" });
  let grassLength = $state(1);
  let grassSway = $state(1);
  let grassSettings = $state<QuickGrassSettings>({ ...DEFAULT_QUICK_GRASS_SETTINGS });
  let showGrassPanel = $state(false);
  let wind = $state<{ direction: number; strength: number }>({ direction: 0, strength: 1 });
  let showColorPanel = $state(false);
  let status = $state<string | null>(null);
  let deleteConfirmOpen = $state(false);
  let deleteInProgress = $state(false);

  // --- Procedural World Generator Modal State ---
  let showGenerateModal = $state(false);
  let genModalMode = $state<"single" | "continent">("single");

  // Single Region Generator State
  let genBiome = $state<RegionBiome>("forest");
  let genLandscapeVariant = $state<LandscapeVariant>("natural");
  let genName = $state("Whispering Glade");
  let genMinLevel = $state(1);
  let genMaxLevel = $state(5);
  let genHeightScale = $state(1.0);
  let genTreeDensity = $state(1.0);
  let genMobDensity = $state(1.0);
  let genResourceDensity = $state(1.0);
  let genResourceVariety = $state<Record<string, boolean>>({
    tree: true,
    rock: true,
    berry_bush: true,
    copper_vein: true,
    tin_vein: true,
    iron_deposit: false,
    mithril_deposit: false,
    thorium_vein: false,
  });
  let genWorldSize = $state(282);
  let genGridSizeX = $state(48);
  let genGridSizeZ = $state(48);
  let genPitch = $state(6);
  let genSeed = $state("");

  // Multi-Region Continent Generator State
  let continentCount = $state(4);
  let continentLayout = $state<ContinentLayoutPattern>("continent");
  let continentScale = $state<ContinentScalePreset>("massive");
  let continentSizeVariation = $state<ContinentSizeVariation>("varied");
  let continentLandscapeVariant = $state<LandscapeVariant | "auto">("auto");
  let continentBiomeDist = $state<ContinentBiomeDistribution>("thematic_continent");
  let continentLevelProg = $state<ContinentLevelProgression>("tiered");
  let continentPrimaryBiome = $state<RegionBiome>("forest");
  let continentHeightScale = $state(1.0);
  let continentTreeDensity = $state(1.0);
  let continentMobDensity = $state(1.0);
  let continentResourceDensity = $state(1.0);
  let continentPitch = $state(6);
  let continentSeed = $state("");
  let isGeneratingContinent = $state(false);
  let continentProgress = $state<{
    active: boolean;
    current: number;
    total: number;
    percent: number;
    currentName: string;
    currentBiome: RegionBiome;
    currentLevelRange: string;
    stage: string;
    detail: string;
  }>({
    active: false,
    current: 0,
    total: 0,
    percent: 0,
    currentName: "",
    currentBiome: "forest",
    currentLevelRange: "1–5",
    stage: "Initializing",
    detail: "",
  });

  type MenuId = "file" | "edit" | "region" | "tools" | "world";
  let activeDropdown = $state<MenuId | null>(null);
  let toolSearchQuery = $state("");
  let toolCategoryFilter = $state<string>("all");
  let floatingToolbarCollapsed = $state(false);

  function toggleDropdown(name: MenuId): void {
    activeDropdown = activeDropdown === name ? null : name;
  }

  function closeMenus(): void {
    activeDropdown = null;
  }

  function menuAction(fn: () => void): void {
    fn();
    closeMenus();
  }

  function buildLayoutTiles(): LayoutTile[] {
    const span = scene?.getLayoutSpan();
    const byId = new Map<string, LayoutTile>();
    for (const r of regionList) {
      byId.set(r.id, {
        id: r.id,
        name: r.name,
        biome: r.biome,
        gridSize: r.gridSize,
        gridSizeX: r.gridSizeX ?? r.gridSize,
        gridSizeZ: r.gridSizeZ ?? r.gridSize,
        pitch: r.pitch,
        worldOriginX: r.worldOriginX,
        worldOriginZ: r.worldOriginZ,
        minLevel: r.minLevel,
        maxLevel: r.maxLevel,
        pois: r.pois,
      });
    }
    // Overlay the currently open region (may be unsaved / locally moved) --
    // pois come straight from the live scene (exportBlueprint), not the
    // catalog fetch, so unsaved POI placements/shapes show up immediately.
    if (regionId || regionName) {
      const id = regionId || "__draft__";
      const livePois = scene?.exportBlueprint().pois;
      byId.set(id, {
        id,
        name: regionName || "Draft",
        biome,
        gridSize: span?.gridSize ?? byId.get(id)?.gridSize ?? 80,
        gridSizeX: span?.gridSizeX ?? byId.get(id)?.gridSizeX ?? 80,
        gridSizeZ: span?.gridSizeZ ?? byId.get(id)?.gridSizeZ ?? 80,
        pitch: span?.pitch ?? byId.get(id)?.pitch ?? 2.5,
        worldOriginX,
        worldOriginZ,
        minLevel,
        maxLevel,
        pois: livePois?.map((p) => ({
          id: p.id,
          name: p.name,
          localX: p.localX,
          localZ: p.localZ,
          revealShape: p.revealShape ?? [],
        })),
      });
    }
    return [...byId.values()];
  }

  let continentMapFocusPoiId = $state<string | null>(null);

  async function openContinentMap(focusPoiId?: string): Promise<void> {
    activeDropdown = null;
    await refreshRegionList();
    layoutTiles = buildLayoutTiles();
    continentMapFocusPoiId = focusPoiId ?? null;
    showContinentMap = true;
  }

  async function syncNeighborRegions(): Promise<void> {
    if (!scene) return;
    if (!showNeighborRegions) {
      scene.clearNeighborReferences();
      neighborCount = 0;
      return;
    }
    neighborLoading = true;
    try {
      await refreshRegionList();
      const span = scene.getLayoutSpan();
      const edit = {
        id: regionId || "__draft__",
        gridSize: span.gridSize,
        gridSizeX: span.gridSizeX,
        gridSizeZ: span.gridSizeZ,
        pitch: span.pitch,
        worldOriginX,
        worldOriginZ,
      };
      const adjacent = regionsAdjacentTo(edit, regionList);
      const bps: RegionBlueprint[] = [];
      await Promise.all(
        adjacent.map(async (r) => {
          try {
            const res = await fetch(app.apiUrl(`/api/regions/${encodeURIComponent(r.id)}`), {
              credentials: "include",
            });
            if (!res.ok) return;
            const data = (await res.json()) as { blueprint: RegionBlueprint };
            if (data.blueprint?.heights?.length) bps.push(data.blueprint);
          } catch {
            /* skip failed neighbor */
          }
        }),
      );
      scene.setNeighborReferences(bps);
      neighborCount = scene.neighborReferenceCount;
      status =
        neighborCount > 0
          ? `Showing ${neighborCount} neighbor region${neighborCount === 1 ? "" : "s"} (read-only).`
          : "No edge-adjacent regions found. Snap tiles on the Continent Layout Map first.";
    } finally {
      neighborLoading = false;
    }
  }

  function onLayoutTilesChange(next: LayoutTile[]): void {
    layoutTiles = next;
    const cur = next.find((t) => t.id === (regionId || "__draft__"));
    if (cur) {
      worldOriginX = cur.worldOriginX;
      worldOriginZ = cur.worldOriginZ;
      scene?.setMeta({ worldOriginX, worldOriginZ });
    }
  }

  async function saveContinentLayout(): Promise<void> {
    const dirty = layoutTiles.filter((t) => t.dirty && t.id !== "__draft__");
    // Always push current open region into its next full save meta.
    scene?.setMeta({ worldOriginX, worldOriginZ });
    if (dirty.length === 0) {
      // Only the draft/current tile moved — persist via normal region save.
      if (regionId) await saveToServer();
      layoutTiles = layoutTiles.map((t) => ({ ...t, dirty: false }));
      status = "Layout origin updated on current region.";
      return;
    }
    layoutSaving = true;
    status = "Saving continent layout…";
    try {
      const res = await fetch(app.apiUrl("/api/debug/region-origins"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          origins: dirty.map((t) => ({
            id: t.id,
            worldOriginX: t.worldOriginX,
            worldOriginZ: t.worldOriginZ,
          })),
        }),
      });
      if (!res.ok) {
        status = "Layout save failed.";
        return;
      }
      // If the open region was in the dirty set, keep meta in sync; also
      // write it through the normal save path so autosave doesn't overwrite.
      if (regionId && dirty.some((t) => t.id === regionId)) {
        scene?.setMeta({ worldOriginX, worldOriginZ });
        await saveToServer();
      }
      layoutTiles = layoutTiles.map((t) => ({ ...t, dirty: false }));
      await refreshRegionList();
      status = `Saved layout for ${dirty.length} region${dirty.length === 1 ? "" : "s"}.`;
      if (showNeighborRegions) await syncNeighborRegions();
    } catch {
      status = "Layout save failed.";
    } finally {
      layoutSaving = false;
    }
  }

  /** A hung/never-responding request must not be able to wedge the whole
   *  batch forever -- Promise.all(...) never settles until EVERY promise
   *  does, so one stuck fetch (slow server-side write, dropped connection)
   *  used to leave the progress bar parked at whatever % had been reached
   *  and the operation never finishing. Aborts + rejects after `timeoutMs`
   *  so the per-region try/catch/finally below always runs and the batch
   *  always completes. */
  async function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs = 20000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...opts, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Fetches every layout tile's full blueprint (current position embedded),
   *  reporting progress as each request resolves. Every tile is always
   *  fetched -- even when only a subset is selected for the write-back --
   *  because stitchRegionSeams/regenContinentCoastlines need the FULL set to
   *  sample real neighbor heights and detect true edge adjacency; only the
   *  save step below is scoped to the selection. */
  async function fetchLayoutBlueprints(label: string): Promise<RegionBlueprint[]> {
    const bps: RegionBlueprint[] = [];
    const relevant = layoutTiles.filter((t) => t.id !== "__draft__");
    if (relevant.length === 0) return bps;
    let done = 0;
    const failed: string[] = [];
    opProgress = { label, current: 0, total: relevant.length, pct: 0 };
    await Promise.all(
      relevant.map(async (t) => {
        try {
          if (t.id === regionId && scene) {
            const currentBp = scene.exportBlueprint();
            currentBp.worldOriginX = t.worldOriginX;
            currentBp.worldOriginZ = t.worldOriginZ;
            bps.push(currentBp);
          } else {
            const res = await fetchWithTimeout(app.apiUrl(`/api/regions/${encodeURIComponent(t.id)}`), { credentials: "include" });
            if (res.ok) {
              const data = (await res.json()) as { blueprint: RegionBlueprint };
              if (data.blueprint) {
                data.blueprint.worldOriginX = t.worldOriginX;
                data.blueprint.worldOriginZ = t.worldOriginZ;
                bps.push(data.blueprint);
              }
            } else {
              failed.push(t.name);
            }
          }
        } catch (err) {
          console.warn("Failed to fetch region blueprint:", t.id, err);
          failed.push(t.name);
        } finally {
          done++;
          opProgress = { label, current: done, total: relevant.length, pct: Math.round((done / relevant.length) * 50) };
        }
      }),
    );
    if (failed.length > 0) {
      console.warn("Timed out or failed to fetch:", failed.join(", "));
    }
    return bps;
  }

  /** Saves only the blueprints in `writeIds` (the tools compute a result for
   *  every fetched region, but the user only wants the selected subset
   *  actually written), reporting progress as each save resolves. Returns
   *  the failed/timed-out region names too -- callers fold that into their
   *  own final status message instead of it being silently overwritten by
   *  a blanket "success" line. */
  async function saveSelectedBlueprints(
    label: string,
    results: RegionBlueprint[],
    writeIds: Set<string> | null,
  ): Promise<{ savedCount: number; failed: string[] }> {
    const toSave = writeIds ? results.filter((bp) => writeIds.has(bp.id)) : results;
    if (toSave.length === 0) return { savedCount: 0, failed: [] };
    let savedCount = 0;
    let done = 0;
    const failed: string[] = [];
    opProgress = { label, current: 0, total: toSave.length, pct: 50 };
    await Promise.all(
      toSave.map(async (bp) => {
        try {
          const res = await fetchWithTimeout(app.apiUrl("/api/debug/region-blueprint"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ blueprint: bp }),
          });
          if (res.ok) savedCount++;
          else failed.push(bp.name);
        } catch (err) {
          console.error("Failed to save blueprint:", bp.name, err);
          failed.push(bp.name);
        } finally {
          done++;
          opProgress = { label, current: done, total: toSave.length, pct: 50 + Math.round((done / toSave.length) * 50) };
        }
      }),
    );
    if (failed.length > 0) {
      console.warn("Timed out or failed to save:", failed.join(", "));
    }
    return { savedCount, failed };
  }

  /** `selectedIds` empty/omitted = operate on the whole continent (previous
   *  behavior); non-empty = only write back the chosen regions (still uses
   *  every region's terrain as blend context -- see fetchLayoutBlueprints). */
  async function stitchContinentBorderSeams(selectedIds: string[] = []): Promise<void> {
    if (!layoutTiles || layoutTiles.length <= 1) {
      status = "Need at least 2 regions on the continent to stitch border terrain.";
      return;
    }
    layoutSaving = true;
    try {
      const bps = await fetchLayoutBlueprints("Fetching region terrain…");
      if (bps.length <= 1) {
        status = "Could not load enough region blueprints to stitch.";
        return;
      }

      opProgress = { label: `Stitching border seams across ${bps.length} regions…`, current: 0, total: 1, pct: 50 };
      const stitched = stitchRegionSeams(bps, { blendMargin: 60.0, minLandFloor: 1.5, forceDrySeams: true });

      const writeIds = selectedIds.length > 0 ? new Set(selectedIds) : null;
      const { savedCount, failed } = await saveSelectedBlueprints("Saving stitched terrain…", stitched, writeIds);

      const curStitched = stitched.find((bp) => bp.id === regionId);
      if (curStitched && (!writeIds || writeIds.has(regionId)) && scene) {
        await scene.loadBlueprint(curStitched);
      }

      const savedIds = writeIds ?? new Set(stitched.map((bp) => bp.id));
      layoutTiles = layoutTiles.map((t) => (savedIds.has(t.id) ? { ...t, dirty: false } : t));
      await refreshRegionList();
      if (showNeighborRegions) await syncNeighborRegions();

      status =
        failed.length > 0
          ? `🪄 Stitched ${savedCount} region${savedCount === 1 ? "" : "s"} -- timed out/failed: ${failed.join(", ")}.`
          : `🪄 Stitched and harmonized border terrain across ${savedCount} connected region${savedCount === 1 ? "" : "s"}.`;
    } catch (err) {
      console.error("Failed to stitch continent border seams:", err);
      status = `Failed to stitch border seams: ${String(err)}`;
    } finally {
      layoutSaving = false;
      opProgress = null;
    }
  }

  async function regenActiveRegionCoastlines(): Promise<void> {
    if (!scene) return;
    const span = scene.getLayoutSpan();
    const edit = {
      id: regionId || "__draft__",
      gridSize: span.gridSize,
      gridSizeX: span.gridSizeX,
      gridSizeZ: span.gridSizeZ,
      pitch: span.pitch,
      worldOriginX,
      worldOriginZ,
    };
    const neighborEdges = detectRegionNeighborEdges(edit, regionList, 36.0);
    const allRegions = regionList.map((r) => {
      const gX = r.gridSizeX ?? r.gridSize;
      const gZ = r.gridSizeZ ?? r.gridSize;
      const hX = ((gX - 1) * r.pitch) / 2;
      const hZ = ((gZ - 1) * r.pitch) / 2;
      const oX = r.worldOriginX ?? 0;
      const oZ = r.worldOriginZ ?? 0;
      return {
        minX: oX - hX,
        maxX: oX + hX,
        minZ: oZ - hZ,
        maxZ: oZ + hZ,
      };
    });
    scene.regenCoastlines(neighborEdges, allRegions);
    const unneighbored = [
      !neighborEdges.west && "West",
      !neighborEdges.east && "East",
      !neighborEdges.south && "South",
      !neighborEdges.north && "North",
    ].filter(Boolean);
    status = unneighbored.length > 0
      ? `🌊 Regenerated ocean coastlines on perimeter edges: ${unneighbored.join(", ")}.`
      : `All 4 edges are connected to neighbors; internal land borders preserved.`;
  }

  async function regenContinentOceanCoastlines(selectedIds: string[] = []): Promise<void> {
    if (!layoutTiles || layoutTiles.length === 0) return;
    layoutSaving = true;
    try {
      const bps = await fetchLayoutBlueprints("Fetching region terrain…");
      if (bps.length === 0) {
        status = "Could not load region blueprints.";
        return;
      }

      opProgress = { label: `Sculpting natural coastlines & open seas across ${bps.length} regions…`, current: 0, total: 1, pct: 50 };
      const coastBps = regenContinentCoastlines(bps);

      const writeIds = selectedIds.length > 0 ? new Set(selectedIds) : null;
      const { savedCount, failed } = await saveSelectedBlueprints("Saving coastline terrain…", coastBps, writeIds);

      const curCoast = coastBps.find((bp) => bp.id === regionId);
      if (curCoast && (!writeIds || writeIds.has(regionId)) && scene) {
        await scene.loadBlueprint(curCoast);
      }

      const savedIds = writeIds ?? new Set(coastBps.map((bp) => bp.id));
      layoutTiles = layoutTiles.map((t) => (savedIds.has(t.id) ? { ...t, dirty: false } : t));
      await refreshRegionList();
      if (showNeighborRegions) await syncNeighborRegions();

      status =
        failed.length > 0
          ? `🌊 Regenerated ${savedCount} region${savedCount === 1 ? "" : "s"} -- timed out/failed: ${failed.join(", ")}.`
          : `🌊 Regenerated natural ocean coastlines and beaches across ${savedCount} region${savedCount === 1 ? "" : "s"}.`;
    } catch (err) {
      console.error("Failed to regenerate continent ocean coastlines:", err);
      status = `Failed to generate coastlines: ${String(err)}`;
    } finally {
      layoutSaving = false;
      opProgress = null;
    }
  }

  async function handleDeleteRegionFromContinent(id: string, name: string): Promise<void> {
    if (!id || id === "__draft__") return;
    status = `Deleting "${name}" from continent…`;
    try {
      const res = await fetch(app.apiUrl("/api/debug/region-blueprint-delete"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        status = `Failed to delete "${name}".`;
        return;
      }

      // Remove from layoutTiles
      layoutTiles = layoutTiles.filter((t) => t.id !== id);
      // Remove from regionList
      regionList = regionList.filter((r) => r.id !== id);

      if (localStorage.getItem("rustcraft_last_region_id") === id) {
        localStorage.removeItem("rustcraft_last_region_id");
      }

      // If the currently active 3D region was deleted, switch to another
      if (regionId === id) {
        const next = regionList[0];
        if (next) {
          await loadRegion(next.id);
          status = `Deleted "${name}". Switched active region to "${next.name}".`;
        } else {
          newRegion();
          status = `Deleted "${name}".`;
        }
      } else {
        status = `Deleted "${name}" from continent.`;
      }

      await refreshRegionList();
      if (showNeighborRegions) {
        await syncNeighborRegions();
      }
    } catch (err) {
      console.error("Failed to delete region from continent:", err);
      status = "Failed to delete region.";
    }
  }

  let saveTimeout: number | null = null;
  function scheduleSave(): void {
    if (saveTimeout !== null) window.clearTimeout(saveTimeout);
    saveTimeout = window.setTimeout(() => {
      void saveToServer();
    }, 1000);
  }

  onMount(() => {
    scene = new RegionEditorScene(
      canvas,
      (sel) => {
        selection = sel;
      },
      () => scheduleSave(),
      (active) => {
        playtestActive = active;
      },
      (box) => {
        marqueeBox = box;
      },
      (enabled) => {
        transformSnap = enabled;
      },
      (active) => {
        flyNav = active;
      },
      (message) => {
        status = message;
      },
    );
    scene.setContextMenuHandler((menu) => {
      contextMenu = menu;
    });
    const urlParams = new URLSearchParams(window.location.search);
    const initialId = urlParams.get("region") || localStorage.getItem("rustcraft_last_region_id");
    void refreshRegionList().then(() => {
      if (initialId && regionList.some((r) => r.id === initialId)) {
        void loadRegion(initialId);
      } else if (regionList.length > 0) {
        void loadRegion(regionList[0]!.id);
      } else {
        void generateDraft();
      }
    });
    const onResize = () => scene?.resize();
    const onKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || "").toUpperCase();
      const isEditingText = ["INPUT", "TEXTAREA", "SELECT"].includes(activeTag);

      if (e.key === "Escape") {
        if (showGenerateModal) {
          showGenerateModal = false;
          return;
        }
        if (deleteConfirmOpen) {
          if (!deleteInProgress) deleteConfirmOpen = false;
          return;
        }
        if (showAssetExplorer) {
          showAssetExplorer = false;
          return;
        }
        if (contextMenu) {
          contextMenu = null;
          scene?.dismissContextMenu();
          return;
        }
        if (activeDropdown) {
          closeMenus();
          return;
        }
        cancelArmed();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveToServer();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (e.shiftKey) scene?.redo();
        else scene?.undo();
      }

      // Fast Tool Hotkeys when not typing in text fields
      if (!isEditingText && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "g") {
          if (e.shiftKey) pickGrassEraseBrush();
          else pickGrassBrush();
        } else if (k === "t") {
          pickRandomTreeBrush();
        } else if (k === "c") {
          pickVolumeClaySculpt();
        } else if (k === "r") {
          pickRoadTool();
        } else if (k === "p") {
          pickTexture(1);
        } else if (k === "l") {
          scene?.toggleGizmoSpace();
        } else if (k === "v") {
          cancelArmed();
        }
      }
    };
    const onPointerDownCapture = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest?.(".menubar-shell")) closeMenus();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDownCapture, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDownCapture, true);
      scene?.dispose();
    };
  });

  function toggleGroup(label: string): void {
    const next = new Set(openGroups);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    openGroups = next;
  }

  const filteredPalette = $derived.by(() => {
    const q = paletteSearch.trim().toLowerCase();
    return REGION_PROP_PALETTE.map((g) => {
      if (palettePack !== "all" && regionGroupPack(g) !== palettePack) {
        return { ...g, models: [] as string[] };
      }
      if (!q) return g;
      return {
        ...g,
        models: g.models.filter((m) => {
          const name = regionAssetDisplayName(m).toLowerCase();
          const pack = regionGroupPack(g).toLowerCase();
          return (
            name.includes(q) ||
            m.toLowerCase().includes(q) ||
            g.label.toLowerCase().includes(q) ||
            pack.includes(q)
          );
        }),
      };
    }).filter((g) => g.models.length > 0);
  });

  function shortPaletteGroupLabel(label: string): string {
    return label.replace(/^(FV|CP|KH|MV|SN) · /, "");
  }

  function pickModel(model: string, category: "building" | "foliage" | "prop"): void {
    cancelArmed();
    armedModel = model;
    scene?.armPlacement(model, category);
  }

  function pickModelFromExplorer(model: string, category: "building" | "foliage" | "prop"): void {
    pickModel(model, category);
    showAssetExplorer = false;
  }

  function pickMarker(kind: EditorMarkerKind): void {
    cancelArmed();
    armedMarker = kind;
    scene?.armMarkerPlacement(kind);
    if (kind === "mobSpawn") {
      scene?.setMobSpawnDefaults(mobSpawnDifficulty, mobSpawnType || null);
    }
    if (kind === "resourceNode") {
      scene?.setResourceNodeDefaults(resourceNodeType);
    }
  }

  function applyMobSpawnDefaults(): void {
    scene?.setMobSpawnDefaults(mobSpawnDifficulty, mobSpawnType || null);
  }

  function applyResourceNodeDefaults(): void {
    scene?.setResourceNodeDefaults(resourceNodeType);
  }

  function pickSculpt(mode: SculptMode): void {
    const next = sculptMode === mode ? null : mode;
    cancelArmed();
    sculptMode = next;
    scene?.setSculptMode(next);
  }

  /** Freeform volume place -- stamps one 3D primitive at a time (click/light drag). */
  function pickVolumeStamp(shape: TerrainVolumeShape): void {
    const next = volumeStampShape === shape ? null : shape;
    cancelArmed();
    volumeStampShape = next;
    if (next) scene?.armVolumeStamp(next, volumeMaterial, "place");
    else scene?.disarm();
  }

  /** Continuous drag brush -- sprays overlapping volume stamps along the stroke. */
  function pickVolumeSculptBrush(): void {
    const next = !volumeSculptBrushActive;
    const nextShape = next ? (volumeStampShape ?? "boulder") : null;
    cancelArmed();
    volumeSculptBrushActive = next;
    volumeStampShape = nextShape;
    if (next) scene?.armVolumeStamp(nextShape ?? "boulder", volumeMaterial, "sculpt");
    else scene?.disarm();
  }

  /** Blender-style 3D clay: Add piles boulder/block on the surface; Sub carves holes. */
  function pickVolumeClaySculpt(): void {
    const next = !volumeClaySculptActive;
    const shape =
      volumeStampShape === "block" || volumeStampShape === "boulder" ? volumeStampShape : "boulder";
    const nextShape = next ? shape : null;
    cancelArmed();
    volumeClaySculptActive = next;
    volumeStampShape = nextShape;
    volumeSculptOp = "add";
    if (next) {
      scene?.armVolumeStamp(shape, volumeMaterial, "clay");
      scene?.setVolumeSculptOp("add");
    } else {
      scene?.disarm();
    }
  }

  function setVolumeSculptOp(op: "add" | "sub"): void {
    volumeSculptOp = op;
    scene?.setVolumeSculptOp(op);
  }

  function pickVolumeMaterial(mat: TerrainVolumeMaterial): void {
    volumeMaterial = mat;
    scene?.setVolumeMaterial(mat);
  }

  function pickVolumeShapeForBrush(shape: TerrainVolumeShape): void {
    volumeStampShape = shape;
    scene?.setVolumeShape(shape);
  }

  function pickWaterBrush(mode: WaterBrushMode): void {
    const next = waterBrushMode === mode ? null : mode;
    cancelArmed();
    waterBrushMode = next;
    scene?.setWaterBrushMode(next);
  }

  function toggleWaterPhysics(): void {
    waterPhysicsSimulating = !waterPhysicsSimulating;
    scene?.setWaterPhysicsSimulating(waterPhysicsSimulating);
  }

  function clearWater(): void {
    scene?.clearWater();
  }

  function pickRoadTool(): void {
    const next = !roadPaintActive;
    cancelArmed();
    roadPaintActive = next;
    if (next) scene?.armRoadPainting();
    else scene?.disarm();
  }

  function updateRoadWidth(v: number): void {
    roadWidth = v;
    scene?.setRoadWidth(v);
  }

  let randomTreeBrushActive = $state(false);
  let grassBrushActive = $state(false);
  let grassEraseBrushActive = $state(false);
  let eraseBrushActive = $state(false);
  let houseToolActive = $state(false);
  let houseType = $state<HouseType>("random");
  let castleToolActive = $state(false);
  let castleStyle = $state<CastleStyle>("random");
  let castleSize = $state<CastleSize>(2);
  let castleHeight = $state<CastleHeight>(2);
  let fantasticBuildingToolActive = $state(false);
  let fantasticBuildingType = $state<FantasticBuildingType>("random");

  function pickRandomTreeBrush(): void {
    const next = !randomTreeBrushActive;
    cancelArmed();
    randomTreeBrushActive = next;
    scene?.setRandomTreeBrush(next);
  }

  /** One-click house generator (see houseGen.ts / RegionEditorScene's
   *  armHousePlacement): drops a fully assembled house of the chosen type
   *  (or random) wherever you next click, as ordinary editable assets that
   *  share a groupId so clicking any piece selects/moves the whole house.
   *  Stays armed so you can drop several in a row -- click the same type
   *  again, pick another tool, or hit Escape to stop. */
  function pickHouseTool(type: HouseType = houseType): void {
    // Re-clicking the same type disarms; picking a different type switches.
    const disarming = houseToolActive && houseType === type;
    cancelArmed();
    if (disarming) return;
    houseType = type;
    houseToolActive = true;
    scene?.armHousePlacement(type);
  }

  function pickCastleTool(): void {
    const disarming = castleToolActive;
    cancelArmed();
    if (disarming) return;
    castleToolActive = true;
    scene?.armCastlePlacement({
      style: castleStyle,
      size: castleSize,
      height: castleHeight,
    });
  }

  /** One-click fantasy-village building generator (see fantasticBuildingGen.ts
   *  / RegionEditorScene's armFantasticBuildingPlacement): drops a whole
   *  building (base + capped body shell + door/windows/chimney/etc, sail or
   *  waterwheel for mill types) wherever you next click, as ordinary editable
   *  assets sharing a groupId. Stays armed for dropping several in a row. */
  function pickFantasticBuildingTool(): void {
    const disarming = fantasticBuildingToolActive;
    cancelArmed();
    if (disarming) return;
    fantasticBuildingToolActive = true;
    scene?.armFantasticBuildingPlacement(fantasticBuildingType);
  }

  function syncFantasticBuildingToolOptions(): void {
    if (!fantasticBuildingToolActive) return;
    scene?.armFantasticBuildingPlacement(fantasticBuildingType);
  }

  function syncCastleToolOptions(): void {
    if (!castleToolActive) return;
    scene?.armCastlePlacement({
      style: castleStyle,
      size: castleSize,
      height: castleHeight,
    });
  }

  function pickGrassBrush(): void {
    const next = !grassBrushActive;
    cancelArmed();
    grassBrushActive = next;
    scene?.setGrassBrush(next);
  }

  function pickGrassEraseBrush(): void {
    const next = !grassEraseBrushActive;
    cancelArmed();
    grassEraseBrushActive = next;
    scene?.setGrassEraseBrush(next);
  }

  function pickEraseBrush(): void {
    const next = !eraseBrushActive;
    cancelArmed();
    eraseBrushActive = next;
    scene?.setEraseBrush(next);
  }

  let texturePaintMode = $state<number | null>(null);
  let armedLightColor = $state<string | null>(null);
  let armedFogColor = $state<string | null>(null);
  let armedFogShape = $state<"sphere" | "box">("sphere");
  let armedBarrier = $state(false);
  let armedCloudShape = $state<"cumulus" | "wispy" | "flat" | null>(null);

  function pickTexture(mode: number | null): void {
    const next = texturePaintMode === mode ? null : mode;
    cancelArmed();
    texturePaintMode = next;
    scene?.setTexturePaintMode(next);
  }

  function pickLightColor(color: string): void {
    const next = armedLightColor === color ? null : color;
    cancelArmed();
    armedLightColor = next;
    if (next) scene?.armLightPlacement(next);
    else scene?.disarm();
  }

  function realignBounds(): void {
    scene?.realignSelectedBounds();
  }

  function toggleGizmo(): void {
    scene?.toggleGizmoSpace();
  }

  function pickFogTool(color: string, shape: "sphere" | "box" = "sphere"): void {
    const same = armedFogColor === color && armedFogShape === shape;
    const next = same ? null : color;
    cancelArmed();
    armedFogColor = next;
    armedFogShape = shape;
    if (next) scene?.armFogPlacement(next, shape);
    else scene?.disarm();
  }

  function pickBarrierTool(): void {
    const next = !armedBarrier;
    cancelArmed();
    armedBarrier = next;
    if (next) scene?.armBarrierPlacement();
    else scene?.disarm();
  }

  function pickCloudTool(shape: "cumulus" | "wispy" | "flat"): void {
    const next = armedCloudShape === shape ? null : shape;
    cancelArmed();
    armedCloudShape = next;
    if (next) scene?.armCloudPlacement(next);
    else scene?.disarm();
  }

  function cancelArmed(): void {
    armedModel = null;
    armedMarker = null;
    sculptMode = null;
    volumeStampShape = null;
    volumeSculptBrushActive = false;
    volumeClaySculptActive = false;
    waterBrushMode = null;
    roadPaintActive = false;
    randomTreeBrushActive = false;
    grassBrushActive = false;
    grassEraseBrushActive = false;
    eraseBrushActive = false;
    texturePaintMode = null;
    armedLightColor = null;
    armedFogColor = null;
    armedBarrier = false;
    armedCloudShape = null;
    houseToolActive = false;
    castleToolActive = false;
    fantasticBuildingToolActive = false;
    scene?.setRandomTreeBrush(false);
    scene?.setGrassBrush(false);
    scene?.setGrassEraseBrush(false);
    scene?.setEraseBrush(false);
    scene?.setTexturePaintMode(null);
    scene?.disarm();
  }

  function setMode(mode: EditorTransformMode): void {
    transformMode = mode;
    scene?.setTransformMode(mode);
    cancelArmed();
  }

  function toggleSnap(): void {
    transformSnap = !transformSnap;
    scene?.setTransformSnap(transformSnap);
  }

  function dropToGround(): void {
    scene?.dropSelectionToGround();
  }

  function togglePlaytest(): void {
    if (!scene) return;
    cancelArmed();
    playtestActive = scene.togglePlaytest();
  }

  function setNavMode(mode: "fly" | "orbit"): void {
    if (!scene) return;
    scene.setNavigationMode(mode);
    flyNav = mode === "fly";
  }

  function updateBrushRadius(v: number): void {
    brushRadius = v;
    scene?.setBrushRadius(v);
  }

  function updateBrushStrength(v: number): void {
    brushStrength = v;
    scene?.setBrushStrength(v);
  }

  function applyPatch(patch: Partial<EditorSelection>): void {
    scene?.updateSelectedProps(patch);
  }

  function addQuestToNPC(sel: EditorSelection): void {
    const npc: RegionNPC = sel.npcData ?? {
      id: sel.id,
      name: sel.name ?? "Quest Giver",
      model: "Knight",
      localX: sel.x,
      localZ: sel.z,
      yaw: sel.yaw,
      title: "<Questgiver>",
      dialogue: "Greetings, traveler! I need your assistance.",
      quests: [],
      generateProceduralQuests: true,
    };
    const quests = [...(npc.quests ?? [])];
    const newQuest: RegionQuest = {
      id: `quest_${Date.now()}_${quests.length + 1}`,
      name: "New Quest",
      description: "Assist the townsfolk with a task.",
      tier: 1,
      minLevel: 1,
      objectiveKind: "kill",
      objectiveTarget: "wolf",
      objectiveCount: 5,
      rewardXp: 50,
      rewardItems: [{ itemId: "wood", qty: 10 }],
    };
    quests.push(newQuest);
    applyPatch({ npcData: { ...npc, quests } });
  }

  function deleteQuestFromNPC(sel: EditorSelection, questId: string): void {
    if (!sel.npcData?.quests) return;
    if (scene?.activeEscortQuest?.questId === questId) {
      scene?.setEscortPathTracing(null, null);
    }
    const quests = sel.npcData.quests.filter((q) => q.id !== questId);
    applyPatch({ npcData: { ...sel.npcData, quests } });
  }

  function updateQuestInNPC(sel: EditorSelection, questIdx: number, patch: Partial<RegionQuest>): void {
    if (!sel.npcData?.quests) return;
    const quests = [...sel.npcData.quests];
    if (!quests[questIdx]) return;
    quests[questIdx] = { ...quests[questIdx]!, ...patch };
    applyPatch({ npcData: { ...sel.npcData, quests } });
  }

  function toggleEscortPathTracing(sel: EditorSelection, questId: string): void {
    if (scene?.activeEscortQuest?.questId === questId) {
      scene?.setEscortPathTracing(null, null);
    } else {
      scene?.setEscortPathTracing(sel.id, questId);
    }
  }

  function deleteSelected(): void {
    scene?.deleteSelected();
  }

  function applyColorGrading(): void {
    scene?.applyColorGrading(colorGrading);
  }

  function applyGrassColor(): void {
    scene?.applyGrassColor(grassColor);
    grassSettings = { ...grassSettings, baseColour: grassColor.bottom, tipColour: grassColor.top };
  }

  function applyGrassLength(): void {
    scene?.setGrassLength(grassLength);
  }

  function applyGrassSway(): void {
    scene?.setGrassSway(grassSway);
    grassSettings = { ...grassSettings, windStrength: grassSway };
  }

  function applyGrassSettingsPatch(partial: Partial<QuickGrassSettings>): void {
    grassSettings = { ...grassSettings, ...partial };
    if (partial.baseColour) grassColor = { ...grassColor, bottom: partial.baseColour };
    if (partial.tipColour) grassColor = { ...grassColor, top: partial.tipColour };
    if (partial.windStrength !== undefined) grassSway = partial.windStrength;
    scene?.applyGrassSettings(partial);
    scheduleSave();
  }

  function applyGrassPreset(name: string): void {
    const preset = name === "__reset__" ? DEFAULT_QUICK_GRASS_SETTINGS : QUICK_GRASS_PRESETS[name];
    if (!preset) return;
    const next = name === "__reset__" ? { ...DEFAULT_QUICK_GRASS_SETTINGS } : { ...grassSettings, ...preset };
    grassSettings = next;
    grassColor = { bottom: next.baseColour, top: next.tipColour };
    grassSway = next.windStrength;
    scene?.applyGrassSettings(next);
    scheduleSave();
  }

  function applyWind(): void {
    scene?.applyWind(wind);
  }

  function applyBiomePreset(): void {
    colorGrading = { ...REGION_COLOR_PRESETS[biome] };
    applyColorGrading();
  }

  async function refreshRegionList(): Promise<void> {
    try {
      const res = await fetch(app.apiUrl("/api/regions"), { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        regions: {
          id: string;
          name: string;
          biome: RegionBiome;
          gridSize: number;
          gridSizeX?: number;
          gridSizeZ?: number;
          pitch: number;
          worldOriginX: number;
          worldOriginZ: number;
          minLevel?: number;
          maxLevel?: number;
          pois?: RegionMapPoi[];
        }[];
      };
      regionList = data.regions.map((r) => ({
        id: r.id,
        name: r.name,
        biome: r.biome,
        gridSize: r.gridSize ?? 80,
        gridSizeX: r.gridSizeX ?? r.gridSize ?? 80,
        gridSizeZ: r.gridSizeZ ?? r.gridSize ?? 80,
        pitch: r.pitch ?? 2.5,
        worldOriginX: r.worldOriginX ?? 0,
        worldOriginZ: r.worldOriginZ ?? 0,
        minLevel: r.minLevel,
        maxLevel: r.maxLevel,
        pois: r.pois,
      }));
    } catch {
      // Region list is a convenience for the editor's dropdown
    }
  }

  async function loadRegion(id: string): Promise<void> {
    if (!scene) return;
    status = "Loading...";
    try {
      const res = await fetch(app.apiUrl(`/api/regions/${id}`), { credentials: "include" });
      if (!res.ok) {
        status = "Region not found.";
        return;
      }
      const data = (await res.json()) as { blueprint: RegionBlueprint };
      await scene.loadBlueprint(data.blueprint);
      scene.initHistory();
      regionId = data.blueprint.id;
      regionName = data.blueprint.name;
      biome = data.blueprint.biome;
      minLevel = data.blueprint.minLevel ?? 1;
      maxLevel = data.blueprint.maxLevel ?? (data.blueprint.minLevel ? data.blueprint.minLevel + 4 : 5);
      regionSizeX = data.blueprint.gridSizeX ?? data.blueprint.gridSize ?? 32;
      regionSizeZ = data.blueprint.gridSizeZ ?? data.blueprint.gridSize ?? 32;
      regionPitch = data.blueprint.pitch ?? 6;
      worldSize = Math.round(Math.max((regionSizeX - 1) * regionPitch, (regionSizeZ - 1) * regionPitch));
      portalWorldX = data.blueprint.portalWorldX;
      portalWorldZ = data.blueprint.portalWorldZ;
      worldOriginX = data.blueprint.worldOriginX ?? 0;
      worldOriginZ = data.blueprint.worldOriginZ ?? 0;
      isStartingRegion = data.blueprint.isStartingRegion ?? false;
      musicTrack = data.blueprint.musicTrack ?? null;
      colorGrading = scene.getColorGrading();
      grassColor = scene.getGrassColor();
      wind = scene.getWind();
      grassSway = scene.getGrassSway();
      grassSettings = scene.getGrassSettings();
      status = `Loaded "${data.blueprint.name}".`;
      localStorage.setItem("rustcraft_last_region_id", data.blueprint.id);
      const url = new URL(window.location.href);
      url.searchParams.set("region", data.blueprint.id);
      window.history.replaceState({}, "", url.toString());
      if (showNeighborRegions) await syncNeighborRegions();
    } catch {
      status = "Failed to load region.";
    }
  }

  function openGenerateModal(asNewRegion = false): void {
    closeMenus();
    genBiome = biome;
    genMinLevel = minLevel;
    genMaxLevel = maxLevel;
    genHeightScale = heightScale;
    genTreeDensity = treeDensity;
    genMobDensity = 1.0;
    genResourceDensity = 1.0;
    genPitch = regionPitch;
    genGridSizeX = regionSizeX;
    genGridSizeZ = regionSizeZ;
    genWorldSize = worldSize;
    genSeed = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

    // Set resource variety according to level
    const activeTypes = new Set(getBiomeLevelResourceTypes(genBiome, genMinLevel));
    for (const t of PLACEABLE_REGION_NODE_TYPES) {
      genResourceVariety[t] = activeTypes.has(t);
    }

    if (asNewRegion || regionName === "New Region" || !regionName) {
      genName = generateMmoRegionName(genBiome, genMinLevel);
    } else {
      genName = regionName;
    }
    showGenerateModal = true;
  }

  function selectModalBiome(b: RegionBiome): void {
    genBiome = b;
    const detail = REGION_BIOME_DETAILS[b];
    if (detail) {
      genMinLevel = detail.recommendedLevels[0];
      genMaxLevel = detail.recommendedLevels[1];
    }
    const activeTypes = new Set(getBiomeLevelResourceTypes(genBiome, genMinLevel));
    for (const t of PLACEABLE_REGION_NODE_TYPES) {
      genResourceVariety[t] = activeTypes.has(t);
    }
    genName = generateMmoRegionName(genBiome, genMinLevel);
  }

  function rerollModalName(): void {
    genName = generateMmoRegionName(genBiome, genMinLevel);
  }

  function rerollModalSeed(): void {
    genSeed = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  function setModalLevelPreset(min: number, max: number): void {
    genMinLevel = min;
    genMaxLevel = max;
    const activeTypes = new Set(getBiomeLevelResourceTypes(genBiome, genMinLevel));
    for (const t of PLACEABLE_REGION_NODE_TYPES) {
      genResourceVariety[t] = activeTypes.has(t);
    }
    genName = generateMmoRegionName(genBiome, genMinLevel);
  }

  function setModalSizePreset(x: number, z: number, pitch = 6): void {
    genGridSizeX = x;
    genGridSizeZ = z;
    genPitch = pitch;
    genWorldSize = Math.round(Math.max((x - 1) * pitch, (z - 1) * pitch));
  }

  async function executeWorldGeneration(): Promise<void> {
    if (!scene) return;
    showGenerateModal = false;
    status = `Generating ${genBiome} world: "${genName}"...`;

    biome = genBiome;
    regionName = genName;
    minLevel = genMinLevel;
    maxLevel = genMaxLevel;
    heightScale = genHeightScale;
    treeDensity = genTreeDensity;
    regionPitch = genPitch;
    regionSizeX = genGridSizeX;
    regionSizeZ = genGridSizeZ;
    worldSize = genWorldSize;

    const halfX = ((genGridSizeX - 1) * genPitch) / 2;
    const halfZ = ((genGridSizeZ - 1) * genPitch) / 2;
    const minX = worldOriginX - halfX;
    const maxX = worldOriginX + halfX;
    const minZ = worldOriginZ - halfZ;
    const maxZ = worldOriginZ + halfZ;
    const eps = 4.0;
    const neighborEdges: RegionNeighborEdges = { west: false, east: false, north: false, south: false };

    for (const other of regionList) {
      if (other.id === regionId) continue;
      const oHalfX = regionHalfSpanX(other);
      const oHalfZ = regionHalfSpanZ(other);
      const oMinX = (other.worldOriginX ?? 0) - oHalfX;
      const oMaxX = (other.worldOriginX ?? 0) + oHalfX;
      const oMinZ = (other.worldOriginZ ?? 0) - oHalfZ;
      const oMaxZ = (other.worldOriginZ ?? 0) + oHalfZ;

      const overlapZ = minZ <= oMaxZ + eps && maxZ >= oMinZ - eps;
      const overlapX = minX <= oMaxX + eps && maxX >= oMinX - eps;

      if (overlapZ) {
        if (Math.abs(minX - oMaxX) <= eps) neighborEdges.west = true;
        if (Math.abs(maxX - oMinX) <= eps) neighborEdges.east = true;
      }
      if (overlapX) {
        if (Math.abs(minZ - oMaxZ) <= eps) neighborEdges.south = true;
        if (Math.abs(maxZ - oMinZ) <= eps) neighborEdges.north = true;
      }
    }

    const selectedVariety = Object.entries(genResourceVariety)
      .filter(([_, enabled]) => enabled)
      .map(([k]) => k);

    const bp = generateRandomRegionBlueprint(genSeed || Date.now().toString(), genBiome, genName, {
      heightScale: genHeightScale,
      treeDensity: genTreeDensity,
      mobDensity: genMobDensity,
      resourceDensity: genResourceDensity,
      resourceVariety: selectedVariety.length > 0 ? selectedVariety : undefined,
      worldSize: genWorldSize,
      gridSizeX: genGridSizeX,
      gridSizeZ: genGridSizeZ,
      pitch: genPitch,
      minLevel: genMinLevel,
      maxLevel: genMaxLevel,
      worldOriginX,
      worldOriginZ,
      neighborEdges,
      landscapeVariant: genLandscapeVariant,
    });

    bp.id = regionId;
    bp.portalWorldX = portalWorldX;
    bp.portalWorldZ = portalWorldZ;
    bp.worldOriginX = worldOriginX;
    bp.worldOriginZ = worldOriginZ;
    bp.musicTrack = musicTrack;

    await scene.loadBlueprint(bp);
    scene.initHistory();
    colorGrading = scene.getColorGrading();
    grassColor = scene.getGrassColor();
    wind = scene.getWind();
    grassSway = scene.getGrassSway();
    grassSettings = scene.getGrassSettings();
    status = `Generated "${genName}" (${REGION_BIOME_LABELS[genBiome]}) -- Level ${genMinLevel}–${genMaxLevel}.`;
    if (showNeighborRegions) await syncNeighborRegions();
  }

  function rerollContinentSeed(): void {
    continentSeed = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  }

  async function executeContinentGeneration(): Promise<void> {
    if (!scene || isGeneratingContinent) return;
    isGeneratingContinent = true;

    const seed = continentSeed || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    status = `Planning continent (${continentCount} regions)...`;

    continentProgress = {
      active: true,
      current: 0,
      total: continentCount,
      percent: 2,
      currentName: "Continent Blueprint Matrix",
      currentBiome: continentPrimaryBiome,
      currentLevelRange: "1–60",
      stage: "Planning Continent Layout & Borders...",
      detail: `Computing contiguous grid coordinates and shared border seams for ${continentCount} zones...`,
    };

    // Yield to let UI render the loading overlay
    await new Promise((r) => setTimeout(r, 40));

    try {
      const { planned, continentSeed: cSeed, pitch: cPitch, opts: cOpts, continentContext: cCtx } = planMultiRegionContinent({
        seed,
        regionCount: continentCount,
        layout: continentLayout,
        sizeVariation: continentSizeVariation,
        continentScale,
        biomeDistribution: continentBiomeDist,
        primaryBiome: continentPrimaryBiome,
        levelProgression: continentLevelProg,
        heightScale: continentHeightScale,
        treeDensity: continentTreeDensity,
        mobDensity: continentMobDensity,
        resourceDensity: continentResourceDensity,
        pitch: continentPitch,
        landscapeDistribution: continentLandscapeVariant,
      });

      const createdBlueprints: RegionBlueprint[] = [];

      for (let i = 0; i < planned.length; i++) {
        const p = planned[i]!;
        const basePct = Math.round((i / planned.length) * 90);

        continentProgress = {
          active: true,
          current: i + 1,
          total: planned.length,
          percent: Math.max(5, basePct + 2),
          currentName: p.name,
          currentBiome: p.biome,
          currentLevelRange: `Lv. ${p.minLevel}–${p.maxLevel}`,
          stage: `Sculpting ${REGION_BIOME_LABELS[p.biome]} (${i + 1}/${planned.length})`,
          detail: `Generating continuous world noise (${p.gridSizeX}×${p.gridSizeZ}) • Origin (${p.worldOriginX}, ${p.worldOriginZ})...`,
        };

        // Yield to animation frame so Svelte updates the DOM and progress bar
        await new Promise((r) => requestAnimationFrame(r));
        await new Promise((r) => setTimeout(r, 16));

        const bp = generateRandomRegionBlueprint(p.seed, p.biome, p.name, {
          heightScale: cOpts.heightScale,
          treeDensity: cOpts.treeDensity,
          mobDensity: cOpts.mobDensity,
          resourceDensity: cOpts.resourceDensity,
          gridSizeX: p.gridSizeX,
          gridSizeZ: p.gridSizeZ,
          pitch: cPitch,
          minLevel: p.minLevel,
          maxLevel: p.maxLevel,
          worldOriginX: p.worldOriginX,
          worldOriginZ: p.worldOriginZ,
          worldSeed: cSeed,
          neighborEdges: p.neighborEdges,
          landscapeVariant: p.landscapeVariant,
          continentContext: cCtx,
        });

        bp.id = `region_${Date.now()}_${i}`;
        bp.isStartingRegion = p.isStartingRegion;
        createdBlueprints.push(bp);

        continentProgress = {
          ...continentProgress,
          percent: Math.min(92, basePct + Math.round((0.8 / planned.length) * 90)),
          stage: `Saving ${p.name} to Database (${i + 1}/${planned.length})`,
          detail: `Persisting region blueprint, mob spawns, and resource nodes to server...`,
        };

        await new Promise((r) => requestAnimationFrame(r));

        const res = await fetch(app.apiUrl("/api/debug/region-blueprint"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ blueprint: bp }),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.error(`[ContinentGen] Failed to save region ${p.name}:`, res.status, text);
          throw new Error(`Failed to save region ${p.name} (${res.status}): ${text}`);
        }

        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; id?: string };
        if (data.id) {
          bp.id = data.id;
        }
      }

      continentProgress = {
        active: true,
        current: planned.length,
        total: planned.length,
        percent: 96,
        currentName: createdBlueprints[0]?.name ?? "Starting Capital",
        currentBiome: createdBlueprints[0]?.biome ?? "forest",
        currentLevelRange: "All Zones",
        stage: "Mounting Continent into 3D Viewport...",
        detail: `Loaded ${createdBlueprints.length} seamless connected regions. Synchronizing 3D neighbor meshes...`,
      };

      await new Promise((r) => setTimeout(r, 40));

      // Pick starting region (isStartingRegion = true or index 0)
      const primary = createdBlueprints.find((b) => b.isStartingRegion) ?? createdBlueprints[0]!;
      regionId = primary.id;
      regionName = primary.name;
      biome = primary.biome;
      minLevel = primary.minLevel ?? 1;
      maxLevel = primary.maxLevel ?? 5;
      heightScale = continentHeightScale;
      treeDensity = continentTreeDensity;
      regionPitch = primary.pitch ?? continentPitch;
      regionSizeX = primary.gridSizeX ?? primary.gridSize ?? 64;
      regionSizeZ = primary.gridSizeZ ?? primary.gridSize ?? 64;
      worldSize = Math.round(Math.max((regionSizeX - 1) * regionPitch, (regionSizeZ - 1) * regionPitch));
      worldOriginX = primary.worldOriginX ?? 0;
      worldOriginZ = primary.worldOriginZ ?? 0;

      localStorage.setItem("rustcraft_last_region_id", primary.id);
      const url = new URL(window.location.href);
      url.searchParams.set("region", primary.id);
      window.history.replaceState({}, "", url.toString());

      await scene.loadBlueprint(primary);
      scene.initHistory();
      colorGrading = scene.getColorGrading();
      grassColor = scene.getGrassColor();
      wind = scene.getWind();
      grassSway = scene.getGrassSway();
      grassSettings = scene.getGrassSettings();

      showNeighborRegions = true;
      await refreshRegionList();
      await syncNeighborRegions();

      continentProgress = {
        active: true,
        current: planned.length,
        total: planned.length,
        percent: 100,
        currentName: primary.name,
        currentBiome: primary.biome,
        currentLevelRange: `Lv. ${primary.minLevel}–${primary.maxLevel}`,
        stage: "Continent Ready!",
        detail: `Successfully generated and loaded ${createdBlueprints.length} connected regions.`,
      };

      await new Promise((r) => setTimeout(r, 400));

      status = `Continent generated! Created ${createdBlueprints.length} seamless connected regions.`;
      showGenerateModal = false;
    } catch (err) {
      console.error("Continent generation failed:", err);
      status = `Failed to generate/save continent: ${String(err)}`;
    } finally {
      isGeneratingContinent = false;
      continentProgress.active = false;
    }
  }

  async function generateDraft(): Promise<void> {
    openGenerateModal(false);
  }

  function newRegion(): void {
    regionId = "";
    minLevel = 1;
    maxLevel = 5;
    portalWorldX = 0;
    portalWorldZ = 0;
    // Place new regions to the right of the current furthest tile.
    let maxX = 0;
    for (const r of regionList) {
      const half = ((r.gridSize - 1) * r.pitch) / 2;
      maxX = Math.max(maxX, r.worldOriginX + half);
    }
    const span = scene?.getLayoutSpan();
    const half = span ? ((span.gridSize - 1) * span.pitch) / 2 : 100;
    worldOriginX = maxX + half;
    worldOriginZ = 0;
    musicTrack = null;
    openGenerateModal(true);
  }

  function pickMusicTrack(trackId: string | null): void {
    musicTrack = trackId;
    scene?.setMeta({ musicTrack });
  }

  async function saveToServer(): Promise<void> {
    if (!scene) return;
    scene.setMeta({
      id: regionId,
      name: regionName,
      biome,
      portalWorldX,
      portalWorldZ,
      worldOriginX,
      worldOriginZ,
      isStartingRegion,
      minLevel,
      maxLevel,
      musicTrack,
    });
    status = "Saving...";
    const blueprint = scene.exportBlueprint();
    try {
      const res = await fetch(app.apiUrl("/api/debug/region-blueprint"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ blueprint }),
      });
      if (res.ok) {
        const data = (await res.json()) as { ok: boolean; id: string };
        regionId = data.id;
        localStorage.setItem("rustcraft_last_region_id", data.id);
        const url = new URL(window.location.href);
        url.searchParams.set("region", data.id);
        window.history.replaceState({}, "", url.toString());
        status = `Saved "${regionName}" (${blueprint.assets.length} assets).`;
        void refreshRegionList();
      } else {
        status = "Save failed.";
      }
    } catch {
      status = "Save failed.";
    }
  }

  async function duplicateRegion(): Promise<void> {
    if (!scene) return;
    const newId = `region_${Date.now()}`;
    const newName = `${regionName} (Copy)`;

    scene.setMeta({
      id: newId,
      name: newName,
      biome,
      portalWorldX,
      portalWorldZ,
      worldOriginX: worldOriginX + 60,
      worldOriginZ: worldOriginZ + 60,
      isStartingRegion: false,
      minLevel,
      maxLevel,
      musicTrack,
    });

    const blueprint = scene.exportBlueprint();
    blueprint.id = newId;
    blueprint.name = newName;
    blueprint.minLevel = minLevel;
    blueprint.maxLevel = maxLevel;

    status = `Duplicating as "${newName}"…`;
    try {
      const res = await fetch(app.apiUrl("/api/debug/region-blueprint"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ blueprint }),
      });
      if (res.ok) {
        regionId = newId;
        regionName = newName;
        isStartingRegion = false;
        worldOriginX += 60;
        worldOriginZ += 60;
        localStorage.setItem("rustcraft_last_region_id", newId);
        const url = new URL(window.location.href);
        url.searchParams.set("region", newId);
        window.history.replaceState({}, "", url.toString());
        status = `Duplicated as "${newName}".`;
        await refreshRegionList();
      } else {
        status = "Duplicate failed.";
      }
    } catch {
      status = "Duplicate failed.";
    }
  }

  function requestDeleteRegion(): void {
    if (!regionId) {
      status = "Save the region before deleting, or discard via New Region.";
      return;
    }
    if (regionList.length <= 1) {
      status = "Cannot delete the last remaining region.";
      return;
    }
    if (document.pointerLockElement) document.exitPointerLock();
    deleteConfirmOpen = true;
  }

  async function confirmDeleteRegion(): Promise<void> {
    if (!regionId || deleteInProgress) return;
    const deletingId = regionId;
    const deletingName = regionName;
    deleteInProgress = true;
    status = `Deleting "${deletingName}"…`;
    try {
      const res = await fetch(app.apiUrl("/api/debug/region-blueprint-delete"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ id: deletingId }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; statusMessage?: string; message?: string; cleanedPortalRefs?: string[] }
        | null;
      if (!res.ok) {
        status = data?.statusMessage ?? data?.message ?? `Delete failed (${res.status}).`;
        return;
      }
      deleteConfirmOpen = false;
      if (localStorage.getItem("rustcraft_last_region_id") === deletingId) {
        localStorage.removeItem("rustcraft_last_region_id");
      }
      await refreshRegionList();
      const next = regionList[0];
      if (next) {
        await loadRegion(next.id);
        status = `Deleted "${deletingName}". Opened "${next.name}".`;
      } else {
        newRegion();
        status = `Deleted "${deletingName}".`;
      }
    } catch {
      status = "Delete failed.";
    } finally {
      deleteInProgress = false;
    }
  }

  function exportJson(): void {
    if (!scene) return;
    scene.setMeta({
      id: regionId,
      name: regionName,
      biome,
      portalWorldX,
      portalWorldZ,
      worldOriginX,
      worldOriginZ,
      isStartingRegion,
      minLevel,
      maxLevel,
      musicTrack,
    });
    const blueprint = scene.exportBlueprint();
    const blob = new Blob([JSON.stringify(blueprint, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `region-${regionName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson(): void {
    fileInput?.click();
  }

  async function onFileSelected(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const blueprint = JSON.parse(text) as RegionBlueprint;
      await scene?.loadBlueprint(blueprint);
      regionId = blueprint.id;
      regionName = blueprint.name;
      biome = blueprint.biome;
      minLevel = blueprint.minLevel ?? 1;
      maxLevel = blueprint.maxLevel ?? (blueprint.minLevel ? blueprint.minLevel + 4 : 5);
      regionSizeX = blueprint.gridSizeX ?? blueprint.gridSize ?? 32;
      regionSizeZ = blueprint.gridSizeZ ?? blueprint.gridSize ?? 32;
      regionPitch = blueprint.pitch ?? 6;
      worldSize = Math.round(Math.max((regionSizeX - 1) * regionPitch, (regionSizeZ - 1) * regionPitch));
      portalWorldX = blueprint.portalWorldX;
      portalWorldZ = blueprint.portalWorldZ;
      worldOriginX = blueprint.worldOriginX ?? 0;
      worldOriginZ = blueprint.worldOriginZ ?? 0;
      musicTrack = blueprint.musicTrack ?? null;
      colorGrading = scene?.getColorGrading() ?? colorGrading;
      grassColor = scene?.getGrassColor() ?? grassColor;
      wind = scene?.getWind() ?? wind;
      grassSway = scene?.getGrassSway() ?? grassSway;
      grassSettings = scene?.getGrassSettings() ?? grassSettings;
      status = `Imported "${blueprint.name}".`;
    } catch {
      status = "Import failed -- invalid JSON.";
    }
    input.value = "";
  }

  function exitEditor(): void {
    location.search = "";
  }
</script>

<div class="editor">
  <div class="menubar-shell">
    <!-- App menu bar -->
    <div class="menubar">
      <span class="app-brand">Region Editor</span>

      <div class="menu-group">
        <button class="menu-top" class:open={activeDropdown === "file"} onclick={() => toggleDropdown("file")}>File</button>
        {#if activeDropdown === "file"}
          <div class="menu-panel">
            <button onclick={() => menuAction(newRegion)}>New Region</button>
            <button onclick={() => menuAction(() => { void duplicateRegion(); })}>Duplicate Region</button>
            <div class="menu-sep"></div>
            <button onclick={() => menuAction(() => { void saveToServer(); })}>Save<span class="accel">⌘S</span></button>
            <button
              class="danger"
              disabled={!regionId || regionList.length <= 1}
              onclick={() => menuAction(requestDeleteRegion)}
            >Delete Region…</button>
            <button onclick={() => menuAction(importJson)}>Import JSON…</button>
            <button onclick={() => menuAction(exportJson)}>Export JSON…</button>
            <div class="menu-sep"></div>
            <button onclick={() => menuAction(exitEditor)}>Exit Editor</button>
          </div>
        {/if}
      </div>

      <div class="menu-group">
        <button class="menu-top" class:open={activeDropdown === "edit"} onclick={() => toggleDropdown("edit")}>Edit</button>
        {#if activeDropdown === "edit"}
          <div class="menu-panel">
            <button onclick={() => menuAction(() => scene?.undo())}>Undo<span class="accel">⌘Z</span></button>
            <button onclick={() => menuAction(() => scene?.redo())}>Redo<span class="accel">⇧⌘Z</span></button>
            <div class="menu-sep"></div>
            <button class:active={transformSnap} onclick={() => menuAction(toggleSnap)}>
              Snap to Grid
            </button>
            <button disabled={selection.length === 0} onclick={() => menuAction(dropToGround)}>Drop to Ground<span class="accel">G</span></button>
            <button
              disabled={selection.filter((s) => s.kind === "asset").length < 2}
              onclick={() => menuAction(() => scene?.groupSelectedAssets())}
            >Group<span class="accel">⌘G</span></button>
            <button
              disabled={!selection.some((s) => s.kind === "asset" && s.groupId)}
              onclick={() => menuAction(() => scene?.ungroupSelectedAssets())}
            >Ungroup<span class="accel">⇧⌘G</span></button>
          </div>
        {/if}
      </div>

      <div class="menu-group">
        <button class="menu-top" class:open={activeDropdown === "region"} onclick={() => toggleDropdown("region")}>Region</button>
        {#if activeDropdown === "region"}
          <div class="menu-panel wide">
            <label class="menu-field">
              Open
              <select
                value={regionId}
                onchange={(e) => {
                  const id = (e.target as HTMLSelectElement).value;
                  closeMenus();
                  void loadRegion(id);
                }}
              >
                {#each regionList as r (r.id)}
                  <option value={r.id}>{r.name}</option>
                {/each}
                {#if !regionList.some((r) => r.id === regionId)}
                  <option value={regionId}>{regionName} (unsaved)</option>
                {/if}
              </select>
            </label>
            <label class="menu-field">
              Name
              <input type="text" bind:value={regionName} placeholder="Region name" />
            </label>
            <label class="menu-field">
              Biome
              <select bind:value={biome} onchange={applyBiomePreset}>
                {#each REGION_BIOMES as b (b)}
                  <option value={b}>{REGION_BIOME_LABELS[b]}</option>
                {/each}
              </select>
            </label>
            <label class="menu-field checkbox-field">
              <input
                type="checkbox"
                bind:checked={isStartingRegion}
                onchange={(e) => scene?.setMeta({ isStartingRegion: (e.target as HTMLInputElement).checked })}
              />
              <span>Starting Town</span>
            </label>
            <div class="menu-sep"></div>
            <div class="menu-section">Level Difficulty Range</div>
            <div class="menu-row">
              <label class="menu-field">
                Min Level
                <input
                  type="number"
                  min="1"
                  max="100"
                  bind:value={minLevel}
                  onchange={() => {
                    if (minLevel > maxLevel) maxLevel = minLevel;
                    scene?.setMeta({ minLevel, maxLevel });
                  }}
                />
              </label>
              <label class="menu-field">
                Max Level
                <input
                  type="number"
                  min="1"
                  max="100"
                  bind:value={maxLevel}
                  onchange={() => {
                    if (maxLevel < minLevel) minLevel = maxLevel;
                    scene?.setMeta({ minLevel, maxLevel });
                  }}
                />
              </label>
            </div>
            <div class="level-presets-row">
              <button
                type="button"
                class="level-preset-chip"
                class:active={minLevel === 1 && maxLevel === 3}
                onclick={() => { minLevel = 1; maxLevel = 3; scene?.setMeta({ minLevel, maxLevel }); }}
              >1 - 3</button>
              <button
                type="button"
                class="level-preset-chip"
                class:active={minLevel === 3 && maxLevel === 7}
                onclick={() => { minLevel = 3; maxLevel = 7; scene?.setMeta({ minLevel, maxLevel }); }}
              >3 - 7</button>
              <button
                type="button"
                class="level-preset-chip"
                class:active={minLevel === 7 && maxLevel === 12}
                onclick={() => { minLevel = 7; maxLevel = 12; scene?.setMeta({ minLevel, maxLevel }); }}
              >7 - 12</button>
              <button
                type="button"
                class="level-preset-chip"
                class:active={minLevel === 12 && maxLevel === 16}
                onclick={() => { minLevel = 12; maxLevel = 16; scene?.setMeta({ minLevel, maxLevel }); }}
              >12 - 16</button>
              <button
                type="button"
                class="level-preset-chip"
                class:active={minLevel === 16 && maxLevel === 20}
                onclick={() => { minLevel = 16; maxLevel = 20; scene?.setMeta({ minLevel, maxLevel }); }}
              >16 - 20</button>
            </div>
            <div class="menu-sep"></div>
            <div class="menu-section">Region Dimensions & Real-World Size</div>
            <div class="dim-card">
              <div class="dim-card-header">
                <span class="dim-card-title">Real World Size</span>
                <span class="dim-card-meters">{Math.round((regionSizeX - 1) * regionPitch)} m × {Math.round((regionSizeZ - 1) * regionPitch)} m</span>
              </div>
              <div class="dim-card-sub">
                Area: {(((regionSizeX - 1) * regionPitch * (regionSizeZ - 1) * regionPitch) / 1000000).toFixed(3)} km² ({Math.round((regionSizeX - 1) * regionPitch * (regionSizeZ - 1) * regionPitch).toLocaleString()} m²)
              </div>
            </div>
            <div class="menu-row">
              <label class="menu-field">
                Width (X Vertices)
                <input
                  type="number"
                  min="8"
                  max="256"
                  bind:value={regionSizeX}
                  onchange={() => {
                    scene?.resizeRegionGrid(regionSizeX, regionSizeZ);
                    worldSize = Math.round(Math.max((regionSizeX - 1) * regionPitch, (regionSizeZ - 1) * regionPitch));
                  }}
                />
              </label>
              <label class="menu-field">
                Height (Z Vertices)
                <input
                  type="number"
                  min="8"
                  max="256"
                  bind:value={regionSizeZ}
                  onchange={() => {
                    scene?.resizeRegionGrid(regionSizeX, regionSizeZ);
                    worldSize = Math.round(Math.max((regionSizeX - 1) * regionPitch, (regionSizeZ - 1) * regionPitch));
                  }}
                />
              </label>
              <label class="menu-field">
                Cell Pitch (m/cell)
                <input
                  type="number"
                  min="1"
                  max="32"
                  step="0.5"
                  bind:value={regionPitch}
                  onchange={() => {
                    if (scene) {
                      void scene.setPitch(regionPitch);
                    }
                    worldSize = Math.round(Math.max((regionSizeX - 1) * regionPitch, (regionSizeZ - 1) * regionPitch));
                  }}
                />
              </label>
            </div>
            <div class="menu-preset-row">
              <button
                onclick={() => {
                  regionSizeX = 16;
                  regionSizeZ = 16;
                  worldSize = Math.round(15 * regionPitch);
                  void scene?.resizeRegionGrid(16, 16);
                }}>16×16 ({Math.round(15 * regionPitch)}m)</button
              >
              <button
                onclick={() => {
                  regionSizeX = 32;
                  regionSizeZ = 32;
                  worldSize = Math.round(31 * regionPitch);
                  void scene?.resizeRegionGrid(32, 32);
                }}>32×32 ({Math.round(31 * regionPitch)}m)</button
              >
              <button
                onclick={() => {
                  regionSizeX = 64;
                  regionSizeZ = 64;
                  worldSize = Math.round(63 * regionPitch);
                  void scene?.resizeRegionGrid(64, 64);
                }}>64×64 ({Math.round(63 * regionPitch)}m)</button
              >
              <button
                onclick={() => {
                  regionSizeX = 80;
                  regionSizeZ = 80;
                  worldSize = Math.round(79 * regionPitch);
                  void scene?.resizeRegionGrid(80, 80);
                }}>80×80 ({Math.round(79 * regionPitch)}m)</button
              >
              <button
                onclick={() => {
                  regionSizeX = 128;
                  regionSizeZ = 128;
                  worldSize = Math.round(127 * regionPitch);
                  void scene?.resizeRegionGrid(128, 128);
                }}>128×128 ({Math.round(127 * regionPitch)}m)</button
              >
              <button
                onclick={() => {
                  regionSizeX = 64;
                  regionSizeZ = 32;
                  worldSize = Math.round(63 * regionPitch);
                  void scene?.resizeRegionGrid(64, 32);
                }}>64×32 (Wide)</button
              >
              <button
                onclick={() => {
                  regionSizeX = 32;
                  regionSizeZ = 64;
                  worldSize = Math.round(63 * regionPitch);
                  void scene?.resizeRegionGrid(32, 64);
                }}>32×64 (Tall)</button
              >
            </div>
            <div class="menu-sep"></div>
            <button
              onclick={() =>
                menuAction(() => {
                  if (!scene) return;
                  const cam = scene.setTitleCameraFromCurrent();
                  status = `Title screen camera saved to current view (${cam.x}, ${cam.y}, ${cam.z}).`;
                })}
            >
              📷 Set Title Screen Camera
            </button>
          </div>
        {/if}
      </div>

      <div class="menu-group">
        <button
          class="menu-top"
          class:open={activeDropdown === "tools"}
          class:lit={sculptMode !== null || volumeStampShape !== null || volumeSculptBrushActive || volumeClaySculptActive || waterBrushMode !== null || texturePaintMode !== null || armedLightColor !== null || armedFogColor !== null || armedBarrier || armedCloudShape !== null || roadPaintActive || armedMarker !== null || randomTreeBrushActive || grassBrushActive || grassEraseBrushActive || eraseBrushActive || houseToolActive || castleToolActive || fantasticBuildingToolActive}
          onclick={() => toggleDropdown("tools")}
        >Tools</button>
        {#if activeDropdown === "tools"}
          <div class="menu-panel tools-panel searchable-tools-panel">
            <div class="tools-search-bar">
              <input
                type="text"
                placeholder="Search 40+ tools (e.g. grass, water, clay, house)..."
                bind:value={toolSearchQuery}
                class="tools-search-input"
              />
              {#if toolSearchQuery}
                <button type="button" class="tools-search-clear" onclick={() => (toolSearchQuery = "")}>✕</button>
              {/if}
            </div>

            <div class="tools-category-tabs">
              <button type="button" class:active={toolCategoryFilter === "all"} onclick={() => (toolCategoryFilter = "all")}>All</button>
              <button type="button" class:active={toolCategoryFilter === "terrain"} onclick={() => (toolCategoryFilter = "terrain")}>Terrain</button>
              <button type="button" class:active={toolCategoryFilter === "foliage"} onclick={() => (toolCategoryFilter = "foliage")}>Grass & Trees</button>
              <button type="button" class:active={toolCategoryFilter === "water"} onclick={() => (toolCategoryFilter = "water")}>Water & Environment</button>
              <button type="button" class:active={toolCategoryFilter === "structures"} onclick={() => (toolCategoryFilter = "structures")}>Structures</button>
              <button type="button" class:active={toolCategoryFilter === "markers"} onclick={() => (toolCategoryFilter = "markers")}>Markers</button>
            </div>

            <div class="tools-filtered-body">
              {#if toolCategoryFilter === "all" || toolCategoryFilter === "terrain" || toolSearchQuery}
                {#if !toolSearchQuery || "terrain sculpt raise lower smooth mold clay 3d stamp".includes(toolSearchQuery.toLowerCase())}
                  <div class="menu-section">Terrain & Sculpting</div>
                  <button class:active={sculptMode === "raise"} onclick={() => menuAction(() => pickSculpt("raise"))}>Raise Terrain [S]</button>
                  <button class:active={sculptMode === "lower"} onclick={() => menuAction(() => pickSculpt("lower"))}>Lower Terrain</button>
                  <button class:active={sculptMode === "mold"} onclick={() => menuAction(() => pickSculpt("mold"))}>Mould / Flatten</button>
                  <button class:active={sculptMode === "smooth"} onclick={() => menuAction(() => pickSculpt("smooth"))}>Smooth Terrain</button>
                  <button class:active={sculptMode === "carve"} onclick={() => menuAction(() => pickSculpt("carve"))}>Carve Hole</button>
                  <button class:active={volumeSculptBrushActive} onclick={() => menuAction(pickVolumeSculptBrush)}>Volume Drag Brush</button>
                  <button class:active={volumeClaySculptActive} onclick={() => menuAction(pickVolumeClaySculpt)} title="Blender-style add/sub on the 3D surface">Clay Sculpt 3D [C]</button>
                  {#each TERRAIN_VOLUME_SHAPES as shape}
                    <button class:active={volumeStampShape === shape.id && !volumeSculptBrushActive && !volumeClaySculptActive} onclick={() => menuAction(() => pickVolumeStamp(shape.id))}>Stamp: {shape.label}</button>
                  {/each}

                  <div class="menu-section">Global Terrain & Layout Transforms</div>
                  <button onclick={() => menuAction(() => { void scene?.mirrorRegion("x"); })}>🪞 Mirror Region X (Horizontal)</button>
                  <button onclick={() => menuAction(() => { void scene?.mirrorRegion("z"); })}>🪞 Mirror Region Z (Vertical)</button>
                  <button onclick={() => menuAction(() => { void scene?.rotateRegion(90); })}>🔄 Rotate Region 90° Clockwise</button>
                  <button onclick={() => menuAction(() => { void scene?.rotateRegion(180); })}>🔄 Rotate Region 180°</button>
                  <button onclick={() => menuAction(() => { void scene?.rotateRegion(270); })}>🔄 Rotate Region 270° Clockwise</button>

                  <div class="menu-section">Global Terrain Elevation</div>
                  <button onclick={() => menuAction(() => void regenActiveRegionCoastlines())}>🌊 Regen Ocean Coastlines on Open Edges</button>
                  <button onclick={() => menuAction(() => scene?.autoCarveNaturalWater())}>🌊 Auto-Carve Natural Valleys & Add Water</button>
                  <button onclick={() => menuAction(() => scene?.raiseTerrainAboveSeaLevel(1.5))}>⬆ Raise All Submerged Land Above Sea Level (+1.5m)</button>
                  <button onclick={() => menuAction(() => scene?.shiftTerrainElevation(2.0))}>▲ Shift Entire Terrain Up (+2.0m)</button>
                  <button onclick={() => menuAction(() => scene?.shiftTerrainElevation(-2.0))}>▼ Shift Entire Terrain Down (-2.0m)</button>
                {/if}
              {/if}

              {#if toolCategoryFilter === "all" || toolCategoryFilter === "foliage" || toolSearchQuery}
                {#if !toolSearchQuery || "grass foliage tree vegetation erase brush quick".includes(toolSearchQuery.toLowerCase())}
                  <div class="menu-section">Foliage & Vegetation</div>
                  <button class:active={grassBrushActive} onclick={() => menuAction(pickGrassBrush)}>Grass Brush [G]</button>
                  <button class:active={grassEraseBrushActive} onclick={() => menuAction(pickGrassEraseBrush)}>Erase Grass [Shift+G]</button>
                  <button class:active={randomTreeBrushActive} onclick={() => menuAction(pickRandomTreeBrush)}>Tree Brush [T]</button>
                  <button class:active={showGrassPanel} onclick={() => menuAction(() => { showGrassPanel = true; })}>Grass Settings Panel…</button>
                {/if}
              {/if}

              {#if toolCategoryFilter === "all" || toolCategoryFilter === "water" || toolCategoryFilter === "terrain" || toolSearchQuery}
                {#if !toolSearchQuery || "paint texture road dirt cobble snow rock sand mud lava gravel auto".includes(toolSearchQuery.toLowerCase())}
                  <div class="menu-section">Ground Texture & Roads</div>
                  <button class:active={texturePaintMode === 0} onclick={() => menuAction(() => pickTexture(0))}>🌿 Auto / Biome Texture</button>
                  <button class:active={texturePaintMode === 1} onclick={() => menuAction(() => pickTexture(1))}>🌱 Grass Texture [P]</button>
                  <button class:active={texturePaintMode === 2} onclick={() => menuAction(() => pickTexture(2))}>🍂 Dirt / Earth Texture</button>
                  <button class:active={texturePaintMode === 3} onclick={() => menuAction(() => pickTexture(3))}>🧱 Cobble Road Texture</button>
                  <button class:active={texturePaintMode === 4} onclick={() => menuAction(() => pickTexture(4))}>❄️ Snow Texture</button>
                  <button class:active={texturePaintMode === 5} onclick={() => menuAction(() => pickTexture(5))}>🪨 Rock / Cliff Texture</button>
                  <button class:active={texturePaintMode === 6} onclick={() => menuAction(() => pickTexture(6))}>🏖️ Sand Texture</button>
                  <button class:active={texturePaintMode === 7} onclick={() => menuAction(() => pickTexture(7))}>🪵 Mud / Swamp Texture</button>
                  <button class:active={texturePaintMode === 8} onclick={() => menuAction(() => pickTexture(8))}>🌋 Lava / Scorched Ash Texture</button>
                  <button class:active={texturePaintMode === 9} onclick={() => menuAction(() => pickTexture(9))}>🪨 Gravel / Scree Texture</button>
                  <button class:active={roadPaintActive} onclick={() => menuAction(pickRoadTool)}>🛤️ Dirt Road Painter [R]</button>
                {/if}
              {/if}

              {#if toolCategoryFilter === "all" || toolCategoryFilter === "water" || toolSearchQuery}
                {#if !toolSearchQuery || "water light fog mist cloud physics atmosphere".includes(toolSearchQuery.toLowerCase())}
                  <div class="menu-section">Water & Environment</div>
                  <button onclick={() => menuAction(() => scene?.toggleWater())}>Water Visibility: {scene?.isWaterVisible() ? "ON (Visible)" : "OFF (Hidden)"}</button>
                  <button onclick={() => menuAction(() => scene?.fillSeaLevelWater())}>Fill Sea-Level Water (Matching Map)</button>
                  <button class:active={waterBrushMode === "add"} onclick={() => menuAction(() => pickWaterBrush("add"))}>Paint / Drop Water [W]</button>
                  <button class:active={waterBrushMode === "remove"} onclick={() => menuAction(() => pickWaterBrush("remove"))}>Drain / Erase Water</button>
                  <button class:active={waterPhysicsSimulating} onclick={() => toggleWaterPhysics()}>Water Physics: {waterPhysicsSimulating ? "On" : "Off"}</button>
                  <button onclick={() => menuAction(clearWater)}>Clear All Water</button>

                  <div class="menu-section">Lights & Fog</div>
                  <button class:active={armedLightColor === "#ff9933"} onclick={() => menuAction(() => pickLightColor("#ff9933"))}>Light: Torch Amber</button>
                  <button class:active={armedLightColor === "#ffffff"} onclick={() => menuAction(() => pickLightColor("#ffffff"))}>Light: Daylight</button>
                  <button class:active={armedLightColor === "#00d4ff"} onclick={() => menuAction(() => pickLightColor("#00d4ff"))}>Light: Mystic Cyan</button>
                  <button class:active={armedLightColor === "#a055ff"} onclick={() => menuAction(() => pickLightColor("#a055ff"))}>Light: Arcane Violet</button>
                  <button class:active={armedFogColor === "#c8dce8" && armedFogShape === "sphere"} onclick={() => menuAction(() => pickFogTool("#c8dce8", "sphere"))}>Mist Sphere</button>
                  <button class:active={armedFogColor === "#c8dce8" && armedFogShape === "box"} onclick={() => menuAction(() => pickFogTool("#c8dce8", "box"))}>Mist Box</button>
                  <button class:active={armedCloudShape === "cumulus"} onclick={() => menuAction(() => pickCloudTool("cumulus"))}>Cloud: Cumulus</button>
                  <button class:active={armedCloudShape === "wispy"} onclick={() => menuAction(() => pickCloudTool("wispy"))}>Cloud: Wispy</button>
                {/if}
              {/if}

              {#if toolCategoryFilter === "all" || toolCategoryFilter === "structures" || toolSearchQuery}
                {#if !toolSearchQuery || "house castle building structure barrier asset explorer".includes(toolSearchQuery.toLowerCase())}
                  <div class="menu-section">Structures & Buildings</div>
                  <button onclick={() => menuAction(() => { showAssetExplorer = true; })}>Asset Explorer…</button>
                  <button class:active={armedBarrier} onclick={() => menuAction(pickBarrierTool)}>Invisible Barrier</button>
                  {#each HOUSE_TYPE_OPTIONS as opt}
                    <button class:active={houseToolActive && houseType === opt.id} onclick={() => menuAction(() => pickHouseTool(opt.id))}>House: {opt.label}</button>
                  {/each}
                  <button class:active={castleToolActive} onclick={() => menuAction(pickCastleTool)}>
                    {castleToolActive ? "Castle Tool Armed" : "Generate Castle"}
                  </button>
                  <button class:active={fantasticBuildingToolActive} onclick={() => menuAction(pickFantasticBuildingTool)}>
                    {fantasticBuildingToolActive ? "Building Tool Armed" : "Generate Fantasy Building"}
                  </button>
                {/if}
              {/if}

              {#if toolCategoryFilter === "all" || toolCategoryFilter === "markers" || toolSearchQuery}
                {#if !toolSearchQuery || "marker spawn mob node village portal npc quest event poi landmark".includes(toolSearchQuery.toLowerCase())}
                  <div class="menu-section">World Markers</div>
                  <button class:active={armedMarker === "mobSpawn"} onclick={() => menuAction(() => pickMarker("mobSpawn"))}>Mob Spawn</button>
                  <button class:active={armedMarker === "resourceNode"} onclick={() => menuAction(() => pickMarker("resourceNode"))}>Resource Node</button>
                  <button class:active={armedMarker === "village"} onclick={() => menuAction(() => pickMarker("village"))}>Village Marker</button>
                  <button class:active={armedMarker === "entry"} onclick={() => menuAction(() => pickMarker("entry"))}>Entry Spawn</button>
                  <button class:active={armedMarker === "portal"} onclick={() => menuAction(() => pickMarker("portal"))}>Region Portal</button>
                  <button class:active={armedMarker === "npc"} onclick={() => menuAction(() => pickMarker("npc"))}>Quest Giver NPC</button>
                  <button class:active={armedMarker === "worldEvent"} onclick={() => menuAction(() => pickMarker("worldEvent"))}>World Event</button>
                  <button class:active={armedMarker === "poi"} onclick={() => menuAction(() => pickMarker("poi"))}>Point of Interest</button>
                {/if}
              {/if}
            </div>
          </div>
        {/if}
      </div>

      <div class="menu-group">
        <button class="menu-top" class:open={activeDropdown === "world"} class:lit={showColorPanel || showGrassPanel} onclick={() => toggleDropdown("world")}>World</button>
        {#if activeDropdown === "world"}
          <div class="menu-panel settings-panel">
            <button class="menu-action" onclick={() => menuAction(() => { void openContinentMap(); })}>Continent Layout Map…</button>
            <label class="menu-field checkbox-field">
              <input
                type="checkbox"
                checked={showNeighborRegions}
                disabled={neighborLoading}
                onchange={(e) => {
                  showNeighborRegions = (e.currentTarget as HTMLInputElement).checked;
                  void syncNeighborRegions();
                }}
              />
              Show neighbor regions{neighborLoading ? "…" : neighborCount > 0 ? ` (${neighborCount})` : ""}
            </label>
            {#if showNeighborRegions}
              <button
                class="menu-action"
                disabled={neighborLoading}
                onclick={() => menuAction(() => { void syncNeighborRegions(); })}
              >Refresh neighbors</button>
            {/if}
            <div class="menu-sep"></div>
            <label class="menu-field">
              Terrain Height
              <input type="range" min="0.25" max="3.0" step="0.05" bind:value={heightScale} />
              <span class="readout">{heightScale.toFixed(2)}x</span>
            </label>
            <label class="menu-field">
              Tree Density
              <input type="range" min="0.25" max="2.5" step="0.05" bind:value={treeDensity} />
              <span class="readout">{treeDensity.toFixed(2)}x</span>
            </label>
            <label class="menu-field">
              World Size
              <input
                type="range"
                min="60"
                max="1200"
                step="20"
                bind:value={worldSize}
                oninput={() => {
                  const newSize = Math.max(8, Math.min(256, Math.round(worldSize / regionPitch) + 1));
                  regionSizeX = newSize;
                  regionSizeZ = newSize;
                  void scene?.resizeRegionGrid(regionSizeX, regionSizeZ);
                }}
              />
              <span class="readout">{worldSize}m ({regionSizeX}×{regionSizeZ} @ {regionPitch}m)</span>
            </label>
      <button class="menu-action gen-world-action" onclick={() => menuAction(() => openGenerateModal(false))}>✨ Procedural World Generator…</button>
            <div class="menu-sep"></div>
            <label class="menu-field">
              Portal X <input type="number" step="1" bind:value={portalWorldX} />
            </label>
            <label class="menu-field">
              Portal Z <input type="number" step="1" bind:value={portalWorldZ} />
            </label>
            <label class="menu-field">
              Origin X
              <input
                type="number"
                step="1"
                bind:value={worldOriginX}
                onchange={() => {
                  scene?.setMeta({ worldOriginX, worldOriginZ });
                  scheduleSave();
                }}
              />
            </label>
            <label class="menu-field">
              Origin Z
              <input
                type="number"
                step="1"
                bind:value={worldOriginZ}
                onchange={() => {
                  scene?.setMeta({ worldOriginX, worldOriginZ });
                  scheduleSave();
                }}
              />
            </label>
            <div class="menu-sep"></div>
            <label class="menu-field">
              Music
              <select value={musicTrack ?? "__none__"} onchange={(e) => pickMusicTrack((e.target as HTMLSelectElement).value === "__none__" ? null : (e.target as HTMLSelectElement).value)}>
                <option value="__none__">None</option>
                <optgroup label="Action">
                  {#each REGION_MUSIC_TRACKS.filter((t) => t.id.startsWith("action-")) as track (track.id)}
                    <option value={track.id}>{track.label}</option>
                  {/each}
                </optgroup>
                <optgroup label="Ambient">
                  {#each REGION_MUSIC_TRACKS.filter((t) => t.id.startsWith("ambient-")) as track (track.id)}
                    <option value={track.id}>{track.label}</option>
                  {/each}
                </optgroup>
                <optgroup label="Dark Ambient">
                  {#each REGION_MUSIC_TRACKS.filter((t) => t.id.startsWith("dark-ambient-")) as track (track.id)}
                    <option value={track.id}>{track.label}</option>
                  {/each}
                </optgroup>
                <optgroup label="Light Ambience">
                  {#each REGION_MUSIC_TRACKS.filter((t) => t.id.startsWith("light-ambience-")) as track (track.id)}
                    <option value={track.id}>{track.label}</option>
                  {/each}
                </optgroup>
              </select>
            </label>
            <label class="menu-field">
              Wind °
              <input type="range" min="0" max="360" step="5" bind:value={wind.direction} oninput={applyWind} />
              <span class="readout">{wind.direction}°</span>
            </label>
            <label class="menu-field">
              Wind Strength
              <input type="range" min="0" max="3" step="0.1" bind:value={wind.strength} oninput={applyWind} />
              <span class="readout">{wind.strength.toFixed(1)}x</span>
            </label>
            <label class="menu-field">
              Grass Movement
              <input type="range" min="0" max="3" step="0.1" bind:value={grassSway} oninput={applyGrassSway} />
              <span class="readout">{grassSway.toFixed(1)}x</span>
            </label>
            <button class="menu-action" class:active={showGrassPanel} onclick={() => menuAction(() => { showGrassPanel = !showGrassPanel; })}>
              {showGrassPanel ? "Hide" : "Show"} Grass Settings
            </button>
            <div class="menu-sep"></div>
            <div class="menu-section">Camera</div>
            <button class="menu-action" class:active={flyNav} onclick={() => menuAction(() => setNavMode("fly"))}>
              Fly (Minecraft) — default
            </button>
            <button class="menu-action" class:active={!flyNav} onclick={() => menuAction(() => setNavMode("orbit"))}>
              Orbit (legacy)
            </button>
            <div class="menu-sep"></div>
            <button class="menu-action" class:active={showColorPanel} onclick={() => menuAction(() => { showColorPanel = !showColorPanel; })}>
              {showColorPanel ? "Hide" : "Show"} Color Grading
            </button>
          </div>
        {/if}
      </div>

      <div class="menubar-spacer"></div>

      {#if status}<span class="status" title={status}>{status}</span>{/if}

      <button class="generate-world-top-btn" onclick={() => openGenerateModal(false)} title="Procedural World Generator">
        ✨ Generate World…
      </button>
      <button class="save-btn" onclick={() => { void saveToServer(); }} title="Save (⌘S)">Save</button>
      <button class="playtest-btn" class:active={playtestActive} onclick={togglePlaytest} title="Walk around the region">
        {playtestActive ? "Exit Playtest" : "Playtest"}
      </button>
      <input bind:this={fileInput} type="file" accept="application/json" class="hidden-file" onchange={onFileSelected} />
    </div>

    <!-- Compact transform / document toolbar -->
    <div class="toolbar">
      <div class="segmented-control">
        <button class:active={transformMode === "translate"} onclick={() => setMode("translate")} title="Move (T)">Move</button>
        <button class:active={transformMode === "rotate"} onclick={() => setMode("rotate")} title="Rotate (R)">Rotate</button>
        <button class:active={transformMode === "scale"} onclick={() => setMode("scale")} title="Scale (S)">Scale</button>
      </div>

      <button class="tool-chip" class:active={transformSnap} onclick={toggleSnap} title="Snap (X)">Snap</button>
      <button class="tool-chip" onclick={dropToGround} disabled={selection.length === 0} title="Ground (G)">Ground</button>

      <div class="v-divider"></div>

      <select
        class="doc-select"
        value={regionId}
        onchange={(e) => loadRegion((e.target as HTMLSelectElement).value)}
        title="Open region"
      >
        {#each regionList as r (r.id)}
          <option value={r.id}>{r.name}</option>
        {/each}
        {#if !regionList.some((r) => r.id === regionId)}
          <option value={regionId}>{regionName} (unsaved)</option>
        {/if}
      </select>
      <input type="text" class="name-input" bind:value={regionName} placeholder="Name" title="Region name" />
      <select class="biome-select" bind:value={biome} onchange={applyBiomePreset} title="Biome">
        {#each REGION_BIOMES as b (b)}
          <option value={b}>{REGION_BIOME_LABELS[b]}</option>
        {/each}
      </select>
      <div class="level-quick-badge" title="Region Level Difficulty Range">
        <span class="lvl-label">Lv.</span>
        <input
          type="number"
          class="lvl-num-input"
          min="1"
          max="100"
          bind:value={minLevel}
          onchange={() => {
            if (minLevel > maxLevel) maxLevel = minLevel;
            scene?.setMeta({ minLevel, maxLevel });
          }}
          title="Min Level"
        />
        <span class="lvl-sep">–</span>
        <input
          type="number"
          class="lvl-num-input"
          min="1"
          max="100"
          bind:value={maxLevel}
          onchange={() => {
            if (maxLevel < minLevel) minLevel = maxLevel;
            scene?.setMeta({ minLevel, maxLevel });
          }}
          title="Max Level"
        />
      </div>
      <div
        class="dim-quick-badge"
        title="Region World Size: {Math.round((regionSizeX - 1) * regionPitch)}m × {Math.round((regionSizeZ - 1) * regionPitch)}m ({regionSizeX}×{regionSizeZ} vertices @ {regionPitch}m pitch)"
      >
        <span class="dim-icon">📐</span>
        <span class="dim-val">{Math.round((regionSizeX - 1) * regionPitch)}m × {Math.round((regionSizeZ - 1) * regionPitch)}m</span>
      </div>
    </div>
  </div>

  <!-- Active Context Sub-Bar (only shown when a sculpt, water, texture, light, tree, or road tool is active) -->
  {#if sculptMode || volumeSculptBrushActive || volumeClaySculptActive || volumeStampShape || waterBrushMode || texturePaintMode !== null || armedLightColor !== null || armedFogColor !== null || armedBarrier || armedCloudShape !== null || randomTreeBrushActive || grassBrushActive || grassEraseBrushActive || eraseBrushActive || roadPaintActive || armedMarker === "mobSpawn" || armedMarker === "resourceNode"}
    <div class="context-bar">
      <span class="context-title">
        {#if armedMarker === "resourceNode"}
          ⛏️ Resource Node: <strong>PLACE</strong>
          <span class="context-hint"> — pick type, then click terrain</span>
        {:else if armedMarker === "mobSpawn"}
          👹 Mob Spawn: <strong>PLACE</strong>
          <span class="context-hint"> — set difficulty/type for each click</span>
        {:else if volumeClaySculptActive}
          🧱 Clay Sculpt: <strong>{volumeSculptOp === "add" ? "ADD" : "SUBTRACT"}</strong>
          <span class="context-hint"> — drag on terrain/volumes in 3D (boulder/block)</span>
        {:else if volumeSculptBrushActive}
          🖌️ Volume Sculpt Brush: <strong>DRAG ONE CONTINUOUS MESH</strong>
        {:else if volumeStampShape}
          🗿 Place Volume: <strong>{volumeStampShape.toUpperCase()}</strong>
        {:else if sculptMode}
          🏔️ Sculpting Mode: <strong>{sculptMode === "carve" ? "CARVE HOLE" : sculptMode.toUpperCase()}</strong>
          {#if sculptMode === "carve"}
            <span class="context-hint"> — volumes only (radius = brush size)</span>
          {:else if selection.some((s) => s.kind === "volume")}
            <span class="context-hint"> — selected volume only</span>
          {/if}
        {:else if waterBrushMode}
          💧 Water Mode: <strong>{waterBrushMode === "add" ? "DROP WATER" : "DRAIN WATER"}</strong>
        {:else if texturePaintMode !== null}
          🎨 Texture Paint: <strong>{["AUTO", "GRASS", "DIRT", "COBBLESTONE", "SNOW", "ROCK", "SAND", "MUD", "LAVA / ASH", "GRAVEL"][texturePaintMode] ?? "CUSTOM"}</strong>
        {:else if armedLightColor !== null}
          💡 Light Placement: <strong>PLACE LIGHT SOURCE</strong>
        {:else if armedFogColor !== null}
          🌫️ Fog Placement: <strong>{armedFogShape === "box" ? "MIST BOX" : "MIST SPHERE"}</strong>
        {:else if armedBarrier}
          🚧 Barrier Placement: <strong>INVISIBLE WALL</strong>
        {:else if armedCloudShape !== null}
          ☁️ Cloud Placement: <strong>{armedCloudShape.toUpperCase()}</strong>
        {:else if randomTreeBrushActive}
          🌲 Nature Mode: <strong>RANDOM TREE BRUSH</strong>
        {:else if grassBrushActive}
          🌿 Nature Mode: <strong>GRASS BRUSH</strong>
        {:else if grassEraseBrushActive}
          🌾✂️ Nature Mode: <strong>ERASE GRASS</strong>
        {:else if eraseBrushActive}
          🧹 Nature Mode: <strong>ERASE BRUSH</strong>
        {:else if roadPaintActive}
          🛣️ Road Mode: <strong>PAINT ROAD</strong>
        {/if}
      </span>

      <div class="context-fields">
        {#if armedMarker === "resourceNode"}
          <label class="context-field">
            Node Type
            <select bind:value={resourceNodeType} onchange={applyResourceNodeDefaults}>
              {#each PLACEABLE_REGION_NODE_TYPES as typeId}
                <option value={typeId}>{nodeTypeDef(typeId).name}</option>
              {/each}
            </select>
          </label>
        {:else if armedMarker === "mobSpawn"}
          <label class="context-field">
            Difficulty
            <input type="range" min="0.5" max="3" step="0.1" bind:value={mobSpawnDifficulty} oninput={applyMobSpawnDefaults} />
            <span>{mobSpawnDifficulty.toFixed(1)}x</span>
          </label>
          <label class="context-field">
            Mob Type
            <select bind:value={mobSpawnType} onchange={applyMobSpawnDefaults}>
              <option value="">Biome random</option>
              {#each Object.values(MOBS) as mob}
                <option value={mob.id}>{mob.name}</option>
              {/each}
            </select>
          </label>
        {:else if sculptMode || volumeSculptBrushActive || volumeClaySculptActive || volumeStampShape || waterBrushMode || texturePaintMode !== null || randomTreeBrushActive || grassBrushActive || grassEraseBrushActive || eraseBrushActive}
          <label class="context-field">
            Radius
            <input type="range" min="2" max="30" value={brushRadius} oninput={(e) => updateBrushRadius(Number((e.target as HTMLInputElement).value))} />
            <span>{brushRadius}m</span>
          </label>
          {#if texturePaintMode !== null}
            <label class="context-field">
              Layer
              <select value={texturePaintMode} onchange={(e) => pickTexture(Number((e.target as HTMLSelectElement).value))}>
                <option value={0}>🌿 Auto / Biome</option>
                <option value={1}>🌱 Grass (Grass001)</option>
                <option value={2}>🍂 Dirt (Ground023)</option>
                <option value={3}>🧱 Cobble (PavingStones046)</option>
                <option value={4}>❄️ Snow (Snow010A)</option>
                <option value={5}>🪨 Rock / Cliff (Rock026)</option>
                <option value={6}>🏖️ Sand (Ground080)</option>
                <option value={7}>🪵 Mud / Swamp (Ground071)</option>
                <option value={8}>🌋 Lava / Scorched (Lava004)</option>
                <option value={9}>🪨 Gravel / Scree (Gravel024)</option>
              </select>
            </label>
          {/if}
          {#if volumeClaySculptActive}
            <label class="context-field">
              Mode
              <select value={volumeSculptOp} onchange={(e) => setVolumeSculptOp((e.target as HTMLSelectElement).value as "add" | "sub")}>
                <option value="add">Add (Draw)</option>
                <option value="sub">Subtract (Carve)</option>
              </select>
            </label>
            <label class="context-field">
              Shape
              <select value={volumeStampShape ?? "boulder"} onchange={(e) => pickVolumeShapeForBrush((e.target as HTMLSelectElement).value as TerrainVolumeShape)}>
                {#each CLAY_SCULPT_SHAPES as shape}
                  <option value={shape.id}>{shape.label}</option>
                {/each}
              </select>
            </label>
            <label class="context-field">
              Material
              <select value={volumeMaterial} onchange={(e) => pickVolumeMaterial((e.target as HTMLSelectElement).value as TerrainVolumeMaterial)}>
                {#each TERRAIN_VOLUME_MATERIALS as mat}
                  <option value={mat.id}>{mat.label}</option>
                {/each}
              </select>
            </label>
            <label class="context-field">
              Strength
              <input type="range" min="0.2" max="3" step="0.1" value={brushStrength} oninput={(e) => updateBrushStrength(Number((e.target as HTMLInputElement).value))} />
              <span>{brushStrength}x</span>
            </label>
          {:else if volumeSculptBrushActive || volumeStampShape}
            <label class="context-field">
              Shape
              <select value={volumeStampShape ?? "boulder"} onchange={(e) => pickVolumeShapeForBrush((e.target as HTMLSelectElement).value as TerrainVolumeShape)}>
                {#each TERRAIN_VOLUME_SHAPES as shape}
                  <option value={shape.id}>{shape.label}</option>
                {/each}
              </select>
            </label>
            <label class="context-field">
              Material
              <select value={volumeMaterial} onchange={(e) => pickVolumeMaterial((e.target as HTMLSelectElement).value as TerrainVolumeMaterial)}>
                {#each TERRAIN_VOLUME_MATERIALS as mat}
                  <option value={mat.id}>{mat.label}</option>
                {/each}
              </select>
            </label>
          {/if}
          {#if sculptMode || volumeSculptBrushActive || waterBrushMode || randomTreeBrushActive || grassBrushActive || grassEraseBrushActive}
            <label class="context-field">
              {volumeSculptBrushActive ? "Height" : randomTreeBrushActive ? "Density" : grassBrushActive ? "Frequency" : "Strength"}
              <input type="range" min="0.2" max="3" step="0.1" value={brushStrength} oninput={(e) => updateBrushStrength(Number((e.target as HTMLInputElement).value))} />
              <span>{brushStrength}x</span>
            </label>
          {/if}
          {#if grassBrushActive || grassEraseBrushActive}
            <label class="context-field">
              Preset
              <select onchange={(e) => applyGrassPreset((e.target as HTMLSelectElement).value)}>
                <option value="">(Custom Preset)</option>
                {#each Object.keys(QUICK_GRASS_PRESETS) as presetName}
                  <option value={presetName}>{presetName}</option>
                {/each}
                <option value="__reset__">Default Reset</option>
              </select>
            </label>
            <label class="context-field">
              Bottom
              <input type="color" bind:value={grassColor.bottom} oninput={applyGrassColor} />
            </label>
            <label class="context-field">
              Top
              <input type="color" bind:value={grassColor.top} oninput={applyGrassColor} />
            </label>
            <label class="context-field">
              Length
              <input type="range" min="0.4" max="2.5" step="0.05" bind:value={grassLength} oninput={applyGrassLength} />
              <span>{grassLength.toFixed(2)}x</span>
            </label>
            <button class="menu-action" class:active={showGrassPanel} type="button" onclick={() => { showGrassPanel = !showGrassPanel; }}>
              {showGrassPanel ? "Hide Settings Panel" : "Grass Settings…"}
            </button>
          {/if}
        {:else if roadPaintActive}
          <label class="context-field">
            Width
            <input type="range" min="1" max="12" step="0.5" value={roadWidth} oninput={(e) => updateRoadWidth(Number((e.target as HTMLInputElement).value))} />
            <span>{roadWidth}m</span>
          </label>
        {/if}
      </div>

      <button class="context-close" onclick={cancelArmed}>✕ Done / Cancel</button>
    </div>
  {/if}

  {#if showContinentMap}
    <ContinentLayoutMap
      tiles={layoutTiles}
      currentRegionId={regionId || "__draft__"}
      currentBlueprint={scene ? scene.exportBlueprint() : null}
      saving={layoutSaving}
      progress={opProgress}
      focusPoiId={continentMapFocusPoiId}
      onTilesChange={onLayoutTilesChange}
      onClose={() => {
        showContinentMap = false;
      }}
      onSave={() => {
        void saveContinentLayout();
      }}
      onOpenRegion={(id) => {
        showContinentMap = false;
        void loadRegion(id);
      }}
      onDeleteRegion={handleDeleteRegionFromContinent}
      onStitchSeams={stitchContinentBorderSeams}
      onRegenCoastlines={regenContinentOceanCoastlines}
      onPoiShapeSaved={(poiId, revealShape) => {
        // No-op if this POI isn't loaded in the currently-open 3D scene --
        // prevents the scene's stale in-memory copy from clobbering the
        // shape just saved (possibly for a different region entirely) the
        // next time this scene's own Save runs.
        scene?.refreshPoiShape(poiId, revealShape);
      }}
    />
  {/if}

  {#if deleteConfirmOpen}
    <!-- Overlay dismiss uses target===currentTarget (not child stopPropagation):
         Svelte 5's delegated clicks break when a parent calls stopPropagation. -->
    <div
      class="delete-modal-overlay"
      role="presentation"
      onclick={(e) => {
        if (e.target === e.currentTarget && !deleteInProgress) deleteConfirmOpen = false;
      }}
    >
      <div
        class="delete-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-region-title"
      >
        <h3 id="delete-region-title">Delete region?</h3>
        <p>
          Permanently delete <strong>{regionName}</strong>
          <span class="mono">({regionId})</span>?
        </p>
        <ul>
          <li>The region file is removed from disk and the live game catalog.</li>
          <li>Mobs, NPCs, gather nodes, and portal links targeting this region are cleaned up.</li>
          <li>Players currently inside are moved to another region.</li>
          {#if isStartingRegion}
            <li class="warn">This is marked as the Starting Town — a different region will be used for new characters.</li>
          {/if}
        </ul>
        <p class="warn-line">This cannot be undone.</p>
        <div class="delete-modal-actions">
          <button
            type="button"
            class="cancel"
            disabled={deleteInProgress}
            onclick={() => (deleteConfirmOpen = false)}
          >Cancel</button>
          <button
            type="button"
            class="confirm-delete"
            disabled={deleteInProgress}
            onclick={() => { void confirmDeleteRegion(); }}
          >{deleteInProgress ? "Deleting…" : "Delete Region"}</button>
        </div>
      </div>
    </div>
  {/if}

  {#if showGenerateModal}
    <!-- Procedural World Generator Modal -->
    <div
      class="world-gen-modal-overlay"
      role="presentation"
      onclick={(e) => {
        if (e.target === e.currentTarget && !isGeneratingContinent) showGenerateModal = false;
      }}
    >
      <div
        class="world-gen-modal rc-frame"
        role="dialog"
        aria-modal="true"
        aria-labelledby="world-gen-title"
      >
        <div class="gen-header">
          <div class="gen-header-title">
            <span class="gen-icon">✨</span>
            <div>
              <h2 id="world-gen-title">Procedural World Generator</h2>
              <p class="gen-subtitle">
                {genModalMode === "single"
                  ? "Configure biome ecosystem, terrain contours, mob difficulty, resources, and region boundaries."
                  : "Generate full multi-region continents or archipelagos with neighbor-aware seamless continuous terrain."}
              </p>
            </div>
          </div>

          <div class="gen-mode-tabs">
            <button
              type="button"
              class="gen-mode-tab"
              class:active={genModalMode === "single"}
              onclick={() => (genModalMode = "single")}
            >
              Single Region
            </button>
            <button
              type="button"
              class="gen-mode-tab"
              class:active={genModalMode === "continent"}
              onclick={() => (genModalMode = "continent")}
            >
              🗺️ Multi-Region Continent
            </button>
          </div>

          <button type="button" class="gen-close-btn" disabled={isGeneratingContinent} onclick={() => (showGenerateModal = false)}>✕</button>
        </div>

        {#if genModalMode === "single"}
          <div class="gen-modal-body">
            <!-- 1. Biome Selection -->
            <div class="gen-section">
              <div class="gen-section-header">
                <span class="gen-section-title">1. Biome Ecosystem</span>
                <span class="gen-section-hint">Select the environmental archetype and climate</span>
              </div>

              <div class="biome-grid">
                {#each [
                  REGION_BIOME_DETAILS.forest,
                  REGION_BIOME_DETAILS.jungle,
                  REGION_BIOME_DETAILS.desert,
                  REGION_BIOME_DETAILS.arctic,
                  REGION_BIOME_DETAILS.swamp,
                  REGION_BIOME_DETAILS.volcanic,
                  REGION_BIOME_DETAILS.cosmic,
                  REGION_BIOME_DETAILS.underground,
                ] as b (b.id)}
                  <button
                    type="button"
                    class="biome-card"
                    class:selected={genBiome === b.id}
                    onclick={() => selectModalBiome(b.id)}
                  >
                    <div class="biome-card-top">
                      <span class="biome-card-icon">{b.icon}</span>
                      <div class="biome-card-heading">
                        <span class="biome-card-title">{b.title}</span>
                        <span class="biome-card-badge">Lv. {b.recommendedLevels[0]}–{b.recommendedLevels[1]}</span>
                      </div>
                    </div>
                    <div class="biome-card-desc">{b.description}</div>
                    <div class="biome-card-tags">
                      {#each b.tags as tag}
                        <span class="biome-tag">{tag}</span>
                      {/each}
                    </div>
                  </button>
                {/each}
              </div>

              <div class="other-biomes-row">
                <span class="other-biomes-label">Other Archetypes:</span>
                <button
                  type="button"
                  class="other-biome-chip"
                  class:active={genBiome === "grassland"}
                  onclick={() => selectModalBiome("grassland")}
                >
                  🌱 Grasslands & Savannas
                </button>
                <button
                  type="button"
                  class="other-biome-chip"
                  class:active={genBiome === "alien"}
                  onclick={() => selectModalBiome("alien")}
                >
                  🪐 Alien Xenosphere
                </button>
              </div>
            </div>

            <!-- 2. Level Area Difficulty & Mob Tier -->
            <div class="gen-section">
              <div class="gen-section-header">
                <span class="gen-section-title">2. Level Area & Mob Difficulty</span>
                <span class="gen-section-hint">Dictates monster strength, spawn tiers, and encounter danger</span>
              </div>

              <div class="level-presets-row">
                <button
                  type="button"
                  class="level-chip"
                  class:active={genMinLevel === 1 && genMaxLevel === 5}
                  onclick={() => setModalLevelPreset(1, 5)}
                >
                  🛡️ 1 – 5 (Starter Zone)
                </button>
                <button
                  type="button"
                  class="level-chip"
                  class:active={genMinLevel === 5 && genMaxLevel === 12}
                  onclick={() => setModalLevelPreset(5, 12)}
                >
                  ⚔️ 5 – 12 (Low Level)
                </button>
                <button
                  type="button"
                  class="level-chip"
                  class:active={genMinLevel === 12 && genMaxLevel === 25}
                  onclick={() => setModalLevelPreset(12, 25)}
                >
                  🔥 12 – 25 (Mid Level)
                </button>
                <button
                  type="button"
                  class="level-chip"
                  class:active={genMinLevel === 25 && genMaxLevel === 40}
                  onclick={() => setModalLevelPreset(25, 40)}
                >
                  ☠️ 25 – 40 (High Level)
                </button>
                <button
                  type="button"
                  class="level-chip"
                  class:active={genMinLevel === 40 && genMaxLevel === 60}
                  onclick={() => setModalLevelPreset(40, 60)}
                >
                  👑 40 – 60 (Endgame)
                </button>
              </div>

              <div class="gen-row-inputs">
                <label class="gen-field">
                  <span class="gen-label">Min Level</span>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    bind:value={genMinLevel}
                    onchange={() => {
                      if (genMinLevel > genMaxLevel) genMaxLevel = genMinLevel;
                    }}
                  />
                </label>
                <label class="gen-field">
                  <span class="gen-label">Max Level</span>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    bind:value={genMaxLevel}
                    onchange={() => {
                      if (genMaxLevel < genMinLevel) genMinLevel = genMaxLevel;
                    }}
                  />
                </label>
                <div class="difficulty-banner">
                  <span class="diff-title">
                    {#if genMaxLevel <= 5}
                      🔰 Starter Valley (Novice Friendly)
                    {:else if genMaxLevel <= 15}
                      ⚔️ Adventurer's Frontier
                    {:else if genMaxLevel <= 30}
                      🔥 Perilous Wilds
                    {:else if genMaxLevel <= 45}
                      💀 Deadly Badlands
                    {:else}
                      👑 Legendary Endgame Domain
                    {/if}
                  </span>
                  <span class="diff-desc">Mobs scale between Lv. {genMinLevel} and Lv. {genMaxLevel} with matching drop tables</span>
                </div>
              </div>
            </div>

            <!-- 3. Biome Tuning (Terrain, Foliage, Mobs, Resources) -->
            <div class="gen-section">
              <div class="gen-section-header">
                <span class="gen-section-title">3. Ecosystem & Density Tuning</span>
                <span class="gen-section-hint">Fine-tune hill elevation, tree density, monster count, and gatherables</span>
              </div>

              <div class="sliders-grid">
                <div class="slider-box">
                  <div class="slider-top">
                    <span class="slider-label">Terrain Elevation & Hills</span>
                    <span class="slider-val">{genHeightScale.toFixed(2)}x</span>
                  </div>
                  <input type="range" min="0.25" max="3.0" step="0.05" bind:value={genHeightScale} />
                  <span class="slider-hint">Higher values create towering rolling green knolls and mountain ridges</span>
                </div>

                <div class="slider-box">
                  <div class="slider-top">
                    <span class="slider-label">Tree & Foliage Density</span>
                    <span class="slider-val">{genTreeDensity.toFixed(2)}x</span>
                  </div>
                  <input type="range" min="0.0" max="2.5" step="0.05" bind:value={genTreeDensity} />
                  <span class="slider-hint">Controls woodland canopy coverage and natural plant clusters</span>
                </div>

                <div class="slider-box">
                  <div class="slider-top">
                    <span class="slider-label">Mob Spawn Density</span>
                    <span class="slider-val">{genMobDensity.toFixed(2)}x</span>
                  </div>
                  <input type="range" min="0.0" max="2.5" step="0.05" bind:value={genMobDensity} />
                  <span class="slider-hint">Controls monster population and territorial patrol packs</span>
                </div>

                <div class="slider-box">
                  <div class="slider-top">
                    <span class="slider-label">Resource Node Density</span>
                    <span class="slider-val">{genResourceDensity.toFixed(2)}x</span>
                  </div>
                  <input type="range" min="0.0" max="2.5" step="0.05" bind:value={genResourceDensity} />
                  <span class="slider-hint">Density of gatherable trees, ore veins, rocks, and herb bushes</span>
                </div>
              </div>

              <!-- Resource Variety Filters -->
              <div class="resource-variety-section">
                <div class="resource-variety-header">
                  <span class="resource-variety-title">Resource Variety Filters</span>
                  <div class="resource-variety-actions">
                    <button
                      type="button"
                      class="variety-action-btn"
                      onclick={() => {
                        for (const t of PLACEABLE_REGION_NODE_TYPES) genResourceVariety[t] = true;
                      }}
                    >Select All</button>
                    <button
                      type="button"
                      class="variety-action-btn"
                      onclick={() => {
                        const activeTypes = new Set(getBiomeLevelResourceTypes(genBiome, genMinLevel));
                        for (const t of PLACEABLE_REGION_NODE_TYPES) genResourceVariety[t] = activeTypes.has(t);
                      }}
                    >Level Defaults</button>
                  </div>
                </div>

                <div class="resource-chips-grid">
                  {#each PLACEABLE_REGION_NODE_TYPES as nodeType}
                    <button
                      type="button"
                      class="resource-chip"
                      class:active={genResourceVariety[nodeType]}
                      onclick={() => (genResourceVariety[nodeType] = !genResourceVariety[nodeType])}
                    >
                      <span class="chip-icon">
                        {#if nodeType === "tree"}🌲
                        {:else if nodeType === "rock"}🪨
                        {:else if nodeType === "berry_bush"}🫐
                        {:else if nodeType === "copper_vein"}🥉
                        {:else if nodeType === "tin_vein"}🥈
                        {:else if nodeType === "iron_deposit"}⚔️
                        {:else if nodeType === "mithril_deposit"}💎
                        {:else if nodeType === "thorium_vein"}⚡
                        {:else}📦{/if}
                      </span>
                      <span class="chip-name">{nodeTypeDef(nodeType).name}</span>
                      <span class="chip-check">{genResourceVariety[nodeType] ? "✓" : "–"}</span>
                    </button>
                  {/each}
                </div>
              </div>
            </div>

            <!-- 4. Landscape Morphology & Island Variants -->
            <div class="gen-section">
              <div class="gen-section-header">
                <span class="gen-section-title">4. Landscape Morphology & Islands</span>
                <span class="gen-section-hint">Select natural landform archetypes, offshore islands, fjords, or river valleys</span>
              </div>

              <div class="continent-layout-grid">
                <button
                  type="button"
                  class="layout-card"
                  class:selected={genLandscapeVariant === "natural"}
                  onclick={() => (genLandscapeVariant = "natural")}
                >
                  <span class="layout-icon">🌿</span>
                  <div class="layout-info">
                    <span class="layout-title">Natural Organic</span>
                    <span class="layout-desc">Standard biome topography with natural coastal barrier islands & lake islets</span>
                  </div>
                </button>

                <button
                  type="button"
                  class="layout-card"
                  class:selected={genLandscapeVariant === "archipelago"}
                  onclick={() => (genLandscapeVariant = "archipelago")}
                >
                  <span class="layout-icon">🏝️</span>
                  <div class="layout-info">
                    <span class="layout-title">Archipelago & Islands</span>
                    <span class="layout-desc">Tropical/forested island chains, sandbars, atolls, and shallow channel crossings</span>
                  </div>
                </button>

                <button
                  type="button"
                  class="layout-card"
                  class:selected={genLandscapeVariant === "fjords"}
                  onclick={() => (genLandscapeVariant = "fjords")}
                >
                  <span class="layout-icon">🌊</span>
                  <div class="layout-info">
                    <span class="layout-title">Coastal Fjords</span>
                    <span class="layout-desc">Deep glacial ocean inlets carving inland with sheer sea cliffs and sea stack islets</span>
                  </div>
                </button>

                <button
                  type="button"
                  class="layout-card"
                  class:selected={genLandscapeVariant === "river_valley"}
                  onclick={() => (genLandscapeVariant = "river_valley")}
                >
                  <span class="layout-icon">🏞️</span>
                  <div class="layout-info">
                    <span class="layout-title">Meandering River Valley</span>
                    <span class="layout-desc">Wide winding river channel with fertile floodplains and delta sandbar islands</span>
                  </div>
                </button>

                <button
                  type="button"
                  class="layout-card"
                  class:selected={genLandscapeVariant === "highland"}
                  onclick={() => (genLandscapeVariant = "highland")}
                >
                  <span class="layout-icon">🏔️</span>
                  <div class="layout-info">
                    <span class="layout-title">Highland Plateaus</span>
                    <span class="layout-desc">Stepped elevated tablelands, rock escarpments, and high mountain passes</span>
                  </div>
                </button>

                <button
                  type="button"
                  class="layout-card"
                  class:selected={genLandscapeVariant === "caldera"}
                  onclick={() => (genLandscapeVariant = "caldera")}
                >
                  <span class="layout-icon">🌋</span>
                  <div class="layout-info">
                    <span class="layout-title">Sunken Caldera & Lake</span>
                    <span class="layout-desc">Sunken crater lake with an elevated ring rim and a central sanctuary island</span>
                  </div>
                </button>

                <button
                  type="button"
                  class="layout-card"
                  class:selected={genLandscapeVariant === "badlands"}
                  onclick={() => (genLandscapeVariant = "badlands")}
                >
                  <span class="layout-icon">🏜️</span>
                  <div class="layout-info">
                    <span class="layout-title">Canyon Badlands</span>
                    <span class="layout-desc">Stepped terraced mesas, deep dry canyon ravines, and layered rock formations</span>
                  </div>
                </button>
              </div>
            </div>

            <!-- 5. Map Size & World Dimensions -->
            <div class="gen-section">
              <div class="gen-section-header">
                <span class="gen-section-title">5. Map Size & World Dimensions</span>
                <span class="gen-section-hint">Scale the landmass footprint and vertex mesh resolution</span>
              </div>

              <div class="size-presets-row">
                <button
                  type="button"
                  class="size-chip"
                  class:active={genGridSizeX === 32 && genGridSizeZ === 32}
                  onclick={() => setModalSizePreset(32, 32, 6)}
                >
                  🏝️ Small (186m • 32×32)
                </button>
                <button
                  type="button"
                  class="size-chip"
                  class:active={genGridSizeX === 64 && genGridSizeZ === 64}
                  onclick={() => setModalSizePreset(64, 64, 6)}
                >
                  🗺️ Medium (378m • 64×64)
                </button>
                <button
                  type="button"
                  class="size-chip"
                  class:active={genGridSizeX === 80 && genGridSizeZ === 80}
                  onclick={() => setModalSizePreset(80, 80, 6)}
                >
                  🏔️ Large (474m • 80×80)
                </button>
                <button
                  type="button"
                  class="size-chip"
                  class:active={genGridSizeX === 128 && genGridSizeZ === 128}
                  onclick={() => setModalSizePreset(128, 128, 6)}
                >
                  🌌 Epic (762m • 128×128)
                </button>
              </div>

              <div class="gen-row-inputs">
                <label class="gen-field">
                  <span class="gen-label">Width (X Vertices)</span>
                  <input
                    type="number"
                    min="8"
                    max="256"
                    bind:value={genGridSizeX}
                    onchange={() => {
                      genWorldSize = Math.round(Math.max((genGridSizeX - 1) * genPitch, (genGridSizeZ - 1) * genPitch));
                    }}
                  />
                </label>
                <label class="gen-field">
                  <span class="gen-label">Length (Z Vertices)</span>
                  <input
                    type="number"
                    min="8"
                    max="256"
                    bind:value={genGridSizeZ}
                    onchange={() => {
                      genWorldSize = Math.round(Math.max((genGridSizeX - 1) * genPitch, (genGridSizeZ - 1) * genPitch));
                    }}
                  />
                </label>
                <label class="gen-field">
                  <span class="gen-label">Pitch (m/cell)</span>
                  <input
                    type="number"
                    min="1"
                    max="32"
                    step="0.5"
                    bind:value={genPitch}
                    onchange={() => {
                      genWorldSize = Math.round(Math.max((genGridSizeX - 1) * genPitch, (genGridSizeZ - 1) * genPitch));
                    }}
                  />
                </label>
                <div class="size-banner">
                  <span class="size-summary-title">Total Area: {(((genGridSizeX - 1) * genPitch * (genGridSizeZ - 1) * genPitch) / 1000000).toFixed(3)} km²</span>
                  <span class="size-summary-dim">{Math.round((genGridSizeX - 1) * genPitch)}m × {Math.round((genGridSizeZ - 1) * genPitch)}m real-world span</span>
                </div>
              </div>
            </div>

            <!-- 6. MMO Region Name & Seed -->
            <div class="gen-section">
              <div class="gen-section-header">
                <span class="gen-section-title">6. Region Identity & Seed</span>
                <span class="gen-section-hint">Auto-generated fantasy MMO region title and procedural RNG seed</span>
              </div>

              <div class="identity-grid">
                <div class="identity-field">
                  <span class="gen-label">MMO Region Name</span>
                  <div class="input-with-button">
                    <input type="text" bind:value={genName} placeholder="e.g. Whispering Glade" />
                    <button type="button" class="action-mini-btn" onclick={rerollModalName} title="Generate new MMO name">
                      🎲 Re-Roll
                    </button>
                  </div>
                </div>

                <div class="identity-field">
                  <span class="gen-label">Procedural Seed</span>
                  <div class="input-with-button">
                    <input type="text" bind:value={genSeed} placeholder="Seed string" />
                    <button type="button" class="action-mini-btn" onclick={rerollModalSeed} title="Randomize seed">
                      🎲 Random
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        {:else}
          <!-- Multi-Region Continent Mode -->
          <div class="gen-modal-body">
            <!-- 1. Continent Scale & Region Count -->
            <div class="gen-section">
              <div class="gen-section-header">
                <span class="gen-section-title">1. Continent Scale & Region Count</span>
                <span class="gen-section-hint">Select how many interconnected regions to generate across the world map</span>
              </div>

              <!-- Region Count Quick Presets -->
              <div class="level-presets-row">
                <button
                  type="button"
                  class="level-chip"
                  class:active={continentCount === 2}
                  onclick={() => (continentCount = 2)}
                >
                  🏝️ Duo (2 Regions)
                </button>
                <button
                  type="button"
                  class="level-chip"
                  class:active={continentCount === 4}
                  onclick={() => (continentCount = 4)}
                >
                  🗺️ Kingdom (4 Regions)
                </button>
                <button
                  type="button"
                  class="level-chip"
                  class:active={continentCount === 6}
                  onclick={() => (continentCount = 6)}
                >
                  🏔️ Province (6 Regions)
                </button>
                <button
                  type="button"
                  class="level-chip"
                  class:active={continentCount === 8}
                  onclick={() => (continentCount = 8)}
                >
                  🌌 Continent (8 Regions)
                </button>
                <button
                  type="button"
                  class="level-chip"
                  class:active={continentCount === 12}
                  onclick={() => (continentCount = 12)}
                >
                  👑 Empire (12 Regions)
                </button>
              </div>

              <!-- Continent Scale Presets (Massive Sizing) -->
              <div class="gen-section-header" style="margin-top: 6px;">
                <span class="gen-section-title">Region Scale (Zone Footprint)</span>
                <span class="gen-section-hint">Controls how huge and expansive each individual region will be</span>
              </div>

              <div class="size-presets-row" style="flex-wrap: wrap; gap: 6px;">
                <button
                  type="button"
                  class="size-chip"
                  class:active={continentScale === "micro"}
                  onclick={() => (continentScale = "micro")}
                >
                  ⚡ Micro (32×32 • 190m/zone)
                </button>
                <button
                  type="button"
                  class="size-chip"
                  class:active={continentScale === "compact"}
                  onclick={() => (continentScale = "compact")}
                >
                  🔹 Compact (48×48 • 288m/zone)
                </button>
                <button
                  type="button"
                  class="size-chip"
                  class:active={continentScale === "small"}
                  onclick={() => (continentScale = "small")}
                >
                  🌱 Small (64×64 • 384m/zone)
                </button>
                <button
                  type="button"
                  class="size-chip"
                  class:active={continentScale === "medium"}
                  onclick={() => (continentScale = "medium")}
                >
                  🌿 Medium (80×80 • 480m/zone)
                </button>
                <button
                  type="button"
                  class="size-chip"
                  class:active={continentScale === "large"}
                  onclick={() => (continentScale = "large")}
                >
                  🏔️ Large (96×96 • 570m/zone)
                </button>
                <button
                  type="button"
                  class="size-chip"
                  class:active={continentScale === "massive"}
                  onclick={() => (continentScale = "massive")}
                >
                  🌟 Massive (128×128 • 762m/zone)
                </button>
                <button
                  type="button"
                  class="size-chip"
                  class:active={continentScale === "colossal"}
                  onclick={() => (continentScale = "colossal")}
                >
                  🌌 Colossal (160×160 • 954m/zone)
                </button>
                <button
                  type="button"
                  class="size-chip"
                  class:active={continentScale === "titanic"}
                  onclick={() => (continentScale = "titanic")}
                >
                  👑 Titanic (192×192 • 1.15km/zone)
                </button>
                <button
                  type="button"
                  class="size-chip"
                  class:active={continentScale === "mythic"}
                  onclick={() => (continentScale = "mythic")}
                >
                  🪐 Mythic (256×256 • 1.54km/zone)
                </button>
              </div>

              <div class="gen-row-inputs">
                <label class="gen-field" style="flex: 1; max-width: 280px;">
                  <span class="gen-label">Total Regions ({continentCount})</span>
                  <input type="range" min="2" max="16" step="1" bind:value={continentCount} />
                </label>
                <div class="size-banner">
                  <span class="size-summary-title">
                    World Scale: {continentCount} joined zones ({continentScale === "mythic" ? "1.54km" : continentScale === "titanic" ? "1.15km" : continentScale === "colossal" ? "954m" : continentScale === "large" ? "570m" : continentScale === "medium" ? "480m" : continentScale === "small" ? "384m" : continentScale === "compact" ? "288m" : continentScale === "micro" ? "190m" : "762m"} each)
                  </span>
                  <span class="size-summary-dim">
                    Total contiguous continent span: ~{continentCount <= 4 ? "1.5km × 1.5km" : continentCount <= 9 ? "2.3km × 2.3km" : "3.0km × 3.0km"} with seamless flush borders
                  </span>
                </div>
              </div>
            </div>

            <!-- 2. Continent Layout & Size Variance -->
            <div class="gen-section">
              <div class="gen-section-header">
                <span class="gen-section-title">2. Layout Pattern & Size Variation</span>
                <span class="gen-section-hint">Arrangement of landmasses, aspect ratios, and size variation</span>
              </div>

              <div class="continent-layout-grid">
                <button
                  type="button"
                  class="layout-card"
                  class:selected={continentLayout === "continent"}
                  onclick={() => (continentLayout = "continent")}
                >
                  <span class="layout-icon">🗺️</span>
                  <div class="layout-info">
                    <span class="layout-title">Continent Cluster</span>
                    <span class="layout-desc">Packed contiguous landmass around a central capital with ocean on outer coasts</span>
                  </div>
                </button>

                <button
                  type="button"
                  class="layout-card"
                  class:selected={continentLayout === "rectangle_wide"}
                  onclick={() => (continentLayout = "rectangle_wide")}
                >
                  <span class="layout-icon">🌅</span>
                  <div class="layout-info">
                    <span class="layout-title">Panoramic Rectangle (Wide)</span>
                    <span class="layout-desc">Wide horizontal continent with panoramic coastlines and broad province spans</span>
                  </div>
                </button>

                <button
                  type="button"
                  class="layout-card"
                  class:selected={continentLayout === "rectangle_tall"}
                  onclick={() => (continentLayout = "rectangle_tall")}
                >
                  <span class="layout-icon">🏔️</span>
                  <div class="layout-info">
                    <span class="layout-title">Corridor Rectangle (Tall)</span>
                    <span class="layout-desc">Vertical north-to-south continent stretching from frozen poles to tropical seas</span>
                  </div>
                </button>

                <button
                  type="button"
                  class="layout-card"
                  class:selected={continentLayout === "isthmus"}
                  onclick={() => (continentLayout = "isthmus")}
                >
                  <span class="layout-icon">🌉</span>
                  <div class="layout-info">
                    <span class="layout-title">Isthmus Landbridge</span>
                    <span class="layout-desc">Twin major continental landmasses connected by a strategic narrow land bridge</span>
                  </div>
                </button>

                <button
                  type="button"
                  class="layout-card"
                  class:selected={continentLayout === "grid"}
                  onclick={() => (continentLayout = "grid")}
                >
                  <span class="layout-icon">🔲</span>
                  <div class="layout-info">
                    <span class="layout-title">Grid Matrix</span>
                    <span class="layout-desc">Symmetric rectangular grid of adjacent provinces with shared seams</span>
                  </div>
                </button>

                <button
                  type="button"
                  class="layout-card"
                  class:selected={continentLayout === "linear"}
                  onclick={() => (continentLayout = "linear")}
                >
                  <span class="layout-icon">⛓️</span>
                  <div class="layout-info">
                    <span class="layout-title">Linear Frontier</span>
                    <span class="layout-desc">Sequential chain of zones progressing from starter town to apex mountain danger</span>
                  </div>
                </button>

                <button
                  type="button"
                  class="layout-card"
                  class:selected={continentLayout === "archipelago"}
                  onclick={() => (continentLayout = "archipelago")}
                >
                  <span class="layout-icon">🏝️</span>
                  <div class="layout-info">
                    <span class="layout-title">Archipelago Realm</span>
                    <span class="layout-desc">Island chain with varying land sizes and connecting straits</span>
                  </div>
                </button>
              </div>

              <div class="gen-row-inputs" style="margin-top: 6px;">
                <div class="gen-field" style="flex: 1;">
                  <span class="gen-label">Size & Aspect Ratio Variation</span>
                  <div class="size-presets-row" style="flex-wrap: wrap; gap: 6px;">
                    <button
                      type="button"
                      class="size-chip"
                      class:active={continentSizeVariation === "varied"}
                      onclick={() => (continentSizeVariation = "varied")}
                    >
                      🌟 Varied Sizes (Large Capital + Medium Provinces + Outposts)
                    </button>
                    <button
                      type="button"
                      class="size-chip"
                      class:active={continentSizeVariation === "rectangular"}
                      onclick={() => (continentSizeVariation = "rectangular")}
                    >
                      📐 Rectangular Aspect Ratios (Wider & Taller Zone Proportions)
                    </button>
                    <button
                      type="button"
                      class="size-chip"
                      class:active={continentSizeVariation === "organic"}
                      onclick={() => (continentSizeVariation = "organic")}
                    >
                      🌿 Organic Asymmetric (Natural randomized zone dimensions)
                    </button>
                    <button
                      type="button"
                      class="size-chip"
                      class:active={continentSizeVariation === "uniform"}
                      onclick={() => (continentSizeVariation = "uniform")}
                    >
                      ⏹️ Uniform Sizes (Matched Identical Grids)
                    </button>
                  </div>
                </div>
              </div>

              <div class="gen-row-inputs" style="margin-top: 6px;">
                <div class="gen-field" style="flex: 1;">
                  <span class="gen-label">Landscape & Island Morphology</span>
                  <div class="size-presets-row" style="flex-wrap: wrap; gap: 6px;">
                    <button
                      type="button"
                      class="size-chip"
                      class:active={continentLandscapeVariant === "auto"}
                      onclick={() => (continentLandscapeVariant = "auto")}
                    >
                      🎲 Auto (Diverse Natural Islands & Valleys)
                    </button>
                    <button
                      type="button"
                      class="size-chip"
                      class:active={continentLandscapeVariant === "archipelago"}
                      onclick={() => (continentLandscapeVariant = "archipelago")}
                    >
                      🏝️ Archipelago & Islands
                    </button>
                    <button
                      type="button"
                      class="size-chip"
                      class:active={continentLandscapeVariant === "fjords"}
                      onclick={() => (continentLandscapeVariant = "fjords")}
                    >
                      🌊 Coastal Fjords
                    </button>
                    <button
                      type="button"
                      class="size-chip"
                      class:active={continentLandscapeVariant === "river_valley"}
                      onclick={() => (continentLandscapeVariant = "river_valley")}
                    >
                      🏞️ River Valleys
                    </button>
                    <button
                      type="button"
                      class="size-chip"
                      class:active={continentLandscapeVariant === "highland"}
                      onclick={() => (continentLandscapeVariant = "highland")}
                    >
                      🏔️ Highland Plateaus
                    </button>
                    <button
                      type="button"
                      class="size-chip"
                      class:active={continentLandscapeVariant === "caldera"}
                      onclick={() => (continentLandscapeVariant = "caldera")}
                    >
                      🌋 Volcanic Calderas
                    </button>
                    <button
                      type="button"
                      class="size-chip"
                      class:active={continentLandscapeVariant === "badlands"}
                      onclick={() => (continentLandscapeVariant = "badlands")}
                    >
                      🏜️ Canyon Badlands
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 3. Biome Distribution & Level Scaling -->
            <div class="gen-section">
              <div class="gen-section-header">
                <span class="gen-section-title">3. Biome Distribution & Level Progression</span>
                <span class="gen-section-hint">Climate zones, starter placement, and monster difficulty across the map</span>
              </div>

              <div class="sliders-grid">
                <div class="slider-box">
                  <span class="slider-label">Biome Distribution Mode</span>
                  <div class="level-presets-row" style="margin-top: 4px;">
                    <button
                      type="button"
                      class="level-chip"
                      class:active={continentBiomeDist === "thematic_continent"}
                      onclick={() => (continentBiomeDist = "thematic_continent")}
                    >
                      🌍 Thematic Continent (Frozen North, Arid South, etc.)
                    </button>
                    <button
                      type="button"
                      class="level-chip"
                      class:active={continentBiomeDist === "diverse_mosaic"}
                      onclick={() => (continentBiomeDist = "diverse_mosaic")}
                    >
                      🎨 Diverse Mosaic (Varied per Region)
                    </button>
                    <button
                      type="button"
                      class="level-chip"
                      class:active={continentBiomeDist === "single_biome"}
                      onclick={() => (continentBiomeDist = "single_biome")}
                    >
                      🌲 Single Biome Realm
                    </button>
                  </div>
                  {#if continentBiomeDist === "single_biome"}
                    <label class="gen-field" style="margin-top: 6px;">
                      <span class="gen-label">Primary Biome</span>
                      <select bind:value={continentPrimaryBiome} style="background: #11141c; color: #f8fafc; border: 1px solid #333c4e; border-radius: 4px; padding: 4px 8px;">
                        {#each REGION_BIOMES as b}
                          <option value={b}>{REGION_BIOME_LABELS[b]}</option>
                        {/each}
                      </select>
                    </label>
                  {/if}
                </div>

                <div class="slider-box">
                  <span class="slider-label">Level Progression</span>
                  <div class="level-presets-row" style="margin-top: 4px;">
                    <button
                      type="button"
                      class="level-chip"
                      class:active={continentLevelProg === "tiered"}
                      onclick={() => (continentLevelProg = "tiered")}
                    >
                      📈 Tiered Progression (Lv. 1–5 Starter → Lv. 45–60 Outer)
                    </button>
                    <button
                      type="button"
                      class="level-chip"
                      class:active={continentLevelProg === "uniform"}
                      onclick={() => (continentLevelProg = "uniform")}
                    >
                      ⚖️ Uniform Level Scaling
                    </button>
                  </div>
                  <div class="difficulty-banner" style="margin-top: 6px;">
                    <span class="diff-title">
                      {continentLevelProg === "tiered" ? "⚔️ Tiered MMO Adventure" : "🛡️ Consistent Level Range"}
                    </span>
                    <span class="diff-desc">
                      {continentLevelProg === "tiered"
                        ? "Capital starts at Lv. 1–5, distant provinces scale to dangerous endgame zones."
                        : "All generated regions follow baseline difficulty."}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 4. Global Continent Sliders & Seed -->
            <div class="gen-section">
              <div class="gen-section-header">
                <span class="gen-section-title">4. Terrain Elevation, Densities & World Seed</span>
                <span class="gen-section-hint">Coherent noise amplitude and procedural continent seed</span>
              </div>

              <div class="sliders-grid">
                <div class="slider-box">
                  <div class="slider-top">
                    <span class="slider-label">Terrain Elevation</span>
                    <span class="slider-val">{continentHeightScale.toFixed(2)}x</span>
                  </div>
                  <input type="range" min="0.25" max="3.0" step="0.05" bind:value={continentHeightScale} />
                </div>

                <div class="slider-box">
                  <div class="slider-top">
                    <span class="slider-label">Tree & Foliage Density</span>
                    <span class="slider-val">{continentTreeDensity.toFixed(2)}x</span>
                  </div>
                  <input type="range" min="0.0" max="2.5" step="0.05" bind:value={continentTreeDensity} />
                </div>

                <div class="slider-box">
                  <div class="slider-top">
                    <span class="slider-label">Mob Spawn Density</span>
                    <span class="slider-val">{continentMobDensity.toFixed(2)}x</span>
                  </div>
                  <input type="range" min="0.0" max="2.5" step="0.05" bind:value={continentMobDensity} />
                </div>

                <div class="slider-box">
                  <div class="slider-top">
                    <span class="slider-label">Resource Node Density</span>
                    <span class="slider-val">{continentResourceDensity.toFixed(2)}x</span>
                  </div>
                  <input type="range" min="0.0" max="2.5" step="0.05" bind:value={continentResourceDensity} />
                </div>
              </div>

              <div class="identity-field" style="margin-top: 6px;">
                <span class="gen-label">Continent Shared Seed</span>
                <div class="input-with-button">
                  <input type="text" bind:value={continentSeed} placeholder="Continent World Seed" />
                  <button type="button" class="action-mini-btn" onclick={rerollContinentSeed} title="Randomize seed">
                    🎲 Random
                  </button>
                </div>
              </div>
            </div>
          </div>
        {/if}

        <!-- Modal Footer Actions -->
        <div class="gen-modal-footer">
          <button type="button" class="gen-btn cancel" disabled={isGeneratingContinent} onclick={() => (showGenerateModal = false)}>
            Cancel
          </button>
          {#if genModalMode === "single"}
            <button type="button" class="gen-btn primary" onclick={() => { void executeWorldGeneration(); }}>
              ✨ Generate World
            </button>
          {:else}
            <button
              type="button"
              class="gen-btn primary"
              disabled={isGeneratingContinent}
              onclick={() => { void executeContinentGeneration(); }}
            >
              {isGeneratingContinent ? "⏳ Generating Continent…" : `✨ Generate ${continentCount}-Region Continent`}
            </button>
          {/if}
        </div>

        {#if continentProgress.active}
          <div class="continent-loader-overlay">
            <div class="continent-loader-card">
              <div class="loader-pulse-ring">
                <span class="loader-spinner">🌍</span>
              </div>
              <h3 class="loader-headline">{continentProgress.stage}</h3>
              <p class="loader-subtext">{continentProgress.detail}</p>

              <!-- Progress Bar Track & Bar -->
              <div class="loader-progress-box">
                <div class="loader-progress-track">
                  <div
                    class="loader-progress-fill"
                    style="width: {Math.min(100, Math.max(3, continentProgress.percent))}%;"
                  >
                    <div class="loader-shimmer"></div>
                  </div>
                </div>
                <div class="loader-meta-row">
                  <span class="meta-step">Province {continentProgress.current} of {continentProgress.total}</span>
                  <span class="meta-pct">{continentProgress.percent}%</span>
                </div>
              </div>

              <!-- Active Zone Preview Chip -->
              {#if continentProgress.currentName}
                <div class="loader-region-chip">
                  <span class="chip-biome-icon">
                    {continentProgress.currentBiome === "forest" ? "🌲" :
                     continentProgress.currentBiome === "grassland" ? "🌾" :
                     continentProgress.currentBiome === "desert" ? "🏜️" :
                     continentProgress.currentBiome === "jungle" ? "🌴" :
                     continentProgress.currentBiome === "arctic" ? "❄️" :
                     continentProgress.currentBiome === "swamp" ? "🐊" :
                     continentProgress.currentBiome === "volcanic" ? "🌋" :
                     continentProgress.currentBiome === "underground" ? "⛏️" :
                     continentProgress.currentBiome === "cosmic" ? "✨" : "👽"}
                  </span>
                  <div class="chip-text">
                    <span class="chip-title">{continentProgress.currentName}</span>
                    <span class="chip-badge">{REGION_BIOME_LABELS[continentProgress.currentBiome]} • {continentProgress.currentLevelRange}</span>
                  </div>
                </div>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <div class="body">
    <div class="palette">
      <div class="palette-tools-title">Asset Palette</div>
      <button type="button" class="palette-explorer-btn" onclick={() => (showAssetExplorer = true)}>
        Open Asset Explorer
      </button>
      <div class="palette-packs">
        {#each REGION_PALETTE_PACKS as pack}
          <button
            type="button"
            class="palette-pack-chip"
            class:active={palettePack === pack.id}
            onclick={() => (palettePack = pack.id)}
          >
            {pack.label}
          </button>
        {/each}
      </div>
      <label class="palette-search">
        <span class="sr-only">Search palette</span>
        <input type="search" placeholder="Search assets…" bind:value={paletteSearch} />
      </label>
      {#if filteredPalette.length === 0}
        <p class="palette-empty">No matches</p>
      {/if}
      {#each filteredPalette as group (group.label)}
        <div class="palette-group">
          <button class="palette-group-header" onclick={() => toggleGroup(group.label)}>
            {openGroups.has(group.label) || paletteSearch.trim() ? "▾" : "▸"}
            {palettePack === "all" ? group.label : shortPaletteGroupLabel(group.label)}
            <span class="palette-count">{group.models.length}</span>
          </button>
          {#if openGroups.has(group.label) || paletteSearch.trim()}
            <div class="palette-items">
              {#each group.models as model (model)}
                <button class:active={armedModel === model} onclick={() => pickModel(model, group.category)}>
                  {regionAssetDisplayName(model)}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <div class="viewport-canvas-container">
      <canvas bind:this={canvas} class="viewport"></canvas>

      <!-- Photoshop-style Floating Tools Dock (sits inside canvas window on left hand side) -->
      <div class="photoshop-dock" class:collapsed={floatingToolbarCollapsed}>
        <div class="photoshop-dock-header">
          <span class="photoshop-dock-title">TOOLS</span>
          <button
            type="button"
            class="photoshop-dock-toggle"
            onclick={() => (floatingToolbarCollapsed = !floatingToolbarCollapsed)}
            title={floatingToolbarCollapsed ? "Expand Tools (Photoshop Dock)" : "Collapse Dock"}
          >
            {floatingToolbarCollapsed ? "»" : "«"}
          </button>
        </div>
        {#if !floatingToolbarCollapsed}
          <div class="photoshop-dock-buttons">
            <button
              type="button"
              class="photoshop-tool-btn"
              class:active={!sculptMode && !volumeSculptBrushActive && !volumeClaySculptActive && !waterBrushMode && !texturePaintMode && !roadPaintActive && !grassBrushActive && !grassEraseBrushActive && !randomTreeBrushActive && !houseToolActive && !castleToolActive && !fantasticBuildingToolActive && !armedMarker}
              onclick={() => cancelArmed()}
              title="Select / Pointer (Esc or V)"
            >
              <span class="dock-icon">🖐️</span>
              <span class="dock-label">Select</span>
            </button>

            <div class="dock-sep"></div>

            <button
              type="button"
              class="photoshop-tool-btn"
              class:active={sculptMode === "raise"}
              onclick={() => pickSculpt("raise")}
              title="Raise Terrain [S]"
            >
              <span class="dock-icon">⛰️</span>
              <span class="dock-label">Raise</span>
            </button>

            <button
              type="button"
              class="photoshop-tool-btn"
              class:active={volumeClaySculptActive}
              onclick={pickVolumeClaySculpt}
              title="3D Clay Sculpt [C]"
            >
              <span class="dock-icon">🏺</span>
              <span class="dock-label">Clay 3D</span>
            </button>

            <div class="dock-sep"></div>

            <button
              type="button"
              class="photoshop-tool-btn"
              class:active={grassBrushActive}
              onclick={pickGrassBrush}
              title="Paint Quick Grass [G]"
            >
              <span class="dock-icon">🌿</span>
              <span class="dock-label">Grass</span>
            </button>

            <button
              type="button"
              class="photoshop-tool-btn"
              class:active={grassEraseBrushActive}
              onclick={pickGrassEraseBrush}
              title="Erase Quick Grass [Shift+G]"
            >
              <span class="dock-icon">🧹</span>
              <span class="dock-label">Erase G.</span>
            </button>

            <button
              type="button"
              class="photoshop-tool-btn"
              class:active={randomTreeBrushActive}
              onclick={pickRandomTreeBrush}
              title="Tree Brush [T]"
            >
              <span class="dock-icon">🌲</span>
              <span class="dock-label">Trees</span>
            </button>

            <div class="dock-sep"></div>

            <button
              type="button"
              class="photoshop-tool-btn"
              class:active={texturePaintMode !== null}
              onclick={() => pickTexture(1)}
              title="Texture Paint [P]"
            >
              <span class="dock-icon">🎨</span>
              <span class="dock-label">Paint</span>
            </button>

            <button
              type="button"
              class="photoshop-tool-btn"
              class:active={roadPaintActive}
              onclick={pickRoadTool}
              title="Dirt Road Painter [R]"
            >
              <span class="dock-icon">🛤️</span>
              <span class="dock-label">Road</span>
            </button>

            <button
              type="button"
              class="photoshop-tool-btn"
              class:active={waterBrushMode !== null}
              onclick={() => {
                if (waterBrushMode !== null) cancelArmed();
                else pickWaterBrush("add");
              }}
              title="Drop / Drain Water (Toggle)"
            >
              <span class="dock-icon">💧</span>
              <span class="dock-label">Water</span>
            </button>

            <div class="dock-sep"></div>

            <button
              type="button"
              class="photoshop-tool-btn"
              class:active={fantasticBuildingToolActive || castleToolActive || houseToolActive}
              onclick={pickFantasticBuildingTool}
              title="Generate Buildings & Castles"
            >
              <span class="dock-icon">🏰</span>
              <span class="dock-label">Build</span>
            </button>

            <button
              type="button"
              class="photoshop-tool-btn"
              class:active={armedMarker !== null}
              onclick={() => pickMarker("mobSpawn")}
              title="Place Spawn/Marker"
            >
              <span class="dock-icon">📍</span>
              <span class="dock-label">Marker</span>
            </button>

            <div class="dock-sep"></div>

            <button
              type="button"
              class="photoshop-tool-btn"
              class:active={showGrassPanel}
              onclick={() => (showGrassPanel = !showGrassPanel)}
              title="Quick Grass Settings Panel"
            >
              <span class="dock-icon">⚙️</span>
              <span class="dock-label">Settings</span>
            </button>
          </div>
        {/if}
      </div>
    </div>

    <AssetExplorer
      open={showAssetExplorer}
      armedModel={armedModel}
      onClose={() => (showAssetExplorer = false)}
      onPick={pickModelFromExplorer}
    />

    {#if marqueeBox}
      {@const left = Math.min(marqueeBox.startX, marqueeBox.endX)}
      {@const top = Math.min(marqueeBox.startY, marqueeBox.endY)}
      {@const width = Math.abs(marqueeBox.endX - marqueeBox.startX)}
      {@const height = Math.abs(marqueeBox.endY - marqueeBox.startY)}
      <div
        class="marquee"
        style="left: {left}px; top: {top}px; width: {width}px; height: {height}px;"
      ></div>
    {/if}

    {#if contextMenu}
      <div
        class="editor-context-menu"
        style="left: {contextMenu.x}px; top: {contextMenu.y}px;"
        role="menu"
      >
        <div class="editor-context-title">{contextMenu.title}</div>
        {#each contextMenu.actions as action (action.id)}
          <button
            type="button"
            class="editor-context-action"
            role="menuitem"
            onclick={() => scene?.runContextMenuAction(action.id)}
          >
            {action.label}
          </button>
        {/each}
      </div>
    {/if}

    {#if playtestActive}
      <div class="playtest-hint">WASD to move &middot; Mouse to look &middot; Shift to run &middot; Esc to exit</div>
    {:else if flyNav}
      <div class="playtest-hint">
        Move to look (auto-lock) &middot; Esc / stop to free cursor &middot; Space up / Shift down &middot; Ctrl sprint
      </div>
    {/if}

    {#if showColorPanel}
      <div class="color-panel">
        <h3>Color Grading</h3>
        <label>Sky Preset
          <select
            value={colorGrading.skyPreset ?? "sunny"}
            onchange={(e) => {
              // Drop zenith/mid/horizon overrides so the new preset's timeline
              // actually shows (saved overrides were pinning the old look).
              const { zenithColor: _z, skyMidColor: _m, horizonSkyColor: _h, ...rest } = colorGrading;
              colorGrading = {
                ...rest,
                skyPreset: (e.target as HTMLSelectElement).value as SkyPresetId,
              };
              applyColorGrading();
              scheduleSave();
            }}
          >
            {#each SKY_PRESET_IDS as id}
              <option value={id}>{SKY_PRESET_LABELS[id]}</option>
            {/each}
          </select>
        </label>
        <label>Sky <input type="color" bind:value={colorGrading.skyColor} oninput={applyColorGrading} /></label>
        <label>Zenith
          <input
            type="color"
            value={colorGrading.zenithColor ?? colorGrading.skyColor}
            oninput={(e) => {
              colorGrading.zenithColor = (e.target as HTMLInputElement).value;
              applyColorGrading();
            }}
          />
        </label>
        <label>Sky Mid
          <input
            type="color"
            value={colorGrading.skyMidColor ?? colorGrading.skyColor}
            oninput={(e) => {
              colorGrading.skyMidColor = (e.target as HTMLInputElement).value;
              applyColorGrading();
            }}
          />
        </label>
        <label>Horizon Sky
          <input
            type="color"
            value={colorGrading.horizonSkyColor ?? colorGrading.fogColor}
            oninput={(e) => {
              colorGrading.horizonSkyColor = (e.target as HTMLInputElement).value;
              applyColorGrading();
            }}
          />
        </label>
        <label>Fog <input type="color" bind:value={colorGrading.fogColor} oninput={applyColorGrading} /></label>
        <label>Fog Density
          <input type="range" min={REGION_FOG_DENSITY_MIN} max="0.05" step="0.001" bind:value={colorGrading.fogDensity} oninput={applyColorGrading} />
        </label>
        <label>Ground
          <input
            type="color"
            value={colorGrading.groundTint ?? "#8aa04f"}
            oninput={(e) => {
              colorGrading.groundTint = (e.target as HTMLInputElement).value;
              applyColorGrading();
            }}
          />
        </label>
        <label>Ambient <input type="color" bind:value={colorGrading.ambientColor} oninput={applyColorGrading} /></label>
        <label>Ambient Intensity
          <input type="range" min="0" max="3" step="0.05" bind:value={colorGrading.ambientIntensity} oninput={applyColorGrading} />
        </label>
        <label>Fill / Bounce
          <input
            type="color"
            value={colorGrading.fillColor ?? colorGrading.ambientColor}
            oninput={(e) => {
              colorGrading.fillColor = (e.target as HTMLInputElement).value;
              applyColorGrading();
            }}
          />
        </label>
        <label>Fill Intensity
          <input
            type="range"
            min="0"
            max="4"
            step="0.05"
            value={colorGrading.fillIntensity ?? 0}
            oninput={(e) => {
              colorGrading.fillIntensity = Number((e.target as HTMLInputElement).value);
              applyColorGrading();
            }}
          />
        </label>
        <label>Sun <input type="color" bind:value={colorGrading.sunColor} oninput={applyColorGrading} /></label>
        <label>Sun Intensity
          <input type="range" min="0" max="4" step="0.05" bind:value={colorGrading.sunIntensity} oninput={applyColorGrading} />
        </label>
        <label>Exposure
          <input
            type="range"
            min="0.4"
            max="2.5"
            step="0.05"
            value={colorGrading.exposure ?? 1}
            oninput={(e) => {
              colorGrading.exposure = Number((e.target as HTMLInputElement).value);
              applyColorGrading();
            }}
          />
        </label>
        <label class="checkbox-field">
          <input
            type="checkbox"
            checked={colorGrading.horizonEnabled ?? false}
            onchange={(e) => {
              colorGrading.horizonEnabled = (e.currentTarget as HTMLInputElement).checked;
              applyColorGrading();
            }}
          />
          Distant horizon ring
        </label>
        {#if colorGrading.horizonEnabled}
          <label>Horizon Tint
            <input
              type="color"
              value={colorGrading.horizonTint ?? "#8d97a8"}
              oninput={(e) => {
                colorGrading.horizonTint = (e.target as HTMLInputElement).value;
                applyColorGrading();
              }}
            />
          </label>
          <label>Peak Scale
            <input
              type="range"
              min="0.4"
              max="2"
              step="0.05"
              value={colorGrading.horizonPeakScale ?? 1}
              oninput={(e) => {
                colorGrading.horizonPeakScale = Number((e.target as HTMLInputElement).value);
                applyColorGrading();
              }}
            />
            <span>{(colorGrading.horizonPeakScale ?? 1).toFixed(2)}×</span>
          </label>
        {/if}
      </div>
    {/if}

    {#if showGrassPanel}
      <div class="color-panel grass-settings-panel">
        <div class="grass-panel-head">
          <h3>Grass Settings</h3>
          <button type="button" class="grass-close" onclick={() => { showGrassPanel = false; }}>✕</button>
        </div>
        <p class="hint">Quick Grass — paint with Grass Brush / Erase Grass. Settings apply region-wide.</p>
        <div class="grass-presets">
          {#each Object.keys(QUICK_GRASS_PRESETS) as name}
            <button type="button" class="chip" onclick={() => applyGrassPreset(name)}>{name}</button>
          {/each}
          <button type="button" class="chip reset" onclick={() => applyGrassPreset("__reset__")}>Reset</button>
        </div>

        <div class="menu-section">Field</div>
        <label>Blades / patch
          <input type="range" min="256" max="8192" step="256" value={grassSettings.bladesPerPatch} oninput={(e) => applyGrassSettingsPatch({ bladesPerPatch: Number((e.target as HTMLInputElement).value) })} />
          <span>{grassSettings.bladesPerPatch}</span>
        </label>
        <label>Patch size
          <input type="range" min="4" max="24" step="1" value={grassSettings.patchSize} oninput={(e) => applyGrassSettingsPatch({ patchSize: Number((e.target as HTMLInputElement).value) })} />
          <span>{grassSettings.patchSize} m</span>
        </label>
        <label>Draw distance
          <input type="range" min="20" max="180" step="5" value={grassSettings.drawDistance} oninput={(e) => applyGrassSettingsPatch({ drawDistance: Number((e.target as HTMLInputElement).value) })} />
          <span>{grassSettings.drawDistance} m</span>
        </label>
        <label>Detail distance
          <input type="range" min="4" max="70" step="1" value={grassSettings.detailDistance} oninput={(e) => applyGrassSettingsPatch({ detailDistance: Number((e.target as HTMLInputElement).value) })} />
          <span>{grassSettings.detailDistance} m</span>
        </label>
        <label>Segments
          <input type="range" min="2" max="9" step="1" value={grassSettings.segments} oninput={(e) => applyGrassSettingsPatch({ segments: Number((e.target as HTMLInputElement).value) })} />
          <span>{grassSettings.segments}</span>
        </label>

        <div class="menu-section">Blade</div>
        <label>Width
          <input type="range" min="0.02" max="0.4" step="0.005" value={grassSettings.bladeWidth} oninput={(e) => applyGrassSettingsPatch({ bladeWidth: Number((e.target as HTMLInputElement).value) })} />
          <span>{grassSettings.bladeWidth.toFixed(3)} m</span>
        </label>
        <label>Height
          <input type="range" min="0.2" max="4" step="0.05" value={grassSettings.bladeHeight} oninput={(e) => applyGrassSettingsPatch({ bladeHeight: Number((e.target as HTMLInputElement).value) })} />
          <span>{grassSettings.bladeHeight.toFixed(2)} m</span>
        </label>
        <label>Height variation
          <input type="range" min="0" max="1.2" step="0.02" value={grassSettings.heightVariation} oninput={(e) => applyGrassSettingsPatch({ heightVariation: Number((e.target as HTMLInputElement).value) })} />
          <span>{Math.round(grassSettings.heightVariation * 100)}%</span>
        </label>
        <label>Curve
          <input type="range" min="0" max="1.4" step="0.02" value={grassSettings.curvature} oninput={(e) => applyGrassSettingsPatch({ curvature: Number((e.target as HTMLInputElement).value) })} />
          <span>{grassSettings.curvature.toFixed(2)}</span>
        </label>
        <label>Tip taper
          <input type="range" min="1" max="6" step="0.1" value={grassSettings.tipTaper} oninput={(e) => applyGrassSettingsPatch({ tipTaper: Number((e.target as HTMLInputElement).value) })} />
          <span>{grassSettings.tipTaper.toFixed(1)}</span>
        </label>
        <label>Normal spread
          <input type="range" min="0" max="0.5" step="0.01" value={grassSettings.roundness} oninput={(e) => applyGrassSettingsPatch({ roundness: Number((e.target as HTMLInputElement).value) })} />
          <span>{Math.round(grassSettings.roundness * 180)}°</span>
        </label>
        <label>Edge thickening
          <input type="range" min="0" max="2.5" step="0.05" value={grassSettings.thickening} oninput={(e) => applyGrassSettingsPatch({ thickening: Number((e.target as HTMLInputElement).value) })} />
          <span>{grassSettings.thickening.toFixed(2)}</span>
        </label>

        <div class="menu-section">Wind</div>
        <label>Strength
          <input type="range" min="0" max="2.5" step="0.05" value={grassSettings.windStrength} oninput={(e) => applyGrassSettingsPatch({ windStrength: Number((e.target as HTMLInputElement).value) })} />
          <span>{grassSettings.windStrength.toFixed(2)}</span>
        </label>
        <label>Speed
          <input type="range" min="0" max="4" step="0.05" value={grassSettings.windSpeed} oninput={(e) => applyGrassSettingsPatch({ windSpeed: Number((e.target as HTMLInputElement).value) })} />
          <span>{grassSettings.windSpeed.toFixed(2)}</span>
        </label>
        <label>Gust size
          <input type="range" min="0.02" max="1" step="0.01" value={grassSettings.gustScale} oninput={(e) => applyGrassSettingsPatch({ gustScale: Number((e.target as HTMLInputElement).value) })} />
          <span>{(1 / Math.max(0.02, grassSettings.gustScale)).toFixed(0)} m</span>
        </label>
        <label>Direction drift
          <input type="range" min="0.005" max="0.3" step="0.005" value={grassSettings.windDrift} oninput={(e) => applyGrassSettingsPatch({ windDrift: Number((e.target as HTMLInputElement).value) })} />
          <span>{grassSettings.windDrift.toFixed(3)}</span>
        </label>
        <label>Player push radius
          <input type="range" min="0" max="8" step="0.1" value={grassSettings.pushRadius} oninput={(e) => applyGrassSettingsPatch({ pushRadius: Number((e.target as HTMLInputElement).value) })} />
          <span>{grassSettings.pushRadius.toFixed(1)} m</span>
        </label>
        <label>Player push force
          <input type="range" min="0" max="1.5" step="0.02" value={grassSettings.pushStrength} oninput={(e) => applyGrassSettingsPatch({ pushStrength: Number((e.target as HTMLInputElement).value) })} />
          <span>{grassSettings.pushStrength.toFixed(2)}</span>
        </label>

        <div class="menu-section">Light & colour</div>
        <label>Root colour <input type="color" value={grassSettings.baseColour} oninput={(e) => applyGrassSettingsPatch({ baseColour: (e.target as HTMLInputElement).value })} /></label>
        <label>Tip colour <input type="color" value={grassSettings.tipColour} oninput={(e) => applyGrassSettingsPatch({ tipColour: (e.target as HTMLInputElement).value })} /></label>
        <label>Colour variation
          <input type="range" min="0" max="1.5" step="0.02" value={grassSettings.colourVariation} oninput={(e) => applyGrassSettingsPatch({ colourVariation: Number((e.target as HTMLInputElement).value) })} />
          <span>{Math.round(grassSettings.colourVariation * 100)}%</span>
        </label>
        <label>Sun elevation
          <input type="range" min="-4" max="88" step="1" value={grassSettings.sunElevation} oninput={(e) => applyGrassSettingsPatch({ sunElevation: Number((e.target as HTMLInputElement).value) })} />
          <span>{grassSettings.sunElevation}°</span>
        </label>
        <label>Sun azimuth
          <input type="range" min="0" max="360" step="2" value={grassSettings.sunAzimuth} oninput={(e) => applyGrassSettingsPatch({ sunAzimuth: Number((e.target as HTMLInputElement).value) })} />
          <span>{grassSettings.sunAzimuth}°</span>
        </label>
        <label>Sun intensity
          <input type="range" min="0" max="3.5" step="0.05" value={grassSettings.sunIntensity} oninput={(e) => applyGrassSettingsPatch({ sunIntensity: Number((e.target as HTMLInputElement).value) })} />
          <span>{grassSettings.sunIntensity.toFixed(2)}</span>
        </label>
        <label>Sky ambient
          <input type="range" min="0" max="2.5" step="0.05" value={grassSettings.ambient} oninput={(e) => applyGrassSettingsPatch({ ambient: Number((e.target as HTMLInputElement).value) })} />
          <span>{grassSettings.ambient.toFixed(2)}</span>
        </label>
        <label>Backscatter
          <input type="range" min="0" max="2.5" step="0.05" value={grassSettings.translucency} oninput={(e) => applyGrassSettingsPatch({ translucency: Number((e.target as HTMLInputElement).value) })} />
          <span>{grassSettings.translucency.toFixed(2)}</span>
        </label>
        <label>Normals toward up
          <input type="range" min="0" max="1" step="0.02" value={grassSettings.normalFlatten} oninput={(e) => applyGrassSettingsPatch({ normalFlatten: Number((e.target as HTMLInputElement).value) })} />
          <span>{Math.round(grassSettings.normalFlatten * 100)}%</span>
        </label>
        <label>Haze
          <input type="range" min="0" max="3" step="0.05" value={grassSettings.haze} oninput={(e) => applyGrassSettingsPatch({ haze: Number((e.target as HTMLInputElement).value) })} />
          <span>{grassSettings.haze.toFixed(2)}</span>
        </label>
        <label>Exposure
          <input type="range" min="0.3" max="3.5" step="0.05" value={grassSettings.exposure} oninput={(e) => applyGrassSettingsPatch({ exposure: Number((e.target as HTMLInputElement).value) })} />
          <span>{grassSettings.exposure.toFixed(2)}</span>
        </label>

        <div class="menu-section">Render</div>
        <label class="checkbox-field">
          <input type="checkbox" checked={grassSettings.showLod} onchange={(e) => applyGrassSettingsPatch({ showLod: (e.currentTarget as HTMLInputElement).checked })} />
          Tint by detail level
        </label>
        <label class="checkbox-field">
          <input type="checkbox" checked={grassSettings.wireframe} onchange={(e) => applyGrassSettingsPatch({ wireframe: (e.currentTarget as HTMLInputElement).checked })} />
          Wireframe
        </label>
        <label class="checkbox-field">
          <input type="checkbox" checked={grassSettings.freezeWind} onchange={(e) => applyGrassSettingsPatch({ freezeWind: (e.currentTarget as HTMLInputElement).checked })} />
          Freeze wind
        </label>
      </div>
    {/if}

    {#if selection.length === 1}
      {@const sel = selection[0]!}
      <div class="properties">
        <h3>{sel.kind === "asset" ? sel.model?.replace(/\.(gltf|glb)$/, "") : sel.kind === "house" ? `House (${sel.houseType ?? "cottage"})` : sel.kind === "light" ? "Point Light Source" : sel.kind === "fog" ? "Fog Volume" : sel.kind === "barrier" ? "Invisible Barrier" : sel.kind === "cloud" ? `${sel.cloudShape ?? "cumulus"} Cloud` : sel.kind === "volume" ? `${sel.volumeShape ?? "volume"} (${sel.volumeMaterial ?? "rock"})` : sel.markerKind}</h3>
        <label>X <input type="number" step="0.1" value={sel.x} onchange={(e) => applyPatch({ x: Number((e.target as HTMLInputElement).value) })} /></label>
        <label>Y <input type="number" step="0.1" value={sel.y} onchange={(e) => applyPatch({ y: Number((e.target as HTMLInputElement).value) })} /></label>
        <label>Z <input type="number" step="0.1" value={sel.z} onchange={(e) => applyPatch({ z: Number((e.target as HTMLInputElement).value) })} /></label>
        <p class="hint">Arrows nudge · Shift = fine · G = ground · X = snap · Alt+Arrows = pan camera</p>
        {#if sel.kind === "asset" || sel.kind === "volume" || sel.kind === "house"}
          <label>Yaw <input type="number" step="0.01" value={sel.yaw} onchange={(e) => applyPatch({ yaw: Number((e.target as HTMLInputElement).value) })} /></label>
          {#if sel.kind === "asset"}
            <label>Scale X <input type="number" step="0.05" value={sel.scaleX ?? sel.scale} onchange={(e) => applyPatch({ scaleX: Number((e.target as HTMLInputElement).value) })} /></label>
            <label>Scale Y <input type="number" step="0.05" value={sel.scaleY ?? sel.scale} onchange={(e) => applyPatch({ scaleY: Number((e.target as HTMLInputElement).value) })} /></label>
            <label>Scale Z <input type="number" step="0.05" value={sel.scaleZ ?? sel.scale} onchange={(e) => applyPatch({ scaleZ: Number((e.target as HTMLInputElement).value) })} /></label>
            <p class="hint">S = scale gizmo (stretch per axis). Uniform: set all three equal.</p>
          {:else}
            <label>Scale <input type="number" step="0.05" value={sel.scale} onchange={(e) => applyPatch({ scale: Number((e.target as HTMLInputElement).value) })} /></label>
          {/if}
          <div class="align-buttons-row" style="display: flex; gap: 6px; margin-top: 6px;">
            <button
              type="button"
              class="build-village-btn realign-btn"
              style="flex: 1; margin-top: 0; background: #2563eb;"
              onclick={realignBounds}
              title="Re-computes local oriented bounding box and aligns selection box & gizmo handles to asset's rotated orientation"
            >
              🎯 Reset & Align Box
            </button>
            <button
              type="button"
              class="build-village-btn space-toggle-btn"
              style="flex: 1; margin-top: 0; background: #475569;"
              onclick={toggleGizmo}
              title="Toggle transform gizmo handles between Local space (aligned with rotated asset [L]) and World space (aligned with grid axes)"
            >
              🔄 {scene?.gizmoSpace === "world" ? "World Handles" : "Local Handles"}
            </button>
          </div>
          {#if sel.kind === "asset"}
            <label>
              <input
                type="checkbox"
                checked={!!sel.solid}
                onchange={(e) => applyPatch({ solid: (e.target as HTMLInputElement).checked })}
              />
              Solid (walkable)
            </label>
            {#if sel.solid && sel.solidBox}
              <p class="hint">
                Mesh box { (sel.solidBox.halfX * 2 * (sel.scaleX ?? sel.scale)).toFixed(1) }
                × { (sel.solidBox.halfY * 2 * (sel.scaleY ?? sel.scale)).toFixed(1) }
                × { (sel.solidBox.halfZ * 2 * (sel.scaleZ ?? sel.scale)).toFixed(1) } m
                · hard-blocks at the exact mesh shape (walk on top too) · follows position / yaw / scale.
                Bridge / dock / walkway / platform models are the exception — walked on, not blocked by.
              </p>
            {:else if sel.solid}
              <p class="hint">Solid on — using model radius (no mesh measure yet).</p>
            {:else}
              <p class="hint">On = measure mesh → exact-shape collision. Buildings and rocks auto-enable on place.</p>
            {/if}
          {/if}
          {#if sel.kind === "house"}
            <p class="hint">One house asset — walls/floors/roof move together. Walkable in playtest.</p>
          {/if}
          {#if sel.kind === "asset" && sel.lightEnabled !== undefined}
            <label>
              <input
                type="checkbox"
                checked={sel.lightEnabled}
                onchange={(e) => applyPatch({ lightEnabled: (e.target as HTMLInputElement).checked })}
              />
              Emit light
            </label>
            {#if sel.lightEnabled}
              <label>Light Color <input type="color" value={sel.color ?? "#ffb060"} onchange={(e) => applyPatch({ color: (e.target as HTMLInputElement).value })} /></label>
              <label>Brightness
                <input type="range" min="0" max="40" step="0.2" value={sel.intensity ?? 6} oninput={(e) => applyPatch({ intensity: Number((e.target as HTMLInputElement).value) })} />
                <span>{(sel.intensity ?? 6).toFixed(1)}</span>
              </label>
              <label>Range
                <input type="range" min="5" max="120" step="1" value={sel.distance ?? 32} oninput={(e) => applyPatch({ distance: Number((e.target as HTMLInputElement).value) })} />
                <span>{sel.distance ?? 32}m</span>
              </label>
              <label>Decay
                <input type="range" min="0.5" max="2" step="0.1" value={sel.decay ?? 2} oninput={(e) => applyPatch({ decay: Number((e.target as HTMLInputElement).value) })} />
                <span>{(sel.decay ?? 2).toFixed(1)}</span>
              </label>
              <p class="hint">Bulb position (local to lantern — moves with yaw)</p>
              <label>Bulb X
                <input type="range" min="-3" max="3" step="0.05" value={sel.lightOffsetX ?? 0} oninput={(e) => applyPatch({ lightOffsetX: Number((e.target as HTMLInputElement).value) })} />
                <input type="number" step="0.05" value={sel.lightOffsetX ?? 0} onchange={(e) => applyPatch({ lightOffsetX: Number((e.target as HTMLInputElement).value) })} />
              </label>
              <label>Bulb Y
                <input type="range" min="0" max="5" step="0.05" value={sel.lightOffsetY ?? 2.55} oninput={(e) => applyPatch({ lightOffsetY: Number((e.target as HTMLInputElement).value) })} />
                <input type="number" step="0.05" value={sel.lightOffsetY ?? 2.55} onchange={(e) => applyPatch({ lightOffsetY: Number((e.target as HTMLInputElement).value) })} />
              </label>
              <label>Bulb Z
                <input type="range" min="-3" max="3" step="0.05" value={sel.lightOffsetZ ?? 0} oninput={(e) => applyPatch({ lightOffsetZ: Number((e.target as HTMLInputElement).value) })} />
                <input type="number" step="0.05" value={sel.lightOffsetZ ?? 0} onchange={(e) => applyPatch({ lightOffsetZ: Number((e.target as HTMLInputElement).value) })} />
              </label>
            {/if}
          {/if}
        {:else if sel.kind === "light"}
          <label>Color <input type="color" value={sel.color ?? "#ff9933"} onchange={(e) => applyPatch({ color: (e.target as HTMLInputElement).value })} /></label>
          <label>Intensity
            <input type="range" min="0.2" max="40" step="0.2" value={sel.intensity ?? 8} oninput={(e) => applyPatch({ intensity: Number((e.target as HTMLInputElement).value) })} />
            <span>{sel.intensity ?? 8}</span>
          </label>
          <label>Distance
            <input type="range" min="5" max="250" step="5" value={sel.distance ?? 80} oninput={(e) => applyPatch({ distance: Number((e.target as HTMLInputElement).value) })} />
            <span>{sel.distance ?? 80}m</span>
          </label>
          <label>Decay
            <input type="range" min="0.5" max="2" step="0.1" value={sel.decay ?? 1} oninput={(e) => applyPatch({ decay: Number((e.target as HTMLInputElement).value) })} />
            <span>{(sel.decay ?? 1).toFixed(1)}</span>
          </label>
          <p class="hint">Lower decay = light carries farther. Distance is the hard cutoff.</p>
        {:else if sel.kind === "fog"}
          <label>Color <input type="color" value={sel.color ?? "#c8dce8"} onchange={(e) => applyPatch({ color: (e.target as HTMLInputElement).value })} /></label>
          <label>Shape
            <select value={sel.fogShape ?? "sphere"} onchange={(e) => applyPatch({ fogShape: (e.target as HTMLSelectElement).value as "sphere" | "box" })}>
              <option value="sphere">Sphere</option>
              <option value="box">Box</option>
            </select>
          </label>
          <label>Size X
            <input type="range" min="2" max="80" step="1" value={sel.sizeX ?? 14} oninput={(e) => applyPatch({ sizeX: Number((e.target as HTMLInputElement).value) })} />
            <span>{sel.sizeX ?? 14}m</span>
          </label>
          <label>Size Y
            <input type="range" min="2" max="80" step="1" value={sel.sizeY ?? 10} oninput={(e) => applyPatch({ sizeY: Number((e.target as HTMLInputElement).value) })} />
            <span>{sel.sizeY ?? 10}m</span>
          </label>
          <label>Size Z
            <input type="range" min="2" max="80" step="1" value={sel.sizeZ ?? 14} oninput={(e) => applyPatch({ sizeZ: Number((e.target as HTMLInputElement).value) })} />
            <span>{sel.sizeZ ?? 14}m</span>
          </label>
          <label>Density
            <input type="range" min="0.05" max="1" step="0.05" value={sel.fogDensity ?? 0.55} oninput={(e) => applyPatch({ fogDensity: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label>Opacity
            <input type="range" min="0.05" max="1" step="0.05" value={sel.fogOpacity ?? 0.5} oninput={(e) => applyPatch({ fogOpacity: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label>Feather
            <input type="range" min="0" max="1" step="0.05" value={sel.fogFeather ?? 0.7} oninput={(e) => applyPatch({ fogFeather: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <p class="hint">Delete removes the volume. Move with the gizmo like any other asset.</p>
        {:else if sel.kind === "barrier"}
          <label>Yaw <input type="number" step="0.01" value={sel.yaw} onchange={(e) => applyPatch({ yaw: Number((e.target as HTMLInputElement).value) })} /></label>
          <label>Size X
            <input type="range" min="0.5" max="80" step="0.5" value={sel.sizeX ?? 6} oninput={(e) => applyPatch({ sizeX: Number((e.target as HTMLInputElement).value) })} />
            <span>{sel.sizeX ?? 6}m</span>
          </label>
          <label>Size Y
            <input type="range" min="0.5" max="40" step="0.5" value={sel.sizeY ?? 4} oninput={(e) => applyPatch({ sizeY: Number((e.target as HTMLInputElement).value) })} />
            <span>{sel.sizeY ?? 4}m</span>
          </label>
          <label>Size Z
            <input type="range" min="0.5" max="40" step="0.5" value={sel.sizeZ ?? 1.25} oninput={(e) => applyPatch({ sizeZ: Number((e.target as HTMLInputElement).value) })} />
            <span>{sel.sizeZ ?? 1.25}m</span>
          </label>
          <p class="hint">Invisible in-game — blocks player movement. Drag the yellow corner / side handles to reshape; Move/Rotate gizmos still reposition it.</p>
        {:else if sel.kind === "cloud"}
          <label>Yaw <input type="number" step="0.01" value={sel.yaw} onchange={(e) => applyPatch({ yaw: Number((e.target as HTMLInputElement).value) })} /></label>
          <label>Color <input type="color" value={sel.color ?? "#eef2f8"} onchange={(e) => applyPatch({ color: (e.target as HTMLInputElement).value })} /></label>
          <label>Shape
            <select value={sel.cloudShape ?? "cumulus"} onchange={(e) => applyPatch({ cloudShape: (e.target as HTMLSelectElement).value as "cumulus" | "wispy" | "flat" })}>
              <option value="cumulus">Cumulus</option>
              <option value="wispy">Wispy</option>
              <option value="flat">Flat</option>
            </select>
          </label>
          <label>Opacity
            <input type="range" min="0.05" max="1" step="0.05" value={sel.cloudOpacity ?? 0.85} oninput={(e) => applyPatch({ cloudOpacity: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label>Scale X
            <input type="range" min="0.2" max="4" step="0.05" value={sel.scaleX ?? 1} oninput={(e) => applyPatch({ scaleX: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label>Scale Y
            <input type="range" min="0.1" max="3" step="0.05" value={sel.scaleY ?? 1} oninput={(e) => applyPatch({ scaleY: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label>Scale Z
            <input type="range" min="0.2" max="4" step="0.05" value={sel.scaleZ ?? 1} oninput={(e) => applyPatch({ scaleZ: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label>Drift Speed
            <input type="range" min="0" max="4" step="0.1" value={sel.driftSpeed ?? 1.2} oninput={(e) => applyPatch({ driftSpeed: Number((e.target as HTMLInputElement).value) })} />
            <span>{(sel.driftSpeed ?? 1.2).toFixed(1)} m/s</span>
          </label>
          <label>Bob Amplitude
            <input type="range" min="0" max="2" step="0.05" value={sel.bobAmp ?? 0.4} oninput={(e) => applyPatch({ bobAmp: Number((e.target as HTMLInputElement).value) })} />
            <span>{(sel.bobAmp ?? 0.4).toFixed(2)}m</span>
          </label>
          <p class="hint">Clouds drift with region wind in playtest and at runtime.</p>
        {/if}
        {#if sel.markerKind === "resourceNode"}
          <label>Node Type
            <select value={sel.nodeType ?? "rock"} onchange={(e) => applyPatch({ nodeType: (e.target as HTMLSelectElement).value })}>
              {#each PLACEABLE_REGION_NODE_TYPES as typeId}
                <option value={typeId}>{nodeTypeDef(typeId).name}</option>
              {/each}
            </select>
          </label>
          {#if (sel.nodeType ?? "rock") === "tree"}
            <label>Tree Model
              <select value={sel.nodeModel ?? ""} onchange={(e) => applyPatch({ nodeModel: (e.target as HTMLSelectElement).value })}>
                {#each (REGION_TREE_BRUSH[biome] ?? REGION_TREE_BRUSH.grassland) as model}
                  <option value={model}>{model.replace(/\.(glb|gltf)$/i, "")}</option>
                {/each}
              </select>
            </label>
          {/if}
          <p class="hint">Trees use real foliage models (random when placed). Right-click a placed tree to assign it as a resource.</p>
        {:else if sel.markerKind === "mobSpawn"}
          <label>Difficulty
            <input type="range" min="0.5" max="3" step="0.1" value={sel.difficulty ?? 1} oninput={(e) => applyPatch({ difficulty: Number((e.target as HTMLInputElement).value) })} />
            <span>{(sel.difficulty ?? 1).toFixed(1)}x</span>
          </label>
          <label>Mob Type
            <select value={sel.mobType ?? ""} onchange={(e) => applyPatch({ mobType: (e.target as HTMLSelectElement).value })}>
              <option value="">Biome random</option>
              {#each Object.values(MOBS) as mob}
                <option value={mob.id}>{mob.name}</option>
              {/each}
            </select>
          </label>
          <p class="hint">Difficulty scales mob HP and damage at runtime.</p>
        {:else if sel.markerKind === "village"}
          <label>Name <input type="text" value={sel.name} onchange={(e) => applyPatch({ name: (e.target as HTMLInputElement).value })} /></label>
          <label>Radius <input type="number" step="1" value={sel.radius} onchange={(e) => applyPatch({ radius: Number((e.target as HTMLInputElement).value) })} /></label>
          <button class="build-village-btn" onclick={() => scene?.buildVillageAroundMarker(sel.id)}>🏰 Build Village Here</button>
        {:else if sel.markerKind === "worldEvent"}
          <label>Event Name <input type="text" value={sel.name ?? "World Event"} onchange={(e) => applyPatch({ name: (e.target as HTMLInputElement).value })} /></label>
          <label>Radius (m)
            <input type="number" min="10" max="120" step="1" value={sel.radius ?? 40} onchange={(e) => applyPatch({ radius: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label>Frequency (min)
            <input type="number" min="1" max="180" step="1" value={sel.frequencyMin ?? 15} onchange={(e) => applyPatch({ frequencyMin: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label>Difficulty
            <input type="range" min="0.5" max="3" step="0.1" value={sel.difficulty ?? 1} oninput={(e) => applyPatch({ difficulty: Number((e.target as HTMLInputElement).value) })} />
            <span>{(sel.difficulty ?? 1).toFixed(1)}x</span>
          </label>
          <label>Loot Amount
            <input type="range" min="0.5" max="3" step="0.1" value={sel.lootAmount ?? 1} oninput={(e) => applyPatch({ lootAmount: Number((e.target as HTMLInputElement).value) })} />
            <span>{(sel.lootAmount ?? 1).toFixed(1)}x</span>
          </label>
          <label>Duration (sec)
            <input type="number" min="60" max="1800" step="30" value={sel.durationSec ?? 600} onchange={(e) => applyPatch({ durationSec: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label>Wave Mobs
            <select multiple size="6" value={sel.mobTypes ?? ["wolf"]} onchange={(e) => {
              const opts = [...(e.target as HTMLSelectElement).selectedOptions].map((o) => o.value);
              applyPatch({ mobTypes: opts.length > 0 ? opts : ["wolf"] });
            }}>
              {#each Object.values(MOBS) as mob}
                <option value={mob.id} selected={(sel.mobTypes ?? []).includes(mob.id)}>{mob.name} ({mob.id})</option>
              {/each}
            </select>
          </label>
          <label>Boss (optional)
            <select value={sel.bossType ?? ""} onchange={(e) => applyPatch({ bossType: (e.target as HTMLSelectElement).value })}>
              <option value="">— none —</option>
              {#each Object.values(MOBS) as mob}
                <option value={mob.id}>{mob.name} ({mob.id})</option>
              {/each}
            </select>
          </label>
        {:else if sel.markerKind === "poi"}
          <label>Name <input type="text" value={sel.name ?? "Point of Interest"} onchange={(e) => applyPatch({ name: (e.target as HTMLInputElement).value })} /></label>
          <label>Landmark Model
            <select
              value={sel.poiModel ?? ""}
              onchange={(e) => {
                const val = (e.target as HTMLSelectElement).value;
                if (!val) {
                  applyPatch({ poiModel: undefined, poiCategory: undefined });
                } else {
                  const preset = POI_LANDMARK_PRESETS.find((p) => p.model === val || p.id === val);
                  if (preset) {
                    applyPatch({
                      poiModel: preset.model,
                      poiCategory: preset.category,
                      scale: preset.defaultScale ?? sel.scale ?? 1,
                    });
                  } else {
                    applyPatch({ poiModel: val });
                  }
                }
              }}
            >
              <option value="">— None (Teal Sphere Gizmo) —</option>
              <optgroup label="Landmark Presets">
                {#each POI_LANDMARK_PRESETS as preset}
                  <option value={preset.model}>{preset.name}</option>
                {/each}
              </optgroup>
              {#if armedModel && !POI_LANDMARK_PRESETS.some((p) => p.model === armedModel)}
                <optgroup label="Armed Palette Asset">
                  <option value={armedModel}>Asset: {regionAssetDisplayName(armedModel)}</option>
                </optgroup>
              {/if}
            </select>
          </label>
          {#if sel.poiModel}
            <div class="field-row">
              <label>Scale
                <input
                  type="range"
                  min="0.2"
                  max="4.0"
                  step="0.1"
                  value={sel.scale ?? 1}
                  oninput={(e) => applyPatch({ scale: Number((e.target as HTMLInputElement).value) })}
                />
                <span>{(sel.scale ?? 1).toFixed(1)}x</span>
              </label>
            </div>
            <div class="field-row">
              <label>Yaw (deg)
                <input
                  type="range"
                  min="0"
                  max="360"
                  step="5"
                  value={Math.round((((sel.yaw ?? 0) * 180) / Math.PI + 360) % 360)}
                  oninput={(e) => applyPatch({ yaw: (Number((e.target as HTMLInputElement).value) * Math.PI) / 180 })}
                />
                <span>{Math.round((((sel.yaw ?? 0) * 180) / Math.PI + 360) % 360)}°</span>
              </label>
            </div>
          {/if}
          <label>Interact Radius (m)
            <input type="number" min="2" max="20" step="1" value={sel.interactRadius ?? 6} onchange={(e) => applyPatch({ interactRadius: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <div class="field-row">
            <span class="field-label">Reveal Boundary</span>
            <span class="shape-summary">{sel.revealShape?.length ?? 0} points (octagon default)</span>
          </div>
          <button type="button" class="rc-btn" onclick={() => void openContinentMap(sel.id)}>Draw Boundary…</button>
          <label>Reward XP
            <input type="number" min="0" max="500" step="5" value={sel.rewardXp ?? 25} onchange={(e) => applyPatch({ rewardXp: Number((e.target as HTMLInputElement).value) })} />
          </label>
          <label>Description
            <textarea rows="3" value={sel.description ?? ""} onchange={(e) => applyPatch({ description: (e.target as HTMLTextAreaElement).value })}></textarea>
          </label>
          <p class="hint">Interacting within Interact Radius permanently reveals the hand-drawn Boundary on the minimap/world map for that character, grants Reward XP, and plays a short camera pan. Draw or redraw the boundary in the Continent Layout Map.</p>
        {:else if sel.markerKind === "portal"}
          <label>Portal Label <input type="text" value={sel.name ?? "Portal to Region"} onchange={(e) => applyPatch({ name: (e.target as HTMLInputElement).value })} /></label>
          <label>Destination
            <select value={sel.targetRegionId ?? ""} onchange={(e) => applyPatch({ targetRegionId: (e.target as HTMLSelectElement).value })}>
              <option value="">— pick a region —</option>
              {#each regionList.filter((r) => r.id !== regionId) as r}
                <option value={r.id}>{r.name}</option>
              {/each}
            </select>
          </label>
        {:else if sel.markerKind === "npc"}
          <label>NPC Name <input type="text" value={sel.npcData?.name ?? sel.name} onchange={(e) => applyPatch({ name: (e.target as HTMLInputElement).value, npcData: { ...sel.npcData!, name: (e.target as HTMLInputElement).value } })} /></label>
          <label>Title <input type="text" value={sel.npcData?.title ?? "<Questgiver>"} onchange={(e) => applyPatch({ npcData: { ...sel.npcData!, title: (e.target as HTMLInputElement).value } })} /></label>
          <label>Vendor Type
            <select value={sel.npcData?.vendorId ?? ""} onchange={(e) => applyPatch({ npcData: { ...sel.npcData!, vendorId: (e.target as HTMLSelectElement).value || undefined } })}>
              <option value="">— None (Quest Giver) —</option>
              {#each Object.values(VENDORS) as v}
                <option value={v.id}>{v.name} — {v.title}</option>
              {/each}
            </select>
          </label>
          <label>Model
            <select value={sel.npcData?.model ?? "Knight"} onchange={(e) => applyPatch({ npcData: { ...sel.npcData!, model: (e.target as HTMLSelectElement).value } })}>
              <option value="Knight">Knight</option>
              <option value="Mage">Mage</option>
              <option value="Barbarian">Barbarian</option>
              <option value="Ranger">Ranger</option>
              <option value="Rogue">Rogue</option>
              <option value="Druid">Druid</option>
              <option value="Paladin">Paladin</option>
              <option value="Engineer">Engineer</option>
              <option value="Barbarian_Large">Barbarian (Large)</option>
              <option value="Rogue_Hooded">Rogue (Hooded)</option>
            </select>
          </label>
          <label>Dialogue
            <textarea rows="2" value={sel.npcData?.dialogue ?? ""} onchange={(e) => applyPatch({ npcData: { ...sel.npcData!, dialogue: (e.target as HTMLTextAreaElement).value } })}></textarea>
          </label>

          {#if sel.npcData?.vendorId}
            <p class="hint">This NPC is a merchant. Interacting opens the vendor shop; quests are disabled.</p>
          {:else}
          <div class="quest-section">
            <div class="quest-header">
              <h4>📜 Quests Offered</h4>
              <button class="add-quest-btn" onclick={() => addQuestToNPC(sel)}>+ Add Quest</button>
            </div>

            <label class="procedural-toggle">
              <input type="checkbox" checked={sel.npcData?.generateProceduralQuests ?? true} onchange={(e) => applyPatch({ npcData: { ...sel.npcData!, generateProceduralQuests: (e.target as HTMLInputElement).checked } })} />
              <span>Generate Procedural Quests</span>
            </label>

            {#each sel.npcData?.quests ?? [] as quest, qIdx (quest.id)}
              <div class="quest-card">
                <div class="quest-card-header">
                  <strong>{quest.name}</strong>
                  <button class="quest-del-btn" onclick={() => deleteQuestFromNPC(sel, quest.id)}>✕</button>
                </div>
                <label>Quest Name <input type="text" value={quest.name} onchange={(e) => updateQuestInNPC(sel, qIdx, { name: (e.target as HTMLInputElement).value })} /></label>
                <label>Description <input type="text" value={quest.description} onchange={(e) => updateQuestInNPC(sel, qIdx, { description: (e.target as HTMLInputElement).value })} /></label>
                <label>Type
                  <select value={quest.objectiveKind} onchange={(e) => updateQuestInNPC(sel, qIdx, { objectiveKind: (e.target as HTMLSelectElement).value as RegionQuestObjectiveKind })}>
                    <option value="kill">Kill Mobs</option>
                    <option value="gather">Gather Items</option>
                    <option value="escort">Escort / Follow Me</option>
                  </select>
                </label>
                <label>Target {quest.objectiveKind === "kill" ? "Mob ID" : quest.objectiveKind === "gather" ? "Item ID" : "Destination Label"}
                  <input type="text" value={quest.objectiveTarget} onchange={(e) => updateQuestInNPC(sel, qIdx, { objectiveTarget: (e.target as HTMLInputElement).value })} />
                </label>
                {#if quest.objectiveKind !== "escort"}
                  <label>Count <input type="number" min="1" max="100" value={quest.objectiveCount} onchange={(e) => updateQuestInNPC(sel, qIdx, { objectiveCount: Number((e.target as HTMLInputElement).value) })} /></label>
                {/if}
                <label>XP Reward <input type="number" min="10" max="5000" value={quest.rewardXp} onchange={(e) => updateQuestInNPC(sel, qIdx, { rewardXp: Number((e.target as HTMLInputElement).value) })} /></label>

                {#if quest.objectiveKind === "escort"}
                  <div class="escort-path-box">
                    <button
                      class="trace-btn"
                      class:active={scene?.activeEscortQuest?.questId === quest.id}
                      onclick={() => toggleEscortPathTracing(sel, quest.id)}
                    >
                      {scene?.activeEscortQuest?.questId === quest.id ? "⏹ Stop Tracing" : "📍 Trace Escort Path"} ({quest.waypoints?.length ?? 0} waypoints)
                    </button>
                    {#if quest.waypoints && quest.waypoints.length > 0}
                      <div class="waypoint-list">
                        {#each quest.waypoints as wp, wpIdx}
                          <div class="wp-tag" class:active={scene?.selectedWaypointIndex === wpIdx}>
                            <button class="wp-select-btn" onclick={() => scene?.selectWaypoint(wpIdx)}>
                              📍 WP #{wpIdx + 1}: ({wp.x}, {wp.z})
                            </button>
                            <button class="wp-del-btn" onclick={() => scene?.removeEscortWaypoint(wpIdx)} title="Delete Waypoint">✕</button>
                          </div>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
          {/if}
        {/if}
        {#if sel.kind === "asset" && sel.category === "foliage"}
          <button class="build-village-btn" onclick={() => scene?.convertSelectedFoliageToResourceNodes()}>
            Assign as Resource Node
          </button>
        {/if}
        {#if sel.markerKind !== "entry"}
          <button class="delete" onclick={deleteSelected}>Delete</button>
        {/if}
      </div>
    {:else if selection.length > 1}
      <div class="properties">
        {#if selection.every((s) => s.groupId && s.groupId === selection[0]?.groupId)}
          <h3>Group ({selection.length} pieces)</h3>
          <p class="hint">Move / rotate / scale moves the whole group. ⌘G group · ⇧⌘G ungroup.</p>
        {:else}
          <h3>{selection.length} Items Selected</h3>
          {#if selection.filter((s) => s.kind === "asset").length >= 2}
            <p class="hint">⌘G groups selected assets so they select and move together.</p>
          {/if}
        {/if}
        {#if selection.some((s) => s.kind === "asset")}
          <label>
            <input
              type="checkbox"
              checked={selection.filter((s) => s.kind === "asset").every((s) => s.solid)}
              onchange={(e) => applyPatch({ solid: (e.target as HTMLInputElement).checked })}
            />
            Solid (walkable)
          </label>
        {/if}
        {#if selection.some((s) => s.kind === "asset" && s.category === "foliage")}
          <button class="build-village-btn" onclick={() => scene?.convertSelectedFoliageToResourceNodes()}>
            Assign Trees as Resources
          </button>
        {/if}
        {#if selection.filter((s) => s.kind === "asset").length >= 2}
          <button class="build-village-btn" onclick={() => scene?.groupSelectedAssets()}>
            Group (⌘G)
          </button>
        {/if}
        {#if selection.some((s) => s.kind === "asset" && s.groupId)}
          <button class="build-village-btn" onclick={() => scene?.ungroupSelectedAssets()}>
            Ungroup (⇧⌘G)
          </button>
        {/if}
        <button class="delete" onclick={deleteSelected}>Delete All</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .editor {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
    background: #14161c;
    color: #dce6f2;
    font-size: 13px;
    pointer-events: auto;
  }
  .menubar-shell {
    display: flex;
    flex-direction: column;
    background: #181b22;
    border-bottom: 1px solid #2a2f3d;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    z-index: 100;
    flex-shrink: 0;
  }
  .menubar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px 8px;
    min-height: 28px;
    background: #151820;
    border-bottom: 1px solid #242936;
    flex-wrap: wrap;
  }
  .app-brand {
    font-size: 12px;
    font-weight: 650;
    color: #94a3b8;
    padding: 0 10px 0 4px;
    margin-right: 4px;
    border-right: 1px solid #2a3140;
    white-space: nowrap;
  }
  .menu-group {
    position: relative;
  }
  .menu-top {
    background: transparent;
    border: none;
    color: #cbd5e1;
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }
  .menu-top:hover,
  .menu-top.open,
  .menu-top.lit {
    background: #2a3244;
    color: #f8fafc;
  }
  .menu-top.lit {
    color: #f0d060;
  }
  .menu-panel {
    position: absolute;
    top: calc(100% + 2px);
    left: 0;
    min-width: 200px;
    max-height: min(70vh, 520px);
    overflow-y: auto;
    background: #1a1e27;
    border: 1px solid #333d52;
    border-radius: 8px;
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.55);
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 1px;
    z-index: 300;
  }
  .menu-panel.wide {
    min-width: 260px;
    padding: 8px;
    gap: 6px;
  }
  .menu-panel.tools-panel {
    min-width: 220px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
    padding: 6px;
  }
  .menu-panel.tools-panel .menu-section {
    grid-column: 1 / -1;
  }
  .menu-panel.tools-panel button {
    font-size: 12px;
    padding: 5px 8px;
  }
  .menu-panel button {
    text-align: left;
    background: transparent;
    border: none;
    color: #cbd5e1;
    border-radius: 5px;
    padding: 6px 10px;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .menu-panel button:hover:not(:disabled) {
    background: #2a3244;
    color: #f8fafc;
  }
  .menu-panel button.active {
    background: #3a6ea8;
    color: #fff;
  }
  .menu-panel button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .menu-panel button.danger {
    color: #ff8a7a;
  }
  .menu-panel button.danger:hover:not(:disabled) {
    background: rgba(224, 68, 68, 0.2);
    color: #ffb0a4;
  }
  .delete-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 20000;
    background: rgba(0, 0, 0, 0.65);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .delete-modal {
    width: min(440px, 100%);
    background: #1a1e28;
    border: 1px solid #3a4152;
    border-radius: 8px;
    padding: 20px 22px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
    color: #dce6f2;
  }
  .delete-modal h3 {
    margin: 0 0 10px;
    font-size: 16px;
    color: #ffb0a4;
  }
  .delete-modal p {
    margin: 0 0 10px;
    line-height: 1.45;
  }
  .delete-modal .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    color: #9aa8bc;
    margin-left: 4px;
  }
  .delete-modal ul {
    margin: 0 0 12px;
    padding-left: 18px;
    color: #b7c3d4;
    line-height: 1.5;
  }
  .delete-modal li.warn,
  .delete-modal .warn-line {
    color: #f0c040;
  }
  .delete-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }
  .delete-modal-actions .cancel {
    background: #2a303c;
    color: #dce6f2;
    border: 1px solid #3a4152;
    border-radius: 4px;
    padding: 8px 14px;
    cursor: pointer;
  }
  .delete-modal-actions .confirm-delete {
    background: #e04444;
    color: #fff;
    border: none;
    border-radius: 4px;
    padding: 8px 14px;
    cursor: pointer;
    font-weight: 600;
  }
  .delete-modal-actions button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .delete-modal-actions .cancel:hover:not(:disabled) {
    background: #343b4a;
  }
  .delete-modal-actions .confirm-delete:hover:not(:disabled) {
    background: #c93636;
  }
  .menu-sep {
    height: 1px;
    background: #2a3140;
    margin: 4px 2px;
    grid-column: 1 / -1;
  }
  .menu-section {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #64748b;
    padding: 8px 8px 2px;
  }
  .accel {
    color: #64748b;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .menubar-spacer {
    flex: 1;
    min-width: 8px;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    flex-wrap: wrap;
    min-height: 36px;
  }
  .doc-select,
  .biome-select,
  .name-input {
    background: #0f1218;
    border: 1px solid #2d3445;
    color: #e2e8f0;
    border-radius: 5px;
    padding: 4px 8px;
    font-size: 12px;
    max-width: 160px;
  }
  .name-input {
    width: 110px;
    font-weight: 500;
  }
  .level-quick-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    background: #0f131a;
    border: 1px solid #3b485d;
    border-radius: 5px;
    padding: 2px 6px;
    font-size: 11px;
  }
  .level-quick-badge .lvl-label {
    color: #f59e0b;
    font-weight: 700;
    font-size: 10px;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .level-quick-badge .lvl-num-input {
    width: 28px;
    background: #181f2a;
    border: 1px solid #2d3748;
    color: #f1f5f9;
    border-radius: 3px;
    padding: 1px 3px;
    font-size: 11px;
    font-weight: 600;
    text-align: center;
  }
  .level-quick-badge .lvl-num-input:focus {
    outline: none;
    border-color: #f59e0b;
  }
  .level-quick-badge .lvl-sep {
    color: #64748b;
    font-weight: 600;
  }
  .dim-quick-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: #0f172a;
    border: 1px solid #334155;
    border-radius: 5px;
    padding: 2px 7px;
    font-size: 11px;
    color: #38bdf8;
    font-weight: 600;
  }
  .dim-quick-badge .dim-icon {
    font-size: 11px;
  }
  .dim-card {
    background: #0b1120;
    border: 1px solid #1e293b;
    border-radius: 6px;
    padding: 8px 10px;
    margin: 4px 6px 8px;
  }
  .dim-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
  }
  .dim-card-title {
    color: #94a3b8;
    font-weight: 500;
  }
  .dim-card-meters {
    color: #38bdf8;
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 0.3px;
  }
  .dim-card-sub {
    font-size: 10px;
    color: #64748b;
    margin-top: 2px;
  }
  .level-presets-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px 6px 8px;
  }
  .level-preset-chip {
    background: #181f2a;
    border: 1px solid #2e3a4e;
    color: #cbd5e1;
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .level-preset-chip:hover {
    background: #243044;
    color: #fff;
    border-color: #f59e0b;
  }
  .level-preset-chip.active {
    background: #78350f;
    border-color: #f59e0b;
    color: #fef3c7;
  }
  .save-btn {
    background: #2f5d3a;
    border: 1px solid #4a8f55;
    color: #f0fdf4;
    border-radius: 5px;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .save-btn:hover {
    background: #3a7348;
  }
  .segmented-control {
    display: flex;
    background: #0f1218;
    border: 1px solid #2a2f3d;
    border-radius: 6px;
    padding: 2px;
    gap: 2px;
  }
  .segmented-control button {
    background: transparent;
    border: none;
    color: #94a3b8;
    border-radius: 4px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: all 0.15s;
  }
  .segmented-control button:hover {
    color: #f1f5f9;
    background: rgba(255, 255, 255, 0.05);
  }
  .segmented-control button.active {
    background: #3a6ea8;
    color: #ffffff;
    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
  }
  .tool-chip {
    background: #202531;
    border: 1px solid #323a4d;
    color: #cbd5e1;
    border-radius: 6px;
    padding: 5px 10px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
  }
  .tool-chip:hover:not(:disabled) {
    background: #2a3142;
    color: #f1f5f9;
  }
  .tool-chip.active {
    background: #3a6ea8;
    border-color: #5c8fc9;
    color: #fff;
  }
  .tool-chip:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .v-divider {
    width: 1px;
    height: 20px;
    background: #2a2f3d;
    margin: 0 4px;
  }
  .menu-panel.settings-panel {
    min-width: 240px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .menu-field {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #94a3b8;
    padding: 4px 0;
  }
  .menu-field.checkbox-field {
    justify-content: flex-start;
  }
  .menu-field input[type="range"] {
    width: 90px;
  }
  .menu-field input[type="number"],
  .menu-field input[type="text"],
  .menu-field select {
    width: 120px;
    max-width: 55%;
    background: #0f1218;
    border: 1px solid #2d3445;
    color: #e2e8f0;
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 12px;
  }
  .menu-field .readout {
    font-size: 11px;
    color: #64748b;
    min-width: 28px;
  }
  .menu-action {
    margin-top: 4px;
    background: #252d3d !important;
    border: 1px solid #3b4760 !important;
    text-align: center !important;
    font-weight: 500;
    justify-content: center !important;
  }
  .playtest-btn {
    background: #16a34a;
    border: 1px solid #22c55e;
    color: #ffffff;
    border-radius: 5px;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .playtest-btn:hover {
    background: #15803d;
  }
  .playtest-btn.active {
    background: #dc2626;
    border-color: #ef4444;
  }
  .context-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 6px 16px;
    background: #1e2430;
    border-bottom: 1px solid #384359;
    box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
    z-index: 90;
  }
  .context-title {
    font-size: 13px;
    color: #cbd5e1;
  }
  .context-title strong {
    color: #38bdf8;
  }
  .context-fields {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .context-field {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: #94a3b8;
  }
  .context-field input[type="range"] {
    width: 100px;
  }
  .context-field span {
    color: #e2e8f0;
    font-size: 12px;
    font-weight: 500;
    min-width: 28px;
  }
  .context-close {
    background: #333d52;
    border: 1px solid #475569;
    color: #cbd5e1;
    border-radius: 4px;
    padding: 3px 10px;
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .context-close:hover {
    background: #475569;
    color: #ffffff;
  }
  .hidden-file {
    display: none;
  }
  .status {
    color: #8fa3ba;
    font-size: 11px;
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @media (max-width: 900px) {
    .app-brand {
      display: none;
    }
    .status {
      display: none;
    }
    .name-input {
      width: 80px;
    }
  }
  .body {
    flex: 1;
    display: flex;
    min-height: 0;
    position: relative;
  }
  .palette {
    width: 240px;
    flex-shrink: 0;
    overflow-y: auto;
    background: #1a1d24;
    border-right: 1px solid #333a48;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .palette-tools-title {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #38bdf8;
    padding: 4px 4px 2px;
  }
  .palette-explorer-btn {
    width: 100%;
    text-align: center;
    background: #243044;
    border: 1px solid #3a5478;
    color: #d7e7ff;
    border-radius: 5px;
    padding: 7px 8px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
  }
  .palette-explorer-btn:hover {
    background: #2d3d56;
  }
  .palette-packs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 2px 0 4px;
  }
  .palette-pack-chip {
    background: #222836;
    border: 1px solid #323a4a;
    color: #c5d0e0;
    border-radius: 999px;
    padding: 3px 8px;
    font-size: 10px;
    cursor: pointer;
    line-height: 1.3;
  }
  .palette-pack-chip.active {
    background: #2f6fad;
    border-color: #5c8fc9;
    color: #fff;
  }
  .palette-search input {
    width: 100%;
    box-sizing: border-box;
    background: #0e141d;
    border: 1px solid #3a4152;
    color: #dce6f2;
    border-radius: 4px;
    padding: 6px 8px;
    font-size: 12px;
  }
  .palette-search input:focus {
    outline: none;
    border-color: #5c8fc9;
  }
  .palette-empty {
    margin: 8px 4px;
    font-size: 12px;
    color: #8fa3ba;
  }
  .palette-group-header {
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    color: #aebccf;
    padding: 6px 4px;
    cursor: pointer;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .palette-count {
    margin-left: auto;
    font-size: 10px;
    font-weight: 500;
    color: #6b7a90;
  }
  .palette-items {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-bottom: 6px;
  }
  .palette-items button {
    text-align: left;
    background: #20242e;
    border: 1px solid #2c313d;
    color: #cdd8e6;
    border-radius: 3px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .palette-items button.active {
    background: #3a6ea8;
    border-color: #5c8fc9;
  }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    border: 0;
  }
  .viewport {
    flex: 1;
    display: block;
    width: 0;
    min-width: 0;
    height: 100%;
  }
  .marquee {
    position: fixed;
    border: 1px solid #4a90e2;
    background: rgba(74, 144, 226, 0.2);
    pointer-events: none;
    z-index: 1000;
  }
  .properties,
  .color-panel {
    position: absolute;
    top: 50px;
    right: 16px;
    width: 240px;
    background: rgba(26, 29, 36, 0.95);
    border: 1px solid #333a48;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 200;
    backdrop-filter: blur(4px);
    pointer-events: auto;
  }
  .color-panel {
    top: 16px;
    left: 236px;
    right: auto;
  }
  .grass-settings-panel {
    width: 300px;
    max-height: calc(100% - 32px);
    overflow-y: auto;
    left: auto;
    right: 16px;
    top: 56px;
  }
  .grass-panel-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .grass-panel-head h3 {
    flex: 1;
    margin: 0;
  }
  .grass-close {
    background: none;
    border: none;
    color: #9aa3b2;
    cursor: pointer;
    font-size: 14px;
  }
  .grass-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 4px;
  }
  .grass-presets .chip {
    font-size: 11px;
    padding: 4px 8px;
    border-radius: 12px;
    border: 1px solid #3a4250;
    background: rgba(255, 255, 255, 0.05);
    color: #dce6f2;
    cursor: pointer;
  }
  .grass-presets .chip:hover {
    border-color: #8fd48f;
    color: #8fd48f;
  }
  .grass-presets .chip.reset {
    margin-left: auto;
    color: #9aa3b2;
  }
  .properties h3,
  .color-panel h3 {
    margin: 0 0 6px;
    font-size: 14px;
    word-break: break-word;
  }
  .properties .hint {
    margin: 0 0 10px;
    font-size: 11px;
    opacity: 0.7;
    line-height: 1.35;
  }
  .properties .shape-summary {
    font-size: 12px;
    opacity: 0.8;
  }
  .properties .field-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 4px;
  }
  .properties .field-label {
    font-size: 12px;
    opacity: 0.85;
  }
  .properties label,
  .color-panel label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
  }
  .properties input,
  .color-panel input {
    width: 110px;
    background: #0e141d;
    border: 1px solid #3a4152;
    color: #dce6f2;
    border-radius: 3px;
    padding: 3px 6px;
  }
  .properties .build-village-btn {
    margin-top: 4px;
    background: #3b82f6;
    color: #ffffff;
    border: 1px solid #60a5fa;
    border-radius: 4px;
    padding: 6px 10px;
    cursor: pointer;
    font-weight: 600;
    transition: background 0.15s;
  }
  .properties .build-village-btn:hover {
    background: #2563eb;
  }
  .properties .delete {
    margin-top: 10px;
    background: #e04444;
    color: #fff;
    padding: 6px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
  .editor-context-menu {
    position: fixed;
    z-index: 10000;
    min-width: 180px;
    background: rgba(16, 20, 28, 0.98);
    border: 1px solid #3a4152;
    border-radius: 6px;
    padding: 4px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.65);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .editor-context-title {
    font-size: 11px;
    letter-spacing: 0.4px;
    color: #8ec07c;
    padding: 6px 10px 4px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    margin-bottom: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 220px;
  }
  .editor-context-action {
    background: transparent;
    border: none;
    color: #dce6f2;
    text-align: left;
    font-size: 13px;
    padding: 8px 10px;
    border-radius: 4px;
    cursor: pointer;
  }
  .editor-context-action:hover {
    background: #2a3344;
  }
  .quest-section {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid #2e3545;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 380px;
    overflow-y: auto;
  }
  .quest-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .quest-header h4 {
    margin: 0;
    font-size: 13px;
    color: #33b5e5;
  }
  .add-quest-btn {
    background: #1d72aa;
    color: #ffffff;
    border: none;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  }
  .add-quest-btn:hover {
    background: #2389cd;
  }
  .procedural-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #a0aec0;
  }
  .quest-card {
    background: #1c212c;
    border: 1px solid #2d3748;
    border-radius: 6px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .quest-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: #f7fafc;
    border-bottom: 1px solid #2d3748;
    padding-bottom: 4px;
  }
  .quest-del-btn {
    background: transparent;
    border: none;
    color: #e53e3e;
    font-size: 12px;
    cursor: pointer;
  }
  .escort-path-box {
    margin-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .trace-btn {
    background: #2b6cb0;
    color: #fff;
    border: none;
    padding: 5px 8px;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
    text-align: center;
  }
  .trace-btn.active {
    background: #dd6b20;
  }
  .waypoint-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 120px;
    overflow-y: auto;
  }
  .wp-tag {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #1a202c;
    padding: 3px 6px;
    border-radius: 3px;
    font-size: 10px;
    color: #cbd5e0;
    border: 1px solid transparent;
  }
  .wp-tag.active {
    background: #4a1525;
    border-color: #ff3366;
  }
  .wp-select-btn {
    background: none;
    border: none;
    color: #cbd5e0;
    font-size: 10px;
    cursor: pointer;
    text-align: left;
    flex: 1;
  }
  .wp-tag.active .wp-select-btn {
    color: #ff99bb;
    font-weight: 600;
  }
  .wp-del-btn {
    background: none;
    border: none;
    color: #fc8181;
    cursor: pointer;
    font-size: 10px;
  }
  .playtest-hint {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(20, 22, 28, 0.75);
    border: 1px solid #3a3f52;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 12px;
    color: #dce6f2;
    pointer-events: none;
    z-index: 10;
  }

  .viewport-canvas-container {
    position: relative;
    flex: 1;
    height: 100%;
    overflow: hidden;
  }
  .viewport-canvas-container .viewport {
    width: 100%;
    height: 100%;
    display: block;
  }

  /* Photoshop-Style Floating Tool Palette sitting inside the canvas window */
  .photoshop-dock {
    position: absolute;
    left: 14px;
    top: 14px;
    z-index: 60;
    background: rgba(18, 22, 30, 0.88);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    width: 62px;
    padding: 6px;
    transition: width 0.2s ease, padding 0.2s ease;
    user-select: none;
  }
  .photoshop-dock.collapsed {
    width: 38px;
    padding: 4px;
  }
  .photoshop-dock-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 4px 6px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    margin-bottom: 4px;
  }
  .photoshop-dock-title {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.8px;
    color: #94a3b8;
  }
  .photoshop-dock.collapsed .photoshop-dock-title {
    display: none;
  }
  .photoshop-dock-toggle {
    background: transparent;
    border: none;
    color: #94a3b8;
    font-size: 11px;
    cursor: pointer;
    padding: 0 2px;
  }
  .photoshop-dock-toggle:hover {
    color: #f8fafc;
  }
  .photoshop-dock-buttons {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .photoshop-tool-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid transparent;
    border-radius: 6px;
    color: #cbd5e1;
    padding: 5px 2px;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .photoshop-tool-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
    border-color: rgba(255, 255, 255, 0.2);
  }
  .photoshop-tool-btn.active {
    background: rgba(184, 217, 74, 0.22);
    border-color: #b8d94a;
    color: #b8d94a;
    box-shadow: 0 0 10px rgba(184, 217, 74, 0.3);
  }
  .dock-icon {
    font-size: 16px;
    line-height: 1;
  }
  .dock-label {
    font-size: 8px;
    font-weight: 500;
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 48px;
  }
  .dock-sep {
    height: 1px;
    background: rgba(255, 255, 255, 0.08);
    margin: 2px 4px;
  }

  /* Searchable & Tabbed Tools Dropdown (Overriding grid layout) */
  .menu-panel.tools-panel.searchable-tools-panel {
    display: flex !important;
    flex-direction: column !important;
    grid-template-columns: none !important;
    width: 340px;
    min-width: 340px;
    max-height: min(75vh, 500px);
    padding: 0 !important;
    gap: 0 !important;
    overflow: hidden;
  }
  .tools-search-bar {
    position: relative;
    padding: 8px;
    background: #141720;
    border-bottom: 1px solid #2a3142;
    flex-shrink: 0;
    box-sizing: border-box;
  }
  .tools-search-input {
    width: 100%;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid #3a4459;
    border-radius: 6px;
    color: #f8fafc;
    font-size: 12px;
    padding: 6px 26px 6px 10px;
    box-sizing: border-box;
  }
  .tools-search-input:focus {
    outline: none;
    border-color: #3b82f6;
  }
  .tools-search-clear {
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: #94a3b8;
    font-size: 11px;
    cursor: pointer;
  }
  .tools-category-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 8px;
    background: #181c26;
    border-bottom: 1px solid #2a3142;
    flex-shrink: 0;
    box-sizing: border-box;
  }
  .tools-category-tabs button {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    color: #a0aec0;
    font-size: 10.5px;
    padding: 3px 8px;
    cursor: pointer;
    transition: all 0.12s;
  }
  .tools-category-tabs button:hover {
    color: #f8fafc;
    border-color: rgba(255, 255, 255, 0.2);
  }
  .tools-category-tabs button.active {
    background: #2563eb;
    border-color: #3b82f6;
    color: #ffffff;
    font-weight: 600;
  }
  .tools-filtered-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
    overflow-y: auto;
    max-height: 380px;
  }

  /* --- Top-bar & Menu Procedural World Generator Action --- */
  .generate-world-top-btn {
    background: linear-gradient(135deg, #935116 0%, #b7791f 50%, #d69e2e 100%);
    color: #fffbf0;
    border: 1px solid #f6e05e;
    border-radius: 4px;
    padding: 3px 10px;
    font-size: 11.5px;
    font-weight: 650;
    cursor: pointer;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7);
    box-shadow: 0 2px 6px rgba(183, 121, 31, 0.35);
    transition: all 0.15s ease;
    margin-right: 4px;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .generate-world-top-btn:hover {
    background: linear-gradient(135deg, #a45d1b 0%, #ca8a04 50%, #ecc94b 100%);
    box-shadow: 0 0 10px rgba(236, 201, 75, 0.55);
    transform: translateY(-1px);
  }
  .gen-world-action {
    color: #f6e05e !important;
    font-weight: 600;
  }

  /* --- Procedural World Generator Modal --- */
  .world-gen-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 20000;
    background: rgba(8, 10, 15, 0.82);
    backdrop-filter: blur(5px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    box-sizing: border-box;
  }

  .world-gen-modal {
    width: min(940px, 96vw);
    max-height: min(92vh, 880px);
    background: #151821;
    border: 1px solid #3c465c;
    border-radius: 10px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(255, 215, 0, 0.12);
    color: #dce6f2;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: modalFadeIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes modalFadeIn {
    from {
      opacity: 0;
      transform: scale(0.97) translateY(8px);
    }
    to {
      opacity: 1;
      transform: scale(1) translateY(0);
    }
  }

  .gen-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    background: linear-gradient(180deg, #1f2533 0%, #171b26 100%);
    border-bottom: 1px solid #2d3648;
    flex-shrink: 0;
  }

  .gen-header-title {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .gen-icon {
    font-size: 24px;
    line-height: 1;
    filter: drop-shadow(0 0 6px rgba(246, 224, 94, 0.6));
  }

  .gen-header h2 {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
    color: #f8fafc;
    letter-spacing: 0.2px;
  }

  .gen-subtitle {
    margin: 2px 0 0;
    font-size: 11.5px;
    color: #94a3b8;
    line-height: 1.35;
  }

  .gen-mode-tabs {
    display: flex;
    align-items: center;
    background: #11141c;
    border: 1px solid #2e374a;
    border-radius: 6px;
    padding: 2px;
    gap: 2px;
  }

  .gen-mode-tab {
    background: transparent;
    border: none;
    border-radius: 4px;
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 600;
    color: #94a3b8;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }
  .gen-mode-tab:hover {
    color: #f1f5f9;
  }
  .gen-mode-tab.active {
    background: #252e42;
    color: #fbbf24;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
  }

  .gen-close-btn {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #94a3b8;
    border-radius: 6px;
    width: 28px;
    height: 28px;
    font-size: 13px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.12s ease;
  }
  .gen-close-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
  }

  /* Continent Layout Pattern Cards */
  .continent-layout-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }
  @media (max-width: 820px) {
    .continent-layout-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  .layout-card {
    background: #181d28;
    border: 1px solid #2e374a;
    border-radius: 6px;
    padding: 10px 12px;
    text-align: left;
    cursor: pointer;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    transition: all 0.15s ease;
    user-select: none;
  }
  .layout-card:hover {
    background: #1e2433;
    border-color: #43516e;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
  .layout-card.selected {
    background: #1f2738;
    border-color: #f59e0b;
    box-shadow: 0 0 0 1px #f59e0b, 0 4px 16px rgba(245, 158, 11, 0.25);
  }

  .layout-icon {
    font-size: 22px;
    line-height: 1;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .layout-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  .layout-title {
    font-size: 12.5px;
    font-weight: 700;
    color: #f8fafc;
  }

  .layout-desc {
    font-size: 10.5px;
    color: #94a3b8;
    line-height: 1.35;
  }

  .gen-modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 18px 22px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    box-sizing: border-box;
  }

  .gen-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: rgba(22, 26, 36, 0.6);
    border: 1px solid #283042;
    border-radius: 8px;
    padding: 14px 16px;
  }

  .gen-section-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 6px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    padding-bottom: 6px;
  }

  .gen-section-title {
    font-size: 13px;
    font-weight: 700;
    color: #f1f5f9;
    letter-spacing: 0.3px;
    text-transform: uppercase;
  }

  .gen-section-hint {
    font-size: 11px;
    color: #818cf8;
  }

  /* Biome Grid (4x2) */
  .biome-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 10px;
  }
  @media (max-width: 820px) {
    .biome-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  .biome-card {
    background: #181d28;
    border: 1px solid #2e374a;
    border-radius: 6px;
    padding: 10px 11px;
    text-align: left;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: all 0.15s ease;
    position: relative;
    user-select: none;
  }
  .biome-card:hover {
    background: #1e2433;
    border-color: #43516e;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  }
  .biome-card.selected {
    background: #1f2738;
    border-color: #f59e0b;
    box-shadow: 0 0 0 1px #f59e0b, 0 4px 16px rgba(245, 158, 11, 0.25);
  }

  .biome-card-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .biome-card-icon {
    font-size: 20px;
    line-height: 1;
    flex-shrink: 0;
  }

  .biome-card-heading {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .biome-card-title {
    font-size: 12.5px;
    font-weight: 700;
    color: #f8fafc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .biome-card-badge {
    font-size: 10px;
    font-weight: 600;
    color: #f59e0b;
  }

  .biome-card-desc {
    font-size: 10.5px;
    color: #94a3b8;
    line-height: 1.35;
    flex: 1;
  }

  .biome-card-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 2px;
  }

  .biome-tag {
    font-size: 9.5px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 3px;
    padding: 1px 5px;
    color: #cbd5e1;
  }

  .other-biomes-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
    flex-wrap: wrap;
  }

  .other-biomes-label {
    font-size: 11px;
    color: #94a3b8;
  }

  .other-biome-chip {
    background: #181d28;
    border: 1px solid #2e374a;
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 11px;
    color: #cbd5e1;
    cursor: pointer;
    transition: all 0.12s;
  }
  .other-biome-chip:hover {
    background: #202738;
    color: #fff;
  }
  .other-biome-chip.active {
    background: #232c40;
    border-color: #f59e0b;
    color: #f59e0b;
    font-weight: 600;
  }

  /* Level Presets Row */
  .level-presets-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .level-chip {
    background: #181d28;
    border: 1px solid #2e374a;
    border-radius: 4px;
    padding: 5px 10px;
    font-size: 11px;
    font-weight: 500;
    color: #cbd5e1;
    cursor: pointer;
    transition: all 0.12s;
  }
  .level-chip:hover {
    background: #202838;
    color: #fff;
  }
  .level-chip.active {
    background: #1e3a8a;
    border-color: #3b82f6;
    color: #93c5fd;
    font-weight: 600;
  }

  .gen-row-inputs {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .gen-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 90px;
  }

  .gen-label {
    font-size: 10.5px;
    font-weight: 600;
    color: #94a3b8;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .gen-field input {
    background: #11141c;
    border: 1px solid #333c4e;
    border-radius: 4px;
    padding: 6px 8px;
    color: #f8fafc;
    font-size: 12px;
    font-weight: 600;
  }
  .gen-field input:focus {
    outline: none;
    border-color: #f59e0b;
  }

  .difficulty-banner {
    flex: 1;
    min-width: 220px;
    background: rgba(30, 41, 59, 0.6);
    border: 1px solid #334155;
    border-radius: 6px;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .diff-title {
    font-size: 12px;
    font-weight: 700;
    color: #fde047;
  }

  .diff-desc {
    font-size: 10.5px;
    color: #94a3b8;
  }

  /* Sliders Grid */
  .sliders-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }
  @media (max-width: 700px) {
    .sliders-grid {
      grid-template-columns: 1fr;
    }
  }

  .slider-box {
    background: #181d28;
    border: 1px solid #2a3344;
    border-radius: 6px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .slider-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .slider-label {
    font-size: 11.5px;
    font-weight: 650;
    color: #e2e8f0;
  }

  .slider-val {
    font-size: 11.5px;
    font-weight: 700;
    color: #f59e0b;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .slider-box input[type="range"] {
    accent-color: #f59e0b;
    cursor: pointer;
    margin: 4px 0 2px;
  }

  .slider-hint {
    font-size: 10px;
    color: #8590a6;
    line-height: 1.3;
  }

  /* Resource Variety Filters */
  .resource-variety-section {
    margin-top: 4px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .resource-variety-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .resource-variety-title {
    font-size: 11px;
    font-weight: 700;
    color: #cbd5e1;
    text-transform: uppercase;
  }

  .resource-variety-actions {
    display: flex;
    gap: 6px;
  }

  .variety-action-btn {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    padding: 2px 7px;
    font-size: 10px;
    color: #94a3b8;
    cursor: pointer;
  }
  .variety-action-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
  }

  .resource-chips-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }
  @media (max-width: 700px) {
    .resource-chips-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  .resource-chip {
    background: #181d28;
    border: 1px solid #2e374a;
    border-radius: 4px;
    padding: 5px 8px;
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    transition: all 0.12s;
    text-align: left;
    color: #94a3b8;
  }
  .resource-chip:hover {
    border-color: #4a5772;
    color: #cbd5e1;
  }
  .resource-chip.active {
    background: #1a273b;
    border-color: #2563eb;
    color: #f8fafc;
  }

  .chip-icon {
    font-size: 14px;
    line-height: 1;
  }

  .chip-name {
    font-size: 11px;
    font-weight: 500;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chip-check {
    font-size: 11px;
    font-weight: 700;
    color: #3b82f6;
  }

  /* Size Presets Row */
  .size-presets-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .size-chip {
    background: #181d28;
    border: 1px solid #2e374a;
    border-radius: 4px;
    padding: 5px 10px;
    font-size: 11px;
    font-weight: 500;
    color: #cbd5e1;
    cursor: pointer;
    transition: all 0.12s;
  }
  .size-chip:hover {
    background: #202838;
    color: #fff;
  }
  .size-chip.active {
    background: #064e3b;
    border-color: #059669;
    color: #6ee7b7;
    font-weight: 600;
  }

  .size-banner {
    flex: 1;
    min-width: 200px;
    background: rgba(6, 78, 59, 0.25);
    border: 1px solid #065f46;
    border-radius: 6px;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .size-summary-title {
    font-size: 12px;
    font-weight: 700;
    color: #a7f3d0;
  }

  .size-summary-dim {
    font-size: 10.5px;
    color: #6ee7b7;
  }

  /* Identity Grid */
  .identity-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }
  @media (max-width: 700px) {
    .identity-grid {
      grid-template-columns: 1fr;
    }
  }

  .identity-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .input-with-button {
    display: flex;
    gap: 6px;
  }

  .input-with-button input {
    flex: 1;
    background: #11141c;
    border: 1px solid #333c4e;
    border-radius: 4px;
    padding: 7px 10px;
    color: #f8fafc;
    font-size: 12.5px;
    font-weight: 600;
  }
  .input-with-button input:focus {
    outline: none;
    border-color: #f59e0b;
  }

  .action-mini-btn {
    background: #222938;
    border: 1px solid #3b465c;
    border-radius: 4px;
    padding: 0 12px;
    font-size: 11px;
    font-weight: 600;
    color: #dce6f2;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.12s;
  }
  .action-mini-btn:hover {
    background: #2f394d;
    color: #fff;
  }

  /* Modal Footer */
  .gen-modal-footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 10px;
    padding: 14px 20px;
    background: #13161f;
    border-top: 1px solid #283042;
    flex-shrink: 0;
  }

  .gen-btn {
    border-radius: 5px;
    padding: 8px 18px;
    font-size: 13px;
    font-weight: 650;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .gen-btn.cancel {
    background: #202634;
    border: 1px solid #343f54;
    color: #cbd5e1;
  }
  .gen-btn.cancel:hover {
    background: #2b3346;
    color: #fff;
  }

  .gen-btn.primary {
    background: linear-gradient(135deg, #b45309 0%, #d97706 50%, #f59e0b 100%);
    border: 1px solid #fde047;
    color: #fff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
    box-shadow: 0 3px 12px rgba(217, 119, 6, 0.4);
  }
  .gen-btn.primary:hover {
    background: linear-gradient(135deg, #d97706 0%, #f59e0b 50%, #fbbf24 100%);
    box-shadow: 0 4px 18px rgba(251, 191, 36, 0.55);
    transform: translateY(-1px);
  }

  /* Continent Generation Loader Overlay */
  .continent-loader-overlay {
    position: absolute;
    inset: 0;
    background: rgba(8, 10, 15, 0.92);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    border-radius: 8px;
    padding: 24px;
    animation: fadeInLoader 0.2s ease-out;
  }

  @keyframes fadeInLoader {
    from { opacity: 0; transform: scale(0.98); }
    to { opacity: 1; transform: scale(1); }
  }

  .continent-loader-card {
    background: linear-gradient(180deg, #151b27 0%, #0e121a 100%);
    border: 1px solid #3b465c;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8), 0 0 30px rgba(245, 158, 11, 0.15);
    border-radius: 8px;
    padding: 28px 32px;
    width: 100%;
    max-width: 520px;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .loader-pulse-ring {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(245, 158, 11, 0.25) 0%, rgba(245, 158, 11, 0.05) 70%, transparent 100%);
    border: 2px solid rgba(245, 158, 11, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    box-shadow: 0 0 20px rgba(245, 158, 11, 0.3);
    animation: pulseRing 1.8s infinite ease-in-out;
  }

  @keyframes pulseRing {
    0%, 100% { transform: scale(1); box-shadow: 0 0 16px rgba(245, 158, 11, 0.3); }
    50% { transform: scale(1.08); box-shadow: 0 0 28px rgba(245, 158, 11, 0.6); }
  }

  .loader-spinner {
    display: inline-block;
    animation: rotateGlobe 6s linear infinite;
  }

  @keyframes rotateGlobe {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .loader-headline {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
    color: #f8fafc;
    letter-spacing: 0.2px;
  }

  .loader-subtext {
    margin: 0;
    font-size: 12px;
    color: #94a3b8;
    line-height: 1.4;
    max-width: 440px;
  }

  .loader-progress-box {
    width: 100%;
    margin-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .loader-progress-track {
    width: 100%;
    height: 12px;
    background: #090c12;
    border: 1px solid #283042;
    border-radius: 6px;
    overflow: hidden;
    position: relative;
  }

  .loader-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #d97706 0%, #f59e0b 50%, #fbbf24 100%);
    border-radius: 6px;
    position: relative;
    transition: width 0.18s ease-out;
    box-shadow: 0 0 12px rgba(245, 158, 11, 0.6);
  }

  .loader-shimmer {
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.4) 50%, transparent 100%);
    animation: shimmerSlide 1.5s infinite;
  }

  @keyframes shimmerSlide {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(200%); }
  }

  .loader-meta-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11.5px;
    font-weight: 600;
    color: #cbd5e1;
    padding: 0 2px;
  }

  .meta-step {
    color: #94a3b8;
  }

  .meta-pct {
    color: #f59e0b;
    font-weight: 700;
  }

  .loader-region-chip {
    margin-top: 4px;
    display: flex;
    align-items: center;
    gap: 10px;
    background: #11151f;
    border: 1px solid #2a3345;
    border-radius: 6px;
    padding: 8px 14px;
    width: 100%;
    box-sizing: border-box;
    text-align: left;
  }

  .chip-biome-icon {
    font-size: 20px;
    flex-shrink: 0;
  }

  .chip-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: hidden;
  }

  .chip-title {
    font-size: 13px;
    font-weight: 700;
    color: #f8fafc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chip-badge {
    font-size: 11px;
    font-weight: 600;
    color: #f59e0b;
  }
</style>
