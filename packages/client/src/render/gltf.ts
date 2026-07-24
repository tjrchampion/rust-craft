import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { ITEMS } from "@rustcraft/shared";

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<string, Promise<GLTF>>();

export const PLAYER_MODELS = [
  "/assets/models/Knight.glb",
  "/assets/models/Barbarian.glb",
  "/assets/models/Mage.glb",
  "/assets/models/Rogue.glb",
  "/assets/models/Ranger.glb",
  "/assets/models/Druid.glb",
  "/assets/models/Paladin.glb",
  "/assets/models/Barbarian_Large.glb",
  "/assets/models/Rogue_Hooded.glb",
  "/assets/models/Engineer.glb",
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
  hit?: string[];
  jump?: string[];
  block?: string[];
  sit?: string[];
  cheer?: string[];
  dodgeForward?: string[];
  dodgeBackward?: string[];
  dodgeLeft?: string[];
  dodgeRight?: string[];
}

// Clip names come in two eras: the older baked-in rigs (still true for
// Paladin.glb, which never got re-exported) use one naming scheme; the newer
// shared-library rigs (every other player class -- see loadAnimationLibrary
// above) use a slightly renamed scheme. Every logical below lists the new
// name(s) first, old name(s) as trailing fallbacks, so a single AnimSpec
// serves both eras -- whichever clip set a given AnimatedModel actually
// loaded, findAction() just walks the list and uses the first match.
export const PLAYER_ANIMS: AnimSpec = {
  idle: ["Idle_A", "Idle"],
  walk: ["Walking_A"],
  run: ["Running_A"],
  attack: [
    "Melee_1H_Attack_Slice_Diagonal",
    "1H_Melee_Attack_Slice_Diagonal",
    "Melee_1H_Attack_Chop",
    "1H_Melee_Attack_Chop",
    "Melee_2H_Attack",
    "Melee_1H_Slash",
  ],
  gather: ["Melee_1H_Attack_Chop", "1H_Melee_Attack_Chop", "Interact"],
  cast: ["Ranged_Magic_Spellcasting", "Spellcasting", "Ranged_Magic_Spellcasting_Long", "Spellcast_Long"],
  dead: ["Death_A"],
  strafeLeft: ["Running_Strafe_Left"],
  strafeRight: ["Running_Strafe_Right"],
  walkBack: ["Walking_Backwards"],
  hit: ["Hit_A"],
  jump: ["Jump_Idle"],
  block: ["Melee_Block", "Block", "Melee_Blocking"],
  sit: ["Sit_Floor_Idle"],
  cheer: ["Cheering", "Cheer"],
  // Warrior/mage/rogue/cleric rigs have dedicated dodge clips; ranger/druid/
  // paladin don't, so they fall back to the chop swing as a stand-in burst
  // animation (still reads fine at dodge's brief on-screen duration).
  dodgeForward: ["Dodge_Forward", "Melee_2H_Attack_Chop", "2H_Melee_Attack_Chop"],
  dodgeBackward: ["Dodge_Backward", "Dodge_Backwards", "Melee_2H_Attack_Chop", "2H_Melee_Attack_Chop"],
  dodgeLeft: ["Dodge_Left", "Melee_2H_Attack_Chop", "2H_Melee_Attack_Chop"],
  dodgeRight: ["Dodge_Right", "Melee_2H_Attack_Chop", "2H_Melee_Attack_Chop"],
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
  jump: "idle",
};

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
  private attachedPropUrl: string | null = null;
  private pendingProp: { url: string; bone: string } | null = null;

  constructor(spec: AnimSpec) {
    this.spec = spec;
  }

  /** Attach a separate GLTF prop onto a named bone — for weapons not baked
   *  into the wearer's own rig (e.g. the Ranger's bow). Pass `null` to
   *  detach whatever's currently attached. */
  async setWeaponProp(prop: { url: string; bone: string } | null): Promise<void> {
    const url = prop?.url ?? null;
    if (this.attachedPropUrl === url) return;
    this.attachedPropUrl = url;
    if (this.attachedProp) {
      this.attachedProp.parent?.remove(this.attachedProp);
      this.attachedProp = null;
    }
    // Remember what we ultimately want attached (even before the rig itself
    // has finished loading) so loadFrom's completion can retry once the
    // bone it needs actually exists.
    this.pendingProp = prop;
    if (prop) await this.tryApplyProp(prop, prop.url);
  }

  private async tryApplyProp(prop: { url: string; bone: string }, url: string): Promise<void> {
    const gltf = await load(prop.url);
    if (this.attachedPropUrl !== url) return; // superseded by a newer request
    if (this.attachedProp) return; // an overlapping call already attached it
    if (!this.innerScene) return; // loadFrom's completion will retry
    const propScene = SkeletonUtils.clone(gltf.scene);
    const bone = this.innerScene.getObjectByName(prop.bone);
    if (bone) {
      bone.add(propScene);
      this.attachedProp = propScene;
      this.pendingProp = null;
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
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !nodes.includes(o.name)) return;
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
    });
  }

  /** Raise the model above its feet (e.g. to seat a rider on a mount). */
  setLift(y: number): void {
    this.liftY = y;
    if (this.innerScene) this.innerScene.position.y = this.footY + y;
  }

  async loadFrom(url: string, targetHeight: number, tint?: number): Promise<void> {
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

    const tintColor = tint !== undefined ? new THREE.Color(tint) : null;
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.frustumCulled = false; // skinned meshes pop with default culling
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
    // Newer KayKit character exports carry no baked-in clips at all -- borrow
    // from the shared per-rig-size animation library instead (see
    // loadAnimationLibrary above). Rig size is inferred from the filename
    // ("_Large" suffix) since that's the only signal the URL gives us.
    const clips =
      gltf.animations.length > 0 ? gltf.animations : await loadAnimationLibrary(url.includes("_Large") ? "large" : "medium");
    for (const clip of clips) {
      // Strip armature prefixes ("AnimalArmature|Walk" -> also register "Walk")
      const action = this.mixer.clipAction(clip);
      this.actions.set(clip.name, action);
      const bare = clip.name.split("|").pop()!;
      if (!this.actions.has(bare)) this.actions.set(bare, action);
    }
    // Pre-bind track property bindings for all loaded clips so switching to
    // cast/attack/dodge animations during gameplay never stalls the main thread.
    for (const action of this.actions.values()) {
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
    if (this.pendingProp) {
      void this.tryApplyProp(this.pendingProp, this.pendingProp.url);
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
    if (logical === this.currentLogical && !oneShot) return;

    let action = overrideNames?.length ? this.findAction(overrideNames) : null;
    if (!action) action = this.findAction(this.spec[logical]);
    let resolved = logical;
    if (!action) {
      const fallback = ANIM_FALLBACK[logical];
      if (fallback) {
        action = this.findAction(this.spec[fallback]);
        resolved = fallback;
      }
    }
    if (!action) return;

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
      this.oneShotUntil = now + Math.min(700, clip.duration * 1000 * 0.9);
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
}

/** Every rig's body always faces its yaw (camera yaw for the local player,
 *  server-authoritative yaw for remote entities) rather than its movement
 *  direction, so strafing/backpedaling needs its own clips instead of just
 *  running the forward-walk cycle sideways. `localMoveX`/`localMoveY` are the
 *  movement vector in that facing's own local space: +X = strafing right,
 *  +Y = moving backward (matches InputManager's camera-relative axes). */
function directionalMove(localMoveX: number, localMoveY: number, running: boolean): LogicalAnim {
  if (Math.abs(localMoveX) > Math.abs(localMoveY) * 1.1) {
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

/** Map server anim + observed speed/direction to a logical clip. */
export function logicalFromState(
  serverAnim: string,
  speed: number,
  runThreshold: number,
  localMoveX = 0,
  localMoveY = 0,
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
    default:
      if (speed > runThreshold) return directionalMove(localMoveX, localMoveY, true);
      if (speed > 0.35) return directionalMove(localMoveX, localMoveY, false);
      return "idle";
  }
}

export function preloadCharacterAssets(): Promise<void> {
  const propUrls = Object.values(ITEMS)
    .map((i) => i.weaponProp?.url)
    .filter((url): url is string => !!url);
  const urls = [
    ...PLAYER_MODELS,
    WOLF_MODEL,
    ...Object.values(SKELETON_MODELS),
    ...Object.values(CREATURE_MODELS).map((c) => c.url),
    ...propUrls,
  ];
  return Promise.all([
    ...urls.map((url) => load(url).catch(() => null)),
    loadAnimationLibrary("medium").catch(() => []),
    loadAnimationLibrary("large").catch(() => []),
  ]).then(() => {});
}
