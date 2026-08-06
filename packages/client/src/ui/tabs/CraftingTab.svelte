<script lang="ts">
  import { game } from "../gameState.svelte";
  import { getGame } from "../../game/instance";
  import { sound } from "../../game/sound";
  import { itemIcon } from "../icons";
  import IconGlyph from "../IconGlyph.svelte";
  import {
    RECIPES,
    itemDef,
    type ItemSnap,
    type RecipeDef,
  } from "@rustcraft/shared";

  let {
    invSlots,
    showItemTooltip,
    hideItemTooltip,
  }: {
    invSlots: (ItemSnap | undefined)[];
    showItemTooltip: (itemId: string, durability: number | null, e: MouseEvent) => void;
    hideItemTooltip: () => void;
  } = $props();

  let craftSearch = $state("");
  let craftCategory = $state<"all" | "weapons" | "armor" | "consumables" | "tools" | "reagents" | "station">("all");
  let craftHaveMaterialsOnly = $state(false);
  let selectedRecipeId = $state<string>("bandage");
  let craftCount = $state(1);
  let isCrafting = $state(false);
  let craftProgress = $state(0);

  const allRecipes = Object.values(RECIPES);

  function getRecipeCategory(recipe: RecipeDef): "weapons" | "armor" | "consumables" | "tools" | "reagents" | "station" {
    if (recipe.station) return "station";
    const outDef = itemDef(recipe.output);
    if (!outDef) return "reagents";
    const t = outDef.type;
    if (t === "weapon") return "weapons";
    if (t === "armor" || t === "head" || t === "chest" || t === "legs" || t === "feet" || t === "shoulders") return "armor";
    if (t === "potion" || t === "consumable" || t === "food") return "consumables";
    if (t === "tool" || t === "bag" || t === "mount") return "tools";
    return "reagents";
  }

  function getOwnedQty(itemId: string): number {
    let total = 0;
    for (const item of game.inventory) {
      if ((item.container === "inventory" || item.container === "hotbar") && item.itemId === itemId) {
        total += item.qty;
      }
    }
    return total;
  }

  function maxCraftable(recipe: RecipeDef): number {
    let max = Infinity;
    for (const ing of recipe.ingredients) {
      const owned = getOwnedQty(ing.itemId);
      const possible = Math.floor(owned / Math.max(1, ing.qty));
      if (possible < max) max = possible;
    }
    return max === Infinity ? 0 : max;
  }

  function canCraftRecipe(recipe: RecipeDef, count = 1): boolean {
    for (const ing of recipe.ingredients) {
      if (getOwnedQty(ing.itemId) < ing.qty * count) return false;
    }
    return true;
  }

  const filteredRecipes = $derived.by(() => {
    return allRecipes.filter((r) => {
      const outDef = itemDef(r.output);
      const name = outDef?.name ?? r.output;
      if (craftSearch && !name.toLowerCase().includes(craftSearch.toLowerCase())) return false;
      if (craftCategory !== "all" && getRecipeCategory(r) !== craftCategory) return false;
      if (craftHaveMaterialsOnly && maxCraftable(r) <= 0) return false;
      return true;
    });
  });

  const selectedRecipe = $derived(allRecipes.find((r) => r.id === selectedRecipeId) ?? allRecipes[0]);

  function startCrafting(recipe: RecipeDef, count: number) {
    if (isCrafting || !canCraftRecipe(recipe, count)) return;
    isCrafting = true;
    craftProgress = 0;
    sound.play("ui");

    let progress = 0;
    const interval = setInterval(() => {
      progress += 0.15;
      craftProgress = Math.min(1, progress);
      if (progress >= 1) {
        clearInterval(interval);
        isCrafting = false;
        craftProgress = 0;
        const g = getGame();
        for (let i = 0; i < count; i++) {
          g?.sendCraft(recipe.id);
        }
        const outDef = itemDef(recipe.output);
        game.toast(`Crafted ${count * recipe.outputQty}x ${outDef.name}!`);
        sound.play("craft");
      }
    }, 80);
  }
</script>

<div class="wow-craft-workbench">
  <!-- Left Column: Recipe Directory & Filter Controls -->
  <div class="col craft-recipes-col">
    <div class="craft-search-box">
      <input
        type="text"
        placeholder="🔍 Search recipes..."
        bind:value={craftSearch}
        class="craft-search-input"
      />
    </div>
    <div class="craft-filter-bar">
      <button class="filter-pill" class:active={craftCategory === "all"} onclick={() => (craftCategory = "all")}>All</button>
      <button class="filter-pill" class:active={craftCategory === "weapons"} onclick={() => (craftCategory = "weapons")}>Weapons</button>
      <button class="filter-pill" class:active={craftCategory === "armor"} onclick={() => (craftCategory = "armor")}>Armor</button>
      <button class="filter-pill" class:active={craftCategory === "consumables"} onclick={() => (craftCategory = "consumables")}>Potions</button>
      <button class="filter-pill" class:active={craftCategory === "tools"} onclick={() => (craftCategory = "tools")}>Tools</button>
      <button class="filter-pill" class:active={craftCategory === "reagents"} onclick={() => (craftCategory = "reagents")}>Reagents</button>
    </div>
    <label class="craft-mat-toggle">
      <input type="checkbox" bind:checked={craftHaveMaterialsOnly} />
      <span>Have Materials Only</span>
    </label>

    <div class="recipe-list-scroll">
      {#each filteredRecipes as recipe (recipe.id)}
        {@const outDef = itemDef(recipe.output)}
        {@const maxCount = maxCraftable(recipe)}
        <button
          type="button"
          class="recipe-row"
          class:active={selectedRecipeId === recipe.id}
          class:craftable={maxCount > 0}
          onclick={() => {
            selectedRecipeId = recipe.id;
            craftCount = 1;
          }}
        >
          <div class="recipe-icon-wrapper">
            <IconGlyph value={itemIcon(recipe.output)} size={26} itemId={recipe.output} />
          </div>
          <div class="recipe-row-meta">
            <span class="recipe-name">{outDef.name}</span>
            <span class="recipe-sub">{outDef.type}</span>
          </div>
          {#if maxCount > 0}
            <span class="craftable-badge">({maxCount})</span>
          {/if}
          {#if recipe.station}
            <span class="station-icon" title="Requires {recipe.station}">🔥</span>
          {/if}
        </button>
      {/each}
    </div>
  </div>

  <!-- Center Column: Selected Recipe Detail & Workbench -->
  <div class="col craft-detail-col">
    {#if selectedRecipe}
      {@const outDef = itemDef(selectedRecipe.output)}
      {@const maxCount = maxCraftable(selectedRecipe)}
      <div class="craft-header-card">
        <div class="out-icon-box">
          <IconGlyph value={itemIcon(selectedRecipe.output)} size={48} itemId={selectedRecipe.output} />
          {#if selectedRecipe.outputQty > 1}
            <span class="out-qty">x{selectedRecipe.outputQty}</span>
          {/if}
        </div>
        <div class="out-title-box">
          <h2>{outDef.name}</h2>
          <div class="out-meta">{outDef.type} • Yields {selectedRecipe.outputQty}</div>
          <p class="out-desc">{outDef.description ?? "Crafted item component."}</p>
        </div>
      </div>

      {#if selectedRecipe.station}
        <div class="station-banner">
          ⚠️ Requires standing near a <strong>{selectedRecipe.station}</strong>
        </div>
      {/if}

      <div class="reagents-section">
        <h3>Reagents Required</h3>
        <div class="reagents-grid">
          {#each selectedRecipe.ingredients as ing (ing.itemId)}
            {@const ingDef = itemDef(ing.itemId)}
            {@const owned = getOwnedQty(ing.itemId)}
            {@const reqTotal = ing.qty * craftCount}
            {@const hasEnough = owned >= reqTotal}
            <div class="reagent-card" class:has-enough={hasEnough} class:missing={!hasEnough}>
              <div class="reagent-icon">
                <IconGlyph value={itemIcon(ing.itemId)} size={32} itemId={ing.itemId} />
              </div>
              <div class="reagent-info">
                <span class="reagent-name">{ingDef.name}</span>
                <span class="reagent-count" class:green={hasEnough} class:red={!hasEnough}>
                  {owned} / {reqTotal}
                </span>
              </div>
              <span class="reagent-status">{hasEnough ? "✓" : "✗"}</span>
            </div>
          {/each}
        </div>
      </div>

      <!-- Quantity Selector & Action Controls -->
      <div class="craft-action-panel">
        <div class="qty-selector">
          <button class="qty-btn" disabled={craftCount <= 1} onclick={() => (craftCount = Math.max(1, craftCount - 1))}>-</button>
          <span class="qty-val">{craftCount}</span>
          <button class="qty-btn" disabled={craftCount >= Math.max(1, maxCount)} onclick={() => (craftCount = Math.min(Math.max(1, maxCount), craftCount + 1))}>+</button>
          <button class="qty-btn max" disabled={maxCount <= 0} onclick={() => (craftCount = Math.max(1, maxCount))}>Max ({maxCount})</button>
        </div>

        <div class="craft-buttons-row">
          <button
            class="craft-btn primary"
            disabled={!canCraftRecipe(selectedRecipe, craftCount) || isCrafting}
            onclick={() => startCrafting(selectedRecipe, craftCount)}
          >
            Craft [{craftCount}]
          </button>
          <button
            class="craft-btn secondary"
            disabled={maxCount <= 0 || isCrafting}
            onclick={() => startCrafting(selectedRecipe, maxCount)}
          >
            Craft All ({maxCount})
          </button>
        </div>

        {#if isCrafting}
          <div class="crafting-progress-bar">
            <div class="crafting-fill" style="width: {craftProgress * 100}%"></div>
            <span>Crafting {outDef.name}...</span>
          </div>
        {/if}
      </div>
    {:else}
      <div class="empty-craft-state">
        <span>🔨 Select a recipe from the directory to start crafting.</span>
      </div>
    {/if}
  </div>

  <!-- Right Column: Materials & Backpack Drawer -->
  <div class="col craft-materials-col">
    <h3>Backpack & Reagents</h3>
    <div class="materials-grid">
      {#each invSlots as item, i (i)}
        <div
          class="mat-cell"
          onmouseenter={(e) => item && showItemTooltip(item.itemId, item.durability, e)}
          onmouseleave={hideItemTooltip}
        >
          {#if item}
            <IconGlyph value={itemIcon(item.itemId)} size={26} itemId={item.itemId} />
            {#if item.qty > 1}<span class="qty">{item.qty}</span>{/if}
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .wow-craft-workbench {
    display: flex;
    width: 100%;
    height: 100%;
    gap: 12px;
    padding: 12px;
    box-sizing: border-box;
    overflow: hidden;
  }
  .craft-recipes-col {
    width: 320px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: rgba(12, 9, 16, 0.85);
    border: 1px solid rgba(196, 163, 90, 0.3);
    border-radius: 6px;
    padding: 10px;
    flex-shrink: 0;
  }
  .craft-search-input {
    width: 100%;
    box-sizing: border-box;
    padding: 6px 10px;
    background: rgba(0, 0, 0, 0.6);
    border: 1px solid var(--rc-gold-dim);
    border-radius: 4px;
    color: var(--rc-parchment);
    font-size: 12px;
  }
  .craft-filter-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .filter-pill {
    padding: 3px 8px;
    font-size: 10px;
    font-weight: 700;
    color: var(--rc-gold-dim);
    background: rgba(30, 22, 38, 0.8);
    border: 1px solid rgba(196, 163, 90, 0.3);
    border-radius: 3px;
    cursor: pointer;
  }
  .filter-pill:hover,
  .filter-pill.active {
    color: var(--rc-gold-bright);
    border-color: var(--rc-gold-bright);
    background: rgba(74, 53, 92, 0.9);
  }
  .craft-mat-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--rc-parchment);
    cursor: pointer;
  }
  .recipe-list-scroll {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-right: 4px;
  }
  .recipe-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: rgba(20, 15, 26, 0.7);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
  }
  .recipe-row:hover,
  .recipe-row.active {
    border-color: var(--rc-gold-bright);
    background: rgba(50, 36, 64, 0.85);
  }
  .recipe-row-meta {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .recipe-name {
    font-size: 12px;
    font-weight: 700;
    color: var(--rc-parchment);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .recipe-sub {
    font-size: 10px;
    color: var(--rc-gold-dim);
    text-transform: capitalize;
  }
  .craftable-badge {
    font-size: 11px;
    font-weight: 800;
    color: #4ade80;
    background: rgba(74, 222, 128, 0.15);
    padding: 2px 6px;
    border-radius: 4px;
  }

  .craft-detail-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: rgba(12, 9, 16, 0.85);
    border: 1px solid rgba(196, 163, 90, 0.3);
    border-radius: 6px;
    padding: 16px;
    overflow-y: auto;
  }
  .craft-header-card {
    display: flex;
    gap: 14px;
    align-items: center;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(196, 163, 90, 0.3);
    border-radius: 6px;
    padding: 12px;
  }
  .out-title-box h2 {
    margin: 0;
    font-family: var(--rc-display);
    font-size: 18px;
    color: var(--rc-gold-bright);
  }
  .out-meta {
    font-size: 11px;
    color: var(--rc-parchment);
    opacity: 0.8;
  }
  .out-desc {
    margin: 4px 0 0 0;
    font-size: 12px;
    color: #94a3b8;
  }
  .station-banner {
    background: rgba(234, 179, 8, 0.15);
    border: 1px solid rgba(234, 179, 8, 0.4);
    color: #fef08a;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 12px;
  }
  .reagents-section h3 {
    margin: 0 0 8px 0;
    font-family: var(--rc-display);
    font-size: 13px;
    color: var(--rc-gold-bright);
  }
  .reagents-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 8px;
  }
  .reagent-card {
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(20, 15, 26, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    padding: 8px 10px;
  }
  .reagent-card.has-enough {
    border-color: rgba(74, 222, 128, 0.4);
  }
  .reagent-card.missing {
    border-color: rgba(248, 113, 113, 0.4);
    background: rgba(40, 10, 10, 0.6);
  }
  .reagent-info {
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .reagent-name {
    font-size: 12px;
    font-weight: 700;
    color: var(--rc-parchment);
  }
  .reagent-count.green {
    color: #4ade80;
  }
  .reagent-count.red {
    color: #f87171;
  }
  .craft-action-panel {
    margin-top: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(196, 163, 90, 0.3);
    border-radius: 6px;
    padding: 12px;
  }
  .qty-selector {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .qty-btn {
    background: linear-gradient(180deg, #2b1f35, #140d1a);
    border: 1px solid var(--rc-gold-dim);
    color: var(--rc-gold-bright);
    font-size: 13px;
    font-weight: 700;
    padding: 4px 12px;
    border-radius: 4px;
    cursor: pointer;
  }
  .qty-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .qty-val {
    font-size: 14px;
    font-weight: 800;
    color: #fff;
    min-width: 24px;
    text-align: center;
  }
  .craft-buttons-row {
    display: flex;
    gap: 10px;
  }
  .craft-btn.primary {
    flex: 1;
    padding: 10px;
    font-family: var(--rc-display);
    font-size: 14px;
    font-weight: 800;
    background: linear-gradient(180deg, #8a6423, #4a340e);
    border: 1px solid var(--rc-gold-bright);
    color: #fff;
    border-radius: 4px;
    cursor: pointer;
    box-shadow: 0 0 12px rgba(255, 215, 0, 0.3);
  }
  .craft-btn.secondary {
    flex: 1;
    padding: 10px;
    font-family: var(--rc-display);
    font-size: 14px;
    font-weight: 800;
    background: linear-gradient(180deg, #322540, #181022);
    border: 1px solid var(--rc-gold-dim);
    color: var(--rc-parchment);
    border-radius: 4px;
    cursor: pointer;
  }
  .crafting-progress-bar {
    position: relative;
    height: 18px;
    background: rgba(0, 0, 0, 0.8);
    border: 1px solid var(--rc-gold-bright);
    border-radius: 4px;
    overflow: hidden;
  }
  .crafting-fill {
    height: 100%;
    background: linear-gradient(90deg, #b88f3a, #ffd700);
  }
  .crafting-progress-bar span {
    position: absolute;
    inset: 0;
    text-align: center;
    font-size: 11px;
    font-weight: 700;
    color: #000;
    line-height: 18px;
  }
  .craft-materials-col {
    width: 260px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: rgba(12, 9, 16, 0.85);
    border: 1px solid rgba(196, 163, 90, 0.3);
    border-radius: 6px;
    padding: 10px;
    flex-shrink: 0;
  }
  .materials-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
    overflow-y: auto;
  }
  .mat-cell {
    position: relative;
    width: 48px;
    height: 48px;
    background: rgba(0, 0, 0, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .col {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  h3 {
    margin: 0 0 8px;
    font-family: var(--rc-display);
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: var(--rc-gold);
  }
</style>
