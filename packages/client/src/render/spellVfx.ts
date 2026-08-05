import * as THREE from "three";
import * as QUARKS from "three.quarks";
// quarks.core ships its own Vector3/Vector4 math classes (re-exported by
// three.quarks) -- its generator constructors (Gradient/ConstantColor/
// ColorRange) want *these*, not THREE's, despite being structurally similar.
import { Vector3 as QVector3, Vector4 as QVector4 } from "three.quarks";
import type { School } from "./vfx";
import { SCHOOL_VFX } from "./vfx";
import { SpellVfxPainter } from "./spellVfxPainter";
export { SpellVfxPainter } from "./spellVfxPainter";
export * from "./spellSpecs";
export * from "./spellVfxPrimitives";

/** Mirrors the normalized JSON shape written by scripts/hovl/extract-effect.mjs
 *  -- see that script's header for how each field maps back to Unity's
 *  ParticleSystem serialization. */
export interface CurveKeyframe {
  t: number;
  v: number;
  inSlope: number;
  outSlope: number;
}
export type CurveDescriptor =
  | { mode: "constant"; value: number }
  | { mode: "twoConstants"; min: number; max: number }
  | { mode: "curve"; multiplier: number; curve: CurveKeyframe[] }
  | { mode: "twoCurves"; multiplier: number; minCurve: CurveKeyframe[]; maxCurve: CurveKeyframe[] };

export interface RGB {
  r: number;
  g: number;
  b: number;
}
export interface GradientKeyframes {
  colorKeys: (RGB & { t: number })[];
  alphaKeys: { t: number; a: number }[];
}
export type GradientDescriptor =
  | { mode: "color"; color: RGB & { a: number } }
  | { mode: "twoColors"; min: RGB & { a: number }; max: RGB & { a: number } }
  | { mode: "gradient"; gradient: GradientKeyframes }
  | { mode: "twoGradients"; minGradient: GradientKeyframes; maxGradient: GradientKeyframes };

export interface HovlEffectJSON {
  id: string;
  duration: number;
  looping: boolean;
  simulationSpace: "local" | "world";
  maxParticles: number;
  initial: {
    lifetime: CurveDescriptor;
    speed: CurveDescriptor;
    size: CurveDescriptor;
    rotation: CurveDescriptor;
    color: GradientDescriptor;
    gravityModifier: CurveDescriptor;
  };
  shape: { type: string; angle: number; radius: number; arc: number; length: number } | null;
  emission: { rateOverTime: CurveDescriptor; bursts: { time: number; count: CurveDescriptor }[] };
  sizeOverLifetime: { curve: CurveDescriptor } | null;
  colorOverLifetime: GradientDescriptor | null;
  velocityOverLifetime: { space: "local" | "world"; x: CurveDescriptor; y: CurveDescriptor; z: CurveDescriptor } | null;
  forceOverLifetime: { space: "local" | "world"; x: CurveDescriptor; y: CurveDescriptor; z: CurveDescriptor } | null;
  renderer: {
    texture: string | null;
    blend: "additive" | "alpha";
    renderMode: number; // Unity ParticleSystemRenderer.renderMode: 0 Billboard, 1 Stretch -- matches QUARKS.RenderMode's own enum values 1:1
    lengthScale: number;
    velocityScale: number;
  } | null;
}

// ---------------------------------------------------------------------------
// CurveDescriptor / GradientDescriptor -> real three.quarks generators.
//
// Verified empirically against the actual installed three.quarks@0.17.1:
// PiecewiseBezier(t) reproduces our own Hermite math exactly once each
// keyframe pair is converted via the standard Hermite->Bezier control-point
// formula (B0=p0, B1=p0+m0*dt/3, B2=p1-m1*dt/3, B3=p1, dt = segment span).
// ---------------------------------------------------------------------------

function hermiteToBezier(a: CurveKeyframe, b: CurveKeyframe): QUARKS.Bezier {
  const dt = b.t - a.t;
  return new QUARKS.Bezier(a.v, a.v + (a.outSlope * dt) / 3, b.v - (b.inSlope * dt) / 3, b.v);
}

function curveToPiecewiseBezier(keyframes: CurveKeyframe[]): QUARKS.PiecewiseBezier {
  if (keyframes.length < 2) {
    const v = keyframes[0]?.v ?? 0;
    return new QUARKS.PiecewiseBezier([[new QUARKS.Bezier(v, v, v, v), 0]]);
  }
  const segments: Array<[QUARKS.Bezier, number]> = [];
  for (let i = 0; i < keyframes.length - 1; i++) {
    segments.push([hermiteToBezier(keyframes[i]!, keyframes[i + 1]!), keyframes[i]!.t]);
  }
  return new QUARKS.PiecewiseBezier(segments);
}

/** "twoCurves" (Unity's "Random Between Two Curves") has no direct quarks
 *  equivalent -- quarks' generators don't support drawing one random blend
 *  per particle between two independent Bezier curves. Falls back to the
 *  max curve alone; revisit if a ported effect actually leans on this mode
 *  (neither fire_hit nor heal_hit do). */
export function toValueGenerator(desc: CurveDescriptor): QUARKS.ValueGenerator | QUARKS.FunctionValueGenerator {
  switch (desc.mode) {
    case "constant":
      return new QUARKS.ConstantValue(desc.value);
    case "twoConstants":
      return new QUARKS.IntervalValue(desc.min, desc.max);
    case "curve":
      return scaledPiecewiseBezier(curveToPiecewiseBezier(desc.curve), desc.multiplier);
    case "twoCurves":
      return scaledPiecewiseBezier(curveToPiecewiseBezier(desc.maxCurve), desc.multiplier);
  }
}

/** quarks' PiecewiseBezier has no built-in output multiplier (unlike Unity's
 *  MinMaxCurve.scalar, which multiplies the curve's evaluated 0..1 shape) --
 *  bake it into the control points instead, since Bezier's are just numbers. */
function scaledPiecewiseBezier(pb: QUARKS.PiecewiseBezier, multiplier: number): QUARKS.FunctionValueGenerator {
  if (multiplier === 1) return pb;
  const scaled = pb.functions.map(([bezier, t]): [QUARKS.Bezier, number] => [
    new QUARKS.Bezier(bezier.p[0]! * multiplier, bezier.p[1]! * multiplier, bezier.p[2]! * multiplier, bezier.p[3]! * multiplier),
    t,
  ]);
  return new QUARKS.PiecewiseBezier(scaled);
}

function gradientKeyframesToQuarks(g: GradientKeyframes): QUARKS.Gradient {
  const color: Array<[QVector3, number]> = g.colorKeys.map((k) => [new QVector3(k.r, k.g, k.b), k.t]);
  const alpha: Array<[number, number]> = g.alphaKeys.map((k) => [k.a, k.t]);
  return new QUARKS.Gradient(color, alpha);
}

/** A degenerate single-stop gradient standing in for a constant color, for
 *  contexts (ColorOverLife) that only accept a FunctionColorGenerator --
 *  Unity's ColorOverLifetimeModule is effectively always gradient-mode in
 *  practice, so this only matters for the rare case it isn't. */
function constantAsGradient(c: RGB & { a: number }): QUARKS.Gradient {
  return new QUARKS.Gradient([[new QVector3(c.r, c.g, c.b), 0]], [[c.a, 0]]);
}

/** "twoGradients" falls back to the max gradient alone, same rationale as
 *  "twoCurves" above -- unused by either ported effect so far. */
export function toColorGenerator(desc: GradientDescriptor): QUARKS.ColorGenerator | QUARKS.FunctionColorGenerator {
  switch (desc.mode) {
    case "color":
      return new QUARKS.ConstantColor(new QVector4(desc.color.r, desc.color.g, desc.color.b, desc.color.a));
    case "twoColors":
      return new QUARKS.ColorRange(
        new QVector4(desc.min.r, desc.min.g, desc.min.b, desc.min.a),
        new QVector4(desc.max.r, desc.max.g, desc.max.b, desc.max.a),
      );
    case "gradient":
      return gradientKeyframesToQuarks(desc.gradient);
    case "twoGradients":
      return gradientKeyframesToQuarks(desc.maxGradient);
  }
}

/** ColorOverLife requires a FunctionColorGenerator specifically -- "color"/
 *  "twoColors" fall back to their constant/max value as a flat gradient
 *  (twoColors loses its randomization here, same documented tradeoff as
 *  twoCurves/twoGradients above; Unity's ColorOverLifetimeModule is
 *  effectively always gradient-mode in practice anyway). */
function toFunctionColorGenerator(desc: GradientDescriptor): QUARKS.FunctionColorGenerator {
  switch (desc.mode) {
    case "color":
      return constantAsGradient(desc.color);
    case "twoColors":
      return constantAsGradient(desc.max);
    case "gradient":
      return gradientKeyframesToQuarks(desc.gradient);
    case "twoGradients":
      return gradientKeyframesToQuarks(desc.maxGradient);
  }
}

/** SizeOverLife requires a FunctionValueGenerator (or Vector3Generator, which
 *  we don't use) -- "constant"/"twoConstants" fall back to their constant/max
 *  value as a flat curve (twoConstants loses its randomization here, same
 *  tradeoff as above). */
function toFunctionValueGenerator(desc: CurveDescriptor): QUARKS.FunctionValueGenerator {
  switch (desc.mode) {
    case "constant":
      return new QUARKS.PiecewiseBezier([[new QUARKS.Bezier(desc.value, desc.value, desc.value, desc.value), 0]]);
    case "twoConstants":
      return new QUARKS.PiecewiseBezier([[new QUARKS.Bezier(desc.max, desc.max, desc.max, desc.max), 0]]);
    case "curve":
      return scaledPiecewiseBezier(curveToPiecewiseBezier(desc.curve), desc.multiplier);
    case "twoCurves":
      return scaledPiecewiseBezier(curveToPiecewiseBezier(desc.maxCurve), desc.multiplier);
  }
}

// ---------------------------------------------------------------------------
// Texture loading + effect-JSON -> ParticleSystem.
// ---------------------------------------------------------------------------

const textureCache = new Map<string, THREE.Texture>();
function loadEffectTexture(url: string): THREE.Texture {
  let tex = textureCache.get(url);
  if (!tex) {
    tex = new THREE.TextureLoader().load(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(url, tex);
  }
  return tex;
}

/** ConeEmitter/SphereEmitter both emit along their local +Z (verified against
 *  the installed three.quarks source -- ConeEmitter.initialize sets
 *  `velocity = (0,0,cos(angle)) + position*sin(angle)`, position.z always 0).
 *  We want an impact burst's cone to spray "up" (matching how the old
 *  procedural system treated a "rising" spread), so the emitter object
 *  itself gets rotated -90 deg around X to swing local Z onto world +Y --
 *  verified numerically (THREE's +90deg-about-X actually sends +Z to -Y,
 *  not +Y; this constant originally had the wrong sign, which is exactly
 *  why fire's burst was spraying down instead of up). */
const CONE_UP_ROTATION = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

function buildEmitterShape(shape: HovlEffectJSON["shape"]): QUARKS.EmitterShape {
  if (!shape) return new QUARKS.SphereEmitter({ radius: 0.01 });
  if (shape.type === "cone" || shape.type === "coneVolume") {
    return new QUARKS.ConeEmitter({ radius: Math.max(shape.radius, 0.001), angle: (shape.angle * Math.PI) / 180, arc: (shape.arc * Math.PI) / 180 });
  }
  return new QUARKS.SphereEmitter({ radius: Math.max(shape.radius, 0.01) });
}

function buildEffectMaterial(effect: HovlEffectJSON): THREE.MeshBasicMaterial | null {
  if (!effect.renderer?.texture) return null;
  const texture = loadEffectTexture(effect.renderer.texture);
  return new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    blending: effect.renderer.blend === "additive" ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

function buildEffectBehaviors(effect: HovlEffectJSON): QUARKS.Behavior[] {
  const behaviors: QUARKS.Behavior[] = [];
  if (effect.sizeOverLifetime) {
    behaviors.push(new QUARKS.SizeOverLife(toFunctionValueGenerator(effect.sizeOverLifetime.curve)));
  }
  if (effect.colorOverLifetime) {
    behaviors.push(new QUARKS.ColorOverLife(toFunctionColorGenerator(effect.colorOverLifetime)));
  }
  if (effect.forceOverLifetime) {
    const f = effect.forceOverLifetime;
    behaviors.push(new QUARKS.ForceOverLife(toValueGenerator(f.x), toValueGenerator(f.y), toValueGenerator(f.z)));
  }
  return behaviors;
}

function effectRenderSettings(effect: HovlEffectJSON): {
  renderMode: QUARKS.RenderMode;
  rendererEmitterSettings: QUARKS.RendererEmitterSettings;
} {
  const stretched = effect.renderer?.renderMode === 1;
  return {
    renderMode: stretched ? QUARKS.RenderMode.StretchedBillBoard : QUARKS.RenderMode.BillBoard,
    rendererEmitterSettings: stretched
      ? { speedFactor: effect.renderer!.velocityScale, lengthFactor: effect.renderer!.lengthScale }
      : {},
  };
}

/** Builds a real three.quarks ParticleSystem from one extracted Hovl effect.
 *  Returns null if the effect has no usable texture (nothing to render). */
export function buildEffectParticleSystem(effect: HovlEffectJSON): QUARKS.ParticleSystem | null {
  const material = buildEffectMaterial(effect);
  if (!material) return null;
  const burst = effect.emission.bursts[0];
  const ps = new QUARKS.ParticleSystem({
    duration: effect.duration,
    looping: false,
    autoDestroy: true,
    worldSpace: true,
    shape: buildEmitterShape(effect.shape),
    startLife: toValueGenerator(effect.initial.lifetime),
    startSpeed: toValueGenerator(effect.initial.speed),
    startSize: toValueGenerator(effect.initial.size),
    startColor: toColorGenerator(effect.initial.color),
    emissionOverTime: new QUARKS.ConstantValue(0),
    emissionBursts: burst
      ? [{ time: burst.time, count: toValueGenerator(burst.count), cycle: 1, interval: 0.01, probability: 1 }]
      : [],
    behaviors: buildEffectBehaviors(effect),
    material,
    ...effectRenderSettings(effect),
  });
  if (effect.shape?.type === "cone" || effect.shape?.type === "coneVolume") {
    ps.emitter.quaternion.copy(CONE_UP_ROTATION);
  }
  return ps;
}

/** Builds a *continuous* quarks ParticleSystem from an extracted Hovl effect
 *  meant to trail a moving object (a projectile in flight) rather than fire
 *  a one-shot burst -- same translation, but drives emission from the
 *  effect's own rateOverTime instead of its bursts, and doesn't
 *  autoDestroy (the caller owns the system's lifetime: call .stop() when
 *  the projectile lands, see SpellVfxSystem.detachTrail). */
export function buildTrailParticleSystem(effect: HovlEffectJSON): QUARKS.ParticleSystem | null {
  const material = buildEffectMaterial(effect);
  if (!material) return null;
  const ps = new QUARKS.ParticleSystem({
    duration: effect.duration,
    looping: true,
    autoDestroy: false,
    worldSpace: true,
    shape: buildEmitterShape(effect.shape),
    startLife: toValueGenerator(effect.initial.lifetime),
    startSpeed: toValueGenerator(effect.initial.speed),
    startSize: toValueGenerator(effect.initial.size),
    startColor: toColorGenerator(effect.initial.color),
    emissionOverTime: toValueGenerator(effect.emission.rateOverTime),
    emissionBursts: [],
    behaviors: buildEffectBehaviors(effect),
    material,
    ...effectRenderSettings(effect),
  });
  if (effect.shape?.type === "cone" || effect.shape?.type === "coneVolume") {
    ps.emitter.quaternion.copy(CONE_UP_ROTATION);
  }
  return ps;
}

// ---------------------------------------------------------------------------
// Procedural fallback: builds a real quarks ParticleSystem straight from the
// existing per-school SchoolProfile data (vfx.ts), for every school that
// hasn't had an effect extracted from the Hovl pack yet. Reuses the same
// mesh geometries (orb/shard/leaf/torus) the old procedural system drew, so
// each school keeps its established silhouette, now driven by a real
// particle engine instead of hand-rolled velocity/gravity integration.
// ---------------------------------------------------------------------------

const proceduralGeoCache = new Map<string, THREE.BufferGeometry>();
function proceduralGeometry(geo: string): THREE.BufferGeometry {
  let g = proceduralGeoCache.get(geo);
  if (!g) {
    g =
      geo === "shard"
        ? new THREE.OctahedronGeometry(1, 0)
        : geo === "leaf"
          ? new THREE.PlaneGeometry(1, 1.5)
          : geo === "torus"
            ? new THREE.TorusGeometry(1, 0.3, 6, 12)
            : new THREE.SphereGeometry(1, 6, 5);
    proceduralGeoCache.set(geo, g);
  }
  return g;
}

function buildProceduralParticleSystem(school: School): QUARKS.ParticleSystem {
  const profile = SCHOOL_VFX[school];
  const material = new THREE.MeshBasicMaterial({
    color: profile.color,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const lifeSec = profile.lifeMs / 1000;

  // "spread" -> shape + emitter orientation, matching the old system's
  // per-pattern character (Fire rises, Frost falls, Arcane hovers/spins in
  // place, Shadow implodes toward the impact point, everything else is a
  // plain radial burst) using only the shape+speed primitives quarks offers.
  let shape: QUARKS.EmitterShape;
  let orientUp = false;
  let startSpeed: QUARKS.ValueGenerator = new QUARKS.IntervalValue(1.8, 4.2);
  if (profile.spread === "rising" || profile.spread === "falling") {
    shape = new QUARKS.ConeEmitter({ radius: 0.05, angle: (55 * Math.PI) / 180, arc: Math.PI * 2 });
    orientUp = profile.spread === "rising";
    if (profile.spread === "falling") startSpeed = new QUARKS.IntervalValue(-4.2, -1.8);
  } else if (profile.spread === "hover") {
    shape = new QUARKS.SphereEmitter({ radius: 0.3, thickness: 1 });
    startSpeed = new QUARKS.IntervalValue(0.3, 0.9);
  } else if (profile.spread === "implode") {
    // Spawn spread out around the impact point, then fly inward -- negative
    // speed sends particles opposite their spawn-radial direction (verified
    // against SphereEmitter's actual velocity = positionDir * startSpeed).
    shape = new QUARKS.SphereEmitter({ radius: 0.9, thickness: 1 });
    startSpeed = new QUARKS.IntervalValue(-3, -1.5);
  } else {
    shape = new QUARKS.SphereEmitter({ radius: 0.05, thickness: 1 });
  }

  const ps = new QUARKS.ParticleSystem({
    duration: lifeSec,
    looping: false,
    autoDestroy: true,
    worldSpace: true,
    shape,
    startLife: new QUARKS.ConstantValue(lifeSec),
    startSpeed,
    startSize: new QUARKS.ConstantValue(profile.particleSize),
    startColor: new QUARKS.ConstantColor(new QVector4(1, 1, 1, 1)),
    emissionOverTime: new QUARKS.ConstantValue(0),
    emissionBursts: [{ time: 0, count: new QUARKS.ConstantValue(profile.count), cycle: 1, interval: 0.01, probability: 1 }],
    behaviors: [
      new QUARKS.SizeOverLife(new QUARKS.PiecewiseBezier([[new QUARKS.Bezier(1, 1, 0.3, 0), 0]])),
      new QUARKS.ForceOverLife(new QUARKS.ConstantValue(0), new QUARKS.ConstantValue(-profile.gravity), new QUARKS.ConstantValue(0)),
    ],
    material,
    renderMode: QUARKS.RenderMode.Mesh,
    instancingGeometry: proceduralGeometry(profile.geo),
  });
  if (orientUp) ps.emitter.quaternion.copy(CONE_UP_ROTATION);
  return ps;
}

// ---------------------------------------------------------------------------
// Top-level system: one BatchedRenderer per scene, spawns either an
// extracted-effect or procedural-fallback ParticleSystem per school.
// ---------------------------------------------------------------------------

export class SpellVfxSystem {
  private scene: THREE.Scene;
  private renderer: QUARKS.BatchedRenderer;
  private effects = new Map<string, HovlEffectJSON>();
  private trailEffects = new Map<string, HovlEffectJSON>();
  private effectIdForSchool = new Map<School, string>();
  private liveBurstCount = 0;
  private static readonly MAX_LIVE_BURSTS = 18;

  readonly painter: SpellVfxPainter;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.renderer = new QUARKS.BatchedRenderer();
    scene.add(this.renderer);
    this.painter = new SpellVfxPainter(scene, this);
  }

  /** Load an extracted Hovl effect and register it as school's textured hit
   *  burst (takes priority over the procedural fallback once loaded). */
  async loadEffect(school: School, id: string, url: string): Promise<void> {
    if (this.effects.has(id)) {
      this.effectIdForSchool.set(school, id);
      return;
    }
    let json: HovlEffectJSON;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      json = (await res.json()) as HovlEffectJSON;
    } catch (e) {
      console.error(`[SpellVfxSystem] failed to load effect "${id}" from ${url}:`, e);
      return;
    }
    this.effects.set(id, json);
    this.effectIdForSchool.set(school, id);
  }

  /** Spawn `school`'s hit burst at world position `pos` -- the extracted
   *  Hovl effect if one's loaded for this school, otherwise a procedural
   *  particle system built straight from SCHOOL_VFX. */
  spawnForSchool(school: School, pos: THREE.Vector3): void {
    if (this.liveBurstCount >= SpellVfxSystem.MAX_LIVE_BURSTS) return;
    const effectId = this.effectIdForSchool.get(school);
    const effect = effectId ? this.effects.get(effectId) : undefined;
    const ps = effect ? buildEffectParticleSystem(effect) : buildProceduralParticleSystem(school);
    if (!ps) return;
    ps.emitter.position.copy(pos);
    // The emitter is a plain THREE.Object3D -- registering it with the
    // BatchedRenderer alone does NOT put it in the scene graph, so its
    // position/matrixWorld never actually updates without this. (Missed
    // this the first time through -- it's why nothing appeared to change:
    // the systems were being created and told to play, just never placed
    // anywhere the renderer would draw them.)
    this.scene.add(ps.emitter);
    this.renderer.addSystem(ps);
    this.liveBurstCount++;
    ps.play();
    // autoDestroy removes the system from the BatchedRenderer once all its
    // particles die, but never touches the scene graph -- without this the
    // now-empty emitter Object3D leaks forever.
    ps.addEventListener("destroy", () => {
      this.scene.remove(ps.emitter);
      this.liveBurstCount = Math.max(0, this.liveBurstCount - 1);
    });
  }

  /** Load an extracted continuous ("Sparks <color>", not "explode") Hovl
   *  effect as `id`'s reusable trail template -- separate registry from
   *  loadEffect's one-shot bursts since the two need different quarks
   *  ParticleSystemParameters (see buildTrailParticleSystem). */
  async loadTrailEffect(id: string, url: string): Promise<void> {
    if (this.trailEffects.has(id)) return;
    let json: HovlEffectJSON;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      json = (await res.json()) as HovlEffectJSON;
    } catch (e) {
      console.error(`[SpellVfxSystem] failed to load trail effect "${id}" from ${url}:`, e);
      return;
    }
    this.trailEffects.set(id, json);
  }

  /** Start a continuous trail (`id`, from loadTrailEffect) following a
   *  projectile in flight. Returns null if the effect isn't loaded/usable --
   *  callers should just skip trail upkeep for that projectile in that case.
   *  Caller is responsible for calling moveTrail every frame the projectile
   *  is alive and detachTrail exactly once when it lands/despawns. */
  attachTrail(id: string, pos: THREE.Vector3): QUARKS.ParticleSystem | null {
    const effect = this.trailEffects.get(id);
    const ps = effect ? buildTrailParticleSystem(effect) : null;
    if (!ps) return null;
    ps.emitter.position.copy(pos);
    this.scene.add(ps.emitter);
    this.renderer.addSystem(ps);
    ps.play();
    ps.addEventListener("destroy", () => {
      this.scene.remove(ps.emitter);
    });
    return ps;
  }

  moveTrail(ps: QUARKS.ParticleSystem, pos: THREE.Vector3): void {
    ps.emitter.position.copy(pos);
  }

  /** Stops new emission and hands cleanup to the same autoDestroy+"destroy"
   *  event path spawnForSchool's bursts already use -- particles already in
   *  flight keep simulating and fading out naturally instead of vanishing. */
  detachTrail(ps: QUARKS.ParticleSystem): void {
    ps.autoDestroy = true;
    ps.stop();
  }

  update(dt: number): void {
    this.renderer.update(dt);
    this.painter.update(dt);
  }
}
