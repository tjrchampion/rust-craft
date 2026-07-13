<script lang="ts">
  import { game } from "./gameState.svelte";
  import { itemIcon } from "./icons";
  import { HOTBAR_SLOTS, itemDef } from "@rustcraft/shared";

  const slots = $derived(
    Array.from({ length: HOTBAR_SLOTS }, (_, i) =>
      game.inventory.find((it) => it.container === "hotbar" && it.slot === i),
    ),
  );
</script>

<div class="hotbar">
  {#each slots as item, i (i)}
    <div class="slot" class:active={i === game.selectedSlot}>
      {#if item}
        <span class="icon">{itemIcon(item.itemId)}</span>
        {#if item.qty > 1}<span class="qty">{item.qty}</span>{/if}
        {#if item.durability !== null && itemDef(item.itemId).maxDurability}
          <div class="dura" style="width: {(item.durability / itemDef(item.itemId).maxDurability!) * 100}%"></div>
        {/if}
      {/if}
      <span class="num">{i + 1}</span>
    </div>
  {/each}
  {#if game.learnedSpells.length > 0}
    <div class="slot spell" title="Cast (Q / Y)">
      <span class="icon">🔥</span>
      <span class="num">{game.lastDevice === "gamepad" ? "Y" : "Q"}</span>
      {#if game.self?.castingSpell}
        <div class="casting"></div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .hotbar {
    position: absolute;
    bottom: 18px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 6px;
    pointer-events: none;
  }
  .slot {
    position: relative;
    width: 52px;
    height: 52px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(0, 0, 0, 0.3)),
      rgba(14, 12, 9, 0.88);
    border: 2px solid var(--rc-gold-dim);
    outline: 1px solid rgba(0, 0, 0, 0.8);
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: inset 0 0 8px rgba(0, 0, 0, 0.6);
  }
  .slot.active {
    border-color: var(--rc-gold-bright);
    box-shadow:
      0 0 14px rgba(255, 214, 110, 0.45),
      inset 0 0 8px rgba(0, 0, 0, 0.6);
  }
  .slot.spell {
    border-color: rgba(200, 120, 255, 0.55);
    margin-left: 12px;
  }
  .icon {
    font-size: 26px;
  }
  .qty {
    position: absolute;
    right: 4px;
    bottom: 2px;
    font-size: 12px;
    font-weight: 700;
    color: #fff;
    text-shadow: 0 1px 2px #000;
  }
  .num {
    position: absolute;
    left: 4px;
    top: 2px;
    font-size: 10px;
    font-family: var(--rc-display);
    font-weight: 700;
    color: var(--rc-gold);
    text-shadow: 0 1px 2px #000;
  }
  .dura {
    position: absolute;
    bottom: 2px;
    left: 3px;
    height: 3px;
    max-width: calc(100% - 6px);
    background: #6fc46a;
    border-radius: 2px;
  }
  .casting {
    position: absolute;
    inset: 0;
    border-radius: 6px;
    background: rgba(200, 120, 255, 0.3);
    animation: pulse 0.6s infinite alternate;
  }
  @keyframes pulse {
    from {
      opacity: 0.4;
    }
    to {
      opacity: 1;
    }
  }
</style>
