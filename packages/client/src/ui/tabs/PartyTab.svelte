<script lang="ts">
  import { game } from "../gameState.svelte";
  import { getGame } from "../../game/instance";

  let { amLeader }: { amLeader: boolean } = $props();
</script>

<div class="col party-tab-col full-width">
  <h3>Your Party</h3>
  {#if game.pendingInvite}
    <div class="pending-invite-box rc-frame">
      <div class="pending-invite-text">
        <strong>{game.pendingInvite}</strong> invites you to a party
      </div>
      <div class="pending-invite-actions">
        <button class="rc-btn primary" onclick={() => getGame()?.sendParty("accept")}>Accept</button>
        <button class="rc-btn ghost" onclick={() => getGame()?.sendParty("decline")}>Decline</button>
      </div>
    </div>
  {:else if game.party && game.party.length > 0}
    <div class="party-list">
      {#each game.party as member (member.id)}
        <div class="party-member" class:offline={!member.online}>
          <div class="pm-info">
            <span class="pm-name">
              {#if member.leader}<span class="crown" title="Party Leader">👑</span>{/if}
              {#if member.tag && member.tag !== "crown"}
                <span class="pm-tag-icon" title="Party Tag: {member.tag}">
                  {member.tag === "target" ? "⚔️" : member.tag === "shield" ? "🛡️" : member.tag === "star" ? "⭐" : member.tag === "skull" ? "💀" : member.tag === "diamond" ? "💎" : "🏷️"}
                </span>
              {/if}
              {member.name} <span class="lvl">lv{member.level}</span>
            </span>
            <div class="pm-bar">
              <div class="pm-fill" style="width: {Math.min(100, (member.hp / member.maxHp) * 100)}%"></div>
            </div>
          </div>
          {#if amLeader && !member.leader}
            <div class="pm-tag-picker">
              <button class="tag-sm" onclick={() => getGame()?.sendPartyTag(member.name, "target")} title="Tag Target">⚔️</button>
              <button class="tag-sm" onclick={() => getGame()?.sendPartyTag(member.name, "shield")} title="Tag Shield">🛡️</button>
              <button class="tag-sm" onclick={() => getGame()?.sendPartyTag(member.name, "star")} title="Tag Star">⭐</button>
              <button class="tag-sm" onclick={() => getGame()?.sendPartyTag(member.name, "skull")} title="Tag Skull">💀</button>
              <button class="tag-sm" onclick={() => getGame()?.sendPartyTag(member.name, "diamond")} title="Tag Diamond">💎</button>
              <button class="tag-sm clear" onclick={() => getGame()?.sendPartyTag(member.name, "clear")} title="Clear Tag">✕</button>
            </div>
          {/if}
        </div>
      {/each}
    </div>
    {#if amLeader}
      <button class="rc-btn ghost leave-btn" onclick={() => getGame()?.sendParty("disband")}>Disband Party</button>
    {:else}
      <button class="rc-btn ghost leave-btn" onclick={() => getGame()?.sendParty("leave")}>Leave Party</button>
    {/if}
  {:else}
    <div class="empty-note">You are not currently in a party. Invite friends or realm players from the Social tab!</div>
  {/if}
</div>

<style>
  .party-tab-col {
    width: 100%;
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  h3 {
    margin: 0 0 8px;
    font-family: var(--rc-display);
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: var(--rc-gold);
  }
  .pending-invite-box {
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 2px dashed rgba(201, 162, 75, 0.3);
    border-radius: 6px;
    padding: 14px;
    margin-bottom: 12px;
  }
  .pending-invite-text {
    font-size: 13px;
    color: var(--rc-parchment);
    line-height: 1.5;
  }
  .pending-invite-text strong {
    color: var(--rc-gold-bright);
  }
  .pending-invite-actions {
    display: flex;
    gap: 8px;
  }
  .party-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .party-member {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: radial-gradient(circle at 50% 20%, rgba(28, 24, 18, 0.95), rgba(14, 12, 9, 0.98));
    border: 1px solid var(--rc-gold-dim);
    border-radius: 6px;
    padding: 8px 12px;
    gap: 12px;
  }
  .party-member.offline {
    opacity: 0.45;
  }
  .pm-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
  }
  .pm-name {
    font-family: var(--rc-display);
    font-size: 13px;
    font-weight: 700;
    color: var(--rc-gold-bright);
  }
  .pm-bar {
    height: 6px;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 3px;
    overflow: hidden;
  }
  .pm-fill {
    height: 100%;
    background: linear-gradient(90deg, #4cd964, #2ecc71);
    border-radius: 3px;
  }
  .pm-tag-picker {
    display: flex;
    gap: 4px;
  }
  .tag-sm {
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
    padding: 2px 4px;
  }
  .tag-sm:hover {
    border-color: var(--rc-gold-bright);
  }
  .leave-btn {
    margin-top: 14px;
  }
  .empty-note {
    color: #7a8b9e;
    font-style: italic;
    font-size: 13px;
    padding: 16px 0;
  }
</style>
