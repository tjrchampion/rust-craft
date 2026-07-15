<script lang="ts">
  import { game } from "./gameState.svelte";
  const t = $derived(game.target);
</script>

{#if t}
  <div class="target rc-frame" class:hostile={t.hostile}>
    <div class="portrait" class:hostile={t.hostile}>
      <span>{t.kind === "mob" ? "🐺" : "⚔️"}</span>
    </div>
    <div class="body">
      <div class="name">{t.name}</div>
      <div class="bar">
        <div class="fill" style="width: {Math.min(100, (t.hp / t.maxHp) * 100)}%"></div>
        <span>{Math.min(Math.ceil(t.hp), t.maxHp)} / {t.maxHp}</span>
      </div>
    </div>
  </div>
{/if}

<style>
  .target {
    position: absolute;
    top: 96px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px 6px 6px;
    min-width: 200px;
    pointer-events: none;
  }
  .target.hostile {
    border-color: #7a2a2a;
  }
  .portrait {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #4a4232, #17130c);
    border: 2px solid var(--rc-gold);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    flex-shrink: 0;
  }
  .portrait.hostile {
    border-color: #c0392b;
  }
  .body {
    flex: 1;
  }
  .name {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 13px;
    color: var(--rc-parchment);
    margin-bottom: 3px;
  }
  .bar {
    position: relative;
    height: 14px;
    background: rgba(0, 0, 0, 0.65);
    border: 1px solid rgba(201, 162, 75, 0.35);
    border-radius: 3px;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: linear-gradient(180deg, #d95252, #8f2626);
    transition: width 0.2s ease-out;
  }
  .bar span {
    position: absolute;
    inset: 0;
    font-size: 10px;
    line-height: 14px;
    text-align: center;
    color: #fff;
    text-shadow: 0 1px 2px #000;
  }
</style>
