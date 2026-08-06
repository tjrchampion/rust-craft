<script lang="ts">
  import { game } from "../gameState.svelte";
  import { getGame } from "../../game/instance";

  let { invitablePlayers }: { invitablePlayers: any[] } = $props();
  let friendInputName = $state("");
</script>

<div class="col social-tab-col">
  <h3>Friends & Contacts</h3>
  <div class="add-friend-form">
    <input
      type="text"
      class="rc-input"
      placeholder="Enter adventurer name..."
      bind:value={friendInputName}
      onkeydown={(e) => {
        if (e.key === "Enter" && friendInputName.trim()) {
          getGame()?.sendFriend("add", friendInputName.trim());
          friendInputName = "";
        }
      }}
    />
    <button
      class="rc-btn primary"
      onclick={() => {
        if (friendInputName.trim()) {
          getGame()?.sendFriend("add", friendInputName.trim());
          friendInputName = "";
        }
      }}
    >
      Add Friend
    </button>
  </div>

  <div class="friends-list">
    {#each game.friends as friend (friend.name)}
      <div class="friend-row" class:offline={!friend.online}>
        <div class="friend-info">
          <span class="status-dot" class:online={friend.online}></span>
          <div class="friend-text">
            <span class="friend-name">{friend.name}</span>
            {#if friend.online}
              <span class="friend-meta">lv{friend.level} · {friend.regionName ?? "Online"}</span>
            {:else}
              <span class="friend-meta offline">Offline</span>
            {/if}
          </div>
        </div>
        <div class="friend-actions">
          {#if friend.online}
            <button class="rc-btn primary sm" onclick={() => getGame()?.sendParty("invite", friend.name)} title="Start Party">
              ⚔️ Party
            </button>
            <button class="rc-btn ghost sm" onclick={() => { game.chatOpen = true; getGame()?.sendChat(`/w ${friend.name} `); }} title="Direct Message">
              💬 Whisper
            </button>
          {/if}
          <button class="rc-btn danger sm icon-only" onclick={() => getGame()?.sendFriend("remove", friend.name)} title="Remove Friend">
            ✕
          </button>
        </div>
      </div>
    {/each}
    {#if game.friends.length === 0}
      <div class="empty-note">No friends added yet. Type a player's name above to add them!</div>
    {/if}
  </div>
</div>

<div class="col roster-col">
  <h3>Online Realm Adventurers</h3>
  <div class="roster-list">
    {#each invitablePlayers as p (p.id)}
      <div class="roster-row">
        <span class="roster-name">{p.name} <span class="lvl">lv{p.level}</span></span>
        <div class="roster-actions">
          {#if !game.friends.some((f) => f.name.toLowerCase() === p.name.toLowerCase())}
            <button class="rc-btn ghost sm" onclick={() => getGame()?.sendFriend("add", p.name)}>+ Friend</button>
          {/if}
          <button class="rc-btn invite-btn sm" onclick={() => getGame()?.sendParty("invite", p.name)}>Invite</button>
        </div>
      </div>
    {/each}
    {#if invitablePlayers.length === 0}
      <div class="empty-note">No other players online right now.</div>
    {/if}
  </div>
</div>

<style>
  .social-tab-col {
    flex: 1.4;
    min-width: 440px;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .roster-col {
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
  .add-friend-form {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }
  .add-friend-form input {
    flex: 1;
    height: 38px;
    font-size: 13px;
    border-radius: 4px;
  }
  .add-friend-form button {
    height: 38px;
    padding: 0 16px;
    font-family: var(--rc-display);
    font-size: 12px;
    letter-spacing: 1px;
  }
  .friends-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 420px;
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 6px;
    margin-bottom: 12px;
  }
  .friend-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px;
    background: radial-gradient(circle at 50% 20%, rgba(28, 24, 18, 0.95), rgba(14, 12, 9, 0.98));
    border: 1px solid var(--rc-gold-dim);
    border-radius: 6px;
    gap: 12px;
    margin-bottom: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    overflow: hidden;
  }
  .friend-row.offline {
    opacity: 0.55;
  }
  .friend-info {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
  }
  .friend-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .status-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #666;
    flex-shrink: 0;
  }
  .status-dot.online {
    background: #4cd964;
    box-shadow: 0 0 8px #4cd964;
  }
  .friend-name {
    font-family: var(--rc-display);
    font-size: 13.5px;
    font-weight: 700;
    color: var(--rc-gold-bright);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .friend-meta {
    font-size: 11px;
    color: var(--rc-parchment);
    opacity: 0.85;
    white-space: nowrap;
  }
  .friend-meta.offline {
    color: #888;
  }
  .friend-actions, .roster-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .roster-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 420px;
    overflow-y: auto;
  }
  .roster-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
  }
  .roster-name {
    font-size: 13px;
    font-weight: 600;
    color: #fff;
  }
  .lvl {
    font-size: 11px;
    color: var(--rc-gold);
    margin-left: 4px;
  }
  .empty-note {
    color: #7a8b9e;
    font-style: italic;
    font-size: 13px;
    padding: 16px 0;
  }
</style>
