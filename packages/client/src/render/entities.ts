import * as THREE from "three";
import type { PlayerSnap, MobSnap, ProjectileSnap, StructureSnap, AnimState } from "@rustcraft/shared";
import { hashString, wrapAngle, mobDef } from "@rustcraft/shared";
import { buildNameplate, buildProjectile, buildCampfire, buildHorse, buildRaft } from "./models";
import {
  AnimatedModel,
  PLAYER_ANIMS,
  PLAYER_MODELS,
  mobModelSpec,
  logicalFromState,
} from "./gltf";

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
  pvp: boolean;
  hp: number;
  maxHp: number;
  mount: "horse" | "raft" | null;
  mountMesh: THREE.Group | null;
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

export function playerModelUrl(id: string): string {
  return PLAYER_MODELS[hashString(id) % PLAYER_MODELS.length]!;
}

export class EntityManager {
  private scene: THREE.Scene;
  private entities = new Map<string, RemoteEntity>();
  private projectiles = new Map<string, { group: THREE.Group; target: THREE.Vector3 }>();
  private structures = new Map<string, THREE.Group>();
  private damageNumbers: DamageNumber[] = [];
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
  ): RemoteEntity {
    let model: AnimatedModel;
    let plateY = 2.35;
    let barY = kind === "player" ? 2.05 : 1.5;
    let plateColor = "#9fd0ff";
    let plateName = name;

    if (kind === "player") {
      model = new AnimatedModel(PLAYER_ANIMS);
      void model.loadFrom(playerModelUrl(id), 1.8);
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
      group,
      model,
      nameplate,
      hpBar,
      samples: [],
      lastSeen: now,
      anim: "idle",
      lastX: 0,
      lastZ: 0,
      speed: 0,
      pvp: false,
      hp: 1,
      maxHp: 1,
      mount: null,
      mountMesh: null,
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

  applyPlayers(players: PlayerSnap[], selfId: string, now: number): void {
    for (const snap of players) {
      if (snap.id === selfId) continue;
      let entity = this.entities.get(snap.id);
      if (!entity) {
        entity = this.createEntity("player", snap.id, snap.name, now);
        entity.lastX = snap.x;
        entity.lastZ = snap.z;
      }
      entity.lastSeen = now;
      entity.anim = snap.anim;
      entity.hp = snap.hp;
      entity.maxHp = snap.maxHp;
      this.setPvp(entity, snap.pvp);
      this.setMount(entity, snap.mount);
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
        const group = buildProjectile();
        group.position.set(snap.x, snap.y, snap.z);
        this.scene.add(group);
        proj = { group, target: new THREE.Vector3(snap.x, snap.y, snap.z) };
        this.projectiles.set(snap.id, proj);
      }
      proj.target.set(snap.x, snap.y, snap.z);
    }
    for (const [id, proj] of this.projectiles) {
      if (!seen.has(id)) {
        this.scene.remove(proj.group);
        this.projectiles.delete(id);
      }
    }
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

        entity.speed = Math.hypot(x - entity.lastX, z - entity.lastZ) / Math.max(dt, 1e-4);
        entity.lastX = x;
        entity.lastZ = z;
        entity.group.position.set(x, y, z);
        entity.group.rotation.y = yaw;
      }

      entity.model.play(logicalFromState(entity.anim, entity.speed, entity.kind === "mob" ? 3 : 3.5));
      entity.model.update(dt);
    }

    this.updateTargetRing();

    for (const proj of this.projectiles.values()) {
      proj.group.position.lerp(proj.target, Math.min(1, dt * 18));
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
    this.entities.clear();
    this.projectiles.clear();
    this.structures.clear();
    this.setTarget(null);
  }
}
