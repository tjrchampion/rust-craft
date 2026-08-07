<script lang="ts">
  import { onMount } from "svelte";
  import { game, parseCoins } from "../gameState.svelte";
  import { itemIcon, spellIcon } from "../icons";
  import IconGlyph from "../IconGlyph.svelte";
  import { ClassPreviewScene } from "../../render/ClassPreviewScene";
  import {
    itemDef,
    EQUIP_SLOTS,
    type ClassId,
    type GearSlot,
    type ItemSnap,
  } from "@rustcraft/shared";

  let {
    invSlots,
    hotbarSlots,
    equipSlots,
    classInfo,
    computedStats,
    equipCursor = $bindable(0),
    invCursor = $bindable(0),
    moving,
    activateInv,
    openItemContextMenu,
    showItemTooltip,
    hideItemTooltip,
    keyLabel,
  }: {
    invSlots: (ItemSnap | undefined)[];
    hotbarSlots: (ItemSnap | undefined)[];
    equipSlots: (ItemSnap | undefined)[];
    classInfo: any;
    computedStats: any;
    equipCursor?: number;
    invCursor?: number;
    moving: { container: "inventory" | "hotbar" | "equip" | "crafting"; slot: number } | null;
    activateInv: (container: "inventory" | "hotbar" | "equip" | "crafting", slot: number) => void;
    openItemContextMenu: (container: "inventory" | "hotbar" | "equip", slot: number, itemId: string, e: MouseEvent) => void;
    showItemTooltip: (itemId: string, durability: number | null, e: MouseEvent) => void;
    hideItemTooltip: () => void;
    keyLabel: (i: number) => string;
  } = $props();

  const PAPERDOLL_LEFT: GearSlot[] = ["head", "neck", "chest", "arms", "legs"];
  const PAPERDOLL_RIGHT: GearSlot[] = ["shoulders", "weapon", "feet"];

  const EQUIP_LABELS: Record<GearSlot, string> = {
    weapon: "Weapon",
    head: "Head",
    neck: "Neck",
    shoulders: "Shoulders",
    chest: "Chest",
    arms: "Hands",
    legs: "Legs",
    feet: "Feet",
  };

  const SPELL_PREFIX = "spell:";
  function spellIdOf(item: ItemSnap | undefined): string | null {
    return item?.itemId.startsWith(SPELL_PREFIX) ? item.itemId.slice(SPELL_PREFIX.length) : null;
  }

  // 3D character preview (paperdoll). Reflects the currently-equipped gear.
  let paperdollCanvas = $state<HTMLCanvasElement | null>(null);
  let paperdollScene: ClassPreviewScene | null = null;
  const paperdollEquip = $derived.by(() => {
    const equip: Partial<Record<string, string>> = {};
    for (let i = 0; i < EQUIP_SLOTS.length; i++) {
      const item = equipSlots[i];
      if (item) equip[EQUIP_SLOTS[i]!] = item.itemId;
    }
    return equip;
  });

  $effect(() => {
    const canvas = paperdollCanvas;
    if (!canvas) return;
    if (!paperdollScene) {
      paperdollScene = new ClassPreviewScene(canvas, { pedestal: false, motes: false, spotlight: false });
    }
    const classId = (game.classId || "warrior") as ClassId;
    paperdollScene.setClass(classId, game.gender, game.appearance, paperdollEquip);
    paperdollScene.resize();
  });

  onMount(() => {
    const onResize = () => paperdollScene?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      paperdollScene?.dispose();
      paperdollScene = null;
    };
  });
</script>

<div class="col paperdoll-col">
  <h3>Character</h3>
  <div class="paperdoll">
    <div class="paperdoll-slots">
      {#each PAPERDOLL_LEFT as slotName (slotName)}
        {@const i = EQUIP_SLOTS.indexOf(slotName)}
        {@const item = equipSlots[i]}
        <button
          class="equip-slot"
          class:cursor={equipCursor === i}
          class:filled={!!item}
          class:moving={moving?.container === "equip" && moving.slot === i}
          title={item ? itemDef(item.itemId).name : EQUIP_LABELS[slotName]}
          onclick={() => {
            equipCursor = i;
            activateInv("equip", i);
          }}
          oncontextmenu={(e) => { e.preventDefault(); if (item) openItemContextMenu("equip", i, item.itemId, e); }}
          onmouseenter={(e) => item && showItemTooltip(item.itemId, item.durability, e)}
          onmouseleave={hideItemTooltip}
        >
          <span class="equip-slot-icon">
            {#if item}
              <IconGlyph value={itemIcon(item.itemId)} size={28} itemId={item.itemId} />
            {/if}
          </span>
          <span class="equip-slot-label">{EQUIP_LABELS[slotName]}</span>
        </button>
      {/each}
    </div>
    <div class="paperdoll-stage">
      <canvas bind:this={paperdollCanvas} class="paperdoll-canvas"></canvas>
      <div class="char-info">
        <div class="char-level-class">Level {game.self?.level ?? 1} · {classInfo?.name ?? "Adventurer"}</div>
        <div class="char-vitals">
          <div>HP: {Math.round(game.self?.hp ?? 0)}/{Math.round(game.self?.maxHp ?? 0)}</div>
          <div>{classInfo?.resourceLabel ?? "Mana"}: {Math.round(game.self?.mana ?? 0)}/{Math.round(game.self?.maxMana ?? 0)}</div>
        </div>
        {#if computedStats}
          <div class="stats-grid">
            <div class="stat-item"><span class="stat-name">Power:</span> <span class="stat-val">{Math.round(computedStats.power)}</span></div>
            <div class="stat-item"><span class="stat-name">Agility:</span> <span class="stat-val">{Math.round(computedStats.agility)}</span></div>
            <div class="stat-item"><span class="stat-name">Vitality:</span> <span class="stat-val">{Math.round(computedStats.vitality)}</span></div>
            <div class="stat-item"><span class="stat-name">Armor:</span> <span class="stat-val">{Math.round(computedStats.armor)}</span></div>
            <div class="stat-item"><span class="stat-name">Crit:</span> <span class="stat-val">{Math.round(computedStats.critChance * 100)}%</span></div>
            <div class="stat-item"><span class="stat-name">Speed:</span> <span class="stat-val">x{computedStats.moveSpeedMult.toFixed(2)}</span></div>
          </div>
        {/if}
      </div>
    </div>
    <div class="paperdoll-slots">
      {#each PAPERDOLL_RIGHT as slotName (slotName)}
        {@const i = EQUIP_SLOTS.indexOf(slotName)}
        {@const item = equipSlots[i]}
        <button
          class="equip-slot"
          class:cursor={equipCursor === i}
          class:filled={!!item}
          class:moving={moving?.container === "equip" && moving.slot === i}
          title={item ? itemDef(item.itemId).name : EQUIP_LABELS[slotName]}
          onclick={() => {
            equipCursor = i;
            activateInv("equip", i);
          }}
          oncontextmenu={(e) => { e.preventDefault(); if (item) openItemContextMenu("equip", i, item.itemId, e); }}
          onmouseenter={(e) => item && showItemTooltip(item.itemId, item.durability, e)}
          onmouseleave={hideItemTooltip}
        >
          <span class="equip-slot-icon">
            {#if item}
              <IconGlyph value={itemIcon(item.itemId)} size={28} itemId={item.itemId} />
            {/if}
          </span>
          <span class="equip-slot-label">{EQUIP_LABELS[slotName]}</span>
        </button>
      {/each}
    </div>
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
        oncontextmenu={(e) => { e.preventDefault(); if (item) openItemContextMenu("inventory", i, item.itemId, e); }}
        onmouseenter={(e) => item && showItemTooltip(item.itemId, item.durability, e)}
        onmouseleave={hideItemTooltip}
      >
        {#if item}
          <IconGlyph value={itemIcon(item.itemId)} itemId={item.itemId} />
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
        oncontextmenu={(e) => { e.preventDefault(); if (!spellId && item) openItemContextMenu("hotbar", i, item.itemId, e); }}
        onmouseenter={(e) => !spellId && item && showItemTooltip(item.itemId, item.durability, e)}
        onmouseleave={hideItemTooltip}
      >
        {#if spellId}
          <IconGlyph value={spellIcon(spellId)} size={20} />
        {:else if item}
          <IconGlyph value={itemIcon(item.itemId)} size={20} itemId={item.itemId} />
          {#if item.qty > 1}<span class="qty">{item.qty}</span>{/if}
        {/if}
        <span class="num">{keyLabel(i)}</span>
      </button>
    {/each}
  </div>
  <div class="soec-currency-bar">
    <div class="soec-label">Shadows of Eldor Coin (SoEC)</div>
    {#if game.self}
      {@const coins = parseCoins(game.self.coins)}
      <div class="soec-badges">
        <span class="coin-badge gold" title="{coins.gold} Gold"><span class="coin-icon">🟡</span> <strong>{coins.gold}</strong>g</span>
        <span class="coin-badge silver" title="{coins.silver} Silver"><span class="coin-icon">⚪</span> <strong>{coins.silver}</strong>s</span>
        <span class="coin-badge copper" title="{coins.copper} Copper"><span class="coin-icon">🟠</span> <strong>{coins.copper}</strong>c</span>
      </div>
    {/if}
  </div>
</div>

<style>
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
  .paperdoll-col {
    flex: 0 0 auto;
    width: min(360px, 38vw);
    min-width: 0;
  }
  .paperdoll {
    display: grid;
    grid-template-columns: 64px minmax(140px, 1fr) 64px;
    gap: 8px;
    align-items: start;
    flex: 1;
    min-height: 0;
  }
  .paperdoll-slots {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .equip-slot {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    background: rgba(255, 255, 255, 0.03);
    border: 2px solid rgba(201, 162, 75, 0.28);
    border-radius: 6px;
    padding: 4px;
    cursor: pointer;
    color: #dce6f2;
    width: 64px;
  }
  .equip-slot.filled {
    border-color: rgba(201, 162, 75, 0.55);
    background: rgba(201, 162, 75, 0.08);
  }
  .equip-slot.cursor,
  .equip-slot.moving {
    border-color: var(--rc-gold-bright);
    box-shadow: 0 0 0 1px rgba(255, 214, 110, 0.35);
  }
  .equip-slot-icon {
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.35);
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
  .equip-slot-label {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: #8a93a3;
    line-height: 1.1;
  }
  .paperdoll-canvas {
    width: 100%;
    height: min(260px, 34vh);
    border-radius: 6px;
    background: rgba(8, 10, 14, 0.45);
    border: 1px solid rgba(255, 255, 255, 0.08);
    cursor: grab;
    touch-action: none;
  }
  .paperdoll-stage {
    display: flex;
    flex-direction: column;
    min-height: 0;
    gap: 8px;
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
  .char-level-class {
    font-weight: bold;
    color: var(--rc-gold-bright, #ffe9a8);
    font-family: var(--rc-display, serif);
    letter-spacing: 0.5px;
    margin-bottom: 2px;
  }
  .char-vitals {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    opacity: 0.95;
    margin-bottom: 6px;
    border-bottom: 1px dashed rgba(255, 255, 255, 0.05);
    padding-bottom: 6px;
  }
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 4px 10px;
    background: rgba(0, 0, 0, 0.15);
    padding: 6px 8px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }
  .stat-item {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
  }
  .stat-name {
    color: rgba(255, 255, 255, 0.5);
  }
  .stat-val {
    font-weight: 500;
    color: var(--rc-parchment, #e3d2b7);
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
  .qty {
    position: absolute;
    right: 3px;
    bottom: 1px;
    font-size: 11px;
    font-weight: 700;
    color: #fff;
    text-shadow: 0 1px 2px #000;
  }
  .num {
    position: absolute;
    left: 4px;
    top: 2px;
    font-size: 9px;
    font-family: var(--rc-display);
    font-weight: 700;
    color: var(--rc-gold);
    text-shadow: 0 1px 2px #000;
  }
  .soec-currency-bar {
    margin-top: 12px;
    padding: 8px 12px;
    background: radial-gradient(circle at 50% 30%, rgba(32, 26, 18, 0.95), rgba(14, 12, 9, 0.98));
    border: 1px solid var(--rc-gold-dim);
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.5);
  }
  .soec-label {
    font-family: var(--rc-display);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
    color: var(--rc-gold-bright);
    text-transform: uppercase;
  }
  .soec-badges {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .coin-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 12px;
    padding: 2px 7px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.45);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .coin-badge strong {
    font-size: 13px;
  }
  .coin-badge.gold {
    color: #ffd700;
    border-color: rgba(255, 215, 0, 0.35);
  }
  .coin-badge.silver {
    color: #e0e0e0;
    border-color: rgba(224, 224, 224, 0.35);
  }
  .coin-badge.copper {
    color: #d9822b;
    border-color: rgba(217, 130, 43, 0.35);
  }
</style>
