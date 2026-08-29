<script lang="ts">
  import { onMount } from "svelte";
  import { getGame } from "../game/instance";

  let { reward }: { reward: { id: string; name: string; description?: string; xp: number } } = $props();

  function close(): void {
    getGame()?.closeDiscoveryModal();
  }

  // Gamepad cancel/confirm -- same "listen for rc:menuNav" convention
  // QuestDialog.svelte uses; there's nothing to navigate here, just close.
  onMount(() => {
    const onNav = (e: Event) => {
      const d = (e as CustomEvent<{ confirm: boolean; cancel: boolean }>).detail;
      if (d.cancel || d.confirm) close();
    };
    window.addEventListener("rc:menuNav", onNav);
    return () => window.removeEventListener("rc:menuNav", onNav);
  });
</script>

<div class="backdrop" onclick={close} role="presentation">
  <div class="modal rc-frame" onclick={(e) => e.stopPropagation()} role="presentation">
    <div class="banner">
      <div class="banner-glow"></div>
      <button class="rc-close close" onclick={close} aria-label="Close">✕</button>
      <div class="glyph">🧭</div>
      <div class="reached">Point of Interest Discovered</div>
      <div class="poi-title">{reward.name}</div>
    </div>
    <div class="rc-divider"></div>

    {#if reward.description}
      <div class="section">
        <div class="description">{reward.description}</div>
      </div>
    {/if}

    <div class="section">
      <div class="section-label">Experience Gained</div>
      <div class="xp-value">+{reward.xp} XP</div>
    </div>

    <button class="rc-btn primary continue-btn" onclick={close}>Continue Exploring</button>
  </div>
</div>

<style>
  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(8, 4, 14, 0.62);
    backdrop-filter: blur(3px);
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: auto;
    z-index: 20;
  }
  .modal {
    width: 360px;
    max-height: 82vh;
    overflow-y: auto;
    padding: 18px 20px 20px;
    box-shadow:
      0 0 40px rgba(80, 200, 220, 0.35),
      0 18px 50px rgba(0, 0, 0, 0.65);
  }
  .banner {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 8px 0 4px;
  }
  .close {
    position: absolute;
    top: 0;
    right: 0;
  }
  .banner-glow {
    position: absolute;
    top: -10px;
    left: 50%;
    transform: translateX(-50%);
    width: 200px;
    height: 160px;
    background: radial-gradient(circle, rgba(80, 200, 220, 0.45), transparent 70%);
    pointer-events: none;
  }
  .glyph {
    font-size: 40px;
    line-height: 1;
    position: relative;
  }
  .reached {
    position: relative;
    font-family: var(--rc-display);
    font-size: 11px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--rc-ink-dim);
  }
  .poi-title {
    position: relative;
    font-family: var(--rc-display);
    font-size: 24px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--rc-ink);
    text-shadow: 0 0 18px rgba(80, 200, 220, 0.7);
    text-align: center;
  }
  .section {
    margin-top: 14px;
  }
  .section-label {
    font-family: var(--rc-display);
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--rc-gold-dim);
    margin-bottom: 6px;
  }
  .description {
    font-size: 13px;
    line-height: 1.5;
    color: rgba(232, 240, 250, 0.85);
  }
  .xp-value {
    font-family: var(--rc-display);
    font-size: 18px;
    font-weight: 700;
    color: #9aef9a;
  }
  .continue-btn {
    width: 100%;
    margin-top: 18px;
  }
</style>
