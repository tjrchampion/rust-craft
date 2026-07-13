/**
 * WebAudio-synthesized sound effects — zero asset downloads, tiny footprint.
 * Every sound is generated from oscillators and noise buffers at runtime.
 */

type SfxName =
  | "chop"
  | "mine"
  | "pick"
  | "craft"
  | "hitFlesh"
  | "hitTaken"
  | "castStart"
  | "spellHit"
  | "levelup"
  | "death"
  | "eat"
  | "ui"
  | "target";

class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private enabled = true;
  private ambientGain: GainNode | null = null;

  /** Call from a user gesture to unlock audio (browsers require this). */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // Pre-bake a white-noise buffer for percussive/impact sounds.
    const len = this.ctx.sampleRate * 1;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.startAmbient();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.5 : 0;
  }

  setVolume(v: number): void {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v));
  }

  private now(): number {
    return this.ctx!.currentTime;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    when = 0,
    freqEnd?: number,
  ): void {
    if (!this.ctx || !this.master) return;
    const t = this.now() + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, gain: number, filterFreq: number, when = 0, type: BiquadFilterType = "bandpass"): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    const t = this.now() + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    filter.Q.value = 1.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private startAmbient(): void {
    if (!this.ctx || !this.master || !this.noiseBuffer) return;
    // Soft wind: looped noise through a slow-wandering low-pass.
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 480;
    const g = this.ctx.createGain();
    g.gain.value = 0.035;
    this.ambientGain = g;
    src.connect(filter).connect(g).connect(this.master);
    src.start();
    // Gently modulate the cutoff with an LFO for a breathing wind feel.
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.08;
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
  }

  play(name: SfxName): void {
    if (!this.ctx || !this.enabled) return;
    switch (name) {
      case "chop":
        this.noise(0.12, 0.5, 900, 0, "bandpass");
        this.tone(150, 0.14, "sine", 0.25, 0, 80);
        break;
      case "mine":
        this.noise(0.09, 0.4, 2600, 0, "bandpass");
        this.tone(320, 0.1, "square", 0.12, 0, 180);
        break;
      case "pick":
        this.tone(680, 0.1, "sine", 0.2, 0, 420);
        break;
      case "craft":
        this.tone(440, 0.08, "triangle", 0.2);
        this.tone(660, 0.1, "triangle", 0.18, 0.08);
        break;
      case "hitFlesh":
        this.noise(0.1, 0.4, 500, 0, "lowpass");
        this.tone(120, 0.12, "sine", 0.2, 0, 70);
        break;
      case "hitTaken":
        this.noise(0.16, 0.5, 300, 0, "lowpass");
        this.tone(90, 0.18, "sawtooth", 0.22, 0, 50);
        break;
      case "castStart":
        this.tone(300, 0.5, "sine", 0.16, 0, 720);
        break;
      case "spellHit":
        this.noise(0.3, 0.5, 800, 0, "lowpass");
        this.tone(200, 0.3, "sawtooth", 0.2, 0, 60);
        break;
      case "levelup":
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, "triangle", 0.22, i * 0.09));
        break;
      case "death":
        this.tone(300, 0.9, "sawtooth", 0.25, 0, 60);
        break;
      case "eat":
        this.noise(0.14, 0.25, 600, 0, "bandpass");
        break;
      case "ui":
        this.tone(900, 0.05, "square", 0.1);
        break;
      case "target":
        this.tone(1200, 0.05, "sine", 0.12);
        this.tone(1600, 0.05, "sine", 0.1, 0.04);
        break;
    }
  }
}

export const sound = new SoundManager();
