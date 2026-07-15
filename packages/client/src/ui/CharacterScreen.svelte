<script lang="ts">
  import { onMount } from "svelte";
  import { game, type CharacterTab } from "./gameState.svelte";
  import { app } from "./appState.svelte";
  import { getGame } from "../game/instance";
  import { itemIcon, spellIcon } from "./icons";
  import IconGlyph from "./IconGlyph.svelte";
  import { promptLabel } from "./padGlyphs";
  import {
    RECIPES,
    itemDef,
    spellDef,
    auraDef,
    classDef,
    INVENTORY_SLOTS,
    HOTBAR_SLOTS,
    EQUIP_SLOTS,
    type ItemSnap,
    type SpellDef,
  } from "@rustcraft/shared";

  const SPELL_PREFIX = "spell:";
  function spellIdOf(item: ItemSnap | undefined): string | null {
    return item?.itemId.startsWith(SPELL_PREFIX) ? item.itemId.slice(SPELL_PREFIX.length) : null;
  }

  const TABS: { id: CharacterTab; label: string }[] = [
    { id: "inventory", label: "Inventory" },
    { id: "spellbook", label: "Spell Book" },
    { id: "craft", label: "Crafting" },
    { id: "system", label: "System" },
  ];
  const EQUIP_LABELS: Record<string, string> = { weapon: "Weapon", head: "Head", chest: "Chest" };
  const recipes = Object.values(RECIPES);

  let invCursor = $state(0);
  let equipCursor = $state(0);
  let craftCursor = $state(0);
  let spellCursor = $state(0);
  let systemCursor = $state(0);
  /** Item picked up from inv/hotbar/equip (moved via sendMoveItem) -- also
   *  covers rearranging a spell already slotted in the hotbar, since both
   *  ends are "hotbar" and moveItem tolerates the "spell:" marker. */
  let moving = $state<{ container: "inventory" | "hotbar" | "equip"; slot: number } | null>(null);
  /** A spell picked from the Spell Book list (or an already-slotted hotbar
   *  cell), waiting for a hotbar slot to land on via sendAssignSpell. */
  let movingSpell = $state<string | null>(null);
  /** Floating spell tooltip -- fixed-position (viewport-relative, computed
   *  from the hovered row's own rect) rather than CSS :hover + absolute, so
   *  it always renders above everything with no ancestor overflow/scroll
   *  container able to clip it. */
  let hoveredSpell = $state<string | null>(null);
  let tooltipPos = $state({ x: 0, y: 0 });
  let isFullscreen = $state(!!document.fullscreenElement);

  const invSlots = $derived(
    Array.from({ length: INVENTORY_SLOTS }, (_, i) => game.inventory.find((it) => it.container === "inventory" && it.slot === i)),
  );
  const hotbarSlots = $derived(
    Array.from({ length: HOTBAR_SLOTS }, (_, i) => game.inventory.find((it) => it.container === "hotbar" && it.slot === i)),
  );
  const equipSlots = $derived(
    Array.from({ length: EQUIP_SLOTS.length }, (_, i) => game.inventory.find((it) => it.container === "equip" && it.slot === i)),
  );
  const learnedSpells = $derived(game.learnedSpells);
  const classInfo = $derived(game.classId ? classDef(game.classId) : null);

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

  function selectTab(tab: CharacterTab): void {
    game.activeTab = tab;
    moving = null;
    movingSpell = null;
  }

  // ---------------------------------------------------------------- inventory
  function activateInv(container: "inventory" | "hotbar" | "equip", idx: number): void {
    const g = getGame();
    if (!g) return;
    const slots = container === "inventory" ? invSlots : container === "hotbar" ? hotbarSlots : equipSlots;
    if (moving) {
      g.sendMoveItem(moving.container, moving.slot, container, idx);
      moving = null;
      return;
    }
    const item = slots[idx];
    if (!item) return;
    if (spellIdOf(item)) {
      // A spell already slotted -- rearrange it via the item path (both
      // ends "hotbar", moveItem tolerates the "spell:" marker). Assigning a
      // *new* spell happens from the Spell Book tab instead.
      moving = { container, slot: idx };
      return;
    }
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

  // ---------------------------------------------------------------- spellbook
  function slotSpellId(idx: number): string | null {
    return spellIdOf(hotbarSlots[idx]);
  }
  function pickSpell(spellId: string): void {
    movingSpell = movingSpell === spellId ? null : spellId;
  }
  function activateHotbarForSpell(idx: number): void {
    const g = getGame();
    if (!g) return;
    if (movingSpell) {
      g.sendAssignSpell(movingSpell, idx);
      movingSpell = null;
      return;
    }
    const existing = slotSpellId(idx);
    if (existing) movingSpell = existing;
  }
  function clearHotbarSpell(idx: number, e: MouseEvent): void {
    e.stopPropagation();
    getGame()?.sendAssignSpell(null, idx);
    if (movingSpell && slotSpellId(idx) === movingSpell) movingSpell = null;
  }

  function showTooltip(spellId: string, e: MouseEvent): void {
    hoveredSpell = spellId;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    tooltipPos = { x: Math.min(r.right + 10, window.innerWidth - 280), y: r.top };
  }
  function hideTooltip(): void {
    hoveredSpell = null;
  }

  function targetLabel(spell: SpellDef): string {
    const t = spell.targeting;
    if (t.kind === "self") return "Self";
    if (t.kind === "melee") return `Melee · ${t.range}m`;
    if (t.kind === "projectile") return `Ranged · ${t.range}m`;
    return `AoE · ${t.radius}m radius`;
  }
  function effectLines(spell: SpellDef): string[] {
    const out: string[] = [];
    for (const e of spell.effects) {
      if (e.type === "damage") {
        let s = `${e.base ?? 0} + ${e.powerScale ?? 0}× Power ${e.damageType ?? ""} damage`.replace(/\s+/g, " ").trim();
        if (e.executeScale) s += ` (up to +${Math.round(e.executeScale * 100)}% vs low HP)`;
        if (e.lifestealPct) s += `, drains ${Math.round(e.lifestealPct * 100)}% as healing`;
        out.push(s);
      } else if (e.type === "heal") {
        out.push(`${e.base ?? 0} + ${e.powerScale ?? 0}× Power healing${e.landsOn === "caster" ? "" : " to allies"}`);
      } else if (e.type === "applyAura" && e.auraId) {
        const aura = auraDef(e.auraId);
        const kind = aura.silences ? "silence" : aura.tick ? (aura.tick.type === "heal" ? "HoT" : "DoT") : aura.statModifiers ? "buff/debuff" : "";
        out.push(`Applies ${aura.name}${kind ? ` (${kind})` : ""} · ${aura.durationS}s`);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------- craft
  function activateCraft(idx: number): void {
    const recipe = recipes[idx];
    if (recipe && canCraft(recipe.id)) getGame()?.sendCraft(recipe.id);
  }

  // ------------------------------------------------------------------ system
  function toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  }
  function exitToCharacterSelect(): void {
    app.leaveWorld();
  }
  const systemActions = [toggleFullscreen, exitToCharacterSelect];

  onMount(() => {
    const onChange = () => (isFullscreen = !!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  });

  function nav(dx: number, dy: number): void {
    if (game.activeTab === "inventory") {
      const cols = 8;
      const rows = INVENTORY_SLOTS / cols;
      const col = Math.min(cols - 1, Math.max(0, (invCursor % cols) + dx));
      const row = Math.min(rows - 1, Math.max(0, Math.floor(invCursor / cols) + dy));
      invCursor = row * cols + col;
    } else if (game.activeTab === "spellbook") {
      spellCursor = Math.min(learnedSpells.length - 1, Math.max(0, spellCursor + dy));
    } else if (game.activeTab === "craft") {
      craftCursor = Math.min(recipes.length - 1, Math.max(0, craftCursor + dy));
    } else {
      systemCursor = Math.min(systemActions.length - 1, Math.max(0, systemCursor + dy));
    }
  }

  function confirm(): void {
    if (game.activeTab === "inventory") activateInv("inventory", invCursor);
    else if (game.activeTab === "spellbook") {
      const spellId = learnedSpells[spellCursor];
      if (spellId) pickSpell(spellId);
    } else if (game.activeTab === "craft") activateCraft(craftCursor);
    else systemActions[systemCursor]?.();
  }

  onMount(() => {
    const onNav = (e: Event) => {
      const d = (e as CustomEvent<{ up: boolean; down: boolean; left: boolean; right: boolean; confirm: boolean; cancel: boolean }>).detail;
      if (d.cancel) {
        if (moving || movingSpell) {
          moving = null;
          movingSpell = null;
        } else close();
        return;
      }
      if (d.up) nav(0, -1);
      if (d.down) nav(0, 1);
      if (d.left) nav(-1, 0);
      if (d.right) nav(1, 0);
      if (d.confirm) confirm();
    };
    window.addEventListener("rc:menuNav", onNav);
    return () => window.removeEventListener("rc:menuNav", onNav);
  });

  const hintKeys = $derived(
    promptLabel("Ⓐ select · Ⓑ close · d-pad navigate", "Click to select · press again or click ✕ to close"),
  );
</script>

<div class="screen-bg">
  <div class="screen rc-frame">
    <div class="tabs">
      {#each TABS as tab (tab.id)}
        <button class="tab" class:active={game.activeTab === tab.id} onclick={() => selectTab(tab.id)}>
          {tab.label}
        </button>
      {/each}
      <button class="close-btn" onclick={close}>✕</button>
    </div>

    <div class="content">
      {#if game.activeTab === "inventory"}
        <div class="col equip-col">
          <h3>Equipment</h3>
          <div class="equip-list">
            {#each equipSlots as item, i (i)}
              <button
                class="equip-row"
                class:cursor={equipCursor === i}
                class:moving={moving?.container === "equip" && moving.slot === i}
                onclick={() => {
                  equipCursor = i;
                  activateInv("equip", i);
                }}
              >
                <span class="equip-label">{EQUIP_LABELS[EQUIP_SLOTS[i]!]}</span>
                <span class="equip-value">
                  {#if item}
                    <IconGlyph value={itemIcon(item.itemId)} size={20} />
                    {itemDef(item.itemId).name}
                  {:else}
                    Empty
                  {/if}
                </span>
              </button>
            {/each}
          </div>
          <div class="char-info">
            <div>Level {game.self?.level ?? 1} · {classInfo?.name ?? "Adventurer"}</div>
            <div>HP: {Math.round(game.self?.hp ?? 0)}/{Math.round(game.self?.maxHp ?? 0)}</div>
            <div>{classInfo?.resourceLabel ?? "Mana"}: {Math.round(game.self?.mana ?? 0)}/{Math.round(game.self?.maxMana ?? 0)}</div>
          </div>
        </div>
        <div class="col backpack-col">
          <h3>Backpack</h3>
          <div class="grid">
            {#each invSlots as item, i (i)}
              <button
                class="cell"
                class:cursor={invCursor === i}
                class:moving={moving?.container === "inventory" && moving.slot === i}
                onclick={() => {
                  invCursor = i;
                  activateInv("inventory", i);
                }}
              >
                {#if item}
                  <IconGlyph value={itemIcon(item.itemId)} />
                  {#if item.qty > 1}<span class="qty">{item.qty}</span>{/if}
                {/if}
              </button>
            {/each}
          </div>
          <h3>Hotbar</h3>
          <div class="hotbar-row">
            {#each hotbarSlots as item, i (i)}
              {@const spellId = spellIdOf(item)}
              <button
                class="cell small"
                class:first={i === 6}
                class:moving={moving?.container === "hotbar" && moving.slot === i}
                onclick={() => activateInv("hotbar", i)}
              >
                {#if spellId}
                  <IconGlyph value={spellIcon(spellId)} size={20} />
                {:else if item}
                  <IconGlyph value={itemIcon(item.itemId)} size={20} />
                  {#if item.qty > 1}<span class="qty">{item.qty}</span>{/if}
                {/if}
              </button>
            {/each}
          </div>
        </div>
      {:else if game.activeTab === "spellbook"}
        <div class="spellbook-tab">
          <h3>Known Spells</h3>
          <div class="spell-list">
            {#each learnedSpells as spellId, i (spellId)}
              {@const spell = spellDef(spellId)}
              <button
                class="spell-row"
                class:cursor={spellCursor === i}
                class:moving={movingSpell === spellId}
                onmouseenter={(e) => showTooltip(spellId, e)}
                onmouseleave={hideTooltip}
                onclick={() => {
                  spellCursor = i;
                  pickSpell(spellId);
                }}
              >
                <IconGlyph value={spellIcon(spellId)} size={26} />
                <span class="name">{spell.name}</span>
              </button>
            {/each}
          </div>
          <h3>Hotbar</h3>
          <div class="hotbar-row roomy">
            {#each hotbarSlots as item, i (i)}
              {@const spellId = slotSpellId(i)}
              <button
                class="cell big"
                class:spell={spellId !== null}
                class:moving={spellId !== null && movingSpell === spellId}
                class:first={i === 6}
                onclick={() => activateHotbarForSpell(i)}
              >
                {#if spellId}
                  <IconGlyph value={spellIcon(spellId)} size={28} />
                  <span class="clear" onclick={(e) => clearHotbarSpell(i, e)}>✕</span>
                {:else if item}
                  <IconGlyph value={itemIcon(item.itemId)} size={28} />
                {/if}
              </button>
            {/each}
          </div>
        </div>
      {:else if game.activeTab === "craft"}
        <div class="col craft-col">
          <h3>Crafting</h3>
          <div class="recipes">
            {#each recipes as recipe, i (recipe.id)}
              <button
                class="recipe"
                class:cursor={craftCursor === i}
                class:unavailable={!canCraft(recipe.id)}
                onclick={() => {
                  craftCursor = i;
                  activateCraft(i);
                }}
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
      {:else}
        <div class="col system-col">
          <h3>System</h3>
          <button class="rc-btn" class:selected={systemCursor === 0} onclick={toggleFullscreen}>
            {isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          </button>
          <button class="rc-btn ghost" class:selected={systemCursor === 1} onclick={exitToCharacterSelect}>
            Exit to Character Select
          </button>
        </div>
      {/if}
    </div>
    <div class="hints">{hintKeys}</div>
  </div>
  {#if hoveredSpell}
    {@const spell = spellDef(hoveredSpell)}
    <div class="floating-tooltip" style="left: {tooltipPos.x}px; top: {tooltipPos.y}px;">
      <div class="tt-title">{spell.name}</div>
      <div class="tt-stats">
        <span>Cast: {spell.castTimeS > 0 ? `${spell.castTimeS}s` : "Instant"}</span>
        <span>Cost: {spell.resourceCost}</span>
        <span>Cooldown: {spell.cooldownS}s</span>
        <span>{targetLabel(spell)}</span>
      </div>
      <div class="tt-effects">
        {#each effectLines(spell) as line (line)}
          <div class="tt-effect">{line}</div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .screen-bg {
    position: absolute;
    inset: 0;
    background: rgba(4, 6, 10, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
  }
  .screen {
    display: flex;
    flex-direction: column;
    width: min(920px, 92vw);
    height: min(600px, 86vh);
    padding: 0;
  }
  .tabs {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--rc-gold-dim);
    background: rgba(0, 0, 0, 0.2);
    border-radius: 5px 5px 0 0;
    overflow: hidden;
  }
  .tab {
    background: none;
    border: none;
    border-right: 1px solid rgba(255, 255, 255, 0.08);
    color: #9fb0c4;
    font-family: var(--rc-display);
    font-size: 13px;
    letter-spacing: 1px;
    padding: 12px 22px;
    cursor: pointer;
  }
  .tab.active {
    color: var(--rc-gold-bright);
    background: rgba(255, 214, 110, 0.08);
    box-shadow: inset 0 -2px 0 var(--rc-gold-bright);
  }
  .tab:hover {
    color: #fff;
  }
  .close-btn {
    margin-left: auto;
    background: none;
    border: none;
    color: #9fb0c4;
    font-size: 15px;
    cursor: pointer;
    padding: 10px 18px;
  }
  .close-btn:hover {
    color: #fff;
  }
  .content {
    flex: 1;
    display: flex;
    gap: 24px;
    padding: 20px 26px;
    min-height: 0;
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
  /* ---- Inventory tab ---- */
  .equip-col {
    width: 260px;
  }
  .equip-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .equip-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 8px 12px;
    cursor: pointer;
    color: #dce6f2;
    text-align: left;
  }
  .equip-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #6b7686;
  }
  .equip-value {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
  }
  .char-info {
    margin-top: auto;
    padding-top: 14px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    font-size: 12.5px;
    color: #b9c6d6;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .backpack-col {
    flex: 1;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(8, 46px);
    gap: 5px;
    overflow-y: auto;
  }
  .hotbar-row {
    display: flex;
    gap: 5px;
    margin-top: 8px;
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
  .cell.small {
    width: 42px;
    height: 42px;
  }
  .cell.first {
    margin-left: 10px;
  }
  .cell.cursor {
    border-color: #ffd66e;
    box-shadow: 0 0 10px rgba(255, 214, 110, 0.4);
  }
  .cell.moving {
    border-color: #6ec1ff;
    background: rgba(110, 193, 255, 0.15);
  }
  .cell.spell {
    border-color: rgba(200, 120, 255, 0.55);
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
  /* ---- Spellbook tab ---- */
  .spellbook-tab {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .spell-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
    overflow-y: auto;
    flex: 1;
  }
  .spell-row {
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(255, 255, 255, 0.04);
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 8px 12px;
    cursor: pointer;
    color: #dce6f2;
    text-align: left;
  }
  .spell-row.cursor {
    border-color: #ffd66e;
    box-shadow: 0 0 10px rgba(255, 214, 110, 0.4);
  }
  .spell-row.moving {
    border-color: #6ec1ff;
    background: rgba(110, 193, 255, 0.15);
  }
  .spell-row .name {
    font-size: 13px;
    font-weight: 600;
  }
  /* Floating tooltip -- fixed-position (viewport coordinates set inline via
     JS from the hovered row's own rect), so it renders above absolutely
     everything with no ancestor scroll/overflow container able to clip it. */
  .floating-tooltip {
    position: fixed;
    z-index: 9999;
    width: 260px;
    background: rgba(10, 12, 18, 0.97);
    border: 1px solid var(--rc-gold-dim);
    border-radius: 6px;
    padding: 10px 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    text-align: left;
    pointer-events: none;
  }
  .tt-title {
    font-family: var(--rc-display);
    font-size: 13px;
    color: var(--rc-gold-bright);
    margin-bottom: 6px;
  }
  .tt-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 10px;
    font-size: 11px;
    color: #9fb0c4;
    margin-bottom: 6px;
    padding-bottom: 6px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .tt-effects {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .tt-effect {
    font-size: 11.5px;
    color: #dce6f2;
    line-height: 1.35;
  }
  .clear {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 15px;
    height: 15px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.3);
    color: #ffb0b0;
    font-size: 9px;
    line-height: 13px;
    text-align: center;
    cursor: pointer;
  }
  .clear:hover {
    background: #a33;
    color: #fff;
  }
  .hotbar-row.roomy {
    gap: 8px;
    margin-top: 4px;
  }
  .cell.big {
    width: 52px;
    height: 52px;
  }
  .cell.big.first {
    margin-left: 16px;
  }
  /* ---- Crafting tab ---- */
  .craft-col {
    flex: 1;
  }
  .recipes {
    display: flex;
    flex-direction: column;
    gap: 5px;
    overflow-y: auto;
  }
  .recipe {
    display: flex;
    align-items: center;
    gap: 10px;
    background: rgba(255, 255, 255, 0.04);
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    padding: 8px 12px;
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
  /* ---- System tab ---- */
  .system-col {
    width: 280px;
    gap: 10px;
  }
  .rc-btn {
    padding: 11px 14px;
    font-size: 14px;
  }
  .rc-btn.ghost {
    background: transparent;
    border: 1px dashed var(--rc-gold-dim);
  }
  .rc-btn.selected {
    border-color: var(--rc-gold-bright);
    box-shadow: 0 0 14px rgba(255, 214, 110, 0.35);
  }
  .hints {
    padding: 10px 26px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 12px;
    color: #9fb0c4;
    text-shadow: 0 1px 3px #000;
  }
</style>
