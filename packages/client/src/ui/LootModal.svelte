<script lang="ts">
  import { game } from "./gameState.svelte";
  import { getGame } from "../game/instance";
  import { itemDef } from "@rustcraft/shared";
  import IconGlyph from "./IconGlyph.svelte";
  import { itemIcon } from "./icons";

  function close() {
    game.activeCorpseLoot = null;
    getGame()?.setUiMode(false);
  }

  $effect(() => {
    if (game.activeCorpseLoot && game.activeCorpseLoot.items.length === 0) {
      close();
    }
  });

  function lootItem(slot: number) {
    if (!game.activeCorpseLoot) return;
    getGame()?.sendLootCorpse(game.activeCorpseLoot.mobId, slot);
  }

  function lootAll() {
    if (!game.activeCorpseLoot) return;
    getGame()?.sendLootCorpse(game.activeCorpseLoot.mobId, undefined, true);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
</script>

<svelte:window onkeydown={onKeyDown} />

{#if game.activeCorpseLoot && game.activeCorpseLoot.items.length > 0}
  <div class="loot-modal-overlay">
    <div class="loot-card">
      <div class="loot-header">
        <div class="header-title">
          <span class="corpse-icon">☠</span>
          <h3>{game.activeCorpseLoot.mobType.replace(/_/g, " ").toUpperCase()} LOOT</h3>
        </div>
        <button class="close-btn" onclick={close}>✕</button>
      </div>

      <div class="loot-body">
        <div class="item-list">
          {#each game.activeCorpseLoot.items as item, index}
            {@const def = itemDef(item.itemId)}
            <div class="item-row quality-{def.rarity ?? 'common'}">
              <div class="item-icon-box">
                <IconGlyph value={itemIcon(item.itemId)} size={24} itemId={item.itemId} />
              </div>
              <div class="item-details">
                <span class="item-name">{def.name}</span>
                {#if item.qty > 1}
                  <span class="item-qty">x{item.qty}</span>
                {/if}
              </div>
              <button class="take-btn" onclick={() => lootItem(index)}>Loot</button>
            </div>
          {/each}
        </div>
      </div>

      <div class="loot-footer">
        <button class="loot-all-btn" onclick={lootAll}>Loot All</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .loot-modal-overlay {
    position: fixed;
    top: 50%;
    left: 72%;
    transform: translate(-50%, -50%);
    z-index: 900;
    pointer-events: auto;
  }

  .loot-card {
    width: 240px;
    background: rgba(14, 18, 24, 0.95);
    border: 1px solid rgba(212, 175, 55, 0.4);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.8), 0 0 12px rgba(212, 175, 55, 0.15);
    backdrop-filter: blur(8px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: #e0e0e0;
    font-family: system-ui, -apple-system, sans-serif;
  }

  .loot-header {
    background: linear-gradient(180deg, rgba(35, 42, 54, 0.9) 0%, rgba(20, 25, 33, 0.9) 100%);
    padding: 6px 10px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid rgba(212, 175, 55, 0.3);
  }

  .header-title {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .corpse-icon {
    font-size: 13px;
    color: #ffd700;
  }

  .header-title h3 {
    margin: 0;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.6px;
    color: #f0c040;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
  }

  .close-btn {
    background: none;
    border: none;
    color: #8a9ba8;
    font-size: 12px;
    cursor: pointer;
    padding: 1px 4px;
    border-radius: 3px;
    transition: all 0.15s ease;
  }

  .close-btn:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.1);
  }

  .loot-body {
    padding: 8px;
    max-height: 220px;
    overflow-y: auto;
  }

  .item-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .item-row {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    padding: 4px 6px;
    transition: background 0.15s ease;
  }

  .item-row:hover {
    background: rgba(255, 255, 255, 0.07);
  }

  .item-icon-box {
    width: 28px;
    height: 28px;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .item-details {
    flex: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
  }

  .item-name {
    font-size: 11px;
    font-weight: 600;
    color: #e2e8f0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .quality-uncommon .item-name { color: #1eff00; }
  .quality-rare .item-name { color: #0070dd; }
  .quality-epic .item-name { color: #a335ee; }
  .quality-legendary .item-name { color: #ff8000; }

  .item-qty {
    font-size: 10px;
    color: #a0aec0;
  }

  .take-btn {
    background: linear-gradient(180deg, rgba(50, 60, 75, 0.8) 0%, rgba(30, 36, 48, 0.8) 100%);
    border: 1px solid rgba(212, 175, 55, 0.4);
    color: #f0c040;
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.15s ease;
    flex-shrink: 0;
  }

  .take-btn:hover {
    background: linear-gradient(180deg, rgba(212, 175, 55, 0.3) 0%, rgba(160, 130, 30, 0.3) 100%);
    color: #ffffff;
    box-shadow: 0 0 6px rgba(212, 175, 55, 0.4);
  }

  .loot-footer {
    padding: 4px 8px 8px;
    display: flex;
    justify-content: flex-end;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .loot-all-btn {
    width: 100%;
    background: linear-gradient(180deg, #d4af37 0%, #aa8822 100%);
    border: 1px solid #ffe57f;
    color: #10141a;
    font-size: 11px;
    font-weight: 700;
    padding: 4px 10px;
    border-radius: 3px;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
    transition: all 0.15s ease;
  }

  .loot-all-btn:hover {
    background: linear-gradient(180deg, #f0c040 0%, #cc9922 100%);
    box-shadow: 0 0 10px rgba(212, 175, 55, 0.6);
  }
</style>
