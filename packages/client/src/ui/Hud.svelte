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
  import MiniMap from "./MiniMap.svelte";
  import WorldMap from "./WorldMap.svelte";

  const interactKey = $derived(promptLabel("Ⓧ", "E"));

  let castProgress = $state(0);
  $effect(() => {
    if (!game.self?.castingSpell || !game.self.castEndsAt) {
      castProgress = 0;
      return;
    }
    const endsAt = game.self.castEndsAt;
    const totalMs = spellDef(game.self.castingSpell).castTimeS * 1000;
    const interval = setInterval(() => {
      // castEndsAt is a server-clock timestamp; subtract serverTimeOffset
      // (sampled once at connect) before comparing against our own
      // Date.now(), or any client/server clock skew throws this off.
      const remaining = endsAt - game.serverTimeOffset - Date.now();
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
  {#if !game.connected && !game.disconnected}
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
      <span class="key">{interactKey}</span>
      {game.interactLabel}
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
    <QuestTracker />
    <ZoneBanner />
  {/if}

  {#if game.inventoryOpen}
    <CharacterScreen />
  {/if}
  <QuestDialog />
  <WorldMap />

  <div class="app-version">
    {__APP_VERSION__}
  </div>
</div>

<style>
  .hud {
    position: fixed;
    inset: 0;
    pointer-events: none;
    color: #e8f0fa;
    font-family: system-ui, sans-serif;
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
    bottom: 26%;
    width: 100%;
    text-align: center;
    font-size: 17px;
    text-shadow: 0 2px 6px rgba(0, 0, 0, 0.9);
  }
  .interact .key {
    display: inline-block;
    background: rgba(20, 16, 10, 0.85);
    border: 1px solid var(--rc-gold);
    color: var(--rc-gold-bright);
    border-radius: 5px;
    padding: 2px 9px;
    margin-right: 8px;
    font-weight: 700;
    font-family: var(--rc-display);
  }
  .mounted {
    position: absolute;
    bottom: 130px;
    left: 50%;
    transform: translateX(-50%);
    padding: 5px 14px;
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 13px;
    color: var(--rc-parchment);
    pointer-events: none;
  }
  .mounted .hint {
    color: var(--rc-ink-dim);
    font-size: 11px;
    margin-left: 8px;
  }
  .dungeon-chip {
    position: absolute;
    top: 76px;
    left: 50%;
    transform: translateX(-50%);
    padding: 5px 14px;
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 13px;
    color: #c583ff;
    pointer-events: none;
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
    bottom: 22%;
    left: 50%;
    transform: translateX(-50%);
    width: 240px;
    height: 18px;
    background: rgba(8, 10, 16, 0.8);
    border: 1px solid rgba(200, 120, 255, 0.6);
    border-radius: 5px;
    overflow: hidden;
  }
  .castbar-fill {
    height: 100%;
    background: linear-gradient(90deg, #7a3fbf, #c878ff);
  }
  .castbar span {
    position: absolute;
    inset: 0;
    text-align: center;
    font-size: 12px;
    line-height: 18px;
    text-shadow: 0 1px 2px #000;
  }
  .revivebar {
    bottom: 27%;
    border-color: rgba(120, 220, 140, 0.6);
  }
  .revivebar .castbar-fill {
    background: linear-gradient(90deg, #2e8a3a, #5ec46a);
  }
  .app-version {
    position: absolute;
    bottom: 8px;
    right: 12px;
    font-size: 10px;
    color: var(--rc-ink-dim, rgba(220, 230, 242, 0.45));
    font-family: monospace;
    pointer-events: none;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
    letter-spacing: 0.5px;
  }
</style>
