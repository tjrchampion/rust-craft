// Normalizes Unity's MinMaxCurve/MinMaxGradient serialization into a small,
// generic descriptor that AnimationClip-free JS (see textureParticles.ts on
// the client side) can evaluate without knowing anything about Unity.
//
// Unity reuses field names (`minMaxState`, `scalar`, `minScalar`, `minColor`,
// `maxColor`) across two *different* enums depending on which module they're
// attached to -- getting this backwards silently produces plausible-looking
// but wrong numbers, so it's worth spelling out explicitly:
//   MinMaxCurve.minMaxState  (ParticleSystemCurveMode):    0 Constant, 1 Curve, 2 TwoCurves, 3 TwoConstants
//   MinMaxGradient.minMaxState (ParticleSystemGradientMode): 0 Color, 1 Gradient, 2 TwoColors, 3 TwoGradients, 4 RandomColor
// For both, `scalar`/`maxColor` hold the single/upper value and
// `minScalar`/`minColor` the lower one -- Unity always serializes every
// field regardless of which mode is active, so reading the wrong one for
// the current mode gives a real-looking but stale number from a past edit.

// Unity's AnimationCurve keyframes carry in/out tangent slopes so playback
// can reproduce the artist's actual smooth curve (cubic Hermite spline)
// instead of straight line segments between keyframes -- even keyframes
// with auto-computed (non-linear-mode) tangents produce a visibly different,
// smoother "ease" shape than a plain lerp would. Weighted tangents
// (weightedMode != 0, using inWeight/outWeight to bend the handle) aren't
// carried through -- rare in practice for these packs, and worth flagging
// if it turns out to matter rather than silently guessing at the math.
function curveKeyframes(curve) {
  const arr = Array.isArray(curve?.m_Curve) ? curve.m_Curve : curve?.m_Curve ? [curve.m_Curve] : [];
  return arr.map((k) => ({ t: k.time, v: k.value, inSlope: k.inSlope, outSlope: k.outSlope }));
}

/** A Unity `MinMaxCurve` (used for scalar fields: lifetime, speed, size, ...). */
export function normalizeCurve(mm) {
  if (!mm) return { mode: "constant", value: 0 };
  const state = mm.minMaxState ?? 0;
  if (state === 0) return { mode: "constant", value: mm.scalar };
  if (state === 3) return { mode: "twoConstants", min: mm.minScalar, max: mm.scalar };
  if (state === 1) return { mode: "curve", multiplier: mm.scalar, curve: curveKeyframes(mm.maxCurve) };
  // state === 2: TwoCurves
  return {
    mode: "twoCurves",
    multiplier: mm.scalar,
    minCurve: curveKeyframes(mm.minCurve),
    maxCurve: curveKeyframes(mm.maxCurve),
  };
}

function gradientKeyframes(gradient) {
  const numColor = gradient?.m_NumColorKeys ?? 0;
  const numAlpha = gradient?.m_NumAlphaKeys ?? 0;
  const colorKeys = [];
  for (let i = 0; i < numColor; i++) {
    const key = gradient[`key${i}`];
    const ctime = gradient[`ctime${i}`];
    colorKeys.push({ t: ctime / 65535, r: key.r, g: key.g, b: key.b });
  }
  const alphaKeys = [];
  for (let i = 0; i < numAlpha; i++) {
    const key = gradient[`key${i}`];
    const atime = gradient[`atime${i}`];
    alphaKeys.push({ t: atime / 65535, a: key.a });
  }
  return { colorKeys, alphaKeys };
}

/** A Unity `MinMaxGradient` (used for startColor and every *ColorModule*). */
export function normalizeGradient(mm) {
  if (!mm) return { mode: "color", color: { r: 1, g: 1, b: 1, a: 1 } };
  const state = mm.minMaxState ?? 0;
  if (state === 0) return { mode: "color", color: mm.maxColor };
  if (state === 2) return { mode: "twoColors", min: mm.minColor, max: mm.maxColor };
  if (state === 1) return { mode: "gradient", gradient: gradientKeyframes(mm.maxGradient) };
  if (state === 3) {
    return {
      mode: "twoGradients",
      minGradient: gradientKeyframes(mm.minGradient),
      maxGradient: gradientKeyframes(mm.maxGradient),
    };
  }
  return { mode: "color", color: mm.maxColor }; // 4 = RandomColor: not worth a 5th mode, close enough
}
