<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "./appState.svelte";
  import TitleScreen from "./TitleScreen.svelte";
  import CharacterSelect from "./CharacterSelect.svelte";
  import Hud from "./Hud.svelte";

  onMount(() => {
    void app.refresh();
  });
</script>

{#if app.screen === "loading"}
  <div class="panel-center">
    <div class="panel">Loading…</div>
  </div>
{:else if app.screen === "login"}
  <TitleScreen />
{:else if app.screen === "charselect"}
  <CharacterSelect />
{:else if app.screen === "ingame"}
  <Hud />
{/if}

<style>
  :global(.panel-center) {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }
  :global(.panel) {
    pointer-events: auto;
    background: rgba(12, 16, 24, 0.92);
    border: 1px solid #3a4a5f;
    border-radius: 10px;
    padding: 28px 32px;
    color: #dce6f2;
    min-width: 320px;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.5);
  }
  :global(.panel h1) {
    margin: 0 0 4px;
    font-size: 26px;
    letter-spacing: 1px;
  }
  :global(.panel .sub) {
    color: #8fa3ba;
    font-size: 13px;
    margin-bottom: 20px;
  }
  :global(.panel button) {
    display: block;
    width: 100%;
    margin: 8px 0;
    padding: 10px 14px;
    border-radius: 6px;
    border: 1px solid #46586f;
    background: #1c2635;
    color: #dce6f2;
    font-size: 15px;
    cursor: pointer;
  }
  :global(.panel button:hover, .panel button:focus-visible) {
    background: #2a3a52;
    border-color: #6f8ba8;
    outline: none;
  }
  :global(.panel input) {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin: 8px 0;
    padding: 10px 12px;
    border-radius: 6px;
    border: 1px solid #46586f;
    background: #0e141d;
    color: #dce6f2;
    font-size: 15px;
  }
  :global(.panel .error) {
    color: #ff8a80;
    font-size: 13px;
    margin-top: 8px;
  }
</style>
