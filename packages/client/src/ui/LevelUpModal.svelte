<script lang="ts">
  import { itemIcon, rewardChestIcon } from "./icons";
  import IconGlyph from "./IconGlyph.svelte";
  import { getGame } from "../game/instance";
  import { itemDef, xpForLevel } from "@rustcraft/shared";
  import type { LevelRewardChest } from "@rustcraft/shared";

  // Fixed per-level growth from computeActorStats' `growth = level - 1` term
  // (packages/shared/src/sim/actorStats.ts) -- the same flat delta applies at
  // every level, so there's nothing to look up per-chest here.
  const STAT_GROWTH = [
    { label: "Power", value: "+0.8" },
    { label: "Armor", value: "+0.4" },
    { label: "Agility", value: "+0.3" },
    { label: "Vitality", value: "+0.6" },
    { label: "Max HP", value: "+7.4" },
    { label: "Max Mana", value: "+5" },
  ];

  let { chest, onClose }: { chest: LevelRewardChest; onClose: () => void } = $props();

  const xpGained = $derived(xpForLevel(chest.level - 1));

  function claim(): void {
    getGame()?.sendClaimLevelReward(chest.id);
  }
</script>

<div class="backdrop" onclick={onClose} role="presentation">
  <div class="modal rc-frame" onclick={(e) => e.stopPropagation()} role="presentation">
    <div class="banner">
      <div class="banner-glow"></div>
      <button class="close" onclick={onClose}>✕</button>
      <IconGlyph value={rewardChestIcon()} size={56} />
      <div class="level-title">Level {chest.level}</div>
    </div>
    <div class="rc-divider"></div>

    <div class="section">
      <div class="section-label">Experience Gained</div>
      <div class="xp-value">+{xpGained} XP</div>
    </div>

    <div class="section">
      <div class="section-label">Power Growth</div>
      <div class="stat-grid">
        {#each STAT_GROWTH as s (s.label)}
          <div class="stat-row">
            <span class="stat-label">{s.label}</span>
            <span class="stat-value">{s.value}</span>
          </div>
        {/each}
      </div>
    </div>

    <div class="section">
      <div class="section-label">Loot</div>
      <div class="loot-grid">
        {#each chest.items as item (item.itemId)}
          <div class="loot-item" title={itemDef(item.itemId).name}>
            <IconGlyph value={itemIcon(item.itemId)} size={28} itemId={item.itemId} />
            <span class="loot-qty">{item.qty}</span>
            <span class="loot-name">{itemDef(item.itemId).name}</span>
          </div>
        {/each}
      </div>
    </div>

    <button class="rc-btn primary claim-btn" onclick={claim}>Claim Rewards</button>
  </div>
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(4, 6, 10, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
    z-index: 20;
  }
  .modal {
    width: 360px;
    max-height: 82vh;
    overflow-y: auto;
    padding: 18px 20px 20px;
  }
  .banner {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px 0 4px;
  }
  .close {
    position: absolute;
    top: 0;
    right: 0;
    background: none;
    border: none;
    color: var(--rc-ink-dim);
    font-size: 16px;
    cursor: pointer;
    padding: 4px;
  }
  .banner-glow {
    position: absolute;
    top: -10px;
    left: 50%;
    transform: translateX(-50%);
    width: 160px;
    height: 160px;
    background: radial-gradient(circle, rgba(255, 214, 110, 0.35), transparent 70%);
    pointer-events: none;
  }
  .level-title {
    position: relative;
    font-family: var(--rc-display);
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--rc-gold-bright);
    text-shadow: 0 0 12px rgba(255, 214, 110, 0.6);
  }
  .section {
    margin-top: 14px;
  }
  .section-label {
    font-family: var(--rc-display);
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--rc-gold-dim);
    margin-bottom: 6px;
  }
  .xp-value {
    font-family: var(--rc-display);
    font-size: 18px;
    font-weight: 700;
    color: #9aef9a;
  }
  .stat-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 14px;
  }
  .stat-row {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
    padding: 3px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .stat-label {
    color: rgba(232, 240, 250, 0.75);
  }
  .stat-value {
    color: var(--rc-gold-bright);
    font-weight: 600;
  }
  .loot-grid {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .loot-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
  }
  .loot-qty {
    font-weight: 700;
    color: var(--rc-gold);
    min-width: 24px;
  }
  .loot-name {
    font-size: 13px;
    color: rgba(232, 240, 250, 0.9);
  }
  .claim-btn {
    width: 100%;
    margin-top: 18px;
  }
</style>
