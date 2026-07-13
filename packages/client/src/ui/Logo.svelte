<script lang="ts">
  let { size = 1 }: { size?: number } = $props();
</script>

<!-- Rust-Craft wordmark: oxidized iron meets arcane ember -->
<div class="logo" style="transform: scale({size}); transform-origin: center top;">
  <svg viewBox="0 0 120 120" width="92" height="92" aria-hidden="true">
    <defs>
      <linearGradient id="lg-shield" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#4c4437" />
        <stop offset="1" stop-color="#1f1b13" />
      </linearGradient>
      <linearGradient id="lg-axe" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#e8dcbf" />
        <stop offset="1" stop-color="#9c8f6e" />
      </linearGradient>
      <radialGradient id="lg-ember" cx="0.5" cy="0.45" r="0.6">
        <stop offset="0" stop-color="#ffd66e" />
        <stop offset="0.55" stop-color="#ff8c2e" />
        <stop offset="1" stop-color="#b83a1f" />
      </radialGradient>
    </defs>
    <!-- shield -->
    <path
      d="M60 6 L106 20 L106 62 Q106 96 60 114 Q14 96 14 62 L14 20 Z"
      fill="url(#lg-shield)"
      stroke="#c9a24b"
      stroke-width="4"
    />
    <path
      d="M60 14 L98 26 L98 61 Q98 90 60 105 Q22 90 22 61 L22 26 Z"
      fill="none"
      stroke="#8a6f33"
      stroke-width="1.5"
    />
    <!-- firebolt ember -->
    <circle cx="60" cy="52" r="17" fill="url(#lg-ember)" />
    <path d="M60 24 L66 42 L54 42 Z" fill="#ff8c2e" />
    <!-- crossed axe + pick silhouettes -->
    <g stroke="url(#lg-axe)" stroke-width="6" stroke-linecap="round">
      <path d="M38 86 L74 44" />
      <path d="M82 86 L46 44" />
    </g>
    <path d="M70 38 q10 -6 16 2 q-2 8 -12 10 Z" fill="url(#lg-axe)" />
    <path d="M50 38 q-10 -6 -16 2 q2 8 12 10 Z" fill="url(#lg-axe)" />
  </svg>
  <div class="wordmark">
    <span class="rust">RUST</span><span class="craft">CRAFT</span>
  </div>
  <div class="tagline">SURVIVE&nbsp;·&nbsp;CRAFT&nbsp;·&nbsp;CAST</div>
</div>

<style>
  .logo {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    user-select: none;
  }
  .wordmark {
    font-family: var(--rc-display);
    font-weight: 900;
    font-size: 44px;
    letter-spacing: 4px;
    line-height: 1;
    text-shadow:
      0 2px 0 rgba(0, 0, 0, 0.9),
      0 6px 24px rgba(0, 0, 0, 0.7);
  }
  .rust {
    background: linear-gradient(180deg, #ff9a52, #b8511f 60%, #7a3212);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .craft {
    background: linear-gradient(180deg, #f5ecd2, #c9a24b 65%, #8a6f33);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .tagline {
    font-family: var(--rc-display);
    font-weight: 700;
    font-size: 11px;
    letter-spacing: 6px;
    color: var(--rc-ink-dim);
    margin-top: 6px;
  }
</style>
