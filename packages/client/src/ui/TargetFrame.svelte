<script lang="ts">
  import { game } from "./gameState.svelte";
  const t = $derived(game.target);
</script>

{#if t}
  <div
    class="target rc-frame"
    class:hostile={t.hostile}
    oncontextmenu={(e) => {
      e.preventDefault();
      if (t && t.kind === "player") {
        game.playerContextMenu = {
          x: e.clientX,
          y: e.clientY,
          playerName: t.name,
        };
      }
    }}
  >
    <div class="portrait" class:hostile={t.hostile}>
      <span>{t.kind === "mob" ? "🐺" : "⚔️"}</span>
    </div>
    <div class="body">
      <div class="name">{t.name}</div>
      <div class="bar" class:hostile={t.hostile}>
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
    gap: 10px;
    padding: 8px 14px 8px 10px;
    min-width: 220px;
    pointer-events: auto;
    cursor: pointer;
    background: radial-gradient(circle at 50% 20%, rgba(32, 28, 22, 0.94), rgba(12, 10, 8, 0.98));
    border: 2px solid #a6823b;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.75), inset 0 0 10px rgba(0, 0, 0, 0.8);
  }
  .target.hostile {
    border-color: #c0392b;
  }
  .portrait {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #3d3326, #120e09);
    border: 2px solid #d4af37;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    flex-shrink: 0;
    box-shadow: 0 0 8px rgba(0, 0, 0, 0.8);
  }
  .portrait.hostile {
    border-color: #e74c3c;
  }
  .body {
    flex: 1;
  }
  .name {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 13px;
    color: #f3e5ab;
    margin-bottom: 3px;
    text-shadow: 0 1px 2px #000;
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
  .bar.hostile {
    border-color: rgba(231, 76, 60, 0.4);
  }
  .fill {
    height: 100%;
    background: linear-gradient(180deg, #2ecc71, #1b872d);
    transition: width 0.2s ease-out;
  }
  .bar.hostile .fill {
    background: linear-gradient(180deg, #e74c3c, #962d22);
  }
  .bar span {
    position: absolute;
    inset: 0;
    font-size: 11px;
    font-weight: 700;
    line-height: 16px;
    text-align: center;
    color: #fff;
    text-shadow: 0 1px 3px #000, 1px 1px 1px #000;
    font-family: var(--rc-body);
  }
</style>
