<script lang="ts">
  import type { RegionAssetCategory } from "@rustcraft/shared";
  import {
    REGION_PROP_PALETTE,
    REGION_PALETTE_CATEGORIES,
    REGION_PALETTE_PACKS,
    flattenRegionPalette,
    regionAssetDisplayName,
    regionGroupPack,
    type RegionPaletteAsset,
  } from "../render/regionPropPalette";
  import AssetThumb from "./AssetThumb.svelte";

  interface Props {
    open: boolean;
    armedModel?: string | null;
    onClose: () => void;
    onPick: (model: string, category: RegionAssetCategory) => void;
  }

  let { open, armedModel = null, onClose, onPick }: Props = $props();

  const allAssets = flattenRegionPalette();

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
    <div class="explorer" role="dialog" aria-modal="true" aria-label="Asset Explorer">
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
              <button
                type="button"
                class="card"
                class:active={armedModel === asset.model}
                title="{asset.pack} · {asset.group} · {asset.model}"
                onclick={() => onPick(asset.model, asset.category)}
              >
                <AssetThumb category={asset.category} model={asset.model} size={88} />
                <span class="name">{regionAssetDisplayName(asset.model)}</span>
                <span class="meta">{shortGroupLabel(asset.group)}</span>
              </button>
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
