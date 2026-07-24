<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "./appState.svelte";
  import {
    REGION_BIOMES,
    REGION_BIOME_LABELS,
    REGION_COLOR_PRESETS,
    REGION_GRASS_COVER,
    REGION_MUSIC_TRACKS,
    generateRandomRegionBlueprint,
    type RegionBiome,
    type RegionBlueprint,
    type RegionColorGrading,
  } from "@rustcraft/shared";
  import {
    RegionEditorScene,
    type EditorSelection,
    type EditorTransformMode,
    type EditorMarkerKind,
    type SculptMode,
    type WaterBrushMode,
  } from "../render/RegionEditorScene";
  import { REGION_PROP_PALETTE } from "../render/regionPropPalette";

  let canvas: HTMLCanvasElement;
  let fileInput: HTMLInputElement;
  let scene: RegionEditorScene | null = null;

  let regionList = $state<{ id: string; name: string; biome: RegionBiome }[]>([]);
  let regionId = $state<string>("");
  let regionName = $state("New Region");
  let biome = $state<RegionBiome>("grassland");
  let portalWorldX = $state(0);
  let portalWorldZ = $state(0);
  let musicTrack = $state<string | null>(null);

  let selection = $state<EditorSelection[]>([]);
  let transformMode = $state<EditorTransformMode>("translate");
  let sculptMode = $state<SculptMode>(null);
  let waterBrushMode = $state<WaterBrushMode>(null);
  let waterPhysicsSimulating = $state(true);
  let brushRadius = $state(8);
  let brushStrength = $state(1);
  let armedModel = $state<string | null>(null);
  let armedMarker = $state<EditorMarkerKind | null>(null);
  let roadPaintActive = $state(false);
  let roadWidth = $state(4);
  let heightScale = $state(1);
  let treeDensity = $state(1);
  let worldSize = $state(282);
  let playtestActive = $state(false);
  let openGroups = $state<Set<string>>(new Set([REGION_PROP_PALETTE[0]?.label ?? ""]));
  let colorGrading = $state<RegionColorGrading>({ ...REGION_COLOR_PRESETS.grassland });
  let showColorPanel = $state(false);
  let status = $state<string | null>(null);
  let activeDropdown = $state<"sculpt" | "water" | "textures" | "lights" | "markers" | "env" | "file" | null>(null);

  function toggleDropdown(name: "sculpt" | "water" | "textures" | "lights" | "markers" | "env" | "file"): void {
    activeDropdown = activeDropdown === name ? null : name;
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
    );
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
      if (e.key === "Escape") cancelArmed();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        if (e.shiftKey) scene?.redo();
        else scene?.undo();
      }
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKeyDown);
      scene?.dispose();
    };
  });

  function toggleGroup(label: string): void {
    const next = new Set(openGroups);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    openGroups = next;
  }

  function pickModel(model: string, category: "building" | "foliage" | "prop"): void {
    armedMarker = null;
    sculptMode = null;
    waterBrushMode = null;
    roadPaintActive = false;
    armedModel = model;
    scene?.armPlacement(model, category);
  }

  function pickMarker(kind: EditorMarkerKind): void {
    armedModel = null;
    sculptMode = null;
    waterBrushMode = null;
    roadPaintActive = false;
    armedMarker = kind;
    scene?.armMarkerPlacement(kind);
  }

  function pickSculpt(mode: SculptMode): void {
    armedModel = null;
    armedMarker = null;
    waterBrushMode = null;
    roadPaintActive = false;
    sculptMode = sculptMode === mode ? null : mode;
    scene?.setSculptMode(sculptMode);
  }

  function pickWaterBrush(mode: WaterBrushMode): void {
    armedModel = null;
    armedMarker = null;
    sculptMode = null;
    roadPaintActive = false;
    waterBrushMode = waterBrushMode === mode ? null : mode;
    scene?.setWaterBrushMode(waterBrushMode);
  }

  function toggleWaterPhysics(): void {
    waterPhysicsSimulating = !waterPhysicsSimulating;
    scene?.setWaterPhysicsSimulating(waterPhysicsSimulating);
  }

  function clearWater(): void {
    scene?.clearWater();
  }

  function pickRoadTool(): void {
    armedModel = null;
    armedMarker = null;
    sculptMode = null;
    waterBrushMode = null;
    roadPaintActive = !roadPaintActive;
    if (roadPaintActive) scene?.armRoadPainting();
    else scene?.disarm();
  }

  function updateRoadWidth(v: number): void {
    roadWidth = v;
    scene?.setRoadWidth(v);
  }

  let randomTreeBrushActive = $state(false);
  let grassBrushActive = $state(false);
  let grassBrushModel = $state<string | null>(null);
  let eraseBrushActive = $state(false);
  let grassOptions = $derived(REGION_GRASS_COVER[biome] ?? REGION_GRASS_COVER.grassland);

  function pickRandomTreeBrush(): void {
    armedModel = null;
    armedMarker = null;
    sculptMode = null;
    waterBrushMode = null;
    roadPaintActive = false;
    grassBrushActive = false;
    eraseBrushActive = false;
    randomTreeBrushActive = !randomTreeBrushActive;
    scene?.setRandomTreeBrush(randomTreeBrushActive);
  }

  function pickGrassBrush(): void {
    armedModel = null;
    armedMarker = null;
    sculptMode = null;
    waterBrushMode = null;
    roadPaintActive = false;
    randomTreeBrushActive = false;
    eraseBrushActive = false;
    grassBrushActive = !grassBrushActive;
    scene?.setGrassBrush(grassBrushActive);
  }

  function pickGrassBrushModel(model: string | null): void {
    grassBrushModel = model;
    scene?.setGrassBrushModel(model);
  }

  function pickEraseBrush(): void {
    armedModel = null;
    armedMarker = null;
    sculptMode = null;
    waterBrushMode = null;
    roadPaintActive = false;
    randomTreeBrushActive = false;
    grassBrushActive = false;
    texturePaintMode = null;
    armedLightColor = null;
    eraseBrushActive = !eraseBrushActive;
    scene?.setEraseBrush(eraseBrushActive);
  }

  let texturePaintMode = $state<number | null>(null);
  let armedLightColor = $state<string | null>(null);

  function pickTexture(mode: number | null): void {
    armedModel = null;
    armedMarker = null;
    sculptMode = null;
    waterBrushMode = null;
    roadPaintActive = false;
    randomTreeBrushActive = false;
    grassBrushActive = false;
    eraseBrushActive = false;
    armedLightColor = null;
    texturePaintMode = texturePaintMode === mode ? null : mode;
    scene?.setTexturePaintMode(texturePaintMode);
  }

  function pickLightColor(color: string): void {
    armedModel = null;
    armedMarker = null;
    sculptMode = null;
    waterBrushMode = null;
    roadPaintActive = false;
    randomTreeBrushActive = false;
    grassBrushActive = false;
    eraseBrushActive = false;
    texturePaintMode = null;
    armedLightColor = armedLightColor === color ? null : color;
    if (armedLightColor) scene?.armLightPlacement(armedLightColor);
    else scene?.disarm();
  }

  function cancelArmed(): void {
    armedModel = null;
    armedMarker = null;
    sculptMode = null;
    waterBrushMode = null;
    roadPaintActive = false;
    randomTreeBrushActive = false;
    grassBrushActive = false;
    eraseBrushActive = false;
    texturePaintMode = null;
    armedLightColor = null;
    scene?.setRandomTreeBrush(false);
    scene?.setGrassBrush(false);
    scene?.setEraseBrush(false);
    scene?.setTexturePaintMode(null);
    scene?.disarm();
  }

  function setMode(mode: EditorTransformMode): void {
    transformMode = mode;
    scene?.setTransformMode(mode);
    cancelArmed();
  }

  function togglePlaytest(): void {
    if (!scene) return;
    cancelArmed();
    playtestActive = scene.togglePlaytest();
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

  function deleteSelected(): void {
    scene?.deleteSelected();
  }

  function applyColorGrading(): void {
    scene?.applyColorGrading(colorGrading);
  }

  function applyBiomePreset(): void {
    colorGrading = { ...REGION_COLOR_PRESETS[biome] };
    applyColorGrading();
  }

  async function refreshRegionList(): Promise<void> {
    try {
      const res = await fetch(app.apiUrl("/api/regions"), { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as { regions: { id: string; name: string; biome: RegionBiome }[] };
      regionList = data.regions;
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
      portalWorldX = data.blueprint.portalWorldX;
      portalWorldZ = data.blueprint.portalWorldZ;
      musicTrack = data.blueprint.musicTrack ?? null;
      colorGrading = scene.getColorGrading();
      status = `Loaded "${data.blueprint.name}".`;
      localStorage.setItem("rustcraft_last_region_id", data.blueprint.id);
      const url = new URL(window.location.href);
      url.searchParams.set("region", data.blueprint.id);
      window.history.replaceState({}, "", url.toString());
    } catch {
      status = "Failed to load region.";
    }
  }

  async function generateDraft(): Promise<void> {
    if (!scene) return;
    const seed = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    status = "Generating draft...";
    const bp = generateRandomRegionBlueprint(seed, biome, regionName, { heightScale, treeDensity, worldSize });
    bp.id = regionId;
    bp.portalWorldX = portalWorldX;
    bp.portalWorldZ = portalWorldZ;
    bp.musicTrack = musicTrack;
    await scene.loadBlueprint(bp);
    scene.initHistory();
    colorGrading = scene.getColorGrading();
    status = "Generated a random region -- review, tweak, then Save.";
  }

  function newRegion(): void {
    regionId = "";
    regionName = "New Region";
    portalWorldX = 0;
    portalWorldZ = 0;
    musicTrack = null;
    void generateDraft();
  }

  function pickMusicTrack(trackId: string | null): void {
    musicTrack = trackId;
    scene?.setMeta({ musicTrack });
  }

  async function saveToServer(): Promise<void> {
    if (!scene) return;
    scene.setMeta({ id: regionId, name: regionName, biome, portalWorldX, portalWorldZ, musicTrack });
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

  function exportJson(): void {
    if (!scene) return;
    scene.setMeta({ id: regionId, name: regionName, biome, portalWorldX, portalWorldZ, musicTrack });
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
      portalWorldX = blueprint.portalWorldX;
      portalWorldZ = blueprint.portalWorldZ;
      musicTrack = blueprint.musicTrack ?? null;
      colorGrading = scene?.getColorGrading() ?? colorGrading;
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
  <div class="header-bar">
    <div class="left-section">
      <button class="exit-btn" onclick={exitEditor} title="Leave editor">&larr; Exit</button>

      <div class="field-inline">
        <select value={regionId} onchange={(e) => loadRegion((e.target as HTMLSelectElement).value)}>
          {#each regionList as r (r.id)}
            <option value={r.id}>{r.name}</option>
          {/each}
          {#if !regionList.some((r) => r.id === regionId)}
            <option value={regionId}>{regionName} (unsaved)</option>
          {/if}
        </select>
        <button class="icon-btn" onclick={newRegion} title="New Region">+</button>
      </div>

      <input type="text" class="name-input" bind:value={regionName} placeholder="Region Name" />

      <select class="biome-select" bind:value={biome} onchange={applyBiomePreset}>
        {#each REGION_BIOMES as b (b)}
          <option value={b}>{REGION_BIOME_LABELS[b]}</option>
        {/each}
      </select>
    </div>

    <div class="center-tools">
      <!-- Transform Mode Segmented Controls -->
      <div class="segmented-control">
        <button class:active={transformMode === "translate"} onclick={() => setMode("translate")} title="Move (T)">
          ✢ Move
        </button>
        <button class:active={transformMode === "rotate"} onclick={() => setMode("rotate")} title="Rotate (R)">
          ↻ Rotate
        </button>
        <button class:active={transformMode === "scale"} onclick={() => setMode("scale")} title="Scale (S)">
          ⤢ Scale
        </button>
      </div>

      <div class="v-divider"></div>

      <!-- Sculpt Dropdown Menu -->
      <div class="dropdown-wrapper">
        <button class="dropdown-trigger" class:active={sculptMode !== null} onclick={() => toggleDropdown("sculpt")}>
          🏔️ Sculpt <span class="caret">▾</span>
        </button>
        {#if activeDropdown === "sculpt"}
          <div class="dropdown-menu">
            <button class:active={sculptMode === "raise"} onclick={() => { pickSculpt("raise"); activeDropdown = null; }}>
              ⛰️ Raise Terrain
            </button>
            <button class:active={sculptMode === "lower"} onclick={() => { pickSculpt("lower"); activeDropdown = null; }}>
              🕳️ Lower Terrain
            </button>
            <button class:active={sculptMode === "mold"} onclick={() => { pickSculpt("mold"); activeDropdown = null; }}>
              📐 Mould / Flatten
            </button>
            <button class:active={sculptMode === "smooth"} onclick={() => { pickSculpt("smooth"); activeDropdown = null; }}>
              🌊 Smooth Terrain
            </button>
          </div>
        {/if}
      </div>

      <!-- Water Physics Dropdown Menu -->
      <div class="dropdown-wrapper">
        <button class="dropdown-trigger" class:active={waterBrushMode !== null} onclick={() => toggleDropdown("water")}>
          💧 Water <span class="caret">▾</span>
        </button>
        {#if activeDropdown === "water"}
          <div class="dropdown-menu">
            <button class:active={waterBrushMode === "add"} onclick={() => { pickWaterBrush("add"); activeDropdown = null; }}>
              💧 Drop Water Brush
            </button>
            <button class:active={waterBrushMode === "remove"} onclick={() => { pickWaterBrush("remove"); activeDropdown = null; }}>
              🧽 Drain Water Brush
            </button>
            <div class="dropdown-divider"></div>
            <button class:active={waterPhysicsSimulating} onclick={toggleWaterPhysics}>
              🌊 Physics: {waterPhysicsSimulating ? "Flowing" : "Paused"}
            </button>
            <button onclick={() => { clearWater(); activeDropdown = null; }}>
              🧹 Clear All Water
            </button>
          </div>
        {/if}
      </div>

      <!-- Texture Paint Dropdown Menu -->
      <div class="dropdown-wrapper">
        <button class="dropdown-trigger" class:active={texturePaintMode !== null} onclick={() => toggleDropdown("textures")}>
          🎨 Textures <span class="caret">▾</span>
        </button>
        {#if activeDropdown === "textures"}
          <div class="dropdown-menu">
            <button class:active={texturePaintMode === 0} onclick={() => { pickTexture(0); activeDropdown = null; }}>
              ✨ Auto / Biome Blend
            </button>
            <button class:active={texturePaintMode === 1} onclick={() => { pickTexture(1); activeDropdown = null; }}>
              🌿 Grass Texture
            </button>
            <button class:active={texturePaintMode === 2} onclick={() => { pickTexture(2); activeDropdown = null; }}>
              🤎 Dirt Texture
            </button>
            <button class:active={texturePaintMode === 3} onclick={() => { pickTexture(3); activeDropdown = null; }}>
              🧱 Cobblestone Road
            </button>
            <button class:active={texturePaintMode === 4} onclick={() => { pickTexture(4); activeDropdown = null; }}>
              ❄️ Snow Texture
            </button>
            <button class:active={texturePaintMode === 5} onclick={() => { pickTexture(5); activeDropdown = null; }}>
              🪨 Rock Texture
            </button>
            <button class:active={texturePaintMode === 6} onclick={() => { pickTexture(6); activeDropdown = null; }}>
              ⏳ Sand Texture
            </button>
          </div>
        {/if}
      </div>

      <!-- Light Sources Dropdown Menu -->
      <div class="dropdown-wrapper">
        <button class="dropdown-trigger" class:active={armedLightColor !== null} onclick={() => toggleDropdown("lights")}>
          💡 Lights <span class="caret">▾</span>
        </button>
        {#if activeDropdown === "lights"}
          <div class="dropdown-menu">
            <button class:active={armedLightColor === "#ff9933"} onclick={() => { pickLightColor("#ff9933"); activeDropdown = null; }}>
              🔥 Torch Amber
            </button>
            <button class:active={armedLightColor === "#ffffff"} onclick={() => { pickLightColor("#ffffff"); activeDropdown = null; }}>
              ☀️ Daylight White
            </button>
            <button class:active={armedLightColor === "#00d4ff"} onclick={() => { pickLightColor("#00d4ff"); activeDropdown = null; }}>
              💙 Mystic Cyan
            </button>
            <button class:active={armedLightColor === "#a055ff"} onclick={() => { pickLightColor("#a055ff"); activeDropdown = null; }}>
              🔮 Arcane Violet
            </button>
            <button class:active={armedLightColor === "#33ff77"} onclick={() => { pickLightColor("#33ff77"); activeDropdown = null; }}>
              🌲 Emerald Green
            </button>
          </div>
        {/if}
      </div>

      <!-- Roads & Spawns Dropdown Menu -->
      <div class="dropdown-wrapper">
        <button class="dropdown-trigger" class:active={roadPaintActive || armedMarker !== null || randomTreeBrushActive || grassBrushActive || eraseBrushActive} onclick={() => toggleDropdown("markers")}>
          📍 Roads & Nature <span class="caret">▾</span>
        </button>
        {#if activeDropdown === "markers"}
          <div class="dropdown-menu">
            <button class:active={roadPaintActive} onclick={() => { pickRoadTool(); activeDropdown = null; }}>
              🛣️ Paint Dirt Road
            </button>
            <button class:active={randomTreeBrushActive} onclick={() => { pickRandomTreeBrush(); activeDropdown = null; }}>
              🌲 Random Tree Brush
            </button>
            <button class:active={grassBrushActive} onclick={() => { pickGrassBrush(); activeDropdown = null; }}>
              🌿 Grass Brush
            </button>
            <button class:active={eraseBrushActive} onclick={() => { pickEraseBrush(); activeDropdown = null; }}>
              🧹 Erase Brush
            </button>
            <div class="dropdown-divider"></div>
            <button class:active={armedMarker === "mobSpawn"} onclick={() => { pickMarker("mobSpawn"); activeDropdown = null; }}>
              👾 + Mob Spawn
            </button>
            <button class:active={armedMarker === "village"} onclick={() => { pickMarker("village"); activeDropdown = null; }}>
              🏰 + Village Marker
            </button>
            <button class:active={armedMarker === "entry"} onclick={() => { pickMarker("entry"); activeDropdown = null; }}>
              🚪 + Entry Portal
            </button>
          </div>
        {/if}
      </div>

      <!-- World & Settings Dropdown Menu -->
      <div class="dropdown-wrapper">
        <button class="dropdown-trigger" class:active={showColorPanel} onclick={() => toggleDropdown("env")}>
          ⚙️ World Settings <span class="caret">▾</span>
        </button>
        {#if activeDropdown === "env"}
          <div class="dropdown-menu settings-panel">
            <label class="menu-field">
              Terrain Height
              <input type="range" min="0.25" max="2.5" step="0.05" bind:value={heightScale} />
            </label>
            <label class="menu-field">
              Tree Density
              <input type="range" min="0.25" max="2.5" step="0.05" bind:value={treeDensity} />
            </label>
            <label class="menu-field">
              World Size
              <input type="range" min="140" max="700" step="20" bind:value={worldSize} />
              <span class="readout">{worldSize}m</span>
            </label>
            <button class="menu-action" onclick={() => { generateDraft(); activeDropdown = null; }}>🎲 Re-Generate World</button>
            <div class="dropdown-divider"></div>
            <label class="menu-field">
              Portal X <input type="number" step="1" bind:value={portalWorldX} />
            </label>
            <label class="menu-field">
              Portal Z <input type="number" step="1" bind:value={portalWorldZ} />
            </label>
            <div class="dropdown-divider"></div>
            <label class="menu-field">
              🎵 Music
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
            <div class="dropdown-divider"></div>
            <button class="menu-action" class:active={showColorPanel} onclick={() => { showColorPanel = !showColorPanel; activeDropdown = null; }}>
              🎨 Toggle Color Grading
            </button>
          </div>
        {/if}
      </div>
    </div>

    <div class="right-section">
      {#if status}<span class="status">{status}</span>{/if}

      <!-- File Dropdown -->
      <div class="dropdown-wrapper">
        <button class="dropdown-trigger file-btn" onclick={() => toggleDropdown("file")}>
          📁 File <span class="caret">▾</span>
        </button>
        {#if activeDropdown === "file"}
          <div class="dropdown-menu right-aligned">
            <button onclick={() => { void saveToServer(); activeDropdown = null; }}>💾 Save Region</button>
            <button onclick={() => { exportJson(); activeDropdown = null; }}>📤 Export JSON</button>
            <button onclick={() => { importJson(); activeDropdown = null; }}>📥 Import JSON</button>
          </div>
        {/if}
      </div>
      <input bind:this={fileInput} type="file" accept="application/json" class="hidden-file" onchange={onFileSelected} />

      <button class="playtest-btn" class:active={playtestActive} onclick={togglePlaytest} title="Walk around the region">
        {playtestActive ? "⏹ Exit Playtest" : "▶ Playtest"}
      </button>
    </div>
  </div>

  <!-- Active Context Sub-Bar (only shown when a sculpt, water, texture, light, tree, or road tool is active) -->
  {#if sculptMode || waterBrushMode || texturePaintMode !== null || armedLightColor !== null || randomTreeBrushActive || grassBrushActive || eraseBrushActive || roadPaintActive}
    <div class="context-bar">
      <span class="context-title">
        {#if sculptMode}
          🏔️ Sculpting Mode: <strong>{sculptMode.toUpperCase()}</strong>
        {:else if waterBrushMode}
          💧 Water Mode: <strong>{waterBrushMode === "add" ? "DROP WATER" : "DRAIN WATER"}</strong>
        {:else if texturePaintMode !== null}
          🎨 Texture Paint: <strong>{["AUTO", "GRASS", "DIRT", "COBBLESTONE", "SNOW", "ROCK", "SAND"][texturePaintMode]}</strong>
        {:else if armedLightColor !== null}
          💡 Light Placement: <strong>PLACE LIGHT SOURCE</strong>
        {:else if randomTreeBrushActive}
          🌲 Nature Mode: <strong>RANDOM TREE BRUSH</strong>
        {:else if grassBrushActive}
          🌿 Nature Mode: <strong>GRASS BRUSH</strong>
        {:else if eraseBrushActive}
          🧹 Nature Mode: <strong>ERASE BRUSH</strong>
        {:else if roadPaintActive}
          🛣️ Road Mode: <strong>PAINT ROAD</strong>
        {/if}
      </span>

      <div class="context-fields">
        {#if sculptMode || waterBrushMode || texturePaintMode !== null || randomTreeBrushActive || grassBrushActive || eraseBrushActive}
          <label class="context-field">
            Radius
            <input type="range" min="2" max="30" value={brushRadius} oninput={(e) => updateBrushRadius(Number((e.target as HTMLInputElement).value))} />
            <span>{brushRadius}m</span>
          </label>
          {#if sculptMode || waterBrushMode || randomTreeBrushActive || grassBrushActive}
            <label class="context-field">
              {randomTreeBrushActive ? "Density" : grassBrushActive ? "Frequency" : "Strength"}
              <input type="range" min="0.2" max="3" step="0.1" value={brushStrength} oninput={(e) => updateBrushStrength(Number((e.target as HTMLInputElement).value))} />
              <span>{brushStrength}x</span>
            </label>
          {/if}
          {#if grassBrushActive}
            <label class="context-field">
              Type
              <select value={grassBrushModel ?? "__random__"} onchange={(e) => pickGrassBrushModel((e.target as HTMLSelectElement).value === "__random__" ? null : (e.target as HTMLSelectElement).value)}>
                <option value="__random__">🎲 Random</option>
                {#each grassOptions as model (model)}
                  <option value={model}>{model.replace(/^.*\//, "").replace(/\.(gltf|glb)$/, "")}</option>
                {/each}
              </select>
            </label>
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

  <div class="body">
    <div class="palette">
      <div class="palette-tools-title">📦 Asset Palette</div>
      {#each REGION_PROP_PALETTE as group (group.label)}
        <div class="palette-group">
          <button class="palette-group-header" onclick={() => toggleGroup(group.label)}>
            {openGroups.has(group.label) ? "▾" : "▸"} {group.label}
          </button>
          {#if openGroups.has(group.label)}
            <div class="palette-items">
              {#each group.models as model (model)}
                <button class:active={armedModel === model} onclick={() => pickModel(model, group.category)}>
                  {model.replace(/\.(gltf|glb)$/, "")}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>

    <canvas bind:this={canvas} class="viewport"></canvas>

    {#if playtestActive}
      <div class="playtest-hint">WASD to move &middot; Mouse to look &middot; Shift to run &middot; Esc to exit</div>
    {/if}

    {#if showColorPanel}
      <div class="color-panel">
        <h3>Color Grading</h3>
        <label>Sky <input type="color" bind:value={colorGrading.skyColor} oninput={applyColorGrading} /></label>
        <label>Fog <input type="color" bind:value={colorGrading.fogColor} oninput={applyColorGrading} /></label>
        <label>Fog Density
          <input type="range" min="0" max="0.05" step="0.001" bind:value={colorGrading.fogDensity} oninput={applyColorGrading} />
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
          <input type="range" min="0" max="2" step="0.05" bind:value={colorGrading.ambientIntensity} oninput={applyColorGrading} />
        </label>
        <label>Sun <input type="color" bind:value={colorGrading.sunColor} oninput={applyColorGrading} /></label>
        <label>Sun Intensity
          <input type="range" min="0" max="2" step="0.05" bind:value={colorGrading.sunIntensity} oninput={applyColorGrading} />
        </label>
      </div>
    {/if}

    {#if selection.length === 1}
      {@const sel = selection[0]!}
      <div class="properties">
        <h3>{sel.kind === "asset" ? sel.model?.replace(/\.(gltf|glb)$/, "") : sel.kind === "light" ? "Point Light Source" : sel.markerKind}</h3>
        <label>X <input type="number" step="0.1" value={sel.x} onchange={(e) => applyPatch({ x: Number((e.target as HTMLInputElement).value) })} /></label>
        <label>Y <input type="number" step="0.1" value={sel.y} onchange={(e) => applyPatch({ y: Number((e.target as HTMLInputElement).value) })} /></label>
        <label>Z <input type="number" step="0.1" value={sel.z} onchange={(e) => applyPatch({ z: Number((e.target as HTMLInputElement).value) })} /></label>
        {#if sel.kind === "asset"}
          <label>Yaw <input type="number" step="0.01" value={sel.yaw} onchange={(e) => applyPatch({ yaw: Number((e.target as HTMLInputElement).value) })} /></label>
          <label>Scale <input type="number" step="0.05" value={sel.scale} onchange={(e) => applyPatch({ scale: Number((e.target as HTMLInputElement).value) })} /></label>
        {:else if sel.kind === "light"}
          <label>Color <input type="color" value={sel.color ?? "#ff9933"} onchange={(e) => applyPatch({ color: (e.target as HTMLInputElement).value })} /></label>
          <label>Intensity
            <input type="range" min="0.2" max="10" step="0.2" value={sel.intensity ?? 2.5} oninput={(e) => applyPatch({ intensity: Number((e.target as HTMLInputElement).value) })} />
            <span>{sel.intensity ?? 2.5}x</span>
          </label>
          <label>Distance
            <input type="range" min="5" max="60" step="1" value={sel.distance ?? 25} oninput={(e) => applyPatch({ distance: Number((e.target as HTMLInputElement).value) })} />
            <span>{sel.distance ?? 25}m</span>
          </label>
        {/if}
        {#if sel.markerKind === "village"}
          <label>Name <input type="text" value={sel.name} onchange={(e) => applyPatch({ name: (e.target as HTMLInputElement).value })} /></label>
          <label>Radius <input type="number" step="1" value={sel.radius} onchange={(e) => applyPatch({ radius: Number((e.target as HTMLInputElement).value) })} /></label>
          <button class="build-village-btn" onclick={() => scene?.buildVillageAroundMarker(sel.id)}>🏰 Build Village Here</button>
        {/if}
        {#if sel.markerKind !== "entry"}
          <button class="delete" onclick={deleteSelected}>Delete</button>
        {/if}
      </div>
    {:else if selection.length > 1}
      <div class="properties">
        <h3>{selection.length} Items Selected</h3>
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
  .header-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 16px;
    background: #181b22;
    border-bottom: 1px solid #2a2f3d;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
    z-index: 100;
  }
  .left-section, .center-tools, .right-section {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .exit-btn {
    background: #282d3b;
    border: 1px solid #3d4559;
    color: #e2e8f0;
    border-radius: 5px;
    padding: 5px 12px;
    cursor: pointer;
    font-weight: 500;
    transition: background 0.15s, border-color 0.15s;
  }
  .exit-btn:hover {
    background: #333a4d;
    border-color: #525d78;
  }
  .field-inline {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .field-inline select, .biome-select, .name-input {
    background: #0f1218;
    border: 1px solid #2d3445;
    color: #e2e8f0;
    border-radius: 5px;
    padding: 5px 8px;
    font-size: 13px;
  }
  .name-input {
    width: 120px;
    font-weight: 500;
  }
  .icon-btn {
    background: #282d3b;
    border: 1px solid #3d4559;
    color: #e2e8f0;
    border-radius: 5px;
    padding: 5px 9px;
    cursor: pointer;
    font-weight: bold;
  }
  .icon-btn:hover {
    background: #3a6ea8;
    border-color: #5c8fc9;
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
  .v-divider {
    width: 1px;
    height: 20px;
    background: #2a2f3d;
    margin: 0 4px;
  }
  .dropdown-wrapper {
    position: relative;
  }
  .dropdown-trigger {
    background: #202531;
    border: 1px solid #323a4d;
    color: #cbd5e1;
    border-radius: 6px;
    padding: 5px 12px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 6px;
    transition: all 0.15s;
  }
  .dropdown-trigger:hover, .dropdown-trigger.active {
    background: #2d3546;
    border-color: #4a5673;
    color: #f8fafc;
  }
  .dropdown-trigger.file-btn {
    background: #252c3b;
    border-color: #3b465e;
  }
  .caret {
    font-size: 10px;
    color: #64748b;
  }
  .dropdown-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    min-width: 180px;
    background: #1a1e27;
    border: 1px solid #333d52;
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    z-index: 200;
    backdrop-filter: blur(8px);
  }
  .dropdown-menu.right-aligned {
    left: auto;
    right: 0;
  }
  .dropdown-menu.settings-panel {
    min-width: 220px;
    padding: 10px;
  }
  .dropdown-menu button {
    text-align: left;
    background: transparent;
    border: none;
    color: #cbd5e1;
    border-radius: 5px;
    padding: 7px 10px;
    cursor: pointer;
    font-size: 13px;
    transition: background 0.15s, color 0.15s;
  }
  .dropdown-menu button:hover {
    background: #2a3244;
    color: #f8fafc;
  }
  .dropdown-menu button.active {
    background: #3a6ea8;
    color: #ffffff;
  }
  .dropdown-divider {
    height: 1px;
    background: #2d3546;
    margin: 4px 0;
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
  .menu-field input[type="range"] {
    width: 90px;
  }
  .menu-field input[type="number"] {
    width: 60px;
    background: #0f1218;
    border: 1px solid #2d3445;
    color: #e2e8f0;
    border-radius: 4px;
    padding: 2px 4px;
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
  }
  .playtest-btn {
    background: #16a34a;
    border: 1px solid #22c55e;
    color: #ffffff;
    border-radius: 6px;
    padding: 5px 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
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
    font-size: 12px;
  }
  .body {
    flex: 1;
    display: flex;
    min-height: 0;
    position: relative;
  }
  .palette {
    width: 220px;
    flex-shrink: 0;
    overflow-y: auto;
    background: #1a1d24;
    border-right: 1px solid #333a48;
    padding: 6px;
  }
  .palette-tools-title {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #38bdf8;
    padding: 4px 4px 2px;
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
  }
  .palette-items button.active {
    background: #3a6ea8;
    border-color: #5c8fc9;
  }
  .viewport {
    flex: 1;
    display: block;
    width: 0;
    min-width: 0;
    height: 100%;
  }
  .properties,
  .color-panel {
    position: absolute;
    top: 16px;
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
    z-index: 10;
    backdrop-filter: blur(4px);
  }
  .color-panel {
    top: 16px;
    left: 236px;
    right: auto;
  }
  .properties h3,
  .color-panel h3 {
    margin: 0 0 6px;
    font-size: 14px;
    word-break: break-word;
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
</style>
