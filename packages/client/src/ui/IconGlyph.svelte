<script lang="ts">
  import { isIconImage } from "./icons";

  let { value, size = 22 }: { value: string; size?: number } = $props();
</script>

{#if isIconImage(value)}
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
</style>
