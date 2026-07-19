<script lang="ts">
  import { isIconImage } from "./icons";
  import { getWeaponThumbnail } from "./thumbnailGenerator";
  import { itemDef } from "@rustcraft/shared";

  let { value, size = 22, itemId }: { value: string; size?: number; itemId?: string } = $props();

  let thumbnailDataUrl = $state("");

  // Determine if it is a weapon/shield with 3D model prop
  const def = $derived(itemId ? itemDef(itemId) : null);
  const has3DModel = $derived(!!(def && def.weaponProp));

  $effect(() => {
    if (itemId && has3DModel) {
      getWeaponThumbnail(itemId, size * 2).then((url) => {
        thumbnailDataUrl = url;
      });
    }
  });
</script>

{#if itemId && has3DModel && thumbnailDataUrl}
  <img src={thumbnailDataUrl} alt="" class="icon-glyph icon-3d" style="width: {size}px; height: {size}px;" />
{:else if isIconImage(value)}
  <img src={value} alt="" class="icon-glyph" style="width: {size}px; height: {size}px;" />
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
  .icon-glyph.icon-3d {
    filter: drop-shadow(0 2px 4px rgba(255, 215, 0, 0.2)) drop-shadow(0 1px 2px rgba(0, 0, 0, 0.8));
    transform: scale(1.1); /* slightly larger for premium highlight */
  }
</style>
