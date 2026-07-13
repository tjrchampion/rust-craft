<script lang="ts">
  import { game } from "./gameState.svelte";
</script>

{#if game.zoneBanner}
  {#key game.zoneBanner.key}
    <div class="zone-banner">
      <div class="rule"></div>
      <div class="name">{game.zoneBanner.name}</div>
      <div class="subtitle">{game.zoneBanner.subtitle}</div>
      <div class="rule"></div>
    </div>
  {/key}
{/if}

<style>
  .zone-banner {
    position: absolute;
    top: 22%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
    pointer-events: none;
    animation: zone-fade 4.2s ease-in-out forwards;
  }
  .name {
    font-family: var(--rc-display);
    font-size: 34px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--rc-gold-bright);
    text-shadow:
      0 0 18px rgba(0, 0, 0, 0.85),
      0 2px 6px rgba(0, 0, 0, 0.9);
  }
  .subtitle {
    margin-top: 4px;
    font-size: 14px;
    font-style: italic;
    color: var(--rc-parchment);
    text-shadow: 0 2px 6px rgba(0, 0, 0, 0.9);
  }
  .rule {
    width: 220px;
    height: 1px;
    margin: 6px auto;
    background: linear-gradient(90deg, transparent, var(--rc-gold-dim), transparent);
  }
  @keyframes zone-fade {
    0% {
      opacity: 0;
      transform: translate(-50%, -50%) translateY(-8px);
    }
    12% {
      opacity: 1;
      transform: translate(-50%, -50%) translateY(0);
    }
    78% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
</style>
