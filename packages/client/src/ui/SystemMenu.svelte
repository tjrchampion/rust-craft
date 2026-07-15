<script lang="ts">
  import { onMount } from "svelte";
  import { game } from "./gameState.svelte";
  import { app } from "./appState.svelte";
  import { getGame } from "../game/instance";
  import { promptLabel } from "./padGlyphs";

  let isFullscreen = $state(!!document.fullscreenElement);
  let cursor = $state(0);

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

  const actions = [resume, toggleFullscreen, exitToCharacterSelect];

  onMount(() => {
    const onNav = (e: Event) => {
      const d = (e as CustomEvent<{ up: boolean; down: boolean; confirm: boolean; cancel: boolean }>).detail;
      if (d.cancel) {
        resume();
        return;
      }
      if (d.up) cursor = (cursor - 1 + actions.length) % actions.length;
      if (d.down) cursor = (cursor + 1) % actions.length;
      if (d.confirm) actions[cursor]?.();
    };
    window.addEventListener("rc:menuNav", onNav);
    return () => window.removeEventListener("rc:menuNav", onNav);
  });

  const hint = $derived(promptLabel("Ⓐ select · Ⓑ resume · d-pad navigate", "Click/Enter select · Esc resume"));
</script>

{#if game.systemMenuOpen}
  <div class="backdrop">
    <div class="menu rc-frame">
      <div class="rc-frame-title">Menu</div>
      <button type="button" class="rc-btn" class:selected={cursor === 0} onclick={resume}>Resume</button>
      <button type="button" class="rc-btn" class:selected={cursor === 1} onclick={toggleFullscreen}>
        {isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
      </button>
      <button type="button" class="rc-btn ghost" class:selected={cursor === 2} onclick={exitToCharacterSelect}>
        Exit to Character Select
      </button>
      <div class="hint">{hint}</div>
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
  .rc-btn.selected {
    border-color: var(--rc-gold-bright);
    box-shadow: 0 0 14px rgba(255, 214, 110, 0.35);
  }
  .hint {
    text-align: center;
    font-size: 11px;
    color: var(--rc-ink-dim);
    margin-top: 2px;
  }
</style>
