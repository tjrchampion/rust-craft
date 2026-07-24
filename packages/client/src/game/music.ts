/**
 * Background-music playback for regions -- real looped mp3s (unlike the
 * synthesized ambience in sound.ts), crossfaded on region enter/exit/switch.
 */

const TARGET_VOLUME = 0.55;

class MusicManager {
  private current: HTMLAudioElement | null = null;
  private currentUrl: string | null = null;
  private fadeToken = 0;

  /** No-op if `url` is already what's playing (or already silent). */
  play(url: string | null, fadeMs = 3000): void {
    if (url === this.currentUrl) return;
    this.currentUrl = url;
    this.fadeToken++;

    const prev = this.current;
    this.current = null;
    if (prev) this.fadeOutAndStop(prev, fadeMs);

    if (!url) return;

    const audio = new Audio(url);
    audio.loop = true;
    audio.volume = 0;
    audio.play().catch(() => {
      // Autoplay can be blocked before any user gesture -- harmless; the
      // caller only ever invokes this from within an already-unlocked page.
    });
    this.current = audio;
    this.fadeTo(audio, TARGET_VOLUME, fadeMs, this.fadeToken);
  }

  stop(): void {
    this.play(null, 800);
  }

  private fadeTo(audio: HTMLAudioElement, target: number, ms: number, token: number): void {
    const start = performance.now();
    const startVol = audio.volume;
    const step = (t: number) => {
      if (token !== this.fadeToken) return;
      const p = Math.min(1, (t - start) / ms);
      audio.volume = startVol + (target - startVol) * p;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** Fades out and tears down a specific (already-replaced) audio element --
   *  runs to completion independent of any newer track's own fade-in, since
   *  each call owns a distinct HTMLAudioElement instance. */
  private fadeOutAndStop(audio: HTMLAudioElement, ms: number): void {
    const start = performance.now();
    const startVol = audio.volume;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      audio.volume = startVol * (1 - p);
      if (p < 1) {
        requestAnimationFrame(step);
        return;
      }
      audio.pause();
      audio.src = "";
    };
    requestAnimationFrame(step);
  }
}

export const music = new MusicManager();
