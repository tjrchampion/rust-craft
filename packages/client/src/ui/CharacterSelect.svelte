<script lang="ts">
  import { app } from "./appState.svelte";
  import Logo from "./Logo.svelte";

  let newName = $state("");
  const characters = $derived(app.me?.characters ?? []);
</script>

<div class="select-screen">
  <div class="vignette"></div>
  <div class="content">
    <Logo size={0.72} />

    <div class="card rc-frame">
      <div class="rc-frame-title">Choose your champion</div>
      <div class="sub">
        {app.me?.account?.displayName ?? "unknown"} · {app.realm.name}
        <button class="linkish" onclick={() => void app.logout()}>sign out</button>
      </div>

      <div class="char-list">
        {#each characters as character (character.id)}
          <button class="char rc-btn" onclick={() => app.enterWorld(character)}>
            <span class="char-name">{character.name}</span>
            <span class="char-level">Level {character.level}</span>
          </button>
        {:else}
          <div class="sub empty">No champions yet — forge one below.</div>
        {/each}
      </div>

      <div class="rc-divider"></div>

      <form
        onsubmit={(e) => {
          e.preventDefault();
          if (newName.trim()) {
            void app.createCharacter(newName);
            newName = "";
          }
        }}
      >
        <input class="rc-input" placeholder="New champion name" bind:value={newName} maxlength={16} />
        <button class="rc-btn" type="submit">Create Champion</button>
      </form>

      {#if app.error}
        <div class="error">{app.error}</div>
      {/if}
    </div>
  </div>
</div>

<style>
  .select-screen {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
    font-family: var(--rc-body);
    color: var(--rc-ink);
  }
  .vignette {
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse at center 38%, transparent 0%, rgba(8, 5, 2, 0.55) 100%);
    pointer-events: none;
  }
  .content {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }
  .card {
    width: 360px;
    padding: 22px 26px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .sub {
    color: var(--rc-ink-dim);
    font-size: 13px;
  }
  .sub.empty {
    text-align: center;
    padding: 8px 0;
  }
  .linkish {
    background: none;
    border: none;
    color: var(--rc-gold);
    cursor: pointer;
    font-size: 12px;
    text-decoration: underline;
    margin-left: 6px;
  }
  .char-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .char {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    text-align: left;
  }
  .char-name {
    font-size: 16px;
  }
  .char-level {
    font-family: var(--rc-body);
    font-size: 12px;
    color: var(--rc-ink-dim);
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .error {
    color: #ff8a80;
    font-size: 13px;
    text-align: center;
  }
</style>
