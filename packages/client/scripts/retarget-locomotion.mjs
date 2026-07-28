#!/usr/bin/env node
/**
 * Retarget free directional-locomotion clips (strafe/backpedal/dodge-roll)
 * from the old KayKit "Rig_Medium" animation library onto the Universal
 * (Quaternius) player skeleton, since UAL1_Standard.glb ships none of its
 * own (only forward Walk/Jog/Sprint + one generic "Roll").
 *
 * Uses three.js's SkeletonUtils.retargetClip with a hand-built bone-name map
 * between the two (structurally different -- KayKit has no fingers/clavicles,
 * one spine bone vs three) skeletons. Output is plain THREE.AnimationClip
 * JSON (not a GLB -- no scene graph needed), loaded at runtime by gltf.ts's
 * loadRetargetedClips().
 *
 * This is a stopgap for a purchased Universal-rig locomotion pack -- rerun
 * it (and extend CLIP_NAMES/BONE_MAP) if a similar free source shows up, or
 * delete it once a real pack replaces UAL1_Retargeted.json.
 *
 * Run from this directory (needs `three` resolvable, which only the client
 * package has as a dependency):
 *   cd packages/client/scripts && node retarget-locomotion.mjs
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { retargetClip } from "three/examples/jsm/utils/SkeletonUtils.js";
import { NodeIO } from "@gltf-transform/core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(CLIENT_ROOT, "public/assets/models");

const SOURCE_GLB = path.join(PUBLIC, "animations/Rig_Medium/Rig_Medium_MovementAdvanced.glb");
const TARGET_GLB = path.join(PUBLIC, "modular/base/Regular_Male.glb");
const OUT_JSON = path.join(PUBLIC, "animations/UAL1_Retargeted.json");

const CLIP_NAMES = [
  "Running_Strafe_Left",
  "Running_Strafe_Right",
  "Walking_Backwards",
  "Dodge_Forward",
  "Dodge_Backward",
  "Dodge_Left",
  "Dodge_Right",
];

/** TARGET (Universal) bone name -> SOURCE (KayKit) bone name. KayKit has no
 *  clavicle/neck bones or fingers -- those are simply left unmapped and stay
 *  at rest pose, a minor cosmetic loss (no shoulder/neck secondary motion)
 *  that doesn't affect the overall silhouette of a locomotion cycle. GLTFLoader
 *  strips the dots from KayKit's "upperarm.l"-style names on load, hence
 *  "upperarml" here. */
const BONE_MAP = {
  root: "root",
  pelvis: "hips",
  spine_01: "spine",
  spine_02: "spine",
  spine_03: "chest",
  Head: "head",
  upperarm_l: "upperarml",
  lowerarm_l: "lowerarml",
  hand_l: "handl",
  upperarm_r: "upperarmr",
  lowerarm_r: "lowerarmr",
  hand_r: "handr",
  thigh_l: "upperlegl",
  calf_l: "lowerlegl",
  foot_l: "footl",
  ball_l: "toesl",
  thigh_r: "upperlegr",
  calf_r: "lowerlegr",
  foot_r: "footr",
  ball_r: "toesr",
};

function loadGLTF(file) {
  return new Promise((resolve, reject) => {
    const loader = new GLTFLoader();
    const buf = fs.readFileSync(file);
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    loader.parse(arrayBuffer, "", resolve, reject);
  });
}

// ---- Source skeleton + clips: plain GLTFLoader works fine (this library
// file has no meshes/textures to trip over the lack of a DOM `Image`). ----
const srcGltf = await loadGLTF(SOURCE_GLB);
const srcScene = srcGltf.scene;
srcScene.updateMatrixWorld(true);
const srcBones = [];
srcScene.traverse((o) => {
  if (o.isBone) srcBones.push(o);
});
srcScene.skeleton = new THREE.Skeleton(srcBones);

// ---- Target skeleton: built by hand from gltf-transform's bind-pose local
// transforms, since Regular_Male.glb's baked textures make GLTFLoader throw
// ("self is not defined") outside a browser -- we only need bone TRS, not
// any of the mesh/material data, so this sidesteps the whole problem. ----
const io = new NodeIO();
const doc = await io.read(TARGET_GLB);
const root = doc.getRoot();

function buildBone(gltfNode) {
  const b = new THREE.Bone();
  b.name = gltfNode.getName();
  const [tx, ty, tz] = gltfNode.getTranslation();
  const [rx, ry, rz, rw] = gltfNode.getRotation();
  const [sx, sy, sz] = gltfNode.getScale();
  b.position.set(tx, ty, tz);
  b.quaternion.set(rx, ry, rz, rw);
  b.scale.set(sx, sy, sz);
  for (const child of gltfNode.listChildren()) b.add(buildBone(child));
  return b;
}

let armatureNode = null;
for (const scene of root.listScenes()) {
  armatureNode = scene.listChildren().find((n) => n.getName() === "Armature") ?? armatureNode;
}
if (!armatureNode) throw new Error(`"Armature" node not found in ${TARGET_GLB}`);

const armatureBone = buildBone(armatureNode);
const targetBones = [];
armatureBone.traverse((o) => {
  if (o.isBone) targetBones.push(o);
});

const targetRoot = new THREE.Object3D();
targetRoot.name = "RetargetTarget";
targetRoot.add(armatureBone);
targetRoot.updateMatrixWorld(true);
targetRoot.skeleton = new THREE.Skeleton(targetBones);

// ---- Auto-scale root motion (hip translation) by leg-chain-length ratio,
// so strides/roll distances match this character's proportions instead of
// KayKit's noticeably shorter legs. ----
function chainLength(bones, names) {
  return names.reduce((len, n) => {
    const b = bones.find((x) => x.name === n);
    if (!b) throw new Error(`missing bone ${n}`);
    return len + b.position.length();
  }, 0);
}
const scale =
  chainLength(targetBones, ["thigh_l", "calf_l", "foot_l"]) /
  chainLength(srcBones, ["upperlegl", "lowerlegl", "footl"]);
console.log("root-motion scale (target/source leg length):", scale.toFixed(3));

// ---- Retarget each clip, then rename tracks from the SkinnedMesh-relative
// ".bones[name].prop" format retargetClip emits to the plain "name.prop"
// node-path format every other clip in this codebase uses (AnimatedModel's
// mixer is rooted at the plain scene Object3D, not a SkinnedMesh). ----
const outClips = [];
for (const clipName of CLIP_NAMES) {
  const clip = srcGltf.animations.find((a) => a.name === clipName);
  if (!clip) {
    console.warn("MISSING source clip", clipName);
    continue;
  }
  const retargeted = retargetClip(targetRoot, srcScene, clip, {
    names: BONE_MAP,
    hip: "hips",
    scale,
    preserveBoneMatrix: true,
    preserveBonePositions: true,
  });
  for (const track of retargeted.tracks) {
    track.name = track.name.replace(/^\.bones\[([^\]]+)\]\./, "$1.");
  }
  retargeted.name = clipName;
  outClips.push(retargeted);
  console.log("retargeted", clipName, retargeted.tracks.length, "tracks,", retargeted.duration.toFixed(2), "s");
}

fs.writeFileSync(OUT_JSON, JSON.stringify(outClips.map((c) => c.toJSON())));
console.log("Wrote", path.relative(CLIENT_ROOT, OUT_JSON), "with", outClips.length, "clips");
