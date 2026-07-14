<script lang="ts">
  import { onMount } from "svelte";
  import { game } from "./gameState.svelte";
  import { app } from "./appState.svelte";
  import { getGame } from "../game/instance";

  let isFullscreen = $state(!!document.fullscreenElement);

  onMount(() => {
    const onChange = () => {
      isFullscreen = !!document.fullscreenElement;
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  });

  function resume(): void {
    getGame()?.setSystemMenuOpen(false);
  }

  function toggleFullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => {});
  }

  function exitToCharacterSelect(): void {
    app.leaveWorld();
  }
</script>

{#if game.systemMenuOpen}
  <div class="backdrop">
    <div class="menu rc-frame">
      <div class="rc-frame-title">Menu</div>
      <button type="button" class="rc-btn" onclick={resume}>Resume</button>
      <button type="button" class="rc-btn" onclick={toggleFullscreen}>
        {isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
      </button>
      <button type="button" class="rc-btn ghost" onclick={exitToCharacterSelect}>Exit to Character Select</button>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(6, 5, 4, 0.55);
    pointer-events: auto;
  }
  .menu {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 20px 26px;
    width: 260px;
  }
  .rc-btn {
    padding: 11px 14px;
    font-size: 14px;
  }
  .rc-btn.ghost {
    background: transparent;
    border: 1px dashed var(--rc-gold-dim);
  }
</style>
