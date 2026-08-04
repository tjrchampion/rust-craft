<script lang="ts">
  import { onMount } from "svelte";

  let {
    src = "/assets/video/login_bg.mp4",
    poster = "/assets/ui/bg_combat_1.jpg",
  }: {
    src?: string;
    poster?: string;
  } = $props();

  let videoError = $state(false);
  let currentSlideIndex = $state(0);

  const slides = ["/assets/ui/bg_combat_1.jpg", "/assets/ui/bg_combat_2.jpg", "/assets/ui/loading_bg.jpg"];

  onMount(() => {
    const interval = setInterval(() => {
      currentSlideIndex = (currentSlideIndex + 1) % slides.length;
    }, 8000);
    return () => clearInterval(interval);
  });
</script>

<div class="video-bg-container">
  {#if !videoError}
    <video
      autoplay
      loop
      muted
      playsinline
      poster={poster}
      class="bg-video"
      onerror={() => (videoError = true)}
    >
      <source src={src} type="video/mp4" />
    </video>
  {/if}

  {#if videoError}
    <div class="slideshow">
      {#each slides as slideImg, i (slideImg)}
        <div
          class="slide"
          class:active={i === currentSlideIndex}
          style="background-image: url('{slideImg}');"
        ></div>
      {/each}
    </div>
  {/if}

  <!-- Dark cinematic vignette and ambient gold ember lighting overlay -->
  <div class="vignette"></div>
  <div class="amber-glow"></div>
  <div class="spell-flash"></div>
</div>

<style>
  .video-bg-container {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    z-index: 0;
    pointer-events: none;
    background: #080605;
  }
  .bg-video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center;
    filter: brightness(0.82) contrast(1.08) saturate(1.1);
    transition: opacity 0.5s ease;
  }
  .slideshow {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .slide {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    background-size: cover;
    background-position: center;
    opacity: 0;
    transform: scale(1);
    transition: opacity 1.8s ease-in-out, transform 9s ease-out;
    filter: brightness(0.8) contrast(1.1);
  }
  .slide.active {
    opacity: 1;
    transform: scale(1.06) translate(-6px, -4px);
  }
  .vignette {
    position: absolute;
    inset: 0;
    background:
      radial-gradient(ellipse at center 40%, transparent 20%, rgba(6, 4, 3, 0.6) 75%, rgba(4, 2, 1, 0.9) 100%),
      linear-gradient(180deg, rgba(8, 6, 4, 0.35) 0%, transparent 40%, rgba(6, 4, 3, 0.55) 100%);
  }
  .amber-glow {
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 50% 40%, rgba(212, 175, 55, 0.12) 0%, transparent 60%);
    mix-blend-mode: color-dodge;
  }
  .spell-flash {
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at 75% 30%, rgba(138, 43, 226, 0.08) 0%, transparent 50%);
    animation: flashPulse 4s ease-in-out infinite alternate;
  }
  @keyframes flashPulse {
    from {
      opacity: 0.3;
    }
    to {
      opacity: 0.8;
    }
  }
</style>
