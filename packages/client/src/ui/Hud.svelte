<script lang="ts">
  import { game } from "./gameState.svelte";
  import { app } from "./appState.svelte";
  import { promptLabel } from "./padGlyphs";
  import { spellDef, REVIVE_HOLD_S, TIER_NAMES } from "@rustcraft/shared";
  import Vitals from "./Vitals.svelte";
  import AuraBar from "./AuraBar.svelte";
  import Hotbar from "./Hotbar.svelte";
  import CharacterScreen from "./CharacterScreen.svelte";
  import Chat from "./Chat.svelte";
  import TopBar from "./TopBar.svelte";
  import Party from "./Party.svelte";
  import TargetFrame from "./TargetFrame.svelte";
  import QuestTracker from "./QuestTracker.svelte";
  import QuestDialog from "./QuestDialog.svelte";
  import ZoneBanner from "./ZoneBanner.svelte";
  import WorldEventBanner from "./WorldEventBanner.svelte";
  import MiniMap from "./MiniMap.svelte";
  import WorldMap from "./WorldMap.svelte";
  import LootModal from "./LootModal.svelte";
  import MenuShortcuts from "./MenuShortcuts.svelte";
  import PlayerContextMenu from "./PlayerContextMenu.svelte";
  import VendorWindow from "./VendorWindow.svelte";

  const interactKey = $derived(promptLabel("Ⓧ", "E"));

  let castProgress = $state(0);
  $effect(() => {
    const spellId = game.self?.castingSpell;
    if (!spellId || !game.self?.castEndsAt) {
      castProgress = 0;
      return;
    }
    let totalMs = 1000;
    try {
      totalMs = spellDef(spellId).castTimeS * 1000;
    } catch {
      totalMs = 1000;
    }
    const endsAt = game.self.castEndsAt;
    const interval = setInterval(() => {
      const currentServerTime = Date.now() - game.serverTimeOffset;
      const remaining = endsAt - currentServerTime;
      castProgress = totalMs > 0 ? Math.min(1, Math.max(0, 1 - remaining / totalMs)) : 1;
    }, 40);
    return () => clearInterval(interval);
  });

  let reviveProgress = $state(0);
  $effect(() => {
    if (!game.self?.revivingTargetId || !game.self.revivingEndsAt) {
      reviveProgress = 0;
      return;
    }
    const endsAt = game.self.revivingEndsAt;
    const totalMs = REVIVE_HOLD_S * 1000;
    const interval = setInterval(() => {
      const remaining = endsAt - game.serverTimeOffset - Date.now();
      reviveProgress = Math.min(1, Math.max(0, 1 - remaining / totalMs));
    }, 40);
    return () => clearInterval(interval);
  });
</script>

<div class="hud">
  {#if game.underwater && !game.self?.dead}
    <div
      class="underwater-tint"
      class:low-air={(game.self?.oxygen ?? 100) < 25}
      aria-hidden="true"
    ></div>
  {/if}
  {#if game.loading && !game.disconnected}
    <div class="loading-overlay">
      <div class="loading-content">
        <img src="/assets/ui/logo_eldor.png" alt="Shadows of Eldor" class="loading-logo" />
        <div class="progress-container">
          <div class="progress-bar">
            <div class="progress-fill" style="width: {game.loadingProgress}%"></div>
          </div>
          <div class="progress-glow" style="width: {game.loadingProgress}%"></div>
        </div>
        <div class="loading-status">{game.loadingMessage}</div>
        <div class="loading-percentage">{game.loadingProgress}%</div>
      </div>
    </div>
  {:else if !game.connected && !game.disconnected}
    <div class="center-note">Connecting…</div>
  {/if}

  {#if game.disconnected}
    <div class="overlay">
      <div class="overlay-box">
        <h2>Disconnected</h2>
        <button onclick={() => app.leaveWorld()}>Back to character select</button>
      </div>
    </div>
  {/if}

  {#if game.self?.dead}
    <div class="overlay death">
      <div class="death-title">YOU DIED</div>
      <div class="death-sub">{promptLabel("Press Ⓐ to respawn", "Press R to respawn")}</div>
    </div>
  {/if}

  {#if game.interactLabel && !game.self?.dead}
    <div class="interact">
      <div class="label">
        <span class="key">{interactKey}</span>
        <span class="label-text">{game.interactLabel}</span>
      </div>
    </div>
  {/if}

  {#if game.self?.mount && !game.self?.dead}
    <div class="mounted rc-frame">
      {game.self.mount === "horse" ? "🐎 Mounted" : "🛶 Rafting"}
      <span class="hint">{promptLabel("Back", "G")} to dismount</span>
    </div>
  {/if}

  {#if game.dungeonState}
    <div class="dungeon-chip rc-frame">
      ⚔ {TIER_NAMES[game.dungeonState.tier]} Dungeon
      {#if game.dungeonState.mobsRemaining !== null}
        <span class="hint">
          {game.dungeonState.mobsRemaining} remaining
        </span>
      {/if}
    </div>
  {/if}

  <div class="toasts">
    {#each game.toasts as toast (toast.id)}
      <div class="toast">{toast.text}</div>
    {/each}
  </div>

  {#if game.self?.castingSpell}
    <div class="castbar">
      <div class="castbar-fill" style="width: {castProgress * 100}%"></div>
      <span>{game.self.castingSpell}</span>
    </div>
  {/if}

  {#if game.self?.revivingTargetId}
    <div class="castbar revivebar">
      <div class="castbar-fill" style="width: {reviveProgress * 100}%"></div>
      <span>Reviving {game.nameOf(game.self.revivingTargetId)}…</span>
    </div>
  {/if}

  {#if game.connected}
    <TopBar />
    <Vitals />
    <AuraBar />
    <Hotbar />
    <Chat />
    <Party />
    <TargetFrame />
    <MiniMap />
    <MenuShortcuts />
    <QuestTracker />
    <WorldEventBanner />
    <ZoneBanner />
  {/if}

  {#if game.inventoryOpen}
    <CharacterScreen />
  {/if}
  <QuestDialog />
  <VendorWindow />
  <WorldMap />
  <LootModal />
  {#if game.playerContextMenu}
    <PlayerContextMenu
      x={game.playerContextMenu.x}
      y={game.playerContextMenu.y}
      playerName={game.playerContextMenu.playerName}
      playerLevel={game.playerContextMenu.playerLevel}
      playerClass={game.playerContextMenu.playerClass}
      onClose={() => (game.playerContextMenu = null)}
    />
  {/if}

  <div class="app-version">
    {__APP_VERSION__}
  </div>
</div>

<style>
  .hud {
    position: fixed;
    inset: 0;
    pointer-events: none;
    color: #eef2f6;
    font-family: var(--rc-body);
  }
  .underwater-tint {
    position: absolute;
    inset: 0;
    z-index: 2;
    background:
      radial-gradient(ellipse at 50% 40%, rgba(20, 70, 120, 0.18) 0%, rgba(8, 40, 80, 0.55) 70%, rgba(4, 20, 45, 0.72) 100%),
      linear-gradient(180deg, rgba(30, 110, 170, 0.22), rgba(10, 50, 100, 0.45));
    box-shadow: inset 0 0 120px rgba(0, 40, 80, 0.55);
    mix-blend-mode: multiply;
    transition: background 0.25s ease, opacity 0.25s ease;
  }
  .underwater-tint.low-air {
    background:
      radial-gradient(ellipse at 50% 40%, rgba(60, 40, 80, 0.25) 0%, rgba(20, 30, 70, 0.6) 70%, rgba(10, 10, 30, 0.78) 100%),
      linear-gradient(180deg, rgba(40, 80, 140, 0.3), rgba(40, 20, 50, 0.5));
    animation: drown-pulse 1.1s ease-in-out infinite;
  }
  @keyframes drown-pulse {
    50% {
      opacity: 0.82;
    }
  }
  .center-note {
    position: absolute;
    top: 40%;
    width: 100%;
    text-align: center;
    font-size: 20px;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.8);
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(20, 0, 0, 0.45);
    pointer-events: auto;
  }
  .overlay-box {
    text-align: center;
    background: rgba(10, 12, 18, 0.9);
    border: 1px solid #4a3a3a;
    border-radius: 10px;
    padding: 28px 40px;
  }
  .overlay-box h2 {
    margin: 0 0 10px;
  }
  .overlay-box button {
    margin-top: 14px;
    padding: 10px 16px;
    border-radius: 6px;
    border: 1px solid #46586f;
    background: #1c2635;
    color: #dce6f2;
    cursor: pointer;
  }
  .interact {
    position: absolute;
    bottom: 30%;
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 5;
  }
  .interact .label {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(10, 8, 5, 0.72);
    border: 1px solid rgba(255, 220, 120, 0.25);
    border-radius: 24px;
    padding: 6px 18px 6px 12px;
    max-width: min(560px, 88vw);
    backdrop-filter: blur(6px);
  }
  .interact .label-text {
    font-size: 17px;
    text-shadow: 0 2px 6px rgba(0, 0, 0, 0.9);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: #e8dcc8;
  }
  .interact .key {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
    background: rgba(20, 16, 10, 0.85);
    border: 1px solid var(--rc-gold);
    color: var(--rc-gold-bright);
    border-radius: 5px;
    padding: 2px 9px;
    font-weight: 700;
    font-family: var(--rc-display);
    font-size: 15px;
  }
  .mounted {
    position: absolute;
    bottom: 150px;
    left: 50%;
    transform: translateX(-50%);
    padding: 5px 14px;
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 1px;
    color: var(--rc-parchment);
    pointer-events: none;
    z-index: 5;
  }
  .mounted .hint {
    color: var(--rc-ink-dim);
    font-size: 11px;
    margin-left: 8px;
  }
  .dungeon-chip {
    position: absolute;
    top: 92px;
    left: 50%;
    transform: translateX(-50%);
    padding: 5px 14px;
    font-family: var(--rc-body);
    font-weight: 800;
    font-size: 12px;
    letter-spacing: 0.5px;
    color: var(--rc-ember);
    pointer-events: none;
    z-index: 5;
  }
  .dungeon-chip .hint {
    color: var(--rc-ink-dim);
    font-size: 11px;
    margin-left: 8px;
  }
  .overlay.death {
    flex-direction: column;
    gap: 12px;
    background: radial-gradient(ellipse at center, rgba(60, 0, 0, 0.55), rgba(10, 0, 0, 0.85));
  }
  .death-title {
    font-family: var(--rc-display);
    font-weight: 900;
    font-size: 64px;
    letter-spacing: 12px;
    color: #c23b2e;
    text-shadow: 0 0 40px rgba(194, 59, 46, 0.6), 0 4px 0 #000;
    animation: deathIn 1.2s ease-out;
  }
  .death-sub {
    font-family: var(--rc-display);
    color: var(--rc-ink-dim);
    letter-spacing: 3px;
  }
  @keyframes deathIn {
    from {
      opacity: 0;
      transform: scale(1.4);
      letter-spacing: 30px;
    }
    to {
      opacity: 1;
      transform: scale(1);
      letter-spacing: 12px;
    }
  }
  .toasts {
    position: absolute;
    bottom: 34%;
    right: 4%;
    display: flex;
    flex-direction: column;
    gap: 6px;
    align-items: flex-end;
  }
  .toast {
    background: rgba(10, 14, 20, 0.75);
    border-left: 3px solid #6f9c46;
    padding: 6px 12px;
    border-radius: 4px;
    font-size: 14px;
    animation: fadein 0.2s ease-out;
  }
  @keyframes fadein {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  .castbar {
    position: absolute;
    bottom: 200px;
    left: 50%;
    transform: translateX(-50%);
    width: 300px;
    height: 20px;
    background: rgba(8, 6, 14, 0.92);
    border: 1.5px solid var(--rc-gold-bright);
    border-radius: 4px;
    overflow: hidden;
    z-index: 50;
    box-shadow: 0 0 20px rgba(255, 215, 0, 0.4), 0 4px 14px rgba(0, 0, 0, 0.85);
  }
  .castbar-fill {
    height: 100%;
    background: linear-gradient(90deg, #b88f3a 0%, #ffd700 50%, #f5e088 100%);
    box-shadow: 0 0 12px #ffd700;
  }
  .castbar span {
    position: absolute;
    inset: 0;
    text-align: center;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
    line-height: 16px;
    text-shadow: 0 1px 2px #000;
    text-transform: uppercase;
  }
  .revivebar {
    bottom: 150px;
    border-color: rgba(120, 220, 140, 0.6);
  }
  .revivebar .castbar-fill {
    background: linear-gradient(90deg, #2e8a3a, #5ec46a);
  }
  .app-version {
    position: absolute;
    bottom: 16px;
    left: 12px;
    font-size: 10px;
    color: var(--rc-ink-dim, rgba(220, 230, 242, 0.45));
    font-family: monospace;
    pointer-events: none;
    z-index: 7;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    letter-spacing: 0.5px;
    z-index: 4;
  }
  .loading-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #080605 url('/assets/ui/loading_bg.jpg') no-repeat center center;
    background-size: cover;
    pointer-events: auto;
    z-index: 9999;
  }
  .loading-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    width: 440px;
    margin-top: 260px;
  }
  .loading-logo {
    max-width: 340px;
    height: auto;
    filter: drop-shadow(0 0 25px rgba(255, 170, 0, 0.65));
    animation: pulseLogo 3s ease-in-out infinite alternate;
  }
  .progress-container {
    position: relative;
    width: 100%;
    height: 12px;
    background: rgba(10, 8, 6, 0.88);
    border: 2px solid #d4af37;
    border-radius: 6px;
    box-shadow: 0 0 15px rgba(212, 175, 55, 0.4), inset 0 0 8px rgba(0, 0, 0, 0.9);
  }
  .progress-bar {
    width: 100%;
    height: 100%;
    border-radius: 4px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #b8511f 0%, #ffaa00 50%, #ffe57f 100%);
    border-radius: 4px;
    transition: width 0.3s ease-out;
    box-shadow: 0 0 10px rgba(255, 170, 0, 0.8);
  }
  .progress-glow {
    position: absolute;
    top: -2px;
    left: 0;
    height: 16px;
    background: linear-gradient(90deg, #b8511f, #ffaa00, #ffe57f);
    filter: blur(10px);
    opacity: 0.75;
    pointer-events: none;
    transition: width 0.3s ease-out;
  }
  .loading-status {
    font-size: 14px;
    color: #fce8a6;
    font-family: var(--rc-display, 'Cinzel', serif);
    letter-spacing: 2.5px;
    text-align: center;
    text-shadow: 0 2px 6px #000, 0 0 10px rgba(0, 0, 0, 0.9);
    min-height: 20px;
    font-weight: 700;
  }
  .loading-percentage {
    font-family: var(--rc-display, serif);
    font-size: 12px;
    font-weight: 700;
    color: #d4af37;
    letter-spacing: 2px;
    text-shadow: 0 1px 3px #000;
  }
  @keyframes pulseLogo {
    from {
      transform: scale(0.98);
      filter: drop-shadow(0 0 15px rgba(255, 170, 0, 0.4));
    }
    to {
      transform: scale(1.02);
      filter: drop-shadow(0 0 30px rgba(255, 200, 80, 0.8));
    }
  }
</style>
