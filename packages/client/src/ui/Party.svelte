<script lang="ts">
  import { game } from "./gameState.svelte";
  import { getGame } from "../game/instance";
  import { onDestroy } from "svelte";
  import { type ClassId } from "@rustcraft/shared";
  import { CLASS_ICONS } from "../render/classModels";

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

  function memberIcon(memberId: string): string {
    const classId = game.roster.find((r) => r.id === memberId)?.classId as ClassId | undefined;
    return (classId && CLASS_ICONS[classId]) || "⚔️";
  }
</script>

{#if game.pvpEnabled}
  <div class="pvp-flag rc-hud-panel">
    <span class="swords">⚔</span> PvP ENABLED
  </div>
{/if}

{#if showOverlay && game.pendingInvite}
  <div class="invite-banner rc-frame">
    <div class="invite-info">
      <span class="invite-icon">⚔️</span>
      <div class="invite-text">
        <strong>{game.pendingInvite}</strong> invited you to a party!
        <span class="countdown">({countdown}s)</span>
      </div>
    </div>
    <div class="invite-actions">
      <button class="rc-btn primary sm" onclick={acceptInvite}>Accept</button>
      <button class="rc-btn ghost sm" onclick={declineInvite}>Decline</button>
    </div>
  </div>
{/if}

{#if game.party && game.party.length > 1}
  <div class="party">
    {#each otherMembers as member (member.id)}
      <div class="member" class:offline={!member.online}>
        <div class="portrait">{memberIcon(member.id)}</div>
        <div class="meta">
          <div class="member-name">
            {#if member.leader}<span class="crown">◆</span>{/if}
            <span class="name">{member.name}</span>
          </div>
          <div class="rc-resource-bar hp angled">
            <div class="fill" style="width: {Math.min(100, (member.hp / member.maxHp) * 100)}%"></div>
          </div>
          <div class="rc-resource-bar mana angled">
            <div class="fill" style="width: 100%"></div>
          </div>
        </div>
      </div>
    {/each}
    {#if amLeader}
      <button class="rc-btn ghost sm leave" onclick={() => getGame()?.sendParty("disband")}>Disband</button>
    {:else}
      <button class="rc-btn ghost sm leave" onclick={() => getGame()?.sendParty("leave")}>Leave</button>
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
    font-size: 11px;
    letter-spacing: 2px;
    color: #ff7a6e;
    pointer-events: none;
    z-index: 6;
  }
  .swords { color: #ff5040; }
  .invite-banner {
    position: absolute;
    top: 24px;
    left: 50%;
    transform: translateX(-50%);
    padding: 12px 18px;
    display: flex;
    align-items: center;
    gap: 16px;
    pointer-events: auto;
    z-index: 1000;
  }
  .invite-info {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .invite-icon { font-size: 18px; }
  .invite-text {
    color: var(--rc-ink);
    font-size: 13px;
    white-space: nowrap;
  }
  .invite-text strong { color: var(--rc-gold-bright); }
  .countdown {
    font-size: 11px;
    color: var(--rc-ink-dim);
    margin-left: 4px;
  }
  .invite-actions {
    display: flex;
    gap: 8px;
  }

  .party {
    position: absolute;
    top: 118px;
    left: 14px;
    width: 200px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    pointer-events: auto;
    z-index: 4;
  }
  .member {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .member.offline { opacity: 0.4; }
  .portrait {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 28%, #3a2a48, #120e18);
    border: 1.5px solid var(--rc-gold-dim);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    flex-shrink: 0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.55);
  }
  .meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .member-name {
    display: flex;
    align-items: baseline;
    gap: 4px;
  }
  .crown {
    font-size: 9px;
    color: var(--rc-gold-bright);
  }
  .name {
    font-size: 11px;
    font-weight: 700;
    font-family: var(--rc-display);
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: #f0eaf6;
    text-shadow: 0 1px 2px #000;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .member :global(.rc-resource-bar) {
    height: 8px;
  }
  .member :global(.rc-resource-bar.mana) {
    height: 5px;
    opacity: 0.85;
  }
  .leave {
    align-self: flex-start;
    margin-top: 2px;
  }
</style>
