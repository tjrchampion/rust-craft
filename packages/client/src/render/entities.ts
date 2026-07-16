import * as THREE from "three";
import type { PlayerSnap, MobSnap, PetSnap, ProjectileSnap, StructureSnap, AnimState, ClassId } from "@rustcraft/shared";
import { wrapAngle, mobDef, itemDef, auraDef } from "@rustcraft/shared";
import { buildNameplate, buildCampfire, buildHorse, buildRaft } from "./models";
import { AnimatedModel, PLAYER_ANIMS, mobModelSpec, logicalFromState, dodgeLogicalFor } from "./gltf";
import { CLASS_MODEL_URLS, CLASS_WEAPON_NODES } from "./classModels";
import { buildSchoolProjectile, recycleSchoolProjectile, buildSchoolParticle, SCHOOL_VFX, schoolProfile, spellSchool, type School, projectilePools } from "./vfx";

// Snapshots broadcast at a full 20Hz (see GameServer.tick), so 2 snapshot
// intervals (100ms) plus a little slack for jitter is enough buffer to avoid
// stutter without making remote mobs/pets feel laggy next to the player's
// own zero-latency client-side prediction.
const INTERP_DELAY_MS = 130;
const DESPAWN_AFTER_MS = 1200;

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
  group: THREE.Group;
  model: AnimatedModel;
  nameplate?: THREE.Sprite;
  hpBar?: THREE.Sprite;
  debuffIcons: THREE.Sprite;
  lastDebuffKey: string;
  ring?: THREE.Mesh;
  samples: Sample[];
  lastSeen: number;
  anim: AnimState;
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

interface ProjectileInstance {
  group: THREE.Group;
  target: THREE.Vector3;
  school: School;
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

export function playerModelUrl(classId: string): string {
  return CLASS_MODEL_URLS[classId as ClassId] ?? CLASS_MODEL_URLS.warrior;
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
  private sparkPools = new Map<School, Spark[]>();
  private groundBurstPools = new Map<School, GroundBurst[]>();
  private raycaster = new THREE.Raycaster();
  private targetId: string | null = null;
  private targetRing: THREE.Mesh;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
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

  /** Create the spell VFX materials/geometries once up front so the first
   *  spell burst no longer pays their initialization cost on the critical
   *  frame. */
  prewarmVfx(renderer?: THREE.WebGLRenderer, camera?: THREE.Camera): void {
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
        if (light) light.intensity = 6;
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
      renderer.compile(this.scene, camera);
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
  ): RemoteEntity {
    let model: AnimatedModel;
    let plateY = 2.35;
    let barY = kind === "player" ? 2.05 : 1.5;
    let plateColor = "#9fd0ff";
    let plateName = name;

    if (kind === "player") {
      model = new AnimatedModel(PLAYER_ANIMS);
      void model.loadFrom(playerModelUrl(classId ?? "warrior"), 1.8);
    } else {
      const def = mobDef(mobType ?? "wolf");
      const spec = mobModelSpec(def.render.model);
      model = new AnimatedModel(spec.anims);
      void model.loadFrom(spec.url, def.render.height, def.render.tint);
      // A pet reuses the wild mob's model but keeps the caller's own display
      // name ("<Owner>'s Wolf") and a friendly nameplate color instead of
      // the wild mobDef's own name/color.
      plateColor = kind === "pet" ? "#7be07b" : def.render.color;
      plateName = kind === "pet" ? name : def.name;
      // Nameplate/HP bar sit above the model's normalized height.
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
      group,
      model,
      nameplate,
      hpBar,
      debuffIcons,
      lastDebuffKey: "",
      samples: [],
      lastSeen: now,
      anim: "idle",
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
   *  equipped weapon item, hiding every other variant baked into their rig. */
  private setWeapon(entity: RemoteEntity, weaponId: string | null): void {
    if (entity.weaponId === weaponId) return;
    entity.weaponId = weaponId;
    const allKnown = CLASS_WEAPON_NODES[entity.classId as ClassId] ?? [];
    const def = weaponId ? itemDef(weaponId) : null;
    entity.model.setWeapon(def?.weaponModel ?? [], allKnown);
    void entity.model.setWeaponProp(def?.weaponProp ?? null);
  }

  applyPlayers(players: PlayerSnap[], selfId: string, now: number): void {
    for (const snap of players) {
      if (snap.id === selfId) continue;
      let entity = this.entities.get(snap.id);
      if (!entity) {
        entity = this.createEntity("player", snap.id, snap.name, now, undefined, snap.classId);
        entity.lastX = snap.x;
        entity.lastZ = snap.z;
      }
      entity.lastSeen = now;
      entity.anim = snap.anim;
      entity.hp = snap.hp;
      entity.maxHp = snap.maxHp;
      this.setPvp(entity, snap.pvp);
      this.setMount(entity, snap.mount);
      this.setWeapon(entity, snap.weaponId);
      entity.samples.push({ t: now, x: snap.x, y: snap.y, z: snap.z, yaw: snap.yaw });
      if (entity.samples.length > 12) entity.samples.shift();
      if (entity.hpBar) paintHpBar(entity.hpBar, snap.hp / snap.maxHp);
      this.updateDebuffs(entity, snap.debuffs);
    }
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
      entity.anim = snap.anim;
      entity.hp = snap.hp;
      entity.maxHp = snap.maxHp;
      entity.samples.push({ t: now, x: snap.x, y: snap.y, z: snap.z, yaw: snap.yaw });
      if (entity.samples.length > 12) entity.samples.shift();
      if (entity.hpBar) paintHpBar(entity.hpBar, snap.hp / snap.maxHp);
      this.updateDebuffs(entity, snap.debuffs);
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
      if (entity.hpBar) paintHpBar(entity.hpBar, snap.hp / snap.maxHp);
    }
  }

  /** Repaints the floating debuff-icon row only when the active set actually
   *  changed (auras persist across most snapshot ticks unchanged, so this
   *  avoids redrawing the canvas texture 20x/sec for nothing). */
  private updateDebuffs(entity: RemoteEntity, debuffs: string[]): void {
    const key = debuffs.join(",");
    if (key === entity.lastDebuffKey) return;
    entity.lastDebuffKey = key;
    paintDebuffIcons(entity.debuffIcons, debuffs);
  }

  applyProjectiles(snaps: ProjectileSnap[]): void {
    const seen = new Set<string>();
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
        const light = group.getObjectByName("light") as THREE.PointLight | undefined;
        if (light) light.intensity = 6;
        if (!group.parent) {
          this.scene.add(group);
        }
        proj = { group, target: new THREE.Vector3(snap.x, snap.y, snap.z), school };
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
        recycleSchoolProjectile(proj.school, proj.group);
        this.projectiles.delete(id);
      }
    }
  }

  /** Public entry point for melee/self spells (Rend, Battle Fury, Heal, …)
   *  which have no projectile of their own to carry a burst — spawned
   *  directly around the caster instead, using the same school profile
   *  projectile impacts do. */
  spawnSpellBurst(x: number, y: number, z: number, spellId: string): void {
    this.spawnBurst(new THREE.Vector3(x, y, z), spellSchool(spellId));
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
  private spawnBurst(pos: THREE.Vector3, school: School): void {
    const profile = schoolProfile(school);
    const pool = this.sparkPools.get(school) ?? [];
    for (let i = 0; i < profile.count; i++) {
      const spark = pool.pop();
      const mesh = spark ? spark.mesh : buildSchoolParticle(profile);
      const ang = Math.random() * Math.PI * 2;
      let vx: number;
      let vy: number;
      let vz: number;
      let spawnPos = pos;
      if (profile.spread === "implode") {
        const offR = 0.6 + Math.random() * 1.2;
        const ox = Math.cos(ang) * offR;
        const oy = (Math.random() - 0.3) * offR;
        const oz = Math.sin(ang) * offR;
        spawnPos = new THREE.Vector3(pos.x + ox, pos.y + oy, pos.z + oz);
        const speed = 1.5 + Math.random() * 1.5;
        vx = (-ox / offR) * speed;
        vy = (-oy / offR) * speed * 0.6;
        vz = (-oz / offR) * speed;
      } else if (profile.spread === "rising") {
        const upAng = Math.random() * Math.PI * 0.5 + Math.PI * 0.15;
        const spd = 1.0 + Math.random() * 1.8;
        vx = Math.cos(ang) * Math.cos(upAng) * spd * 0.6;
        vy = Math.sin(upAng) * spd;
        vz = Math.sin(ang) * Math.cos(upAng) * spd * 0.6;
      } else if (profile.spread === "hover") {
        const spd = 0.3 + Math.random() * 0.6;
        vx = Math.cos(ang) * spd;
        vy = (Math.random() - 0.3) * spd;
        vz = Math.sin(ang) * spd;
      } else {
        const upAng = Math.random() * Math.PI - Math.PI / 2;
        const spd = 1.8 + Math.random() * 2.4;
        vx = Math.cos(ang) * Math.cos(upAng) * spd;
        vy = Math.sin(upAng) * spd;
        vz = Math.sin(ang) * Math.cos(upAng) * spd;
      }
      if (spark) {
        spark.mesh.visible = true;
        spark.mesh.scale.setScalar(profile.particleSize);
        spark.mesh.position.copy(spawnPos);
        const material = spark.mesh.material as THREE.MeshBasicMaterial;
        material.opacity = 1;
        material.transparent = true;
        material.depthWrite = false;
        material.blending = THREE.AdditiveBlending;
        material.color.set(profile.color);
        material.needsUpdate = true;
        spark.vx = vx;
        spark.vy = vy;
        spark.vz = vz;
        spark.gravity = profile.gravity;
        spark.drag = profile.drag;
        spark.spin = profile.spin;
        spark.born = performance.now();
        spark.lifeMs = profile.lifeMs;
        this.sparks.push(spark);
      } else {
        mesh.position.copy(spawnPos);
        this.scene.add(mesh);
        this.sparks.push({ school, mesh, vx, vy, vz, gravity: profile.gravity, drag: profile.drag, spin: profile.spin, born: performance.now(), lifeMs: profile.lifeMs });
      }
    }
    this.spawnGroundRing(pos, profile.ringColor, profile.ringDuration, school);
  }

  /** Flat ring that expands outward on the ground and fades — a shockwave
   *  accompanying every burst (projectile impact, melee/self spellcast). */
  private spawnGroundRing(pos: THREE.Vector3, color: number, lifeMs: number, school: School): void {
    const pool = this.groundBurstPools.get(school);
    const groundBurst = pool?.pop();
    if (groundBurst) {
      groundBurst.mesh.visible = true;
      (groundBurst.mesh.material as THREE.MeshBasicMaterial).color.set(color);
      (groundBurst.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
      groundBurst.mesh.position.set(pos.x, pos.y - 0.9, pos.z);
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
    mesh.position.set(pos.x, pos.y - 0.9, pos.z);
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

  addStructure(snap: StructureSnap): void {
    if (this.structures.has(snap.id)) return;
    const group = buildCampfire();
    group.position.set(snap.x, snap.y, snap.z);
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

  spawnDamageNumber(x: number, y: number, z: number, amount: number, color = "#ffd0d0"): void {
    const sprite = getDamageSprite(String(Math.round(amount)), color, this.damageNumberPool);
    sprite.position.set(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6);
    (sprite.material as THREE.SpriteMaterial).opacity = 1;
    if (!sprite.parent) {
      this.scene.add(sprite);
    }
    sprite.visible = true;
    this.damageNumbers.push({ sprite, born: performance.now() });
  }

  /** Advance interpolation + animation. Call once per frame. */
  update(now: number, dt: number): void {
    const renderT = now - INTERP_DELAY_MS;

    for (const [id, entity] of this.entities) {
      if (now - entity.lastSeen > DESPAWN_AFTER_MS) {
        this.scene.remove(entity.group);
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

    this.updateTargetRing();

    for (const proj of this.projectiles.values()) {
      proj.group.position.lerp(proj.target, Math.min(1, dt * 18));
      const spinSpeed = (proj.group.userData.spinSpeed as number | undefined) ?? 0;
      if (spinSpeed) proj.group.rotation.y += spinSpeed * dt;
      this.spawnTrailSpark(proj.group.position, proj.school);
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

    for (const group of this.structures.values()) {
      const flame = group.getObjectByName("flame");
      if (flame) flame.scale.y = 0.9 + Math.sin(now / 90) * 0.18;
    }

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

  // ============================ targeting ============================

  setTarget(id: string | null): void {
    this.targetId = id && this.entities.has(id) ? id : null;
    this.targetRing.visible = this.targetId !== null;
  }

  getTargetId(): string | null {
    return this.targetId;
  }

  entityInfo(id: string | null): TargetInfo | null {
    if (!id) return null;
    const e = this.entities.get(id);
    if (!e) return null;
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
    if (!e) return null;
    return out.copy(e.group.position);
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

  /** Raycast normalized device coords into the scene; return the entity hit. */
  raycastEntity(camera: THREE.Camera, ndcX: number, ndcY: number): string | null {
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);
    const groups = [...this.entities.values()].map((e) => e.group);
    const hits = this.raycaster.intersectObjects(groups, true);
    if (hits.length === 0) return null;
    // Walk up from the hit object to find which entity group owns it.
    let obj: THREE.Object3D | null = hits[0]!.object;
    while (obj) {
      for (const e of this.entities.values()) {
        if (e.group === obj) return e.id;
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
    if (!e) {
      this.setTarget(null);
      return;
    }
    this.targetRing.position.set(e.group.position.x, e.group.position.y + 0.05, e.group.position.z);
    (this.targetRing.material as THREE.MeshBasicMaterial).color.set(
      e.kind === "mob" || e.pvp ? 0xff5040 : 0x6ec1ff,
    );
  }

  clear(): void {
    for (const e of this.entities.values()) this.scene.remove(e.group);
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
    for (const dn of this.damageNumbers) {
      dn.sprite.visible = false;
      this.damageNumberPool.push(dn.sprite);
    }
    this.entities.clear();
    this.projectiles.clear();
    this.structures.clear();
    this.sparks.length = 0;
    this.groundBursts.length = 0;
    this.damageNumbers.length = 0;
    this.setTarget(null);
  }
}
