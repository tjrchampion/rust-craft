<script lang="ts">
  import { game } from "../gameState.svelte";
  import { getGame } from "../../game/instance";
  import { sound } from "../../game/sound";
  import { music } from "../../game/music";
  import { wikiMarkdown } from "../wikiContent";
  import {
    GRAPHICS_PRESET_IDS,
    GRAPHICS_PRESET_LABELS,
    type ShadowMapSize,
    type GraphicsPresetId,
  } from "@rustcraft/shared";

  interface WikiLine {
    type: "h1" | "h2" | "h3" | "p" | "li" | "hr";
    text: string;
  }

  function parseWiki(md: string): WikiLine[] {
    const lines = md.split("\n");
    const parsed: WikiLine[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed === "---") {
        parsed.push({ type: "hr", text: "" });
      } else if (trimmed.startsWith("### ")) {
        parsed.push({ type: "h3", text: trimmed.slice(4) });
      } else if (trimmed.startsWith("## ")) {
        parsed.push({ type: "h2", text: trimmed.slice(3) });
      } else if (trimmed.startsWith("# ")) {
        parsed.push({ type: "h1", text: trimmed.slice(2) });
      } else if (trimmed.startsWith("- ")) {
        parsed.push({ type: "li", text: trimmed.slice(2) });
      } else {
        parsed.push({ type: "p", text: trimmed });
      }
    }
    return parsed;
  }

  let {
    systemTabSub = $bindable("game"),
    systemSubFocus = $bindable("sidebar"),
    systemSubTabIdx = $bindable(0),
    systemCursor = $bindable(0),
    isFullscreen,
    toggleFullscreen,
    exitToCharacterSelect,
    graphicsScrollContainer = $bindable(),
    wikiScrollContainer = $bindable(),
  }: {
    systemTabSub?: "game" | "graphics" | "wiki";
    systemSubFocus?: "sidebar" | "content";
    systemSubTabIdx?: number;
    systemCursor?: number;
    isFullscreen: boolean;
    toggleFullscreen: () => void;
    exitToCharacterSelect: () => void;
    graphicsScrollContainer?: HTMLDivElement | null;
    wikiScrollContainer?: HTMLDivElement | null;
  } = $props();

  let _wikiParsedCache: WikiLine[] | null = null;
  const wikiParsed = $derived.by(() => {
    if (!_wikiParsedCache) _wikiParsedCache = parseWiki(wikiMarkdown);
    return _wikiParsedCache;
  });

  function formatBoldText(text: string): string {
    return text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  }

  function streamRingMeters(ring: number): number {
    const ringMetres: Record<number, number> = { 2: 120, 3: 200, 4: 320, 5: 500 };
    return ringMetres[ring] ?? 200;
  }
</script>

<div class="system-menu-container">
  <!-- Sidebar sub-navigation -->
  <div class="system-sidebar">
    <button
      class="sub-tab-btn"
      class:active={systemTabSub === "game"}
      class:cursor={systemSubFocus === "sidebar" && systemSubTabIdx === 0}
      onclick={() => {
        systemSubTabIdx = 0;
        systemSubFocus = "sidebar";
        systemTabSub = "game";
      }}
    >
      Settings
    </button>
    <button
      class="sub-tab-btn"
      class:active={systemTabSub === "graphics"}
      class:cursor={systemSubFocus === "sidebar" && systemSubTabIdx === 1}
      onclick={() => {
        systemSubTabIdx = 1;
        systemSubFocus = "sidebar";
        systemTabSub = "graphics";
      }}
    >
      Graphics
    </button>
    <button
      class="sub-tab-btn"
      class:active={systemTabSub === "wiki"}
      class:cursor={systemSubFocus === "sidebar" && systemSubTabIdx === 2}
      onclick={() => {
        systemSubTabIdx = 2;
        systemSubFocus = "sidebar";
        systemTabSub = "wiki";
      }}
    >
      Wiki Guide
    </button>
  </div>

  <!-- Content display area -->
  <div class="system-content-panel">
    {#if systemTabSub === "game"}
      <div class="col system-col settings-col">
        <h3>Settings</h3>

        <div class="settings-section">
          <div class="settings-section-title">Gameplay</div>
          <label class="setting-toggle">
            <input
              type="checkbox"
              checked={game.autoLoot}
              onchange={(e) => game.setAutoLoot(e.currentTarget.checked)}
            />
            <span class="setting-label">Auto Loot Corpses</span>
          </label>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Audio</div>
          <label class="setting-slider">
            <span class="setting-label">
              Sound Effects
              <span class="setting-value">{Math.round(game.sfxVolume * 100)}%</span>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.round(game.sfxVolume * 100)}
              oninput={(e) => {
                const v = Number(e.currentTarget.value) / 100;
                game.setSfxVolume(v);
                sound.setVolume(v);
              }}
            />
          </label>
          <label class="setting-slider">
            <span class="setting-label">
              Music
              <span class="setting-value">{Math.round(game.musicVolume * 100)}%</span>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.round(game.musicVolume * 100)}
              oninput={(e) => {
                const v = Number(e.currentTarget.value) / 100;
                game.setMusicVolume(v);
                music.setVolume(v);
              }}
            />
          </label>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Display</div>
          <label class="setting-toggle">
            <input
              type="checkbox"
              checked={game.showPlayerNameplates}
              onchange={(e) => {
                game.setShowPlayerNameplates(e.currentTarget.checked);
                getGame()?.syncNameplateVisibility();
              }}
            />
            <span class="setting-label">Player Nameplates</span>
          </label>
          <label class="setting-toggle">
            <input
              type="checkbox"
              checked={game.showMobNameplates}
              onchange={(e) => {
                game.setShowMobNameplates(e.currentTarget.checked);
                getGame()?.syncNameplateVisibility();
              }}
            />
            <span class="setting-label">Mob Nameplates</span>
          </label>
          <button
            class="rc-btn"
            class:selected={systemSubFocus === "content" && systemCursor === 0}
            onclick={toggleFullscreen}
          >
            {isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          </button>
        </div>

        <div class="settings-section">
          <button
            class="rc-btn ghost"
            class:selected={systemSubFocus === "content" && systemCursor === 1}
            onclick={exitToCharacterSelect}
          >
            Exit to Character Select
          </button>
        </div>
      </div>
    {:else if systemTabSub === "graphics"}
      <div class="col system-col settings-col graphics-col" bind:this={graphicsScrollContainer}>
        <h3>Graphics</h3>
        <p class="settings-hint">
          Saved to your account. Resolution &amp; draw distance apply immediately;
          antialiasing applies the next time you enter the world.
        </p>

        <div class="settings-section">
          <div class="settings-section-title">Quality Preset</div>
          <div class="preset-row">
            {#each GRAPHICS_PRESET_IDS as id (id)}
              <button
                type="button"
                class="rc-btn preset-btn"
                class:selected={game.graphics.preset === id}
                onclick={() => game.setGraphicsPreset(id as GraphicsPresetId)}
              >
                {GRAPHICS_PRESET_LABELS[id]}
              </button>
            {/each}
          </div>
          {#if game.graphics.preset === "custom"}
            <div class="settings-note">Custom</div>
          {/if}
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Resolution</div>
          <label class="setting-slider">
            <span class="setting-label">
              Render Scale
              <span class="setting-value">{Math.round(game.graphics.resolutionScale * 100)}%</span>
            </span>
            <input
              type="range"
              min="50"
              max="150"
              step="5"
              value={Math.round(game.graphics.resolutionScale * 100)}
              oninput={(e) =>
                game.patchGraphics({ resolutionScale: Number(e.currentTarget.value) / 100 })}
            />
          </label>
          <label class="setting-slider">
            <span class="setting-label">
              Max Pixel Ratio
              <span class="setting-value">{game.graphics.maxPixelRatio.toFixed(2)}</span>
            </span>
            <input
              type="range"
              min="75"
              max="200"
              step="5"
              value={Math.round(game.graphics.maxPixelRatio * 100)}
              oninput={(e) =>
                game.patchGraphics({ maxPixelRatio: Number(e.currentTarget.value) / 100 })}
            />
          </label>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Effects</div>
          <label class="setting-toggle">
            <input
              type="checkbox"
              checked={game.graphics.antialias}
              onchange={(e) => game.patchGraphics({ antialias: e.currentTarget.checked })}
            />
            <span class="setting-label">Antialiasing</span>
          </label>
          <label class="setting-toggle">
            <input
              type="checkbox"
              checked={game.graphics.shadowsEnabled}
              onchange={(e) => game.patchGraphics({ shadowsEnabled: e.currentTarget.checked })}
            />
            <span class="setting-label">Shadows</span>
          </label>
          <label class="setting-slider" class:setting-disabled={!game.graphics.shadowsEnabled}>
            <span class="setting-label">
              Shadow Map
              <span class="setting-value">{game.graphics.shadowMapSize}px</span>
            </span>
            <input
              type="range"
              min="0"
              max="2"
              step="1"
              disabled={!game.graphics.shadowsEnabled}
              value={[512, 1024, 2048].indexOf(game.graphics.shadowMapSize)}
              oninput={(e) => {
                const sizes: ShadowMapSize[] = [512, 1024, 2048];
                const size = sizes[Number(e.currentTarget.value)] ?? 1024;
                game.patchGraphics({ shadowMapSize: size });
              }}
            />
          </label>
        </div>

        <div class="settings-section">
          <div class="settings-section-title">Draw Distance</div>
          <label class="setting-slider">
            <span class="setting-label">
              World Stream
              <span class="setting-value">~{streamRingMeters(game.graphics.streamRing)} m</span>
            </span>
            <input
              type="range"
              min="2"
              max="5"
              step="1"
              value={game.graphics.streamRing}
              oninput={(e) => game.patchGraphics({ streamRing: Number(e.currentTarget.value) })}
            />
          </label>
          <label class="setting-slider">
            <span class="setting-label">
              Grass Distance
              <span class="setting-value">{Math.round(game.graphics.grassDrawDistance)} m</span>
            </span>
            <input
              type="range"
              min="40"
              max="160"
              step="5"
              value={game.graphics.grassDrawDistance}
              oninput={(e) =>
                game.patchGraphics({ grassDrawDistance: Number(e.currentTarget.value) })}
            />
          </label>
          <label class="setting-slider">
            <span class="setting-label">
              Fog Density
              <span class="setting-value">{Math.round(game.graphics.fogScale * 100)}%</span>
            </span>
            <input
              type="range"
              min="50"
              max="150"
              step="5"
              value={Math.round(game.graphics.fogScale * 100)}
              oninput={(e) => game.patchGraphics({ fogScale: Number(e.currentTarget.value) / 100 })}
            />
          </label>
        </div>
      </div>
    {:else if systemTabSub === "wiki"}
      <div class="wiki-panel">
        <h3>Game Wiki Guide</h3>
        <div class="wiki-scrollable" bind:this={wikiScrollContainer}>
          {#each wikiParsed as item}
            {#if item.type === "h1"}
              <h1 class="wiki-h1">{item.text}</h1>
            {:else if item.type === "h2"}
              <h2 class="wiki-h2">{item.text}</h2>
            {:else if item.type === "h3"}
              <h3 class="wiki-h3">{item.text}</h3>
            {:else if item.type === "li"}
              <li class="wiki-li">{@html formatBoldText(item.text)}</li>
            {:else if item.type === "p"}
              <p class="wiki-p">{@html formatBoldText(item.text)}</p>
            {:else if item.type === "hr"}
              <hr class="wiki-hr" />
            {/if}
          {/each}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .system-menu-container {
    display: flex;
    gap: 20px;
    flex: 1;
    min-height: 0;
    height: 100%;
    max-height: 100%;
    width: 100%;
    overflow: hidden;
  }
  .system-sidebar {
    width: 180px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    border-right: 1px solid rgba(255, 255, 255, 0.08);
    padding-right: 20px;
    flex-shrink: 0;
  }
  .sub-tab-btn {
    background: rgba(255, 255, 255, 0.03);
    border: 2px solid rgba(255, 255, 255, 0.08);
    color: var(--rc-ink-dim);
    padding: 10px 14px;
    border-radius: 6px;
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: all 0.2s;
  }
  .sub-tab-btn:hover {
    background: rgba(255, 255, 255, 0.07);
    color: var(--rc-parchment);
  }
  .sub-tab-btn.active {
    background: rgba(201, 162, 75, 0.08);
    border-color: var(--rc-gold-dim);
    color: var(--rc-gold-bright);
  }
  .sub-tab-btn.cursor {
    border-color: var(--rc-gold-bright);
    box-shadow: 0 0 10px rgba(255, 214, 110, 0.25);
  }
  .system-content-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    max-height: 100%;
    width: 100%;
    min-width: 0;
    box-sizing: border-box;
    overflow-y: auto;
    padding-right: 6px;
  }
  .system-content-panel::-webkit-scrollbar,
  .graphics-col::-webkit-scrollbar,
  .wiki-scrollable::-webkit-scrollbar {
    width: 6px;
  }
  .system-content-panel::-webkit-scrollbar-track,
  .graphics-col::-webkit-scrollbar-track,
  .wiki-scrollable::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.4);
    border-radius: 3px;
  }
  .system-content-panel::-webkit-scrollbar-thumb,
  .graphics-col::-webkit-scrollbar-thumb,
  .wiki-scrollable::-webkit-scrollbar-thumb {
    background: var(--rc-gold-dim);
    border-radius: 3px;
  }
  .system-col {
    width: 100%;
    flex: 1;
    min-height: 0;
    gap: 10px;
    box-sizing: border-box;
  }
  .col {
    display: flex;
    flex-direction: column;
    min-height: 0;
    width: 100%;
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
  .settings-col {
    gap: 14px;
    width: 100%;
    overflow-y: auto;
  }
  .settings-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    box-sizing: border-box;
  }
  .settings-section-title {
    font-family: var(--rc-display);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--rc-gold-bright);
    opacity: 0.85;
  }
  .setting-toggle {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
    color: var(--rc-parchment);
    user-select: none;
    margin-bottom: 8px;
    width: 100%;
    box-sizing: border-box;
  }
  .setting-toggle input {
    cursor: pointer;
    accent-color: #d4af37;
    width: 16px;
    height: 16px;
  }
  .setting-slider {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 12px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    font-size: 13px;
    color: var(--rc-parchment);
    width: 100%;
    box-sizing: border-box;
  }
  .setting-slider .setting-label {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .setting-value {
    font-variant-numeric: tabular-nums;
    color: var(--rc-gold-bright);
    font-size: 12px;
  }
  .setting-slider input[type="range"] {
    width: 100%;
    accent-color: #d4af37;
    cursor: pointer;
  }
  .settings-hint {
    margin: 0 0 4px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--rc-ink-dim);
    opacity: 0.9;
  }
  .settings-note {
    font-size: 11px;
    color: var(--rc-gold-bright);
    opacity: 0.75;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .preset-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    width: 100%;
    box-sizing: border-box;
  }
  .preset-btn {
    flex: 1 1 auto;
    min-width: 64px;
    padding: 8px 10px;
    font-size: 12px;
  }
  .graphics-col {
    overflow-y: auto;
    min-height: 0;
    padding-right: 4px;
    width: 100%;
    box-sizing: border-box;
  }
  .setting-disabled {
    opacity: 0.45;
    pointer-events: none;
  }
  .wiki-panel {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    width: 100%;
    box-sizing: border-box;
  }
  .wiki-panel h3 {
    margin-bottom: 12px;
  }
  .wiki-scrollable {
    flex: 1;
    overflow-y: auto;
    background: rgba(0, 0, 0, 0.15);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 6px;
    padding: 15px;
    font-size: 12.5px;
    line-height: 1.6;
    color: #cbd5e1;
    width: 100%;
    box-sizing: border-box;
  }
  .wiki-h1 {
    font-family: var(--rc-display);
    font-size: 18px;
    color: var(--rc-gold-bright);
    margin-top: 0;
    margin-bottom: 12px;
    border-bottom: 1px dashed rgba(201, 162, 75, 0.2);
    padding-bottom: 6px;
  }
  .wiki-h2 {
    font-family: var(--rc-display);
    font-size: 15px;
    color: var(--rc-parchment);
    margin-top: 18px;
    margin-bottom: 8px;
  }
  .wiki-h3 {
    font-family: var(--rc-display);
    font-size: 13.5px;
    color: var(--rc-gold-dim);
    margin-top: 12px;
    margin-bottom: 6px;
  }
  .wiki-p {
    margin-top: 0;
    margin-bottom: 10px;
  }
  .wiki-p :global(strong), .wiki-li :global(strong) {
    color: var(--rc-parchment);
  }
  .wiki-li {
    margin-left: 15px;
    margin-bottom: 6px;
    list-style-type: square;
  }
  .wiki-hr {
    border: 0;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    margin: 15px 0;
  }
</style>
