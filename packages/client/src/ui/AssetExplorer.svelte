<script lang="ts">
  import type { RegionAssetCategory } from "@rustcraft/shared";
  import {
    REGION_PROP_PALETTE,
    REGION_PALETTE_CATEGORIES,
    REGION_PALETTE_PACKS,
    flattenRegionPalette,
    regionAssetDisplayName,
    regionAssetUrl,
    regionGroupPack,
    type RegionPaletteAsset,
  } from "../render/regionPropPalette";
  import { load } from "../render/gltf";
  import { deleteGlbAsset, importGlbAsset } from "../render/assetImport";
  import { importedPaletteAssets, registerImportedAsset, unregisterImportedAsset } from "../render/importedAssets.svelte";
  import AssetThumb from "./AssetThumb.svelte";

  interface Props {
    open: boolean;
    armedModel?: string | null;
    onClose: () => void;
    onPick: (model: string, category: RegionAssetCategory) => void;
  }

  let { open, armedModel = null, onClose, onPick }: Props = $props();

  const allAssets = $derived<RegionPaletteAsset[]>([...importedPaletteAssets(), ...flattenRegionPalette()]);

  interface ImportStatusEntry {
    id: number;
    name: string;
    state: "uploading" | "done" | "error";
    message: string;
  }
  let importCategory = $state<RegionAssetCategory>("prop");
  let dragActive = $state(false);
  let importStatus = $state<ImportStatusEntry[]>([]);
  let importSeq = 0;
  let fileInput: HTMLInputElement | null = $state(null);
  let deletingKey = $state<string | null>(null);

  async function handleDelete(asset: RegionPaletteAsset): Promise<void> {
    const key = asset.category + ":" + asset.model;
    if (deletingKey) return;
    if (!confirm(`Delete "${regionAssetDisplayName(asset.model)}"? This removes the uploaded file and its collision data.`)) {
      return;
    }
    deletingKey = key;
    const result = await deleteGlbAsset(asset.model, asset.category);
    deletingKey = null;
    if (result.ok) {
      unregisterImportedAsset(asset.model, asset.category);
    } else {
      const errorEntry: ImportStatusEntry = {
        id: ++importSeq,
        name: regionAssetDisplayName(asset.model),
        state: "error",
        message: result.message ?? "Delete failed.",
      };
      importStatus = [errorEntry, ...importStatus].slice(0, 20);
    }
  }

  function updateImportStatus(id: number, patch: Partial<ImportStatusEntry>): void {
    importStatus = importStatus.map((s) => (s.id === id ? { ...s, ...patch } : s));
  }

  async function importFiles(files: Iterable<File>): Promise<void> {
    const list = [...files].filter((f) => /\.glb$/i.test(f.name));
    if (list.length === 0) return;
    const armLast = list.length === 1;
    for (const file of list) {
      const id = ++importSeq;
      const newEntry: ImportStatusEntry = { id, name: file.name, state: "uploading", message: "Uploading…" };
      importStatus = [newEntry, ...importStatus].slice(0, 20);
      const result = await importGlbAsset(file, importCategory);
      if (result.ok) {
        registerImportedAsset(result.model, result.category);
        updateImportStatus(id, { message: "Uploaded — preloading…" });
        // Warm this tab's shared GLTF cache (render/gltf.ts) right now, not
        // whenever a placed instance first scrolls into view during actual
        // gameplay -- that's the load that was stuttering. Region entry's own
        // preloadRegionAssets() would eventually cover it too, but only on a
        // fresh mount; this makes it instant for the rest of THIS session
        // (editor placement, then walking over to it in Play) regardless.
        const preloaded = await load(regionAssetUrl(result.category, result.model))
          .then(() => true)
          .catch(() => false);
        const bits = [
          result.collision.ok
            ? `collision ✓${typeof result.collision.tris === "number" ? ` (${result.collision.tris} tris)` : ""}`
            : `no collision (${result.collision.reason ?? "unavailable"})`,
          result.compression.ok
            ? result.compression.skipped
              ? "already compact"
              : "compressed ✓"
            : `uncompressed (${result.compression.reason ?? "ktx unavailable"})`,
          preloaded ? "preloaded ✓" : "preload failed",
        ];
        updateImportStatus(id, { state: "done", message: bits.join(" · ") });
        if (armLast) onPick(result.model, result.category);
      } else {
        updateImportStatus(id, { state: "error", message: result.message });
      }
    }
  }

  function onFilePicked(e: Event): void {
    const input = e.currentTarget as HTMLInputElement;
    if (input.files) void importFiles(input.files);
    input.value = "";
  }

  /** Firefox (and some Chromium builds under certain drag sources) can leave
   *  `dataTransfer.files` empty even on a genuine file drop while still
   *  populating `dataTransfer.items` -- fall back to pulling File objects out
   *  of the item list via getAsFile() when .files comes up empty. */
  function filesFromDrop(dt: DataTransfer): File[] {
    if (dt.files?.length) return [...dt.files];
    const out: File[] = [];
    for (const item of dt.items ?? []) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) out.push(f);
      }
    }
    return out;
  }

  let dragDepth = 0;

  function onDrop(e: DragEvent): void {
    e.preventDefault();
    dragDepth = 0;
    dragActive = false;
    if (e.dataTransfer) {
      const files = filesFromDrop(e.dataTransfer);
      if (files.length) void importFiles(files);
    }
  }

  function onDragEnter(e: DragEvent): void {
    e.preventDefault();
    dragDepth++;
    dragActive = true;
  }

  function onDragOver(e: DragEvent): void {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    dragActive = true;
  }

  function onDragLeave(): void {
    // The whole panel is one drop target now, but dragenter/dragleave still
    // fire per-descendant as the pointer crosses child element boundaries
    // inside it -- a depth counter is the standard way to tell "left the
    // panel entirely" from "moved over a child", so the highlight doesn't
    // flicker off while the cursor is still over the grid/cards underneath.
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dragActive = false;
  }

  let search = $state("");
  let packFilter = $state<string>("all");
  let categoryFilter = $state<RegionAssetCategory | "all">("all");
  let groupFilter = $state<string>("all");
  let searchInput: HTMLInputElement | null = $state(null);

  const groupsForFilters = $derived(
    REGION_PROP_PALETTE.filter((g) => {
      if (packFilter !== "all" && regionGroupPack(g) !== packFilter) return false;
      if (categoryFilter !== "all" && g.category !== categoryFilter) return false;
      return true;
    }).map((g) => g.label),
  );

  const filtered = $derived.by((): RegionPaletteAsset[] => {
    const q = search.trim().toLowerCase();
    return allAssets.filter((a) => {
      if (packFilter !== "all" && a.pack !== packFilter) return false;
      if (categoryFilter !== "all" && a.category !== categoryFilter) return false;
      if (groupFilter !== "all" && a.group !== groupFilter) return false;
      if (!q) return true;
      const name = regionAssetDisplayName(a.model).toLowerCase();
      return (
        name.includes(q) ||
        a.model.toLowerCase().includes(q) ||
        a.group.toLowerCase().includes(q) ||
        a.pack.toLowerCase().includes(q) ||
        a.category.toLowerCase().includes(q)
      );
    });
  });

  $effect(() => {
    if (!open) return;
    if (groupFilter !== "all" && !groupsForFilters.includes(groupFilter)) {
      groupFilter = "all";
    }
  });

  $effect(() => {
    if (!open) return;
    queueMicrotask(() => searchInput?.focus());
  });

  function shortGroupLabel(label: string): string {
    return label.replace(/^(FV|CP|KH|MV|SN) · /, "");
  }
</script>

{#if open}
  <div
    class="explorer-backdrop"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}
  >
    <div
      class="explorer"
      class:drag-active={dragActive}
      role="dialog"
      aria-modal="true"
      aria-label="Asset Explorer"
      tabindex="-1"
      ondragenter={onDragEnter}
      ondragover={onDragOver}
      ondragleave={onDragLeave}
      ondrop={onDrop}
    >
      {#if dragActive}
        <div class="drop-overlay">Drop .glb to import as <strong>{importCategory}</strong></div>
      {/if}
      <header class="explorer-header">
        <div class="title-block">
          <h2>Asset Explorer</h2>
          <span class="count">{filtered.length} / {allAssets.length}</span>
        </div>
        <label class="search">
          <span class="sr-only">Search assets</span>
          <input
            type="search"
            placeholder="Search assets…"
            bind:value={search}
            bind:this={searchInput}
          />
        </label>
        <button type="button" class="close" onclick={onClose}>Close</button>
      </header>

      <div class="dropzone" class:active={dragActive}>
        <span class="dropzone-text">Drag &amp; drop .glb files anywhere in this panel to import{dragActive ? "…" : ""}</span>
        <div class="dropzone-actions">
          <label class="category-select">
            <span class="sr-only">Import as category</span>
            <select bind:value={importCategory}>
              <option value="prop">Prop</option>
              <option value="foliage">Foliage</option>
              <option value="building">Building</option>
            </select>
          </label>
          <button type="button" onclick={() => fileInput?.click()}>Import GLB…</button>
          <input
            type="file"
            accept=".glb"
            multiple
            bind:this={fileInput}
            onchange={onFilePicked}
            style="display: none;"
          />
        </div>
      </div>
      {#if importStatus.length > 0}
        <ul class="import-status">
          {#each importStatus as s (s.id)}
            <li class={s.state}>
              <span class="status-name">{s.name}</span>
              <span class="status-msg">{s.message}</span>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="filters">
        <div class="filter-row filter-row-pack">
          <span class="filter-label">Pack</span>
          <div class="chips">
            {#each REGION_PALETTE_PACKS as pack}
              <button
                type="button"
                class:active={packFilter === pack.id}
                onclick={() => {
                  packFilter = pack.id;
                  groupFilter = "all";
                }}
              >
                {pack.label}
              </button>
            {/each}
          </div>
        </div>
        <div class="filter-row">
          <span class="filter-label">Category</span>
          <div class="chips">
            {#each REGION_PALETTE_CATEGORIES as cat}
              <button
                type="button"
                class:active={categoryFilter === cat.id}
                onclick={() => {
                  categoryFilter = cat.id;
                  groupFilter = "all";
                }}
              >
                {cat.label}
              </button>
            {/each}
          </div>
        </div>
        <div class="filter-row">
          <span class="filter-label">Group</span>
          <select bind:value={groupFilter}>
            <option value="all">All groups</option>
            {#each groupsForFilters as label}
              <option value={label}>{shortGroupLabel(label)}</option>
            {/each}
          </select>
        </div>
      </div>

      <div class="grid-wrap">
        {#if filtered.length === 0}
          <div class="empty">No assets match your search.</div>
        {:else}
          <div class="grid">
            {#each filtered as asset (asset.category + ":" + asset.model)}
              <div
                class="card"
                class:active={armedModel === asset.model}
                role="button"
                tabindex="0"
                title="{asset.pack} · {asset.group} · {asset.model}"
                onclick={() => onPick(asset.model, asset.category)}
                onkeydown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onPick(asset.model, asset.category);
                  }
                }}
              >
                {#if asset.pack === "Imported"}
                  <button
                    type="button"
                    class="card-delete"
                    disabled={deletingKey === asset.category + ":" + asset.model}
                    title="Delete imported asset"
                    onclick={(e) => {
                      e.stopPropagation();
                      void handleDelete(asset);
                    }}
                  >
                    {deletingKey === asset.category + ":" + asset.model ? "…" : "×"}
                  </button>
                {/if}
                <AssetThumb category={asset.category} model={asset.model} size={88} />
                <span class="name">{regionAssetDisplayName(asset.model)}</span>
                <span class="meta">{shortGroupLabel(asset.group)}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .explorer-backdrop {
    position: absolute;
    inset: 0;
    z-index: 40;
    background: rgba(8, 10, 14, 0.55);
    display: flex;
    padding: 12px;
  }
  .explorer {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: #161a22;
    border: 1px solid #2e3545;
    border-radius: 10px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
    overflow: hidden;
  }
  .explorer.drag-active {
    border-color: #5c8fc9;
    box-shadow: 0 0 0 2px #5c8fc9 inset, 0 16px 48px rgba(0, 0, 0, 0.55);
  }
  .drop-overlay {
    position: absolute;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(28, 60, 94, 0.35);
    color: #e8eef7;
    font-size: 16px;
    font-weight: 600;
    pointer-events: none;
  }
  .explorer-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid #2a3140;
    background: #1a1f29;
    flex-shrink: 0;
  }
  .title-block {
    display: flex;
    align-items: baseline;
    gap: 10px;
    min-width: 160px;
  }
  .title-block h2 {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
    color: #e8eef7;
  }
  .count {
    font-size: 11px;
    color: #8fa3ba;
  }
  .search {
    flex: 1;
  }
  .search input {
    width: 100%;
    background: #0e141d;
    border: 1px solid #3a4152;
    color: #dce6f2;
    border-radius: 6px;
    padding: 8px 12px;
    font-size: 13px;
  }
  .search input:focus {
    outline: none;
    border-color: #5c8fc9;
  }
  .close {
    background: #2a3344;
    border: 1px solid #3a4558;
    color: #dce6f2;
    border-radius: 6px;
    padding: 7px 12px;
    cursor: pointer;
    font-size: 12px;
  }
  .close:hover {
    background: #364155;
  }
  .dropzone {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin: 10px 14px 0;
    padding: 10px 12px;
    border: 1.5px dashed #3a4152;
    border-radius: 8px;
    background: #181c25;
    flex-shrink: 0;
  }
  .dropzone.active {
    border-color: #5c8fc9;
    background: #1d2636;
  }
  .dropzone-text {
    font-size: 12px;
    color: #8fa3ba;
  }
  .dropzone-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .dropzone-actions select {
    background: #0e141d;
    border: 1px solid #3a4152;
    color: #dce6f2;
    border-radius: 6px;
    padding: 5px 8px;
    font-size: 12px;
  }
  .dropzone-actions button {
    background: #2f6fad;
    border: 1px solid #5c8fc9;
    color: #fff;
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  .dropzone-actions button:hover {
    background: #3a7fc0;
  }
  .import-status {
    list-style: none;
    margin: 8px 14px 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 96px;
    overflow-y: auto;
    flex-shrink: 0;
  }
  .import-status li {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    font-size: 11px;
    padding: 5px 9px;
    border-radius: 5px;
    background: #1c212c;
    border: 1px solid #2c3342;
  }
  .import-status li.uploading {
    color: #8fa3ba;
  }
  .import-status li.done {
    color: #8fd19e;
    border-color: #2f5c3f;
  }
  .import-status li.error {
    color: #e88b8b;
    border-color: #5c3232;
  }
  .status-name {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .status-msg {
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .filters {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid #242a36;
    background: #181c25;
    flex-shrink: 0;
  }
  .filter-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .filter-row-pack {
    align-items: flex-start;
  }
  .filter-row-pack .chips {
    flex: 1;
  }
  .filter-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: #7b8aa0;
    min-width: 58px;
    padding-top: 5px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chips button {
    background: #222836;
    border: 1px solid #323a4a;
    color: #c5d0e0;
    border-radius: 999px;
    padding: 4px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .chips button.active {
    background: #2f6fad;
    border-color: #5c8fc9;
    color: #fff;
  }
  .filters select {
    background: #0e141d;
    border: 1px solid #3a4152;
    color: #dce6f2;
    border-radius: 6px;
    padding: 5px 8px;
    font-size: 12px;
    min-width: 200px;
  }
  .grid-wrap {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 12px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(118px, 1fr));
    gap: 10px;
  }
  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    background: #1c212c;
    border: 1px solid #2c3342;
    border-radius: 8px;
    padding: 8px;
    cursor: pointer;
    color: inherit;
    text-align: left;
  }
  .card-delete {
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 1;
    width: 20px;
    height: 20px;
    line-height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(20, 12, 14, 0.85);
    border: 1px solid #5c3232;
    color: #e88b8b;
    border-radius: 5px;
    font-size: 13px;
    cursor: pointer;
    padding: 0;
  }
  .card-delete:hover {
    background: #5c3232;
    color: #fff;
  }
  .card-delete:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .card:hover {
    border-color: #4a90e2;
    background: #222836;
  }
  .card.active {
    border-color: #5c8fc9;
    box-shadow: 0 0 0 1px #5c8fc9 inset;
    background: #24344a;
  }
  .name {
    font-size: 11px;
    font-weight: 600;
    color: #e2e8f0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta {
    font-size: 10px;
    color: #7b8aa0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .empty {
    padding: 48px 16px;
    text-align: center;
    color: #8fa3ba;
    font-size: 13px;
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
</style>
