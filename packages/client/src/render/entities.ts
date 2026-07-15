import * as THREE from "three";
import type { PlayerSnap, MobSnap, ProjectileSnap, StructureSnap, AnimState, ClassId } from "@rustcraft/shared";
import { wrapAngle, mobDef, itemDef } from "@rustcraft/shared";
import { buildNameplate, buildProjectile, buildCampfire, buildHorse, buildRaft, spellColor } from "./models";
import { AnimatedModel, PLAYER_ANIMS, mobModelSpec, logicalFromState } from "./gltf";
import { CLASS_MODEL_URLS, CLASS_WEAPON_NODES } from "./classModels";

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
  kind: "player" | "mob";
  id: string;
  name: string | null;
  classId: string;
  group: THREE.Group;
  model: AnimatedModel;
  nameplate?: THREE.Sprite;
  hpBar?: THREE.Sprite;
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
  kind: "player" | "mob";
  hostile: boolean;
}

interface DamageNumber {
  sprite: THREE.Sprite;
  born: number;
}

interface Spark {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  born: number;
  lifeMs: number;
}

interface GroundBurst {
  mesh: THREE.Mesh;
  born: number;
  lifeMs: number;
}

function buildDamageSprite(text: string, color: string): THREE.Sprite {
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

function buildHpBar(): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 16;
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(1.4, 0.18, 1);
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

export function playerModelUrl(classId: string): string {
  return CLASS_MODEL_URLS[classId as ClassId] ?? CLASS_MODEL_URLS.warrior;
}

export class EntityManager {
  private scene: THREE.Scene;
  private entities = new Map<string, RemoteEntity>();
  private projectiles = new Map<string, { group: THREE.Group; target: THREE.Vector3; color: number }>();
  private structures = new Map<string, THREE.Group>();
  private damageNumbers: DamageNumber[] = [];
  private sparks: Spark[] = [];
  private groundBursts: GroundBurst[] = [];
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

  private createEntity(
    kind: "player" | "mob",
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
      plateColor = def.render.color;
      plateName = def.name;
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
    }
  }

  applyProjectiles(snaps: ProjectileSnap[]): void {
    const seen = new Set<string>();
    for (const snap of snaps) {
      seen.add(snap.id);
      let proj = this.projectiles.get(snap.id);
      if (!proj) {
        const color = spellColor(snap.spellId);
        const group = buildProjectile(color);
        group.position.set(snap.x, snap.y, snap.z);
        this.scene.add(group);
        proj = { group, target: new THREE.Vector3(snap.x, snap.y, snap.z), color };
        this.projectiles.set(snap.id, proj);
      }
      proj.target.set(snap.x, snap.y, snap.z);
    }
    for (const [id, proj] of this.projectiles) {
      if (!seen.has(id)) {
        this.spawnBurst(proj.group.position, proj.color, 14);
        this.scene.remove(proj.group);
        this.projectiles.delete(id);
      }
    }
  }

  /** Public entry point for melee/self spells (Rend, Battle Fury, Heal, …)
   *  which have no projectile of their own to carry a burst — spawned
   *  directly around the caster instead, colored the same way projectile
   *  spells are. */
  spawnSpellBurst(x: number, y: number, z: number, spellId: string): void {
    this.spawnBurst(new THREE.Vector3(x, y, z), spellColor(spellId), 14);
  }

  /** Small colored spark, fading and drifting — used for projectile trails. */
  private spawnTrailSpark(pos: THREE.Vector3, color: number): void {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 4, 4),
      new THREE.MeshBasicMaterial({ color, transparent: true }),
    );
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.sparks.push({
      mesh,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      vz: (Math.random() - 0.5) * 0.4,
      born: performance.now(),
      lifeMs: 260,
    });
  }

  /** Radial burst of colored sparks — used when a projectile lands. */
  private spawnBurst(pos: THREE.Vector3, color: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 4, 4),
        new THREE.MeshBasicMaterial({ color, transparent: true }),
      );
      mesh.position.copy(pos);
      this.scene.add(mesh);
      const ang = Math.random() * Math.PI * 2;
      const upAng = Math.random() * Math.PI - Math.PI / 2;
      const spd = 1.8 + Math.random() * 2.4;
      this.sparks.push({
        mesh,
        vx: Math.cos(ang) * Math.cos(upAng) * spd,
        vy: Math.sin(upAng) * spd,
        vz: Math.sin(ang) * Math.cos(upAng) * spd,
        born: performance.now(),
        lifeMs: 420,
      });
    }
    this.spawnGroundRing(pos, color);
  }

  /** Flat ring that expands outward on the ground and fades — a shockwave
   *  accompanying every burst (projectile impact, melee/self spellcast). */
  private spawnGroundRing(pos: THREE.Vector3, color: number): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.4, 0.6, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, pos.y - 0.9, pos.z);
    this.scene.add(mesh);
    this.groundBursts.push({ mesh, born: performance.now(), lifeMs: 500 });
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
    const sprite = buildDamageSprite(String(Math.round(amount)), color);
    sprite.position.set(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6);
    this.scene.add(sprite);
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

      entity.model.play(
        logicalFromState(
          entity.anim,
          entity.speed,
          entity.kind === "mob" ? 3 : 3.5,
          entity.localMoveX,
          entity.localMoveY,
        ),
      );
      entity.model.update(dt);
    }

    this.updateTargetRing();

    for (const proj of this.projectiles.values()) {
      proj.group.position.lerp(proj.target, Math.min(1, dt * 18));
      this.spawnTrailSpark(proj.group.position, proj.color);
    }

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]!;
      const age = (now - s.born) / s.lifeMs;
      if (age >= 1) {
        this.scene.remove(s.mesh);
        this.sparks.splice(i, 1);
        continue;
      }
      s.vy -= 4 * dt;
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;
      s.mesh.position.z += s.vz * dt;
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - age;
    }

    for (let i = this.groundBursts.length - 1; i >= 0; i--) {
      const g = this.groundBursts[i]!;
      const age = (now - g.born) / g.lifeMs;
      if (age >= 1) {
        this.scene.remove(g.mesh);
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
        this.scene.remove(dn.sprite);
        this.damageNumbers.splice(i, 1);
        continue;
      }
      dn.sprite.position.y += dt * 1.6;
      (dn.sprite.material as THREE.SpriteMaterial).opacity = 1 - age * age;
    }
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
    for (const p of this.projectiles.values()) this.scene.remove(p.group);
    for (const s of this.structures.values()) this.scene.remove(s);
    for (const s of this.sparks) this.scene.remove(s.mesh);
    for (const g of this.groundBursts) this.scene.remove(g.mesh);
    this.entities.clear();
    this.projectiles.clear();
    this.structures.clear();
    this.sparks.length = 0;
    this.groundBursts.length = 0;
    this.setTarget(null);
  }
}
