<script lang="ts">
  import type { CharacterTab } from "./gameState.svelte";
  import { game } from "./gameState.svelte";
  import { getGame } from "../game/instance";
  import { promptLabel } from "./padGlyphs";

  type Shortcut =
    | { kind: "tab"; tab: CharacterTab; key: string; icon: string; title: string }
    | { kind: "map"; key: string; icon: string; title: string };

  const SHORTCUTS: Shortcut[] = [
    { kind: "tab", tab: "inventory", key: "I", icon: "bag", title: "Inventory" },
    { kind: "tab", tab: "quests", key: "L", icon: "scroll", title: "Quest Log" },
    { kind: "tab", tab: "achievements", key: "Y", icon: "trophy", title: "Achievements" },
    { kind: "tab", tab: "spellbook", key: "K", icon: "book", title: "Spell Book" },
    { kind: "tab", tab: "craft", key: "J", icon: "anvil", title: "Crafting" },
    { kind: "tab", tab: "party", key: "U", icon: "party", title: "Party" },
    { kind: "tab", tab: "system", key: "O", icon: "gear", title: "System" },
    { kind: "map", key: "M", icon: "map", title: "World Map" },
  ];

  function isActive(s: Shortcut): boolean {
    if (s.kind === "map") return game.worldMapOpen;
    return game.inventoryOpen && game.activeTab === s.tab;
  }

  function activate(s: Shortcut): void {
    if (game.self?.dead) return;
    const g = getGame();
    if (!g) return;
    if (s.kind === "map") {
      if (game.inventoryOpen || game.questOffer || game.chatOpen) return;
      g.setWorldMapOpen(!game.worldMapOpen);
      return;
    }
    g.toggleCharacterTab(s.tab);
  }

  function keyHint(s: Shortcut): string {
    if (s.kind === "tab" && s.tab === "system") {
      return promptLabel("Start", s.key);
    }
    if (s.kind === "tab" && s.tab === "inventory") {
      return promptLabel("View", s.key);
    }
    return s.key;
  }
</script>

{#if game.connected && !game.self?.dead && !game.loading}
  <div class="menu-shortcuts" role="toolbar" aria-label="Menu shortcuts">
    {#each SHORTCUTS as s (s.kind === "tab" ? s.tab : "map")}
      <button
        type="button"
        class="shortcut"
        class:active={isActive(s)}
        title="{s.title} ({keyHint(s)})"
        aria-label="{s.title} ({keyHint(s)})"
        aria-pressed={isActive(s)}
        onclick={() => activate(s)}
      >
        <span class="glyph" aria-hidden="true">
          {#if s.icon === "bag"}
            <svg viewBox="0 0 16 16" width="14" height="14">
              <path
                fill="currentColor"
                d="M2.5 4.5h11v9.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V4.5zm1.5-2h7.5l.75 2H3.25L4 2.5zM7 7h2v5H7V7z"
              />
            </svg>
          {:else if s.icon === "scroll"}
            <svg viewBox="0 0 16 16" width="14" height="14">
              <path
                fill="currentColor"
                d="M3.5 2.5h7.5a1.5 1.5 0 0 1 0 3H5v7.5a1.5 1.5 0 1 1-1.5-1.5V2.5zm8 3a2.5 2.5 0 0 0 0-5H3A1.5 1.5 0 0 0 1.5 2v9a2.5 2.5 0 1 0 5 0V7h5.5z"
              />
            </svg>
          {:else if s.icon === "trophy"}
            <svg viewBox="0 0 16 16" width="14" height="14">
              <path
                fill="currentColor"
                d="M4 1.5h8v1.5h1.5a1.5 1.5 0 0 1 1.5 1.5V6a3 3 0 0 1-2.5 2.95A3.5 3.5 0 0 1 9.5 11.5V13H11v1.5H5V13h1.5v-1.5a3.5 3.5 0 0 1-3-2.55A3 3 0 0 1 1 6V4.5A1.5 1.5 0 0 1 2.5 3H4V1.5zm0 3H2.5V6a1.5 1.5 0 0 0 1.5 1.5V4.5zm9.5 0H12v3A1.5 1.5 0 0 0 13.5 6V4.5z"
              />
            </svg>
          {:else if s.icon === "book"}
            <svg viewBox="0 0 16 16" width="14" height="14">
              <path
                fill="currentColor"
                d="M2 2.5A1.5 1.5 0 0 1 3.5 1H8v13H3.5A1.5 1.5 0 0 1 2 12.5v-10zm6-.5h4.5A1.5 1.5 0 0 1 14 3.5v9a1.5 1.5 0 0 1-1.5 1.5H8V2z"
              />
            </svg>
          {:else if s.icon === "anvil"}
            <svg viewBox="0 0 16 16" width="14" height="14">
              <path
                fill="currentColor"
                d="M3 3.5h7l1.5 2H14v2H2V5.5h1.5L3 3.5zM2.5 9h11v1.5H12L11 14H5l-1-3.5H2.5V9z"
              />
            </svg>
          {:else if s.icon === "party"}
            <svg viewBox="0 0 16 16" width="14" height="14">
              <path
                fill="currentColor"
                d="M5.5 3.5a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm9 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 5.5a2.25 2.25 0 1 1 0-4.5 2.25 2.25 0 0 1 0 4.5zM1 12.5c0-1.8 1.3-3 3.5-3s3.5 1.2 3.5 3V14H1v-1.5zm7 0c0-1.1.4-2 1.1-2.6.7.4 1.6.6 2.9.6 2.2 0 3.5 1.2 3.5 3V14H8v-1.5z"
              />
            </svg>
          {:else if s.icon === "gear"}
            <svg viewBox="0 0 16 16" width="14" height="14">
              <path
                fill="currentColor"
                d="M6.4 1.5h3.2l.4 1.6 1.5.9 1.7-.5 1.6 2.8-1.3 1.2v1.6l1.3 1.2-1.6 2.8-1.7-.5-1.5.9-.4 1.6H6.4l-.4-1.6-1.5-.9-1.7.5L1.2 10l1.3-1.2V7.2L1.2 6l1.6-2.8 1.7.5 1.5-.9.4-1.6zM8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z"
              />
            </svg>
          {:else}
            <svg viewBox="0 0 16 16" width="14" height="14">
              <path
                fill="currentColor"
                d="M2.5 2.5h11v11h-11v-11zm1.5 1.5v8h8v-8H4zm1.5 1.5h2v2h-2v-2zm3.5 3h2.5v3.5H9V8.5z"
              />
            </svg>
          {/if}
        </span>
        <span class="key">{keyHint(s)}</span>
      </button>
    {/each}
  </div>
{/if}

<style>
  .menu-shortcuts {
    position: absolute;
    bottom: 48px;
    right: 14px;
    display: flex;
    gap: 4px;
    pointer-events: auto;
    z-index: 5;
  }
  .shortcut {
    position: relative;
    width: 32px;
    height: 32px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--rc-gold);
    background:
      linear-gradient(180deg, rgba(80, 50, 110, 0.3), rgba(0, 0, 0, 0.45)),
      rgba(14, 10, 20, 0.88);
    border: 1px solid var(--rc-gold-dim);
    outline: 1px solid rgba(0, 0, 0, 0.75);
    border-radius: 3px;
    cursor: pointer;
    box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.55);
    transition:
      border-color 0.12s ease,
      color 0.12s ease,
      box-shadow 0.12s ease;
  }
  .shortcut:hover {
    color: var(--rc-gold-bright);
    border-color: var(--rc-gold);
  }
  .shortcut.active {
    color: var(--rc-gold-bright);
    border-color: var(--rc-magenta-bright);
    box-shadow:
      0 0 12px rgba(196, 77, 154, 0.45),
      inset 0 0 6px rgba(0, 0, 0, 0.55);
  }
  .glyph {
    display: flex;
    line-height: 0;
    opacity: 0.95;
  }
  .key {
    position: absolute;
    right: 1px;
    bottom: 0;
    font-size: 8px;
    font-weight: 700;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: rgba(232, 240, 250, 0.85);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.95);
    letter-spacing: 0.02em;
    line-height: 1;
    pointer-events: none;
  }
</style>
