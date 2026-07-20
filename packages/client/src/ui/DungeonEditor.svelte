<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "./appState.svelte";
  import { DUNGEON_TIERS, generateRandomDungeonBlueprint, type DungeonBlueprint } from "@rustcraft/shared";
  import {
    DungeonEditorScene,
    type EditorSelection,
    type EditorTransformMode,
    type EditorMarkerKind,
  } from "../render/DungeonEditorScene";
  import { DUNGEON_PROP_PALETTE } from "../render/dungeonPropPalette";

  let canvas: HTMLCanvasElement;
  let fileInput: HTMLInputElement;
  let scene: DungeonEditorScene | null = null;

  let tier = $state(DUNGEON_TIERS[0]?.tier ?? 0);
  let selection = $state<EditorSelection[]>([]);
  let transformMode = $state<EditorTransformMode>("translate");
  let snapEnabled = $state(true);
  let armedModel = $state<string | null>(null);
  let armedMarker = $state<EditorMarkerKind | null>(null);
  let openGroups = $state<Set<string>>(new Set([DUNGEON_PROP_PALETTE[0]?.label ?? ""]));
  let status = $state<string | null>(null);
  let marqueeBox = $state<{ startX: number; startY: number; endX: number; endY: number } | null>(null);

  let saveTimeout: number | null = null;
  function scheduleSave(): void {
    if (saveTimeout !== null) window.clearTimeout(saveTimeout);
    saveTimeout = window.setTimeout(() => {
      void saveToServer();
    }, 1000);
  }

  onMount(() => {
    scene = new DungeonEditorScene(
      canvas,
      (sel) => {
        selection = sel;
      },
      () => {
        scheduleSave();
      },
      (box) => {
        marqueeBox = box;
      }
    );
    void loadFromServer();
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

  function pickModel(model: string): void {
    armedMarker = null;
    armedModel = model;
    scene?.armPlacement(model);
  }

  function pickMarker(kind: EditorMarkerKind): void {
    armedModel = null;
    armedMarker = kind;
    scene?.armMarkerPlacement(kind);
  }

  function cancelArmed(): void {
    armedModel = null;
    armedMarker = null;
    scene?.disarm();
  }

  function setMode(mode: EditorTransformMode): void {
    transformMode = mode;
    scene?.setTransformMode(mode);
    cancelArmed();
  }

  function toggleSnap(): void {
    snapEnabled = !snapEnabled;
    scene?.setSnapEnabled(snapEnabled);
  }

  function applyPatch(patch: Partial<EditorSelection>): void {
    scene?.updateSelectedProps(patch);
  }

  function deleteSelected(): void {
    scene?.deleteSelected();
  }

  async function loadFromServer(): Promise<void> {
    status = "Loading...";
    try {
      const res = await fetch(app.apiUrl(`/api/debug/dungeon-blueprint?tier=${tier}`), { credentials: "include" });
      if (!res.ok) {
        status = "No saved blueprint for this tier yet -- starting blank.";
        await scene?.loadBlueprint({ assets: [], mobSpawns: [], chests: [], entryLocal: { x: 0, z: 0 } });
        return;
      }
      const data = (await res.json()) as { blueprint: DungeonBlueprint };
      await scene?.loadBlueprint(data.blueprint);
      scene?.initHistory();
      status = `Loaded tier ${tier}.`;
    } catch {
      status = "Failed to load from server.";
    }
  }

  async function generateDraft(): Promise<void> {
    if (!scene) return;
    const seed = `${tier}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    status = "Generating draft...";
    await scene.loadBlueprint(generateRandomDungeonBlueprint(seed));
    scene.initHistory();
    status = "Generated a rough draft -- review and fix up stairs/walls, then Save.";
  }

  async function saveToServer(): Promise<void> {
    if (!scene) return;
    status = "Saving...";
    const blueprint = scene.exportBlueprint();
    try {
      const res = await fetch(app.apiUrl("/api/debug/dungeon-blueprint"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ tier, blueprint }),
      });
      status = res.ok ? `Saved tier ${tier} (${blueprint.assets.length} assets).` : "Save failed.";
    } catch {
      status = "Save failed.";
    }
  }

  function exportJson(): void {
    if (!scene) return;
    const blueprint = scene.exportBlueprint();
    const blob = new Blob([JSON.stringify(blueprint, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dungeon-tier-${tier}.json`;
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
      const blueprint = JSON.parse(text) as DungeonBlueprint;
      await scene?.loadBlueprint(blueprint);
      status = `Imported ${blueprint.assets.length} assets from file.`;
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
  <div class="toolbar">
    <button onclick={exitEditor} title="Leave editor">&larr; Exit</button>
    <label class="tier-select">
      Dungeon tier
      <select bind:value={tier} onchange={loadFromServer}>
        {#each DUNGEON_TIERS as t (t.tier)}
          <option value={t.tier}>{t.tier} -- {t.zoneName}</option>
        {/each}
      </select>
    </label>
    <button onclick={generateDraft} title="Scaffold a rough procedural draft to hand-fix">Generate</button>

    <div class="group">
      <button class:active={transformMode === "translate"} onclick={() => setMode("translate")}>Move</button>
      <button class:active={transformMode === "rotate"} onclick={() => setMode("rotate")}>Rotate</button>
      <button class:active={transformMode === "scale"} onclick={() => setMode("scale")}>Scale</button>
    </div>

    <label class="snap">
      <input type="checkbox" checked={snapEnabled} onchange={toggleSnap} />
      Snap to grid
    </label>

    <div class="group markers">
      <button class:active={armedMarker === "mobSpawn"} onclick={() => pickMarker("mobSpawn")}>+ Mob Spawn</button>
      <button class:active={armedMarker === "chest"} onclick={() => pickMarker("chest")}>+ Chest</button>
      <button class:active={armedMarker === "entry"} onclick={() => pickMarker("entry")}>+ Entry Point</button>
    </div>

    <div class="spacer"></div>
    <button onclick={saveToServer}>Save</button>
    <button onclick={exportJson}>Export</button>
    <button onclick={importJson}>Import</button>
    <input bind:this={fileInput} type="file" accept="application/json" class="hidden-file" onchange={onFileSelected} />
    {#if status}<span class="status">{status}</span>{/if}
  </div>

  <div class="body">
    <div class="palette">
      {#each DUNGEON_PROP_PALETTE as group (group.label)}
        <div class="palette-group">
          <button class="palette-group-header" onclick={() => toggleGroup(group.label)}>
            {openGroups.has(group.label) ? "▾" : "▸"} {group.label}
          </button>
          {#if openGroups.has(group.label)}
            <div class="palette-items">
              {#each group.models as model (model)}
                <button class:active={armedModel === model} onclick={() => pickModel(model)}>
                  {model.replace(/\.gltf$/, "")}
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

    {#if selection.length === 1}
      {@const sel = selection[0]!}
      <div class="properties">
        <h3>{sel.kind === "asset" ? sel.model?.replace(/\.gltf$/, "") : sel.markerKind}</h3>
        <label>X <input type="number" step="0.1" value={sel.x} onchange={(e) => applyPatch({ x: Number((e.target as HTMLInputElement).value) })} /></label>
        <label>Y <input type="number" step="0.1" value={sel.y} onchange={(e) => applyPatch({ y: Number((e.target as HTMLInputElement).value) })} /></label>
        <label>Z <input type="number" step="0.1" value={sel.z} onchange={(e) => applyPatch({ z: Number((e.target as HTMLInputElement).value) })} /></label>
        {#if sel.kind === "asset"}
          <label>Yaw <input type="number" step="0.01" value={sel.yaw} onchange={(e) => applyPatch({ yaw: Number((e.target as HTMLInputElement).value) })} /></label>
          <label>Scale <input type="number" step="0.05" value={sel.scale} onchange={(e) => applyPatch({ scale: Number((e.target as HTMLInputElement).value) })} /></label>
          {#if sel.rise !== undefined}
            <label>Rise <input type="number" step="0.1" value={sel.rise} onchange={(e) => applyPatch({ rise: Number((e.target as HTMLInputElement).value) })} /></label>
          {/if}
        {/if}
        {#if sel.markerKind === "chest"}
          <label>
            Rarity
            <select value={sel.rarity} onchange={(e) => applyPatch({ rarity: (e.target as HTMLSelectElement).value as "common" | "rare" })}>
              <option value="common">Common</option>
              <option value="rare">Rare</option>
            </select>
          </label>
        {/if}
        <button class="delete" onclick={deleteSelected}>Delete</button>
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
  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: #1c2029;
    border-bottom: 1px solid #333a48;
    flex-wrap: wrap;
  }
  .toolbar button {
    background: #262b36;
    border: 1px solid #3a4152;
    color: #dce6f2;
    border-radius: 4px;
    padding: 5px 10px;
    cursor: pointer;
  }
  .toolbar button.active {
    background: #3a6ea8;
    border-color: #5c8fc9;
  }
  .toolbar .group {
    display: flex;
    gap: 4px;
  }
  .toolbar .spacer {
    flex: 1;
  }
  .tier-select,
  .snap {
    display: flex;
    align-items: center;
    gap: 6px;
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
  .properties {
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
  .properties h3 {
    margin: 0 0 6px;
    font-size: 14px;
    word-break: break-word;
  }
  .properties label {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
  }
  .properties input,
  .properties select {
    width: 110px;
    background: #0e141d;
    border: 1px solid #3a4152;
    color: #dce6f2;
    border-radius: 3px;
    padding: 3px 6px;
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
  .marquee {
    position: fixed;
    border: 1px solid #4a90e2;
    background: rgba(74, 144, 226, 0.2);
    pointer-events: none;
    z-index: 1000;
  }
  .markers button {
    font-size: 12px;
  }
</style>
