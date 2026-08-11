import * as THREE from "three";
import type {
  PlayerSnap,
  MobSnap,
  PetSnap,
  ProjectileSnap,
  StructureSnap,
  AnimState,
  ClassId,
  CharacterGender,
  CharacterAppearance,
} from "@rustcraft/shared";
import { wrapAngle, mobDef, itemDef, auraDef } from "@rustcraft/shared";
import { buildNameplate, buildCampfire, buildHorse, buildRaft, buildPartyTagSprite } from "./models";
import { game } from "../ui/gameState.svelte";
import { AnimatedModel, PLAYER_ANIMS, mobModelSpec, logicalFromState, dodgeLogicalFor } from "./gltf";
import { playerModelUrl, CLASS_WEAPON_NODES } from "./classModels";
import { applyModularGearFromSnapAsync } from "./modularGear";
import { buildSchoolProjectile, recycleSchoolProjectile, buildSchoolParticle, SCHOOL_VFX, schoolProfile, spellSchool, type School, projectilePools } from "./vfx";
import { SpellVfxSystem } from "./spellVfx";
import { CharacterAuras } from "./characterAuras";
import { SchoolFlashSystem } from "./schoolFlash";
import { sound } from "../game/sound";
import type * as QUARKS from "three.quarks";

// Snapshots broadcast at a full 20Hz (see GameServer.tick), so 2 snapshot
// intervals (100ms) plus a little slack for jitter is enough buffer to avoid
// stutter without making remote mobs/pets feel laggy next to the player's
// own zero-latency client-side prediction.
const INTERP_DELAY_MS = 130;
const DESPAWN_AFTER_MS = 1200;
/** Defer GLB/anim binding for mobs/pets until within this range of the camera. */
const MOB_MODEL_LOAD_RADIUS = 72;

/** Which schools have a textured effect extracted from the Hovl Studio pack
 *  (see scripts/hovl/) instead of SpellVfxSystem's built-in procedural
 *  fallback -- loaded via SpellVfxSystem.loadEffect in the constructor. */
const HOVL_HIT_EFFECT: Partial<Record<School, string>> = {
  fire: "fire_hit",
  heal: "heal_hit",
};

/** Which schools have a continuous "Sparks <color>" trail extracted from the
 *  Hovl Studio pack (as opposed to the "explode" one-shots above) for a
 *  projectile's in-flight trail -- schools missing here fall back to the
 *  old per-frame mesh sparks (see spawnTrailSpark). A handful of colors
 *  covers most schools by closest match rather than extracting all 9. */
const HOVL_TRAIL_EFFECT: Partial<Record<School, string>> = {
  fire: "trail_fire",
  frost: "trail_blue",
  arcane: "trail_pink",
  shadow: "trail_pink",
  nature: "trail_green",
  heal: "trail_green",
  holy: "trail_yellow",
  buff: "trail_yellow",
};

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

interface RemoteEntity {
  kind: "player" | "mob" | "pet";
  id: string;
  name: string | null;
  classId: string;
  gender: CharacterGender;
  appearance: CharacterAppearance | null;
  group: THREE.Group;
  model: AnimatedModel;
  /** When set, `loadFrom` has not run yet — filled once the camera is near. */
  pendingLoad: { url: string; height: number; tint?: number } | null;
  inLoadQueue?: boolean;
  nameplate?: THREE.Sprite;
  hpBar?: THREE.Sprite;
  partyTag?: string;
  partyTagSprite?: THREE.Sprite;
  debuffIcons: THREE.Sprite;
  lastDebuffKey: string;
  ring?: THREE.Mesh;
  samples: Sample[];
  lastSeen: number;
  anim: AnimState;
  /** Previous anim, for one-shot SFX on attack/death transitions. */
  prevAnim: AnimState;
  lastX: number;
  lastZ: number;
  speed: number;
  /** Movement vector relative to this entity's own facing (yaw) -- see
   *  update()'s directional-clip selection. */
  localMoveX: number;
  localMoveY: number;
  pvp: boolean;
  hp: number;
  maxHp: number;
  mount: "horse" | "raft" | null;
  mountMesh: THREE.Group | null;
  weaponId: string | null;
  heldItemId: string | null;
  headId: string | null;
  chestId: string | null;
  armsId: string | null;
  legsId: string | null;
  feetId: string | null;
  shouldersId: string | null;
  neckId: string | null;
  lootRing?: THREE.Mesh;
  freezeMesh?: THREE.Group;
  lootable?: boolean;
  /** Last painted HP fraction — skip canvas redraw when unchanged. */
  lastHpFrac: number;
}

export interface TargetInfo {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  kind: "player" | "mob" | "pet";
  hostile: boolean;
}

interface DamageNumber {
  sprite: THREE.Sprite;
  born: number;
}

interface Spark {
  school: School;
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  drag: number;
  spin: number;
  born: number;
  lifeMs: number;
}

interface GroundBurst {
  school: School;
  mesh: THREE.Mesh;
  born: number;
  lifeMs: number;
}

/** A rising column of light -- the centerpiece of the level-up celebration,
 *  visible from across the map unlike the small hit-burst particles. */
interface LevelUpPillar {
  mesh: THREE.Mesh;
  ring: THREE.Mesh;
  born: number;
  lifeMs: number;
}

interface ProjectileInstance {
  group: THREE.Group;
  target: THREE.Vector3;
  school: School;
  /** Continuous quarks trail following this projectile in flight (see
   *  SpellVfxSystem.attachTrail) -- null for schools with no extracted
   *  trail effect, which fall back to the old per-frame mesh sparks. */
  trailPs: QUARKS.ParticleSystem | null;
  /** Throttle mesh-spark trails so dense bolt fights don't spawn one/frame. */
  lastSparkAt: number;
}

function createDamageSprite(text: string, color: string): THREE.Sprite {
  if (typeof document === "undefined") {
    return new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true }));
  }
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 34px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.95)";
  ctx.shadowBlur = 5;
  ctx.fillStyle = color;
  ctx.fillText(text, 64, 32);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(1.5, 0.75, 1);
  return sprite;
}

function getDamageSprite(text: string, color: string, pool: THREE.Sprite[]): THREE.Sprite {
  const sprite = pool.pop();
  if (sprite) {
    const texture = (sprite.material as THREE.SpriteMaterial).map as THREE.CanvasTexture | undefined;
    const canvas = texture?.image as HTMLCanvasElement | undefined;
    const ctx = canvas?.getContext("2d");
    if (ctx && texture) {
      ctx.clearRect(0, 0, 128, 64);
      ctx.fillStyle = color;
      ctx.fillText(text, 64, 32);
      texture.needsUpdate = true;
    }
    sprite.visible = true;
    return sprite;
  }
  return createDamageSprite(text, color);
}

function buildHpBar(): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 16;
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(1.0, 0.13, 1);
  return sprite;
}

function paintHpBar(sprite: THREE.Sprite, fraction: number): void {
  const texture = (sprite.material as THREE.SpriteMaterial).map as THREE.CanvasTexture;
  const canvas = texture.image as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 128, 16);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, 0, 128, 16);
  ctx.fillStyle = fraction > 0.5 ? "#5ec46a" : fraction > 0.25 ? "#d9b13d" : "#d94f3d";
  ctx.fillRect(2, 2, Math.max(0, 124 * fraction), 12);
  texture.needsUpdate = true;
}

function paintHpBarIfChanged(entity: RemoteEntity, fraction: number): void {
  const f = Math.max(0, Math.min(1, fraction));
  if (Math.abs(f - entity.lastHpFrac) < 0.004) return;
  entity.lastHpFrac = f;
  if (entity.hpBar) paintHpBar(entity.hpBar, f);
}

function buildDebuffIcons(): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 40;
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(1.0, 0.25, 1);
  sprite.visible = false;
  return sprite;
}

/** Redraws the floating debuff-icon row above an entity's head -- one glyph
 *  per currently-ticking damage-over-time aura. The row (and the whole
 *  sprite) disappears the moment the server stops including an aura id,
 *  i.e. exactly when it expires -- no separate client-side timer needed
 *  since position/hp/etc already refresh every snapshot tick anyway. */
function paintDebuffIcons(sprite: THREE.Sprite, auraIds: string[]): void {
  const texture = (sprite.material as THREE.SpriteMaterial).map as THREE.CanvasTexture;
  const canvas = texture.image as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const size = 30;
  const gap = 6;
  const totalWidth = auraIds.length * size + Math.max(0, auraIds.length - 1) * gap;
  let x = (canvas.width - totalWidth) / 2 + size / 2;
  ctx.font = `${size}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(0,0,0,0.9)";
  ctx.shadowBlur = 4;
  for (const auraId of auraIds) {
    ctx.fillText(auraDef(auraId).icon, x, canvas.height / 2);
    x += size + gap;
  }
  texture.needsUpdate = true;
  sprite.visible = auraIds.length > 0;
}

export class EntityManager {
  private scene: THREE.Scene;
  private entities = new Map<string, RemoteEntity>();
  private projectiles = new Map<string, ProjectileInstance>();
  private structures = new Map<string, THREE.Group>();
  private damageNumbers: DamageNumber[] = [];
  private damageNumberPool: THREE.Sprite[] = [];
  private sparks: Spark[] = [];
  private groundBursts: GroundBurst[] = [];
  private levelUpPillars: LevelUpPillar[] = [];
  private sparkPools = new Map<School, Spark[]>();
  private groundBurstPools = new Map<School, GroundBurst[]>();
  private raycaster = new THREE.Raycaster();
  private targetId: string | null = null;
  private targetRing: THREE.Mesh;
  /** Reused scratch objects for the per-frame coarse visibility cull in
   *  update() -- avoids allocating a Frustum/Matrix4/Sphere every frame. */
  private cullFrustum = new THREE.Frustum();
  private cullMatrix = new THREE.Matrix4();
  private cullSphere = new THREE.Sphere(new THREE.Vector3(), 2.5);
  /** Real three.quarks-driven spell VFX -- every school's hit burst (see
   *  spawnBurst) goes through this now, either an extracted Hovl Studio
   *  effect (public/assets/vfx/effects/*.json, see scripts/hovl/) or a
   *  procedural quarks system built from SCHOOL_VFX for schools without one
   *  extracted yet. */
  private spellVfx: SpellVfxSystem;
  private renderer: THREE.WebGLRenderer | null = null;
  /** Shader-driven flash layered on top of the particle burst -- particles
   *  alone read weak for the instantaneous punch a hit wants, this adds a
   *  school-parametrized noise/ring/spoke flash at the impact point. */
  private schoolFlash: SchoolFlashSystem;
  /** Lasting spell auras parented to a character (heal HoTs, shields, buff
   *  glows) -- follow the body instead of firing once at the impact point.
   *  See CharacterAuras; driven from Game via syncSelfBuffs / spawnHealAura. */
  private characterAuras = new CharacterAuras();
  /** Queue of mobs awaiting model load/skeleton cloning within load radius.
   *  Throttled to at most 1 mob per animation frame to prevent frame hitches. */
  private pendingMobLoadQueue: RemoteEntity[] = [];
  private inFlightMobLoad = false;
  /** Client Display settings -- toggled from System → Settings. */
  showPlayerNameplates = true;
  showMobNameplates = true;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.spellVfx = new SpellVfxSystem(scene);
    this.schoolFlash = new SchoolFlashSystem(scene);
    for (const [school, effectId] of Object.entries(HOVL_HIT_EFFECT) as [School, string][]) {
      void this.spellVfx.loadEffect(school, effectId, `/assets/vfx/effects/${effectId}.json`);
    }
    for (const trailId of new Set(Object.values(HOVL_TRAIL_EFFECT))) {
      void this.spellVfx.loadTrailEffect(trailId, `/assets/vfx/effects/${trailId}.json`);
    }
    // Selection ring drawn on the ground under the current target.
    const ringGeo = new THREE.RingGeometry(0.7, 0.95, 32);
    ringGeo.rotateX(-Math.PI / 2);
    this.targetRing = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({ color: 0xffd66e, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.targetRing.visible = false;
    this.targetRing.renderOrder = 2;
    this.scene.add(this.targetRing);
  }

  setRenderer(renderer: THREE.WebGLRenderer): void {
    this.renderer = renderer;
  }

  /** Create the spell VFX materials/geometries once up front so the first
   *  spell burst no longer pays their initialization cost on the critical
   *  frame. */
  prewarmVfx(renderer?: THREE.WebGLRenderer, camera?: THREE.Camera): void {
    if (renderer) this.renderer = renderer;
    for (const school of Object.keys(SCHOOL_VFX) as Array<keyof typeof SCHOOL_VFX>) {
      const profile = schoolProfile(school);
      const pool = this.sparkPools.get(school) ?? [];
      const burstPool = this.groundBurstPools.get(school) ?? [];
      for (let i = 0; i < profile.count * 3; i++) {
        const mesh = buildSchoolParticle(profile);
        mesh.visible = true;
        this.scene.add(mesh);
        pool.push({ school, mesh, vx: 0, vy: 0, vz: 0, gravity: 0, drag: 0, spin: 0, born: 0, lifeMs: 1 });
      }
      for (let i = 0; i < 2; i++) {
        const mesh = new THREE.Mesh(
          new THREE.RingGeometry(0.4, 0.6, 32),
          new THREE.MeshBasicMaterial({ color: profile.ringColor, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.visible = true;
        this.scene.add(mesh);
        burstPool.push({ school, mesh, born: 0, lifeMs: 1 });
      }
      this.sparkPools.set(school, pool);
      this.groundBurstPools.set(school, burstPool);
      for (let i = 0; i < 2; i++) {
        const projectile = buildSchoolProjectile(school, true);
        projectile.visible = true;
        const light = projectile.getObjectByName("light") as THREE.PointLight | undefined;
        if (light) light.intensity = 0;
        this.scene.add(projectile);
        recycleSchoolProjectile(school, projectile);
      }
    }

    // Prewarm damage numbers
    for (let i = 0; i < 6; i++) {
      const sprite = createDamageSprite("", "#ffffff");
      sprite.visible = true;
      this.scene.add(sprite);
      this.damageNumberPool.push(sprite);
    }

    if (renderer && camera) {
      if (typeof renderer.compileAsync === "function") {
        void renderer.compileAsync(this.scene, camera).catch(() => {});
      } else {
        renderer.compile(this.scene, camera);
      }
    }

    // Now turn everything invisible
    for (const pool of this.sparkPools.values()) {
      for (const spark of pool) spark.mesh.visible = false;
    }
    for (const pool of this.groundBurstPools.values()) {
      for (const burst of pool) burst.mesh.visible = false;
    }
    for (const pool of projectilePools.values()) {
      for (const group of pool) {
        group.visible = true;
        const core = group.getObjectByName("core");
        if (core) core.visible = false;
        const light = group.getObjectByName("light") as THREE.PointLight | undefined;
        if (light) light.intensity = 0;
      }
    }
    for (const sprite of this.damageNumberPool) {
      sprite.visible = false;
    }
  }

  private createEntity(
    kind: "player" | "mob" | "pet",
    id: string,
    name: string | null,
    now: number,
    mobType?: string,
    classId?: string,
    gender?: CharacterGender,
    appearance?: CharacterAppearance,
  ): RemoteEntity {
    let model: AnimatedModel;
    let pendingLoad: RemoteEntity["pendingLoad"] = null;
    let plateY = 2.35;
    let barY = kind === "player" ? 2.05 : 1.5;
    let plateColor = "#9fd0ff";
    let plateName = name;

    if (kind === "player") {
      model = new AnimatedModel(PLAYER_ANIMS);
      const g = gender ?? "male";
      void model.loadFrom(playerModelUrl(g), 1.8);
      if (appearance) void model.applyAppearance(g, appearance);
    } else {
      const def = mobDef(mobType ?? "wolf");
      const spec = mobModelSpec(def.render.model);
      model = new AnimatedModel(spec.anims);
      // Defer GLB clone + clip bind until the camera is close — spawning a
      // whole region of wolves used to hitch every remote createEntity.
      pendingLoad = { url: spec.url, height: def.render.height, tint: def.render.tint };
      plateColor = kind === "pet" ? "#7be07b" : def.render.color;
      plateName = kind === "pet" ? name : def.name;
      plateY = def.render.height + 0.7;
      barY = def.render.height + 0.4;
    }
    const group = model.group;

    let nameplate: THREE.Sprite | undefined;
    if (plateName) {
      nameplate = buildNameplate(plateName, plateColor);
      nameplate.position.y = plateY;
      group.add(nameplate);
    }
    const hpBar = buildHpBar();
    hpBar.position.y = barY;
    group.add(hpBar);
    const debuffIcons = buildDebuffIcons();
    debuffIcons.position.y = plateY + 0.22;
    group.add(debuffIcons);
    this.scene.add(group);

    const entity: RemoteEntity = {
      kind,
      id,
      name: plateName,
      classId: classId ?? "warrior",
      gender: gender ?? "male",
      appearance: appearance ?? null,
      group,
      model,
      pendingLoad,
      nameplate,
      hpBar,
      debuffIcons,
      lastDebuffKey: "",
      samples: [],
      lastSeen: now,
      anim: "idle",
      prevAnim: "idle",
      lastX: 0,
      lastZ: 0,
      localMoveX: 0,
      localMoveY: 0,
      speed: 0,
      pvp: false,
      hp: 1,
      maxHp: 1,
      mount: null,
      mountMesh: null,
      weaponId: null,
      heldItemId: null,
      headId: null,
      chestId: null,
      armsId: null,
      legsId: null,
      feetId: null,
      shouldersId: null,
      neckId: null,
      lastHpFrac: -1,
    };
    this.entities.set(id, entity);
    return entity;
  }

  /** Show/hide a mount under a remote player and seat them on it. */
  private setMount(entity: RemoteEntity, mount: "horse" | "raft" | null): void {
    if (entity.mount === mount) return;
    entity.mount = mount;
    if (entity.mountMesh) {
      entity.group.remove(entity.mountMesh);
      entity.mountMesh = null;
    }
    if (mount) {
      const parts = mount === "horse" ? buildHorse() : buildRaft();
      entity.group.add(parts.group);
      entity.mountMesh = parts.group;
      entity.model.setLift(parts.riderY);
    } else {
      entity.model.setLift(0);
    }
  }

  /** Swap nameplate color when a player's PvP flag changes. */
  private setPvp(entity: RemoteEntity, pvp: boolean): void {
    if (entity.pvp === pvp || !entity.name) {
      entity.pvp = pvp;
      return;
    }
    entity.pvp = pvp;
    if (entity.nameplate) {
      entity.group.remove(entity.nameplate);
      (entity.nameplate.material as THREE.SpriteMaterial).map?.dispose();
      entity.nameplate.material.dispose();
    }
    const plate = buildNameplate(pvp ? `⚔ ${entity.name}` : entity.name, pvp ? "#ff7a6e" : "#9fd0ff");
    plate.position.y = 2.35;
    entity.group.add(plate);
    entity.nameplate = plate;
  }

  /** Show whichever weapon-mesh variant matches the player's currently
   *  equipped weapon item, hiding every other variant baked into their rig
   *  -- unless their active hotbar slot holds its own visual item (a tool
   *  or potion), which takes over the held model instead, mirroring
   *  Game.ts's applyEquippedGear for the local player. */
  private setWeapon(entity: RemoteEntity, weaponId: string | null, heldItemId: string | null): void {
    if (entity.weaponId === weaponId && entity.heldItemId === heldItemId) return;
    entity.weaponId = weaponId;
    entity.heldItemId = heldItemId;
    const allKnown = CLASS_WEAPON_NODES[entity.classId as ClassId] ?? [];
    const equipDef = weaponId ? itemDef(weaponId) : null;
    const heldDef0 = heldItemId ? itemDef(heldItemId) : null;
    const def = heldDef0 && (heldDef0.weaponProp || heldDef0.weaponModel) ? heldDef0 : equipDef;
    entity.model.setWeapon(def?.weaponModel ?? [], allKnown);
    void entity.model.setWeaponProp(def?.weaponProp ?? null);
  }

  /** Reveal the rig's baked head/chest cosmetic once the player has
   *  anything equipped in that slot (hidden by default -- bare head, no
   *  cape) and tint the Body/Arm/Leg mesh for chest/arms/legs/feet --
   *  mirrors Game.ts's applyEquippedGear for the local player, so other
   *  players see the same gear appearance. */
  private setGearAppearance(entity: RemoteEntity, snap: PlayerSnap): void {
    if (
      entity.headId !== snap.headId ||
      entity.chestId !== snap.chestId ||
      entity.armsId !== snap.armsId ||
      entity.legsId !== snap.legsId ||
      entity.feetId !== snap.feetId ||
      entity.shouldersId !== snap.shouldersId ||
      entity.neckId !== snap.neckId
    ) {
      entity.headId = snap.headId;
      entity.chestId = snap.chestId;
      entity.armsId = snap.armsId;
      entity.legsId = snap.legsId;
      entity.feetId = snap.feetId;
      entity.shouldersId = snap.shouldersId;
      entity.neckId = snap.neckId;
      void applyModularGearFromSnapAsync(entity.model, entity.gender, {
        headId: snap.headId,
        chestId: snap.chestId,
        armsId: snap.armsId,
        legsId: snap.legsId,
        feetId: snap.feetId,
        shouldersId: snap.shouldersId,
        neckId: snap.neckId,
      });
    }
  }

  applyPlayers(players: PlayerSnap[], selfId: string, now: number): void {
    for (const snap of players) {
      if (snap.id === selfId) continue;
      let entity = this.entities.get(snap.id);
      if (!entity) {
        entity = this.createEntity(
          "player",
          snap.id,
          snap.name,
          now,
          undefined,
          snap.classId,
          snap.gender as CharacterGender,
          {
            gender: snap.gender as CharacterGender,
            hairStyle: snap.hairStyle as CharacterAppearance["hairStyle"],
            facialHair: snap.facialHair as CharacterAppearance["facialHair"],
            hairColor: snap.hairColor,
            eyeColor: snap.eyeColor,
            outfitHue: snap.outfitHue,
          },
        );
        entity.lastX = snap.x;
        entity.lastZ = snap.z;
      }
      entity.lastSeen = now;
      entity.anim = snap.anim;
      entity.hp = snap.hp;
      entity.maxHp = snap.maxHp;
      this.setPvp(entity, snap.pvp);
      this.setMount(entity, snap.mount);
      this.setWeapon(entity, snap.weaponId, snap.heldItemId);
      this.setGearAppearance(entity, snap);
      entity.samples.push({ t: now, x: snap.x, y: snap.y, z: snap.z, yaw: snap.yaw });
      if (entity.samples.length > 12) entity.samples.shift();
      if (entity.hpBar) paintHpBarIfChanged(entity, snap.hp / snap.maxHp);
      if (entity.nameplate) entity.nameplate.visible = this.showPlayerNameplates;
      this.updateDebuffs(entity, snap.debuffs);
    }
  }

  private createLootRing(): THREE.Mesh {
    const geom = new THREE.RingGeometry(0.7, 0.95, 32);
    geom.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffd700,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.y = 0.05;
    mesh.visible = false;
    // Emissive ring only — PointLights on every corpse destroy fill-rate in camps.
    return mesh;
  }

  applyMobs(mobs: MobSnap[], now: number): void {
    for (const snap of mobs) {
      let entity = this.entities.get(snap.id);
      if (!entity) {
        entity = this.createEntity("mob", snap.id, null, now, snap.type);
        entity.lastX = snap.x;
        entity.lastZ = snap.z;
      }
      entity.lastSeen = now;
      const prevAnim = entity.anim;
      const wasLootable = !!entity.lootable;
      const prevHp = entity.hp;
      entity.anim = snap.anim;
      entity.hp = snap.hp;
      entity.maxHp = snap.maxHp;
      entity.lootable = !!snap.lootable;
      if (snap.lootable) {
        if (!entity.lootRing) {
          entity.lootRing = this.createLootRing();
          entity.group.add(entity.lootRing);
        }
        if (!wasLootable) sound.play("lootDrop", { volume: 0.8 });
        entity.lootRing.visible = true;
      } else if (entity.lootRing) {
        entity.lootRing.visible = false;
      }
      if (entity.kind === "mob") {
        if (prevAnim !== "attack" && snap.anim === "attack") {
          sound.play("mobAttack", { volume: 0.65 });
        }
        if ((prevHp > 0 && snap.hp <= 0) || (prevAnim !== "dead" && snap.anim === "dead")) {
          sound.play("mobDeath", { volume: 0.75 });
        }
      }
      entity.prevAnim = snap.anim;
      if (entity.hpBar) {
        entity.hpBar.visible = snap.hp > 0;
        if (snap.hp > 0) paintHpBarIfChanged(entity, snap.hp / snap.maxHp);
      }
      if (entity.nameplate) {
        entity.nameplate.visible = snap.hp > 0 && this.nameplatesEnabledFor(entity.kind);
      }
      if (entity.debuffIcons) {
        entity.debuffIcons.visible = snap.hp > 0;
      }
      entity.samples.push({ t: now, x: snap.x, y: snap.y, z: snap.z, yaw: snap.yaw });
      if (entity.samples.length > 12) entity.samples.shift();
      this.updateDebuffs(entity, snap.hp > 0 ? snap.debuffs : []);

      // Sync Party Tag (Overhead Leader Crown or Tag)
      if (entity.kind === "player") {
        const partyMember = (game.party ?? []).find(
          (m) => m.id === entity.id || m.name.toLowerCase() === entity.name.toLowerCase(),
        );
        const desiredTag = partyMember?.tag;
        if (entity.partyTag !== desiredTag) {
          entity.partyTag = desiredTag;
          if (entity.partyTagSprite) {
            entity.group.remove(entity.partyTagSprite);
            (entity.partyTagSprite.material as THREE.SpriteMaterial).map?.dispose();
            entity.partyTagSprite.material.dispose();
            entity.partyTagSprite = undefined;
          }
          if (desiredTag) {
            const sprite = buildPartyTagSprite(desiredTag);
            if (sprite) {
              sprite.position.set(0, 2.7, 0);
              entity.group.add(sprite);
              entity.partyTagSprite = sprite;
            }
          }
        }
        if (entity.partyTagSprite) {
          entity.partyTagSprite.visible = snap.hp > 0;
        }
      }
    }
  }

  private nameplatesEnabledFor(kind: RemoteEntity["kind"]): boolean {
    if (kind === "player") return this.showPlayerNameplates;
    return this.showMobNameplates;
  }

  /** Apply Display → nameplate toggles immediately (between snapshots). */
  syncNameplateVisibility(): void {
    for (const entity of this.entities.values()) {
      if (!entity.nameplate) continue;
      const alive = entity.hp > 0;
      entity.nameplate.visible = alive && this.nameplatesEnabledFor(entity.kind);
    }
  }

  /** Summoned companions (Beast Mastery's wolf, etc.) -- rendered exactly
   *  like a mob (same model/hp-bar pipeline) but keyed by pet id and named
   *  after the owner instead of the mobDef.
   *
   *  Tried rebasing your own pet onto your locally-predicted position
   *  (to remove the mismatch against your own zero-latency movement) --
   *  reverted: instrumented logging showed the raw server position never
   *  jumps, but the rebased one jumped ~0.68m almost every tick while
   *  sprinting (double the expected per-tick distance), i.e. the rebase
   *  math itself was the source of a real, visible teleport, not a fix
   *  for one. Back to the plain snapshot coordinate for every pet. */
  applyPets(pets: PetSnap[], now: number): void {
    for (const snap of pets) {
      let entity = this.entities.get(snap.id);
      if (!entity) {
        entity = this.createEntity("pet", snap.id, snap.name, now, snap.type);
        entity.lastX = snap.x;
        entity.lastZ = snap.z;
      }
      entity.lastSeen = now;
      entity.anim = snap.anim;
      entity.hp = snap.hp;
      entity.maxHp = snap.maxHp;
      entity.samples.push({ t: now, x: snap.x, y: snap.y, z: snap.z, yaw: snap.yaw });
      if (entity.samples.length > 12) entity.samples.shift();
      if (entity.hpBar) paintHpBarIfChanged(entity, snap.hp / snap.maxHp);
      if (entity.nameplate) {
        entity.nameplate.visible = snap.hp > 0 && this.showMobNameplates;
      }
    }
  }

  private createIceMesh(): THREE.Group {
    const group = new THREE.Group();

    // 1. Central Translucent Frost Prism Core
    const prismGeom = new THREE.CylinderGeometry(0.85, 1.1, 2.1, 8);
    const prismMat = new THREE.MeshStandardMaterial({
      color: 0x40c4ff,
      emissive: 0x0077ff,
      emissiveIntensity: 0.75,
      transparent: true,
      opacity: 0.55,
      roughness: 0.05,
      metalness: 0.25,
      depthWrite: false,
    });
    const prism = new THREE.Mesh(prismGeom, prismMat);
    prism.position.y = 1.05;
    group.add(prism);

    // 2. Animated Blue Frost Flame Cones
    const flames: THREE.Mesh[] = [];
    const flameColors = [0x00ffff, 0x00a2ff, 0x33e5ff, 0x0055ff, 0x77e5ff];
    const flameCount = 8;

    for (let i = 0; i < flameCount; i++) {
      const angle = (i / flameCount) * Math.PI * 2;
      const radius = 0.6 + (i % 2) * 0.28;
      const height = 1.3 + (i % 3) * 0.4;

      const flameGeom = new THREE.ConeGeometry(0.3, height, 5);
      const color = flameColors[i % flameColors.length];
      const flameMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });

      const flame = new THREE.Mesh(flameGeom, flameMat);
      const baseY = height * 0.5;
      flame.position.set(Math.sin(angle) * radius, baseY, Math.cos(angle) * radius);
      flame.userData.baseY = baseY;

      group.add(flame);
      flames.push(flame);
    }
    group.userData.flames = flames;

    // 3. Glowing Blue Flame Ground Ring
    const ringGeom = new THREE.RingGeometry(0.65, 1.4, 24);
    ringGeom.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x00e1ff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(ringGeom, ringMat);
    ring.position.y = 0.05;
    group.add(ring);
    // No PointLight — many chilled targets in a pack would tank fill-rate.

    return group;
  }

  private updateDebuffs(entity: RemoteEntity, debuffs: string[]): void {
    const key = debuffs.join(",");
    if (key !== entity.lastDebuffKey) {
      entity.lastDebuffKey = key;
      paintDebuffIcons(entity.debuffIcons, debuffs);
      // Mirror ticking debuffs (burning, poison, moonfire, entangle, …) as
      // body auras -- the same lasting-effect visuals the player gets, now on
      // whatever the spell landed on. chilled/frozen are skipped in
      // auraVisualFor since the ice overlay below already renders them.
      this.characterAuras.syncBuffs(entity.group, debuffs);
    }

    const isFrozen = debuffs.includes("frozen") || debuffs.includes("chilled");
    if (isFrozen) {
      if (!entity.freezeMesh) {
        entity.freezeMesh = this.createIceMesh();
        entity.group.add(entity.freezeMesh);
      }
      entity.freezeMesh.visible = true;
    } else if (entity.freezeMesh) {
      entity.freezeMesh.visible = false;
    }
  }

  private projectileSeen = new Set<string>();

  applyProjectiles(snaps: ProjectileSnap[]): void {
    const seen = this.projectileSeen;
    seen.clear();
    for (const snap of snaps) {
      seen.add(snap.id);
      let proj = this.projectiles.get(snap.id);
      if (!proj) {
        const school = spellSchool(snap.spellId);
        const group = buildSchoolProjectile(school);
        group.position.set(snap.x, snap.y, snap.z);
        group.visible = true;
        const core = group.getObjectByName("core");
        if (core) core.visible = true;
        // Keep PointLight intensity at 0 — many concurrent bolts stall mid GPUs.
        const light = group.getObjectByName("light") as THREE.PointLight | undefined;
        if (light) light.intensity = 0;
        if (!group.parent) {
          this.scene.add(group);
        }
        const trailId = HOVL_TRAIL_EFFECT[school];
        const trailPs = trailId ? this.spellVfx.attachTrail(trailId, group.position) : null;
        proj = { group, target: new THREE.Vector3(snap.x, snap.y, snap.z), school, trailPs, lastSparkAt: 0 };
        this.projectiles.set(snap.id, proj);
      }
      proj.target.set(snap.x, snap.y, snap.z);
    }
    for (const [id, proj] of this.projectiles) {
      if (!seen.has(id)) {
        this.spawnBurst(proj.group.position, proj.school);
        const core = proj.group.getObjectByName("core");
        if (core) core.visible = false;
        const light = proj.group.getObjectByName("light") as THREE.PointLight | undefined;
        if (light) light.intensity = 0;
        if (proj.trailPs) this.spellVfx.detachTrail(proj.trailPs);
        recycleSchoolProjectile(proj.school, proj.group);
        this.projectiles.delete(id);
      }
    }
  }

  /** Public entry point for melee/self spells (Rend, Battle Fury, Heal, …)
   *  which have no projectile of their own to carry a burst — spawned
   *  directly around the caster instead, using the same school profile
   *  projectile impacts do. */
  spawnSpellBurst(x: number, y: number, z: number, spellId: string, intensity = 1): void {
    this.spawnBurst(new THREE.Vector3(x, y, z), spellSchool(spellId), intensity, spellId);
  }

  /** Golden pillar-of-light + multi-wave particle celebration when the local
   *  player levels up -- deliberately much bigger/longer than a normal hit
   *  burst (2.5s+ vs ~0.5s) so it reads clearly even mid-combat or from a
   *  zoomed-out camera, instead of blending into the sky like the old
   *  single small burst did. */
  spawnLevelUpVfx(x: number, y: number, z: number): void {
    const groundY = this.groundYAt(x, z, y);
    const base = new THREE.Vector3(x, groundY, z);
    this.spawnLevelUpPillar(base);
    // Staggered waves of particle bursts + ground rings read as a build-up
    // rather than one instant blip.
    const waves = [0, 140, 280, 420];
    for (const delay of waves) {
      window.setTimeout(() => {
        this.spawnBurst(new THREE.Vector3(x, y + 0.4 + delay / 500, z), "holy", 2.2);
        this.spawnBurst(new THREE.Vector3(x, y + 1.2 + delay / 400, z), "buff", 1.8);
      }, delay);
    }
    this.spawnGroundRing(x, groundY, z, 0xffe9a8, 1400, "holy");
    window.setTimeout(() => this.spawnGroundRing(x, groundY, z, 0xffd27a, 1200, "buff"), 200);
  }

  /** A tall additive-blended cylinder that shoots up from the player's feet
   *  and fades, plus an expanding ring at its base -- the "pillar" read that
   *  makes a level-up visible from a distance, not just a burst at head height. */
  private spawnLevelUpPillar(base: THREE.Vector3): void {
    const lifeMs = 1600;
    const height = 6;
    const geo = new THREE.CylinderGeometry(0.5, 0.8, height, 20, 1, true);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffe9a8,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(base.x, base.y + height / 2, base.z);
    this.scene.add(mesh);

    const ringGeo = new THREE.RingGeometry(0.3, 1.4, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(ringGeo, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(base.x, base.y + 0.05, base.z);
    this.scene.add(ring);

    this.levelUpPillars.push({ mesh, ring, born: performance.now(), lifeMs });
  }

  /** Small school-colored spark, fading and drifting — used for projectile trails. */
  private spawnTrailSpark(pos: THREE.Vector3, school: School): void {
    const profile = schoolProfile(school);
    const pool = this.sparkPools.get(school);
    const spark = pool?.pop();
    if (!spark) {
      const mesh = buildSchoolParticle(profile);
      mesh.visible = true;
      mesh.position.copy(pos);
      const material = mesh.material as THREE.MeshBasicMaterial;
      material.opacity = 1;
      material.transparent = true;
      material.depthWrite = false;
      material.blending = THREE.AdditiveBlending;
      material.color.set(profile.color);
      material.needsUpdate = true;
      this.scene.add(mesh);
      this.sparks.push({
        school,
        mesh,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        vz: (Math.random() - 0.5) * 0.4,
        gravity: profile.gravity * 0.3,
        drag: profile.drag,
        spin: profile.spin,
        born: performance.now(),
        lifeMs: 260,
      });
      return;
    }
    spark.mesh.visible = true;
    spark.mesh.scale.setScalar(profile.particleSize * 0.6);
    spark.mesh.position.copy(pos);
    const material = spark.mesh.material as THREE.MeshBasicMaterial;
    material.opacity = 1;
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.AdditiveBlending;
    material.color.set(profile.color);
    material.needsUpdate = true;
    spark.vx = (Math.random() - 0.5) * 0.4;
    spark.vy = (Math.random() - 0.5) * 0.4;
    spark.vz = (Math.random() - 0.5) * 0.4;
    spark.gravity = profile.gravity * 0.3;
    spark.drag = profile.drag;
    spark.spin = profile.spin;
    spark.born = performance.now();
    spark.lifeMs = 260;
    this.sparks.push(spark);
  }

  /** Burst of school-flavored particles — used when a projectile lands or a
   *  melee/self/aoe spell resolves. Initial velocity shape (radial/rising/
   *  hover/implode) comes from the school's profile, so Fire embers float
   *  up, Frost shards shatter down, Arcane glitter hangs and spins, and
   *  Shadow wisps look like they're being sucked toward the impact point. */
  private spawnBurst(pos: THREE.Vector3, school: School, intensity = 1, spellId?: string): void {
    const profile = schoolProfile(school);
    const groundY = this.groundYAt(pos.x, pos.z, pos.y);
    if (spellId) {
      this.spellVfx.painter.handleSpellImpact(spellId, pos, school, groundY);
    } else {
      this.spellVfx.spawnForSchool(school, pos);
      this.spawnGroundRing(pos.x, groundY, pos.z, profile.ringColor, profile.ringDuration * (intensity > 1.05 ? 1.2 : 1), school);
    }
    this.schoolFlash.spawn(school, pos, intensity);
  }

  /** Foot/terrain height under a burst. Impact events resolve against the
   *  torso (server sends y = feet + ~1, projectiles fly at chest height), so
   *  ground-plane VFX (decals, shockwave rings) must drop to the actual
   *  floor. Uses the live terrain sampler when we have one (open world),
   *  otherwise falls back to ~1m below the impact -- matching the server's
   *  torso offset -- for regions/dungeons where no sampler is bound. */
  private groundYAt(x: number, z: number, fallbackImpactY: number): number {
    const sampled = this.heightSampler?.(x, z);
    // Clamp the sampled terrain so an impact on raised geometry (a deck or
    // bridge, whose terrain sample sits far below) doesn't drop the decal
    // through the platform -- keep it within ~2m under the torso either way.
    if (sampled !== undefined) return Math.max(sampled, fallbackImpactY - 2.0);
    return fallbackImpactY - 1.0;
  }

  /** Flat ring that expands outward on the ground and fades — a shockwave
   *  accompanying every burst (projectile impact, melee/self spellcast). */
  private spawnGroundRing(x: number, groundY: number, z: number, color: number, lifeMs: number, school: School): void {
    const pool = this.groundBurstPools.get(school);
    const groundBurst = pool?.pop();
    if (groundBurst) {
      groundBurst.mesh.visible = true;
      (groundBurst.mesh.material as THREE.MeshBasicMaterial).color.set(color);
      (groundBurst.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
      groundBurst.mesh.position.set(x, groundY + 0.03, z);
      groundBurst.mesh.scale.set(1, 1, 1);
      groundBurst.born = performance.now();
      groundBurst.lifeMs = lifeMs;
      this.groundBursts.push(groundBurst);
      return;
    }
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.6, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, groundY + 0.03, z);
    this.scene.add(mesh);
    this.groundBursts.push({ school, mesh, born: performance.now(), lifeMs });
  }

  /** A quick puff of dust kicked up behind a dodge -- plain sphere particles
   *  rather than the spell-school-flavored burst system, since dodge isn't
   *  tied to any school. */
  spawnDodgeBurst(x: number, y: number, z: number, dirX: number, dirZ: number): void {
    const color = 0xcabf9e;
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.12 + Math.random() * 0.08, 6, 6),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75 }),
      );
      const spread = (Math.random() - 0.5) * 1.2;
      mesh.position.set(x - dirX * spread * 0.3, y + 0.2 + Math.random() * 0.4, z - dirZ * spread * 0.3);
      this.scene.add(mesh);
      const speed = 0.6 + Math.random() * 1.2;
      this.sparks.push({
        school: "buff",
        mesh,
        vx: -dirX * speed * 0.5 + (Math.random() - 0.5) * 0.8,
        vy: 0.4 + Math.random() * 0.6,
        vz: -dirZ * speed * 0.5 + (Math.random() - 0.5) * 0.8,
        gravity: 2.5,
        drag: 2,
        spin: 0,
        born: performance.now(),
        lifeMs: 380,
      });
    }
  }

  /** Trigger a remote player's directional one-shot dodge animation --
   *  resolved from their known facing + the broadcast world-space direction,
   *  same as attack/hit reactions are triggered off other broadcast events. */
  playDodge(id: string, dirX: number, dirZ: number): void {
    const entity = this.entities.get(id);
    if (!entity) return;
    const logical = dodgeLogicalFor(entity.group.rotation.y, dirX, dirZ);
    entity.model.play(logical);
  }

  heightSampler?: (x: number, z: number) => number;

  addStructure(snap: StructureSnap): void {
    if (this.structures.has(snap.id)) return;
    const group = buildCampfire();
    const posY = this.heightSampler ? this.heightSampler(snap.x, snap.z) : snap.y;
    group.position.set(snap.x, posY, snap.z);
    group.rotation.y = snap.yaw;
    this.scene.add(group);
    this.structures.set(snap.id, group);
  }

  removeStructure(id: string): void {
    const group = this.structures.get(id);
    if (group) {
      this.scene.remove(group);
      this.structures.delete(id);
    }
  }

  spawnDamageNumber(
    x: number,
    y: number,
    z: number,
    amount: number,
    color = "#ffd0d0",
    label?: string,
  ): void {
    const text = label ?? String(Math.round(amount));
    const sprite = getDamageSprite(text, color, this.damageNumberPool);
    const scale = label?.endsWith("!") ? 1.35 : label === "Miss" || label === "Dodge" ? 0.9 : 1;
    sprite.scale.set(0.9 * scale, 0.45 * scale, 1);
    sprite.position.set(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6);
    (sprite.material as THREE.SpriteMaterial).opacity = 1;
    if (!sprite.parent) {
      this.scene.add(sprite);
    }
    sprite.visible = true;
    this.damageNumbers.push({ sprite, born: performance.now() });
  }

  syncPartyTags(): void {
    for (const entity of this.entities.values()) {
      if (entity.kind !== "player") continue;
      const partyMember = (game.party ?? []).find(
        (m) => m.id === entity.id || m.name.toLowerCase() === entity.name.toLowerCase(),
      );
      const desiredTag = partyMember?.tag;
      if (entity.partyTag !== desiredTag) {
        entity.partyTag = desiredTag;
        if (entity.partyTagSprite) {
          entity.group.remove(entity.partyTagSprite);
          (entity.partyTagSprite.material as THREE.SpriteMaterial).map?.dispose();
          entity.partyTagSprite.material.dispose();
          entity.partyTagSprite = undefined;
        }
        if (desiredTag) {
          const sprite = buildPartyTagSprite(desiredTag);
          if (sprite) {
            sprite.position.set(0, 2.7, 0);
            entity.group.add(sprite);
            entity.partyTagSprite = sprite;
          }
        }
      }
      if (entity.partyTagSprite) {
        entity.partyTagSprite.visible = entity.hp > 0;
      }
    }
  }

  /** Advance interpolation + animation. Call once per frame. */
  update(now: number, dt: number, camera?: THREE.Camera): void {
    this.syncPartyTags();
    const renderT = now - INTERP_DELAY_MS;
    if (camera) {
      this.cullMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this.cullFrustum.setFromProjectionMatrix(this.cullMatrix);
    }

    for (const [id, entity] of this.entities) {
      if (now - entity.lastSeen > DESPAWN_AFTER_MS) {
        this.disposeEntity(entity);
        this.entities.delete(id);
        continue;
      }

      const s = entity.samples;
      if (s.length > 0) {
        let a = s[0]!;
        let b = s[s.length - 1]!;
        for (let i = 0; i < s.length - 1; i++) {
          if (s[i]!.t <= renderT && s[i + 1]!.t >= renderT) {
            a = s[i]!;
            b = s[i + 1]!;
            break;
          }
        }
        const span = Math.max(1, b.t - a.t);
        const alpha = Math.min(1, Math.max(0, (renderT - a.t) / span));
        const x = a.x + (b.x - a.x) * alpha;
        const y = a.y + (b.y - a.y) * alpha;
        const z = a.z + (b.z - a.z) * alpha;
        const yaw = a.yaw + wrapAngle(b.yaw - a.yaw) * alpha;

        const dx = x - entity.lastX;
        const dz = z - entity.lastZ;
        entity.speed = Math.hypot(dx, dz) / Math.max(dt, 1e-4);
        // The body faces `yaw` (its own facing), not necessarily its travel
        // direction, so rotate the world-space delta into that facing's
        // local space -- inverse of the camera-relative transform used to
        // build world moves from input in Game.stepLocal.
        const cos = Math.cos(yaw);
        const sin = Math.sin(yaw);
        entity.localMoveX = -cos * dx + sin * dz;
        entity.localMoveY = -sin * dx - cos * dz;
        entity.lastX = x;
        entity.lastZ = z;
        entity.group.position.set(x, y, z);
        entity.group.rotation.y = yaw;
      }

      // Coarse visibility cull: skip the animation mixer/state-machine work
      // (and the draw calls themselves -- AnimatedModel forces
      // frustumCulled=false on every mesh, see gltf.ts, so Three.js would
      // otherwise never skip an off-screen character on its own) for
      // entities clearly outside the camera frustum. Left paused mid-pose
      // off-screen, which is imperceptible, and resumes cleanly the instant
      // it's back in view.
      let inView = true;
      if (camera) {
        this.cullSphere.center.set(entity.group.position.x, entity.group.position.y + 1, entity.group.position.z);
        inView = this.cullFrustum.intersectsSphere(this.cullSphere);

        if (entity.pendingLoad && !entity.inLoadQueue) {
          const dx = entity.group.position.x - camera.position.x;
          const dz = entity.group.position.z - camera.position.z;
          if (dx * dx + dz * dz <= MOB_MODEL_LOAD_RADIUS * MOB_MODEL_LOAD_RADIUS) {
            entity.inLoadQueue = true;
            this.pendingMobLoadQueue.push(entity);
          }
        }
      }
      entity.group.visible = inView;
      if (inView && entity.model.loaded) {
        entity.model.setLocomotionSpeed(entity.speed, entity.kind === "player" ? 3.5 : 3);
        const logical = logicalFromState(
          entity.anim,
          entity.speed,
          entity.kind === "player" ? 3.5 : 3,
          entity.localMoveX,
          entity.localMoveY,
        );
        const weapon = entity.weaponId ? itemDef(entity.weaponId) : null;
        const overrides =
          logical === "attack" ? weapon?.attackAnim : logical === "cast" ? weapon?.castAnim : undefined;
        entity.model.play(logical, overrides);
        entity.model.update(dt);
      }

      // Pulse loot ring opacity (no PointLight).
      if (entity.lootRing?.visible) {
        const mat = entity.lootRing.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.7 + Math.sin(now * 0.003) * 0.2;
      }

      // Animate freeze overlay without dynamic lights.
      if (entity.freezeMesh?.visible) {
        entity.freezeMesh.rotation.y += dt * 1.8;
        const flames = entity.freezeMesh.userData.flames as THREE.Mesh[] | undefined;
        if (flames) {
          for (let i = 0; i < flames.length; i++) {
            const f = flames[i]!;
            const phase = now * 0.009 + i * 1.3;
            const sy = 0.8 + Math.sin(phase) * 0.45;
            const sx = 0.85 + Math.cos(phase * 1.4) * 0.25;
            f.scale.set(sx, sy, sx);
            f.position.y = (f.userData.baseY as number) + Math.sin(phase * 1.7) * 0.15;
          }
        }
      }
    }

    this.pumpMobLoadQueue(camera);

    this.updateTargetRing();

    const sparkIntervalMs = 55;
    for (const proj of this.projectiles.values()) {
      const prevX = proj.group.position.x;
      const prevY = proj.group.position.y;
      const prevZ = proj.group.position.z;

      proj.group.position.lerp(proj.target, Math.min(1, dt * 18));

      const dx = proj.target.x - prevX;
      const dy = proj.target.y - prevY;
      const dz = proj.target.z - prevZ;
      if (dx * dx + dy * dy + dz * dz > 0.0001) {
        proj.group.lookAt(proj.target);
      }

      const spinSpeed = (proj.group.userData.spinSpeed as number | undefined) ?? 0;
      if (spinSpeed) proj.group.rotateZ(spinSpeed * dt);
      if (proj.trailPs) {
        this.spellVfx.moveTrail(proj.trailPs, proj.group.position);
      } else if (now - proj.lastSparkAt >= sparkIntervalMs) {
        proj.lastSparkAt = now;
        this.spawnTrailSpark(proj.group.position, proj.school);
      }
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]!;
      const age = (now - s.born) / s.lifeMs;
      if (age >= 1) {
        s.mesh.visible = false;
        this.sparkPools.get(s.school)?.push(s);
        this.sparks.splice(i, 1);
        continue;
      }
      s.vy -= s.gravity * dt;
      if (s.drag) {
        const damp = Math.max(0, 1 - s.drag * dt);
        s.vx *= damp;
        s.vy *= damp;
        s.vz *= damp;
      }
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;
      s.mesh.position.z += s.vz * dt;
      if (s.spin) {
        s.mesh.rotation.x += s.spin * dt;
        s.mesh.rotation.y += s.spin * dt * 0.7;
      }
      const mat = s.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 1 - age;
    }

    for (let i = this.groundBursts.length - 1; i >= 0; i--) {
      const g = this.groundBursts[i]!;
      const age = (now - g.born) / g.lifeMs;
      if (age >= 1) {
        g.mesh.visible = false;
        this.groundBurstPools.get(g.school)?.push(g);
        this.groundBursts.splice(i, 1);
        continue;
      }
      const scale = 1 + age * 4;
      g.mesh.scale.set(scale, scale, 1);
      (g.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - age;
    }

    for (let i = this.levelUpPillars.length - 1; i >= 0; i--) {
      const p = this.levelUpPillars[i]!;
      const age = (now - p.born) / p.lifeMs;
      if (age >= 1) {
        this.scene.remove(p.mesh, p.ring);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        p.ring.geometry.dispose();
        (p.ring.material as THREE.Material).dispose();
        this.levelUpPillars.splice(i, 1);
        continue;
      }
      // Quick fade-in, hold, then fade-out; the ring keeps expanding the
      // whole time so it reads as a distinct "shockwave" beat.
      const fadeIn = Math.min(1, age / 0.15);
      const fadeOut = 1 - Math.max(0, (age - 0.7) / 0.3);
      const pillarMat = p.mesh.material as THREE.MeshBasicMaterial;
      pillarMat.opacity = 0.55 * fadeIn * fadeOut;
      p.mesh.scale.y = 0.7 + fadeIn * 0.3;
      const ringMat = p.ring.material as THREE.MeshBasicMaterial;
      const ringScale = 1 + age * 5;
      p.ring.scale.set(ringScale, ringScale, 1);
      ringMat.opacity = 0.9 * (1 - age);
    }

    for (const group of this.structures.values()) {
      const flame = group.getObjectByName("flame");
      if (flame) flame.scale.y = 0.9 + Math.sin(now / 90) * 0.18;
    }

    this.spellVfx.update(dt);
    this.characterAuras.update(dt);
    if (camera) this.schoolFlash.update(camera);

    for (let i = this.damageNumbers.length - 1; i >= 0; i--) {
      const dn = this.damageNumbers[i]!;
      const age = (now - dn.born) / 900;
      if (age >= 1) {
        dn.sprite.visible = false;
        this.damageNumberPool.push(dn.sprite);
        this.damageNumbers.splice(i, 1);
        continue;
      }
      dn.sprite.position.y += dt * 1.6;
      (dn.sprite.material as THREE.SpriteMaterial).opacity = 1 - age * age;
    }
  }

  /** Is any placed structure (currently only campfires) within `maxDist` of
   *  (x,z)? Client-side hint for the "Sit" prompt -- the server independently
   *  re-validates proximity in handleSit. */
  structureNear(x: number, z: number, maxDist: number): boolean {
    for (const group of this.structures.values()) {
      if (Math.hypot(group.position.x - x, group.position.z - z) < maxDist) return true;
    }
    return false;
  }

  nearestLootableCorpse(x: number, y: number, z: number, maxDist = 7.0): { id: string; name: string } | null {
    let nearest: { id: string; name: string; dist: number } | null = null;
    for (const e of this.entities.values()) {
      if (e.kind === "mob" && e.hp <= 0 && e.lootable !== false) {
        const mobX = e.samples.length > 0 ? e.samples[e.samples.length - 1]!.x : e.lastX || e.group.position.x;
        const mobY = e.samples.length > 0 ? e.samples[e.samples.length - 1]!.y : e.group.position.y;
        const mobZ = e.samples.length > 0 ? e.samples[e.samples.length - 1]!.z : e.lastZ || e.group.position.z;
        const dx = mobX - x;
        const dy = (mobY - y) * 0.4;
        const dz = mobZ - z;
        const d = Math.hypot(dx, dy, dz);
        if (d < maxDist && (!nearest || d < nearest.dist)) {
          nearest = { id: e.id, name: e.name ?? "Corpse", dist: d };
        }
      }
    }
    return nearest ? { id: nearest.id, name: nearest.name } : null;
  }

  // ============================ targeting ============================

  setTarget(id: string | null): void {
    const e = id ? this.entities.get(id) : null;
    if (e && e.hp <= 0) {
      this.targetId = null;
      this.targetRing.visible = false;
      return;
    }
    this.targetId = id && this.entities.has(id) ? id : null;
    this.targetRing.visible = this.targetId !== null;
  }

  getTargetId(): string | null {
    return this.targetId;
  }

  /** Lookup any tracked entity (including corpses). */
  getEntity(id: string | null): { id: string; kind: "player" | "mob" | "pet"; hp: number } | null {
    if (!id) return null;
    const e = this.entities.get(id);
    if (!e) return null;
    return { id: e.id, kind: e.kind, hp: e.hp };
  }

  entityInfo(id: string | null): TargetInfo | null {
    if (!id) return null;
    const e = this.entities.get(id);
    if (!e || e.hp <= 0) return null;
    return {
      id: e.id,
      name: e.name ?? "Unknown",
      hp: e.hp,
      maxHp: e.maxHp,
      kind: e.kind,
      hostile: e.kind === "mob" || e.pvp,
    };
  }

  entityWorldPos(id: string, out = new THREE.Vector3()): THREE.Vector3 | null {
    const e = this.entities.get(id);
    if (!e || e.hp <= 0) return null;
    return out.copy(e.group.position);
  }

  /** Live world positions of nearby entities for the minimap. `hostile` marks
   *  mobs and PvP-flagged players (red dots); pets/friendly players are not
   *  hostile. Dead entities are skipped. */
  mapBlips(): { x: number; z: number; kind: "mob" | "player" | "pet"; hostile: boolean }[] {
    const out: { x: number; z: number; kind: "mob" | "player" | "pet"; hostile: boolean }[] = [];
    for (const e of this.entities.values()) {
      if (e.hp <= 0) continue;
      out.push({
        x: e.group.position.x,
        z: e.group.position.z,
        kind: e.kind,
        hostile: e.kind === "mob" || e.pvp,
      });
    }
    return out;
  }

  /** Nearest dead player within range, for the hold-E-to-revive prompt.
   *  `anim === "dead"` is how a dead player's snapshot already renders
   *  (see applyPlayers), so no separate tracking is needed here. */
  nearestDeadPlayer(x: number, z: number, maxRange: number): { id: string; name: string } | null {
    let best: { id: string; name: string } | null = null;
    let bestDist = maxRange;
    for (const e of this.entities.values()) {
      if (e.kind !== "player" || e.anim !== "dead") continue;
      const d = Math.hypot(e.group.position.x - x, e.group.position.z - z);
      if (d < bestDist) {
        bestDist = d;
        best = { id: e.id, name: e.name ?? "someone" };
      }
    }
    return best;
  }

  /** Flinch reaction on taking damage -- a one-shot, so it's safe to call on
   *  every damage tick (e.g. a DoT) without fighting the movement/idle loop. */
  playHit(id: string): void {
    this.entities.get(id)?.model.play("hit");
  }

  /** Raycast normalized device coords into the scene; return the entity hit (living only). */
  raycastEntity(camera: THREE.Camera, ndcX: number, ndcY: number): string | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const groups = [...this.entities.values()].filter((e) => e.hp > 0).map((e) => e.group);
    const hits = this.raycaster.intersectObjects(groups, true);
    if (hits.length === 0) return null;
    // Walk up from the hit object to find which entity group owns it.
    let obj: THREE.Object3D | null = hits[0]!.object;
    while (obj) {
      for (const e of this.entities.values()) {
        if (e.group === obj && e.hp > 0) return e.id;
      }
      obj = obj.parent;
    }
    return null;
  }

  /**
   * Enemies (mobs + pvp players) sorted by proximity to the given world point,
   * limited to those on-screen and within range. Used for snap + cycle target.
   */
  enemiesByProximity(
    camera: THREE.Camera,
    fromX: number,
    fromZ: number,
    maxRange: number,
    selfId: string,
  ): string[] {
    const candidates: { id: string; d: number }[] = [];
    const v = new THREE.Vector3();
    for (const e of this.entities.values()) {
      if (e.id === selfId) continue;
      if (e.kind === "pet") continue; // friendly, never a valid enemy target
      if (e.kind === "mob" ? e.hp <= 0 : !e.pvp) continue;
      const d = Math.hypot(e.group.position.x - fromX, e.group.position.z - fromZ);
      if (d > maxRange) continue;
      // On-screen check.
      v.copy(e.group.position).project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) continue;
      candidates.push({ id: e.id, d });
    }
    candidates.sort((a, b) => a.d - b.d);
    return candidates.map((c) => c.id);
  }

  private updateTargetRing(): void {
    if (!this.targetId) return;
    const e = this.entities.get(this.targetId);
    if (!e || e.hp <= 0) {
      this.setTarget(null);
      return;
    }
    this.targetRing.position.set(e.group.position.x, e.group.position.y + 0.05, e.group.position.z);
    (this.targetRing.material as THREE.MeshBasicMaterial).color.set(
      e.kind === "mob" || e.pvp ? 0xff5040 : 0x6ec1ff,
    );
  }

  /** Mirror a character's lasting positive buffs (from SelfState.auras / a
   *  snapshot's aura list) as body auras that follow `group`. Safe to call
   *  every frame -- CharacterAuras reconciles, only adding/removing on change. */
  syncSelfBuffs(group: THREE.Object3D, auraIds: string[]): void {
    this.characterAuras.syncBuffs(group, auraIds);
  }

  /** A heal landed on `group` -- rising green motes + a ground halo pulse. */
  spawnHealAura(group: THREE.Object3D): void {
    this.characterAuras.flourish(group, "regen", 0x8affb4, 1.1);
  }

  /** Cast-windup ring under a caster. `casterPos` is the caster's feet (as
   *  returned by entityWorldPos), which is already the ground the ring lies
   *  on -- routed through the same painter the impacts use so schools stay
   *  visually consistent. */
  spawnCastWindup(spellId: string, casterPos: THREE.Vector3): void {
    this.spellVfx.painter.handleSpellCast(spellId, casterPos, spellSchool(spellId));
  }

  /** The scene group for a tracked remote entity, so callers (Game) can
   *  attach a heal flourish to a healed ally/mob they don't otherwise hold. */
  groupOf(id: string): THREE.Group | null {
    return this.entities.get(id)?.group ?? null;
  }

  private pumpMobLoadQueue(camera: THREE.Camera | undefined): void {
    if (this.inFlightMobLoad || this.pendingMobLoadQueue.length === 0) return;

    // Prune stale/despawned entries
    while (this.pendingMobLoadQueue.length > 0) {
      const next = this.pendingMobLoadQueue[0]!;
      if (!this.entities.has(next.id) || !next.pendingLoad) {
        this.pendingMobLoadQueue.shift();
        next.inLoadQueue = false;
        continue;
      }
      break;
    }
    if (this.pendingMobLoadQueue.length === 0) return;

    // Sort by proximity to camera so the closest mob loads first
    if (camera && this.pendingMobLoadQueue.length > 1) {
      const cx = camera.position.x;
      const cz = camera.position.z;
      this.pendingMobLoadQueue.sort((a, b) => {
        const dxa = a.group.position.x - cx;
        const dza = a.group.position.z - cz;
        const dxb = b.group.position.x - cx;
        const dzb = b.group.position.z - cz;
        return dxa * dxa + dza * dza - (dxb * dxb + dzb * dzb);
      });
    }

    const entity = this.pendingMobLoadQueue.shift();
    if (!entity || !entity.pendingLoad) return;
    const pending = entity.pendingLoad;
    entity.pendingLoad = null;
    this.inFlightMobLoad = true;

    void entity.model
      .loadFrom(pending.url, pending.height, pending.tint)
      .then(() => {
        if (this.renderer && camera) {
          if (typeof this.renderer.compileAsync === "function") {
            void this.renderer.compileAsync(entity.group, camera).catch(() => {});
          } else {
            this.renderer.compile(entity.group, camera);
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        this.inFlightMobLoad = false;
        entity.inLoadQueue = false;
      });
  }

  private disposeEntity(entity: RemoteEntity): void {
    entity.inLoadQueue = false;
    this.characterAuras.clearGroup(entity.group);
    this.scene.remove(entity.group);
    if (entity.nameplate) {
      (entity.nameplate.material as THREE.SpriteMaterial).map?.dispose();
      entity.nameplate.material.dispose();
      delete entity.nameplate;
    }
    entity.model.dispose();
  }

  clear(): void {
    this.pendingMobLoadQueue.length = 0;
    this.inFlightMobLoad = false;
    for (const e of this.entities.values()) this.disposeEntity(e);
    for (const p of this.projectiles.values()) {
      const core = p.group.getObjectByName("core");
      if (core) core.visible = false;
      const light = p.group.getObjectByName("light") as THREE.PointLight | undefined;
      if (light) light.intensity = 0;
      recycleSchoolProjectile(p.school, p.group);
    }
    for (const s of this.structures.values()) this.scene.remove(s);
    for (const s of this.sparks) {
      s.mesh.visible = false;
      this.sparkPools.get(s.school)?.push(s);
    }
    for (const g of this.groundBursts) {
      g.mesh.visible = false;
      this.groundBurstPools.get(g.school)?.push(g);
    }
    for (const p of this.levelUpPillars) {
      this.scene.remove(p.mesh, p.ring);
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
      p.ring.geometry.dispose();
      (p.ring.material as THREE.Material).dispose();
    }
    for (const dn of this.damageNumbers) {
      dn.sprite.visible = false;
      this.damageNumberPool.push(dn.sprite);
    }
    this.entities.clear();
    this.projectiles.clear();
    this.structures.clear();
    this.sparks.length = 0;
    this.groundBursts.length = 0;
    this.levelUpPillars.length = 0;
    this.damageNumbers.length = 0;
    this.setTarget(null);
  }

  raycastPlayer(camera: THREE.Camera, mouseX: number, mouseY: number): { id: string; name: string; classId: string; level: number } | null {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2(
      (mouseX / window.innerWidth) * 2 - 1,
      -(mouseY / window.innerHeight) * 2 + 1
    );
    raycaster.setFromCamera(mouse, camera);
    const groups: THREE.Group[] = [];
    const groupToPlayer = new Map<THREE.Group, RemoteEntity>();
    for (const entity of this.entities.values()) {
      if (entity.kind === "player" && entity.group) {
        groups.push(entity.group);
        groupToPlayer.set(entity.group, entity);
      }
    }
    const intersects = raycaster.intersectObjects(groups, true);
    if (intersects.length > 0) {
      let curr: THREE.Object3D | null = intersects[0]!.object;
      while (curr) {
        if (curr instanceof THREE.Group && groupToPlayer.has(curr)) {
          const p = groupToPlayer.get(curr)!;
          return { id: p.id, name: p.name ?? "Adventurer", classId: p.classId, level: p.level ?? 1 };
        }
        curr = curr.parent;
      }
    }
    return null;
  }
}
