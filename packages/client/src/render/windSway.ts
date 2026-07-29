import * as THREE from "three";
import type { RegionWind } from "@rustcraft/shared";

/** Applies a RegionWind setting to any {uWindDir, uWindStrength} uniform
 *  pair -- shared by grassField.ts and RegionInteriorRenderer/
 *  RegionEditorScene so grass and tree sway both scale off the same
 *  direction/strength dial, each against its own base amplitude. */
export function applyRegionWind(
  target: { uWindDir: THREE.IUniform<THREE.Vector2>; uWindStrength: THREE.IUniform<number> },
  wind: RegionWind,
  baseStrength: number,
): void {
  const rad = (wind.direction * Math.PI) / 180;
  target.uWindDir.value.set(Math.cos(rad), Math.sin(rad));
  target.uWindStrength.value = baseStrength * wind.strength;
}

/** Tree wind-sway uniforms, shared across every foliage material patched via
 *  applyTreeWindSway() so the whole region's trees respond to one direction
 *  and strength in lockstep -- see grassBlade.ts's uWindDir/uWindStrength
 *  for the equivalent on grass blades. */
export interface TreeWindUniforms {
  uTime: THREE.IUniform<number>;
  uWindDir: THREE.IUniform<THREE.Vector2>;
  uWindStrength: THREE.IUniform<number>;
}

export function createTreeWindUniforms(): TreeWindUniforms {
  return {
    uTime: { value: 0 },
    uWindDir: { value: new THREE.Vector2(1, 0) },
    uWindStrength: { value: 0.15 },
  };
}

const TREE_WIND_UNIFORMS_GLSL = /* glsl */ `
  uniform float uTime;
  uniform vec2  uWindDir;
  uniform float uWindStrength;
  uniform float uMinY;
  uniform float uMaxY;
`;

const TREE_WIND_VERTEX = /* glsl */ `
  #include <begin_vertex>

  float _bendT = clamp((position.y - uMinY) / max(uMaxY - uMinY, 0.001), 0.0, 1.0);
  float _bend  = _bendT * _bendT;
  vec3  _wPos  = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float _phase = dot(_wPos.xz, vec2(0.13, 0.07));
  float _sway  = sin(uTime * 1.1 + _phase) * uWindStrength * _bend;
  transformed.x += uWindDir.x * _sway;
  transformed.z += uWindDir.y * _sway;
`;

/** Clones `material` and injects a wind-sway vertex displacement that bends
 *  around the mesh's own local Y bounds -- the trunk end (near minY) stays
 *  anchored, the canopy end (near maxY) sways most. Tree GLTFs have no baked
 *  "bend weight" vertex data, so this approximates it from each mesh's own
 *  geometry bounding box instead of a proper per-vertex weight.
 *
 *  Only valid on an InstancedMesh (reads instanceMatrix for the per-instance
 *  world-position wind phase, so neighboring trees don't sway in perfect
 *  unison) -- this codebase's foliage is always instanced (see
 *  RegionInteriorRenderer.instanceModel), so that's not a real constraint
 *  today. The region editor's own live preview places foliage as individual
 *  (non-instanced) objects instead, so it does not use this -- trees only
 *  sway in actual gameplay, not the editor viewport. */
export function applyTreeWindSway(material: THREE.Material, uniforms: TreeWindUniforms, minY: number, maxY: number): THREE.Material {
  const cloned = material.clone();
  cloned.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindDir = uniforms.uWindDir;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.uniforms.uMinY = { value: minY };
    shader.uniforms.uMaxY = { value: maxY };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${TREE_WIND_UNIFORMS_GLSL}`)
      .replace("#include <begin_vertex>", TREE_WIND_VERTEX);
  };
  return cloned;
}
