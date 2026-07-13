<script lang="ts">
  import { game } from "./gameState.svelte";
  import { getGame } from "../game/instance";

  const otherMembers = $derived((game.party ?? []).filter((m) => m.id !== game.selfId));
</script>

<!-- PvP indicator -->
{#if game.pvpEnabled}
  <div class="pvp-flag rc-frame">
    <span class="swords">⚔</span> PvP ENABLED
  </div>
{/if}

<!-- Party invite prompt -->
{#if game.pendingInvite}
  <div class="invite rc-frame">
    <div class="invite-text"><strong>{game.pendingInvite}</strong> invites you to a party</div>
    <div class="invite-buttons">
      <button class="rc-btn primary" onclick={() => getGame()?.sendParty("accept")}>Accept</button>
      <button class="rc-btn" onclick={() => getGame()?.sendParty("decline")}>Decline</button>
    </div>
  </div>
{/if}

<!-- Party member frames -->
{#if game.party && game.party.length > 1}
  <div class="party">
    <div class="party-title rc-frame-title">Party</div>
    {#each otherMembers as member (member.id)}
      <div class="member rc-frame" class:offline={!member.online}>
        <div class="member-name">{member.name} <span class="lvl">lv{member.level}</span></div>
        <div class="member-bar">
          <div class="member-fill" style="width: {(member.hp / member.maxHp) * 100}%"></div>
        </div>
      </div>
    {/each}
    <button class="rc-btn leave" onclick={() => getGame()?.sendParty("leave")}>Leave Party</button>
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
  .invite {
    position: absolute;
    top: 90px;
    left: 50%;
    transform: translateX(-50%);
    padding: 14px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: center;
    pointer-events: auto;
  }
  .invite-text {
    color: var(--rc-ink);
    font-size: 14px;
  }
  .invite-text strong {
    color: var(--rc-gold-bright);
  }
  .invite-buttons {
    display: flex;
    gap: 8px;
  }
  .invite-buttons .rc-btn {
    padding: 6px 16px;
    font-size: 13px;
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
