<script lang="ts">
  import { game } from "./gameState.svelte";

  const self = $derived(game.self);
</script>

{#if self}
  <div class="unitframe rc-frame">
    <div class="portrait">
      <span class="portrait-icon">⚔️</span>
      <span class="level">{self.level}</span>
    </div>
    <div class="body">
      <div class="name-row">
        <span class="name">{game.selfName}</span>
      </div>
      <div class="bar hp" class:low={self.hp / self.maxHp < 0.28}>
        <div class="fill" style="width: {Math.min(100, (self.hp / self.maxHp) * 100)}%"></div>
        <span>{Math.min(Math.ceil(self.hp), self.maxHp)} / {self.maxHp}</span>
      </div>
      <div class="bar mana">
        <div class="fill" style="width: {Math.min(100, (self.mana / self.maxMana) * 100)}%"></div>
        <span>{Math.min(Math.floor(self.mana), self.maxMana)} / {self.maxMana}</span>
      </div>
      {#if game.underwater || self.oxygen < 99}
        <div
          class="bar oxygen"
          class:critical={self.oxygen < 25}
          title="Breath"
        >
          <div class="fill" style="width: {Math.min(100, self.oxygen)}%"></div>
          <span>{Math.ceil(self.oxygen)} air</span>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .unitframe {
    position: absolute;
    left: 16px;
    top: 14px;
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 8px 14px 8px 10px;
    pointer-events: none;
    min-width: 250px;
    background: radial-gradient(circle at 50% 20%, rgba(32, 28, 22, 0.94), rgba(12, 10, 8, 0.98));
    border: 2px solid #a6823b;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.75), inset 0 0 10px rgba(0, 0, 0, 0.8);
  }
  .portrait {
    position: relative;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #3d3326, #120e09);
    border: 2px solid #d4af37;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.8);
    flex-shrink: 0;
  }
  .portrait-icon {
    font-size: 24px;
  }
  .level {
    position: absolute;
    bottom: -5px;
    right: -5px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #17130c;
    border: 1.5px solid #ffd700;
    color: #ffe66d;
    font-family: var(--rc-display);
    font-weight: 900;
    font-size: 11px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
  }
  .name-row .name {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 14px;
    letter-spacing: 0.5px;
    color: #f3e5ab;
    text-shadow: 0 1px 3px #000, 0 0 5px rgba(0,0,0,0.8);
  }
  .bar {
    position: relative;
    height: 16px;
    background: rgba(0, 0, 0, 0.8);
    border: 1px solid rgba(212, 175, 55, 0.4);
    border-radius: 3px;
    overflow: hidden;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.8);
  }
  .fill {
    height: 100%;
    transition: width 0.2s ease-out;
  }
  .bar span {
    position: absolute;
    inset: 0;
    font-size: 11px;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
    color: #ffffff;
    text-shadow: 0 1px 3px #000, 1px 1px 1px #000;
    font-family: var(--rc-body);
  }
  .hp .fill {
    background: linear-gradient(180deg, #2ecc71, #1b872d);
  }
  .hp.low .fill {
    background: linear-gradient(180deg, #e74c3c, #962d22);
  }
  .mana .fill {
    background: linear-gradient(180deg, #3498db, #1d5b96);
  }
  .oxygen {
    height: 12px;
    margin-top: 2px;
  }
  .oxygen .fill {
    background: linear-gradient(180deg, #7ee0ff, #2a7aa8);
  }
  .oxygen.critical .fill {
    background: linear-gradient(180deg, #ff8a6a, #c43b2a);
    animation: oxygen-pulse 0.7s ease-in-out infinite;
  }
  @keyframes oxygen-pulse {
    50% {
      opacity: 0.65;
    }
  }
</style>
