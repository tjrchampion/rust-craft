<script lang="ts">
  import { isIconImage } from "./icons";
  import { getItemThumbnail, itemHas3DThumbnail } from "./thumbnailGenerator";

  let { value, size = 22, itemId }: { value: string; size?: number; itemId?: string } = $props();

  let thumbnailDataUrl = $state("");
  let loading = $state(false);

  const has3DModel = $derived(!!(itemId && itemHas3DThumbnail(itemId)));

  $effect(() => {
    const id = itemId;
    if (!id || !itemHas3DThumbnail(id)) {
      thumbnailDataUrl = "";
      loading = false;
      return;
    }
    let cancelled = false;
    loading = true;
    getItemThumbnail(id, Math.max(64, size * 2)).then((url) => {
      if (cancelled) return;
      thumbnailDataUrl = url;
      loading = false;
    });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if itemId && has3DModel && thumbnailDataUrl}
  <img src={thumbnailDataUrl} alt="" class="icon-glyph icon-3d" style="width: {size}px; height: {size}px;" />
{:else if isIconImage(value)}
  <img src={value} alt="" class="icon-glyph" style="width: {size}px; height: {size}px;" />
{:else if itemId && has3DModel && loading}
  <span class="icon-glyph-emoji icon-loading" style="font-size: {size * 0.7}px;">◇</span>
{:else}
  <span class="icon-glyph-emoji" style="font-size: {size}px;">{value}</span>
{/if}

<style>
  .icon-glyph {
    object-fit: contain;
    display: block;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
  }
  .icon-glyph-emoji {
    line-height: 1;
  }
  .icon-glyph-emoji.icon-loading {
    opacity: 0.45;
    color: #c9a24b;
  }
  .icon-glyph.icon-3d {
    filter: drop-shadow(0 2px 4px rgba(255, 215, 0, 0.2)) drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8));
    transform: scale(1.08);
  }
</style>
