<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "./appState.svelte";
  import {
    REGION_BIOMES,
    REGION_BIOME_LABELS,
    REGION_COLOR_PRESETS,
    REGION_MUSIC_TRACKS,
    generateRandomRegionBlueprint,
    MOBS,
    type RegionBiome,
    type RegionBlueprint,
    type RegionColorGrading,
    type RegionQuest,
    type RegionQuestObjectiveKind,
    type RegionNPC,
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
  import { HOUSE_TYPE_OPTIONS, type HouseType } from "../render/houseGen";
  import {
    TERRAIN_VOLUME_SHAPES,
    TERRAIN_VOLUME_MATERIALS,
  } from "../render/terrainVolumes";
  import type { TerrainVolumeShape, TerrainVolumeMaterial } from "@rustcraft/shared";

  let canvas: HTMLCanvasElement;
  let fileInput: HTMLInputElement;
  let scene: RegionEditorScene | null = null;

  let regionList = $state<{ id: string; name: string; biome: RegionBiome }[]>([]);
  let regionId = $state<string>("");
  let regionName = $state("New Region");
  let biome = $state<RegionBiome>("grassland");
  let portalWorldX = $state(0);
  let portalWorldZ = $state(0);
  let isStartingRegion = $state(false);
  let musicTrack = $state<string | null>(null);

  let selection = $state<EditorSelection[]>([]);
  let marqueeBox = $state<{ startX: number; startY: number; endX: number; endY: number } | null>(null);
  let transformMode = $state<EditorTransformMode>("translate");
  let transformSnap = $state(true);
  let sculptMode = $state<SculptMode>(null);
  let volumeStampShape = $state<TerrainVolumeShape | null>(null);
  let volumeSculptBrushActive = $state(false);
  let volumeMaterial = $state<TerrainVolumeMaterial>("rock");
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
  let grassColor = $state<{ bottom: string; top: string }>({ bottom: "#4f7c13", top: "#79a01c" });
  let grassLength = $state(1);
  let wind = $state<{ direction: number; strength: number }>({ direction: 0, strength: 1 });
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
      (box) => {
        marqueeBox = box;
      },
      (enabled) => {
        transformSnap = enabled;
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
    volumeStampShape = null;
    volumeSculptBrushActive = false;
    waterBrushMode = null;
    roadPaintActive = false;
    houseToolActive = false;
    armedModel = model;
    scene?.armPlacement(model, category);
  }

  function pickMarker(kind: EditorMarkerKind): void {
    armedModel = null;
    sculptMode = null;
    volumeStampShape = null;
    volumeSculptBrushActive = false;
    waterBrushMode = null;
    roadPaintActive = false;
    houseToolActive = false;
    armedMarker = kind;
    scene?.armMarkerPlacement(kind);
  }

  function pickSculpt(mode: SculptMode): void {
    armedModel = null;
    armedMarker = null;
    waterBrushMode = null;
    roadPaintActive = false;
    houseToolActive = false;
    volumeStampShape = null;
    volumeSculptBrushActive = false;
    sculptMode = sculptMode === mode ? null : mode;
    scene?.setSculptMode(sculptMode);
  }

  /** Freeform volume place -- stamps one 3D primitive at a time (click/light drag). */
  function pickVolumeStamp(shape: TerrainVolumeShape): void {
    armedModel = null;
    armedMarker = null;
    sculptMode = null;
    waterBrushMode = null;
    roadPaintActive = false;
    houseToolActive = false;
    randomTreeBrushActive = false;
    grassBrushActive = false;
    grassEraseBrushActive = false;
    eraseBrushActive = false;
    texturePaintMode = null;
    armedLightColor = null;
    volumeSculptBrushActive = false;
    volumeStampShape = volumeStampShape === shape ? null : shape;
    if (volumeStampShape) scene?.armVolumeStamp(volumeStampShape, volumeMaterial, "place");
    else scene?.disarm();
  }

  /** Continuous drag brush -- sprays overlapping volume stamps along the stroke. */
  function pickVolumeSculptBrush(): void {
    armedModel = null;
    armedMarker = null;
    sculptMode = null;
    waterBrushMode = null;
    roadPaintActive = false;
    houseToolActive = false;
    randomTreeBrushActive = false;
    grassBrushActive = false;
    grassEraseBrushActive = false;
    eraseBrushActive = false;
    texturePaintMode = null;
    armedLightColor = null;
    const next = !volumeSculptBrushActive;
    volumeSculptBrushActive = next;
    volumeStampShape = next ? (volumeStampShape ?? "boulder") : null;
    if (next) scene?.armVolumeStamp(volumeStampShape ?? "boulder", volumeMaterial, "sculpt");
    else scene?.disarm();
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
    armedModel = null;
    armedMarker = null;
    sculptMode = null;
    volumeStampShape = null;
    volumeSculptBrushActive = false;
    roadPaintActive = false;
    houseToolActive = false;
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
    volumeStampShape = null;
    volumeSculptBrushActive = false;
    waterBrushMode = null;
    houseToolActive = false;
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
  let grassEraseBrushActive = $state(false);
  let eraseBrushActive = $state(false);
  let houseToolActive = $state(false);
  let houseType = $state<HouseType>("random");

  function pickRandomTreeBrush(): void {
    armedModel = null;
    armedMarker = null;
    sculptMode = null;
    volumeStampShape = null;
    volumeSculptBrushActive = false;
    waterBrushMode = null;
    roadPaintActive = false;
    grassBrushActive = false;
    grassEraseBrushActive = false;
    eraseBrushActive = false;
    houseToolActive = false;
    randomTreeBrushActive = !randomTreeBrushActive;
    scene?.setRandomTreeBrush(randomTreeBrushActive);
  }

  /** One-click house generator (see houseGen.ts / RegionEditorScene's
   *  armHousePlacement): drops a fully assembled house of the chosen type
   *  (or random) wherever you next click, as ordinary editable assets that
   *  share a groupId so clicking any piece selects/moves the whole house.
   *  Stays armed so you can drop several in a row -- click the same type
   *  again, pick another tool, or hit Escape to stop. */
  function pickHouseTool(type: HouseType = houseType): void {
    armedModel = null;
    armedMarker = null;
    sculptMode = null;
    volumeStampShape = null;
    volumeSculptBrushActive = false;
    waterBrushMode = null;
    roadPaintActive = false;
    randomTreeBrushActive = false;
    grassBrushActive = false;
    grassEraseBrushActive = false;
    eraseBrushActive = false;
    texturePaintMode = null;
    armedLightColor = null;
    // Re-clicking the same type disarms; picking a different type switches.
    if (houseToolActive && houseType === type) {
      houseToolActive = false;
      scene?.disarm();
      return;
    }
    houseType = type;
    houseToolActive = true;
    scene?.armHousePlacement(type);
  }

  function pickGrassBrush(): void {
    armedModel = null;
    armedMarker = null;
    sculptMode = null;
    volumeStampShape = null;
    volumeSculptBrushActive = false;
    waterBrushMode = null;
    roadPaintActive = false;
    randomTreeBrushActive = false;
    grassEraseBrushActive = false;
    eraseBrushActive = false;
    houseToolActive = false;
    grassBrushActive = !grassBrushActive;
    scene?.setGrassBrush(grassBrushActive);
  }

  function pickGrassEraseBrush(): void {
    armedModel = null;
    armedMarker = null;
    sculptMode = null;
    volumeStampShape = null;
    volumeSculptBrushActive = false;
    waterBrushMode = null;
    roadPaintActive = false;
    randomTreeBrushActive = false;
    grassBrushActive = false;
    eraseBrushActive = false;
    houseToolActive = false;
    grassEraseBrushActive = !grassEraseBrushActive;
    scene?.setGrassEraseBrush(grassEraseBrushActive);
  }

  function pickEraseBrush(): void {
    armedModel = null;
    armedMarker = null;
    sculptMode = null;
    volumeStampShape = null;
    volumeSculptBrushActive = false;
    waterBrushMode = null;
    roadPaintActive = false;
    randomTreeBrushActive = false;
    grassBrushActive = false;
    grassEraseBrushActive = false;
    texturePaintMode = null;
    armedLightColor = null;
    houseToolActive = false;
    eraseBrushActive = !eraseBrushActive;
    scene?.setEraseBrush(eraseBrushActive);
  }

  let texturePaintMode = $state<number | null>(null);
  let armedLightColor = $state<string | null>(null);

  function pickTexture(mode: number | null): void {
    armedModel = null;
    armedMarker = null;
    sculptMode = null;
    volumeStampShape = null;
    volumeSculptBrushActive = false;
    waterBrushMode = null;
    roadPaintActive = false;
    randomTreeBrushActive = false;
    grassBrushActive = false;
    grassEraseBrushActive = false;
    eraseBrushActive = false;
    armedLightColor = null;
    houseToolActive = false;
    texturePaintMode = texturePaintMode === mode ? null : mode;
    scene?.setTexturePaintMode(texturePaintMode);
  }

  function pickLightColor(color: string): void {
    armedModel = null;
    armedMarker = null;
    sculptMode = null;
    volumeStampShape = null;
    volumeSculptBrushActive = false;
    waterBrushMode = null;
    roadPaintActive = false;
    randomTreeBrushActive = false;
    grassBrushActive = false;
    grassEraseBrushActive = false;
    eraseBrushActive = false;
    texturePaintMode = null;
    houseToolActive = false;
    armedLightColor = armedLightColor === color ? null : color;
    if (armedLightColor) scene?.armLightPlacement(armedLightColor);
    else scene?.disarm();
  }

  function cancelArmed(): void {
    armedModel = null;
    armedMarker = null;
    sculptMode = null;
    volumeStampShape = null;
    volumeSculptBrushActive = false;
    waterBrushMode = null;
    roadPaintActive = false;
    randomTreeBrushActive = false;
    grassBrushActive = false;
    grassEraseBrushActive = false;
    eraseBrushActive = false;
    texturePaintMode = null;
    armedLightColor = null;
    houseToolActive = false;
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
  }

  function applyGrassLength(): void {
    scene?.setGrassLength(grassLength);
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
      isStartingRegion = data.blueprint.isStartingRegion ?? false;
      musicTrack = data.blueprint.musicTrack ?? null;
      colorGrading = scene.getColorGrading();
      grassColor = scene.getGrassColor();
      wind = scene.getWind();
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
    grassColor = scene.getGrassColor();
    wind = scene.getWind();
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
    scene.setMeta({ id: regionId, name: regionName, biome, portalWorldX, portalWorldZ, isStartingRegion, musicTrack });
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
    scene.setMeta({ id: regionId, name: regionName, biome, portalWorldX, portalWorldZ, isStartingRegion, musicTrack });
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
      grassColor = scene?.getGrassColor() ?? grassColor;
      wind = scene?.getWind() ?? wind;
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

      <button
        class="tool-chip"
        class:active={transformSnap}
        onclick={toggleSnap}
        title="Snap to 0.5m / 15° (X)"
      >
        ⊞ Snap
      </button>
      <button
        class="tool-chip"
        onclick={dropToGround}
        disabled={selection.length === 0}
        title="Drop selection onto terrain (G)"
      >
        ⬇ Ground
      </button>

      <div class="v-divider"></div>

      <!-- Sculpt Dropdown Menu -->
      <div class="dropdown-wrapper">
        <button class="dropdown-trigger" class:active={sculptMode !== null || volumeStampShape !== null || volumeSculptBrushActive} onclick={() => toggleDropdown("sculpt")}>
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
            <button class:active={sculptMode === "carve"} onclick={() => { pickSculpt("carve"); activeDropdown = null; }}>
              🕳️ Carve Hole
            </button>
            <div class="dropdown-divider"></div>
            <div class="dropdown-section-label">Add Terrain Volumes</div>
            <button class:active={volumeSculptBrushActive} onclick={() => { pickVolumeSculptBrush(); activeDropdown = null; }}>
              🖌️ Drag Sculpt Brush
            </button>
            {#each TERRAIN_VOLUME_SHAPES as shape}
              <button class:active={volumeStampShape === shape.id && !volumeSculptBrushActive} onclick={() => { pickVolumeStamp(shape.id); activeDropdown = null; }}>
                {shape.label}
              </button>
            {/each}
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
        <button class="dropdown-trigger" class:active={roadPaintActive || armedMarker !== null || randomTreeBrushActive || grassBrushActive || grassEraseBrushActive || eraseBrushActive || houseToolActive} onclick={() => toggleDropdown("markers")}>
          📍 Roads & Nature <span class="caret">▾</span>
        </button>
        {#if activeDropdown === "markers"}
          <div class="dropdown-menu">
            <button class:active={roadPaintActive} onclick={() => { pickRoadTool(); activeDropdown = null; }}>
              🛣️ Paint Dirt Road
            </button>
            <div class="dropdown-divider"></div>
            {#each HOUSE_TYPE_OPTIONS as opt}
              <button class:active={houseToolActive && houseType === opt.id} onclick={() => { pickHouseTool(opt.id); activeDropdown = null; }}>
                {opt.label}
              </button>
            {/each}
            <div class="dropdown-divider"></div>
            <button class:active={randomTreeBrushActive} onclick={() => { pickRandomTreeBrush(); activeDropdown = null; }}>
              🌲 Random Tree Brush
            </button>
            <button class:active={grassBrushActive} onclick={() => { pickGrassBrush(); activeDropdown = null; }}>
              🌿 Grass Brush
            </button>
            <button class:active={grassEraseBrushActive} onclick={() => { pickGrassEraseBrush(); activeDropdown = null; }}>
              🌾✂️ Erase Grass
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
              🚪 + Entry Spawn Point
            </button>
            <button class:active={armedMarker === "portal"} onclick={() => { pickMarker("portal"); activeDropdown = null; }}>
              🌀 + Region Portal Link
            </button>
            <button class:active={armedMarker === "npc"} onclick={() => { pickMarker("npc"); activeDropdown = null; }}>
              📜 + Quest Giver NPC
            </button>
            <button class:active={armedMarker === "worldEvent"} onclick={() => { pickMarker("worldEvent"); activeDropdown = null; }}>
              ⚔️ + World Event
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
            <label class="menu-field checkbox-field">
              <input type="checkbox" bind:checked={isStartingRegion} onchange={(e) => scene?.setMeta({ isStartingRegion: (e.target as HTMLInputElement).checked })} />
              <span>⭐ Set as Starting Town (New Player Spawn)</span>
            </label>
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
            <label class="menu-field">
              🍃 Wind Direction
              <input type="range" min="0" max="360" step="5" bind:value={wind.direction} oninput={applyWind} />
              <span class="readout">{wind.direction}°</span>
            </label>
            <label class="menu-field">
              🍃 Wind Strength
              <input type="range" min="0" max="3" step="0.1" bind:value={wind.strength} oninput={applyWind} />
              <span class="readout">{wind.strength.toFixed(1)}x</span>
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
  {#if sculptMode || volumeSculptBrushActive || volumeStampShape || waterBrushMode || texturePaintMode !== null || armedLightColor !== null || randomTreeBrushActive || grassBrushActive || grassEraseBrushActive || eraseBrushActive || roadPaintActive}
    <div class="context-bar">
      <span class="context-title">
        {#if volumeSculptBrushActive}
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
          🎨 Texture Paint: <strong>{["AUTO", "GRASS", "DIRT", "COBBLESTONE", "SNOW", "ROCK", "SAND"][texturePaintMode]}</strong>
        {:else if armedLightColor !== null}
          💡 Light Placement: <strong>PLACE LIGHT SOURCE</strong>
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
        {#if sculptMode || volumeSculptBrushActive || volumeStampShape || waterBrushMode || texturePaintMode !== null || randomTreeBrushActive || grassBrushActive || grassEraseBrushActive || eraseBrushActive}
          <label class="context-field">
            Radius
            <input type="range" min="2" max="30" value={brushRadius} oninput={(e) => updateBrushRadius(Number((e.target as HTMLInputElement).value))} />
            <span>{brushRadius}m</span>
          </label>
          {#if volumeSculptBrushActive || volumeStampShape}
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
          {#if grassBrushActive}
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
        <h3>{sel.kind === "asset" ? sel.model?.replace(/\.(gltf|glb)$/, "") : sel.kind === "light" ? "Point Light Source" : sel.kind === "volume" ? `${sel.volumeShape ?? "volume"} (${sel.volumeMaterial ?? "rock"})` : sel.markerKind}</h3>
        <label>X <input type="number" step="0.1" value={sel.x} onchange={(e) => applyPatch({ x: Number((e.target as HTMLInputElement).value) })} /></label>
        <label>Y <input type="number" step="0.1" value={sel.y} onchange={(e) => applyPatch({ y: Number((e.target as HTMLInputElement).value) })} /></label>
        <label>Z <input type="number" step="0.1" value={sel.z} onchange={(e) => applyPatch({ z: Number((e.target as HTMLInputElement).value) })} /></label>
        <p class="hint">Arrows nudge · Shift = fine · G = ground · X = snap · Alt+Arrows = pan camera</p>
        {#if sel.kind === "asset" || sel.kind === "volume"}
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
        {:else if sel.markerKind === "portal"}
          <label>Portal Label <input type="text" value={sel.name ?? "Portal to Region"} onchange={(e) => applyPatch({ name: (e.target as HTMLInputElement).value })} /></label>
          <label>Destination
            <select value={sel.targetRegionId ?? "overworld"} onchange={(e) => applyPatch({ targetRegionId: (e.target as HTMLSelectElement).value })}>
              <option value="overworld">Main Open World</option>
              {#each regionList as r}
                <option value={r.id}>{r.name}</option>
              {/each}
            </select>
          </label>
        {:else if sel.markerKind === "npc"}
          <label>NPC Name <input type="text" value={sel.npcData?.name ?? sel.name} onchange={(e) => applyPatch({ name: (e.target as HTMLInputElement).value, npcData: { ...sel.npcData, name: (e.target as HTMLInputElement).value } })} /></label>
          <label>Title <input type="text" value={sel.npcData?.title ?? "<Questgiver>"} onchange={(e) => applyPatch({ npcData: { ...sel.npcData, title: (e.target as HTMLInputElement).value } })} /></label>
          <label>Model
            <select value={sel.npcData?.model ?? "Knight"} onchange={(e) => applyPatch({ npcData: { ...sel.npcData, model: (e.target as HTMLSelectElement).value } })}>
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
            <textarea rows="2" value={sel.npcData?.dialogue ?? ""} onchange={(e) => applyPatch({ npcData: { ...sel.npcData, dialogue: (e.target as HTMLTextAreaElement).value } })}></textarea>
          </label>

          <div class="quest-section">
            <div class="quest-header">
              <h4>📜 Quests Offered</h4>
              <button class="add-quest-btn" onclick={() => addQuestToNPC(sel)}>+ Add Quest</button>
            </div>

            <label class="procedural-toggle">
              <input type="checkbox" checked={sel.npcData?.generateProceduralQuests ?? true} onchange={(e) => applyPatch({ npcData: { ...sel.npcData, generateProceduralQuests: (e.target as HTMLInputElement).checked } })} />
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
        {#if sel.markerKind !== "entry"}
          <button class="delete" onclick={deleteSelected}>Delete</button>
        {/if}
      </div>
    {:else if selection.length > 1}
      <div class="properties">
        {#if selection.every((s) => s.groupId && s.groupId === selection[0]?.groupId)}
          <h3>🏠 House ({selection.length} pieces)</h3>
          <p class="hint">Move / rotate / scale moves the whole house. Delete removes all pieces.</p>
        {:else}
          <h3>{selection.length} Items Selected</h3>
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
  .dropdown-section-label {
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #64748b;
    padding: 6px 10px 2px;
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
  .properties .hint {
    margin: 0 0 10px;
    font-size: 11px;
    opacity: 0.7;
    line-height: 1.35;
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
</style>
