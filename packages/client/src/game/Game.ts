import * as THREE from "three";
import {
  stepMovement,
  terrainHeight,
  TICK_DT,
  WATER_LEVEL,
  ZONE_SIZE,
  clamp,
  dist2D,
  hashString,
  itemDef,
  mobDef,
  nodeTypeDef,
  spellDef,
  zoneAt,
  HOTBAR_SLOTS,
  generateVillages,
  generateRegionTwoNodes,
  VALLEY_START_Z,
  REGION_TWO_MAX_Z,
  REGION_TWO_GATE_X,
  REGION_TWO_GATE_Z,
  REGION_TWO_TRIGGER_RADIUS,
  type MoveState,
  type ServerMsg,
  type SelfState,
  type ItemSnap,
  type ItemDef,
} from "@rustcraft/shared";
import { Connection } from "../net/connection";
import { InputManager } from "../input/input";
import { buildTerrain, buildWater, buildRegionTerrain, type WaterField } from "../render/terrain";
import { buildHorizonMountains } from "../render/horizon";
import { buildClouds, type CloudField } from "../render/clouds";
import { buildNameplate, buildHorse, buildRaft, type MountParts } from "../render/models";
import { NodeManager } from "../render/nodes";
import { GrassField } from "../render/grass";
import { EntityManager, playerModelUrl } from "../render/entities";
import { CLASS_WEAPON_NODES } from "../render/classModels";
import { AnimatedModel, PLAYER_ANIMS, logicalFromState } from "../render/gltf";
import { buildWorldStatic, buildVillage, animateSettlements, type SettlementHandles } from "../render/settlements";
import { NpcManager } from "../render/npcs";
import { sound } from "./sound";
import { game as ui } from "../ui/gameState.svelte";

const CAMERA_DISTANCE = 6.5;
const CAMERA_HEIGHT = 2.2;
const GATHER_RANGE = 4.0;

interface PendingInput {
  seq: number;
  moveX: number;
  moveZ: number;
  jump: boolean;
  sprint: boolean;
  block: boolean;
  mount: "horse" | "raft" | null;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private sun: THREE.DirectionalLight;
  private ambient: THREE.AmbientLight;

  private connection = new Connection();
  private input: InputManager;
  private nodes!: NodeManager;
  private entities!: EntityManager;
  private settlements!: SettlementHandles;
  private npcManager!: NpcManager;
  private grass: GrassField;
  private clouds: CloudField;
  private water!: WaterField;
  /** Villages stream in once the player nears their zone, rather than every
   *  building loading at connect time; the GLTF cache makes re-entry free. */
  private streamedVillages = new Set<string>();
  private readonly STREAM_RADIUS = 190;
  /** Ashenpeak (region 2) — built once, lazily, the first time the player
   *  approaches the valley; stays resident for the rest of the session. */
  private regionTwoBuilt = false;
  private regionTwoNodes: NodeManager | null = null;
  /** Snapshot of `welcome`'s depleted-node ids, kept around so the lazily
   *  built region-2 NodeManager can honor any already-depleted nodes there
   *  (e.g. a returning player who gathered one before its respawn timer
   *  elapsed) instead of always starting "fresh." */
  private depletedNodeIds: string[] = [];
  private mountMesh: MountParts | null = null;
  private currentMount: "horse" | "raft" | null = null;

  private selfId = "";
  private selfClassId = "warrior";
  private equippedWeaponDef: ItemDef | null = null;
  private avatar: AnimatedModel;
  private move: MoveState = { x: 0, y: 4, z: 0, vy: 0, grounded: true };
  /** Decaying render offset that absorbs reconcile corrections smoothly. */
  private posError = new THREE.Vector3();
  private cameraYaw = 0;
  private cameraPitch = -0.35;
  private inputSeq = 0;
  private pending: PendingInput[] = [];
  private accumulator = 0;
  private lastFrame = performance.now();
  private jumpQueued = false;
  /** Escape presses redelivered just after an auto-opened system menu (see
   *  onFullscreenChange) are ignored so they don't immediately close it again. */
  private suppressEscapeUntil = 0;
  private running = false;
  private disposed = false;
  private animTime = 0;
  private lastAnimSpeed = 0;
  private unsubscribe: (() => void) | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    characterId: string,
    characterName: string,
    private wsAddress: string,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 900);
    this.scene.fog = new THREE.Fog(0x87b5d9, 120, 620);
    this.scene.background = new THREE.Color(0x87b5d9);

    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
    this.sun.position.set(80, 120, 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -70;
    this.sun.shadow.camera.right = 70;
    this.sun.shadow.camera.top = 70;
    this.sun.shadow.camera.bottom = -70;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 320;
    this.sun.shadow.bias = -0.0015;
    this.scene.add(this.sun.target);
    this.ambient = new THREE.AmbientLight(0x8899bb, 0.75);
    this.scene.add(this.sun, this.ambient);

    this.scene.add(buildTerrain());
    this.water = buildWater();
    this.scene.add(this.water.mesh);
    this.scene.add(buildHorizonMountains());
    this.clouds = buildClouds();
    this.scene.add(this.clouds.group);
    this.settlements = buildWorldStatic(this.scene);
    this.npcManager = new NpcManager(this.scene);
    this.grass = new GrassField(this.scene);

    this.avatar = new AnimatedModel(PLAYER_ANIMS);
    const plate = buildNameplate(characterName, "#ffe9a8");
    plate.position.y = 2.35;
    this.avatar.group.add(plate);
    this.scene.add(this.avatar.group);

    this.entities = new EntityManager(this.scene);
    this.input = new InputManager(canvas);

    window.addEventListener("resize", this.onResize);
    document.addEventListener("fullscreenchange", this.onFullscreenChange);

    this.unsubscribe = this.connection.onMessage((msg) => this.onServerMsg(msg));
    void this.connect(characterId);

    // Unlock/synthesize audio (constructed within the character-select gesture).
    sound.init();

    // Dev-only handle for verification tooling (scene inspection, teleporting).
    if (import.meta.env.DEV) (window as unknown as { __rc: Game }).__rc = this;
  }

  /** Dev helper: expose scene + local state for browser inspection. */
  get debug() {
    return {
      scene: this.scene,
      move: this.move,
      entities: this.entities,
      selfId: this.selfId,
    };
  }

  private async connect(characterId: string): Promise<void> {
    try {
      await this.connection.connect(characterId, this.wsAddress);
      ui.connected = true;
      this.running = true;
      requestAnimationFrame(this.frame);
    } catch {
      ui.disconnected = true;
    }
  }

  private onServerMsg(msg: ServerMsg): void {
    switch (msg.t) {
      case "welcome": {
        this.selfId = msg.selfId;
        ui.selfId = msg.selfId;
        ui.selfName = msg.name;
        ui.names.set(msg.selfId, "You");
        this.selfClassId = msg.classId;
        void this.avatar.loadFrom(playerModelUrl(msg.classId), 1.8);
        ui.self = msg.self;
        ui.inventory = msg.inventory;
        ui.learnedSpells = msg.learnedSpells;
        ui.selectedSlot = msg.selectedSlot;
        this.applyEquippedWeapon(msg.inventory);
        ui.timeOfDay = msg.timeOfDay;
        this.move = { x: msg.self.x, y: msg.self.y, z: msg.self.z, vy: msg.self.vy, grounded: msg.self.grounded };
        this.depletedNodeIds = msg.depletedNodes;
        this.nodes = new NodeManager(this.scene, msg.depletedNodes);
        for (const structure of msg.structures) this.entities.addStructure(structure);
        for (const npc of msg.npcs) this.npcManager.applySnap(npc);
        ui.questMarkers = this.npcManager.questMarkers();
        ui.questLog = msg.questLog;
        break;
      }
      case "snapshot": {
        const now = performance.now();
        ui.timeOfDay = msg.timeOfDay;
        for (const p of msg.players) {
          if (p.id !== this.selfId) ui.names.set(p.id, p.name);
        }
        for (const m of msg.mobs) {
          if (!ui.names.has(m.id)) ui.names.set(m.id, mobDef(m.type).name);
        }
        this.entities.applyPlayers(msg.players, this.selfId, now);
        this.entities.applyMobs(msg.mobs, now);
        this.entities.applyProjectiles(msg.projectiles);
        for (const npc of msg.npcs) this.npcManager.applySnap(npc);
        ui.questMarkers = this.npcManager.questMarkers();
        break;
      }
      case "self":
        this.reconcile(msg.self);
        ui.self = msg.self;
        break;
      case "inventory":
        ui.inventory = msg.items;
        ui.learnedSpells = msg.learnedSpells;
        ui.selectedSlot = msg.selectedSlot;
        this.applyEquippedWeapon(msg.items);
        break;
      case "nodeUpdate":
        this.nodes?.setDepleted(msg.nodeId, msg.depleted);
        this.regionTwoNodes?.setDepleted(msg.nodeId, msg.depleted);
        break;
      case "structureAdd":
        this.entities.addStructure(msg.structure);
        break;
      case "structureRemove":
        this.entities.removeStructure(msg.id);
        break;
      case "event":
        this.onEvent(msg);
        break;
      case "chat":
        ui.addChat(msg.channel, msg.from, msg.text);
        break;
      case "party":
        ui.party = msg.members;
        if (msg.inviteFrom) ui.pendingInvite = msg.inviteFrom;
        else if (!msg.members) ui.pendingInvite = null;
        break;
      case "pvp":
        ui.pvpEnabled = msg.enabled;
        ui.toast(msg.enabled ? "PvP enabled — you can be attacked!" : "PvP disabled");
        break;
      case "questOffer":
        ui.questOffer = { npcId: msg.npcId, npcName: msg.npcName, offers: msg.offers };
        this.setUiMode(true);
        break;
      case "questLog":
        ui.questLog = msg.quests;
        break;
      case "questComplete":
        ui.toast(`Quest complete: ${msg.questName} (+${msg.xp} XP)`);
        ui.addCombat(`Completed "${msg.questName}" — +${msg.xp} XP`);
        sound.play("levelup");
        ui.questOffer = null;
        this.setUiMode(false);
        break;
      case "error":
        if (msg.message === "__disconnected__") {
          ui.disconnected = true;
          this.running = false;
        } else if (msg.message !== "Bad message") {
          ui.toast(msg.message);
        }
        break;
    }
  }

  private onEvent(msg: Extract<ServerMsg, { t: "event" }>): void {
    switch (msg.kind) {
      case "damage":
        if (msg.x !== undefined && msg.amount) {
          const mine = msg.sourceId === this.selfId;
          const toMe = msg.targetId === this.selfId;
          if (toMe) this.avatar.play("hit");
          else if (msg.targetId) this.entities.playHit(msg.targetId);
          this.entities.spawnDamageNumber(
            msg.x,
            (msg.y ?? 0) + 0.6,
            msg.z ?? 0,
            msg.amount,
            toMe ? "#ff6b5e" : mine ? "#ffe08a" : "#d9d9d9",
          );
          if (mine || toMe) {
            ui.addCombat(
              `${ui.nameOf(msg.sourceId)} hit ${ui.nameOf(msg.targetId)} for ${Math.round(msg.amount)}`,
            );
            sound.play(toMe ? "hitTaken" : "hitFlesh");
          }
        }
        break;
      case "heal":
        if (msg.targetId === this.selfId) {
          if (msg.spellId === "shrine") ui.addCombat("You feel the shrine's blessing — fully restored");
          else ui.addCombat(`${ui.nameOf(msg.sourceId)} healed ${ui.nameOf(msg.targetId)} for ${Math.round(msg.amount ?? 0)}`);
          sound.play("levelup");
        }
        if (msg.x !== undefined && msg.amount) {
          this.entities.spawnDamageNumber(msg.x, (msg.y ?? 0) + 0.6, msg.z ?? 0, msg.amount, "#7be07b");
        }
        break;
      case "gather":
        if (msg.itemId && msg.amount) ui.toast(`+${msg.amount} ${itemDef(msg.itemId).name}`);
        break;
      case "xp":
        if (msg.amount) {
          ui.toast(`+${msg.amount} XP`);
          ui.addCombat(`You gain ${msg.amount} experience`);
        }
        break;
      case "levelup":
        ui.toast(`Level up! You are now level ${msg.amount}`);
        ui.addCombat(`You reached level ${msg.amount}!`);
        sound.play("levelup");
        // The broadcast actionAnim round-trip is fine for other players, but
        // self shouldn't wait on it for this kind of instant feedback.
        this.avatar.play("cheer");
        break;
      case "learnSpell":
        if (msg.spellId) {
          ui.toast(`Learned spell: ${msg.spellId}`);
          sound.play("craft");
        }
        break;
      case "death":
        ui.toast("You died");
        ui.addCombat("You died");
        sound.play("death");
        break;
      case "spellHit":
        sound.play("spellHit");
        // Melee/self instant spells carry sourceId (see GameServer's
        // resolveSpell) and have no projectile of their own to spawn a
        // burst on impact — do it here instead. Projectile hits already
        // get their burst from applyProjectiles' own removal handling, so
        // skip those (no sourceId) to avoid a double flash.
        if (msg.sourceId && msg.spellId && msg.x !== undefined && msg.y !== undefined && msg.z !== undefined) {
          this.entities.spawnSpellBurst(msg.x, msg.y, msg.z, msg.spellId);
        }
        break;
      case "castStart":
        if (msg.sourceId === this.selfId) sound.play("castStart");
        break;
      case "error":
        if (msg.message) ui.toast(msg.message);
        break;
    }
  }

  /** Show whichever weapon-mesh variant matches the equip slot's current
   *  item, hiding every other variant baked into the local avatar's rig. */
  private applyEquippedWeapon(items: ItemSnap[]): void {
    const weapon = items.find((i) => i.container === "equip" && i.slot === 0);
    const def = weapon ? itemDef(weapon.itemId) : null;
    const allKnown = CLASS_WEAPON_NODES[this.selfClassId as keyof typeof CLASS_WEAPON_NODES] ?? [];
    this.avatar.setWeapon(def?.weaponModel ?? [], allKnown);
    void this.avatar.setWeaponProp(def?.weaponProp ?? null);
    this.equippedWeaponDef = def;
  }

  /** The unified action bar: a slot either holds a real item (select it, same
   *  as before) or a spell marker ("spell:<id>", see the assignSpell flow in
   *  InventoryPanel) -- cast it directly instead. */
  private useHotbarSlot(slot: number): void {
    const entry = ui.inventory.find((i) => i.container === "hotbar" && i.slot === slot);
    if (entry?.itemId.startsWith("spell:")) {
      const spellId = entry.itemId.slice("spell:".length);
      this.faceTarget();
      this.connection.send({ t: "cast", spellId });
      // Instant spells (melee/self) resolve server-side with no cast bar, so
      // the server's own "casting" pose never kicks in for them — play the
      // swing predictively here, same as a plain attack, so pressing the key
      // doesn't look like nothing happened.
      if (spellDef(spellId).castTimeS <= 0) this.avatar.play("attack");
      return;
    }
    this.connection.send({ t: "selectSlot", slot });
  }

  /** Server ack + authoritative state: rewind & replay unacked inputs. */
  private reconcile(self: SelfState): void {
    this.pending = this.pending.filter((p) => p.seq > self.ackSeq);
    const serverState: MoveState = { x: self.x, y: self.y, z: self.z, vy: self.vy, grounded: self.grounded };
    const drift = dist2D(serverState.x, serverState.z, this.move.x, this.move.z);
    // Replay pending inputs from the server state; adopt result if we drifted.
    let replayed = serverState;
    for (const p of this.pending) {
      replayed = stepMovement(replayed, p, TICK_DT);
    }
    const replayDrift = dist2D(replayed.x, replayed.z, this.move.x, this.move.z) + Math.abs(replayed.y - this.move.y);
    if (replayDrift > 0.02 || drift > 3) {
      // Adopt the authoritative position, but fold the correction into a
      // decaying render error so the camera eases across it instead of
      // snapping backward (the "few steps back" rubberband).
      const ex = this.move.x - replayed.x;
      const ey = this.move.y - replayed.y;
      const ez = this.move.z - replayed.z;
      if (Math.hypot(ex, ez) < 2.5) {
        this.posError.x += ex;
        this.posError.y += ey;
        this.posError.z += ez;
      } else {
        this.posError.set(0, 0, 0); // genuine teleport/large desync: snap
      }
      this.move = replayed;
    }
    if (self.dead) this.pending = [];
  }

  private frame = (now: number): void => {
    if (this.disposed) return;
    if (this.running) requestAnimationFrame(this.frame);

    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    const actions = this.input.sample(dt);
    ui.lastDevice = this.input.lastDevice;

    // Camera orbit
    this.cameraYaw += actions.lookX;
    this.cameraPitch = clamp(this.cameraPitch + actions.lookY, -1.2, 0.5);
    ui.compassYaw = this.cameraYaw;

    const dead = ui.self?.dead ?? false;

    // Inventory toggle + menu navigation forwarding (keyboard & gamepad)
    if (actions.inventoryPressed && !dead) {
      ui.inventoryOpen = !ui.inventoryOpen;
      if (ui.inventoryOpen) ui.spellbookOpen = false;
      this.setUiMode(ui.inventoryOpen || ui.spellbookOpen);
    }

    // Spellbook toggle -- its own modal, mutually exclusive with Inventory
    // (both render a centered panel, so stacking them looks broken).
    if (actions.spellbookPressed && !dead) {
      ui.spellbookOpen = !ui.spellbookOpen;
      if (ui.spellbookOpen) ui.inventoryOpen = false;
      this.setUiMode(ui.spellbookOpen || ui.inventoryOpen);
    }

    // Dedicated gamepad Start button: a direct, always-available pause-menu
    // toggle (previously Start only opened the inventory, and the only way
    // to reach the system menu was the Escape/clear-target chain below,
    // which required a clean slate first -- easy to press and see nothing
    // happen).
    if (actions.systemMenuPressed) {
      if (ui.systemMenuOpen) this.setSystemMenuOpen(false);
      else if (!ui.inventoryOpen && !ui.chatOpen) this.setSystemMenuOpen(true);
    }

    // Menu navigation forwarding (keyboard & gamepad) -- generalized across
    // every modal panel (they all call setUiMode(true) when open), so
    // Inventory/System Menu/Quest Dialog all get the same up/down/confirm/
    // cancel handling from one dispatch. Escape is claimed by the active
    // panel's own cancel handling before the system-menu precedence chain
    // below gets a look, so a single Escape press never does two things.
    let escapeConsumedByPanel = false;
    const activePanel = ui.inventoryOpen
      ? "inventory"
      : ui.spellbookOpen
        ? "spellbook"
        : ui.systemMenuOpen
          ? "system"
          : ui.questOffer
            ? "quest"
            : null;
    if (activePanel) {
      const cancel = actions.menuCancel && !(activePanel === "inventory" && actions.inventoryPressed);
      const nav = {
        up: actions.menuUp,
        down: actions.menuDown,
        left: actions.menuLeft,
        right: actions.menuRight,
        confirm: actions.menuConfirm,
        cancel,
      };
      if (cancel) escapeConsumedByPanel = true;
      if (nav.up || nav.down || nav.left || nav.right || nav.confirm || nav.cancel) {
        window.dispatchEvent(new CustomEvent("rc:menuNav", { detail: nav }));
      }
    }

    // A party invite is a non-modal toast (doesn't call setUiMode, movement
    // stays live), so it gets its own direct confirm/cancel check rather
    // than folding into the modal-panel chain above.
    if (ui.pendingInvite && (actions.menuConfirm || actions.menuCancel)) {
      this.sendParty(actions.menuConfirm ? "accept" : "decline");
    }

    // Chat opens with Enter (keyboard flow; controller users can still read)
    if (actions.chatPressed && !ui.chatOpen && !ui.inventoryOpen && !dead) {
      ui.chatOpen = true;
      this.setUiMode(true);
    }

    // World map toggles with M, but only from a clean slate — it doesn't
    // stack on top of another panel.
    if (actions.mapPressed && !ui.inventoryOpen && !ui.spellbookOpen && !ui.systemMenuOpen && !ui.questOffer && !ui.chatOpen) {
      this.setWorldMapOpen(!ui.worldMapOpen);
    }

    // Escape precedence: close the system menu if open, else the world map,
    // else close the quest dialog if open (it has no Escape handler of its
    // own), else clear the current target, else — nothing else to close —
    // open the system menu.
    if (actions.clearTargetPressed && !escapeConsumedByPanel && performance.now() > this.suppressEscapeUntil) {
      if (ui.systemMenuOpen) {
        this.setSystemMenuOpen(false);
      } else if (ui.worldMapOpen) {
        this.setWorldMapOpen(false);
      } else if (ui.questOffer) {
        this.closeQuestDialog();
      } else if (this.entities.getTargetId()) {
        this.entities.setTarget(null);
      } else if (!ui.inventoryOpen && !ui.spellbookOpen && !ui.chatOpen) {
        this.setSystemMenuOpen(true);
      }
    }

    // Targeting: click-to-target, Shift snap/cycle.
    if (!dead) this.handleTargeting(actions);

    // UI toggles handled by HUD; here: hotbar + world actions
    if (!dead) {
      if (actions.hotbarSlot !== null) this.useHotbarSlot(actions.hotbarSlot);
      else if (actions.hotbarDelta !== 0) {
        const next = (ui.selectedSlot + actions.hotbarDelta + HOTBAR_SLOTS) % HOTBAR_SLOTS;
        this.connection.send({ t: "selectSlot", slot: next });
      }
      if (actions.attackPressed) {
        this.faceTarget();
        this.connection.send({ t: "attack" });
        this.avatar.play("attack");
      }
      if (actions.interactPressed) {
        if (this.interactNodeId) {
          this.avatar.play("gather");
          // Gather feedback: node shake, chip particles, tool sound. The
          // target node could belong to either the main map's manager or
          // Ashenpeak's (once built) — whichever one actually has it.
          if (!this.interactNodeId.startsWith("poi_")) {
            const mgr = this.nodes?.nodes.has(this.interactNodeId) ? this.nodes : this.regionTwoNodes;
            if (mgr) {
              mgr.hitNode(this.interactNodeId);
              const nt = mgr.nodes.get(this.interactNodeId)?.node.type;
              sound.play(nt === "tree" ? "chop" : nt === "rock" ? "mine" : "pick");
            }
          }
        }
        this.doInteract();
      }
      if (actions.pvpTogglePressed) this.sendPvp(!ui.pvpEnabled);
      if (actions.mountPressed) this.connection.send({ t: "mount" });
      if (actions.jump) this.jumpQueued = true;
    } else if (actions.respawnPressed) {
      this.connection.send({ t: "respawn" });
    }

    // Fixed-step prediction + input streaming (20 Hz)
    this.accumulator += dt;
    while (this.accumulator >= TICK_DT) {
      this.accumulator -= TICK_DT;
      if (!dead && ui.connected) this.stepLocal(actions);
    }

    // Decay the reconcile error so the smoothed render position eases to the
    // authoritative one over ~150ms (hides the "few steps back" snap).
    const decay = Math.exp(-dt * 12);
    this.posError.multiplyScalar(decay);
    if (this.posError.lengthSq() < 1e-6) this.posError.set(0, 0, 0);
    const rx = this.move.x + this.posError.x;
    const ry = this.move.y + this.posError.y;
    const rz = this.move.z + this.posError.z;
    ui.playerX = rx;
    ui.playerZ = rz;

    // Avatar + camera + world updates (rendered at the smoothed position)
    this.syncMount();
    const riderLift = this.mountMesh?.riderY ?? 0;
    this.avatar.group.position.set(rx, ry + riderLift, rz);
    this.avatar.group.rotation.y = this.cameraYaw;
    if (this.mountMesh) {
      this.mountMesh.group.position.set(rx, ry, rz);
      this.mountMesh.group.rotation.y = this.cameraYaw;
    }
    this.animateSelf(dt, actions);
    this.updateCamera(rx, ry, rz);
    this.nodes?.update(rx, rz, now, dt);
    this.regionTwoNodes?.update(rx, rz, now, dt);
    this.grass.update(rx, rz, now);
    this.entities.update(now, dt);
    animateSettlements(this.settlements, now);
    this.updateInteractPrompt();
    this.updateDayNight(rx, rz);
    this.clouds.update(dt);
    this.water.update(dt);
    this.updateZoneAndStreaming(rx, rz);

    this.renderer.render(this.scene, this.camera);
  };

  /** Add/remove the mount mesh under the rider when the mount state changes. */
  private syncMount(): void {
    const want = ui.self?.mount ?? null;
    if (want === this.currentMount) return;
    if (this.mountMesh) {
      this.scene.remove(this.mountMesh.group);
      this.mountMesh = null;
    }
    if (want === "horse") this.mountMesh = buildHorse();
    else if (want === "raft") this.mountMesh = buildRaft();
    if (this.mountMesh) this.scene.add(this.mountMesh.group);
    // Mount/dismount audio cue.
    sound.play(want ? "craft" : "ui");
    this.currentMount = want;
  }

  /** Named-zone banner (WoW-style) + lazy village streaming as the player travels. */
  private updateZoneAndStreaming(x: number, z: number): void {
    const zone = zoneAt(x, z);
    ui.enterZone(zone.id, zone.name, zone.subtitle);

    for (const village of generateVillages()) {
      if (this.streamedVillages.has(village.id)) continue;
      if (dist2D(x, z, village.x, village.z) < this.STREAM_RADIUS) {
        this.streamedVillages.add(village.id);
        buildVillage(this.scene, village, true);
      }
    }

    // Ashenpeak (region 2): nothing about it exists in the scene until the
    // player is already well inside the valley approach — built once, then
    // stays resident (its own NodeManager reuses the same VISIBLE_RADIUS
    // windowing as the main map's, unaffected by this outer gate).
    if (!this.regionTwoBuilt && dist2D(x, z, REGION_TWO_GATE_X, REGION_TWO_GATE_Z) < REGION_TWO_TRIGGER_RADIUS) {
      this.regionTwoBuilt = true;
      const centerZ = (VALLEY_START_Z + REGION_TWO_MAX_Z) / 2;
      const sizeZ = REGION_TWO_MAX_Z - VALLEY_START_Z;
      this.scene.add(buildRegionTerrain(0, centerZ, ZONE_SIZE, sizeZ));
      this.regionTwoNodes = new NodeManager(this.scene, this.depletedNodeIds, generateRegionTwoNodes());
    }
  }

  private readonly TARGET_RANGE = 60;

  private handleTargeting(actions: ReturnType<InputManager["sample"]>): void {
    if (actions.targetPressed) {
      // CapsLock: select nearest, cycle to the next, or deselect when the
      // current target is the only enemy nearby.
      const enemies = this.entities.enemiesByProximity(
        this.camera,
        this.move.x,
        this.move.z,
        this.TARGET_RANGE,
        this.selfId,
      );
      const cur = this.entities.getTargetId();
      if (enemies.length === 0) {
        this.entities.setTarget(null);
      } else if (!cur || !enemies.includes(cur)) {
        this.entities.setTarget(enemies[0]!);
        sound.play("target");
      } else if (enemies.length === 1) {
        // Only the current target is near → deselect it.
        this.entities.setTarget(null);
      } else {
        const next = (enemies.indexOf(cur) + 1) % enemies.length;
        this.entities.setTarget(enemies[next]!);
        sound.play("target");
      }
    }
    // Publish target info to the HUD (auto-clears on death/despawn).
    ui.target = this.entities.entityInfo(this.entities.getTargetId());
  }

  /** Snap facing toward the current target so melee/spells connect. */
  private faceTarget(): void {
    const tid = this.entities.getTargetId();
    if (!tid) return;
    const pos = this.entities.entityWorldPos(tid);
    if (!pos) return;
    const yaw = Math.atan2(pos.x - this.move.x, pos.z - this.move.z);
    this.cameraYaw = yaw;
    ui.compassYaw = yaw;
    // Send an immediate facing input so the server updates yaw before it
    // resolves the attack/cast message that follows this frame.
    const seq = ++this.inputSeq;
    const input = { moveX: 0, moveZ: 0, jump: false, sprint: false, block: false };
    this.pending.push({ seq, ...input, mount: ui.self?.mount ?? null });
    this.connection.send({ t: "input", seq, ...input, yaw });
  }

  private stepLocal(actions: ReturnType<InputManager["sample"]>): void {
    // Blocking/sitting root the player in place -- mirrors the server's own
    // rooting in tickPlayerMovement so client prediction doesn't drift ahead
    // before the correction arrives.
    const rooted = actions.block || (ui.self?.sitting ?? false);

    // Camera-relative movement -> world space. Camera looks along
    // forward = (sin yaw, cos yaw); screen-right is (-cos yaw, sin yaw).
    const sin = Math.sin(this.cameraYaw);
    const cos = Math.cos(this.cameraYaw);
    const moveX = rooted ? 0 : -actions.moveX * cos - actions.moveY * sin;
    const moveZ = rooted ? 0 : actions.moveX * sin - actions.moveY * cos;

    const input = {
      moveX,
      moveZ,
      jump: this.jumpQueued,
      sprint: actions.sprint,
      block: actions.block,
    };
    this.jumpQueued = false;
    const mount = ui.self?.mount ?? null;

    const seq = ++this.inputSeq;
    this.pending.push({ seq, ...input, mount });
    if (this.pending.length > 120) this.pending.shift();

    // Predict with the mount so speed matches the server; the wire message
    // omits mount (server is authoritative on mount state).
    this.move = stepMovement(this.move, { ...input, mount }, TICK_DT);
    this.connection.send({ t: "input", seq, ...input, yaw: this.cameraYaw });
  }

  private animateSelf(dt: number, actions: ReturnType<InputManager["sample"]>): void {
    this.animTime += dt;
    // Clamp to match stepMovement's own diagonal normalization -- otherwise
    // holding two movement keys (e.g. forward+strafe) inflates this to
    // sqrt(2) and the walk/run cycle visibly outruns the actual translation.
    const inputMag = Math.min(1, Math.hypot(actions.moveX, actions.moveY));
    this.lastAnimSpeed += (inputMag - this.lastAnimSpeed) * Math.min(1, dt * 10);

    // Priority mirrors the server's own playerAnim(): dead > sit > block >
    // jump > cast > idle. vy is only ever nonzero mid-jump/fall -- swimming
    // pins it to exactly 0 even though `grounded` is also false there, so
    // checking vy (not grounded) keeps the jump pose from showing while
    // treading water.
    const serverAnim = ui.self?.dead
      ? "dead"
      : ui.self?.sitting
        ? "sit"
        : actions.block
          ? "block"
          : this.move.vy !== 0
            ? "jump"
            : ui.self?.castingSpell
              ? "cast"
              : "idle";
    const speed = this.lastAnimSpeed * (actions.sprint ? 6.8 : 4.6);
    const logical = logicalFromState(serverAnim, speed, 3.5, actions.moveX, actions.moveY);
    const overrides =
      logical === "cast"
        ? this.equippedWeaponDef?.castAnim
        : logical === "attack"
          ? this.equippedWeaponDef?.attackAnim
          : undefined;
    this.avatar.play(logical, overrides);
    this.avatar.update(dt);
  }

  private updateCamera(px: number, py: number, pz: number): void {
    const cy = this.cameraYaw;
    const cp = this.cameraPitch;
    const horizontal = CAMERA_DISTANCE * Math.cos(cp);
    const targetX = px - Math.sin(cy) * horizontal;
    const targetZ = pz - Math.cos(cy) * horizontal;
    let targetY = py + CAMERA_HEIGHT - CAMERA_DISTANCE * Math.sin(cp);

    // Keep the camera above the terrain.
    const ground = terrainHeight(targetX, targetZ);
    targetY = Math.max(targetY, ground + 0.6, WATER_LEVEL + 0.4);

    this.camera.position.set(targetX, targetY, targetZ);
    this.camera.lookAt(px, py + 1.5, pz);
  }

  private updateInteractPrompt(): void {
    if (!this.nodes || (ui.self?.dead ?? false)) {
      ui.interactLabel = null;
      return;
    }
    if (ui.self?.sitting) {
      ui.interactLabel = "Stand";
      this.nearCampfire = false;
      return;
    }
    const node =
      this.nodes.findTarget(this.move.x, this.move.y, this.move.z, this.cameraYaw, GATHER_RANGE) ??
      this.regionTwoNodes?.findTarget(this.move.x, this.move.y, this.move.z, this.cameraYaw, GATHER_RANGE) ??
      null;
    if (node) {
      const def = nodeTypeDef(node.type);
      const verb = node.type === "tree" ? "Chop" : node.type === "rock" ? "Mine" : "Pick";
      ui.interactLabel = `${verb} ${def.name}`;
      this.interactNodeId = node.id;
      return;
    }
    // Quest giver nearby?
    const npc = this.npcManager.nearest(this.move.x, this.move.z, 4.5);
    if (npc) {
      ui.interactLabel = `Talk to ${npc.name}`;
      this.interactNodeId = npc.id;
      return;
    }
    this.interactNodeId = null;
    // Shrine nearby?
    for (const shrine of this.settlements.shrines) {
      if (dist2D(this.move.x, this.move.z, shrine.x, shrine.z) < 4.5) {
        ui.interactLabel = "Pray at the Shrine";
        this.interactNodeId = shrine.id;
        return;
      }
    }
    // Water nearby?
    if (this.nearWater()) {
      ui.interactLabel = "Drink";
      this.nearCampfire = false;
      return;
    }
    // Campfire nearby?
    this.nearCampfire = this.entities.structureNear(this.move.x, this.move.z, 4);
    ui.interactLabel = this.nearCampfire ? "Sit" : null;
  }

  private interactNodeId: string | null = null;
  private nearCampfire = false;

  private nearWater(): boolean {
    const { x, y, z } = this.move;
    if (y < WATER_LEVEL + 0.5) return true;
    for (const [dx, dz] of [
      [3, 0],
      [-3, 0],
      [0, 3],
      [0, -3],
    ] as const) {
      if (terrainHeight(x + dx, z + dz) < WATER_LEVEL) return true;
    }
    return false;
  }

  private doInteract(): void {
    if (ui.self?.sitting || this.nearCampfire) {
      this.connection.send({ t: "sit" });
    } else if (this.interactNodeId) {
      this.connection.send({ t: "interact", nodeId: this.interactNodeId });
    } else if (this.nearWater()) {
      this.connection.send({ t: "drink" });
    }
  }

  private updateDayNight(px: number, pz: number): void {
    const t = ui.timeOfDay; // 0..1, 0.5 = midnight-ish; 0.25 = noon-ish given +0.3 offset
    const angle = t * Math.PI * 2;
    const elevation = Math.sin(angle);
    // The sun's shadow frustum is a modest, high-res box that follows the
    // player, rather than one huge low-res box covering the whole zone.
    this.sun.position.set(px + Math.cos(angle) * 120, Math.max(20, elevation * 140), pz + 40);
    this.sun.target.position.set(px, 0, pz);
    const dayness = clamp(elevation * 1.6 + 0.25, 0.04, 1);
    this.sun.intensity = 2.4 * dayness;
    this.ambient.intensity = 0.2 + 0.6 * dayness;

    const day = new THREE.Color(0x87b5d9);
    const night = new THREE.Color(0x0b1226);
    const sky = night.clone().lerp(day, dayness);
    (this.scene.background as THREE.Color).copy(sky);
    this.scene.fog!.color.copy(sky);
    this.clouds.setDayness(dayness);
  }

  // ============ hooks for HUD ============

  sendChat(text: string, channel: "realm" | "party" = "realm"): void {
    this.connection.send({ t: "chat", channel, text });
  }

  sendParty(action: "invite" | "accept" | "decline" | "leave", name?: string): void {
    this.connection.send({ t: "party", action, name });
  }

  sendPvp(enabled: boolean): void {
    this.connection.send({ t: "pvp", enabled });
  }

  sendQuestAction(action: "accept" | "decline" | "turnin", questId: string): void {
    if (action !== "decline") this.connection.send({ t: "quest", action, questId });
    sound.play("ui");
  }

  closeQuestDialog(): void {
    ui.questOffer = null;
    this.setUiMode(false);
  }

  sendCraft(recipeId: string): void {
    this.connection.send({ t: "craft", recipeId });
    sound.play("craft");
  }

  sendConsume(container: "inventory" | "hotbar" | "equip", slot: number): void {
    this.connection.send({ t: "consume", container, slot });
    sound.play("eat");
  }

  sendPlace(container: "inventory" | "hotbar" | "equip", slot: number): void {
    this.connection.send({ t: "place", container, slot });
  }

  sendMoveItem(
    fc: "inventory" | "hotbar" | "equip",
    fs: number,
    tc: "inventory" | "hotbar" | "equip",
    ts: number,
  ): void {
    this.connection.send({ t: "moveItem", fromContainer: fc, fromSlot: fs, toContainer: tc, toSlot: ts });
  }

  /** Pull a *newly chosen* spell from the spellbook into a hotbar slot (or
   *  clear it with spellId: null). Rearranging a spell already slotted uses
   *  sendMoveItem instead -- both ends are already "hotbar". */
  sendAssignSpell(spellId: string | null, slot: number): void {
    this.connection.send({ t: "assignSpell", spellId, slot });
  }

  sendRespawn(): void {
    this.connection.send({ t: "respawn" });
  }

  setUiMode(open: boolean): void {
    this.input.uiMode = open;
    if (open) this.input.releasePointer();
  }

  setSystemMenuOpen(open: boolean): void {
    ui.systemMenuOpen = open;
    this.setUiMode(
      open || ui.inventoryOpen || ui.spellbookOpen || ui.chatOpen || ui.questOffer !== null || ui.worldMapOpen,
    );
  }

  setWorldMapOpen(open: boolean): void {
    ui.worldMapOpen = open;
    this.setUiMode(
      open || ui.inventoryOpen || ui.spellbookOpen || ui.chatOpen || ui.questOffer !== null || ui.systemMenuOpen,
    );
  }

  get inputManager(): InputManager {
    return this.input;
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  /** Browsers exit fullscreen on Escape at the UA level and some of them
   *  never deliver that keydown to page scripts, so our own Escape handling
   *  in `frame()` never runs and the player is stuck needing a second press
   *  just to open the menu. Treat "fullscreen just exited, menu not already
   *  open" as that same intent and open it directly; suppress the next
   *  Escape briefly in case the keydown does also arrive, so it doesn't
   *  immediately toggle the menu shut again. */
  private onFullscreenChange = (): void => {
    if (!document.fullscreenElement && !ui.systemMenuOpen) {
      this.setSystemMenuOpen(true);
      this.suppressEscapeUntil = performance.now() + 400;
    }
  };

  dispose(): void {
    this.disposed = true;
    this.running = false;
    if (this.mountMesh) {
      this.scene.remove(this.mountMesh.group);
      this.mountMesh = null;
    }
    this.unsubscribe?.();
    this.connection.disconnect();
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("fullscreenchange", this.onFullscreenChange);
    this.renderer.dispose();
  }
}
