<script lang="ts">
  import { game } from "./gameState.svelte";
  import { getGame } from "../game/instance";

  type Tab = "realm" | "party" | "combat";

  let text = $state("");
  let tab = $state<Tab>("realm");
  let inputEl = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (game.chatOpen && inputEl) inputEl.focus();
  });

  function runCommand(raw: string): boolean {
    const [cmd, ...rest] = raw.slice(1).split(" ");
    const g = getGame();
    if (!g) return true;
    switch (cmd?.toLowerCase()) {
      case "invite":
        if (rest[0]) g.sendParty("invite", rest[0]);
        return true;
      case "leave":
        g.sendParty("leave");
        return true;
      case "p":
      case "party":
        if (rest.length) g.sendChat(rest.join(" "), "party");
        return true;
      case "pvp":
        g.sendPvp(!game.pvpEnabled);
        return true;
      default:
        game.toast(`Unknown command: /${cmd}`);
        return true;
    }
  }

  function submit(): void {
    const trimmed = text.trim();
    if (trimmed) {
      if (trimmed.startsWith("/")) runCommand(trimmed);
      else getGame()?.sendChat(trimmed, tab === "party" ? "party" : "realm");
    }
    text = "";
    close();
  }

  function close(): void {
    game.chatOpen = false;
    getGame()?.setUiMode(false);
  }

  const lines = $derived(
    tab === "combat"
      ? game.combatLog.slice(-9).map((l) => ({ from: "", text: l.text, channel: "combat", at: l.at }))
      : game.chatLog
          .filter((l) => (tab === "party" ? l.channel === "party" : l.channel !== "party"))
          .slice(-9),
  );
</script>

<div class="chat">
  <div class="tabs" class:visible={game.chatOpen}>
    {#each ["realm", "party", "combat"] as t (t)}
      <button class="tab" class:active={tab === t} onclick={() => (tab = t as Tab)}>
        {t === "realm" ? "Realm" : t === "party" ? "Party" : "Combat"}
      </button>
    {/each}
  </div>
  <div class="messages" class:expanded={game.chatOpen}>
    {#each lines as line (line.at + line.from + line.text)}
      <div
        class="line"
        class:system={line.channel === "system"}
        class:party={line.channel === "party"}
        class:combat={line.channel === "combat"}
      >
        {#if line.channel === "party"}<span class="tag">[P]</span>{/if}
        {#if line.from && line.from !== "system"}<span class="from">{line.from}:</span>{/if}
        {line.text}
      </div>
    {/each}
  </div>
  {#if game.chatOpen}
    <input
      bind:this={inputEl}
      bind:value={text}
      maxlength={240}
      placeholder={tab === "party"
        ? "Party chat… (/invite Name, /leave)"
        : "Say something… (/invite Name, /p msg, /pvp)"}
      onkeydown={(e) => {
        if (e.key === "Enter") submit();
        else if (e.key === "Escape") close();
        e.stopPropagation();
      }}
    />
  {/if}
</div>

<style>
  .chat {
    position: absolute;
    left: 18px;
    bottom: 24px;
    width: 360px;
    pointer-events: none;
    font-size: 13px;
  }
  .tabs {
    display: none;
    gap: 4px;
    margin-bottom: 4px;
  }
  .tabs.visible {
    display: flex;
    pointer-events: auto;
  }
  .tab {
    font-family: var(--rc-display);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    padding: 4px 12px;
    border-radius: 4px 4px 0 0;
    border: 1px solid var(--rc-gold-dim);
    border-bottom: none;
    background: rgba(14, 12, 9, 0.75);
    color: var(--rc-ink-dim);
    cursor: pointer;
  }
  .tab.active {
    color: var(--rc-gold-bright);
    background: rgba(30, 26, 18, 0.95);
  }
  .messages {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 6px;
  }
  .line {
    color: #e6eef8;
    text-shadow: 0 1px 3px #000;
    background: rgba(8, 10, 16, 0.35);
    border-radius: 4px;
    padding: 2px 8px;
    width: fit-content;
    max-width: 100%;
    word-wrap: break-word;
  }
  .messages.expanded .line {
    background: rgba(8, 10, 16, 0.7);
  }
  .line.system {
    color: #ffd66e;
    font-style: italic;
  }
  .line.party .tag,
  .line.party .from {
    color: #7eb8ff;
  }
  .line.combat {
    color: #d8b6a4;
    font-size: 12px;
  }
  .from {
    color: #8fc1ff;
    font-weight: 600;
    margin-right: 4px;
  }
  .tag {
    font-weight: 700;
    margin-right: 4px;
  }
  input {
    pointer-events: auto;
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid var(--rc-gold-dim);
    background: rgba(10, 14, 20, 0.92);
    color: var(--rc-ink);
    font-size: 13px;
  }
</style>
