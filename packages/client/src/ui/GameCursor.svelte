<script lang="ts">
  import { onMount } from "svelte";
  import { game as ui } from "./gameState.svelte";

  let visible = $state(true);
  let cursorState = $state<"default" | "pointer" | "grab">("default");
  let isDown = $state(false);

  let containerEl: HTMLDivElement | null = null;

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

    // Position source depends on capture state:
    //  - locked (in-game capture): the virtual cursor (ui.cursorX/Y), advanced
    //    by movement deltas since clientX/Y freeze while locked.
    //  - unlocked (character select, menus, pre-game, panels): the real cursor,
    //    tracked here directly -- InputManager may not exist yet (e.g. on the
    //    login/character screens), so we can't rely on it publishing cursorX/Y.
    let realX = -100;
    let realY = -100;
    const onMove = (e: PointerEvent) => {
      realX = e.clientX;
      realY = e.clientY;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    let raf = 0;
    let lastCheckTime = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const locked = document.pointerLockElement !== null;
      const x = locked ? ui.cursorX : realX;
      const y = locked ? ui.cursorY : realY;
      if (containerEl) containerEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;

      // Hidden only while turning the camera (right-drag); otherwise shown,
      // whether the pointer is captured (virtual cursor) or free (panel).
      const wantVisible = !ui.isRightClickDragging;
      if (visible !== wantVisible) visible = wantVisible;

      const now = performance.now();
      if (now - lastCheckTime > 32) {
        lastCheckTime = now;
        const el = document.elementFromPoint(x, y) as HTMLElement | null;
        const isInteractive =
          !!el &&
          (el.tagName === "BUTTON" ||
            el.tagName === "A" ||
            el.tagName === "INPUT" ||
            el.tagName === "SELECT" ||
            el.closest("button, a, [role='button'], .slot, .strip-item, .rc-btn, .linkish, .swatch, .chip, .item-card") !== null);
        const nextState = isInteractive ? (isDown ? "grab" : "pointer") : isDown ? "grab" : "default";
        if (cursorState !== nextState) cursorState = nextState;
      }
    };
    raf = requestAnimationFrame(tick);

    // pointerdown/up fire in both locked and unlocked modes (unlike the mouse
    // events, which are frozen/retargeted while locked), so use them for the
    // click/grab visual.
    const onDown = (e: PointerEvent) => {
      if (e.button === 0) isDown = true;
    };
    const onUp = (e: PointerEvent) => {
      if (e.button === 0) isDown = false;
    };
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      style.remove();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
    };
  });
</script>

{#if visible}
  <div
    bind:this={containerEl}
    class="game-cursor-container"
  >
    {#if cursorState === "pointer"}
      <!-- Interactive Golden Gauntlet Pointer -->
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
        </defs>

        <g>
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
    {:else if cursorState === "grab"}
      <!-- Grab / Clicked Gauntlet -->
      <svg class="cursor-svg grabbing" width="34" height="34" viewBox="0 0 34 34" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="goldGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffe895" />
            <stop offset="50%" stop-color="#e0a020" />
            <stop offset="100%" stop-color="#603800" />
          </linearGradient>
        </defs>

        <g transform="scale(0.92) translate(1, 1)">
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
        </defs>

        <g>
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
    /* Removed transition: transform 0.02s linear to eliminate 20ms motion delay */
  }
  .cursor-svg {
    display: block;
    width: 34px;
    height: 34px;
    filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.75));
  }
  .grabbing {
    transform: scale(0.94);
  }
</style>
