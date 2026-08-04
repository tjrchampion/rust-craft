<script lang="ts">
  import { onMount } from "svelte";

  let x = $state(-100);
  let y = $state(-100);
  let visible = $state(true);
  let state = $state<"default" | "pointer" | "grab">("default");
  let isDown = $state(false);

  onMount(() => {
    // Hide default OS cursor globally across all elements
    const style = document.createElement("style");
    style.id = "custom-game-cursor-style";
    style.textContent = `
      *, *::before, *::after, body, html, button, input, select, textarea, a, canvas {
        cursor: none !important;
      }
    `;
    document.head.appendChild(style);

    const onMove = (e: MouseEvent) => {
      x = e.clientX;
      y = e.clientY;

      // Check if mouse is locked (e.g. right-click camera drag)
      if (document.pointerLockElement) {
        visible = false;
        return;
      }
      visible = true;

      // Detect interactive UI element under pointer
      const target = e.target as HTMLElement | null;
      if (target) {
        const isInteractive =
          target.tagName === "BUTTON" ||
          target.tagName === "A" ||
          target.tagName === "INPUT" ||
          target.tagName === "SELECT" ||
          target.closest("button, a, [role='button'], .slot, .strip-item, .rc-btn, .linkish, .swatch, .chip, .item-card");
        if (isInteractive) {
          state = isDown ? "grab" : "pointer";
        } else {
          state = isDown ? "grab" : "default";
        }
      }
    };

    const onDown = (e: MouseEvent) => {
      if (e.button === 0) {
        isDown = true;
      }
    };

    const onUp = (e: MouseEvent) => {
      if (e.button === 0) {
        isDown = false;
      }
    };

    const onLockChange = () => {
      visible = !document.pointerLockElement;
    };

    const preventContextMenu = (e: Event) => {
      e.preventDefault();
      return false;
    };
    document.oncontextmenu = preventContextMenu;
    window.oncontextmenu = preventContextMenu;
    document.onauxclick = preventContextMenu;
    window.onauxclick = preventContextMenu;

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mousedown", onDown, { passive: true });
    window.addEventListener("mouseup", onUp, { passive: true });
    window.addEventListener("contextmenu", preventContextMenu);
    window.addEventListener("auxclick", preventContextMenu);
    document.addEventListener("pointerlockchange", onLockChange);

    return () => {
      style.remove();
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("contextmenu", preventContextMenu);
      window.removeEventListener("auxclick", preventContextMenu);
      document.removeEventListener("pointerlockchange", onLockChange);
    };
  });
</script>

{#if visible && x >= 0 && y >= 0}
  <div
    class="game-cursor-container"
    style="transform: translate3d({x}px, {y}px, 0);"
  >
    {#if state === "pointer"}
      <!-- Interactive Golden Gauntlet Pointer with Gem Aura -->
      <svg class="cursor-svg" width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fff4b8" />
            <stop offset="40%" stop-color="#ffd043" />
            <stop offset="85%" stop-color="#c88c14" />
            <stop offset="100%" stop-color="#7a4e00" />
          </linearGradient>
          <radialGradient id="gemGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#ff6699" />
            <stop offset="100%" stop-color="#cc0044" />
          </radialGradient>
          <filter id="cursorShadow" x="-20%" y="-20%" width="150%" height="150%">
            <feDropShadow dx="2" dy="3" stdDeviation="2" flood-color="#000" flood-opacity="0.8" />
            <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#ffd700" flood-opacity="0.6" />
          </filter>
        </defs>

        <g filter="url(#cursorShadow)">
          <!-- Outer Dark Contour -->
          <path
            d="M 2 2 L 14 14 L 9 16 L 15 28 L 11 30 L 5 18 L 1 22 Z"
            fill="#0a0515"
            stroke="#0a0515"
            stroke-width="3"
            stroke-linejoin="round"
          />
          <!-- Gold Metallic Pointer Blade/Gauntlet -->
          <path
            d="M 2 2 L 14 14 L 9 16 L 15 28 L 11 30 L 5 18 L 1 22 Z"
            fill="url(#goldGrad)"
            stroke="#fff"
            stroke-width="0.8"
            stroke-linejoin="round"
          />
          <!-- Glowing Ruby Gem Hilt -->
          <circle cx="6" cy="6" r="2.5" fill="url(#gemGlow)" stroke="#fff" stroke-width="0.5" />
        </g>
      </svg>
    {:else if state === "grab"}
      <!-- Grab / Clicked Gauntlet -->
      <svg class="cursor-svg grabbing" width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="goldGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffe895" />
            <stop offset="50%" stop-color="#e0a020" />
            <stop offset="100%" stop-color="#603800" />
          </linearGradient>
          <filter id="grabShadow" x="-20%" y="-20%" width="150%" height="150%">
            <feDropShadow dx="1" dy="2" stdDeviation="1.5" flood-color="#000" flood-opacity="0.85" />
          </filter>
        </defs>

        <g filter="url(#grabShadow)" transform="scale(0.92) translate(1, 1)">
          <path
            d="M 2 4 L 13 13 L 9 15 L 14 26 L 10 28 L 5 17 L 1 20 Z"
            fill="#0a0515"
            stroke="#0a0515"
            stroke-width="3"
            stroke-linejoin="round"
          />
          <path
            d="M 2 4 L 13 13 L 9 15 L 14 26 L 10 28 L 5 17 L 1 20 Z"
            fill="url(#goldGrad2)"
            stroke="#ffd700"
            stroke-width="0.8"
            stroke-linejoin="round"
          />
          <circle cx="6" cy="7" r="2" fill="#ff3366" stroke="#fff" stroke-width="0.5" />
        </g>
      </svg>
    {:else}
      <!-- Default Fantasy MMO Gauntlet Pointer -->
      <svg class="cursor-svg" width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="goldGradDefault" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fff8d0" />
            <stop offset="35%" stop-color="#ecc040" />
            <stop offset="80%" stop-color="#b0780f" />
            <stop offset="100%" stop-color="#603c00" />
          </linearGradient>
          <radialGradient id="gemRuby" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#ff4488" />
            <stop offset="100%" stop-color="#990033" />
          </radialGradient>
          <filter id="defaultShadow" x="-20%" y="-20%" width="150%" height="150%">
            <feDropShadow dx="2" dy="3" stdDeviation="2" flood-color="#000" flood-opacity="0.85" />
          </filter>
        </defs>

        <g filter="url(#defaultShadow)">
          <!-- Dark outline -->
          <path
            d="M 1 1 L 13 13 L 8 15 L 14 27 L 10 29 L 4 17 L 1 20 Z"
            fill="#080410"
            stroke="#080410"
            stroke-width="3"
            stroke-linejoin="round"
          />
          <!-- Golden Body -->
          <path
            d="M 1 1 L 13 13 L 8 15 L 14 27 L 10 29 L 4 17 L 1 20 Z"
            fill="url(#goldGradDefault)"
            stroke="#ffe699"
            stroke-width="0.8"
            stroke-linejoin="round"
          />
          <!-- Inlaid Gem -->
          <circle cx="5" cy="5" r="2.2" fill="url(#gemRuby)" stroke="#fff" stroke-width="0.4" />
        </g>
      </svg>
    {/if}
  </div>
{/if}

<style>
  .game-cursor-container {
    position: fixed;
    top: 0;
    left: 0;
    width: 34px;
    height: 34px;
    pointer-events: none;
    z-index: 999999;
    will-change: transform;
    transition: transform 0.02s linear;
  }
  .cursor-svg {
    display: block;
    width: 34px;
    height: 34px;
    filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.7));
  }
  .grabbing {
    transform: scale(0.94);
  }
</style>
