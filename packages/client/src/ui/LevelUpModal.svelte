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
      <button class="rc-close close" onclick={onClose} aria-label="Close">✕</button>
      <IconGlyph value={rewardChestIcon()} size={56} />
      <div class="reached">You've Reached</div>
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
    background: rgba(8, 4, 14, 0.62);
    backdrop-filter: blur(3px);
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
    box-shadow:
      0 0 40px rgba(196, 77, 154, 0.35),
      0 18px 50px rgba(0, 0, 0, 0.65);
  }
  .banner {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px 0 4px;
  }
  .close {
    position: absolute;
    top: 0;
    right: 0;
  }
  .banner-glow {
    position: absolute;
    top: -10px;
    left: 50%;
    transform: translateX(-50%);
    width: 200px;
    height: 160px;
    background: radial-gradient(circle, rgba(196, 77, 154, 0.45), transparent 70%);
    pointer-events: none;
  }
  .reached {
    position: relative;
    font-family: var(--rc-display);
    font-size: 11px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--rc-ink-dim);
  }
  .level-title {
    position: relative;
    font-family: var(--rc-display);
    font-size: 28px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--rc-ink);
    text-shadow: 0 0 18px rgba(196, 77, 154, 0.7);
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
