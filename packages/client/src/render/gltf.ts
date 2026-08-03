import * as THREE from "three";
import { type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import { ITEMS, type CharacterAppearance, type CharacterGender, type HairStyleId } from "@rustcraft/shared";
import {
  UNIVERSAL_ANIMATION_LIBRARY,
  UNIVERSAL_ANIMATION_LIBRARY_2,
  isUniversalCharacterUrl,
  hairStyleUrl,
  facialHairUrl,
  eyebrowsUrl,
  HAIR_AUTHORED_GENDER,
  MALE_HEAD_SIZE_COMPENSATION,
  GENDER_MODEL_URLS,
  type ModularFit,
} from "./classModels";
import { createSharedGltfLoader } from "./sharedGltf";

const loader = createSharedGltfLoader();
const cache = new Map<string, Promise<GLTF>>();

/** Legacy free-tier directional locomotion for the Universal rig. UAL2 now
 *  ships native Walk_L/R/Bwd + dash clips; these retargeted KayKit clips stay
 *  as a fallback for older clients / missing UAL2. */
const UAL_RETARGETED_CLIPS = "/assets/models/animations/UAL1_Retargeted.json";
let retargetedClipsPromise: Promise<THREE.AnimationClip[]> | null = null;
function loadRetargetedClips(): Promise<THREE.AnimationClip[]> {
  if (!retargetedClipsPromise) {
    retargetedClipsPromise = fetch(UAL_RETARGETED_CLIPS)
      .then((r) => r.json())
      .then((entries: THREE.AnimationClipJSON[]) => entries.map((e) => THREE.AnimationClip.parse(e)))
      .catch(() => []);
  }
  return retargetedClipsPromise;
}

/** Cleaned AnimationClips shared across all AnimatedModel instances so each
 *  character doesn't rebuild ~30k track channels from UAL. */
const cleanedClipCache = new Map<string, THREE.AnimationClip>();

function cleanAnimationClip(clip: THREE.AnimationClip): THREE.AnimationClip {
  const cached = cleanedClipCache.get(clip.name);
  if (cached) return cached;
  const cleanTracks = clip.tracks.map((t) => {
    let name = t.name;
    if (name.startsWith("Character_Armature/")) {
      name = name.replace(/^Character_Armature\//, "");
    } else if (name.startsWith("Root/")) {
      name = name.replace(/^Root\//, "");
    }
    if (name !== t.name) {
      const clone = t.clone();
      clone.name = name;
      return clone;
    }
    return t;
  });
  const cleaned = new THREE.AnimationClip(clip.name, clip.duration, cleanTracks);
  cleanedClipCache.set(clip.name, cleaned);
  return cleaned;
}

/** Only bind clips this rig's AnimSpec (plus weapon overrides) actually
 *  references — UAL2 alone is 134 clips; binding all of them per character
 *  was the main CPU hitch when many players / previews loaded. */
function clipNameAllowlist(spec: AnimSpec): Set<string> {
  const names = new Set<string>();
  for (const value of Object.values(spec)) {
    if (!Array.isArray(value)) continue;
    for (const n of value) names.add(n);
  }
  names.add("Swim_Up_Loop");
  names.add("Swim_Down_Loop");
  for (const item of Object.values(ITEMS)) {
    for (const n of item.attackAnim ?? []) names.add(n);
    for (const n of item.castAnim ?? []) names.add(n);
  }
  return names;
}

const textureLoader = new THREE.TextureLoader();
const bodyTexture = textureLoader.load("/assets/models/bundled/textures/Master_baked_body.png");
bodyTexture.colorSpace = THREE.SRGBColorSpace;
bodyTexture.flipY = false;

const objectsTexture = textureLoader.load("/assets/models/bundled/textures/Master_baked_objects.png");
objectsTexture.colorSpace = THREE.SRGBColorSpace;
objectsTexture.flipY = false;

export function applyMasterTextures(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (mesh.geometry) {
        if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      }
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => {
          const std = m as THREE.MeshStandardMaterial;
          std.side = THREE.FrontSide;
          std.shadowSide = THREE.FrontSide;
          std.transparent = false;
          std.depthWrite = true;
          std.depthTest = true;
          const matName = (std.name || "").toLowerCase();
          const isBody = matName.includes("body") || matName.includes("skin") || matName.includes("face");
          const targetTex = isBody ? bodyTexture : objectsTexture;
          if (!std.map || std.map !== targetTex) {
            std.map = targetTex;
          }
          std.needsUpdate = true;
        });
      }
    }
  });
}

export const PLAYER_MODELS = [
  "/assets/models/bundled/base/BaseAnimatedCharacter.glb",
];
export const WOLF_MODEL = "/assets/models/Wolf.glb";

const SKELETON_MODELS: Record<string, string> = {
  skeleton_warrior: "/assets/models/Skeleton_Warrior.glb",
  skeleton_minion: "/assets/models/Skeleton_Minion.glb",
  skeleton_rogue: "/assets/models/Skeleton_Rogue.glb",
  skeleton_mage: "/assets/models/Skeleton_Mage.glb",
};

const CREATURES_DIR = "/assets/models/creatures";

/** Quadruped wildlife rig (alpaca, bull, fox, stag). */
const QUADRUPED_ANIMS: AnimSpec = {
  idle: ["Idle"],
  walk: ["Walk"],
  run: ["Gallop"],
  attack: ["Attack_Kick", "Attack_Headbutt"],
  gather: ["Eating"],
  cast: ["Idle"],
  dead: ["Death"],
};

/** Flying/hovering rig (demon, dragon, ghost, ooze, golem, tribal shaman). */
const FLYER_ANIMS: AnimSpec = {
  idle: ["Flying_Idle"],
  walk: ["Flying_Idle"],
  run: ["Fast_Flying"],
  attack: ["Punch", "Headbutt"],
  gather: ["Flying_Idle"],
  cast: ["Flying_Idle"],
  dead: ["Death"],
};

/** Biped raider rig (orc, yeti, demon-alt, frog). */
const BIPED_ANIMS: AnimSpec = {
  idle: ["Idle"],
  walk: ["Walk"],
  run: ["Run"],
  attack: ["Punch"],
  gather: ["Idle"],
  cast: ["Idle"],
  dead: ["Death"],
};

/** Simpler biped rig, no dedicated attack clip (goblin, giant). */
const SIMPLE_ANIMS: AnimSpec = {
  idle: ["Idle"],
  walk: ["Walk"],
  run: ["Run"],
  attack: ["Attack"],
  gather: ["Idle"],
  cast: ["Idle"],
  dead: ["Death"],
};

const ORCENEMY_ANIMS: AnimSpec = {
  idle: ["Idle"],
  walk: ["Walk"],
  run: ["Walk"],
  attack: ["Bite_Front"],
  gather: ["Idle"],
  cast: ["Idle"],
  dead: ["Death"],
};

const SPIDER_ANIMS: AnimSpec = {
  idle: ["Spider_Idle"],
  walk: ["Spider_Walk"],
  run: ["Spider_Walk"],
  attack: ["Spider_Attack"],
  gather: ["Spider_Idle"],
  cast: ["Spider_Idle"],
  dead: ["Spider_Death"],
};

const VELOCIRAPTOR_ANIMS: AnimSpec = {
  idle: ["Velociraptor_Idle"],
  walk: ["Velociraptor_Walk"],
  run: ["Velociraptor_Run"],
  attack: ["Velociraptor_Attack"],
  gather: ["Velociraptor_Idle"],
  cast: ["Velociraptor_Idle"],
  dead: ["Velociraptor_Death"],
};

const CREATURE_MODELS: Record<string, { url: string; anims: AnimSpec }> = {
  fox: { url: `${CREATURES_DIR}/fox.glb`, anims: QUADRUPED_ANIMS },
  stag: { url: `${CREATURES_DIR}/stag.glb`, anims: QUADRUPED_ANIMS },
  alpaca: { url: `${CREATURES_DIR}/alpaca.glb`, anims: QUADRUPED_ANIMS },
  bull: { url: `${CREATURES_DIR}/bull.glb`, anims: QUADRUPED_ANIMS },
  spider: { url: `${CREATURES_DIR}/spider.glb`, anims: SPIDER_ANIMS },
  velociraptor: { url: `${CREATURES_DIR}/velociraptor.glb`, anims: VELOCIRAPTOR_ANIMS },
  goblin: { url: `${CREATURES_DIR}/goblin.glb`, anims: SIMPLE_ANIMS },
  giant: { url: `${CREATURES_DIR}/giant.glb`, anims: SIMPLE_ANIMS },
  orc: { url: `${CREATURES_DIR}/orc.glb`, anims: BIPED_ANIMS },
  orcenemy: { url: `${CREATURES_DIR}/orcenemy.glb`, anims: ORCENEMY_ANIMS },
  yeti: { url: `${CREATURES_DIR}/yeti.glb`, anims: SIMPLE_ANIMS },
  yetialt: { url: `${CREATURES_DIR}/yetialt.glb`, anims: BIPED_ANIMS },
  frog: { url: `${CREATURES_DIR}/frog.glb`, anims: BIPED_ANIMS },
  demonalt: { url: `${CREATURES_DIR}/demonalt.glb`, anims: BIPED_ANIMS },
  demon: { url: `${CREATURES_DIR}/demon.glb`, anims: FLYER_ANIMS },
  dragon: { url: `${CREATURES_DIR}/dragonevolved.glb`, anims: FLYER_ANIMS },
  ghost: { url: `${CREATURES_DIR}/ghost.glb`, anims: FLYER_ANIMS },
  ooze: { url: `${CREATURES_DIR}/glubevolved.glb`, anims: FLYER_ANIMS },
  golem: { url: `${CREATURES_DIR}/golelingevolved.glb`, anims: FLYER_ANIMS },
  tribal: { url: `${CREATURES_DIR}/tribal.glb`, anims: FLYER_ANIMS },
};

/** Resolve a mob-render `model` key to a GLB url + animation set. */
export function mobModelSpec(model: string): { url: string; anims: AnimSpec } {
  if (model === "wolf") return { url: WOLF_MODEL, anims: WOLF_ANIMS };
  const creature = CREATURE_MODELS[model];
  if (creature) return creature;
  const url = SKELETON_MODELS[model] ?? SKELETON_MODELS.skeleton_minion!;
  return { url, anims: PLAYER_ANIMS };
}

export function load(url: string): Promise<GLTF> {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url);
    cache.set(url, p);
  }
  return p;
}

const headBindWorldCache = new Map<CharacterGender, Promise<THREE.Matrix4 | null>>();

/** Bind-pose (rest pose) WORLD transform of the base rig's "Head" bone for a
 *  given gender, read straight from the raw (unposed, unscaled) GLTF's own
 *  skeleton data -- not from any currently-loaded/animated character
 *  instance, so it's stable regardless of what pose or height-normalization
 *  scale a live AnimatedModel happens to be using. Used to compute the exact
 *  correction for a hairstyle piece rigged against one gender's skeleton
 *  when it's worn on the other (see computeHairFit) -- a real bind-pose
 *  delta rather than a hand-tuned guess, since a plain position/rotation
 *  nudge can't fix a mesh that's genuinely deforming wrong. */
function loadHeadBindWorld(gender: CharacterGender): Promise<THREE.Matrix4 | null> {
  let p = headBindWorldCache.get(gender);
  if (!p) {
    p = load(GENDER_MODEL_URLS[gender]).then((gltf) => {
      let result: THREE.Matrix4 | null = null;
      gltf.scene.traverse((o) => {
        if (result) return;
        const sm = o as THREE.SkinnedMesh;
        if (!sm.isSkinnedMesh || !sm.skeleton) return;
        const idx = sm.skeleton.bones.findIndex((b) => b.name === "Head");
        if (idx < 0) return;
        result = sm.skeleton.boneInverses[idx]!.clone().invert();
      });
      return result;
    });
    headBindWorldCache.set(gender, p);
  }
  return p;
}

/** Correction for a hairstyle piece rigged against one gender's skeleton but
 *  worn on the other -- the exact relative transform between the two
 *  genders' Head-bone bind poses, computed once and cached (see
 *  loadHeadBindWorld), not an empirically-guessed offset. Returns null for
 *  styles worn on their own authored gender (no correction needed). */
async function computeHairFit(hairStyle: HairStyleId, gender: CharacterGender): Promise<ModularFit | null> {
  const authoredGender = HAIR_AUTHORED_GENDER[hairStyle];
  if (!authoredGender || authoredGender === gender) return null;
  const [sourceWorld, targetWorld] = await Promise.all([
    loadHeadBindWorld(authoredGender),
    loadHeadBindWorld(gender),
  ]);
  if (!sourceWorld || !targetWorld) return null;
  const delta = new THREE.Matrix4().multiplyMatrices(targetWorld, sourceWorld.clone().invert());
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  delta.decompose(position, quaternion, scale);
  // The Head bone's own bind transform doesn't capture a pure head-*mesh*
  // size difference (the bone's bind scale can be identical between genders
  // even though the modeled head is visibly bigger) -- layer that on top.
  const sizeCompensation = gender === "male" && authoredGender === "female" ? MALE_HEAD_SIZE_COMPENSATION : 1;
  return {
    position: [position.x, position.y, position.z],
    quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
    scale: scale.x * sizeCompensation,
  };
}

type RigSize = "medium" | "large";

/** KayKit's newer character exports (Barbarian/Knight/Mage/Ranger/Rogue/
 *  Druid/Engineer/Rogue_Hooded/Barbarian_Large) ship with zero baked-in
 *  animation clips -- clips instead live in a handful of shared, per-rig-size
 *  library files meant to be applied directly onto any character built from
 *  the same base skeleton (no bone-remapping/retargeting needed, since every
 *  character sharing a rig size shares that rig's exact bone names). */
const ANIMATION_LIBRARY_DIR = "/assets/models/animations";
const ANIMATION_LIBRARY_FILES: Record<RigSize, string[]> = {
  medium: ["General", "MovementBasic", "MovementAdvanced", "CombatMelee", "CombatRanged", "Simulation"].map(
    (n) => `${ANIMATION_LIBRARY_DIR}/Rig_Medium/Rig_Medium_${n}.glb`,
  ),
  large: ["General", "MovementBasic", "MovementAdvanced", "CombatMelee", "Simulation"].map(
    (n) => `${ANIMATION_LIBRARY_DIR}/Rig_Large/Rig_Large_${n}.glb`,
  ),
};

const animLibraryCache = new Map<RigSize, Promise<THREE.AnimationClip[]>>();

function loadAnimationLibrary(rig: RigSize): Promise<THREE.AnimationClip[]> {
  let p = animLibraryCache.get(rig);
  if (!p) {
    p = Promise.all(ANIMATION_LIBRARY_FILES[rig].map((url) => load(url))).then((gltfs) =>
      gltfs.flatMap((g) => g.animations),
    );
    animLibraryCache.set(rig, p);
  }
  return p;
}

export interface AnimSpec {
  /** Ordered fallbacks; first clip that exists wins. */
  idle: string[];
  walk: string[];
  run: string[];
  attack: string[];
  gather: string[];
  cast: string[];
  dead: string[];
  /** Optional, rig-dependent: gracefully fall back (see ANIM_FALLBACK) when absent. */
  strafeLeft?: string[];
  strafeRight?: string[];
  walkBack?: string[];
  /** Diagonal locomotion (UAL2 Walk_Fwd/Bwd_L/R). */
  walkFwdLeft?: string[];
  walkFwdRight?: string[];
  walkBackLeft?: string[];
  walkBackRight?: string[];
  hit?: string[];
  jump?: string[];
  block?: string[];
  sit?: string[];
  cheer?: string[];
  dodgeForward?: string[];
  dodgeBackward?: string[];
  dodgeLeft?: string[];
  dodgeRight?: string[];
  /** Surface tread / idle swim. */
  swim?: string[];
  /** Forward (or active) swim stroke. */
  swimFwd?: string[];
  /** Ascend / swim-up stroke (derived from Swim_Fwd when absent). */
  swimUp?: string[];
  /** Dive / swim-down stroke (derived from Swim_Fwd when absent). */
  swimDown?: string[];
}

export const PLAYER_ANIMS: AnimSpec = {
  idle: ["Idle_Loop", "Idle_Talking_Loop", "Sword_Idle"],
  walk: ["Walk_Fwd_Loop", "Walk_Loop", "Walk_Formal_Loop"],
  run: ["Sprint_Loop", "Jog_Fwd_Loop"],
  attack: ["Sword_Attack", "Sword_Light_A", "Melee_Combo", "Punch_Jab", "Punch_Cross"],
  gather: ["PickUp_Table", "Interact", "Farm_Harvest", "Consume"],
  cast: ["Spell_Simple_Shoot", "Spell_Simple_Idle_Loop", "Spell_Simple_Enter"],
  dead: ["Death01"],
  // UAL2 native 8-dir walk + legacy retargeted names as fallback.
  strafeLeft: ["Walk_L_Loop", "Running_Strafe_Left", "Left Strafe", "Walk_Loop"],
  strafeRight: ["Walk_R_Loop", "Running_Strafe_Right", "Right Strafe", "Walk_Loop"],
  walkBack: ["Walk_Bwd_Loop", "Walking_Backwards", "Running Backward", "Walk_Loop"],
  walkFwdLeft: ["Walk_Fwd_L_Loop", "Walk_L_Loop", "Walk_Fwd_Loop", "Walk_Loop"],
  walkFwdRight: ["Walk_Fwd_R_Loop", "Walk_R_Loop", "Walk_Fwd_Loop", "Walk_Loop"],
  walkBackLeft: ["Walk_Bwd_L_Loop", "Walk_Bwd_Loop", "Walk_L_Loop", "Walk_Loop"],
  walkBackRight: ["Walk_Bwd_R_Loop", "Walk_Bwd_Loop", "Walk_R_Loop", "Walk_Loop"],
  hit: ["Hit_Chest", "Hit_Head", "Hit_Knockback"],
  jump: ["Jump_Start", "NinjaJump_Start", "Jump_Loop", "Jump_Land"],
  block: ["Sword_Block", "Idle_Shield_Loop", "Sword_Idle", "Idle_Loop"],
  sit: ["Sitting_Idle_Loop", "Sitting_Enter"],
  cheer: ["Dance_Loop", "Idle_Talking_Loop"],
  // Prefer full UAL clips — retargeted Dodge_* are sparse (~21 tracks) and
  // look like a no-op on the Universal rig. Forward/back = Roll; sides =
  // WallRun_Jump (the pack's directional dive/jump).
  dodgeForward: ["Roll", "Sword_Dash", "SafetyVault"],
  // Order overridden at play-time: 50% Roll, 50% JogToFlip (backflip).
  dodgeBackward: ["Roll", "JogToFlip", "Shield_Dash", "Sword_Dash"],
  dodgeLeft: ["WallRun_Jump_L", "Turn180_L", "Roll", "Sword_Dash"],
  dodgeRight: ["WallRun_Jump_R", "Turn180_R", "Roll", "Sword_Dash"],
  // UAL1 swim clips (UAL2 has no swim set). Up/down loops are derived at load.
  swim: ["Swim_Idle_Loop", "Swim_Loop", "Swimming", "Treading_Water", "Walk_Loop"],
  swimFwd: ["Swim_Fwd_Loop", "Swim_Idle_Loop", "Walk_Fwd_Loop", "Walk_Loop"],
  swimUp: ["Swim_Up_Loop", "Swim_Fwd_Loop", "Swim_Idle_Loop"],
  swimDown: ["Swim_Down_Loop", "Swim_Fwd_Loop", "Swim_Idle_Loop"],
};

export const WOLF_ANIMS: AnimSpec = {
  idle: ["Idle"],
  walk: ["Walk"],
  run: ["Gallop"],
  attack: ["Attack"],
  gather: ["Eating"],
  cast: ["Idle"],
  dead: ["Death"],
};

export type LogicalAnim = keyof AnimSpec;

/** When a rig's AnimSpec doesn't define one of the optional directional/reaction
 *  logicals, degrade to the nearest clip every rig is guaranteed to have. */
const ANIM_FALLBACK: Partial<Record<LogicalAnim, LogicalAnim>> = {
  strafeLeft: "walk",
  strafeRight: "walk",
  walkBack: "walk",
  walkFwdLeft: "walk",
  walkFwdRight: "walk",
  walkBackLeft: "walkBack",
  walkBackRight: "walkBack",
  dodgeForward: "jump",
  dodgeBackward: "jump",
  dodgeLeft: "jump",
  dodgeRight: "jump",
  jump: "idle",
  swim: "walk",
  swimFwd: "swim",
  swimUp: "swimFwd",
  swimDown: "swimFwd",
};

/**
 * UAL only ships flat swim strokes — derive angled variants by pitching
 * root/pelvis (negative pitch = nose up / ascend, positive = nose down / dive).
 */
function deriveSwimPitchedClip(
  fwd: THREE.AnimationClip,
  name: string,
  rootPitch: number,
): THREE.AnimationClip {
  const pitch = new THREE.Quaternion().setFromEuler(new THREE.Euler(rootPitch, 0, 0, "XYZ"));
  const pelvisPitch = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rootPitch * 0.22, 0, 0, "XYZ"),
  );
  const q = new THREE.Quaternion();
  const out = new THREE.Quaternion();
  const tracks = fwd.tracks.map((track) => {
    const isRootQuat = track.name === "root.quaternion";
    const isPelvisQuat = track.name === "pelvis.quaternion";
    if (!isRootQuat && !isPelvisQuat) return track;
    const cloned = track.clone();
    const values = cloned.values;
    const extra = isPelvisQuat ? pelvisPitch : pitch;
    for (let i = 0; i < values.length; i += 4) {
      q.set(values[i]!, values[i + 1]!, values[i + 2]!, values[i + 3]!);
      out.copy(q).multiply(extra);
      values[i] = out.x;
      values[i + 1] = out.y;
      values[i + 2] = out.z;
      values[i + 3] = out.w;
    }
    return cloned;
  });
  return new THREE.AnimationClip(name, fwd.duration, tracks);
}

/** Config for bone-parenting a weapon/armor prop -- shared shape used by
 *  `setWeaponProp`/`setArmorProp` (see items.ts's `weaponProp`/`armorProp`
 *  for the calibration knobs available per item). */
export type PropAttachConfig = {
  url: string;
  bone: string;
  scale?: number;
  rotation?: [number, number, number];
  /** Local-space offset ([x,y,z], same units as the rig) applied *after*
   *  scale/rotation, e.g. to slide the prop's grip point into the fist
   *  instead of sitting exactly at the hand bone's origin. */
  position?: [number, number, number];
};

/** Stable identity for a weapon/armor prop attach request, covering every
 *  field that affects the rendered result (not just the URL). Used to dedupe
 *  redundant `setWeaponProp`/`setArmorProp` calls without also swallowing a
 *  scale/rotation/position recalibration of an item that happens to reuse
 *  the same GLB -- keying on URL alone previously made rotation/scale fixes
 *  silently no-op whenever the same URL was already attached. */
function propKey(prop: PropAttachConfig | null): string | null {
  if (!prop) return null;
  const rot = prop.rotation ? prop.rotation.join(",") : "";
  const pos = prop.position ? prop.position.join(",") : "";
  return `${prop.url}|${prop.bone}|${prop.scale ?? ""}|${rot}|${pos}`;
}

/** Same reasoning as propKey -- a modular slot's identity must include its
 *  fit offset, not just its URL, or switching gender while keeping the same
 *  hairstyle selected (same URL, different fit) would silently no-op and
 *  leave the stale offset from the previous gender applied. */
function modularSlotKey(url: string, fit: ModularFit | undefined): string {
  const rot = fit?.rotation ? fit.rotation.join(",") : "";
  const pos = fit?.position ? fit.position.join(",") : "";
  const quat = fit?.quaternion ? fit.quaternion.join(",") : "";
  return `${url}|${fit?.scale ?? ""}|${rot}|${pos}|${quat}`;
}

/** Modular slots tinted by outfitHue vs. hairColor -- see applyAppearance/applyModularSlot. */
const OUTFIT_TINT_SLOTS = ["head", "chest", "arms", "legs", "feet"];
const HAIR_TINT_SLOTS = ["hair", "facialHair", "eyebrows"];

/**
 * A loaded, animated character instance. Height-normalized so gameplay code
 * can treat every model the same; origin at the feet.
 */
export class AnimatedModel {
  readonly group = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private currentLogical: LogicalAnim | null = null;
  private spec: AnimSpec;
  private oneShotUntil = 0;
  private innerScene: THREE.Object3D | null = null;
  private footY = 0;
  private liftY = 0;
  /** Node-visibility calls queued until loadFrom finishes, keyed by channel
   *  ("weapon"/"head"/"chest") so independent callers each get their own
   *  slot to wait in instead of clobbering one another. */
  private pendingNodeVisibility = new Map<string, { visible: string[]; all: string[] }>();
  /** Per-channel ("chest"/"arms"/"legs") gear-tint calls queued until
   *  loadFrom finishes, mirroring pendingNodeVisibility. */
  private pendingGearTint = new Map<string, { nodes: string[]; color: number | null }>();
  private attachedProp: THREE.Object3D | null = null;
  /** Identifies *everything* about the currently-attached prop (url, bone,
   *  scale, rotation) -- not just the URL. Two item defs can legitimately
   *  point at the same GLB (e.g. while iterating on a shared placeholder
   *  asset) with different `scale`/`rotation` calibration, and a dedup keyed
   *  on URL alone would silently ignore that recalibration whenever the
   *  attach call race for "already attached this url, nothing to do" fired
   *  -- which is exactly what made weapon-rotation fixes appear to do
   *  nothing without a full page reload. */
  private attachedPropUrl: string | null = null;
  private pendingProp: PropAttachConfig | null = null;
  /** Rigid (unskinned) chest-armor piece bone-parented like a weapon prop --
   *  see setArmorProp. Tracked separately from attachedProp/pendingProp so a
   *  held weapon and a worn breastplate never fight over the same slot. */
  private attachedArmorProp: THREE.Object3D | null = null;
  private attachedArmorPropUrl: string | null = null;
  private pendingArmorProp: PropAttachConfig | null = null;
  private characterSkeleton: THREE.Skeleton | null = null;
  private pendingModularSlots = new Map<
    string,
    { url: string | null; coversHands?: boolean; coversHead?: boolean; fit?: ModularFit; tint?: number | null }
  >();
  private equippedModularSlots = new Map<
    string,
    { url: string; key: string; obj: THREE.Object3D; coversHands?: boolean; coversHead?: boolean; tint?: number | null }
  >();
  /** Multiplier tints reapplied to their respective slots' meshes whenever
   *  those meshes change (new hairstyle, new armor piece) -- see
   *  applyAppearance/applyModularSlot. Null = no tint (render at authored color). */
  private hairTint: number | null = null;
  private outfitTint: number | null = null;
  /** Used to pick walk vs jog clips for strafe/backpedal (UAL has no lateral clips). */
  private locomotionSpeed = 0;
  private locomotionRunThreshold = 3.5;

  setLocomotionSpeed(speed: number, runThreshold = 3.5): void {
    this.locomotionSpeed = speed;
    this.locomotionRunThreshold = runThreshold;
  }

  /** Last-resort substitute for directional loco on a rig with no real
   *  clips in `this.spec` (speed-matched forward loop while sliding) --
   *  checked only *after* `this.spec[logical]` comes up empty, see `play()`. */
  private directionalLocomotionNames(logical: LogicalAnim): string[] | null {
    const directional =
      logical === "strafeLeft" ||
      logical === "strafeRight" ||
      logical === "walkBack" ||
      logical === "walkFwdLeft" ||
      logical === "walkFwdRight" ||
      logical === "walkBackLeft" ||
      logical === "walkBackRight";
    if (!directional) return null;
    const fast = this.locomotionSpeed > this.locomotionRunThreshold;
    if (logical === "walkBack" || logical === "walkBackLeft" || logical === "walkBackRight") {
      return fast ? ["Jog_Fwd_Loop", "Sprint_Loop", "Walk_Loop"] : ["Walk_Loop", "Jog_Fwd_Loop"];
    }
    return fast ? ["Jog_Fwd_Loop", "Sprint_Loop", "Walk_Loop"] : ["Walk_Loop", "Jog_Fwd_Loop"];
  }

  constructor(spec: AnimSpec) {
    this.spec = spec;
  }

  async equipModularSlot(
    slot: string,
    url: string | null,
    opts?: { coversHands?: boolean; coversHead?: boolean; fit?: ModularFit; tint?: number | null },
  ): Promise<void> {
    this.pendingModularSlots.set(slot, {
      url,
      coversHands: opts?.coversHands,
      coversHead: opts?.coversHead,
      fit: opts?.fit,
      tint: opts?.tint,
    });
    if (!this.innerScene) return;
    await this.applyModularSlot(slot, url, opts);
  }

  private bindSkinnedMeshToCharacter(mesh: THREE.SkinnedMesh): void {
    if (!this.characterSkeleton) return;
    // Share the base rig's exact Skeleton object (same Bone instances *and*
    // the same bone inverses, computed once from the true T-pose at glTF
    // load time). This is the standard modular-equip technique: every piece
    // in this asset family is exported from the identical shared rig, so
    // its per-vertex skin indices already line up with this bone order.
    // Constructing a *new* Skeleton instead (even from the same bones)
    // recomputes inverses from whatever pose happens to be playing right
    // now, which silently breaks skinning -- the mesh then renders frozen
    // in its own local bind pose (looks like a T-pose, or badly distorted
    // limbs) no matter what animation the mixer is running.
    mesh.skeleton = this.characterSkeleton;
    mesh.bind(this.characterSkeleton, mesh.bindMatrix);
    mesh.frustumCulled = false;
  }

  /** Attach outfit skinned meshes directly to the player rig (no nested
   *  armature). `fit` is an optional rigid nudge (position/rotation/scale)
   *  applied to the whole wrapper on top of the skin deformation -- used to
   *  correct pieces authored against one gender's head proportions that sit
   *  in the wrong place on the other (see ModularFit/classModels.ts). */
  private attachModularMeshes(root: THREE.Object3D, fit?: ModularFit): THREE.Object3D {
    const wrapper = new THREE.Group();
    wrapper.name = "ModularAttachment";
    const skinned: THREE.SkinnedMesh[] = [];
    root.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (sm.isSkinnedMesh && sm.geometry) skinned.push(sm);
    });
    for (const mesh of skinned) {
      mesh.removeFromParent();
      this.bindSkinnedMeshToCharacter(mesh);
      wrapper.add(mesh);
    }
    if (fit?.position) wrapper.position.set(...fit.position);
    if (fit?.quaternion) {
      wrapper.quaternion.set(...fit.quaternion);
    } else if (fit?.rotation) {
      const [x, y, z] = fit.rotation;
      wrapper.rotation.set(THREE.MathUtils.degToRad(x), THREE.MathUtils.degToRad(y), THREE.MathUtils.degToRad(z));
    }
    if (fit?.scale !== undefined) wrapper.scale.setScalar(fit.scale);
    return wrapper;
  }

  private isUnderModularAttachment(o: THREE.Object3D): boolean {
    for (const { obj } of this.equippedModularSlots.values()) {
      let p: THREE.Object3D | null = o;
      while (p) {
        if (p === obj) return true;
        p = p.parent;
      }
    }
    return false;
  }

  private async applyModularSlot(
    slot: string,
    url: string | null,
    opts?: { coversHands?: boolean; coversHead?: boolean; fit?: ModularFit; tint?: number | null },
  ): Promise<void> {
    const current = this.equippedModularSlots.get(slot);
    if (!url) {
      if (current) {
        current.obj.parent?.remove(current.obj);
        this.equippedModularSlots.delete(slot);
        this.autoManageBodySkin();
      }
      return;
    }
    const key = modularSlotKey(url, opts?.fit);
    if (current && current.key === key) {
      // Refresh coverage flags even when the mesh URL/fit didn't change.
      current.coversHands = opts?.coversHands;
      current.coversHead = opts?.coversHead;
      current.tint = opts?.tint;
      this.autoManageBodySkin();
      return;
    }
    if (current) {
      current.obj.parent?.remove(current.obj);
      this.equippedModularSlots.delete(slot);
    }
    if (!this.innerScene || !this.characterSkeleton) return;
    let gltf: Awaited<ReturnType<typeof load>>;
    try {
      gltf = await load(url);
    } catch (e) {
      console.warn("[AnimatedModel] Failed to load modular piece", url, e);
      this.autoManageBodySkin();
      return;
    }
    // A newer equipModularSlot call may have superseded this request while
    // we awaited the GLTF — don't attach a stale piece.
    const pending = this.pendingModularSlots.get(slot);
    if (!pending || pending.url !== url) return;
    if (!this.innerScene || !this.characterSkeleton) return;
    const itemObj = this.attachModularMeshes(SkeletonUtils.clone(gltf.scene), opts?.fit);
    if (!isUniversalCharacterUrl(url)) {
      itemObj.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) applyMasterTextures(o);
      });
    }
    itemObj.traverse((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.visible = true;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => {
          const std = m as THREE.MeshStandardMaterial;
          std.side = THREE.FrontSide;
          std.shadowSide = THREE.FrontSide;
          std.transparent = false;
          std.depthWrite = true;
          std.depthTest = true;
          std.polygonOffset = true;
          std.polygonOffsetFactor = -2;
          std.polygonOffsetUnits = -2;
          std.needsUpdate = true;
        });
      }
    });
    this.innerScene.add(itemObj);
    this.equippedModularSlots.set(slot, {
      url,
      key,
      obj: itemObj,
      coversHands: opts?.coversHands,
      coversHead: opts?.coversHead,
      tint: opts?.tint,
    });
    if (OUTFIT_TINT_SLOTS.includes(slot)) this.tintObject(itemObj, this.outfitTint);
    else if (HAIR_TINT_SLOTS.includes(slot)) this.tintObject(itemObj, this.hairTint);
    this.autoManageBodySkin();
  }

  /**
   * Modular clothing *swaps out* the base skin it covers rather than
   * rendering on top of it. The base rig (Regular_Male.glb / Regular_
   * Female.glb) is pre-split (see scripts/split-universal-base.mjs) into
   * per-region nodes named "Regular_<Gender>_<Region>" — Head/Neck/Torso/
   * Arms/Hands/Thigh/Calf/Feet — and each equip slot hides exactly the
   * regions its own outfit piece is authored to cover:
   *   - head  -> Head (+ Eyes) only when coversHead (closed helm). Hoods
   *     overlay the face and leave the base head visible.
   *   - chest -> Torso (Neck stays visible; pelvis/hips live with Thigh so
   *     a chest piece does not erase the buttocks — those are covered by
   *     Legs outfits, not Body)
   *   - arms  -> Arms, and Hands too if the item is a glove (coversHands)
   *   - legs  -> Calf only (Thigh stays visible to seal the open torso/hip
   *     split; pants cover hips via polygon-offset)
   *   - feet  -> Calf + Feet (every boot in this pack rises past the ankle)
   * This is a plain lookup driven by which slots are filled, not a fuzzy
   * URL/name guess — so an empty slot never hides skin, and a filled slot
   * never over-hides into a region its mesh doesn't actually cover.
   */
  private autoManageBodySkin(): void {
    if (!this.innerScene) return;
    const headSlot = this.equippedModularSlots.get("head");
    // Only closed helms (coversHead) replace the face. Hoods/crowns overlay.
    const coversHead = !!headSlot?.url && !!headSlot.coversHead;
    // Chest coverage comes from *either* a skinned modular tunic or a rigid
    // bone-parented armor prop (see setArmorProp) -- either way the bare
    // torso skin underneath needs to swap out.
    const hasChestArmor = !!this.equippedModularSlots.get("chest")?.url || !!this.attachedArmorProp;
    const armsSlot = this.equippedModularSlots.get("arms");
    const hasArmsArmor = !!armsSlot?.url;
    const hasGloveArmor = hasArmsArmor && !!armsSlot?.coversHands;
    const legsSlot = this.equippedModularSlots.get("legs");
    const hasLegsArmor = !!legsSlot?.url;
    const hasFeetArmor = !!this.equippedModularSlots.get("feet")?.url;

    const hiddenRegions = new Set<string>();
    if (coversHead) hiddenRegions.add("head");
    if (hasChestArmor) hiddenRegions.add("torso");
    if (hasArmsArmor) hiddenRegions.add("arms");
    if (hasGloveArmor) hiddenRegions.add("hands");
    if (hasLegsArmor) {
      // Do NOT hide "thigh" here. Torso/Thigh are an open split of one mesh —
      // hiding Thigh leaves a jagged hole at the waist that reads as a bright
      // fringe above the pants. Legs pieces cover the hips with polygon-offset
      // so the thigh skin stays sealed underneath.
      hiddenRegions.add("calf");
    }
    if (hasFeetArmor) {
      hiddenRegions.add("calf");
      hiddenRegions.add("feet");
    }

    // Closed helms hide modular hair/brows that would poke through.
    for (const hairSlot of ["hair", "facialHair", "eyebrows"] as const) {
      const s = this.equippedModularSlots.get(hairSlot);
      if (s) s.obj.visible = !coversHead;
    }

    this.innerScene.traverse((o: THREE.Object3D) => {
      if (!(o as THREE.Mesh).isMesh || !o.name) return;
      if (this.isUnderModularAttachment(o)) return;
      if (o.name === "Mannequin") {
        // Dev-reference yellow UAL dummy mesh; never meant to render in-game.
        o.visible = false;
        return;
      }
      if (o.name === "Eyes") {
        o.visible = !coversHead;
        return;
      }
      if (o.name === "Eyebrows") {
        // Despite the name, this is the base rig's baked-in *hair* mesh --
        // always replaced by the player's own hair/facial-hair/eyebrows
        // overlay pieces (see applyAppearance), never shown as-is.
        o.visible = false;
        return;
      }
      const regionMatch = /^regular_(?:male|female)_(head|neck|torso|arms|hands|thigh|calf|feet)$/i.exec(
        o.name,
      );
      if (regionMatch?.[1]) {
        // "neck" is intentionally never added to hiddenRegions above -- no
        // outfit collar in this pack reliably covers the neck seam, so
        // hiding it (as it used to be lumped into "torso") left a gap
        // between chin and collar. Keeping it always-visible is the safer
        // failure mode than a hole in the character.
        const region = regionMatch[1].toLowerCase();
        o.visible = !hiddenRegions.has(region);
        if (region === "thigh") {
          // Some legs pieces (e.g. the Knight greaves) are shaped like
          // discrete plates rather than a full pant-leg cylinder, so they
          // don't fully occlude Thigh the way the polygon-offset trick
          // assumes -- the base rig's stock underwear texture shows through
          // the gaps. Tinting Thigh to the equipped legs' color turns that
          // sliver into a plausible underlayer instead of a jarring bare-skin
          // patch; untinted (null) restores the stock look when legs is empty.
          this.tintMesh(o as THREE.Mesh, hasLegsArmor ? (legsSlot?.tint ?? null) : null);
        }
        return;
      }
      // Fallback for any base mesh that hasn't been through the region
      // split (e.g. a stale cached asset) -- never fully hide it, since an
      // all-or-nothing toggle can make the whole character disappear.
      if (/^superhero_/i.test(o.name)) {
        o.visible = true;
      }
    });
  }

  /** Attach a separate GLTF prop onto a named bone — for weapons not baked
   *  into the wearer's own rig (e.g. the Ranger's bow). Pass `null` to
   *  detach whatever's currently attached. */
  async setWeaponProp(prop: PropAttachConfig | null): Promise<void> {
    // Unequip must always clear, even if we already think nothing is attached
    // (guards against a stale in-flight attach completing after a prior clear).
    if (prop === null) {
      this.attachedPropUrl = null;
      this.pendingProp = null;
      if (this.attachedProp) {
        this.attachedProp.parent?.remove(this.attachedProp);
        this.attachedProp = null;
      }
      return;
    }
    const key = propKey(prop);
    if (this.attachedPropUrl === key) return;
    this.attachedPropUrl = key;
    if (this.attachedProp) {
      this.attachedProp.parent?.remove(this.attachedProp);
      this.attachedProp = null;
    }
    // Remember what we ultimately want attached (even before the rig itself
    // has finished loading) so loadFrom's completion can retry once the
    // bone it needs actually exists.
    this.pendingProp = prop;
    await this.tryApplyProp(prop, key);
  }

  private async tryApplyProp(prop: PropAttachConfig, key: string | null): Promise<void> {
    const gltf = await load(prop.url);
    if (this.attachedPropUrl !== key) return; // superseded by a newer request
    if (this.attachedProp) return; // an overlapping call already attached it
    if (!this.innerScene) return; // loadFrom's completion will retry
    const propScene = SkeletonUtils.clone(gltf.scene);
    // Most of this pack's weapon/tool props are authored ~2x oversized for
    // the Universal rig's hand bones -- `scale` (calibrated per-asset in
    // items.ts) corrects that; props with no calibration render at native size.
    if (prop.scale !== undefined) propScene.scale.setScalar(prop.scale);
    if (prop.rotation) {
      const [x, y, z] = prop.rotation;
      propScene.rotation.set(THREE.MathUtils.degToRad(x), THREE.MathUtils.degToRad(y), THREE.MathUtils.degToRad(z));
    }
    if (prop.position) propScene.position.set(...prop.position);
    const boneName = prop.bone.replace(/^handslotr$/i, "hand_r").replace(/^handslotl$/i, "hand_l");
    const bone = this.innerScene.getObjectByName(boneName);
    if (bone) {
      bone.add(propScene);
      this.attachedProp = propScene;
      this.pendingProp = null;
    }
  }

  /** Attach a static (unskinned) chest-armor piece onto a torso bone -- the
   *  Ultimate RPG Items Pack's armor meshes are rigid props, not skinned to
   *  the Universal rig's skeleton, so they're bone-parented like a weapon
   *  prop rather than blended in as a modular outfit piece. This trades
   *  some clipping during extreme spine bends (attacks/casts) for the
   *  ability to use the pack's own-authored armor at all. Pass `null` to
   *  detach whatever's currently worn. */
  async setArmorProp(prop: PropAttachConfig | null): Promise<void> {
    const key = propKey(prop);
    if (this.attachedArmorPropUrl === key) return;
    this.attachedArmorPropUrl = key;
    if (this.attachedArmorProp) {
      this.attachedArmorProp.parent?.remove(this.attachedArmorProp);
      this.attachedArmorProp = null;
    }
    this.pendingArmorProp = prop;
    if (prop) await this.tryApplyArmorProp(prop, key);
    // The base rig's bare-torso skin must swap out the instant the rigid
    // piece attaches/detaches, same as a skinned chest item would.
    this.autoManageBodySkin();
  }

  private async tryApplyArmorProp(prop: PropAttachConfig, key: string | null): Promise<void> {
    const gltf = await load(prop.url);
    if (this.attachedArmorPropUrl !== key) return; // superseded by a newer request
    if (this.attachedArmorProp) return; // an overlapping call already attached it
    if (!this.innerScene) return; // loadFrom's completion will retry
    const propScene = SkeletonUtils.clone(gltf.scene);
    if (prop.scale !== undefined) propScene.scale.setScalar(prop.scale);
    if (prop.rotation) {
      const [x, y, z] = prop.rotation;
      propScene.rotation.set(THREE.MathUtils.degToRad(x), THREE.MathUtils.degToRad(y), THREE.MathUtils.degToRad(z));
    }
    if (prop.position) propScene.position.set(...prop.position);
    const bone = this.innerScene.getObjectByName(prop.bone);
    if (bone) {
      bone.add(propScene);
      this.attachedArmorProp = propScene;
      this.pendingArmorProp = null;
      this.autoManageBodySkin();
    }
  }

  /** Show only `visible` among `allKnown` nodes, hiding every other known
   *  node -- shared plumbing for weapon variants and baked cosmetic gear
   *  (hat/helmet/cape/etc), all parented at the rig's top level and visible
   *  by default. */
  private setNodeVisibility(channel: string, visible: string[], allKnown: string[]): void {
    if (!this.innerScene) {
      this.pendingNodeVisibility.set(channel, { visible, all: allKnown });
      return;
    }
    const scene = this.innerScene;
    scene.traverse((o) => {
      if (allKnown.includes(o.name)) o.visible = visible.includes(o.name);
    });
  }

  /** Show only `visible` among `allKnown` weapon/shield/accessory nodes —
   *  every KayKit rig bakes in multiple weapon-mesh variants parented to the
   *  same hand socket, all visible by default, so equipping a specific item
   *  means hiding every other known variant and showing just this one. */
  setWeapon(visible: string[], allKnown: string[]): void {
    this.setNodeVisibility("weapon", visible, allKnown);
  }

  /** Characters start bare -- no baked hat/helmet/mask -- and only show it
   *  once any head-slot item is equipped, using the rig's own baked mesh as
   *  the stand-in visual (there's no separate model per craftable hood/cap
   *  yet). Hidden again the moment the slot is emptied. */
  setHeadGear(equipped: boolean, allKnown: string[]): void {
    this.setNodeVisibility("head", equipped ? allKnown : [], allKnown);
  }

  /** Same as setHeadGear but for the baked chest/back cosmetic (cape/
   *  backpack/pelt) and the chest slot. */
  setChestGear(equipped: boolean, allKnown: string[]): void {
    this.setNodeVisibility("chest", equipped ? allKnown : [], allKnown);
  }

  /** Recolor the given rig nodes (Body/Arm/Leg) to reflect an equipped
   *  chest/arms/legs item -- there's no separate bare-skin/undergear mesh in
   *  these rigs, so instead of swapping geometry we tint the existing mesh.
   *  Pass `color` as null to restore the original, untinted appearance. */
  setGearTint(channel: string, nodes: string[], color: number | null): void {
    if (!this.innerScene) {
      this.pendingGearTint.set(channel, { nodes, color });
      return;
    }
    this.applyGearTint(nodes, color);
  }

  private applyGearTint(nodes: string[], color: number | null): void {
    const scene = this.innerScene!;
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && nodes.includes(o.name)) this.tintMesh(o as THREE.Mesh, color);
    });
  }

  /** Clone-once-then-recolor a single mesh's material(s) -- shared by
   *  applyGearTint (named base-rig nodes) and tintObject (whole equipped
   *  subtrees like a hairstyle or outfit piece). Pass `color` as null to
   *  restore the original, untinted appearance. */
  private tintMesh(mesh: THREE.Mesh, color: number | null): void {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = materials.map((m) => {
      const std = m as THREE.MeshStandardMaterial & { gearTintBase?: THREE.Color };
      // Clone once per instance the first time this mesh is tinted (its
      // material otherwise stays a shared reference from the GLTF cache,
      // so recoloring it in place would leak to every other instance of
      // the same rig -- other players, the character-creation preview,
      // etc). Stash the pre-tint color on the clone so switching to a
      // different item (or unequipping) always recomputes from the true
      // original instead of compounding tints on top of each other.
      const working = std.gearTintBase ? std : (std.clone() as typeof std);
      if (!working.gearTintBase) working.gearTintBase = std.color.clone();
      working.color.copy(working.gearTintBase);
      if (color !== null) working.color.multiply(new THREE.Color(color));
      return working;
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0]!;
  }

  /** Recolor every mesh under an equipped modular subtree (a hairstyle,
   *  facial hair, eyebrows, or outfit piece) -- used instead of
   *  applyGearTint's by-name lookup since these pieces' mesh node names are
   *  auto-generated/generic (e.g. "Cylinder.002"), not stable rig node names. */
  private tintObject(obj: THREE.Object3D, color: number | null): void {
    obj.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) this.tintMesh(o as THREE.Mesh, color);
    });
  }

  /** Attach/recolor the player's hair, facial hair, eyebrows, and eyes to
   *  reflect their chosen character appearance, and remember the hair/outfit
   *  tint so it's reapplied automatically whenever those slots' meshes
   *  change (e.g. switching hairstyle, or equipping new armor). Safe to call
   *  before loadFrom finishes -- equipModularSlot/setGearTint both queue. */
  async applyAppearance(gender: CharacterGender, appearance: CharacterAppearance): Promise<void> {
    this.hairTint = appearance.hairColor;
    this.outfitTint = appearance.outfitHue === 0xffffff ? null : appearance.outfitHue;
    await this.equipModularSlot("hair", hairStyleUrl(appearance.hairStyle), {
      fit: (await computeHairFit(appearance.hairStyle, gender)) ?? undefined,
    });
    await this.equipModularSlot("facialHair", facialHairUrl(appearance.facialHair));
    await this.equipModularSlot("eyebrows", eyebrowsUrl(gender));
    this.setGearTint("eyes", ["Eyes"], appearance.eyeColor);
    // Re-tint every already-equipped slot unconditionally -- equipModularSlot
    // above is a no-op whenever the requested url matches what's already
    // attached (e.g. only the *color* changed, not the hairstyle/gear
    // itself), so its attach-time tinting never runs for that case. Without
    // this loop, picking a new hair/eye/outfit color while the same mesh
    // stays equipped silently did nothing.
    for (const slot of HAIR_TINT_SLOTS) {
      const eq = this.equippedModularSlots.get(slot);
      if (eq) this.tintObject(eq.obj, this.hairTint);
    }
    for (const slot of OUTFIT_TINT_SLOTS) {
      const eq = this.equippedModularSlots.get(slot);
      if (eq) this.tintObject(eq.obj, this.outfitTint);
    }
  }

  /** Raise the model above its feet (e.g. to seat a rider on a mount). */
  setLift(y: number): void {
    this.liftY = y;
    if (this.innerScene) this.innerScene.position.y = this.footY + y;
  }

  async loadFrom(url: string, targetHeight: number, tint?: number): Promise<void> {
    if (this.innerScene) {
      this.group.remove(this.innerScene);
      this.mixer?.stopAllAction();
      this.mixer = null;
      this.actions.clear();
      this.current = null;
      this.currentLogical = null;
      this.equippedModularSlots.clear();
      this.characterSkeleton = null;
      this.innerScene = null;
    }

    const gltf = await load(url);
    const scene = SkeletonUtils.clone(gltf.scene);
    scene.updateMatrixWorld(true);

    // Measure the *posed* bounds. Skinned meshes (e.g. the wolf) author their
    // geometry tiny and reach real size only through a scaled armature, so the
    // raw geometry box is near-zero — measuring per-bone is essential or the
    // model shrinks to an invisible speck.
    const bbox = new THREE.Box3();
    let measured = false;
    scene.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) {
        if (mesh.skeleton) {
          this.characterSkeleton = mesh.skeleton;
        }
        mesh.skeleton?.update();
        mesh.computeBoundingBox();
        if (mesh.boundingBox) {
          bbox.union(mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
          measured = true;
        }
      } else if ((o as THREE.Mesh).isMesh) {
        const geom = (o as THREE.Mesh).geometry;
        geom.computeBoundingBox();
        if (geom.boundingBox) {
          bbox.union(geom.boundingBox.clone().applyMatrix4(o.matrixWorld));
          measured = true;
        }
      }
    });
    if (!measured || !isFinite(bbox.min.y)) bbox.setFromObject(scene);

    const size = new THREE.Vector3();
    bbox.getSize(size);
    const scale = size.y > 0.01 ? targetHeight / size.y : 1;
    scene.scale.setScalar(scale);
    this.footY = -bbox.min.y * scale;
    this.innerScene = scene;
    scene.position.y = this.footY + this.liftY;

    const universal = isUniversalCharacterUrl(url);
    if (!universal && url.includes("/bundled/")) {
      applyMasterTextures(scene);
    }

    const tintColor = tint !== undefined ? new THREE.Color(tint) : null;
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        // Skinned meshes have bind-pose AABBs that don't track animation, so
        // they need frustumCulled off — but don't inflate bounds to 10000
        // (that defeated GPU cull for every non-skinned child too).
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
          mesh.frustumCulled = false;
        } else if (mesh.geometry && !mesh.geometry.boundingSphere) {
          mesh.geometry.computeBoundingSphere();
        }
        if (tintColor) {
          // Clone materials so the tint doesn't leak to other instances.
          const apply = (m: THREE.Material) => {
            const c = m as THREE.MeshStandardMaterial;
            const clone = c.clone();
            if (clone.color) clone.color.multiply(tintColor);
            return clone;
          };
          mesh.material = Array.isArray(mesh.material)
            ? mesh.material.map(apply)
            : apply(mesh.material);
        }
      }
    });

    this.group.add(scene);
    this.mixer = new THREE.AnimationMixer(scene);

    let clips: THREE.AnimationClip[] = [];
    if (universal) {
      try {
        const ual = await load(UNIVERSAL_ANIMATION_LIBRARY);
        if (ual.animations?.length) clips.push(...ual.animations);
      } catch {
        /* UAL1 optional if UAL2 covers needs */
      }
      try {
        const ual2 = await load(UNIVERSAL_ANIMATION_LIBRARY_2);
        if (ual2.animations?.length) clips.push(...ual2.animations);
      } catch {
        /* keep UAL1-only */
      }
      clips.push(...(await loadRetargetedClips()));
    } else {
      const isFemale = url.includes("F_") || url.includes("Female");
      if (isFemale) {
        try {
          const femaleAnimGltf = await load("/assets/models/bundled/base/BaseFemale_Animated.glb");
          if (femaleAnimGltf.animations) clips.push(...femaleAnimGltf.animations);
        } catch (e) {}
      } else {
        try {
          const maleAnimGltf = await load("/assets/models/bundled/base/BaseMale_Animated.glb");
          if (maleAnimGltf.animations) clips.push(...maleAnimGltf.animations);
        } catch (e) {}
      }
      try {
        const baseAnimGltf = await load("/assets/models/bundled/base/BaseAnimatedCharacter.glb");
        if (baseAnimGltf.animations) clips.push(...baseAnimGltf.animations);
      } catch (e) {}
    }
    if (gltf.animations && gltf.animations.length > 0) {
      clips.push(...gltf.animations);
    }

    // Universal libraries are huge; only bind clips this AnimSpec (and weapon
    // overrides) can actually play. Mob specs stay small via their own lists.
    const allow = universal ? clipNameAllowlist(this.spec) : null;

    for (const clip of clips) {
      const bare = clip.name.split("|").pop()!;
      if (allow && !allow.has(clip.name) && !allow.has(bare)) continue;
      const cleanClip = cleanAnimationClip(clip);
      if (this.actions.has(cleanClip.name) && this.actions.has(bare)) continue;
      const action = this.mixer.clipAction(cleanClip);
      if (!this.actions.has(cleanClip.name)) this.actions.set(cleanClip.name, action);
      if (!this.actions.has(bare)) this.actions.set(bare, action);
    }
    // Procedural swim up/down: pitch Swim_Fwd so vertical travel isn't flat.
    const swimFwd = this.actions.get("Swim_Fwd_Loop");
    if (swimFwd) {
      const base = swimFwd.getClip();
      if (!this.actions.has("Swim_Up_Loop")) {
        const up = deriveSwimPitchedClip(base, "Swim_Up_Loop", -Math.PI * 0.55);
        cleanedClipCache.set(up.name, up);
        this.actions.set("Swim_Up_Loop", this.mixer.clipAction(up));
      }
      if (!this.actions.has("Swim_Down_Loop")) {
        const down = deriveSwimPitchedClip(base, "Swim_Down_Loop", Math.PI * 0.5);
        cleanedClipCache.set(down.name, down);
        this.actions.set("Swim_Down_Loop", this.mixer.clipAction(down));
      }
    }
    // Pre-bind only the (now filtered) unique actions so first play() is free.
    const uniqueActions = new Set(this.actions.values());
    for (const action of uniqueActions) {
      action.play();
      action.stop();
    }
    this.mixer.update(0);
    this.play("idle");
    for (const [channel, { visible, all }] of this.pendingNodeVisibility) {
      this.setNodeVisibility(channel, visible, all);
    }
    this.pendingNodeVisibility.clear();
    for (const { nodes, color } of this.pendingGearTint.values()) {
      this.applyGearTint(nodes, color);
    }
    this.pendingGearTint.clear();
    for (const [slot, { url: itemUrl, coversHands, coversHead, fit }] of this.pendingModularSlots) {
      await this.applyModularSlot(slot, itemUrl, { coversHands, coversHead, fit });
    }
    this.autoManageBodySkin();
    if (this.pendingProp) {
      void this.tryApplyProp(this.pendingProp, propKey(this.pendingProp));
    }
    if (this.pendingArmorProp) {
      void this.tryApplyArmorProp(this.pendingArmorProp, propKey(this.pendingArmorProp));
    }
  }

  get loaded(): boolean {
    return this.mixer !== null;
  }

  private findAction(names: string[] | undefined): THREE.AnimationAction | null {
    for (const name of names ?? []) {
      const found = this.actions.get(name);
      if (found) return found;
    }
    return null;
  }

  /** Crossfade to a logical animation. One-shots (attack/gather/hit) auto-return to idle.
   *  `overrideNames` (e.g. a weapon's attackAnim/castAnim) is tried before the rig's own
   *  generic clip for that logical -- lets equipped gear reskin attack/cast poses. */
  play(logical: LogicalAnim, overrideNames?: string[]): void {
    if (!this.mixer) return;
    const now = performance.now();
    const oneShot =
      logical === "attack" ||
      logical === "gather" ||
      logical === "hit" ||
      logical === "dodgeForward" ||
      logical === "dodgeBackward" ||
      logical === "dodgeLeft" ||
      logical === "dodgeRight";
    if (!oneShot && now < this.oneShotUntil) return; // let the swing finish

    let action = overrideNames?.length ? this.findAction(overrideNames) : null;
    // Backward dodge: coin-flip between roll and backflip (JogToFlip).
    if (!action && logical === "dodgeBackward") {
      const names =
        Math.random() < 0.5
          ? ["JogToFlip", "Roll", "Shield_Dash", "Sword_Dash"]
          : ["Roll", "JogToFlip", "Shield_Dash", "Sword_Dash"];
      action = this.findAction(names);
    }
    if (!action) action = this.findAction(this.spec[logical]);
    // Only fall through to the synthetic forward-loop substitute once the
    // rig's own spec (which now lists real strafe/backpedal clips first,
    // see PLAYER_ANIMS) has nothing -- otherwise this always won since it's
    // unconditionally non-null for these three logicals.
    const locoNames = !action ? this.directionalLocomotionNames(logical) : null;
    if (!action && locoNames) action = this.findAction(locoNames);
    let resolved = logical;
    if (!action) {
      const fallback = ANIM_FALLBACK[logical];
      if (fallback) {
        action = this.findAction(this.spec[fallback]);
        resolved = fallback;
      }
    }
    if (!action) return;

    if (logical === this.currentLogical && !oneShot) {
      if (!locoNames || action === this.current) return;
    }

    // Avoid sticky speed from a previous sped-up dodge roll.
    action.timeScale = 1;

    if (this.current && this.current !== action) {
      action.reset();
      action.crossFadeFrom(this.current, 0.18, false);
    } else {
      action.reset();
    }

    if (resolved === "dead") {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    } else if (oneShot) {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = false;
      const clip = action.getClip();
      const isDodge =
        logical === "dodgeForward" ||
        logical === "dodgeBackward" ||
        logical === "dodgeLeft" ||
        logical === "dodgeRight";
      // Forward roll recovery is long — play faster and release the loco lock
      // early so sprint/walk can crossfade in while still moving.
      if (logical === "dodgeForward" && clip.name === "Roll") {
        action.timeScale = 1.35;
      }
      const effectiveMs = (clip.duration / Math.max(0.01, action.timeScale)) * 1000;
      const holdFrac =
        logical === "dodgeForward" ? 0.55 : logical === "dodgeBackward" ? 0.7 : 0.65;
      const holdMs = isDodge
        ? Math.min(2000, effectiveMs * holdFrac)
        : Math.min(700, clip.duration * 1000 * 0.9);
      this.oneShotUntil = now + holdMs;
      action.setEffectiveWeight(1);
      action.enabled = true;
    } else {
      action.setLoop(THREE.LoopRepeat, Infinity);
    }
    action.play();
    this.current = action;
    // Track the originally-requested logical (not the fallback it resolved
    // to) so the short-circuit above still matches on repeated calls --
    // otherwise a rig missing e.g. strafeLeft would reset its walk fallback
    // to frame 0 every single frame instead of playing it smoothly.
    this.currentLogical = oneShot ? null : logical;
  }

  update(dt: number): void {
    this.mixer?.update(dt);
  }

  /** Release mixer/actions and detach from the scene graph. Does not dispose
   *  shared GLTF cache geometry (SkeletonUtils.clone shares it). */
  dispose(): void {
    this.mixer?.stopAllAction();
    this.mixer = null;
    this.actions.clear();
    this.current = null;
    this.currentLogical = null;
    this.oneShotUntil = 0;
    this.pendingNodeVisibility.clear();
    this.pendingGearTint.clear();
    for (const { obj } of this.equippedModularSlots.values()) {
      obj.parent?.remove(obj);
    }
    this.equippedModularSlots.clear();
    this.pendingModularSlots.clear();
    this.attachedProp?.parent?.remove(this.attachedProp);
    this.attachedProp = null;
    this.attachedPropUrl = null;
    this.pendingProp = null;
    this.attachedArmorProp?.parent?.remove(this.attachedArmorProp);
    this.attachedArmorProp = null;
    this.attachedArmorPropUrl = null;
    this.pendingArmorProp = null;
    this.characterSkeleton = null;
    if (this.innerScene) {
      this.group.remove(this.innerScene);
      this.innerScene = null;
    }
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]!);
    }
  }
}

/** Every rig's body always faces its yaw (camera yaw for the local player,
 *  server-authoritative yaw for remote entities) rather than its movement
 *  direction, so strafing/backpedaling/diagonals need their own clips instead
 *  of running the forward-walk cycle sideways. `localMoveX`/`localMoveY` are
 *  the movement vector in that facing's own local space: +X = strafing right,
 *  +Y = moving backward (matches InputManager's camera-relative axes). */
function directionalMove(localMoveX: number, localMoveY: number, running: boolean): LogicalAnim {
  const ax = Math.abs(localMoveX);
  const ay = Math.abs(localMoveY);
  // W+A / W+D / S+A / S+D (or stick diagonal): use UAL2 8-dir walk clips.
  if (ax > 0.25 && ay > 0.25) {
    const forward = localMoveY < 0;
    const right = localMoveX > 0;
    if (forward) return right ? "walkFwdRight" : "walkFwdLeft";
    return right ? "walkBackRight" : "walkBackLeft";
  }
  if (ax > ay * 1.1) {
    return localMoveX > 0 ? "strafeRight" : "strafeLeft";
  }
  if (localMoveY > 0.15) return "walkBack";
  return running ? "run" : "walk";
}

/** Which directional dodge clip matches a world-space dodge direction, given
 *  the dodger's own facing -- same inverse camera-relative rotation used to
 *  derive localMoveX/localMoveY for remote entities (see EntityManager's
 *  update loop), just applied to a one-shot direction instead of a per-frame
 *  velocity delta. */
export function dodgeLogicalFor(yaw: number, dirX: number, dirZ: number): LogicalAnim {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const localX = -cos * dirX + sin * dirZ; // + = dodging to their right
  const localY = -sin * dirX - cos * dirZ; // + = dodging backward
  if (Math.abs(localX) > Math.abs(localY)) return localX > 0 ? "dodgeRight" : "dodgeLeft";
  return localY > 0 ? "dodgeBackward" : "dodgeForward";
}

/** Map server anim + observed speed/direction to a logical clip.
 *  `swimVert`: +1 ascending, -1 diving (local player; remotes leave 0). */
export function logicalFromState(
  serverAnim: string,
  speed: number,
  runThreshold: number,
  localMoveX = 0,
  localMoveY = 0,
  swimVert = 0,
): LogicalAnim {
  switch (serverAnim) {
    case "dead":
      return "dead";
    case "sit":
      return "sit";
    case "block":
      return "block";
    case "cheer":
      return "cheer";
    case "jump":
      return "jump";
    case "cast":
      if (speed > runThreshold) return directionalMove(localMoveX, localMoveY, true);
      if (speed > 0.35) return directionalMove(localMoveX, localMoveY, false);
      return "cast";
    case "attack":
      return "attack";
    case "gather":
      return "gather";
    case "swim":
      // Vertical travel uses the forward stroke; body pitch is applied on the
      // avatar group from camera look (see Game.swimBodyPitch).
      if (
        Math.abs(swimVert) > 0.25 ||
        speed > 0.35 ||
        Math.abs(localMoveX) + Math.abs(localMoveY) > 0.2
      ) {
        return "swimFwd";
      }
      return "swim";
    default:
      if (speed > runThreshold) return directionalMove(localMoveX, localMoveY, true);
      if (speed > 0.35) return directionalMove(localMoveX, localMoveY, false);
      return "idle";
  }
}

export function preloadCharacterAssets(): Promise<void> {
  // Warm only shared anim libs + both gender bases. Hair/facial/eyebrows,
  // skeletons, weapon props, and medium/large creature anim packs load on
  // demand — eager-fetching them ballooned VRAM and stalled welcome.
  const urls = [
    UNIVERSAL_ANIMATION_LIBRARY,
    UNIVERSAL_ANIMATION_LIBRARY_2,
    "/assets/models/modular/base/Regular_Male.glb",
    "/assets/models/modular/base/Regular_Female.glb",
  ];
  return Promise.all(urls.map((url) => load(url).catch(() => null))).then(() => {});
}
