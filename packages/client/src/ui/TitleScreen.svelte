<script lang="ts">
  import { app } from "./appState.svelte";
  import Logo from "./Logo.svelte";

  let devName = $state("");

  let mode = $state<"login" | "signup">("login");
  let email = $state("");
  let password = $state("");
  let displayName = $state("");

  const providers = $derived(
    app.me?.providers ?? { discord: false, google: false, dev: true, password: true },
  );

  function submitPassword(e: SubmitEvent): void {
    e.preventDefault();
    if (!email.trim() || !password) return;
    if (mode === "signup") void app.signup(email.trim(), password, displayName.trim() || undefined);
    else void app.login(email.trim(), password);
  }
</script>

<div class="title-screen">
  <div class="vignette"></div>

  <div class="content">
    <Logo />

    <div class="card rc-frame">
      {#if providers.password}
        <div class="mode-tabs">
          <button
            type="button"
            class="mode-tab"
            class:active={mode === "login"}
            onclick={() => (mode = "login")}
          >
            Sign In
          </button>
          <button
            type="button"
            class="mode-tab"
            class:active={mode === "signup"}
            onclick={() => (mode = "signup")}
          >
            Create Account
          </button>
        </div>
        <form onsubmit={submitPassword}>
          <input
            class="rc-input"
            type="email"
            placeholder="Email"
            bind:value={email}
            maxlength={120}
            autocomplete="email"
          />
          {#if mode === "signup"}
            <input
              class="rc-input"
              placeholder="Display name (optional)"
              bind:value={displayName}
              maxlength={24}
            />
          {/if}
          <input
            class="rc-input"
            type="password"
            placeholder="Password"
            bind:value={password}
            maxlength={200}
            autocomplete={mode === "signup" ? "new-password" : "current-password"}
          />
          <button class="rc-btn enter" type="submit">
            {mode === "signup" ? "Create Account" : "Sign In"}
          </button>
        </form>
      {/if}

      {#if providers.discord || providers.google}
        {#if providers.password}
          <div class="rc-divider"></div>
        {/if}
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
      {/if}

      {#if providers.dev}
        {#if providers.password || providers.discord || providers.google}
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

      {#if !providers.password && !providers.discord && !providers.google && !providers.dev}
        <div class="note">No sign-in method configured on this realm.</div>
      {/if}

      {#if app.error}
        <div class="error">{app.error}</div>
      {/if}
    </div>
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
  .mode-tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 4px;
  }
  .mode-tab {
    flex: 1;
    background: transparent;
    border: 1px solid var(--rc-gold-dim);
    color: var(--rc-ink-dim);
    border-radius: 5px;
    padding: 7px 0;
    font-family: var(--rc-display);
    font-size: 12px;
    letter-spacing: 1px;
    cursor: pointer;
  }
  .mode-tab.active {
    border-color: var(--rc-gold-bright);
    color: var(--rc-gold-bright);
    background: rgba(212, 175, 92, 0.12);
  }
  .rc-btn.enter {
    font-size: 16px;
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
