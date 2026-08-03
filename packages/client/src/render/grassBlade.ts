import * as THREE from "three";

/**
 * Stylized wind-animated grass blade -- geometry, material, and uniforms.
 *
 * Base technique from cortiz2894/stylized-components (MIT), with Breath of
 * the Wild–style cues from James Smyth's three-grass-demo
 * (https://smythdesign.com/blog/stylized-grass-webgl/):
 *   - 5-vertex tip-bent blade silhouette
 *   - height mask for wind (base static → tip sways most)
 *   - scrolling cloud-shadow darkening across the field
 *   - world-space field color mottling
 *
 * Adapted to vanilla Three.js MeshLambertMaterial + onBeforeCompile (same
 * pattern as ./terrain.ts). Rock-trampling uniforms flatten/bend blades near
 * actors. Dirt-mask uniforms stay (uDirtCoverage defaults to 0) so GLSL stays
 * identical across instances — see the shared-program warning below.
 *
 * IMPORTANT: every blade material must inject IDENTICAL GLSL and vary only
 * uniform *values*, never branch the injected GLSL string itself (e.g.
 * conditionally omitting the rock loop). Three.js's program-cache key does
 * not account for onBeforeCompile's literal string content, so two
 * differently-branched materials that look identical to Three's cache-key
 * logic can silently share one compiled program and run the wrong shader on
 * one of them. Always compile the same code path; only uniform values (like
 * uRockCount) should differ between instances.
 */

/** Max rocks the blade shader can be trampled by. GLSL uniform arrays are
 *  fixed size, so this is a hard cap; uRockCount limits how many are read. */
export const MAX_ROCKS = 24;

/** Shadow taps per blade, averaged for a soft penumbra instead of one hard
 *  per-fragment sample (which flickers as moving shadow casters sweep the
 *  field). Fixed-size varying array; uShadowSamples chooses how many are
 *  actually read. */
export const MAX_SHADOW_TAPS = 4;

/**
 * BotW-style single blade (Smyth / Dedene): 5 verts — base L/R, mid L/R, tip.
 * Unit height; base width = 1. Tip is bent slightly in +Z for silhouette.
 */
export function makeBladeGeometry(_segments = 3): THREE.BufferGeometry {
  // Mid width ≈ half base; tip offset gives the classic Zelda lean.
  const midW = 0.28;
  const tipBend = 0.12;
  const positions = new Float32Array([
    // bl, br, mid-r, mid-l, tip  — y is the wind height mask (0 / 0.5 / 1)
    -0.5, 0.0, 0.0,
     0.5, 0.0, 0.0,
     midW, 0.5, tipBend * 0.35,
    -midW, 0.5, tipBend * 0.35,
     0.0, 1.0, tipBend,
  ]);
  const indices = [
    0, 1, 2,
    2, 4, 3,
    3, 0, 2,
  ];

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Dense-looking tuft: several BotW blades fanned around Y in one draw call.
 * One instance ≈ 4 blades of visual density at ~1/4 the instance count.
 */
export function makeBladeTuftGeometry(segments = 3, blades = 4): THREE.BufferGeometry {
  const blade = makeBladeGeometry(segments);
  const srcPos = blade.getAttribute("position") as THREE.BufferAttribute;
  const srcIdx = blade.getIndex()!;
  const verts = srcPos.count;
  const positions = new Float32Array(verts * blades * 3);
  const indices: number[] = [];

  for (let b = 0; b < blades; b++) {
    const yaw = (b / blades) * Math.PI + (b % 2) * 0.12;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    // Slight radial offset so the clump isn't a perfect star through one point.
    const ox = Math.cos(yaw + 0.7) * 0.12;
    const oz = Math.sin(yaw + 0.7) * 0.12;
    const heightJitter = 0.85 + (b / Math.max(1, blades - 1)) * 0.25;
    // Per-blade tip bend direction (Smyth random tip bend).
    const tipYaw = yaw + (b % 2 === 0 ? 0.35 : -0.28);
    const tipOx = Math.cos(tipYaw) * 0.08;
    const tipOz = Math.sin(tipYaw) * 0.08;
    const base = b * verts;
    for (let i = 0; i < verts; i++) {
      const y0 = srcPos.getY(i);
      const h = Math.max(0, Math.min(1, y0)); // 0 / 0.5 / 1 wind mask
      let x = srcPos.getX(i);
      const y = y0 * heightJitter;
      let z = srcPos.getZ(i);
      // Bend tip toward tipYaw
      x += tipOx * h;
      z += tipOz * h;
      const rx = x * cos - z * sin + ox;
      const rz = x * sin + z * cos + oz;
      const o = (base + i) * 3;
      positions[o] = rx;
      positions[o + 1] = y;
      positions[o + 2] = rz;
    }
    for (let i = 0; i < srcIdx.count; i++) {
      indices.push(base + srcIdx.getX(i));
    }
  }

  blade.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export interface GrassBladeUniforms {
  uTime: THREE.IUniform<number>;

  // Wind
  uWindStrength: THREE.IUniform<number>;
  uWindSpeed: THREE.IUniform<number>;
  uWindFreq: THREE.IUniform<number>;
  uWindTurb: THREE.IUniform<number>;
  uWindLean: THREE.IUniform<number>;
  uWindDir: THREE.IUniform<THREE.Vector2>;
  /** Grass-only motion multiplier (wind strength still applies on top). */
  uGrassSway: THREE.IUniform<number>;

  // Color gradient (base -> tip)
  uGrassBottom: THREE.IUniform<THREE.Color>;
  uGrassTop: THREE.IUniform<THREE.Color>;
  uBrightness: THREE.IUniform<number>;
  uGradStart: THREE.IUniform<number>;
  uGradEnd: THREE.IUniform<number>;
  uGradPower: THREE.IUniform<number>;

  // Environmental patches -- large-scale noise indexing a lush/dry drift.
  uPatchLush: THREE.IUniform<THREE.Color>;
  uPatchDry: THREE.IUniform<THREE.Color>;
  uPatchStrength: THREE.IUniform<number>;
  uPatchScale: THREE.IUniform<number>;
  uPatchBias: THREE.IUniform<number>;

  // Soft multi-tap shadow.
  uShadowStrength: THREE.IUniform<number>;
  uShadowSamples: THREE.IUniform<number>;
  uShadowSampleY: THREE.IUniform<number>;
  uShadowRadius: THREE.IUniform<number>;

  // Dirt colormap (procedural, world-space).
  uDirtColor: THREE.IUniform<THREE.Color>;
  uDirtScale: THREE.IUniform<number>;
  uDirtCoverage: THREE.IUniform<number>;
  uDirtSoftness: THREE.IUniform<number>;
  uDirtWarp: THREE.IUniform<number>;
  uDirtCut: THREE.IUniform<number>;
  uDirtBlend: THREE.IUniform<number>;

  // Rock trampling -- filled each frame from player / nearby actors.
  uRocks: THREE.IUniform<THREE.Vector4[]>;
  uRockCount: THREE.IUniform<number>;
  uRockRadiusMul: THREE.IUniform<number>;
  uRockFalloff: THREE.IUniform<number>;
  uRockFlatten: THREE.IUniform<number>;
  uRockBend: THREE.IUniform<number>;

  // Translucency (subsurface back-light).
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSunColor: THREE.IUniform<THREE.Color>;
  uTransColor: THREE.IUniform<THREE.Color>;
  uTransStrength: THREE.IUniform<number>;
  uTransPower: THREE.IUniform<number>;
  uTransTip: THREE.IUniform<number>;
  uTransShadow: THREE.IUniform<number>;

  // BotW / Smyth: scrolling cloud shadows + field mottling strength.
  uCloudStrength: THREE.IUniform<number>;
  uCloudScale: THREE.IUniform<number>;
  uCloudSpeed: THREE.IUniform<number>;
  uFieldMottle: THREE.IUniform<number>;
  uFieldScale: THREE.IUniform<number>;
}

export function createGrassBladeUniforms(colorOverride?: { bottom: string; top: string }): GrassBladeUniforms {
  return {
    uTime: { value: 0 },

    uWindStrength: { value: 0.35 },
    uWindSpeed: { value: 1.15 },
    uWindFreq: { value: 0.38 },
    uWindTurb: { value: 0.28 },
    uWindLean: { value: 0.55 },
    uWindDir: { value: new THREE.Vector2(1, 0) },
    uGrassSway: { value: 1.0 },

    uGrassBottom: { value: new THREE.Color(colorOverride?.bottom ?? "#3d6a10") },
    uGrassTop: { value: new THREE.Color(colorOverride?.top ?? "#8fb82e") },
    uBrightness: { value: 0.92 },
    uGradStart: { value: 0.08 },
    uGradEnd: { value: 1.0 },
    uGradPower: { value: 1.35 },

    uPatchLush: { value: new THREE.Color("#6f9a2a") },
    uPatchDry: { value: new THREE.Color("#b8a94e") },
    uPatchStrength: { value: 0.42 },
    uPatchScale: { value: 0.12 },
    uPatchBias: { value: 1.45 },

    uShadowStrength: { value: 0.45 },
    uShadowSamples: { value: 1 },
    uShadowSampleY: { value: 0.4 },
    uShadowRadius: { value: 0.25 },

    uDirtColor: { value: new THREE.Color("#ac956c") },
    uDirtScale: { value: 0.4 },
    uDirtCoverage: { value: 0.0 },
    uDirtSoftness: { value: 0.06 },
    uDirtWarp: { value: 0.2 },
    uDirtCut: { value: 1.0 },
    uDirtBlend: { value: 0.8 },

    uRocks: { value: Array.from({ length: MAX_ROCKS }, () => new THREE.Vector4()) },
    uRockCount: { value: 0 },
    uRockRadiusMul: { value: 1.35 },
    uRockFalloff: { value: 0.75 },
    uRockFlatten: { value: 0.95 },
    uRockBend: { value: 0.55 },

    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 1, 1) },
    uTransColor: { value: new THREE.Color("#c1e54d") },
    uTransStrength: { value: 0.85 },
    uTransPower: { value: 3.0 },
    uTransTip: { value: 0.6 },
    uTransShadow: { value: 1.0 },

    uCloudStrength: { value: 0.38 },
    uCloudScale: { value: 0.035 },
    uCloudSpeed: { value: 0.018 },
    uFieldMottle: { value: 0.55 },
    uFieldScale: { value: 0.055 },
  };
}

const GROUND_MASK_UNIFORMS = /* glsl */ `
  uniform vec3  uDirtColor;
  uniform float uDirtScale;
  uniform float uDirtCoverage;
  uniform float uDirtSoftness;
  uniform float uDirtWarp;
`;

const GROUND_MASK_GLSL = /* glsl */ `
  float _gmHash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }

  float _gmNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(_gmHash(i),                  _gmHash(i + vec2(1.0, 0.0)), u.x),
      mix(_gmHash(i + vec2(0.0, 1.0)), _gmHash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float _gmFbm(vec2 p) {
    float v = 0.0, a = 0.5, n = 0.0;
    for (int i = 0; i < 4; i++) {
      v += a * _gmNoise(p);
      n += a;
      p = p * 2.03 + vec2(3.1, 7.7);
      a *= 0.5;
    }
    return v / max(n, 0.001);
  }

  float groundDirt(vec2 worldXZ) {
    vec2 p = worldXZ * uDirtScale;
    if (uDirtWarp > 0.001) {
      vec2 w = vec2(_gmFbm(p + vec2(11.3, 2.7)), _gmFbm(p + vec2(5.9, 17.1)));
      p += (w - 0.5) * uDirtWarp;
    }
    float n = _gmFbm(p);
    float threshold = 1.0 - uDirtCoverage;
    return smoothstep(threshold - uDirtSoftness, threshold + uDirtSoftness, n);
  }
`;

const GRASS_BLADE_UNIFORMS = /* glsl */ `
  uniform float uTime;
  uniform float uWindStrength;
  uniform float uWindSpeed;
  uniform float uWindFreq;
  uniform float uWindTurb;
  uniform float uWindLean;
  uniform vec2  uWindDir;
  uniform float uGrassSway;

  varying float vBH;
  varying vec3  vWorldPos;
  varying vec3  vBladeN;
  varying float vDirt;
  varying float vPatch;
  uniform float uPatchScale;
  varying float vRockInfl;
  varying float vField;

  uniform float uDirtCut;
  uniform float uShadowSampleY;
  uniform float uShadowRadius;
  uniform float uFieldScale;

  #ifdef USE_SHADOWMAP
    varying vec4 vGrassShCoord[ GRASS_SHADOW_TAPS ];
  #endif

  uniform vec4  uRocks[ MAX_ROCKS ];
  uniform int   uRockCount;
  uniform float uRockRadiusMul;
  uniform float uRockFalloff;
  uniform float uRockFlatten;
  uniform float uRockBend;
`;

const GRASS_BLADE_VERTEX = /* glsl */ `
  #include <begin_vertex>

  // Instance matrices are authored in region-local space; tramplers are too.
  // Do NOT multiply by modelMatrix here — continent layers offset the group
  // into world space and that would make flatten never line up with the player.
  vec2 baseXZ = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
  vDirt = groundDirt(baseXZ);
  vPatch = _gmFbm(baseXZ * uPatchScale);
  // Smyth-style field mottling: large soft color patches across the meadow.
  vField = _gmFbm(baseXZ * uFieldScale + vec2(19.7, 3.1));

  float rockInfl = 0.0;
  vec2  rockAway = vec2(1.0, 0.0);
  for (int i = 0; i < MAX_ROCKS; i++) {
    if (i >= uRockCount) break;
    vec4  rock = uRocks[i];
    vec2  d    = baseXZ - rock.xz;
    float dist = length(d);
    float rad  = rock.w * uRockRadiusMul;
    float infl = 1.0 - smoothstep(rad, rad + uRockFalloff, dist);
    if (infl > rockInfl) {
      rockInfl = infl;
      rockAway = dist > 1e-4 ? d / dist : vec2(1.0, 0.0);
    }
  }
  vRockInfl = rockInfl;

  float shrink = (1.0 - uDirtCut * vDirt) * (1.0 - uRockFlatten * rockInfl);
  transformed.y *= shrink;

  // BotW height mask from authored Y (0 base / 0.5 mid / 1 tip).
  vBH = clamp(position.y, 0.0, 1.0) * shrink;
  float hMask = vBH * vBH;

  vec3 wPos = (instanceMatrix * vec4(position, 1.0)).xyz;
  vWorldPos = (modelMatrix * instanceMatrix * vec4(position, 1.0)).xyz;

  float primary = sin(dot(wPos.xz, uWindDir) * uWindFreq + uTime * uWindSpeed);
  float second  = sin(dot(wPos.xz, uWindDir) * uWindFreq * 2.6 + uTime * uWindSpeed * 1.8 + 1.3) * 0.35;
  vec2  perp    = vec2(-uWindDir.y, uWindDir.x);
  float turb    = sin(dot(wPos.xz, perp) * uWindFreq * 1.9 + uTime * uWindSpeed * 0.7 + 2.6) * uWindTurb;
  float phase   = baseXZ.x * 0.35 + baseXZ.y * 0.22;
  float gust    = 0.72 + 0.28 * sin(uTime * 0.35 + phase * 0.15);
  // Wind strength × grass-only sway: still air or still grass either silences motion.
  float amp     = uWindStrength * uGrassSway;
  float swing   = (primary + second + turb) * amp * hMask * gust;
  float lean    = uWindLean * amp * hMask * (0.85 + 0.15 * gust);

  mat3 instRot = mat3(
    normalize(vec3(instanceMatrix[0])),
    normalize(vec3(instanceMatrix[1])),
    normalize(vec3(instanceMatrix[2]))
  );
  vec3 windWorld = vec3(uWindDir.x, 0.0, uWindDir.y);
  vec3 windLocal = transpose(instRot) * windWorld;
  transformed += windLocal * (swing + lean);

  if (rockInfl > 0.001) {
    vec3 awayLocal = transpose(instRot) * vec3(rockAway.x, 0.0, rockAway.y);
    transformed += awayLocal * (uRockBend * rockInfl * hMask);
  }

  vBladeN = normalize(mat3(modelMatrix) * instRot * normal);
`;

/** Fragment-only FBM (no dirt uniforms — those live in the vertex ground mask). */
const CLOUD_FBM_GLSL = /* glsl */ `
  float _cfHash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }
  float _cfNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(_cfHash(i),                  _cfHash(i + vec2(1.0, 0.0)), u.x),
      mix(_cfHash(i + vec2(0.0, 1.0)), _cfHash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float _cfFbm(vec2 p) {
    float v = 0.0, a = 0.5, n = 0.0;
    for (int i = 0; i < 4; i++) {
      v += a * _cfNoise(p);
      n += a;
      p = p * 2.03 + vec2(3.1, 7.7);
      a *= 0.5;
    }
    return v / max(n, 0.001);
  }
`;

const GRASS_SHADOW_VERTEX = /* glsl */ `
  #if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP )
    vec4 worldPosition = vec4( 1e6, 1e6, 1e6, 1.0 );
  #endif

  #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
    vec3 _shBase = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
    vec3 _shTip  = ( modelMatrix * instanceMatrix * vec4( 0.0, 1.0, 0.0, 1.0 ) ).xyz;
    vec3 _shCenter = mix( _shBase, _shTip, uShadowSampleY );

    float _rot = fract( sin( dot( _shBase.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) * 6.2831853;

    for ( int _k = 0; _k < GRASS_SHADOW_TAPS; _k++ ) {
      float _a   = _rot + 6.2831853 * ( float( _k ) + 0.5 ) / float( GRASS_SHADOW_TAPS );
      vec2  _off = vec2( cos( _a ), sin( _a ) ) * uShadowRadius;
      vGrassShCoord[ _k ] = directionalShadowMatrix[ 0 ] * vec4( _shCenter + vec3( _off.x, 0.0, _off.y ), 1.0 );
    }
  #endif
`;

/** Build a shared blade MeshLambertMaterial patched via onBeforeCompile.
 *  See the module doc comment above for why every instance must inject
 *  identical GLSL. */
export function makeBladeMaterial(u: GrassBladeUniforms): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
  // Bust Three's program cache when this GLSL changes (HMR / prior broken compiles).
  mat.customProgramCacheKey = () => "grass-botw-v3";

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);

    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>
      #define MAX_ROCKS ${MAX_ROCKS}
      #define GRASS_SHADOW_TAPS ${MAX_SHADOW_TAPS}
      ${GROUND_MASK_UNIFORMS}
      ${GROUND_MASK_GLSL}
      ${GRASS_BLADE_UNIFORMS}`,
    );
    shader.vertexShader = shader.vertexShader.replace("#include <begin_vertex>", GRASS_BLADE_VERTEX);
    shader.vertexShader = shader.vertexShader.replace("#include <worldpos_vertex>", GRASS_SHADOW_VERTEX);
    shader.vertexShader = shader.vertexShader.replace(
      "#include <defaultnormal_vertex>",
      `#include <defaultnormal_vertex>
      transformedNormal = normalize( mat3( viewMatrix ) * vec3( 0.0, 1.0, 0.0 ) );`,
    );

    shader.fragmentShader =
      `#define GRASS_SHADOW_TAPS ${MAX_SHADOW_TAPS}
      varying float vBH;
      varying vec3  vWorldPos;
      varying vec3  vBladeN;
      varying float vDirt;
      varying float vPatch;
      varying float vField;
      uniform vec3  uGrassBottom;
      uniform vec3  uGrassTop;
      uniform float uBrightness;
      uniform float uGradStart;
      uniform float uGradEnd;
      uniform float uGradPower;
      uniform vec3  uDirtColor;
      uniform float uDirtBlend;
      uniform vec3  uPatchLush;
      uniform vec3  uPatchDry;
      uniform float uPatchStrength;
      uniform float uPatchBias;
      uniform float uFieldMottle;
      uniform float uCloudStrength;
      uniform float uCloudScale;
      uniform float uCloudSpeed;
      uniform float uTime;
      uniform int   uShadowSamples;
      uniform float uShadowStrength;
      uniform vec3  uSunDir;
      uniform vec3  uSunColor;
      uniform vec3  uTransColor;
      uniform float uTransStrength;
      uniform float uTransPower;
      uniform float uTransTip;
      uniform float uTransShadow;
      #ifdef USE_SHADOWMAP
        varying vec4 vGrassShCoord[ GRASS_SHADOW_TAPS ];
      #endif
      ${CLOUD_FBM_GLSL}\n` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_begin>",
      `#include <normal_fragment_begin>
      normal = normalize( mat3( viewMatrix ) * vec3( 0.0, 1.0, 0.0 ) );`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "vec4 diffuseColor = vec4( diffuse, opacity );",
      `float _gT = clamp( ( vBH - uGradStart ) / max( uGradEnd - uGradStart, 0.001 ), 0.0, 1.0 );
      _gT = pow( _gT, uGradPower );
      vec3 _bladeCol = mix( uGrassBottom, uGrassTop, _gT );

      // Patch lush/dry (existing) + Smyth-style field mottling (per-blade solid tint).
      float _pt = pow( clamp( vPatch, 0.0, 1.0 ), uPatchBias );
      _bladeCol = mix( _bladeCol, mix( uPatchLush, uPatchDry, _pt ), uPatchStrength );
      vec3 _fieldTint = mix( uGrassBottom * 0.85, uGrassTop * 1.15, clamp( vField, 0.0, 1.0 ) );
      _bladeCol = mix( _bladeCol, _fieldTint, uFieldMottle * 0.65 );

      _bladeCol = mix( _bladeCol, uDirtColor, vDirt * uDirtBlend );

      // Scrolling cloud shadows (Smyth cloud.jpg mix) — procedural FBM, no texture.
      vec2 _cloudUv = vWorldPos.xz * uCloudScale + vec2( uTime * uCloudSpeed, uTime * uCloudSpeed * 0.55 );
      float _cloud = _cfFbm( _cloudUv );
      _cloud = smoothstep( 0.32, 0.72, _cloud );
      _bladeCol *= mix( 1.0, mix( 0.55, 1.0, _cloud ), uCloudStrength );

      vec4 diffuseColor = vec4( _bladeCol * uBrightness, opacity );`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <opaque_fragment>",
      `#include <opaque_fragment>
      {
        float _shadow = 1.0;
        #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
          DirectionalLightShadow _dls = directionalLightShadows[ 0 ];
          float _sSum = 0.0;
          int   _sN   = 0;
          for ( int _k = 0; _k < GRASS_SHADOW_TAPS; _k++ ) {
            if ( _k >= uShadowSamples ) break;
            _sSum += getShadow(
              directionalShadowMap[ 0 ],
              _dls.shadowMapSize,
              _dls.shadowIntensity,
              _dls.shadowBias,
              _dls.shadowRadius,
              vGrassShCoord[ _k ]
            );
            _sN++;
          }
          _shadow = _sSum / float( max( _sN, 1 ) );
        #endif

        gl_FragColor.rgb *= ( 1.0 - uShadowStrength * ( 1.0 - _shadow ) );

        vec3  _L    = normalize( uSunDir );
        vec3  _V    = normalize( cameraPosition - vWorldPos );
        float _back = pow( max( dot( _V, -_L ), 0.0 ), uTransPower );
        float _thin = mix( 1.0, vBH, uTransTip );
        float _edge = 1.0 - abs( dot( normalize( vBladeN ), _L ) );
        float _sh   = mix( 1.0, _shadow, uTransShadow );

        vec3 _trans = uTransColor * uSunColor * uTransStrength
                    * _back * _thin * _edge * _sh;

        gl_FragColor.rgb += _trans;
      }`,
    );
  };

  return mat;
}
