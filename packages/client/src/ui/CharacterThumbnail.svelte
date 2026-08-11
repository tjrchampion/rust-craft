<script lang="ts">
  import type {
    ClassId,
    CharacterGender,
    CharacterAppearance,
  } from "@rustcraft/shared";
  import { requestCharacterThumbnail, type ThumbnailMode } from "../render/thumbnailRenderer";

  let {
    classId = "warrior",
    gender = "male",
    appearance,
    equip = null,
    mode = "head",
  }: {
    classId: ClassId;
    gender?: CharacterGender;
    appearance?: CharacterAppearance;
    equip?: Partial<Record<string, string>> | null;
    mode?: ThumbnailMode;
  } = $props();

  let src = $state<string | null>(null);
  let failed = $state(false);

  // Re-request whenever the identity/appearance/gear inputs change. A single
  // shared renderer (thumbnailRenderer.ts) serialises the work and caches by
  // key, so many thumbnails mounting at once no longer each spawn a WebGL
  // context + perpetual render loop — the whole reason the screen lagged.
  $effect(() => {
    const targetGender = gender ?? appearance?.gender ?? "male";
    const app: CharacterAppearance = appearance ?? {
      gender: targetGender,
      hairStyle: "none",
      facialHair: "none",
      hairColor: 0x2b1a12,
      eyeColor: 0x6b4423,
      outfitHue: 0xffffff,
    };
    let alive = true;
    failed = false;
    // Don't clear `src` here: the roster passes inline object literals whose
    // identity changes on every parent re-render, so the effect re-runs often.
    // The renderer caches by content key, so a re-run is a no-op resolve —
    // keeping the last image avoids a loader flicker on those churn re-runs.
    void requestCharacterThumbnail({ classId, gender: targetGender, appearance: app, equip, mode })
      .then((url) => {
        if (alive) src = url;
      })
      .catch(() => {
        if (alive) failed = true;
      });
    return () => {
      alive = false;
    };
  });
</script>

<div class="thumb">
  {#if src}
    <img class="thumb-img" {src} alt="" />
  {:else if failed}
    <div class="thumb-fallback">?</div>
  {:else}
    <div class="thumb-loader" aria-label="Loading">
      <span class="spinner"></span>
    </div>
  {/if}
</div>

<style>
  .thumb {
    width: 100%;
    height: 100%;
    display: block;
    position: relative;
  }
  .thumb-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
    border-radius: 6px;
  }
  .thumb-loader,
  .thumb-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.18);
  }
  .thumb-fallback {
    color: rgba(255, 255, 255, 0.35);
    font-size: 1.1rem;
    font-weight: 700;
  }
  .spinner {
    width: 40%;
    max-width: 22px;
    aspect-ratio: 1;
    border-radius: 50%;
    border: 2px solid rgba(255, 255, 255, 0.18);
    border-top-color: var(--accent, var(--rc-gold, #e8c06a));
    animation: thumb-spin 0.8s linear infinite;
  }
  @keyframes thumb-spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
