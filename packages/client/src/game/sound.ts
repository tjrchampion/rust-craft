/**
 * Game SFX player — loads banks from the editable catalog in `sfxMap.ts`.
 * Synth fallbacks only when a mapped file hasn't loaded yet.
 */

import { biomeAt, distToRiver, RIVER_HALF_WIDTH, terrainHeight, terrainSlope, WATER_LEVEL, spellDef } from "@rustcraft/shared";
import {
  SFX_MAP,
  BIOME_FOOT_SURFACE,
  resolveSfxBank,
  allSfxUrls,
  type FootSurface,
  type SfxMapKey,
} from "./sfxMap";

/** Stable cue names used by Game / entities (map to SFX_MAP keys). */
export type SfxName =
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
  | "mobDeath"
  | "mobAttack"
  | "swing"
  | "bowShot"
  | "loot"
  | "lootDrop"
  | "footstep"
  | "eat"
  | "ui"
  | "target"
  | "equip"
  | "dodge"
  | "block";

const CUE_TO_MAP: Record<Exclude<SfxName, "footstep" | "castStart" | "spellHit" | "bowShot">, SfxMapKey> = {
  chop: "chop",
  mine: "mine",
  pick: "pick",
  craft: "craft",
  hitFlesh: "hit_flesh",
  hitTaken: "hit_taken",
  levelup: "levelup",
  death: "death",
  mobDeath: "mob_death",
  mobAttack: "mob_attack",
  swing: "swing",
  loot: "loot",
  lootDrop: "loot_drop",
  eat: "eat",
  ui: "ui",
  target: "target",
  equip: "equip",
  dodge: "dodge",
  block: "block",
};

export type { FootSurface };

export interface FootSurfaceContext {
  x: number;
  y: number;
  z: number;
  /** True inside a region instance. */
  inRegion?: boolean;
  /** True inside a dungeon portal instance. */
  inDungeon?: boolean;
  /** Region water depth at (x,z); >0 means standing in painted water. */
  regionWaterDepth?: number;
}

/**
 * Pick a footstep surface from the ground under the player.
 * Priority: standing water → steep rock → biome (or stone in dungeons).
 */
export function resolveFootSurface(ctx: FootSurfaceContext): FootSurface {
  const ground = terrainHeight(ctx.x, ctx.z);

  // Open-world / shallow ford: feet near water line while ground is submerged.
  if (!ctx.inRegion) {
    if (ctx.y < WATER_LEVEL + 0.45 && ground < WATER_LEVEL - 0.05) return "water";
    if (distToRiver(ctx.x, ctx.z) < RIVER_HALF_WIDTH + 1.2 && ground <= WATER_LEVEL + 0.35) {
      return "water";
    }
  } else if ((ctx.regionWaterDepth ?? 0) > 0.15) {
    return "water";
  }

  if (ctx.inDungeon) return "stone";

  // Steep slopes read as rock even in grassy biomes.
  if (!ctx.inRegion && terrainSlope(ctx.x, ctx.z) > 0.85) return "stone";

  if (ctx.inRegion) return "dirt";

  const biome = biomeAt(ctx.x, ctx.z);
  return BIOME_FOOT_SURFACE[biome] ?? "dirt";
}

/** @deprecated Prefer resolveFootSurface — kept for any old imports. */
export function footSurfaceForBiome(biome: string | null | undefined): FootSurface {
  if (!biome) return "dirt";
  return BIOME_FOOT_SURFACE[biome] ?? "dirt";
}

/** Resolve a spell id to a school key used by spell_* map entries. */
export function spellSfxSchool(spellId: string | null | undefined): string {
  if (!spellId) return "buff";
  try {
    const effects = spellDef(spellId).effects;
    const dmg = effects.find((e) => e.type === "damage");
    if (dmg && "damageType" in dmg && dmg.damageType) return dmg.damageType;
    if (effects.some((e) => e.type === "heal")) return "heal";
    return "buff";
  } catch {
    return "buff";
  }
}

export interface PlayOpts {
  surface?: FootSurface;
  volume?: number;
  playbackRate?: number;
  spellId?: string;
  ranged?: boolean;
  /** Player class — picks CLASS_SFX overrides when present. */
  classId?: string | null;
}

class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private enabled = true;
  private userVolume = 0.55;
  private buffers = new Map<string, AudioBuffer>();
  private lastFootIdx = 0;

  init(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? this.userVolume : 0;
    this.master.connect(this.ctx.destination);

    const len = this.ctx.sampleRate * 1;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.startAmbient();
    void this.preloadAll();
  }

  private async preloadAll(): Promise<void> {
    if (!this.ctx) return;
    await Promise.all(allSfxUrls().map((url) => this.loadUrl(url)));
  }

  private async loadUrl(url: string): Promise<void> {
    if (!this.ctx || this.buffers.has(url)) return;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const raw = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(raw.slice(0));
      this.buffers.set(url, buf);
    } catch {
      /* synth fallback */
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? this.userVolume : 0;
  }

  setVolume(v: number): void {
    this.userVolume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.enabled ? this.userVolume : 0;
  }

  getVolume(): number {
    return this.userVolume;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private now(): number {
    return this.ctx!.currentTime;
  }

  private playBuffer(buf: AudioBuffer, volume = 1, playbackRate = 1): void {
    if (!this.ctx || !this.master) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = playbackRate;
    const g = this.ctx.createGain();
    g.gain.value = volume;
    src.connect(g).connect(this.master);
    src.start();
  }

  private pickLoaded(urls: readonly string[]): AudioBuffer | null {
    const ready = urls.map((u) => this.buffers.get(u)).filter((b): b is AudioBuffer => !!b);
    if (ready.length === 0) return null;
    return ready[Math.floor(Math.random() * ready.length)]!;
  }

  private tryPlayKey(key: SfxMapKey, volume: number, rate = 1, classId?: string | null): boolean {
    const urls = resolveSfxBank(key, classId);
    if (!urls.length) return true; // explicitly silent
    const buf = this.pickLoaded(urls);
    if (!buf) return false;
    this.playBuffer(buf, volume, rate);
    return true;
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
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 480;
    const g = this.ctx.createGain();
    g.gain.value = 0.025;
    src.connect(filter).connect(g).connect(this.master);
    src.start();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    lfo.frequency.value = 0.08;
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();
  }

  private playSynth(name: SfxName): void {
    switch (name) {
      case "footstep":
        this.noise(0.05, 0.18, 350, 0, "lowpass");
        break;
      case "swing":
      case "bowShot":
      case "mobAttack":
      case "hitFlesh":
      case "hitTaken":
      case "dodge":
      case "block":
        this.noise(0.1, 0.35, 500, 0, "lowpass");
        this.tone(180, 0.1, "sine", 0.15, 0, 90);
        break;
      case "castStart":
        this.tone(300, 0.4, "sine", 0.14, 0, 720);
        break;
      case "spellHit":
      case "levelup":
        this.tone(520, 0.2, "triangle", 0.18);
        break;
      default:
        this.tone(600, 0.08, "triangle", 0.12);
        break;
    }
  }

  play(name: SfxName, opts: PlayOpts = {}): void {
    if (!this.ctx || !this.enabled) return;
    if (this.ctx.state === "suspended") void this.ctx.resume();

    const vol = opts.volume ?? 1;
    const rate = opts.playbackRate ?? 1;
    const classId = opts.classId;

    if (name === "footstep") {
      const surface = opts.surface ?? "dirt";
      const key = `footstep_${surface}` as SfxMapKey;
      const urls = resolveSfxBank(key, classId);
      const fallback = urls.length ? urls : SFX_MAP.footstep_dirt;
      const ready = fallback.map((u) => this.buffers.get(u)).filter((b): b is AudioBuffer => !!b);
      if (ready.length > 0) {
        this.lastFootIdx = (this.lastFootIdx + 1 + Math.floor(Math.random() * Math.max(1, ready.length - 1))) % ready.length;
        const jitter = 0.96 + Math.random() * 0.08;
        this.playBuffer(ready[this.lastFootIdx]!, 0.5 * vol, rate * jitter);
        return;
      }
      this.playSynth("footstep");
      return;
    }

    if (name === "bowShot" || (name === "swing" && opts.ranged)) {
      if (this.tryPlayKey("bow_shot", vol, rate * (0.95 + Math.random() * 0.1), classId)) return;
      this.playSynth("bowShot");
      return;
    }

    if (name === "castStart") {
      const school = spellSfxSchool(opts.spellId);
      const key = (`spell_cast_${school}` in SFX_MAP ? `spell_cast_${school}` : "spell_cast_buff") as SfxMapKey;
      if (this.tryPlayKey(key, 0.7 * vol, rate, classId)) return;
      this.playSynth("castStart");
      return;
    }

    if (name === "spellHit") {
      const school = spellSfxSchool(opts.spellId);
      const key = (`spell_hit_${school}` in SFX_MAP ? `spell_hit_${school}` : "spell_hit_buff") as SfxMapKey;
      if (this.tryPlayKey(key, 0.75 * vol, rate, classId)) return;
      this.playSynth("spellHit");
      return;
    }

    const mapKey = CUE_TO_MAP[name as keyof typeof CUE_TO_MAP];
    if (mapKey) {
      const jitter = name === "swing" || name === "mobAttack" ? 0.92 + Math.random() * 0.16 : 1;
      if (this.tryPlayKey(mapKey, vol, rate * jitter, classId)) return;
    }
    this.playSynth(name);
  }
}

export const sound = new SoundManager();
