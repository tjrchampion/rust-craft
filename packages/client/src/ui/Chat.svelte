<script lang="ts">
  import { game, textMentionsName } from "./gameState.svelte";
  import { getGame } from "../game/instance";
  import { promptLabel } from "./padGlyphs";

  type Tab = "realm" | "region" | "party" | "combat";
  type ChatSpeakChannel = "realm" | "region" | "party";

  const TABS: { id: Tab; label: string; glyph: string }[] = [
    { id: "realm", label: "Realm", glyph: "◈" },
    { id: "region", label: "Region", glyph: "◎" },
    { id: "party", label: "Party", glyph: "⚔" },
    { id: "combat", label: "Combat", glyph: "✧" },
  ];

  let text = $state("");
  let tab = $state<Tab>("region");
  let inputEl = $state<HTMLInputElement | null>(null);
  let messagesEl = $state<HTMLDivElement | null>(null);
  /** When true, new lines keep the log pinned to the bottom. */
  let stickToBottom = $state(true);
  /** Bumps opacity briefly when a new line arrives while unfocused. */
  let recentActivity = $state(false);
  /** Stronger flash when someone @mentions you. */
  let mentioned = $state(false);
  let lastSeenAt = 0;

  const enterHint = $derived(promptLabel("Ⓐ", "Enter"));
  const escHint = $derived(promptLabel("Ⓑ", "Esc"));
  const activeTab = $derived(TABS.find((t) => t.id === tab) ?? TABS[0]!);

  /** Names we can highlight as @mentions (self + online roster), longest first. */
  const mentionNames = $derived.by(() => {
    const names = new Set<string>();
    if (game.selfName) names.add(game.selfName);
    for (const p of game.roster) names.add(p.name);
    return [...names].sort((a, b) => b.length - a.length);
  });

  function channelLines(channel: ChatSpeakChannel) {
    return game.chatLog.filter((l) => {
      if (channel === "realm") return l.channel === "realm" || l.channel === "system";
      return l.channel === channel;
    });
  }

  const lines = $derived(
    tab === "combat"
      ? game.combatLog.slice(-12).map((l) => ({ from: "", text: l.text, channel: "combat" as const, at: l.at }))
      : channelLines(tab).slice(game.chatOpen ? -14 : -10),
  );

  function renderTextParts(raw: string): { kind: "text" | "mention"; value: string; self?: boolean }[] {
    if (!raw || mentionNames.length === 0) return [{ kind: "text", value: raw }];
    const parts: { kind: "text" | "mention"; value: string; self?: boolean }[] = [];
    let rest = raw;
    while (rest.length) {
      let best: { index: number; length: number } | null = null;
      for (const name of mentionNames) {
        const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
        const re = new RegExp(`(?:^|[\\s([{\"'“])(@${esc})(?=$|[\\s,.!?;:)\\]}'\"”])`, "i");
        const m = re.exec(rest);
        if (!m || m.index === undefined || m[1] === undefined) continue;
        const tokenStart = m.index + (m[0].startsWith("@") ? 0 : 1);
        if (best === null || tokenStart < best.index || (tokenStart === best.index && m[1].length > best.length)) {
          best = { index: tokenStart, length: m[1].length };
        }
      }
      if (!best) {
        parts.push({ kind: "text", value: rest });
        break;
      }
      if (best.index > 0) parts.push({ kind: "text", value: rest.slice(0, best.index) });
      const token = rest.slice(best.index, best.index + best.length);
      parts.push({
        kind: "mention",
        value: token,
        self: textMentionsName(token, game.selfName),
      });
      rest = rest.slice(best.index + best.length);
    }
    return parts;
  }

  $effect(() => {
    if (game.chatOpen && inputEl) inputEl.focus();
  });

  $effect(() => {
    const mention = game.chatMention;
    if (!mention) return;
    // Surface the channel passively — never open chat / steal focus / change UI mode.
    if (
      !game.chatOpen &&
      (mention.channel === "realm" || mention.channel === "region" || mention.channel === "party")
    ) {
      tab = mention.channel;
    }
    stickToBottom = true;
    mentioned = true;
    recentActivity = true;
    const clearFlash = setTimeout(() => {
      mentioned = false;
      recentActivity = false;
    }, 4500);
    const clearMention = setTimeout(() => {
      if (game.chatMention?.at === mention.at) game.chatMention = null;
    }, 4500);
    return () => {
      clearTimeout(clearFlash);
      clearTimeout(clearMention);
    };
  });

  $effect(() => {
    const latest = Math.max(
      game.chatLog.at(-1)?.at ?? 0,
      game.combatLog.at(-1)?.at ?? 0,
    );
    if (latest <= lastSeenAt) return;
    const first = lastSeenAt === 0;
    lastSeenAt = latest;
    if (first || game.chatOpen || mentioned) return;
    recentActivity = true;
    const t = setTimeout(() => (recentActivity = false), 3200);
    return () => clearTimeout(t);
  });

  $effect(() => {
    // Pin to bottom on new lines / tab / open — but only if the user hasn't scrolled up.
    void lines;
    void tab;
    void game.chatOpen;
    if (!stickToBottom) return;
    queueMicrotask(() => {
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  });

  function onMessagesScroll(): void {
    if (!messagesEl) return;
    const gap = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
    stickToBottom = gap < 28;
  }

  function onMessagesWheel(e: WheelEvent): void {
    // Keep the game input layer from eating the wheel while the log scrolls.
    e.stopPropagation();
  }

  function selectTab(id: Tab): void {
    open();
    tab = id;
    stickToBottom = true;
  }

  function open(): void {
    if (game.chatOpen || game.self?.dead) return;
    game.chatOpen = true;
    stickToBottom = true;
    getGame()?.setUiMode(true);
  }

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
      case "r":
      case "region":
        if (rest.length) g.sendChat(rest.join(" "), "region");
        return true;
      case "g":
      case "global":
      case "realm":
        if (rest.length) g.sendChat(rest.join(" "), "realm");
        return true;
      case "pvp":
        g.sendPvp(!game.pvpEnabled);
        return true;
      default:
        game.toast(`Unknown command: /${cmd}`);
        return true;
    }
  }

  function submitChannel(): "realm" | "region" | "party" | null {
    if (tab === "combat") return null;
    if (tab === "party" || tab === "region" || tab === "realm") return tab;
    return "region";
  }

  function submit(): void {
    const trimmed = text.trim();
    if (trimmed) {
      if (trimmed.startsWith("/")) runCommand(trimmed);
      else {
        const channel = submitChannel();
        if (channel) getGame()?.sendChat(trimmed, channel);
      }
    }
    text = "";
    close();
  }

  function close(): void {
    game.chatOpen = false;
    getGame()?.setUiMode(false);
  }
</script>

<div
  class="chat"
  class:focused={game.chatOpen}
  class:active={recentActivity && !game.chatOpen}
  class:mentioned={mentioned && !game.chatOpen}
  data-channel={tab}
>
  <div class="shell">
    <svg class="ornament tl" viewBox="0 0 28 28" aria-hidden="true">
      <path d="M2 26 V8 Q2 2 8 2 H26" fill="none" stroke="currentColor" stroke-width="1.5" />
      <circle cx="8" cy="8" r="1.6" fill="currentColor" />
    </svg>
    <svg class="ornament tr" viewBox="0 0 28 28" aria-hidden="true">
      <path d="M26 26 V8 Q26 2 20 2 H2" fill="none" stroke="currentColor" stroke-width="1.5" />
      <circle cx="20" cy="8" r="1.6" fill="currentColor" />
    </svg>
    <svg class="ornament bl" viewBox="0 0 28 28" aria-hidden="true">
      <path d="M2 2 V20 Q2 26 8 26 H26" fill="none" stroke="currentColor" stroke-width="1.5" />
      <circle cx="8" cy="20" r="1.6" fill="currentColor" />
    </svg>
    <svg class="ornament br" viewBox="0 0 28 28" aria-hidden="true">
      <path d="M26 2 V20 Q26 26 20 26 H2" fill="none" stroke="currentColor" stroke-width="1.5" />
      <circle cx="20" cy="20" r="1.6" fill="currentColor" />
    </svg>

    <header class="header">
      <div class="title-row">
        <span class="title-mark">❧</span>
        <h2 class="title">Chronicles</h2>
        <span class="title-rule"></span>
      </div>
      <nav class="tabs" aria-label="Chat channels">
        {#each TABS as t (t.id)}
          <button
            type="button"
            class="tab"
            class:active={tab === t.id}
            data-channel={t.id}
            tabindex={game.chatOpen ? 0 : -1}
            onclick={() => selectTab(t.id)}
          >
            <span class="tab-glyph">{t.glyph}</span>
            <span class="tab-label">{t.label}</span>
          </button>
        {/each}
      </nav>
    </header>

    <div
      class="messages"
      bind:this={messagesEl}
      onscroll={onMessagesScroll}
      onwheel={onMessagesWheel}
    >
      {#if lines.length === 0}
        <div class="empty">
          {tab === "combat"
            ? "No combat yet — steel waits."
            : tab === "party"
              ? "Party chat is quiet."
              : tab === "region"
                ? "No one nearby has spoken…"
                : "The realm listens…"}
        </div>
      {:else}
        {#each lines as line (line.at + line.from + line.text)}
          <div
            class="line"
            class:system={line.channel === "system"}
            class:party={line.channel === "party"}
            class:region={line.channel === "region"}
            class:combat={line.channel === "combat"}
            class:realm={line.channel === "realm"}
            class:ping={line.channel !== "combat" && textMentionsName(line.text, game.selfName)}
          >
            <span class="rail" aria-hidden="true"></span>
            <div class="body">
              {#if line.channel === "party"}
                <span class="badge party">P</span>
              {:else if line.channel === "region"}
                <span class="badge region">R</span>
              {:else if line.channel === "system"}
                <span class="badge system">✦</span>
              {:else if line.channel === "combat"}
                <span class="badge combat">⚔</span>
              {:else if line.channel === "realm"}
                <span class="badge realm">G</span>
              {/if}
              {#if line.from && line.from !== "system"}
                <span class="from">{line.from}</span>
              {/if}
              <span class="text">
                {#each renderTextParts(line.text) as part, i (`${i}-${part.value}`)}
                  {#if part.kind === "mention"}
                    <span class="mention" class:self={part.self}>{part.value}</span>
                  {:else}
                    {part.value}
                  {/if}
                {/each}
              </span>
            </div>
          </div>
        {/each}
      {/if}
    </div>

    {#if game.chatOpen}
      <div class="composer">
        <div class="composer-inner">
          <button
            type="button"
            class="channel-chip"
            data-channel={tab}
            title="Cycle channel"
            onclick={() => {
              const i = TABS.findIndex((t) => t.id === tab);
              tab = TABS[(i + 1) % TABS.length]!.id;
              stickToBottom = true;
              inputEl?.focus();
            }}
          >
            <span class="chip-glyph">{activeTab.glyph}</span>
            {activeTab.label}
          </button>
          <input
            bind:this={inputEl}
            bind:value={text}
            maxlength={240}
            placeholder={tab === "party"
              ? "Speak to your party…  /invite  /leave"
              : tab === "combat"
                ? "Combat log (read-only) — switch channel to speak"
                : tab === "region"
                  ? "Speak in this region…  @Name  /r  /g  /p"
                  : "Speak to the whole realm…  @Name  /g  /r  /p"}
            disabled={tab === "combat"}
            onkeydown={(e) => {
              if (e.key === "Enter") {
                if (tab === "combat") return;
                submit();
              } else if (e.key === "Escape") close();
              else if (e.key === "Tab") {
                e.preventDefault();
                const i = TABS.findIndex((t) => t.id === tab);
                const dir = e.shiftKey ? -1 : 1;
                tab = TABS[(i + dir + TABS.length) % TABS.length]!.id;
                stickToBottom = true;
              }
              e.stopPropagation();
            }}
          />
          <span class="composer-hint">{escHint}</span>
        </div>
      </div>
    {:else}
      <button type="button" class="idle-bar" onclick={open}>
        <span class="idle-key">{enterHint}</span>
        <span class="idle-copy">Open chronicles</span>
        <span class="idle-channel" data-channel={tab}>{activeTab.glyph} {activeTab.label}</span>
      </button>
    {/if}
  </div>
</div>

<style>
  .chat {
    --chat-w: 400px;
    position: absolute;
    left: 14px;
    bottom: 18px;
    width: var(--chat-w);
    font-family: var(--rc-body);
    pointer-events: none;
    opacity: 0.34;
    filter: saturate(0.85);
    transition:
      opacity 0.35s ease,
      filter 0.35s ease,
      transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
    transform: translateY(4px);
  }
  .chat.active {
    opacity: 0.82;
    filter: saturate(1);
    transform: translateY(0);
  }
  /* Mention ping: brighter log only — no frame, toast, sound, or hit-target. */
  .chat.mentioned {
    opacity: 0.92;
    filter: none;
    transform: translateY(0);
  }
  .chat.mentioned,
  .chat.mentioned * {
    pointer-events: none !important;
  }
  .chat.focused {
    opacity: 1;
    filter: none;
    transform: translateY(0);
  }
  .chat.focused .shell {
    pointer-events: auto;
  }

  .shell {
    position: relative;
    padding: 10px 10px 8px;
    border-radius: 10px;
    border: 1px solid transparent;
    background: transparent;
    box-shadow: none;
    transition:
      background 0.28s ease,
      border-color 0.28s ease,
      box-shadow 0.28s ease,
      padding 0.28s ease;
  }
  .chat.focused .shell {
    padding: 12px 12px 10px;
    background:
      radial-gradient(ellipse at 20% 0%, rgba(201, 162, 75, 0.06), transparent 55%),
      linear-gradient(165deg, rgba(28, 24, 16, 0.72), rgba(10, 9, 7, 0.64));
    border-color: rgba(138, 111, 51, 0.6);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    box-shadow:
      inset 0 0 0 1px rgba(255, 224, 150, 0.06),
      inset 0 1px 0 rgba(255, 240, 200, 0.04),
      0 14px 36px rgba(0, 0, 0, 0.35),
      0 0 0 1px rgba(0, 0, 0, 0.4);
  }

  .ornament {
    position: absolute;
    width: 22px;
    height: 22px;
    color: var(--rc-gold);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
  }
  .chat.focused .ornament {
    opacity: 0.7;
  }
  .ornament.tl {
    top: 4px;
    left: 4px;
  }
  .ornament.tr {
    top: 4px;
    right: 4px;
  }
  .ornament.bl {
    bottom: 4px;
    left: 4px;
  }
  .ornament.br {
    bottom: 4px;
    right: 4px;
  }

  .header {
    opacity: 0.45;
    transition: opacity 0.25s ease;
    margin-bottom: 4px;
  }
  .chat.focused .header {
    opacity: 1;
    pointer-events: auto;
  }
  .title-row {
    display: none;
    align-items: center;
    gap: 8px;
    margin: 0 8px 6px;
  }
  .chat.focused .title-row {
    display: flex;
  }
  .title-mark {
    color: var(--rc-gold);
    font-size: 14px;
    line-height: 1;
  }
  .title {
    margin: 0;
    font-family: var(--rc-display);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 2.5px;
    text-transform: uppercase;
    color: var(--rc-gold);
  }
  .title-rule {
    flex: 1;
    height: 1px;
    background: linear-gradient(90deg, rgba(201, 162, 75, 0.55), transparent 90%);
  }

  .tabs {
    display: flex;
    gap: 4px;
    padding: 0 4px;
  }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border-radius: 999px;
    border: 1px solid rgba(138, 111, 51, 0.28);
    background: rgba(8, 7, 5, 0.35);
    color: var(--rc-ink-dim);
    font-family: var(--rc-display);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    transition:
      color 0.15s ease,
      border-color 0.15s ease,
      background 0.15s ease,
      box-shadow 0.15s ease,
      transform 0.15s ease;
  }
  .chat:not(.focused) .tab .tab-label {
    display: none;
  }
  .chat:not(.focused) .tab {
    padding: 4px 7px;
  }
  .tab:hover {
    color: var(--rc-parchment);
    border-color: rgba(201, 162, 75, 0.55);
  }
  .tab.active {
    color: var(--rc-gold-bright);
    border-color: var(--rc-gold-dim);
    background: linear-gradient(180deg, rgba(70, 54, 28, 0.85), rgba(30, 24, 14, 0.9));
    box-shadow:
      inset 0 1px 0 rgba(255, 224, 150, 0.18),
      0 0 12px rgba(201, 162, 75, 0.12);
  }
  .tab[data-channel="party"].active {
    color: #b7d6ff;
    border-color: rgba(110, 160, 220, 0.55);
    background: linear-gradient(180deg, rgba(40, 55, 80, 0.85), rgba(18, 24, 36, 0.9));
    box-shadow:
      inset 0 1px 0 rgba(160, 200, 255, 0.15),
      0 0 12px rgba(100, 150, 220, 0.12);
  }
  .tab[data-channel="region"].active {
    color: #b6e0a8;
    border-color: rgba(110, 160, 90, 0.55);
    background: linear-gradient(180deg, rgba(40, 55, 32, 0.85), rgba(16, 24, 14, 0.9));
    box-shadow:
      inset 0 1px 0 rgba(180, 220, 150, 0.15),
      0 0 12px rgba(110, 160, 90, 0.12);
  }
  .tab[data-channel="combat"].active {
    color: #e0b39a;
    border-color: rgba(180, 110, 80, 0.55);
    background: linear-gradient(180deg, rgba(70, 40, 30, 0.85), rgba(28, 16, 12, 0.9));
  }
  .tab-glyph {
    font-size: 11px;
    line-height: 1;
    opacity: 0.9;
  }

  .messages {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 72px;
    max-height: 110px;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 2px 6px 6px;
    mask-image: linear-gradient(180deg, transparent 0%, #000 14%, #000 100%);
    -webkit-mask-image: linear-gradient(180deg, transparent 0%, #000 14%, #000 100%);
    scrollbar-width: thin;
    scrollbar-color: rgba(201, 162, 75, 0.35) transparent;
  }
  .chat.focused .messages {
    max-height: 140px;
    mask-image: none;
    -webkit-mask-image: none;
    padding: 2px 4px 6px;
    overscroll-behavior: contain;
  }
  .messages::-webkit-scrollbar {
    width: 4px;
  }
  .messages::-webkit-scrollbar-thumb {
    background: rgba(201, 162, 75, 0.35);
    border-radius: 4px;
  }

  .empty {
    margin: auto 0 2px;
    padding: 6px 8px;
    font-family: var(--rc-display);
    font-size: 11px;
    letter-spacing: 0.8px;
    font-style: italic;
    color: rgba(169, 159, 134, 0.55);
    text-align: center;
  }

  .line {
    position: relative;
    display: flex;
    gap: 6px;
    align-items: stretch;
    animation: line-in 0.32s cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  @keyframes line-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .rail {
    flex-shrink: 0;
    width: 2px;
    border-radius: 2px;
    margin: 2px 0;
    background: rgba(201, 162, 75, 0.4);
    box-shadow: 0 0 6px rgba(201, 162, 75, 0.12);
  }
  .line.realm .rail {
    background: rgba(201, 162, 75, 0.65);
    box-shadow: 0 0 6px rgba(201, 162, 75, 0.2);
  }
  .line.region .rail {
    background: #7eb86a;
    box-shadow: 0 0 8px rgba(126, 184, 106, 0.3);
  }
  .line.party .rail {
    background: #6ea8ff;
    box-shadow: 0 0 8px rgba(110, 168, 255, 0.35);
  }
  .line.system .rail {
    background: var(--rc-gold);
    box-shadow: 0 0 8px rgba(201, 162, 75, 0.4);
  }
  .line.combat .rail {
    background: #c8896a;
    box-shadow: 0 0 6px rgba(200, 137, 106, 0.25);
  }

  .body {
    min-width: 0;
    flex: 1;
    padding: 0;
    line-height: 1.35;
  }
  .chat.focused .body {
    padding: 2px 7px 2px 8px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.14);
    border: 1px solid rgba(255, 255, 255, 0.03);
  }
  .chat.focused .line.system .body {
    background: rgba(201, 162, 75, 0.06);
    border-color: rgba(201, 162, 75, 0.1);
  }
  .chat.focused .line.party .body {
    background: rgba(80, 120, 180, 0.08);
    border-color: rgba(110, 168, 255, 0.1);
  }
  .chat.focused .line.region .body {
    background: rgba(90, 130, 70, 0.08);
    border-color: rgba(126, 184, 106, 0.12);
  }

  .badge {
    display: inline;
    font-family: var(--rc-display);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.4px;
    margin-right: 4px;
    vertical-align: baseline;
  }
  .badge.party {
    color: #7eb8ff;
  }
  .badge.region {
    color: #8fca7a;
  }
  .badge.realm {
    color: var(--rc-gold);
  }
  .badge.system {
    color: var(--rc-gold);
    font-style: normal;
  }
  .badge.combat {
    color: #c8896a;
  }
  .from {
    display: inline;
    font-family: var(--rc-display);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.3px;
    color: #b6d4ff;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
  }
  .from::after {
    content: ":";
    margin-right: 5px;
    color: rgba(182, 212, 255, 0.55);
  }
  .text {
    display: inline;
    margin: 0;
    color: #efe8d6;
    font-size: 12.5px;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
    word-break: break-word;
  }
  .line.system .text {
    color: var(--rc-gold-bright);
    font-style: italic;
  }
  .line.combat .text {
    color: #d8b6a4;
    font-size: 12px;
  }
  .line.ping .body {
    background: transparent !important;
    border-color: transparent !important;
  }
  .chat.focused .line.ping .body {
    background: rgba(255, 214, 110, 0.08) !important;
    border-color: rgba(255, 214, 110, 0.18) !important;
  }
  .mention {
    color: #9ec6ff;
    font-weight: 700;
  }
  .mention.self {
    color: var(--rc-gold-bright);
    text-shadow: 0 0 8px rgba(255, 214, 110, 0.35);
  }
  .chat:not(.focused) .badge {
    display: none;
  }
  .chat:not(.focused) .from {
    color: #9ec6ff;
  }

  .composer {
    pointer-events: auto;
    margin-top: 2px;
    padding: 0 2px 2px;
  }
  .composer-inner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px 5px 5px;
    border-radius: 8px;
    border: 1px solid rgba(201, 162, 75, 0.35);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.03), transparent 40%),
      rgba(5, 4, 3, 0.55);
    box-shadow:
      inset 0 1px 0 rgba(255, 224, 150, 0.06),
      0 0 0 1px rgba(0, 0, 0, 0.3);
  }
  .channel-chip {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--rc-display);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    padding: 6px 9px;
    border-radius: 6px;
    color: var(--rc-gold-bright);
    background: linear-gradient(180deg, #4a3a22, #2a2114);
    border: 1px solid var(--rc-gold-dim);
    transition: transform 0.12s ease;
  }
  .channel-chip:hover {
    transform: translateY(-1px);
  }
  .channel-chip[data-channel="party"] {
    color: #b7d6ff;
    border-color: rgba(110, 160, 220, 0.55);
    background: linear-gradient(180deg, #2a3a52, #161e2c);
  }
  .channel-chip[data-channel="region"] {
    color: #b6e0a8;
    border-color: rgba(110, 160, 90, 0.55);
    background: linear-gradient(180deg, #2a3a22, #161e12);
  }
  .channel-chip[data-channel="combat"] {
    color: #e0b39a;
    border-color: rgba(180, 110, 80, 0.55);
    background: linear-gradient(180deg, #4a2e22, #241610);
  }
  .chip-glyph {
    font-size: 11px;
  }
  .composer input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    color: var(--rc-ink);
    font-size: 13px;
    font-family: var(--rc-body);
    padding: 6px 2px;
    outline: none;
  }
  .composer input::placeholder {
    color: rgba(169, 159, 134, 0.48);
  }
  .composer input:disabled {
    opacity: 0.55;
  }
  .composer-hint {
    flex-shrink: 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 9px;
    font-weight: 700;
    color: rgba(169, 159, 134, 0.55);
    border: 1px solid rgba(138, 111, 51, 0.35);
    border-radius: 3px;
    padding: 2px 5px;
  }

  .idle-bar {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    margin-top: 2px;
    box-sizing: border-box;
    padding: 7px 10px;
    border-radius: 8px;
    border: 1px solid rgba(138, 111, 51, 0.28);
    background: linear-gradient(180deg, rgba(20, 17, 12, 0.45), rgba(8, 7, 5, 0.4));
    color: rgba(233, 226, 208, 0.48);
    font-family: var(--rc-body);
    font-size: 12px;
    text-align: left;
    transition:
      color 0.18s ease,
      border-color 0.18s ease,
      background 0.18s ease,
      box-shadow 0.18s ease;
  }
  .idle-bar:hover {
    color: var(--rc-parchment);
    border-color: rgba(201, 162, 75, 0.55);
    background: linear-gradient(180deg, rgba(30, 24, 16, 0.7), rgba(12, 10, 8, 0.65));
    box-shadow: 0 0 16px rgba(201, 162, 75, 0.08);
  }
  .idle-key {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 10px;
    font-weight: 700;
    color: var(--rc-gold-bright);
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(201, 162, 75, 0.45);
    border-radius: 4px;
    padding: 2px 6px;
    line-height: 1.25;
  }
  .idle-copy {
    flex: 1;
    font-family: var(--rc-display);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 1.4px;
    text-transform: uppercase;
  }
  .idle-channel {
    font-family: var(--rc-display);
    font-size: 9px;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: rgba(201, 162, 75, 0.7);
  }
  .idle-channel[data-channel="party"] {
    color: rgba(150, 190, 240, 0.75);
  }
  .idle-channel[data-channel="region"] {
    color: rgba(150, 200, 130, 0.75);
  }
  .idle-channel[data-channel="combat"] {
    color: rgba(210, 160, 130, 0.75);
  }
</style>
