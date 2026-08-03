/**
 * Quick Grass shaders — ported from quick-grass-1.html (see ./REFERENCE.html).
 *
 * Differences from the demo:
 *  - The demo's procedural `terrainHeight(vec2)` sine-wave ground is replaced
 *    with real heightmap + density texture sampling (`sampleHeight` /
 *    `sampleDensity`) so blades sit on an authored region heightmap and only
 *    grow where a paint stroke (GrassPatch) has laid down coverage.
 *  - The sky dome / terrain mesh / orb shaders from the demo are dropped
 *    entirely — this module only carries what the grass blades themselves
 *    need (SKY is kept because the blade fragment shader uses its ambient/
 *    fog/tonemap helpers).
 *
 * Materials built from GRASS_VS/GRASS_FS must be constructed with
 * `glslVersion: THREE.GLSL1` (Three.js r185) since these are written in
 * GLSL ES 1.00 (`texture2D`, `varying`, `gl_FragColor`) like the original
 * demo, not core-profile GLSL3.
 */

export const COMMON = `
#define PI 3.14159265359
float saturate(float x){ return clamp(x, 0.0, 1.0); }
vec3 saturate3(vec3 x){ return clamp(x, vec3(0.0), vec3(1.0)); }
float linearstep(float a, float b, float v){ return clamp((v-a)/(b-a), 0.0, 1.0); }
float remap(float v, float a, float b, float c, float d){ return mix(c, d, (v-a)/(b-a)); }
float easeOut(float x, float t){ return 1.0 - pow(1.0 - x, t); }
float easeIn(float x, float t){ return pow(x, t); }

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec4 hash42(vec2 p){
  vec4 p4 = fract(vec4(p.xyxy) * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  p4 += dot(p4, p4.wzxy + 33.33);
  return fract((p4.xxyz + p4.yzzw) * p4.zywx);
}
float noise12(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float v = mix(mix(hash12(i), hash12(i+vec2(1.0,0.0)), u.x),
                mix(hash12(i+vec2(0.0,1.0)), hash12(i+vec2(1.0,1.0)), u.x), u.y);
  return v * 2.0 - 1.0;
}

mat3 rotateX(float t){ float c=cos(t), s=sin(t); return mat3(1.,0.,0., 0.,c,-s, 0.,s,c); }
mat3 rotateY(float t){ float c=cos(t), s=sin(t); return mat3(c,0.,s, 0.,1.,0., -s,0.,c); }
mat3 rotateAxis(vec3 axis, float angle){
  axis = normalize(axis);
  float s = sin(angle), c = cos(angle), oc = 1.0 - c;
  return mat3(
    oc*axis.x*axis.x + c,        oc*axis.x*axis.y - axis.z*s, oc*axis.z*axis.x + axis.y*s,
    oc*axis.x*axis.y + axis.z*s, oc*axis.y*axis.y + c,        oc*axis.y*axis.z - axis.x*s,
    oc*axis.z*axis.x - axis.y*s, oc*axis.y*axis.z + axis.x*s, oc*axis.z*axis.z + c);
}

// ---- heightmap + density lookup (replaces the demo's procedural terrainHeight) ----
uniform sampler2D uHeightMap;
uniform sampler2D uDensityMap;
uniform vec4 uMapRect;  // x=originX, y=originZ, z=worldSizeX, w=worldSizeZ (full span of height grid)
uniform vec2 uMapTexel; // 1/gridSize, 1/gridSize

float sampleHeight(vec2 xz){
  vec2 uv = (xz - uMapRect.xy) / uMapRect.zw;
  uv = clamp(uv, vec2(0.001), vec2(0.999));
  return texture2D(uHeightMap, uv).r;
}
float sampleDensity(vec2 xz){
  vec2 uv = (xz - uMapRect.xy) / uMapRect.zw;
  uv = clamp(uv, vec2(0.001), vec2(0.999));
  return texture2D(uDensityMap, uv).r;
}
`;

export const SKY = `
uniform vec3 uSunDir;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyZenith;
uniform vec3 uSunColour;
uniform vec3 uSunGlow;
uniform vec3 uGroundColour;
uniform float uSunIntensity;
uniform float uHaze;
uniform float uExposure;

vec3 skyColour(vec3 viewDir){
  float t = linearstep(-0.05, 1.0, viewDir.y);
  vec3 grad = mix(uSkyZenith, uSkyHorizon, exp(-sqrt(t) * 2.0));
  float mu = 1.0 - saturate(dot(viewDir, uSunDir));
  vec3 c = grad + uSunGlow * saturate(exp(-sqrt(mu) * 9.0));
  c += uSunColour * uSunIntensity * smoothstep(0.99955, 0.99975, 1.0 - mu);
  return c;
}
vec3 applyFog(vec3 base, vec3 viewDir, float depth){
  vec3 fogSky = skyColour(-viewDir);
  float d = depth * depth;
  float ext = 0.003 * uHaze;
  float sca = ext * 0.17;
  return base * exp(-ext*ext*d) + fogSky * (1.0 - exp(-sca*sca*d));
}
vec3 tonemap(vec3 c){
  c *= uExposure;
  c = (c * (2.51*c + 0.03)) / (c * (2.43*c + 0.59) + 0.14);
  return saturate3(c);
}
vec4 present(vec3 c){ return vec4(pow(tonemap(c), vec3(1.0/2.2)), 1.0); }
`;

export const GRASS_VS = COMMON + SKY + `
uniform vec2  uGrassSize;     // width, height
uniform vec4  uGrassParams;   // segments, vertices, heightVariation, tipTaper
uniform vec2  uGrassDraw;     // detailDistance, drawDistance
uniform float uPatchSize;     // meters; used to scramble + overlap blade slots
uniform vec4  uWind;          // strength, speed, gustScale, drift
uniform vec3  uPlayerPos;
uniform vec2  uPush;          // radius, strength
uniform float uTime;
uniform float uCurve;
uniform float uRound;
uniform float uThicken;
uniform float uNormalUp;
uniform float uColourVar;
uniform vec3  uBaseColour;
uniform vec3  uTipColour;

attribute float vertIndex;

varying vec3 vNormalA;
varying vec3 vNormalB;
varying vec3 vGrassColour;
varying vec4 vGrassParams;   // heightPercent, worldY, lodBlend, xSide
varying vec3 vWorldPosition;

void main(){
  // Instanced position.xy is only a per-blade seed. Scramble by patch world
  // origin so every 10 m cell does not tile the same jittered layout (visible
  // grid). Overlap slightly past patchSize so neighbouring cells seal seams.
  vec3 patchOrigin = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]);
  vec2 slot = hash22(position.xy * 47.13 + patchOrigin.xz * 0.173);
  float place = uPatchSize * 1.18;
  vec3 grassOffset = vec3((slot.x - 0.5) * place, 0.0, (slot.y - 0.5) * place);
  vec3 bladeWorld = (modelMatrix * vec4(grassOffset, 1.0)).xyz;
  float dens = sampleDensity(bladeWorld.xz);
  // Tiny lift avoids z-fight shimmer against the terrain mesh.
  bladeWorld.y = sampleHeight(bladeWorld.xz) + 0.04;

  vec4 h = hash42(bladeWorld.xz);
  float dist = distance(cameraPosition, bladeWorld);
  float lodBlend = smoothstep(uGrassDraw.x * 0.5, uGrassDraw.x, dist);
  float fadeOut  = smoothstep(uGrassDraw.y * 0.72, uGrassDraw.y, dist);

  float randomAngle  = h.x * 2.0 * PI;
  float randomShade  = remap(h.y, 0.0, 1.0, 1.0 - 0.5 * uColourVar, 1.0);
  float randomHeight = remap(h.z, 0.0, 1.0, 1.0 - uGrassParams.z * 0.55, 1.0 + uGrassParams.z * 0.45)
                       * (1.0 - fadeOut) * dens;
  if (dens < 0.02) randomHeight = 0.0;
  float randomLean   = remap(h.w, 0.0, 1.0, 0.15, 1.0) * uCurve;

  float SEGMENTS = uGrassParams.x;
  float VERTICES = uGrassParams.y;

  float vertID = mod(vertIndex, VERTICES);
  float zSide  = -(floor(vertIndex / VERTICES) * 2.0 - 1.0);   //  1 front, -1 back
  float xSide  = mod(vertID, 2.0);                             //  0 left,   1 right
  float heightPercent = (vertID - xSide) / (SEGMENTS * 2.0);

  float totalHeight = uGrassSize.y * randomHeight;
  float widthHigh = easeOut(1.0 - heightPercent, uGrassParams.w);
  float widthLow  = 1.0 - heightPercent;
  float totalWidth = uGrassSize.x * mix(widthHigh, widthLow, lodBlend);

  float x = (xSide - 0.5) * totalWidth;
  float y = heightPercent * totalHeight;

  // ---- wind ----
  float t = uTime * uWind.y;
  float windDir   = noise12(bladeWorld.xz * uWind.w + t * 0.12) * PI;
  float windNoise = noise12(bladeWorld.xz * uWind.z + t);
  float windLean  = easeIn(remap(windNoise, -1.0, 1.0, 0.25, 1.0), 2.0) * 1.25 * uWind.x;
  vec3  windAxis  = vec3(cos(windDir), 0.0, sin(windDir));
  windLean *= heightPercent;

  // ---- orb push ----
  float dp = distance(bladeWorld.xz, uPlayerPos.xz);
  float falloff = 1.0 - smoothstep(uPush.x * 0.35, max(uPush.x, 0.001), dp);
  float pushLean = falloff * uPush.y * 1.6 * (0.3 + 0.7 * heightPercent);
  vec3 toPlayer = normalize(vec3(uPlayerPos.x - bladeWorld.x, 0.0, uPlayerPos.z - bladeWorld.z) + vec3(1e-4, 0.0, 0.0));
  vec3 pushAxis = vec3(toPlayer.z, 0.0, -toPlayer.x);

  // ---- curve ----
  float leanAnim = noise12(vec2(uTime * 0.35 * uWind.y) + bladeWorld.xz * 7.3) * 0.1;
  float curve = randomLean + leanAnim * uCurve;
  float easedHeight = mix(easeIn(heightPercent, 2.0), 1.0, lodBlend);
  float curveAmount = -curve * easedHeight;

  vec3 n1 = rotateX(curveAmount)       * vec3(0.0, heightPercent + 0.01, 0.0);
  vec3 n2 = rotateX(curveAmount * 0.9) * vec3(0.0, (heightPercent + 0.01) * 0.9, 0.0);
  vec3 ncurve = normalize(n1 - n2 + vec3(0.0, 1e-5, 0.0));

  mat3 grassMat = rotateAxis(pushAxis, pushLean) * rotateAxis(windAxis, windLean) * rotateY(randomAngle);

  vec3 faceNormal = grassMat * vec3(0.0, 0.0, 1.0) * zSide;

  vec3 bladeNormal = vec3(0.0, -ncurve.z, ncurve.y);
  vec3 nA = grassMat * (rotateY( PI * uRound * zSide) * bladeNormal) * zSide;
  vec3 nB = grassMat * (rotateY(-PI * uRound * zSide) * bladeNormal) * zSide;

  vec3 UP = vec3(0.0, 1.0, 0.0);
  float upMix = mix(0.75, 1.0, lodBlend) * uNormalUp;
  vNormalA = normalize(mix(nA, UP, upMix));
  vNormalB = normalize(mix(nB, UP, upMix));

  // ---- shape ----
  vec3 vpos = vec3(x, y, 0.0);
  vpos = rotateX(curveAmount) * vpos;
  vpos = grassMat * vpos;
  vpos += grassOffset;
  vpos.y += bladeWorld.y;

  // ---- colour ----
  vec2 hc = hash22(bladeWorld.xz + 11.7);
  vec3 baseC = uBaseColour * mix(1.0 - 0.35 * uColourVar, 1.0 + 0.35 * uColourVar, hc.x);
  vec3 tipC  = uTipColour  * mix(1.0 - 0.25 * uColourVar, 1.0 + 0.25 * uColourVar, hc.y);
  vec3 hiC = mix(baseC, tipC, easeIn(heightPercent, 4.0)) * randomShade;
  vec3 loC = mix(uBaseColour, uTipColour, heightPercent);
  vGrassColour = mix(hiC, loC, lodBlend);
  vGrassParams = vec4(heightPercent, bladeWorld.y, lodBlend, xSide);

  vec4 worldPos = modelMatrix * vec4(vpos, 1.0);
  vWorldPosition = worldPos.xyz;

  vec4 mvPosition = viewMatrix * worldPos;

  // widen blades that are nearly edge-on to the camera
  vec3 viewXZ = normalize(vec3(cameraPosition.x - bladeWorld.x, 0.0, cameraPosition.z - bladeWorld.z));
  float vdn = saturate(dot(faceNormal, viewXZ));
  float thicken = easeOut(1.0 - vdn, 4.0) * smoothstep(0.0, 0.2, vdn);
  mvPosition.x += thicken * (xSide - 0.5) * totalWidth * 0.5 * zSide * uThicken;

  gl_Position = projectionMatrix * mvPosition;
}
`;

export const GRASS_FS = COMMON + SKY + `
uniform float uAmbient;
uniform float uTranslucency;
uniform vec3  uLodColour;
uniform float uShowLod;

varying vec3 vNormalA;
varying vec3 vNormalB;
varying vec3 vGrassColour;
varying vec4 vGrassParams;
varying vec3 vWorldPosition;

void main(){
  float heightPercent = vGrassParams.x;
  float lodBlend = vGrassParams.z;
  float xSide = vGrassParams.w;

  vec3 albedo = vGrassColour;
  albedo = mix(albedo, uLodColour * (0.25 + 0.75 * heightPercent), uShowLod);

  // slight darkening toward the blade edges reads as roundness
  float middle = mix(1.0 - abs(xSide - 0.5) * 2.0, 1.0, lodBlend);
  albedo *= mix(0.82, 1.0, middle);
  albedo *= mix(0.30, 1.0, easeIn(heightPercent, 2.0));   // ambient occlusion at the roots

  vec3 n = normalize(mix(vNormalA, vNormalB, xSide));
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  vec3 lightDir = uSunDir;
  vec3 sun = uSunColour * uSunIntensity;

  // wrapped diffuse: light bleeds around thin blades
  float wrap = 0.5;
  float dotNL = saturate((dot(n, lightDir) + wrap) / (1.0 + wrap));
  vec3 col = albedo * dotNL * sun;

  // specular sheen
  vec3 hv = normalize(lightDir + viewDir);
  col += sun * pow(saturate(dot(n, hv)), 24.0) * 0.10 * (1.0 - lodBlend);

  // backscatter through the blade
  float back = saturate((dot(viewDir, -lightDir) + wrap) / (1.0 + wrap));
  col += albedo * sun * back * 0.5 * uTranslucency * (1.0 - lodBlend * 0.5);

  // sky/ground ambient
  vec3 amb = mix(uGroundColour, uSkyHorizon, saturate(n.y * 0.5 + 0.5));
  col += albedo * amb * uAmbient;

  col = applyFog(col, viewDir, distance(cameraPosition, vWorldPosition));
  gl_FragColor = present(col);
}
`;
