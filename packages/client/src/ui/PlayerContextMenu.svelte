<script lang="ts">
  import { onMount } from "svelte";
  import { game } from "./gameState.svelte";
  import { getGame } from "../game/instance";

  let {
    x,
    y,
    playerName,
    playerLevel = 1,
    playerClass = "Warrior",
    onClose,
  }: {
    x: number;
    y: number;
    playerName: string;
    playerLevel?: number;
    playerClass?: string;
    onClose: () => void;
  } = $props();

  let menuEl: HTMLDivElement;

  let isFriend = $derived(
    game.friends.some((f) => f.name.toLowerCase() === playerName.toLowerCase()),
  );

  function handleAddFriend(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    getGame()?.sendFriend("add", playerName);
    game.toast(`Added ${playerName} to your friends list.`);
    onClose();
  }

  function handleInviteParty(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    getGame()?.sendParty("invite", playerName);
    game.toast(`Invited ${playerName} to your party.`);
    onClose();
  }

  function handleWhisper(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    getGame()?.sendChat(`/w ${playerName} `);
    game.chatOpen = true;
    onClose();
  }

  function handleInspect(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    game.toast(`Inspecting ${playerName} (Level ${playerLevel} ${playerClass})`);
    onClose();
  }

  function handleReport(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    game.toast(`Report filed for player ${playerName}. Thank you.`);
    onClose();
  }

  onMount(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuEl && !menuEl.contains(e.target as Node)) {
        onClose();
      }
    }

    const timer = setTimeout(() => {
      window.addEventListener("mousedown", handleClickOutside);
    }, 50);

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  });
  let amLeader = $derived(
    (game.party ?? []).find((m) => m.id === game.selfId)?.leader ?? false,
  );

  let isPartyMember = $derived(
    (game.party ?? []).some((m) => m.name.toLowerCase() === playerName.toLowerCase()),
  );

  function handleSetTag(e: MouseEvent, tag: string) {
    e.stopPropagation();
    e.preventDefault();
    getGame()?.sendPartyTag(playerName, tag);
    game.toast(`Set overhead tag '${tag}' on ${playerName}`);
    onClose();
  }
</script>

<div
  bind:this={menuEl}
  class="player-context-menu rc-frame"
  style="left: {Math.min(window.innerWidth - 200, Math.max(10, x))}px; top: {Math.min(window.innerHeight - 280, Math.max(10, y))}px;"
  oncontextmenu={(e) => e.preventDefault()}
>
  <div class="header">
    <span class="p-name">⚔️ {playerName}</span>
    <span class="p-meta">Level {playerLevel} {playerClass}</span>
  </div>
  <div class="menu-divider"></div>
  <div class="menu-items">
    {#if !isFriend}
      <button class="menu-item" onmousedown={handleAddFriend}>
        <span class="icon">➕</span> Add Friend
      </button>
    {/if}
    <button class="menu-item" onmousedown={handleInviteParty}>
      <span class="icon">⚔️</span> Invite to Party
    </button>
    <button class="menu-item" onmousedown={handleWhisper}>
      <span class="icon">💬</span> Direct Message
    </button>
    <button class="menu-item" onmousedown={handleInspect}>
      <span class="icon">🔍</span> Inspect
    </button>

    {#if amLeader && isPartyMember}
      <div class="menu-divider"></div>
      <div class="tag-section-title">Assign Party Tag:</div>
      <div class="tag-picker-row">
        <button class="tag-btn" onmousedown={(e) => handleSetTag(e, "target")} title="Target (Attack)">⚔️</button>
        <button class="tag-btn" onmousedown={(e) => handleSetTag(e, "shield")} title="Shield (Tank)">🛡️</button>
        <button class="tag-btn" onmousedown={(e) => handleSetTag(e, "star")} title="Star">⭐</button>
        <button class="tag-btn" onmousedown={(e) => handleSetTag(e, "skull")} title="Skull">💀</button>
        <button class="tag-btn" onmousedown={(e) => handleSetTag(e, "diamond")} title="Diamond">💎</button>
        <button class="tag-btn clear" onmousedown={(e) => handleSetTag(e, "clear")} title="Clear Tag">✕</button>
      </div>
    {/if}

    <div class="menu-divider"></div>
    <button class="menu-item danger" onmousedown={handleReport}>
      <span class="icon">🚨</span> Report Player
    </button>
  </div>
</div>

<style>
  .player-context-menu {
    position: fixed;
    z-index: 99999;
    width: 165px;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    background: radial-gradient(circle at 50% 20%, rgba(22, 18, 14, 0.98), rgba(10, 8, 6, 0.99));
    border: 1px solid var(--rc-gold-bright);
    border-radius: 6px;
    box-shadow: 0 10px 35px rgba(0, 0, 0, 0.95), 0 0 15px rgba(201, 162, 75, 0.2);
    user-select: none;
    pointer-events: auto !important;
  }
  .header {
    display: flex;
    flex-direction: column;
    padding: 5px 8px;
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(201, 162, 75, 0.2);
    border-radius: 4px;
    margin-bottom: 2px;
  }
  .p-name {
    font-family: var(--rc-display);
    font-size: 12.5px;
    font-weight: 700;
    color: var(--rc-gold-bright);
    letter-spacing: 0.5px;
  }
  .p-meta {
    font-size: 10px;
    color: var(--rc-parchment);
    text-transform: capitalize;
    opacity: 0.8;
  }
  .menu-divider {
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(201, 162, 75, 0.4), transparent);
    margin: 3px 0;
  }
  .menu-items {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 9px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    color: var(--rc-ink);
    font-family: var(--rc-body);
    font-size: 11.5px;
    font-weight: 600;
    border-radius: 4px;
    text-align: left;
    cursor: url('/assets/cursors/02.png') 2 2, pointer !important;
    pointer-events: auto !important;
    transition: all 0.12s ease;
  }
  .menu-item:hover {
    background: linear-gradient(90deg, rgba(201, 162, 75, 0.32), rgba(201, 162, 75, 0.12));
    border-color: rgba(255, 214, 110, 0.45);
    color: var(--rc-gold-bright);
    box-shadow: inset 0 0 10px rgba(255, 214, 110, 0.15), 0 2px 8px rgba(0, 0, 0, 0.4);
    transform: translateX(2px);
  }
  .menu-item:active {
    cursor: url('/assets/cursors/03.png') 2 2, pointer !important;
    background: rgba(201, 162, 75, 0.45);
    transform: translateX(1px) translateY(1px);
  }
  .menu-item.danger:hover {
    background: linear-gradient(90deg, rgba(184, 58, 58, 0.38), rgba(184, 58, 58, 0.12));
    border-color: rgba(255, 100, 100, 0.45);
    color: #ff9999;
  }
  .icon {
    font-size: 13px;
    width: 16px;
    text-align: center;
  }
  .tag-section-title {
    font-size: 10px;
    font-weight: 700;
    color: var(--rc-gold-bright);
    letter-spacing: 0.5px;
    margin: 2px 0 4px 2px;
  }
  .tag-picker-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 3px;
    padding: 2px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(201, 162, 75, 0.2);
    border-radius: 4px;
  }
  .tag-btn {
    width: 22px;
    height: 22px;
    padding: 0;
    font-size: 11px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    cursor: url('/assets/cursors/02.png') 2 2, pointer !important;
    transition: all 0.1s ease;
  }
  .tag-btn:hover {
    background: rgba(201, 162, 75, 0.35);
    border-color: var(--rc-gold-bright);
    transform: scale(1.1);
  }
  .tag-btn.clear {
    color: #ff6666;
    font-size: 10px;
    font-weight: bold;
  }
</style>
