<script lang="ts">
  import { game } from "./gameState.svelte";
  import { auraDef } from "@rustcraft/shared";

  let nowTick = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => (nowTick = Date.now()), 200);
    return () => clearInterval(id);
  });

  const activeAuras = $derived(
    (game.self?.auras ?? [])
      .map((a) => ({
        auraId: a.auraId,
        remaining: (a.expiresAt - game.serverTimeOffset - nowTick) / 1000,
        def: auraDef(a.auraId),
      }))
      .filter((a) => a.remaining > 0)
      .sort((a, b) => a.remaining - b.remaining),
  );
</script>

{#if activeAuras.length > 0}
  <div class="aura-bar">
    {#each activeAuras as aura (aura.auraId)}
      <div class="aura" class:debuff={!aura.def.positive} title={aura.def.name}>
        <span class="icon">{aura.def.icon}</span>
        <span class="time">{aura.remaining >= 10 ? Math.ceil(aura.remaining) : aura.remaining.toFixed(1)}</span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .aura-bar {
    position: absolute;
    left: 86px;
    top: 88px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    max-width: 220px;
    pointer-events: none;
    z-index: 4;
  }
  .aura {
    position: relative;
    width: 28px;
    height: 28px;
    border-radius: 3px;
    background: rgba(12, 10, 18, 0.9);
    border: 1.5px solid #5ec46a;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.55);
  }
  .aura.debuff {
    border-color: #d94f3d;
  }
  .icon {
    font-size: 14px;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
    line-height: 1;
  }
  .time {
    position: absolute;
    bottom: -3px;
    right: -3px;
    font-size: 9px;
    font-weight: 700;
    color: #fff;
    background: rgba(0, 0, 0, 0.85);
    border-radius: 2px;
    padding: 0 3px;
    line-height: 1.35;
    text-shadow: 0 1px 2px #000;
  }
</style>
