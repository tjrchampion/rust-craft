<script lang="ts">
  let { size = 1 }: { size?: number } = $props();
</script>

<div class="logo" style="transform: scale({size}); transform-origin: center top;">
  <img src="/assets/ui/logo_eldor.png" alt="Shadows of Eldor" class="logo-img" />
</div>

<style>
  .logo {
    display: flex;
    flex-direction: column;
    align-items: center;
    user-select: none;
  }
  .logo-img {
    max-width: 320px;
    height: auto;
    filter: drop-shadow(0 4px 16px rgba(0, 0, 0, 0.8)) drop-shadow(0 0 20px rgba(212, 175, 55, 0.4));
  }
</style>
