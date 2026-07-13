<script lang="ts">
  import { app } from "./appState.svelte";
  import Logo from "./Logo.svelte";

  let devName = $state("");
  let addingRealm = $state(false);
  let realmName = $state("");
  let realmUrl = $state("");

  const providers = $derived(app.me?.providers ?? { discord: false, google: false, dev: true });
</script>

<div class="title-screen">
  <div class="vignette"></div>

  <div class="content">
    <Logo />

    <div class="card rc-frame">
      {#if providers.discord}
        <button class="rc-btn primary" onclick={() => (location.href = app.apiUrl("/api/auth/discord"))}>
          Sign in with Discord
        </button>
      {/if}
      {#if providers.google}
        <button class="rc-btn primary" onclick={() => (location.href = app.apiUrl("/api/auth/google"))}>
          Sign in with Google
        </button>
      {/if}

      {#if providers.dev}
        {#if providers.discord || providers.google}
          <div class="rc-divider"></div>
        {/if}
        <form
          onsubmit={(e) => {
            e.preventDefault();
            if (devName.trim()) void app.devLogin(devName);
          }}
        >
          <input class="rc-input" placeholder="Adventurer name (dev login)" bind:value={devName} maxlength={24} />
          <button class="rc-btn enter" type="submit">Enter the World</button>
        </form>
      {/if}

      {#if !providers.discord && !providers.google && !providers.dev}
        <div class="note">No sign-in method configured on this realm.</div>
      {/if}

      {#if app.error}
        <div class="error">{app.error}</div>
      {/if}
    </div>

    <div class="realm-bar rc-frame">
      <span class="realm-label rc-frame-title">Realm</span>
      <select
        class="rc-input realm-select"
        value={app.realm.name}
        onchange={(e) => {
          const realm = app.realms.find((r) => r.name === e.currentTarget.value);
          if (realm) app.selectRealm(realm);
        }}
      >
        {#each app.realms as realm (realm.name)}
          <option value={realm.name}>{realm.name}{realm.url ? ` — ${realm.url}` : " (this server)"}</option>
        {/each}
      </select>
      {#if app.realm.url}
        <button class="rc-btn small" onclick={() => app.removeRealm(app.realm)} title="Remove realm">✕</button>
      {/if}
      <button class="rc-btn small" onclick={() => (addingRealm = !addingRealm)}>
        {addingRealm ? "Cancel" : "+ Add"}
      </button>
    </div>

    {#if addingRealm}
      <form
        class="add-realm rc-frame"
        onsubmit={(e) => {
          e.preventDefault();
          app.addRealm(realmName, realmUrl);
          if (!app.error) {
            addingRealm = false;
            realmName = "";
            realmUrl = "";
          }
        }}
      >
        <input class="rc-input" placeholder="Realm name" bind:value={realmName} maxlength={24} />
        <input class="rc-input" placeholder="https://realm.example.com" bind:value={realmUrl} maxlength={120} />
        <button class="rc-btn" type="submit">Add Realm</button>
      </form>
    {/if}
  </div>

  <div class="footer">RustCraft pre-alpha · a persistent world of survival &amp; sorcery</div>
</div>

<style>
  .title-screen {
    position: fixed;
    inset: 0;
    display: flex;
    flex-direction: column;
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
    gap: 18px;
    margin-top: -30px;
  }
  .card {
    width: 340px;
    padding: 24px 26px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .card form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .rc-btn.enter {
    font-size: 16px;
  }
  .realm-bar {
    width: 340px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
  }
  .realm-label {
    flex-shrink: 0;
  }
  .realm-select {
    flex: 1;
    min-width: 0;
  }
  .rc-btn.small {
    padding: 6px 10px;
    font-size: 11px;
    flex-shrink: 0;
  }
  .add-realm {
    width: 340px;
    box-sizing: border-box;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .note {
    color: var(--rc-ink-dim);
    font-size: 13px;
    text-align: center;
  }
  .error {
    color: #ff8a80;
    font-size: 13px;
    text-align: center;
  }
  .footer {
    position: absolute;
    bottom: 16px;
    width: 100%;
    text-align: center;
    font-family: var(--rc-display);
    font-size: 11px;
    letter-spacing: 2px;
    color: rgba(233, 226, 208, 0.5);
    text-shadow: 0 1px 3px #000;
  }
</style>
