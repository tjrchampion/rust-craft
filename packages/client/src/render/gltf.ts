import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";

const loader = new GLTFLoader();
const cache = new Map<string, Promise<GLTF>>();

export const PLAYER_MODELS = [
  "/assets/models/Knight.glb",
  "/assets/models/Barbarian.glb",
  "/assets/models/Mage.glb",
  "/assets/models/Rogue.glb",
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

function load(url: string): Promise<GLTF> {
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url);
    cache.set(url, p);
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
}

export const PLAYER_ANIMS: AnimSpec = {
  idle: ["Idle"],
  walk: ["Walking_A"],
  run: ["Running_A"],
  attack: ["1H_Melee_Attack_Slice_Diagonal", "1H_Melee_Attack_Chop"],
  gather: ["1H_Melee_Attack_Chop", "Interact"],
  cast: ["Spellcasting", "Spellcast_Long"],
  dead: ["Death_A"],
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

  constructor(spec: AnimSpec) {
    this.spec = spec;
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
    for (const clip of gltf.animations) {
      // Strip armature prefixes ("AnimalArmature|Walk" -> also register "Walk")
      this.actions.set(clip.name, this.mixer.clipAction(clip));
      const bare = clip.name.split("|").pop()!;
      if (!this.actions.has(bare)) this.actions.set(bare, this.mixer.clipAction(clip));
    }
    this.play("idle");
  }

  get loaded(): boolean {
    return this.mixer !== null;
  }

  /** Crossfade to a logical animation. One-shots (attack/gather) auto-return to idle. */
  play(logical: LogicalAnim): void {
    if (!this.mixer) return;
    const now = performance.now();
    const oneShot = logical === "attack" || logical === "gather";
    if (!oneShot && now < this.oneShotUntil) return; // let the swing finish
    if (logical === this.currentLogical && !oneShot) return;

    let action: THREE.AnimationAction | null = null;
    for (const name of this.spec[logical]) {
      const found = this.actions.get(name);
      if (found) {
        action = found;
        break;
      }
    }
    if (!action) return;

    if (this.current && this.current !== action) {
      action.reset();
      action.crossFadeFrom(this.current, 0.18, false);
    } else {
      action.reset();
    }

    if (logical === "dead") {
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
    this.currentLogical = oneShot ? null : logical;
  }

  update(dt: number): void {
    this.mixer?.update(dt);
  }
}

/** Map server anim + observed speed to a logical clip. */
export function logicalFromState(
  serverAnim: string,
  speed: number,
  runThreshold: number,
): LogicalAnim {
  switch (serverAnim) {
    case "dead":
      return "dead";
    case "cast":
      return "cast";
    case "attack":
      return "attack";
    case "gather":
      return "gather";
    default:
      if (speed > runThreshold) return "run";
      if (speed > 0.35) return "walk";
      return "idle";
  }
}
