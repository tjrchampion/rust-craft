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
      <div class="bar hp">
        <div class="fill" style="width: {Math.min(100, (self.hp / self.maxHp) * 100)}%"></div>
        <span>{Math.min(Math.ceil(self.hp), self.maxHp)} / {self.maxHp}</span>
      </div>
      <div class="bar mana">
        <div class="fill" style="width: {Math.min(100, (self.mana / self.maxMana) * 100)}%"></div>
        <span>{Math.min(Math.floor(self.mana), self.maxMana)}</span>
      </div>
      <div class="row">
        <div class="bar small hunger" title="Hunger">
          <div class="fill" style="width: {self.hunger}%"></div>
          <span>🍗</span>
        </div>
        <div class="bar small thirst" title="Thirst">
          <div class="fill" style="width: {self.thirst}%"></div>
          <span>💧</span>
        </div>
      </div>
      <div class="bar xp" title="Experience">
        <div class="fill" style="width: {(self.xp / self.xpNext) * 100}%"></div>
      </div>
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
    padding: 10px 14px 10px 10px;
    pointer-events: none;
    min-width: 240px;
  }
  .portrait {
    position: relative;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #4a4232, #17130c);
    border: 2px solid var(--rc-gold);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 12px rgba(0, 0, 0, 0.6);
    flex-shrink: 0;
  }
  .portrait-icon {
    font-size: 24px;
  }
  .level {
    position: absolute;
    bottom: -6px;
    right: -6px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #17130c;
    border: 1.5px solid var(--rc-gold);
    color: var(--rc-gold-bright);
    font-family: var(--rc-display);
    font-weight: 900;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
  }
  .name-row .name {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 14px;
    letter-spacing: 1px;
    color: var(--rc-parchment);
    text-shadow: 0 1px 2px #000;
  }
  .row {
    display: flex;
    gap: 3px;
  }
  .bar {
    position: relative;
    height: 15px;
    background: rgba(0, 0, 0, 0.65);
    border: 1px solid rgba(201, 162, 75, 0.35);
    border-radius: 3px;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    transition: width 0.25s ease-out;
  }
  .bar span {
    position: absolute;
    inset: 0;
    font-size: 10px;
    line-height: 15px;
    text-align: center;
    color: #fff;
    text-shadow: 0 1px 2px #000;
    font-family: var(--rc-body);
  }
  .hp .fill {
    background: linear-gradient(180deg, #d95252, #8f2626);
  }
  .mana .fill {
    background: linear-gradient(180deg, #5a82d8, #26418f);
  }
  .small {
    flex: 1;
    height: 11px;
  }
  .small span {
    line-height: 11px;
    font-size: 8px;
    text-align: left;
    padding-left: 3px;
  }
  .hunger .fill {
    background: linear-gradient(180deg, #d8a052, #8f6126);
  }
  .thirst .fill {
    background: linear-gradient(180deg, #52c4d8, #26718f);
  }
  .xp {
    height: 5px;
  }
  .xp .fill {
    background: linear-gradient(180deg, #b98fe0, #6b3f9c);
  }
</style>
