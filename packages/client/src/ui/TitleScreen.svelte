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

    <div class="social-links">
      <a
        href="https://discord.com/channels/1534903441699115039/1534903445159546893"
        target="_blank"
        rel="noopener noreferrer"
        class="social-link discord"
        title="Discord"
        aria-label="Discord"
      >
        <svg viewBox="0 0 24 24" class="social-icon">
          <path
            d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.021-.041.001-.09-.041-.106a13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
            fill="currentColor"
          />
        </svg>
      </a>

      <a
        href="https://www.youtube.com/@shadowsofeldor"
        target="_blank"
        rel="noopener noreferrer"
        class="social-link youtube"
        title="YouTube"
        aria-label="YouTube"
      >
        <svg viewBox="0 0 24 24" class="social-icon">
          <path
            d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"
            fill="currentColor"
          />
        </svg>
      </a>

      <a
        href="#"
        onclick={(e) => e.preventDefault()}
        class="social-link github"
        title="GitHub"
        aria-label="GitHub"
      >
        <svg viewBox="0 0 24 24" class="social-icon">
          <path
            d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"
            fill="currentColor"
          />
        </svg>
      </a>
    </div>
  </div>

  <div class="footer">Shadows of Eldor pre-alpha · a persistent realm of magic & adventure</div>
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
    background: #080605 url('/assets/ui/loading_bg.jpg') no-repeat center center;
    background-size: cover;
  }
  .vignette {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse at center 40%, transparent 20%, rgba(6, 4, 3, 0.45) 75%, rgba(4, 2, 1, 0.82) 100%),
      linear-gradient(180deg, rgba(8, 6, 4, 0.2) 0%, transparent 40%, rgba(6, 4, 3, 0.4) 100%);
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
  .social-links {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    margin-top: 2px;
  }
  .social-link {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: linear-gradient(165deg, rgba(40, 30, 52, 0.9), rgba(16, 12, 22, 0.95));
    border: 1px solid var(--rc-gold-dim);
    color: var(--rc-gold);
    box-shadow:
      inset 0 0 0 1px rgba(232, 200, 120, 0.08),
      0 4px 12px rgba(0, 0, 0, 0.5);
    transition: all 0.2s ease;
    text-decoration: none;
  }
  .social-link:hover {
    border-color: var(--rc-gold-bright);
    color: var(--rc-gold-bright);
    transform: translateY(-2px);
    box-shadow:
      0 0 14px rgba(232, 200, 120, 0.35),
      0 6px 16px rgba(0, 0, 0, 0.6);
  }
  .social-link.discord:hover {
    color: #7289da;
    border-color: #7289da;
    box-shadow: 0 0 14px rgba(114, 137, 218, 0.45);
  }
  .social-link.youtube:hover {
    color: #ff4e4e;
    border-color: #ff4e4e;
    box-shadow: 0 0 14px rgba(255, 78, 78, 0.45);
  }
  .social-link.github:hover {
    color: #ffffff;
    border-color: #ffffff;
    box-shadow: 0 0 14px rgba(255, 255, 255, 0.35);
  }
  .social-icon {
    width: 20px;
    height: 20px;
  }
  .title-top-bar {
    position: absolute;
    top: 20px;
    right: 24px;
    z-index: 10;
  }
  .top-link-btn {
    font-size: 12px;
    padding: 8px 14px;
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
