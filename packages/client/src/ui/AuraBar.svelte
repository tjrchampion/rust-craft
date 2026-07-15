<script lang="ts">
  import { game } from "./gameState.svelte";
  import { auraDef } from "@rustcraft/shared";

  // Auras only change via server snapshots, but their remaining time needs to
  // keep ticking down (and vanish on expiry) between those -- same clock-skew
  // handling as the cast bar: expiresAt is a server-clock timestamp, so
  // serverTimeOffset has to come out before comparing against our own clock.
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
    left: 16px;
    top: 102px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    max-width: 260px;
    pointer-events: none;
  }
  .aura {
    position: relative;
    width: 34px;
    height: 34px;
    border-radius: 6px;
    background: rgba(10, 12, 18, 0.85);
    border: 2px solid #5ec46a;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
  }
  .aura.debuff {
    border-color: #d94f3d;
  }
  .icon {
    font-size: 18px;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
  }
  .time {
    position: absolute;
    bottom: -3px;
    right: -3px;
    font-size: 9px;
    font-weight: 700;
    color: #fff;
    background: rgba(0, 0, 0, 0.8);
    border-radius: 3px;
    padding: 0 3px;
    line-height: 1.4;
    text-shadow: 0 1px 2px #000;
  }
</style>
