<script lang="ts">
  import { onMount } from "svelte";
  import type { RegionAssetCategory } from "@rustcraft/shared";
  import { getRegionAssetThumbnail, regionAssetThumbnailCached } from "./assetThumbnail";

  interface Props {
    category: RegionAssetCategory;
    model: string;
    size?: number;
  }

  let { category, model, size = 72 }: Props = $props();

  let url = $state("");
  let failed = $state(false);
  let rootEl: HTMLDivElement | null = $state(null);
  let visible = $state(false);

  onMount(() => {
    const el = rootEl;
    if (!el || typeof IntersectionObserver === "undefined") {
      visible = true;
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        visible = true;
        io.disconnect();
      },
      { rootMargin: "120px" },
    );
    io.observe(el);
    return () => io.disconnect();
  });

  $effect(() => {
    if (!visible) return;
    const cat = category;
    const mod = model;
    const cached = regionAssetThumbnailCached(cat, mod);
    if (cached) {
      url = cached;
      failed = false;
      return;
    }
    url = "";
    failed = false;
    let cancelled = false;
    void getRegionAssetThumbnail(cat, mod).then((next) => {
      if (cancelled) return;
      if (next) url = next;
      else failed = true;
    });
    return () => {
      cancelled = true;
    };
  });
</script>

<div class="thumb" style="width: {size}px; height: {size}px;" bind:this={rootEl}>
  {#if url}
    <img src={url} alt="" draggable="false" />
  {:else if failed}
    <span class="fallback">?</span>
  {:else}
    <span class="loading"></span>
  {/if}
</div>

<style>
  .thumb {
    display: grid;
    place-items: center;
    background: radial-gradient(circle at 40% 30%, #2a3344 0%, #151922 70%);
    border-radius: 6px;
    overflow: hidden;
    flex-shrink: 0;
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
  }
  .fallback {
    color: #6b7a90;
    font-size: 18px;
    font-weight: 700;
  }
  .loading {
    width: 18px;
    height: 18px;
    border: 2px solid #3a4558;
    border-top-color: #7dd3fc;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
