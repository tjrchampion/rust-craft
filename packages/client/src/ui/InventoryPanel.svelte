<script lang="ts">
  import { onMount } from "svelte";
  import { game } from "./gameState.svelte";
  import { getGame } from "../game/instance";
  import { itemIcon } from "./icons";
  import IconGlyph from "./IconGlyph.svelte";
  import { RECIPES, itemDef, INVENTORY_SLOTS, HOTBAR_SLOTS, EQUIP_SLOTS, type ItemSnap } from "@rustcraft/shared";

  type Section = "inv" | "hotbar" | "equip" | "craft";
  const COLS = 6;
  const INV_ROWS = INVENTORY_SLOTS / COLS;
  const recipes = Object.values(RECIPES);
  const EQUIP_LABELS: Record<string, string> = { weapon: "Weapon", head: "Head", chest: "Chest" };

  let section = $state<Section>("inv");
  let cursor = $state(0);
  let moving = $state<{ container: "inventory" | "hotbar" | "equip"; slot: number } | null>(null);

  const invSlots = $derived(
    Array.from({ length: INVENTORY_SLOTS }, (_, i) =>
      game.inventory.find((it) => it.container === "inventory" && it.slot === i),
    ),
  );
  const hotbarSlots = $derived(
    Array.from({ length: HOTBAR_SLOTS }, (_, i) =>
      game.inventory.find((it) => it.container === "hotbar" && it.slot === i),
    ),
  );
  const equipSlots = $derived(
    Array.from({ length: EQUIP_SLOTS.length }, (_, i) =>
      game.inventory.find((it) => it.container === "equip" && it.slot === i),
    ),
  );

  function count(itemId: string): number {
    return game.inventory.reduce((n, it) => (it.itemId === itemId ? n + it.qty : n), 0);
  }

  function canCraft(recipeId: string): boolean {
    const r = RECIPES[recipeId]!;
    return r.ingredients.every((ing) => count(ing.itemId) >= ing.qty);
  }

  function close(): void {
    game.inventoryOpen = false;
    getGame()?.setUiMode(false);
  }

  function slotAt(sec: Section, idx: number): ItemSnap | undefined {
    if (sec === "inv") return invSlots[idx];
    if (sec === "hotbar") return hotbarSlots[idx];
    if (sec === "equip") return equipSlots[idx];
    return undefined;
  }

  function containerOf(sec: Section): "inventory" | "hotbar" | "equip" {
    if (sec === "hotbar") return "hotbar";
    if (sec === "equip") return "equip";
    return "inventory";
  }

  function activate(sec: Section, idx: number): void {
    section = sec;
    cursor = idx;
    const g = getGame();
    if (!g) return;

    if (sec === "craft") {
      const recipe = recipes[idx];
      if (recipe && canCraft(recipe.id)) g.sendCraft(recipe.id);
      return;
    }

    const container = containerOf(sec);
    if (moving) {
      g.sendMoveItem(moving.container, moving.slot, container, idx);
      moving = null;
      return;
    }
    const item = slotAt(sec, idx);
    if (!item) return;
    const def = itemDef(item.itemId);
    if (def.type === "consumable" || def.type === "tome") {
      g.sendConsume(container, idx);
    } else if (def.type === "placeable") {
      g.sendPlace(container, idx);
      close();
    } else {
      moving = { container, slot: idx };
    }
  }

  function nav(dx: number, dy: number): void {
    if (section === "inv") {
      const col = cursor % COLS;
      const row = Math.floor(cursor / COLS);
      if (dx === 1 && col === COLS - 1) {
        section = "craft";
        cursor = Math.min(row, recipes.length - 1);
        return;
      }
      const ncol = Math.min(COLS - 1, Math.max(0, col + dx));
      let nrow = row + dy;
      if (nrow >= INV_ROWS) {
        section = "hotbar";
        cursor = ncol;
        return;
      }
      nrow = Math.max(0, nrow);
      cursor = nrow * COLS + ncol;
    } else if (section === "hotbar") {
      if (dy === -1) {
        section = "inv";
        cursor = (INV_ROWS - 1) * COLS + cursor;
        return;
      }
      if (dy === 1) {
        section = "equip";
        cursor = 0;
        return;
      }
      if (dx === 1 && cursor === HOTBAR_SLOTS - 1) {
        section = "craft";
        cursor = recipes.length - 1;
        return;
      }
      cursor = Math.min(HOTBAR_SLOTS - 1, Math.max(0, cursor + dx));
    } else if (section === "equip") {
      if (dy === -1) {
        section = "hotbar";
        cursor = 0;
        return;
      }
      if (dx === 1 && cursor === EQUIP_SLOTS.length - 1) {
        section = "craft";
        cursor = recipes.length - 1;
        return;
      }
      cursor = Math.min(EQUIP_SLOTS.length - 1, Math.max(0, cursor + dx));
    } else {
      if (dx === -1) {
        section = "inv";
        cursor = Math.min(cursor, INV_ROWS - 1) * COLS + (COLS - 1);
        return;
      }
      cursor = Math.min(recipes.length - 1, Math.max(0, cursor + dy));
    }
  }

  onMount(() => {
    const onNav = (e: Event) => {
      const d = (e as CustomEvent<{ up: boolean; down: boolean; left: boolean; right: boolean; confirm: boolean; cancel: boolean }>).detail;
      if (d.cancel) {
        if (moving) moving = null;
        else close();
        return;
      }
      if (d.up) nav(0, -1);
      if (d.down) nav(0, 1);
      if (d.left) nav(-1, 0);
      if (d.right) nav(1, 0);
      if (d.confirm) activate(section, cursor);
    };
    window.addEventListener("rc:menuNav", onNav);
    return () => window.removeEventListener("rc:menuNav", onNav);
  });

  const hintKeys = $derived(
    game.lastDevice === "gamepad"
      ? "Ⓐ use/move · Ⓑ close · d-pad navigate"
      : "Click/Enter use/move · Esc close · arrows navigate",
  );
</script>

<div class="panel-bg">
  <div class="inv-panel">
    <div class="left">
      <h3>Inventory</h3>
      <div class="grid">
        {#each invSlots as item, i (i)}
          <button
            class="cell"
            class:cursor={section === "inv" && cursor === i}
            class:moving={moving?.container === "inventory" && moving.slot === i}
            onclick={() => activate("inv", i)}
          >
            {#if item}
              <IconGlyph value={itemIcon(item.itemId)} />
              {#if item.qty > 1}<span class="qty">{item.qty}</span>{/if}
            {/if}
          </button>
        {/each}
      </div>
      <h3>Hotbar</h3>
      <div class="grid">
        {#each hotbarSlots as item, i (i)}
          <button
            class="cell"
            class:cursor={section === "hotbar" && cursor === i}
            class:moving={moving?.container === "hotbar" && moving.slot === i}
            onclick={() => activate("hotbar", i)}
          >
            {#if item}
              <IconGlyph value={itemIcon(item.itemId)} />
              {#if item.qty > 1}<span class="qty">{item.qty}</span>{/if}
            {/if}
          </button>
        {/each}
      </div>
      <h3>Equipment</h3>
      <div class="grid equip-grid">
        {#each equipSlots as item, i (i)}
          <button
            class="cell"
            class:cursor={section === "equip" && cursor === i}
            class:moving={moving?.container === "equip" && moving.slot === i}
            onclick={() => activate("equip", i)}
          >
            {#if item}
              <IconGlyph value={itemIcon(item.itemId)} />
            {:else}
              <span class="slot-label">{EQUIP_LABELS[EQUIP_SLOTS[i]!]}</span>
            {/if}
          </button>
        {/each}
      </div>
    </div>
    <div class="right">
      <h3>Crafting</h3>
      <div class="recipes">
        {#each recipes as recipe, i (recipe.id)}
          <button
            class="recipe"
            class:cursor={section === "craft" && cursor === i}
            class:unavailable={!canCraft(recipe.id)}
            onclick={() => activate("craft", i)}
          >
            <IconGlyph value={itemIcon(recipe.output)} />
            <span class="name">
              {itemDef(recipe.output).name}
              {#if recipe.station}<span class="station">at {recipe.station}</span>{/if}
            </span>
            <span class="ingredients">
              {#each recipe.ingredients as ing (ing.itemId)}
                <span class="ingredient" class:missing={count(ing.itemId) < ing.qty}>
                  <IconGlyph value={itemIcon(ing.itemId)} size={14} />{count(ing.itemId)}/{ing.qty}
                </span>
              {/each}
            </span>
          </button>
        {/each}
      </div>
    </div>
  </div>
  <div class="hints">{hintKeys}</div>
</div>

<style>
  .panel-bg {
    position: absolute;
    inset: 0;
    background: rgba(4, 6, 10, 0.55);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
  }
  .inv-panel {
    display: flex;
    gap: 22px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(0, 0, 0, 0.25)),
      var(--rc-panel);
    border: 1px solid var(--rc-gold-dim);
    outline: 1px solid rgba(0, 0, 0, 0.8);
    box-shadow:
      inset 0 0 0 1px rgba(255, 224, 150, 0.08),
      0 10px 40px rgba(0, 0, 0, 0.55);
    border-radius: 8px;
    padding: 20px 26px;
  }
  h3 {
    margin: 8px 0 6px;
    font-family: var(--rc-display);
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: var(--rc-gold);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(6, 46px);
    gap: 5px;
  }
  .cell {
    position: relative;
    width: 46px;
    height: 46px;
    background: rgba(255, 255, 255, 0.05);
    border: 2px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
  }
  .cell.cursor {
    border-color: #ffd66e;
    box-shadow: 0 0 10px rgba(255, 214, 110, 0.4);
  }
  .cell.moving {
    border-color: #6ec1ff;
    background: rgba(110, 193, 255, 0.15);
  }
  .equip-grid {
    grid-template-columns: repeat(3, 46px);
  }
  .slot-label {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #6b7686;
    text-align: center;
  }
  .qty {
    position: absolute;
    right: 3px;
    bottom: 1px;
    font-size: 11px;
    font-weight: 700;
    color: #fff;
    text-shadow: 0 1px 2px #000;
  }
  .right {
    width: 300px;
  }
  .recipes {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 330px;
    overflow-y: auto;
  }
  .recipe {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 6px 10px;
    cursor: pointer;
    color: #dce6f2;
    text-align: left;
  }
  .recipe.cursor {
    border-color: #ffd66e;
    box-shadow: 0 0 10px rgba(255, 214, 110, 0.4);
  }
  .recipe.unavailable {
    opacity: 0.45;
  }
  .recipe .name {
    flex: 1;
    font-size: 13px;
    display: flex;
    flex-direction: column;
  }
  .station {
    font-size: 10px;
    color: #c9a24b;
  }
  .ingredients {
    display: flex;
    gap: 6px;
    font-size: 11px;
  }
  .ingredient {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .ingredients .missing {
    color: #ff8a80;
  }
  .hints {
    margin-top: 12px;
    font-size: 12px;
    color: #9fb0c4;
    text-shadow: 0 1px 3px #000;
  }
</style>
