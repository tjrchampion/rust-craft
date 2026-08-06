<script lang="ts">
  import { game } from "./gameState.svelte";
  const t = $derived(game.target);
  const hpPct = $derived(t ? Math.min(100, (t.hp / Math.max(1, t.maxHp)) * 100) : 0);
</script>

{#if t}
  <div
    class="target"
    class:hostile={t.hostile}
    oncontextmenu={(e) => {
      e.preventDefault();
      if (t) {
        game.playerContextMenu = {
          x: e.clientX,
          y: e.clientY,
          playerName: t.name,
          playerLevel: t.level ?? 1,
          playerClass: t.classId ?? "Adventurer",
        };
      }
    }}
  >
    <div class="body">
      <div class="name">{t.name}</div>
      <div class="rc-resource-bar hp angled-flip" class:hostile={t.hostile}>
        <div class="fill" style="width: {hpPct}%"></div>
        <span class="label">{Math.round(hpPct)}%</span>
      </div>
    </div>
    <div class="portrait" class:hostile={t.hostile}>
      <span>{t.kind === "mob" ? "🐺" : "⚔️"}</span>
    </div>
  </div>
{/if}

<style>
  .target {
    position: absolute;
    top: 48px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    pointer-events: auto;
    cursor: pointer;
    z-index: 5;
    min-width: 240px;
  }
  .portrait {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #3a2a48, #120e18);
    border: 2px solid var(--rc-gold);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
    flex-shrink: 0;
    box-shadow: 0 0 14px rgba(160, 80, 200, 0.2), 0 2px 8px rgba(0, 0, 0, 0.7);
  }
  .portrait.hostile {
    border-color: #e74c3c;
    box-shadow: 0 0 14px rgba(231, 76, 60, 0.35);
  }
  .body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 3px;
  }
  .name {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: #f0eaf6;
    text-shadow: 0 1px 3px #000;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
  }
  .body :global(.rc-resource-bar) {
    width: 190px;
    height: 16px;
  }
  .hostile :global(.rc-resource-bar.hp > .fill) {
    background: linear-gradient(180deg, #ff6b5a 0%, #c0392b 45%, #8b1e16 100%);
  }
</style>
