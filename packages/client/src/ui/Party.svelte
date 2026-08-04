<script lang="ts">
  import { game } from "./gameState.svelte";
  import { getGame } from "../game/instance";
  import { onDestroy } from "svelte";

  const otherMembers = $derived((game.party ?? []).filter((m) => m.id !== game.selfId));
  const amLeader = $derived((game.party ?? []).find((m) => m.id === game.selfId)?.leader ?? false);

  let showOverlay = $state(false);
  let countdown = $state(15);
  let timer: any = null;

  $effect(() => {
    const invite = game.pendingInvite;
    if (invite) {
      showOverlay = true;
      countdown = 15;
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        countdown--;
        if (countdown <= 0) {
          showOverlay = false;
          clearInterval(timer);
        }
      }, 1000);
    } else {
      showOverlay = false;
      if (timer) clearInterval(timer);
    }
  });

  onDestroy(() => {
    if (timer) clearInterval(timer);
  });

  function acceptInvite() {
    getGame()?.sendParty("accept");
    showOverlay = false;
  }

  function declineInvite() {
    getGame()?.sendParty("decline");
    showOverlay = false;
  }
</script>

<!-- PvP indicator -->
{#if game.pvpEnabled}
  <div class="pvp-flag rc-frame">
    <span class="swords">⚔</span> PvP ENABLED
  </div>
{/if}

<!-- Party invite prompt -->
{#if showOverlay && game.pendingInvite}
  <div class="invite-banner rc-frame">
    <div class="invite-info">
      <span class="invite-icon">⚔️</span>
      <div class="invite-text">
        <strong>{game.pendingInvite}</strong> invited you to a party! <span class="countdown">({countdown}s)</span>
      </div>
    </div>
    <div class="invite-actions">
      <button class="rc-btn primary sm" onclick={acceptInvite}>✔ Accept</button>
      <button class="rc-btn ghost sm" onclick={declineInvite}>✕ Decline</button>
    </div>
  </div>
{/if}

<!-- Party member frames -->
{#if game.party && game.party.length > 1}
  <div class="party">
    <div class="party-title rc-frame-title">Party</div>
    {#each otherMembers as member (member.id)}
      <div class="member rc-frame" class:offline={!member.online}>
        <div class="member-name">
          {#if member.leader}<span class="crown" title="Party leader">👑</span>{/if}
          {member.name} <span class="lvl">lv{member.level}</span>
        </div>
        <div class="member-bar">
          <div class="member-fill" style="width: {Math.min(100, (member.hp / member.maxHp) * 100)}%"></div>
        </div>
      </div>
    {/each}
    {#if amLeader}
      <button class="rc-btn leave" onclick={() => getGame()?.sendParty("disband")}>Disband Party</button>
    {:else}
      <button class="rc-btn leave" onclick={() => getGame()?.sendParty("leave")}>Leave Party</button>
    {/if}
  </div>
{/if}

<style>
  .pvp-flag {
    position: absolute;
    top: 52px;
    left: 50%;
    transform: translateX(-50%);
    padding: 4px 14px;
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 2px;
    color: #ff7a6e;
    border-color: #7a2a2a;
    pointer-events: none;
  }
  .swords {
    color: #ff5040;
  }
  .invite-banner {
    position: absolute;
    top: 24px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 16px;
    display: flex;
    align-items: center;
    gap: 16px;
    pointer-events: auto;
    z-index: 1000;
    border-radius: 8px;
    background: radial-gradient(circle at 50% 20%, rgba(26, 22, 16, 0.98), rgba(12, 10, 8, 0.99));
    border: 2px solid var(--rc-gold-bright);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.9), 0 0 20px rgba(255, 214, 110, 0.25);
  }
  .invite-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .invite-icon {
    font-size: 18px;
  }
  .invite-text {
    color: var(--rc-parchment);
    font-size: 13px;
    white-space: nowrap;
  }
  .invite-text strong {
    color: var(--rc-gold-bright);
  }
  .countdown {
    font-size: 11px;
    color: var(--rc-ink-dim);
    margin-left: 4px;
  }
  .invite-actions {
    display: flex;
    gap: 8px;
  }
  .invite-text strong {
    color: var(--rc-gold-bright);
  }

  .party {
    position: absolute;
    top: 120px;
    left: 16px;
    width: 180px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    pointer-events: auto;
  }
  .party-title {
    padding-left: 2px;
  }
  .member {
    padding: 6px 8px;
  }
  .member.offline {
    opacity: 0.45;
  }
  .member-name {
    font-size: 12px;
    color: var(--rc-parchment);
    margin-bottom: 3px;
  }
  .crown {
    font-size: 10px;
    margin-right: 1px;
  }
  .lvl {
    color: var(--rc-ink-dim);
    font-size: 10px;
  }
  .member-bar {
    height: 8px;
    background: rgba(0, 0, 0, 0.6);
    border-radius: 3px;
    overflow: hidden;
  }
  .member-fill {
    height: 100%;
    background: linear-gradient(180deg, #5ec46a, #2e8a3a);
    transition: width 0.3s ease-out;
  }
  .leave {
    padding: 4px 8px;
    font-size: 10px;
    margin-top: 2px;
  }
</style>
