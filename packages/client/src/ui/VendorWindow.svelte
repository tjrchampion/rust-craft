<script lang="ts">
  import { onMount } from "svelte";
  import { game, parseCoins } from "./gameState.svelte";
  import { getGame } from "../game/instance";
  import { itemDef } from "@rustcraft/shared";
  import { itemIcon } from "./icons";
  import IconGlyph from "./IconGlyph.svelte";
  import { sound } from "../game/sound";

  let activeTab = $state<"buy" | "sell">("buy");
  let hoveredItem = $state<{ itemId: string } | null>(null);

  const sellableItems = $derived(
    game.inventory.filter((it) => it.container === "inventory" && it.qty > 0)
  );

  function close(): void {
    game.vendorOpen = false;
    game.vendorWares = null;
    getGame()?.setUiMode(game.inventoryOpen || game.chatOpen);
  }

  function handleBuy(itemId: string, qty = 1): void {
    if (!game.vendorWares) return;
    getGame()?.sendVendorBuy(game.vendorWares.npcId, itemId, qty);
    sound.play("buttonClick");
  }

  function handleSell(container: string, slot: number, qty = 1): void {
    if (!game.vendorWares) return;
    getGame()?.sendVendorSell(game.vendorWares.npcId, container, slot, qty);
    sound.play("buttonClick");
  }

  function getItemSellPrice(itemId: string): number {
    const def = itemDef(itemId);
    const base = def.vendorPrice ?? 40;
    return Math.max(1, Math.floor(base * 0.25));
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      close();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if game.vendorOpen && game.vendorWares}
  {@const vendor = game.vendorWares}
  {@const playerCoins = parseCoins(game.self?.coins ?? 0)}

  <div class="vendor-overlay">
    <div class="vendor-window rc-frame">
      <!-- Header -->
      <div class="vendor-header">
        <div class="header-titles">
          <h2 class="merchant-name">🛒 {vendor.vendorName}</h2>
          <span class="merchant-title">{vendor.title}</span>
        </div>
        <button class="close-btn" onclick={close}>✕</button>
      </div>

      <!-- Tab Switcher -->
      <div class="vendor-tabs">
        <button
          class="vendor-tab"
          class:active={activeTab === "buy"}
          onclick={() => (activeTab = "buy")}
        >
          🛒 Merchant Wares
        </button>
        <button
          class="vendor-tab"
          class:active={activeTab === "sell"}
          onclick={() => (activeTab = "sell")}
        >
          💰 Sell Loot
        </button>
      </div>

      <!-- Main Wares Container -->
      <div class="vendor-body">
        {#if activeTab === "buy"}
          <div class="wares-list">
            {#each vendor.items as ware (ware.itemId)}
              {@const def = itemDef(ware.itemId)}
              {@const price = parseCoins(ware.price)}
              {@const canAfford = (game.self?.coins ?? 0) >= ware.price}

              <div class="ware-card" class:unaffordable={!canAfford}>
                <div class="ware-icon">
                  <IconGlyph value={itemIcon(ware.itemId)} size={32} itemId={ware.itemId} />
                </div>

                <div class="ware-details">
                  <div class="ware-name">{def.name}</div>
                  <div class="ware-type">{def.type}</div>
                  {#if def.restore}
                    <div class="ware-effect">
                      {#if def.restore.hp}+ {def.restore.hp} HP {/if}
                      {#if def.restore.mana}+ {def.restore.mana} Resource {/if}
                    </div>
                  {/if}
                </div>

                <div class="ware-pricing">
                  <div class="coin-price">
                    {#if price.gold > 0}<span class="g">{price.gold}g</span>{/if}
                    {#if price.silver > 0 || price.gold > 0}<span class="s">{price.silver}s</span>{/if}
                    <span class="c">{price.copper}c</span>
                  </div>

                  <div class="buy-actions">
                    <button
                      class="rc-btn sm buy-btn"
                      disabled={!canAfford}
                      onclick={() => handleBuy(ware.itemId, 1)}
                    >
                      Buy 1
                    </button>
                    {#if def.stack > 1}
                      <button
                        class="rc-btn sm buy-btn"
                        disabled={(game.self?.coins ?? 0) < ware.price * 5}
                        onclick={() => handleBuy(ware.itemId, 5)}
                      >
                        x5
                      </button>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {:else}
          <!-- Sell Inventory Tab -->
          <div class="sell-list">
            {#if sellableItems.length === 0}
              <div class="empty-sell-msg">Your inventory is empty. Nothing to sell!</div>
            {:else}
              {#each sellableItems as item (item.slot)}
                {@const def = itemDef(item.itemId)}
                {@const unitPrice = getItemSellPrice(item.itemId)}
                {@const totalValue = parseCoins(unitPrice * item.qty)}

                <div class="sell-card">
                  <div class="ware-icon">
                    <IconGlyph value={itemIcon(item.itemId)} size={32} itemId={item.itemId} />
                    {#if item.qty > 1}<span class="qty-badge">{item.qty}</span>{/if}
                  </div>

                  <div class="ware-details">
                    <div class="ware-name">{def.name}</div>
                    <div class="ware-type">Qty: {item.qty}</div>
                  </div>

                  <div class="ware-pricing">
                    <div class="coin-price">
                      {#if totalValue.gold > 0}<span class="g">{totalValue.gold}g</span>{/if}
                      {#if totalValue.silver > 0 || totalValue.gold > 0}<span class="s">{totalValue.silver}s</span>{/if}
                      <span class="c">{totalValue.copper}c</span>
                    </div>

                    <div class="sell-actions">
                      <button
                        class="rc-btn sm sell-btn"
                        onclick={() => handleSell("inventory", item.slot, 1)}
                      >
                        Sell 1
                      </button>
                      {#if item.qty > 1}
                        <button
                          class="rc-btn sm sell-btn gold"
                          onclick={() => handleSell("inventory", item.slot, item.qty)}
                        >
                          Sell All
                        </button>
                      {/if}
                    </div>
                  </div>
                </div>
              {/each}
            {/if}
          </div>
        {/if}
      </div>

      <!-- Footer Currency Bar -->
      <div class="vendor-footer">
        <div class="balance-label">Your SoEC Balance:</div>
        <div class="balance-badges">
          <span class="coin-badge gold">🟡 <strong>{playerCoins.gold}</strong>g</span>
          <span class="coin-badge silver">⚪ <strong>{playerCoins.silver}</strong>s</span>
          <span class="coin-badge copper">🟠 <strong>{playerCoins.copper}</strong>c</span>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .vendor-overlay {
    position: fixed;
    inset: 0;
    z-index: 10050;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    pointer-events: auto;
  }
  .vendor-window {
    width: 520px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    background: radial-gradient(circle at 50% 20%, rgba(28, 24, 18, 0.98), rgba(12, 10, 8, 0.99));
    border: 2px solid var(--rc-gold-bright);
    border-radius: 8px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.85);
    overflow: hidden;
  }
  .vendor-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    background: linear-gradient(180deg, rgba(201, 162, 75, 0.2), rgba(0, 0, 0, 0.3));
    border-bottom: 1px solid var(--rc-gold-dim);
  }
  .merchant-name {
    font-family: var(--rc-display);
    font-size: 17px;
    font-weight: 700;
    color: var(--rc-gold-bright);
    margin: 0;
  }
  .merchant-title {
    font-size: 11px;
    color: var(--rc-parchment);
    opacity: 0.8;
  }
  .close-btn {
    background: transparent;
    border: none;
    color: var(--rc-parchment);
    font-size: 18px;
    cursor: url('/assets/cursors/02.png') 2 2, pointer !important;
  }
  .close-btn:hover {
    color: var(--rc-gold-bright);
  }

  .vendor-tabs {
    display: flex;
    background: rgba(0, 0, 0, 0.5);
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  }
  .vendor-tab {
    flex: 1;
    padding: 10px;
    font-family: var(--rc-display);
    font-size: 12.5px;
    font-weight: 700;
    color: var(--rc-parchment);
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    cursor: url('/assets/cursors/02.png') 2 2, pointer !important;
    transition: all 0.2s ease;
  }
  .vendor-tab:hover {
    color: var(--rc-gold-bright);
    background: rgba(255, 255, 255, 0.03);
  }
  .vendor-tab.active {
    color: var(--rc-gold-bright);
    border-bottom-color: var(--rc-gold-bright);
    background: rgba(201, 162, 75, 0.12);
  }

  .vendor-body {
    flex: 1;
    overflow-y: auto;
    padding: 14px;
    min-height: 320px;
    max-height: 480px;
  }
  .wares-list, .sell-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ware-card, .sell-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    transition: all 0.15s ease;
  }
  .ware-card:hover, .sell-card:hover {
    background: rgba(201, 162, 75, 0.08);
    border-color: rgba(201, 162, 75, 0.3);
  }
  .ware-card.unaffordable {
    opacity: 0.6;
  }
  .ware-icon {
    position: relative;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
    border: 1px solid var(--rc-gold-dim);
    border-radius: 4px;
    flex-shrink: 0;
  }
  .qty-badge {
    position: absolute;
    bottom: -2px;
    right: -2px;
    font-size: 10px;
    font-weight: 700;
    background: #000;
    color: var(--rc-gold-bright);
    padding: 1px 4px;
    border-radius: 3px;
    border: 1px solid var(--rc-gold-dim);
  }
  .ware-details {
    flex: 1;
    min-width: 0;
  }
  .ware-name {
    font-family: var(--rc-display);
    font-size: 13px;
    font-weight: 700;
    color: var(--rc-gold-bright);
  }
  .ware-type {
    font-size: 11px;
    color: #999;
    text-transform: capitalize;
  }
  .ware-effect {
    font-size: 11px;
    color: #5ec46a;
  }
  .ware-pricing {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 6px;
    flex-shrink: 0;
  }
  .coin-price {
    font-size: 12px;
    font-weight: 700;
    display: flex;
    gap: 4px;
  }
  .coin-price .g { color: #ffd700; }
  .coin-price .s { color: #e0e0e0; }
  .coin-price .c { color: #d9822b; }

  .buy-actions, .sell-actions {
    display: flex;
    gap: 6px;
  }
  .buy-btn, .sell-btn {
    padding: 4px 10px;
    font-size: 11px;
    height: 26px;
    border-radius: 4px;
  }
  .sell-btn.gold {
    background: linear-gradient(180deg, #d9822b, #8c4c10);
    border-color: #ffd700;
    color: #fff;
  }
  .empty-sell-msg {
    text-align: center;
    padding: 40px;
    font-size: 13px;
    color: #888;
  }

  .vendor-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    background: rgba(0, 0, 0, 0.6);
    border-top: 1px solid var(--rc-gold-dim);
  }
  .balance-label {
    font-family: var(--rc-display);
    font-size: 11.5px;
    color: var(--rc-gold-bright);
  }
  .balance-badges {
    display: flex;
    gap: 8px;
  }
  .coin-badge {
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .coin-badge.gold { color: #ffd700; }
  .coin-badge.silver { color: #e0e0e0; }
  .coin-badge.copper { color: #d9822b; }
</style>
