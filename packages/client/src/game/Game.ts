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
  REVIVE_RANGE,
  DODGE_DISTANCE,
  DUNGEON_PORTAL_ACTIVATION_RADIUS,
  dungeonTierDef,
  dungeonPortalAt,
  generateDungeonLayout,
  TIER_NAMES,
  WORLD_MIN_X,
  WORLD_MAX_X,
  WORLD_MIN_Z,
  WORLD_MAX_Z,
  type MoveState,
  type ServerMsg,
  type SelfState,
  type ItemSnap,
  type ItemDef,
  type PoiSpec,
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
import { AnimatedModel, PLAYER_ANIMS, logicalFromState, dodgeLogicalFor } from "../render/gltf";
import { buildWorldStatic, buildVillage, animateSettlements, type SettlementHandles } from "../render/settlements";
import { DUNGEON_THEME_COLORS, buildDungeonInterior } from "../render/dungeonInterior";
import { NpcManager } from "../render/npcs";
import { sound } from "./sound";
import { game as ui, type CharacterTab } from "../ui/gameState.svelte";

const CAMERA_DISTANCE = 6.5;
const CAMERA_HEIGHT = 2.2;
const GATHER_RANGE = 4.0;
/** Left-to-right tab order for gamepad LB/RB cycling in the character screen. */
const TAB_ORDER: CharacterTab[] = ["inventory", "quests", "spellbook", "craft", "party", "system"];

interface PendingInput {
  seq: number;
  moveX: number;
  moveZ: number;
  jump: boolean;
  sprint: boolean;
  block: boolean;
  mount: "horse" | "raft" | null;
  revivingId: string | null;
  inDungeon?: boolean;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private sun: THREE.DirectionalLight;
  private ambient: THREE.AmbientLight;
  /** Set while standing inside a dungeon's enclosed room -- drives the
   *  day/night override in updateDayNight (fixed themed lighting instead
   *  of the outdoor sky/sun). */
  private insideDungeonPortal: PoiSpec | null = null;
  private activeDungeonGroup: THREE.Group | null = null;
  private activeDungeonPortalId: string | null = null;

  private connection = new Connection();
  private input: InputManager;
  private nodes!: NodeManager;
  readonly entities!: EntityManager;
  private settlements!: SettlementHandles;
  private overworldSigns: THREE.Object3D[] = [];
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
  /** `this.move` right before the most recently completed 20Hz sim tick --
   *  the render position lerps from here to `this.move` using the
   *  leftover accumulator fraction, so the camera/avatar advance every
   *  rendered frame instead of holding still for ~2 of every 3 frames at
   *  60fps (20Hz sim / 60fps render). That static-then-jump stepping is
   *  invisible on its own (nothing to compare it to) but reads as judder
   *  the instant something else on screen (a mob, your pet) is moving via
   *  smooth per-frame interpolation -- worse the faster you move, since a
   *  bigger per-tick step is more visible held static for those 2 frames. */
  private tickRenderFrom = { x: 0, y: 4, z: 0 };
  private cameraYaw = 0;
  private cameraPitch = -0.35;
  private inputSeq = 0;
  private pending: PendingInput[] = [];
  /** A locally-predicted dodge displacement not yet reflected in the
   *  server's own position -- dodge isn't part of the continuous `pending`
   *  input stream (see PendingInput), so reconcile() can't replay it the
   *  way it replays ordinary movement. Without this, a "self" packet that
   *  arrives before the server has processed the dodge message looks like
   *  several meters of unexplained drift and gets pulled straight back.
   *  Cleared once enough time has passed for the round trip to complete. */
  private pendingDodges: Array<{ dx: number, dz: number, until: number, waitSeq: number }> = [];
  private lastDodgeTime: number = 0;
  private accumulator = 0;
  private lastFrame = performance.now();
  private jumpQueued = false;
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
    this.overworldSigns.push(...this.settlements.signs);
    this.npcManager = new NpcManager(this.scene);
    this.grass = new GrassField(this.scene);

    this.avatar = new AnimatedModel(PLAYER_ANIMS);
    const plate = buildNameplate(characterName, "#ffe9a8");
    plate.position.y = 2.35;
    this.avatar.group.add(plate);
    this.scene.add(this.avatar.group);

    this.entities = new EntityManager(this.scene);
    this.entities.prewarmVfx(this.renderer, this.camera);
    this.input = new InputManager(canvas);

    window.addEventListener("resize", this.onResize);

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
        ui.classId = msg.classId;
        ui.serverTimeOffset = msg.serverTime - Date.now();
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
        this.entities.applyPets(msg.pets, now);
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
        // inviteFrom is only ever set on the one message meant to show the
        // prompt -- every other party update (accept confirmation, leave,
        // disband, the periodic refresh) omits it, so clearing unless it's
        // present is always correct (was previously gated on `!msg.members`
        // too, which never fired on accept since the join confirmation
        // *has* members, leaving the stale invite banner stuck on screen).
        ui.pendingInvite = msg.inviteFrom ?? null;
        break;
      case "pvp":
        ui.pvpEnabled = msg.enabled;
        ui.toast(msg.enabled ? "PvP enabled — you can be attacked!" : "PvP disabled");
        break;
      case "roster":
        ui.roster = msg.players;
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
      case "dungeonState": {
        const wasInDungeon = ui.dungeonState !== null;
        if (msg.inDungeon && msg.tier !== null) {
          ui.dungeonState = { tier: msg.tier, partySize: msg.partySize, mobsRemaining: msg.mobsRemaining };
          // The server just teleported us in (or reconnected us mid-run) --
          // clear anything tied to the old location, same as death already
          // forces, since reconcile()'s large-desync snap handles the
          // position jump itself with no extra code needed here.
          if (!wasInDungeon) {
            this.interactNodeId = null;
            this.reviveTargetId = null;
            this.entities.setTarget(null);
            ui.inventoryOpen = false;
            ui.worldMapOpen = false;
            if (ui.questOffer) this.closeQuestDialog();
          }
        } else {
          ui.dungeonState = null;
        }
        break;
      }
      case "dungeonComplete": {
        const itemNames = msg.items.map((i) => `${i.qty}x ${itemDef(i.itemId).name}`).join(", ");
        ui.toast(`Dungeon cleared! +${msg.xp} XP${itemNames ? ` — ${itemNames}` : ""}`);
        ui.addCombat(`Cleared the dungeon — +${msg.xp} XP${itemNames ? `, ${itemNames}` : ""}`);
        sound.play("levelup");
        break;
      }
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
      case "revive":
        if (msg.targetId === this.selfId) {
          ui.toast(`${ui.nameOf(msg.sourceId)} revived you!`);
          sound.play("levelup");
        }
        ui.addCombat(`${ui.nameOf(msg.sourceId)} revived ${ui.nameOf(msg.targetId)}`);
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
      case "dodge":
        // Our own dodge is already predicted (see tryDodge) -- this broadcast
        // only needs to drive *other* players' animation + burst, same as
        // hit reactions are triggered off other players' damage events.
        if (msg.sourceId && msg.sourceId !== this.selfId && msg.x !== undefined && msg.dirX !== undefined && msg.dirZ !== undefined) {
          this.entities.playDodge(msg.sourceId, msg.dirX, msg.dirZ);
          this.entities.spawnDodgeBurst(msg.x, msg.y ?? 0, msg.z ?? 0, msg.dirX, msg.dirZ);
        }
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
   *  CharacterScreen) -- cast it directly instead. */
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
    
    // A dodge round-trip hasn't necessarily finished yet -- assume the
    // server's position is about to include it too, so the gap it opens up
    // isn't mistaken for drift and reconciled straight back out.
    if (this.pendingDodges && this.pendingDodges.length > 0) {
      const now = performance.now();

      // 1. Remove any dodges the server has officially processed (ackSeq caught up) 
      // or that have timed out (500ms safety net).
      this.pendingDodges = this.pendingDodges.filter(d => 
        self.ackSeq < d.waitSeq && now < d.until
      );

      // 2. Apply the visual offset ONLY for dodges the server hasn't seen yet
      for (const d of this.pendingDodges) {
        serverState.x += d.dx;
        serverState.z += d.dz;
      }
    }

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
        // Also drop the tick-interpolation reference, or the next render
        // would glide from the pre-teleport spot to here over the leftover
        // accumulator fraction instead of snapping immediately.
        this.tickRenderFrom = { x: replayed.x, y: replayed.y, z: replayed.z };
      }
      this.move = replayed;
    }
    
    if (self.dead) {
      this.pending = [];
      this.pendingDodges = []; // Clear dodge queue if dead
    }
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

    // Character screen toggle -- Tab/I/K/J/O (and gamepad Start) each open the
    // same full-page panel directly on their own tab, or close it if it's
    // already open showing that tab. One shared panel, not separate modals.
    if (actions.inventoryPressed && !dead) this.toggleTab("inventory");
    if (actions.spellbookPressed && !dead) this.toggleTab("spellbook");
    if (actions.craftingPressed && !dead) this.toggleTab("craft");
    if (actions.systemPressed && !dead) this.toggleTab("system");
    if (actions.systemMenuPressed && !dead) this.toggleTab("system");

    // LB/RB cycle between tabs while the character screen is open -- the
    // same two bumpers that chord-select action-bar slots during gameplay,
    // repurposed here since there's nothing for them to modify in a menu.
    if (ui.inventoryOpen && (actions.tabPrevPressed || actions.tabNextPressed)) {
      const i = TAB_ORDER.indexOf(ui.activeTab);
      const delta = actions.tabNextPressed ? 1 : -1;
      ui.activeTab = TAB_ORDER[(i + delta + TAB_ORDER.length) % TAB_ORDER.length]!;
    }

    // Menu navigation forwarding (keyboard & gamepad) -- generalized across
    // every modal panel (they all call setUiMode(true) when open), so the
    // character screen and Quest Dialog get the same up/down/confirm/cancel
    // handling from one dispatch.
    let escapeConsumedByPanel = false;
    const activePanel = ui.inventoryOpen ? "inventory" : ui.questOffer ? "quest" : null;
    if (activePanel) {
      const cancel = actions.menuCancel && !(activePanel === "inventory" && actions.inventoryPressed);
      const nav = {
        up: actions.menuUp,
        down: actions.menuDown,
        left: actions.menuLeft,
        right: actions.menuRight,
        confirm: actions.menuConfirm,
        cancel,
        clear: actions.menuClear,
      };
      if (cancel) escapeConsumedByPanel = true;
      if (nav.confirm && ui.inventoryOpen && ui.activeTab === "system") {
        const sub = (window as any).__systemTabSub;
        const focus = (window as any).__systemSubFocus;
        const cursor = (window as any).__systemCursor;
        if (sub === "game" && focus === "content" && cursor === 0) {
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen().catch(() => {});
        }
      }
      if (nav.up || nav.down || nav.left || nav.right || nav.confirm || nav.cancel || nav.clear) {
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
    if (actions.mapPressed && !ui.inventoryOpen && !ui.questOffer && !ui.chatOpen) {
      this.setWorldMapOpen(!ui.worldMapOpen);
    }

    // Gamepad B ("back"): close the world map, else the quest dialog, else
    // clear the current target. No keyboard key drives this any more --
    // Escape is intentionally a no-op in this game beyond the browser's own
    // built-in "exit fullscreen" handling, so there's nothing to mirror here.
    if (actions.clearTargetPressed && !escapeConsumedByPanel) {
      if (ui.worldMapOpen) {
        this.setWorldMapOpen(false);
      } else if (ui.questOffer) {
        this.closeQuestDialog();
      } else if (this.entities.getTargetId()) {
        this.selectTarget(null);
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
      if (actions.dodgePressed) this.tryDodge(actions);
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
      this.tickRenderFrom.x = this.move.x;
      this.tickRenderFrom.y = this.move.y;
      this.tickRenderFrom.z = this.move.z;
      this.accumulator -= TICK_DT;
      if (!dead && ui.connected) this.stepLocal(actions);
    }

    // Decay the reconcile error so the smoothed render position eases to the
    // authoritative one over ~150ms (hides the "few steps back" snap).
    const decay = Math.exp(-dt * 12);
    this.posError.multiplyScalar(decay);
    if (this.posError.lengthSq() < 1e-6) this.posError.set(0, 0, 0);
    // Render between the last two completed ticks instead of holding at
    // whichever one most recently finished -- see tickRenderFrom's comment.
    const tickAlpha = Math.min(1, this.accumulator / TICK_DT);
    const smoothX = this.tickRenderFrom.x + (this.move.x - this.tickRenderFrom.x) * tickAlpha;
    const smoothY = this.tickRenderFrom.y + (this.move.y - this.tickRenderFrom.y) * tickAlpha;
    const smoothZ = this.tickRenderFrom.z + (this.move.z - this.tickRenderFrom.z) * tickAlpha;
    const rx = smoothX + this.posError.x;
    const ry = smoothY + this.posError.y;
    const rz = smoothZ + this.posError.z;
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

  private updateZoneAndStreaming(x: number, z: number): void {
    this.insideDungeonPortal = ui.dungeonState ? dungeonPortalAt(x, z) : null;

    const zone = zoneAt(x, z, !!this.insideDungeonPortal);
    ui.enterZone(zone.id, zone.name, zone.subtitle);

    const showSigns = !this.insideDungeonPortal;
    for (const sign of this.overworldSigns) {
      if (sign.visible !== showSigns) {
        sign.visible = showSigns;
      }
    }

    if (this.insideDungeonPortal) {
      if (this.activeDungeonPortalId !== this.insideDungeonPortal.id) {
        if (this.activeDungeonGroup) {
          this.scene.remove(this.activeDungeonGroup);
          this.disposeHierarchy(this.activeDungeonGroup);
          this.activeDungeonGroup = null;
        }
        this.activeDungeonPortalId = this.insideDungeonPortal.id;
        this.activeDungeonGroup = new THREE.Group();
        const layout = generateDungeonLayout(this.insideDungeonPortal.id);
        const tier = this.insideDungeonPortal.dungeonTier ?? 0;
        const theme = dungeonTierDef(tier).theme;
        buildDungeonInterior(this.activeDungeonGroup, layout, theme);
        this.scene.add(this.activeDungeonGroup);
      }
    } else {
      if (this.activeDungeonGroup) {
        this.scene.remove(this.activeDungeonGroup);
        this.disposeHierarchy(this.activeDungeonGroup);
        this.activeDungeonGroup = null;
        this.activeDungeonPortalId = null;
      }
    }
    for (const village of generateVillages()) {
      if (this.streamedVillages.has(village.id)) continue;
      if (dist2D(x, z, village.x, village.z) < this.STREAM_RADIUS) {
        this.streamedVillages.add(village.id);
        const vSigns = buildVillage(this.scene, village, true);
        for (const sign of vSigns) {
          sign.visible = !this.insideDungeonPortal;
        }
        this.overworldSigns.push(...vSigns);
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
        this.selectTarget(null);
      } else if (!cur || !enemies.includes(cur)) {
        this.selectTarget(enemies[0]!);
        sound.play("target");
      } else if (enemies.length === 1) {
        // Only the current target is near → deselect it.
        this.selectTarget(null);
      } else {
        const next = (enemies.indexOf(cur) + 1) % enemies.length;
        this.selectTarget(enemies[next]!);
        sound.play("target");
      }
    }
    // Publish target info to the HUD (auto-clears on death/despawn).
    ui.target = this.entities.entityInfo(this.entities.getTargetId());
  }

  private selectTarget(id: string | null): void {
    this.entities.setTarget(id);
    this.connection.send({ t: "selectTarget", targetId: id });
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
    const input = { moveX: 0, moveZ: 0, jump: false, sprint: false, block: false, revivingId: null };
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
      revivingId: actions.interactHeld ? this.reviveTargetId : null,
    };
    this.jumpQueued = false;
    const mount = ui.self?.mount ?? null;

    const inDungeon = ui.dungeonState !== null;
    const seq = ++this.inputSeq;
    this.pending.push({ seq, ...input, mount, inDungeon });
    if (this.pending.length > 120) this.pending.shift();

    // Predict with the mount so speed matches the server; the wire message
    // omits mount (server is authoritative on mount state).
    this.move = stepMovement(this.move, { ...input, mount, inDungeon }, TICK_DT);
    this.connection.send({ t: "input", seq, ...input, yaw: this.cameraYaw });
  }


/** Predicted locally (position + animation + burst) exactly like a normal
   * attack swing, then confirmed server-side (see GameServer.handleDodge) --
   * the server is authoritative on charges/distance, so a reconcile will
   * correct this if the two ever disagree. Direction comes from whatever
   * movement keys are held (same camera-relative transform as stepLocal),
   * defaulting to straight forward when no input is held. */
  private tryDodge(actions: ReturnType<InputManager["sample"]>): void {
    if (!ui.self || ui.self.dodgeCharges <= 0) return;

    const now = performance.now();

    // FIX 6: Add a local cooldown to match the server's anti-spam cooldown.
    // This prevents the client from predicting dodges the server will reject.
    if (now - this.lastDodgeTime < 400) return;
    
    // Update the cooldown tracker immediately
    this.lastDodgeTime = now;

    // Deduct the charge locally to prevent prediction spam before the server responds.
    ui.self.dodgeCharges--;

    const hasInput = Math.abs(actions.moveX) > 0.05 || Math.abs(actions.moveY) > 0.05;
    const moveX = hasInput ? actions.moveX : 0;
    const moveY = hasInput ? actions.moveY : -1; // -1 = W = forward
    const sin = Math.sin(this.cameraYaw);
    const cos = Math.cos(this.cameraYaw);
    const dirX = -moveX * cos - moveY * sin;
    const dirZ = moveX * sin - moveY * cos;
    const mag = Math.hypot(dirX, dirZ) || 1;
    const nx = dirX / mag;
    const nz = dirZ / mag;

    const oldX = this.move.x;
    const oldY = this.move.y; // Store old Y for smoothing
    const oldZ = this.move.z;
    
    // Calculate raw target
    const rawTx = oldX + nx * DODGE_DISTANCE;
    const rawTz = oldZ + nz * DODGE_DISTANCE;

    // Clamp target locally to match server world bounds so we don't 
    // predict dodging out of bounds and snap back.
    const tx = clamp(rawTx, WORLD_MIN_X, WORLD_MAX_X);
    const tz = clamp(rawTz, WORLD_MIN_Z, WORLD_MAX_Z);

    this.move.x = tx;
    this.move.z = tz;
    this.move.y = Math.max(oldY, terrainHeight(tx, tz));

    // `this.move` (used for hit-detection/server-sync) jumps straight to the
    // target, but ease the *render* across the burst instead of a hard cut.
    this.posError.x += oldX - tx;
    this.posError.y += oldY - this.move.y; // Smooth out terrain height changes
    this.posError.z += oldZ - tz;

    // Grab the sequence number of the most recent input we've sent
    // so we know exactly when the server has processed this dodge.
    const currentSeq = this.pending.length > 0 ? this.pending[this.pending.length - 1]!.seq : 0;

    // Instead of overwriting a single object, we push each dodge into a queue.
    this.pendingDodges.push({
      dx: tx - oldX,
      dz: tz - oldZ,
      until: now + 500, // Visual safety net fallback
      waitSeq: currentSeq + 1
    });

    this.avatar.play(dodgeLogicalFor(this.cameraYaw, nx, nz));
    this.entities.spawnDodgeBurst(tx, this.move.y, tz, nx, nz);

    // Send the normalized dodge direction only; the server owns the final
    // movement resolution and collision/charge validation.
    this.connection.send({ t: "dodge", dirX: nx, dirZ: nz });
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
    // A downed ally takes priority over routine gathering/interaction.
    const dead = this.entities.nearestDeadPlayer(this.move.x, this.move.z, REVIVE_RANGE);
    if (dead) {
      ui.interactLabel = `Hold to Revive ${dead.name}`;
      this.reviveTargetId = dead.id;
      this.interactNodeId = null;
      return;
    }
    this.reviveTargetId = null;
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
    // Dungeon portal nearby? Radius matches the server's own authoritative
    // DUNGEON_PORTAL_ACTIVATION_RADIUS check -- the server still decides
    // leader/party validity and sends an error toast if it's rejected, but
    // the level requirement is worth surfacing upfront so it's not a
    // surprise (this is purely cosmetic -- the server enforces it for real).
    for (const portal of this.settlements.dungeonPortals) {
      if (dist2D(this.move.x, this.move.z, portal.x, portal.z) < DUNGEON_PORTAL_ACTIVATION_RADIUS) {
        const tierDef = dungeonTierDef(portal.tier);
        const underLevel = (ui.self?.level ?? 1) < tierDef.minLevel;
        ui.interactLabel = underLevel
          ? `Enter ${TIER_NAMES[portal.tier]} Dungeon (Requires Level ${tierDef.minLevel})`
          : `Enter ${TIER_NAMES[portal.tier]} Dungeon`;
        this.interactNodeId = portal.id;
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
  private reviveTargetId: string | null = null;
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
    if (this.insideDungeonPortal) {
      // Sealed chamber -- fixed themed torchlight regardless of the
      // outdoor time of day, tight fog so the doorway gap doesn't reveal a
      // jarring outdoor boundary.
      const theme = DUNGEON_THEME_COLORS[dungeonTierDef(this.insideDungeonPortal.dungeonTier ?? 0).theme];
      this.sun.intensity = 0;
      this.ambient.intensity = 0.55;
      this.ambient.color.set(theme.torchColor);
      const sky = new THREE.Color(theme.ceilingTint).multiplyScalar(0.35);
      (this.scene.background as THREE.Color).copy(sky);
      this.scene.fog!.color.copy(sky);
      if (this.scene.fog instanceof THREE.Fog) {
        this.scene.fog.near = 4;
        this.scene.fog.far = 55;
      }
      return;
    }
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = 120;
      this.scene.fog.far = 620;
    }
    this.ambient.color.set(0x8899bb);

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

  sendParty(action: "invite" | "accept" | "decline" | "leave" | "disband", name?: string): void {
    this.connection.send({ t: "party", action, name });
  }

  sendPvp(enabled: boolean): void {
    this.connection.send({ t: "pvp", enabled });
  }

  sendQuestAction(action: "accept" | "decline" | "turnin", questId: string): void {
    if (action !== "decline") this.connection.send({ t: "quest", action, questId });
    sound.play("ui");
  }

  sendShareQuest(questId: string): void {
    this.connection.send({ t: "shareQuest", questId });
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
    fc: "inventory" | "hotbar" | "equip" | "crafting",
    fs: number,
    tc: "inventory" | "hotbar" | "equip" | "crafting",
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

  leaveDungeon(): void {
    this.connection.send({ t: "dungeon", action: "leave" });
  }

  setUiMode(open: boolean): void {
    this.input.uiMode = open;
    if (open) {
      this.input.releasePointer();
    } else {
      this.input.requestPointer();
    }
  }

  /** Open the character screen directly on `tab`, or close it if it's
   *  already open showing that same tab -- shared by every key/button that
   *  jumps to a specific tab (Tab/I, K, J, O, gamepad Start). */
  private toggleTab(tab: CharacterTab): void {
    if (ui.inventoryOpen) {
      if (ui.activeTab === tab || tab === "inventory") {
        ui.inventoryOpen = false;
      } else {
        ui.activeTab = tab;
      }
    } else {
      ui.inventoryOpen = true;
      ui.activeTab = tab;
    }
    this.setUiMode(ui.inventoryOpen);
  }

  setWorldMapOpen(open: boolean): void {
    ui.worldMapOpen = open;
    this.setUiMode(open || ui.inventoryOpen || ui.chatOpen || ui.questOffer !== null);
  }

  get inputManager(): InputManager {
    return this.input;
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private disposeHierarchy(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        if (child.geometry) child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else if (child.material) {
          child.material.dispose();
        }
      }
    });
  }

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
    this.renderer.dispose();
  }
}
