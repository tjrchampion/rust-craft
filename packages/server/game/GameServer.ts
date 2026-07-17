import {
  TICK_MS,
  TICK_DT,
  INTEREST_RADIUS,
  SPAWN_POINT,
  WATER_LEVEL,
  WATER_PROXIMITY,
  DRINK_RESTORE,
  BASE_MAX_HP,
  BASE_MAX_MANA,
  HP_PER_LEVEL,
  MANA_PER_LEVEL,
  MANA_REGEN_PER_S,
  SIT_MANA_REGEN_MULT,
  HP_REGEN_PER_S,
  HUNGER_DECAY_PER_S,
  THIRST_DECAY_PER_S,
  STARVATION_DPS,
  UNARMED_DAMAGE,
  UNARMED_GATHER_POWER,
  MELEE_RANGE,
  MELEE_COOLDOWN_S,
  RESPAWN_HP_FRACTION,
  REVIVE_HOLD_S,
  REVIVE_RANGE,
  REVIVE_HP_FRACTION,
  DODGE_DISTANCE,
  DODGE_MAX_CHARGES,
  DODGE_CHARGE_REGEN_S,
  WORLD_MIN_X,
  WORLD_MAX_X,
  WORLD_MIN_Z,
  WORLD_MAX_Z,
  MAX_LEVEL,
  xpForLevel,
  HOTBAR_SLOTS,
  terrainHeight,
  generateNodes,
  generateMobSpawns,
  generateRegionTwoNodes,
  generateRegionTwoMobSpawns,
  REGION_TWO_GATE_X,
  REGION_TWO_GATE_Z,
  REGION_TWO_TRIGGER_RADIUS,
  generatePois,
  generateVillages,
  generateNpcQuestGivers,
  generateDungeonLayout,
  dungeonTierDef,
  pickDungeonMob,
  DUNGEON_PORTAL_ACTIVATION_RADIUS,
  DUNGEON_ABANDON_TIMEOUT_MS,
  DUNGEON_WIPE_EJECT_MS,
  TIER_NAMES,
  stepMovement,
  dist2D,
  dist3D,
  clamp,
  wrapAngle,
  turnToward,
  hash2,
  itemDef,
  RECIPES,
  spellDef,
  mobDef,
  auraDef,
  nodeTypeDef,
  questDef,
  questsForVillage,
  QUEST_IDS,
  classDef,
  computeActorStats,
  armorMitigation,
  applyAura,
  expireAuras,
  removeAura,
  aggregateAuraModifiers,
  collectDueTicks,
  type ClientMsg,
  type ServerMsg,
  type MoveState,
  type WorldNode,
  type AnimState,
  type SelfState,
  type PlayerSnap,
  type MobSnap,
  type PetSnap,
  type ProjectileSnap,
  type StructureSnap,
  type NpcSnap,
  type RosterEntry,
  type NpcSpec,
  type QuestOfferInfo,
  type QuestLogEntry,
  type QuestStatus,
  type ClassId,
  type BaseStats,
  type SpellEffect,
  type SpellDef,
  type ActiveAura,
  type PoiSpec,
  type DungeonLayoutSpec,
  ClientMsg as ClientMsgSchema,
} from "@rustcraft/shared";
import {
  type InvItem,
  type Container,
  addItem,
  removeItem,
  decrementSlot,
  findItem,
  moveItem,
  damageDurability,
  toSnaps,
  EQUIP_SLOTS,
} from "./inventory";
import {
  loadPlayer,
  savePlayer,
  loadDepletedNodes,
  upsertDepletedNode,
  deleteDepletedNodes,
  loadStructures,
  insertStructure,
  type PersistedPlayer,
  type QuestProgressEntry,
} from "./persistence";
import { type DungeonInstance, computeMobMultiplier } from "./dungeons";

const DAY_LENGTH_S = 1800; // full day/night cycle — slow, ambient pacing
const SAVE_INTERVAL_MS = 30_000;
const GATHER_COOLDOWN_S = 0.55;
const GATHER_RANGE = 4.5;
const REVIVE_HOLD_MS = REVIVE_HOLD_S * 1000;
const DODGE_CHARGE_REGEN_MS = DODGE_CHARGE_REGEN_S * 1000;
const MAX_INPUTS_PER_TICK = 5; // drain input bursts so ack stays current
const MAX_INPUT_QUEUE = 60; // ~3s of buffer; don't drop legit inputs
const ANIM_ACTION_MS = 450;
// Max radians a mob/pet may rotate per tick, rather than snapping straight to
// the raw target angle -- at close range a tiny position wobble in the
// target (player prediction noise, strafing) swings atan2's result wildly,
// which read as a spinning/jittery facing. 10 rad/s is still a near-instant
// turn for normal chase distances; it only visibly kicks in for that
// close-range case.
const MOB_TURN_STEP = 10 * TICK_DT;

interface PeerLike {
  id: string;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

interface QueuedInput {
  seq: number;
  moveX: number;
  moveZ: number;
  jump: boolean;
  sprint: boolean;
  block: boolean;
  yaw: number;
  revivingId: string | null;
}

interface PlayerState {
  id: string;
  accountId: string;
  name: string;
  peer: PeerLike;
  move: MoveState;
  yaw: number;
  classId: ClassId;
  hp: number;
  mana: number;
  hunger: number;
  thirst: number;
  xp: number;
  level: number;
  learnedSpells: string[];
  inventory: InvItem[];
  selectedSlot: number;
  dead: boolean;
  inputQueue: QueuedInput[];
  lastAckSeq: number;
  lastMoveMag: number;
  casting: { spellId: string; endsAt: number } | null;
  /** A revive this player is channeling on a dead target (holding E) --
   *  distinct from `casting`, since it's driven by continuous held-input
   *  rather than a single cast message. See tickPlayerMovement. */
  reviving: { targetId: string; startedAt: number } | null;
  dodgeCharges: number;
  /** One regen-completion timestamp (server ms) per charge currently missing,
   *  oldest first -- each consumed charge recharges on its own clock rather
   *  than sharing one cooldown, so the queue can have up to DODGE_MAX_CHARGES
   *  entries at once. selfState() surfaces only queue[0] to the client. */
  dodgeChargeQueue: number[];
  spellCooldowns: Map<string, number>; // spellId -> ready-at ms
  meleeReadyAt: number;
  gatherReadyAt: number;
  actionAnim: AnimState | null;
  actionAnimUntil: number;
  dirty: boolean;
  pvp: boolean;
  mount: "horse" | "raft" | null;
  blocking: boolean;
  sitting: string | null; // structure id being rested at
  shrineCooldowns: Map<string, number>; // shrine id -> ready-at ms
  partyId: string | null;
  pendingInviteFrom: string | null; // inviter character id
  questProgress: Map<string, { status: "active" | "completed"; progress: number }>;
  activeAuras: ActiveAura[];
  currentTargetId: string | null;
  /** Which dungeon run this player is currently inside, or null while in
   *  the open world -- see the sameInstance guard threaded through every
   *  distance-based visibility/targeting site (sendSnapshots, broadcastNear,
   *  tickMobs' aggro acquisition, findMeleeTarget, etc). */
  instanceId: string | null;
}

interface MobState {
  id: string;
  type: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  homeX: number;
  homeZ: number;
  targetId: string | null;
  attackReadyAt: number;
  respawnAt: number | null; // set while dead
  wanderTx: number;
  wanderTz: number;
  nextWanderAt: number;
  actionAnimUntil: number;
  activeAuras: ActiveAura[];
  /** Null for every overworld mob; set for a mob spawned into a dungeon run
   *  (see startDungeonInstance). Dungeon mobs never respawn on the normal
   *  timer (respawnAt is set to Infinity on death instead) -- they're
   *  deleted for real when the instance tears down. */
  instanceId: string | null;
  /** Party-size scaling applied at spawn (hp) and on every hit (damage) --
   *  see computeMobMultiplier. 1 for every overworld mob. */
  hpMult: number;
  dmgMult: number;
}

/** A summoned companion (currently just Beast Mastery's wolf) -- deliberately
 *  not a MobState: it follows its owner rather than leashing to a home
 *  point, never respawns (dying just removes it), and its kill/loot credit
 *  goes to the owner, not itself. */
interface PetState {
  id: string;
  ownerId: string;
  type: string; // mobDef key, e.g. "wolf" -- reused for model/base stats
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  targetId: string | null; // a mob id, or null while idle/following
  attackReadyAt: number;
  actionAnimUntil: number;
  /** Hysteresis flag for the owner-follow behavior (see tickPets) -- a
   *  single distance threshold made the pet flicker between idle/run every
   *  tick whenever the gap hovered right at the boundary, which is exactly
   *  what happens continuously while the owner runs. */
  following: boolean;
  /** Mirrors the owner's instanceId (kept in sync on dungeon enter/leave) --
   *  a pet has to be filtered the same way its owner is, for visibility and
   *  for its own hostile-mob targeting scan (see tickPets). */
  instanceId: string | null;
}

interface Projectile {
  id: string;
  spellId: string;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  traveled: number;
  maxRange: number;
  effects: SpellEffect[];
  speed: number;
  /** Homing target: a mob id or a (pvp) player id, or null for a straight shot. */
  homingId: string | null;
  /** Inherited from the caster at creation -- a projectile fired inside a
   *  dungeon must only be visible to, and only able to hit, that instance. */
  instanceId: string | null;
}

export class GameServer {
  private players = new Map<string, PlayerState>();
  private peerToChar = new Map<string, string>();
  private mobs = new Map<string, MobState>();
  private pets = new Map<string, PetState>();
  private projectiles = new Map<string, Projectile>();
  private structures: StructureSnap[] = [];
  private nodes = new Map<string, WorldNode>();
  private nodeHits = new Map<string, number>();
  private depletedNodes = new Map<string, number>(); // nodeId -> respawn at ms
  private shrines = new Map<string, { x: number; y: number; z: number }>();
  private villages: { x: number; z: number }[] = [];
  private npcs: NpcSpec[] = []; // static base data; marker recomputed per-viewer
  // Persists until the leader explicitly disbands it -- an ordinary member
  // leaving just removes them; if the leader leaves, leadership passes to
  // another member rather than ending the party (see leaveParty).
  private parties = new Map<string, { leaderId: string; members: Set<string> }>();
  private partySeq = 0;
  private dungeonPortals = new Map<string, PoiSpec>();
  private dungeonInstances = new Map<string, DungeonInstance>();
  private dungeonSeq = 0;
  /** Ashenpeak (region 2) stays dormant — not generated, not ticked — until a
   *  player first walks through the valley; then it's resident for the rest
   *  of this process's life (resets to dormant on a restart). */
  private regionTwoActive = false;
  private tickCount = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private projectileSeq = 0;
  private started = false;
  private startedAt = Date.now();

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    for (const node of generateNodes()) this.nodes.set(node.id, node);
    for (const spawn of generateMobSpawns()) {
      const def = mobDef(spawn.type);
      this.mobs.set(spawn.id, {
        id: spawn.id,
        type: spawn.type,
        x: spawn.x,
        y: spawn.y,
        z: spawn.z,
        yaw: 0,
        hp: def.maxHp,
        homeX: spawn.x,
        homeZ: spawn.z,
        targetId: null,
        attackReadyAt: 0,
        respawnAt: null,
        wanderTx: spawn.x,
        wanderTz: spawn.z,
        nextWanderAt: 0,
        actionAnimUntil: 0,
        activeAuras: [],
        instanceId: null,
        hpMult: 1,
        dmgMult: 1,
      });
    }

    for (const poi of generatePois()) {
      if (poi.type === "shrine") this.shrines.set(poi.id, { x: poi.x, y: poi.y, z: poi.z });
      else if (poi.type === "dungeon_portal") this.dungeonPortals.set(poi.id, poi);
    }
    this.villages = generateVillages().map((v) => ({ x: v.x, z: v.z }));
    this.npcs = generateNpcQuestGivers();

    this.depletedNodes = await loadDepletedNodes();
    // Recompute height fresh rather than trusting the persisted value — it was
    // baked in at placement time, and goes stale (floating/clipped structures)
    // whenever the terrain height formula changes afterward (e.g. the river
    // carve removal), since the ground at that (x, z) may no longer match.
    this.structures = (await loadStructures()).map((s) => ({ ...s, y: terrainHeight(s.x, s.z) }));

    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
    this.saveTimer = setInterval(() => void this.flushDirty(), SAVE_INTERVAL_MS);
    console.log(
      `[game] world ready: ${this.nodes.size} nodes, ${this.mobs.size} mobs, ${this.structures.length} structures`,
    );
  }

  /** Lazily populates Ashenpeak's nodes/mobs the first time any player walks
   *  through the valley — nothing about it exists in memory before this. */
  private activateRegionTwo(): void {
    if (this.regionTwoActive) return;
    this.regionTwoActive = true;
    for (const node of generateRegionTwoNodes()) this.nodes.set(node.id, node);
    for (const spawn of generateRegionTwoMobSpawns()) {
      const def = mobDef(spawn.type);
      this.mobs.set(spawn.id, {
        id: spawn.id,
        type: spawn.type,
        x: spawn.x,
        y: spawn.y,
        z: spawn.z,
        yaw: 0,
        hp: def.maxHp,
        homeX: spawn.x,
        homeZ: spawn.z,
        targetId: null,
        attackReadyAt: 0,
        respawnAt: null,
        wanderTx: spawn.x,
        wanderTz: spawn.z,
        nextWanderAt: 0,
        actionAnimUntil: 0,
        activeAuras: [],
        instanceId: null,
        hpMult: 1,
        dmgMult: 1,
      });
    }
    console.log(`[game] region two activated: ${this.nodes.size} nodes total, ${this.mobs.size} mobs total`);
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.started = false;
  }

  // ============================ connection ============================

  async join(peer: PeerLike, characterId: string, accountId: string): Promise<void> {
    const persisted = await loadPlayer(characterId);
    if (!persisted || persisted.accountId !== accountId) {
      this.sendTo(peer, { t: "error", message: "Character not found" });
      peer.close(4001, "bad character");
      return;
    }

    // One connection per character: kick the previous one.
    const existing = this.players.get(characterId);
    if (existing) {
      this.sendTo(existing.peer, { t: "error", message: "Logged in elsewhere" });
      existing.peer.close(4002, "replaced");
      this.peerToChar.delete(existing.peer.id);
      await this.removePlayer(characterId, false);
    }

    const isNew = persisted.x === 0 && persisted.z === 0 && persisted.xp === 0;
    const x = isNew ? SPAWN_POINT.x + (Math.random() - 0.5) * 6 : persisted.x;
    const z = isNew ? SPAWN_POINT.z + (Math.random() - 0.5) * 6 : persisted.z;
    const y = Math.max(persisted.y, terrainHeight(x, z));

    const player: PlayerState = {
      id: persisted.id,
      accountId: persisted.accountId,
      name: persisted.name,
      peer,
      move: { x, y, z, vy: 0, grounded: true },
      yaw: persisted.yaw,
      classId: (persisted.classId as ClassId) ?? "warrior",
      hp: persisted.hp,
      mana: persisted.mana,
      hunger: persisted.hunger,
      thirst: persisted.thirst,
      xp: persisted.xp,
      level: persisted.level,
      // Union with the class's current startingSpells so existing characters
      // pick up newly-added class abilities (e.g. Beast Mastery) without a
      // DB migration -- never removes anything a character already learned.
      learnedSpells: [
        ...new Set([...persisted.learnedSpells, ...classDef((persisted.classId as ClassId) ?? "warrior").startingSpells]),
      ],
      inventory: persisted.inventory,
      selectedSlot: 0,
      dead: persisted.hp <= 0,
      inputQueue: [],
      lastAckSeq: 0,
      lastMoveMag: 0,
      casting: null,
      reviving: null,
      dodgeCharges: DODGE_MAX_CHARGES,
      dodgeChargeQueue: [],
      spellCooldowns: new Map(),
      meleeReadyAt: 0,
      gatherReadyAt: 0,
      actionAnim: null,
      actionAnimUntil: 0,
      dirty: true,
      pvp: false,
      mount: null,
      blocking: false,
      sitting: null,
      shrineCooldowns: new Map(),
      partyId: null,
      pendingInviteFrom: null,
      questProgress: new Map(persisted.questProgress.map((q) => [q.questId, { status: q.status, progress: q.progress }])),
      activeAuras: [],
      currentTargetId: null,
      instanceId: null,
    };

    this.players.set(player.id, player);
    this.peerToChar.set(peer.id, player.id);
    this.broadcastRoster();

    // Disconnecting doesn't remove you from your party (see leaveParty) --
    // reconnecting just needs to re-link this fresh PlayerState back to
    // whichever party still lists your character id as a member.
    for (const [partyId, party] of this.parties) {
      if (party.members.has(player.id)) {
        player.partyId = partyId;
        this.broadcastPartyState(partyId);
        break;
      }
    }

    // Mirrors the party re-link above: disconnecting doesn't remove you from
    // a dungeon run either (see removePlayer), so reconnecting just needs to
    // re-attach this fresh PlayerState and drop them back at the layout's
    // entry point, same as it was when they left.
    for (const instance of this.dungeonInstances.values()) {
      if (instance.memberIds.has(player.id)) {
        player.instanceId = instance.id;
        const layout = generateDungeonLayout(instance.portalId);
        player.move = {
          x: layout.entryPoint.x,
          y: layout.floorY,
          z: layout.entryPoint.z,
          vy: 0,
          grounded: true,
        };
        instance.lastActivityAt = Date.now();
        this.sendDungeonState(player, instance);
        break;
      }
    }

    this.sendTo(peer, {
      t: "welcome",
      selfId: player.id,
      name: player.name,
      classId: player.classId,
      self: this.selfState(player),
      inventory: toSnaps(player.inventory),
      learnedSpells: player.learnedSpells,
      selectedSlot: player.selectedSlot,
      depletedNodes: [...this.depletedNodes.keys()],
      structures: this.structures,
      npcs: this.npcs.map((n) => this.npcSnapFor(n, player)),
      questLog: this.questLogFor(player),
      serverTime: Date.now(),
      dayLengthS: DAY_LENGTH_S,
      timeOfDay: this.timeOfDay(),
    });
    this.broadcastChat("system", `${player.name} entered the world.`);
  }

  async leave(peer: PeerLike): Promise<void> {
    const charId = this.peerToChar.get(peer.id);
    if (!charId) return;
    this.peerToChar.delete(peer.id);
    const player = this.players.get(charId);
    if (player) this.broadcastChat("system", `${player.name} left the world.`);
    await this.removePlayer(charId, true);
  }

  private async removePlayer(charId: string, save: boolean): Promise<void> {
    const player = this.players.get(charId);
    if (!player) return;
    // Delete before leaveParty so its party broadcast (which checks
    // this.players to report each member online/offline) already sees this
    // player as gone, instead of momentarily reporting them still online.
    this.players.delete(charId);
    this.leaveParty(player, true);
    this.broadcastRoster();
    for (const mob of this.mobs.values()) {
      if (mob.targetId === charId) mob.targetId = null;
    }
    if (save) await savePlayer(this.toPersisted(player)).catch((e) => console.error("[game] save failed", e));
  }

  handleMessage(peer: PeerLike, raw: unknown): void {
    let parsed: ClientMsg;
    try {
      const json = typeof raw === "string" ? JSON.parse(raw) : raw;
      parsed = ClientMsgSchema.parse(json);
    } catch {
      this.sendTo(peer, { t: "error", message: "Bad message" });
      return;
    }
    const charId = this.peerToChar.get(peer.id);
    if (!charId) return;
    const player = this.players.get(charId);
    if (!player) return;

    switch (parsed.t) {
      case "input":
        // Apply facing immediately so a same-frame attack/cast uses the
        // client's target-facing yaw rather than last tick's.
        player.yaw = parsed.yaw;
        if (player.inputQueue.length < MAX_INPUT_QUEUE) player.inputQueue.push(parsed);
        break;
      case "interact":
        if (parsed.nodeId.startsWith("poi_shrine")) this.handleShrine(player, parsed.nodeId);
        else if (parsed.nodeId.startsWith("poi_dungeon")) this.handleDungeonPortal(player, parsed.nodeId);
        else if (parsed.nodeId.startsWith("npc_")) this.handleQuestGiverInteract(player, parsed.nodeId);
        else this.handleGather(player, parsed.nodeId);
        break;
      case "drink":
        this.handleDrink(player);
        break;
      case "attack":
        this.handleMelee(player);
        break;
      case "cast":
        this.handleCastStart(player, parsed.spellId);
        break;
      case "craft":
        this.handleCraft(player, parsed.recipeId);
        break;
      case "consume":
        this.handleConsume(player, parsed.container, parsed.slot);
        break;
      case "moveItem":
        if (moveItem(player.inventory, parsed.fromContainer, parsed.fromSlot, parsed.toContainer, parsed.toSlot)) {
          player.dirty = true;
          this.sendInventory(player);
        }
        break;
      case "selectSlot":
        if (parsed.slot < HOTBAR_SLOTS) {
          player.selectedSlot = parsed.slot;
          this.sendInventory(player);
        }
        break;
      case "selectTarget":
        player.currentTargetId = parsed.targetId;
        break;
      case "place":
        void this.handlePlace(player, parsed.container, parsed.slot);
        break;
      case "assignSpell":
        this.handleAssignSpell(player, parsed.spellId, parsed.slot);
        break;
      case "chat":
        this.handleChat(player, parsed.channel, parsed.text.slice(0, 240));
        break;
      case "respawn":
        this.handleRespawn(player);
        break;
      case "pvp":
        this.handlePvpToggle(player, parsed.enabled);
        break;
      case "party":
        this.handleParty(player, parsed.action, parsed.name);
        break;
      case "mount":
        this.handleMount(player);
        break;
      case "sit":
        this.handleSit(player);
        break;
      case "quest":
        this.handleQuestAction(player, parsed.action, parsed.questId);
        break;
      case "shareQuest":
        this.handleShareQuest(player, parsed.questId);
        break;
      case "dodge":
        this.handleDodge(player, parsed.dirX, parsed.dirZ);
        break;
      case "dungeon":
        this.handleDungeonLeave(player);
        break;
    }
  }

  // ============================ chat & social ============================

  private handleChat(player: PlayerState, channel: "realm" | "party", text: string): void {
    if (channel === "party") {
      if (!player.partyId) {
        this.sendEvent(player, { t: "event", kind: "error", message: "You are not in a party" });
        return;
      }
      this.sendToParty(player.partyId, { t: "chat", channel: "party", from: player.name, text });
      return;
    }
    this.broadcast({ t: "chat", channel: "realm", from: player.name, text });
  }

  private handlePvpToggle(player: PlayerState, enabled: boolean): void {
    if (player.pvp === enabled) return;
    player.pvp = enabled;
    this.sendTo(player.peer, { t: "pvp", enabled });
    this.broadcastChat(
      "system",
      enabled ? `${player.name} has enabled PvP — beware!` : `${player.name} has disabled PvP.`,
    );
  }

  private hasItem(player: PlayerState, itemId: string): boolean {
    return player.inventory.some((i) => i.itemId === itemId && i.qty > 0);
  }

  /** Toggle a horse (on land) or raft (on water), gated by the right item. */
  private handleMount(player: PlayerState): void {
    if (player.dead) return;
    if (player.mount) {
      player.mount = null;
      this.sendSelf(player);
      return;
    }
    const inWater = player.move.y < WATER_LEVEL + 0.3;
    if (inWater) {
      if (this.hasItem(player, "raft")) {
        player.mount = "raft";
        this.sendSelf(player);
      } else {
        this.sendEvent(player, { t: "event", kind: "error", message: "You need a Raft to cross water" });
      }
    } else {
      if (this.hasItem(player, "saddle")) {
        player.mount = "horse";
        this.sendSelf(player);
      } else {
        this.sendEvent(player, { t: "event", kind: "error", message: "You need a Riding Saddle to mount" });
      }
    }
  }

  /** Travel mounts (and resting at a campfire) end the moment a player
   *  fights or is struck. */
  private dismountForCombat(player: PlayerState): void {
    let changed = false;
    if (player.mount) {
      player.mount = null;
      changed = true;
    }
    if (player.sitting) {
      player.sitting = null;
      changed = true;
    }
    if (changed) this.sendSelf(player);
  }

  /** Sit at (or stand up from) the nearest campfire -- rests movement and
   *  boosts mana regen (see tickVitals). Bare toggle, mirrors handleMount. */
  private handleSit(player: PlayerState): void {
    if (player.dead) return;
    if (player.sitting) {
      player.sitting = null;
      player.dirty = true;
      this.sendSelf(player);
      return;
    }
    const nearest = this.structures.find((s) => dist2D(player.move.x, player.move.z, s.x, s.z) < 4);
    if (!nearest) {
      this.sendEvent(player, { t: "event", kind: "error", message: "No campfire nearby" });
      return;
    }
    if (player.mount) player.mount = null; // can't ride and sit at once
    player.sitting = nearest.id;
    player.dirty = true;
    this.sendSelf(player);
  }

  // ============================ quests ============================

  private questStatusFor(player: PlayerState, quest: ReturnType<typeof questDef>): QuestStatus {
    const entry = player.questProgress.get(quest.id);
    if (entry?.status === "completed") return "turnedin";
    if (entry?.status === "active") {
      return entry.progress >= quest.objectiveCount ? "complete" : "active";
    }
    if (player.level < quest.minLevel) return "locked";
    return "available";
  }

  private questLogFor(player: PlayerState): QuestLogEntry[] {
    const entries: QuestLogEntry[] = [];
    for (const [questId, entry] of player.questProgress) {
      if (entry.status !== "active") continue;
      const quest = questDef(questId);
      entries.push({
        id: quest.id,
        name: quest.name,
        tier: quest.tier,
        objectiveKind: quest.objectiveKind,
        objectiveTarget: quest.objectiveTarget,
        objectiveCount: quest.objectiveCount,
        progress: entry.progress,
        status: entry.progress >= quest.objectiveCount ? "complete" : "active",
      });
    }
    return entries;
  }

  private npcSnapFor(npc: NpcSpec, player: PlayerState): NpcSnap {
    let hasComplete = false;
    let hasAvailable = false;
    let hasActive = false;
    for (const q of questsForVillage(npc.villageIndex)) {
      const status = this.questStatusFor(player, q);
      if (status === "complete") hasComplete = true;
      else if (status === "available") hasAvailable = true;
      else if (status === "active") hasActive = true;
    }
    const marker = hasComplete ? "complete" : hasAvailable ? "available" : hasActive ? "active" : "none";
    return { id: npc.id, name: npc.name, x: npc.x, y: npc.y, z: npc.z, yaw: npc.yaw, marker };
  }

  private handleQuestGiverInteract(player: PlayerState, npcId: string): void {
    if (player.dead) return;
    const npc = this.npcs.find((n) => n.id === npcId);
    if (!npc) return;
    if (dist2D(player.move.x, player.move.z, npc.x, npc.z) > 6) return;

    const offers: QuestOfferInfo[] = questsForVillage(npc.villageIndex).map((q) => {
      const entry = player.questProgress.get(q.id);
      return {
        id: q.id,
        name: q.name,
        description: q.description,
        tier: q.tier,
        minLevel: q.minLevel,
        objectiveKind: q.objectiveKind,
        objectiveTarget: q.objectiveTarget,
        objectiveCount: q.objectiveCount,
        rewardXp: q.rewardXp,
        rewardItems: q.rewardItems,
        status: this.questStatusFor(player, q),
        progress: entry?.progress ?? 0,
      };
    });
    this.sendTo(player.peer, { t: "questOffer", npcId: npc.id, npcName: npc.name, offers });
  }

  private handleQuestAction(player: PlayerState, action: "accept" | "decline" | "turnin", questId: string): void {
    if (action === "decline" || !QUEST_IDS.includes(questId)) return;
    const quest = questDef(questId);

    // Accept/turn-in: accept can be done near NPC OR near a party member who has the quest active!
    // turnin MUST still be done near the NPC village giver.
    const npc = this.npcs.find((n) => n.villageIndex === quest.villageIndex);
    const nearNpc = npc && dist2D(player.move.x, player.move.z, npc.x, npc.z) <= 6;
    
    let canAcceptShared = false;
    if (action === "accept" && player.partyId) {
      const party = this.parties.get(player.partyId);
      if (party) {
        for (const memberId of party.members) {
          if (memberId === player.id) continue;
          const member = this.players.get(memberId);
          if (member && !member.dead) {
            const hasQuest = member.questProgress.get(questId)?.status === "active";
            const close = dist2D(player.move.x, player.move.z, member.move.x, member.move.z) <= 40;
            if (hasQuest && close) {
              canAcceptShared = true;
              break;
            }
          }
        }
      }
    }

    if (!nearNpc && !(action === "accept" && canAcceptShared)) {
      this.sendEvent(player, { t: "event", kind: "error", message: "Move closer to the quest giver" });
      return;
    }

    if (action === "accept") {
      if (this.questStatusFor(player, quest) !== "available") return;
      player.questProgress.set(quest.id, { status: "active", progress: 0 });
      player.dirty = true;
      this.sendTo(player.peer, { t: "questLog", quests: this.questLogFor(player) });
      return;
    }

    // turnin
    const entry = player.questProgress.get(quest.id);
    if (!entry || entry.status !== "active" || entry.progress < quest.objectiveCount) {
      this.sendEvent(player, { t: "event", kind: "error", message: "Objective not complete yet" });
      return;
    }
    entry.status = "completed";
    player.dirty = true;
    for (const r of quest.rewardItems) addItem(player.inventory, r.itemId, r.qty);
    this.sendInventory(player);
    this.grantXp(player, quest.rewardXp);
    this.sendTo(player.peer, { t: "questLog", quests: this.questLogFor(player) });
    this.sendTo(player.peer, {
      t: "questComplete",
      questId: quest.id,
      questName: quest.name,
      xp: quest.rewardXp,
      items: quest.rewardItems,
    });
    this.broadcastChat("system", `${player.name} completed "${quest.name}".`);
  }

  private handleShareQuest(player: PlayerState, questId: string): void {
    if (player.dead) return;
    if (!QUEST_IDS.includes(questId)) return;
    const quest = questDef(questId);
    if (!player.partyId) {
      this.sendEvent(player, { t: "event", kind: "error", message: "You are not in a party" });
      return;
    }
    
    const party = this.parties.get(player.partyId);
    if (!party) return;
    
    const entry = player.questProgress.get(questId);
    if (!entry || entry.status !== "active") {
      this.sendEvent(player, { t: "event", kind: "error", message: "You do not have this quest active" });
      return;
    }

    let sharedCount = 0;
    for (const memberId of party.members) {
      if (memberId === player.id) continue;
      const member = this.players.get(memberId);
      if (!member || member.dead) continue;
      
      if (dist2D(player.move.x, player.move.z, member.move.x, member.move.z) > 40) continue;
      
      const status = this.questStatusFor(member, quest);
      if (status !== "available") continue;
      
      const offer = {
        id: quest.id,
        name: quest.name,
        description: quest.description,
        tier: quest.tier,
        minLevel: quest.minLevel,
        objectiveKind: quest.objectiveKind,
        objectiveTarget: quest.objectiveTarget,
        objectiveCount: quest.objectiveCount,
        rewardXp: quest.rewardXp,
        rewardItems: quest.rewardItems,
        status: "available" as const,
        progress: 0,
      };
      
      this.sendTo(member.peer, {
        t: "questOffer",
        npcId: "share",
        npcName: `Quest Share: ${player.name}`,
        offers: [offer],
      });
      
      sharedCount++;
    }
    
    if (sharedCount > 0) {
      this.sendTo(player.peer, { t: "chat", channel: "system", from: "system", text: `Shared quest "${quest.name}" with nearby party members.` });
    } else {
      this.sendEvent(player, { t: "event", kind: "error", message: "No eligible party members nearby to share with" });
    }
  }

  private incrementPlayerKillProgress(player: PlayerState, mobType: string): void {
    let changed = false;
    for (const [questId, entry] of player.questProgress) {
      if (entry.status !== "active") continue;
      const quest = questDef(questId);
      if (quest.objectiveKind !== "kill" || quest.objectiveTarget !== mobType) continue;
      if (entry.progress >= quest.objectiveCount) continue;
      entry.progress = Math.min(quest.objectiveCount, entry.progress + 1);
      changed = true;
    }
    if (changed) {
      player.dirty = true;
      this.sendTo(player.peer, { t: "questLog", quests: this.questLogFor(player) });
    }
  }

  private addQuestKillProgress(player: PlayerState, mobType: string): void {
    const party = player.partyId ? this.parties.get(player.partyId) : null;
    if (party) {
      for (const memberId of party.members) {
        const member = this.players.get(memberId);
        if (!member || member.dead) continue;
        if (dist2D(player.move.x, player.move.z, member.move.x, member.move.z) <= 40) {
          this.incrementPlayerKillProgress(member, mobType);
        }
      }
    } else {
      this.incrementPlayerKillProgress(player, mobType);
    }
  }

  private incrementPlayerGatherProgress(player: PlayerState, itemId: string, qty: number): void {
    let changed = false;
    for (const [questId, entry] of player.questProgress) {
      if (entry.status !== "active") continue;
      const quest = questDef(questId);
      if (quest.objectiveKind !== "gather" || quest.objectiveTarget !== itemId) continue;
      if (entry.progress >= quest.objectiveCount) continue;
      entry.progress = Math.min(quest.objectiveCount, entry.progress + qty);
      changed = true;
    }
    if (changed) {
      player.dirty = true;
      this.sendTo(player.peer, { t: "questLog", quests: this.questLogFor(player) });
    }
  }

  private addQuestGatherProgress(player: PlayerState, itemId: string, qty: number): void {
    if (qty <= 0) return;
    const party = player.partyId ? this.parties.get(player.partyId) : null;
    if (party) {
      for (const memberId of party.members) {
        const member = this.players.get(memberId);
        if (!member || member.dead) continue;
        if (dist2D(player.move.x, player.move.z, member.move.x, member.move.z) <= 40) {
          this.incrementPlayerGatherProgress(member, itemId, qty);
        }
      }
    } else {
      this.incrementPlayerGatherProgress(player, itemId, qty);
    }
  }

  private handleShrine(player: PlayerState, shrineId: string): void {
    if (player.dead) return;
    const shrine = this.shrines.get(shrineId);
    if (!shrine) return;
    if (dist2D(player.move.x, player.move.z, shrine.x, shrine.z) > 6) return;
    const now = Date.now();
    const readyAt = player.shrineCooldowns.get(shrineId) ?? 0;
    if (now < readyAt) {
      const mins = Math.ceil((readyAt - now) / 60000);
      this.sendEvent(player, {
        t: "event",
        kind: "error",
        message: `The shrine is silent (${mins}m)`,
      });
      return;
    }
    player.shrineCooldowns.set(shrineId, now + 5 * 60 * 1000);
    const healedFor = this.maxHp(player) - player.hp;
    player.hp = this.maxHp(player);
    player.mana = this.maxMana(player);
    player.dirty = true;
    this.setActionAnim(player, "cast", 900);
    this.sendEvent(player, {
      t: "event",
      kind: "heal",
      amount: healedFor,
      targetId: player.id,
      spellId: "shrine",
    });
    this.sendSelf(player);
  }

  // ============================ parties ============================

  private handleParty(
    player: PlayerState,
    action: "invite" | "accept" | "decline" | "leave" | "disband",
    name?: string,
  ): void {
    switch (action) {
      case "invite": {
        const target = [...this.players.values()].find(
          (p) => p.name.toLowerCase() === name?.toLowerCase(),
        );
        if (!target || target.id === player.id) {
          this.sendEvent(player, { t: "event", kind: "error", message: "Player not found" });
          return;
        }
        if (target.partyId) {
          this.sendEvent(player, { t: "event", kind: "error", message: `${target.name} is already in a party` });
          return;
        }
        const partySize = player.partyId ? (this.parties.get(player.partyId)?.members.size ?? 0) : 1;
        if (partySize >= 5) {
          this.sendEvent(player, { t: "event", kind: "error", message: "Party is full" });
          return;
        }
        target.pendingInviteFrom = player.id;
        this.sendTo(target.peer, {
          t: "party",
          members: this.partyMembersOf(target),
          inviteFrom: player.name,
        });
        this.sendTo(player.peer, { t: "chat", channel: "system", from: "system", text: `Invited ${target.name} to your party.` });
        break;
      }
      case "accept": {
        const inviter = player.pendingInviteFrom ? this.players.get(player.pendingInviteFrom) : undefined;
        player.pendingInviteFrom = null;
        if (!inviter) {
          this.sendEvent(player, { t: "event", kind: "error", message: "Invite expired" });
          this.sendPartyState(player);
          return;
        }
        let partyId = inviter.partyId;
        if (!partyId) {
          partyId = `party_${++this.partySeq}`;
          this.parties.set(partyId, { leaderId: inviter.id, members: new Set([inviter.id]) });
          inviter.partyId = partyId;
        }
        const party = this.parties.get(partyId)!;
        if (party.members.size >= 5) {
          this.sendEvent(player, { t: "event", kind: "error", message: "Party is full" });
          return;
        }
        party.members.add(player.id);
        player.partyId = partyId;
        this.broadcastPartyState(partyId);
        this.sendToParty(partyId, {
          t: "chat",
          channel: "party",
          from: "system",
          text: `${player.name} joined the party.`,
        });
        break;
      }
      case "decline": {
        const inviter = player.pendingInviteFrom ? this.players.get(player.pendingInviteFrom) : undefined;
        player.pendingInviteFrom = null;
        if (inviter) {
          this.sendTo(inviter.peer, {
            t: "chat",
            channel: "system",
            from: "system",
            text: `${player.name} declined your invite.`,
          });
        }
        this.sendPartyState(player);
        break;
      }
      case "disband": {
        const partyId = player.partyId;
        const party = partyId ? this.parties.get(partyId) : undefined;
        if (!party) return;
        if (party.leaderId !== player.id) {
          this.sendEvent(player, { t: "event", kind: "error", message: "Only the party leader can disband the party" });
          return;
        }
        for (const memberId of party.members) {
          const member = this.players.get(memberId);
          if (!member) continue;
          member.partyId = null;
          this.sendPartyState(member);
        }
        this.sendToParty(partyId!, { t: "chat", channel: "party", from: "system", text: `${player.name} disbanded the party.` });
        this.parties.delete(partyId!);
        break;
      }
      case "leave":
        this.leaveParty(player, false);
        break;
    }
  }

  /** A regular member leaving just removes them -- the party persists for
   *  everyone else (see the class-level comment on `parties`). Only two
   *  cases actually end the party entry: the leader leaving while genuinely
   *  alone (nobody to hand leadership to), or an explicit "disband". If the
   *  leader leaves with others still in the party, leadership passes to
   *  whoever has been in the party longest (Set iteration order).
   *
   *  Disconnecting is *not* leaving -- membership (and leadership) survives
   *  a closed tab/crash, and `join` re-links a reconnecting character back
   *  into its party automatically. This only removes someone via the
   *  explicit "leave"/"disband" actions; a disconnect just tells the rest
   *  of the party this member dropped offline (partyMembersOf already
   *  reports `online: false` for a member id not currently in `players`). */
  private leaveParty(player: PlayerState, disconnecting: boolean): void {
    const partyId = player.partyId;
    if (!partyId) return;
    if (disconnecting) {
      this.broadcastPartyState(partyId);
      return;
    }
    const party = this.parties.get(partyId);
    player.partyId = null;
    this.sendPartyState(player);
    if (!party) return;
    party.members.delete(player.id);
    this.sendToParty(partyId, {
      t: "chat",
      channel: "party",
      from: "system",
      text: `${player.name} left the party.`,
    });
    if (party.members.size === 0) {
      this.parties.delete(partyId);
      return;
    }
    if (party.leaderId === player.id) {
      const nextLeader = this.players.get([...party.members][0]!);
      party.leaderId = [...party.members][0]!;
      if (nextLeader) {
        this.sendToParty(partyId, {
          t: "chat",
          channel: "party",
          from: "system",
          text: `${nextLeader.name} is now the party leader.`,
        });
      }
    }
    this.broadcastPartyState(partyId);
  }

  private partyMembersOf(player: PlayerState) {
    if (!player.partyId) return null;
    const party = this.parties.get(player.partyId);
    if (!party) return null;
    return [...party.members].map((id) => {
      const member = this.players.get(id);
      return member
        ? {
            id: member.id,
            name: member.name,
            level: member.level,
            hp: member.hp,
            maxHp: this.maxHp(member),
            online: true,
            leader: id === party.leaderId,
            x: member.move.x,
            z: member.move.z,
          }
        : { id, name: "…", level: 0, hp: 0, maxHp: 1, online: false, leader: id === party.leaderId, x: 0, z: 0 };
    });
  }

  private sendPartyState(player: PlayerState): void {
    this.sendTo(player.peer, { t: "party", members: this.partyMembersOf(player) });
  }

  private broadcastPartyState(partyId: string): void {
    const party = this.parties.get(partyId);
    if (!party) return;
    const ids = party.members;
    for (const id of ids) {
      const member = this.players.get(id);
      if (member) this.sendPartyState(member);
    }
  }

  /** Realm-wide online roster for the Party tab's invite list -- every
   *  currently-connected player, not just party members. Broadcast on
   *  join/leave (instant) and piggybacked on the existing 0.5Hz party-frame
   *  tick (levels can change while someone's already online). */
  private broadcastRoster(): void {
    const players: RosterEntry[] = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      level: p.level,
      classId: p.classId,
    }));
    this.broadcast({ t: "roster", players });
  }

  private sendToParty(partyId: string, msg: ServerMsg): void {
    const party = this.parties.get(partyId);
    if (!party) return;
    const data = JSON.stringify(msg);
    for (const id of party.members) {
      const member = this.players.get(id);
      if (member) {
        try {
          member.peer.send(data);
        } catch {
          /* ignore */
        }
      }
    }
  }

  // ============================ dungeons ============================

  /** True when two entities should be visible/targetable to each other --
   *  both in the open world (instanceId null on each), or both tagged with
   *  the same dungeon run. Threaded alongside every existing distance check
   *  in sendSnapshots/broadcastNear/tickMobs/findMeleeTarget/etc, since a
   *  dungeon's reserved rectangle sits at real (reused) world coordinates --
   *  it's this check, not distance, that keeps concurrent runs (and the
   *  overworld) from bleeding into each other. */
  private sameInstance(a: { instanceId: string | null }, b: { instanceId: string | null }): boolean {
    return a.instanceId === b.instanceId;
  }

  /** All party members (including the player themselves) currently online,
   *  alive, and within `radius` of the player's own position -- factors out
   *  the party+distance filter pattern already duplicated at several
   *  existing call sites (quest-share, quest-progress, AoE heal). Returns
   *  just [player] when they're not in a party. */
  private nearbyPartyMembers(player: PlayerState, radius: number): PlayerState[] {
    if (!player.partyId) return [player];
    const party = this.parties.get(player.partyId);
    if (!party) return [player];
    const result: PlayerState[] = [];
    for (const id of party.members) {
      const member = this.players.get(id);
      if (!member || member.dead) continue;
      if (dist2D(player.move.x, player.move.z, member.move.x, member.move.z) > radius) continue;
      result.push(member);
    }
    return result;
  }

  private handleDungeonPortal(player: PlayerState, portalId: string): void {
    if (player.dead || player.instanceId) return;
    const portal = this.dungeonPortals.get(portalId);
    if (!portal || portal.dungeonTier === undefined) return;
    if (dist2D(player.move.x, player.move.z, portal.x, portal.z) > DUNGEON_PORTAL_ACTIVATION_RADIUS) return;
    const party = player.partyId ? this.parties.get(player.partyId) : null;
    if (party && party.leaderId !== player.id) {
      this.sendEvent(player, { t: "event", kind: "error", message: "Only the party leader can start the dungeon" });
      return;
    }
    const tierDef = dungeonTierDef(portal.dungeonTier);
    if (player.level < tierDef.minLevel) {
      this.sendEvent(player, { t: "event", kind: "error", message: `Requires level ${tierDef.minLevel}` });
      return;
    }
    const nearby = this.nearbyPartyMembers(player, DUNGEON_PORTAL_ACTIVATION_RADIUS).filter((m) => !m.instanceId);
    const members = nearby.filter((m) => m.level >= tierDef.minLevel);
    // The activating player already passed the check above and is always
    // included; under-level party members are simply left behind (with
    // their own toast) rather than blocking the whole group.
    for (const m of nearby) {
      if (m.level < tierDef.minLevel) {
        this.sendEvent(m, { t: "event", kind: "error", message: `You must be level ${tierDef.minLevel} to enter this dungeon` });
      }
    }
    this.startDungeonInstance(portal, members);
  }

  private startDungeonInstance(portal: PoiSpec, members: PlayerState[]): void {
    if (members.length === 0) return;
    const tier = portal.dungeonTier ?? 0;
    const tierDef = dungeonTierDef(tier);
    const layout = generateDungeonLayout(portal.id);
    const instanceId = `dgn_${++this.dungeonSeq}`;
    const mult = computeMobMultiplier(members.length);
    const mobIds = new Set<string>();

    for (let i = 0; i < layout.mobSpawns.length; i++) {
      const spawn = layout.mobSpawns[i]!;
      const type = pickDungeonMob(tierDef.mobTable);
      const def = mobDef(type);
      const x = layout.center.x + spawn.localX;
      const z = layout.center.z + spawn.localZ;
      const y = layout.floorY;
      const mobId = `${instanceId}_${i}`;
      mobIds.add(mobId);
      this.mobs.set(mobId, {
        id: mobId,
        type,
        x,
        y,
        z,
        yaw: 0,
        hp: def.maxHp * mult,
        homeX: x,
        homeZ: z,
        targetId: null,
        attackReadyAt: 0,
        respawnAt: null,
        wanderTx: x,
        wanderTz: z,
        nextWanderAt: 0,
        actionAnimUntil: 0,
        activeAuras: [],
        instanceId,
        hpMult: mult,
        dmgMult: mult,
      });
    }

    const instance: DungeonInstance = {
      id: instanceId,
      portalId: portal.id,
      tier,
      memberIds: new Set(members.map((m) => m.id)),
      mobIds,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      cleared: false,
      wipedAt: null,
    };
    this.dungeonInstances.set(instanceId, instance);

    for (let i = 0; i < members.length; i++) {
      const member = members[i]!;
      member.instanceId = instanceId;
      this.dismountForCombat(member);
      const angle = (i / members.length) * Math.PI * 2;
      const spread = Math.min(3, members.length);
      const ex = layout.entryPoint.x + Math.sin(angle) * spread;
      const ez = layout.entryPoint.z + Math.cos(angle) * spread;
      member.move = { x: ex, y: layout.floorY, z: ez, vy: 0, grounded: true };
      member.dirty = true;
      // A live pet has to follow its owner into the instance, or it'd be
      // left behind fighting the (now filtered-out) overworld.
      for (const pet of this.pets.values()) {
        if (pet.ownerId === member.id) pet.instanceId = instanceId;
      }
      this.sendSelf(member);
      this.sendDungeonState(member, instance);
    }

    const announceText = `Entered the ${TIER_NAMES[tier]} dungeon.`;
    const leaderPartyId = members[0]!.partyId;
    if (leaderPartyId) {
      this.sendToParty(leaderPartyId, { t: "chat", channel: "party", from: "system", text: announceText });
    } else {
      this.sendTo(members[0]!.peer, { t: "chat", channel: "system", from: "system", text: announceText });
    }
  }

  private handleDungeonLeave(player: PlayerState): void {
    if (!player.instanceId) return;
    const instance = this.dungeonInstances.get(player.instanceId);
    this.teleportOutOfDungeon(player, instance ?? null);
    if (instance) {
      instance.memberIds.delete(player.id);
      if (instance.memberIds.size === 0) this.teardownInstance(instance.id);
    }
  }

  private teleportOutOfDungeon(player: PlayerState, instance: DungeonInstance | null): void {
    const portal = instance ? this.dungeonPortals.get(instance.portalId) : null;
    const dest = portal ? { x: portal.x, z: portal.z } : this.nearestGraveyard(player.move.x, player.move.z);
    player.instanceId = null;
    player.move = { x: dest.x, y: terrainHeight(dest.x, dest.z), z: dest.z, vy: 0, grounded: true };
    player.dirty = true;
    for (const pet of this.pets.values()) {
      if (pet.ownerId === player.id) pet.instanceId = null;
    }
    this.sendSelf(player);
    this.sendDungeonState(player, null);
  }

  private sendDungeonState(player: PlayerState, instance: DungeonInstance | null): void {
    if (!instance) {
      this.sendTo(player.peer, { t: "dungeonState", inDungeon: false, tier: null, partySize: 0, mobsRemaining: null });
      return;
    }
    let remaining = 0;
    for (const mobId of instance.mobIds) {
      const mob = this.mobs.get(mobId);
      if (mob && mob.respawnAt === null) remaining++;
    }
    this.sendTo(player.peer, {
      t: "dungeonState",
      inDungeon: true,
      tier: instance.tier,
      partySize: instance.memberIds.size,
      mobsRemaining: remaining,
    });
  }

  private broadcastDungeonState(instance: DungeonInstance): void {
    for (const id of instance.memberIds) {
      const member = this.players.get(id);
      if (member) this.sendDungeonState(member, instance);
    }
  }

  /** Called after a dungeon mob dies -- first time every mob sharing that
   *  instanceId is dead, distribute the run's one-time reward bundle
   *  (per-kill loot/XP is suppressed for dungeon mobs -- see killMob). */
  private checkDungeonCleared(instanceId: string): void {
    const instance = this.dungeonInstances.get(instanceId);
    if (!instance || instance.cleared) return;
    for (const mobId of instance.mobIds) {
      const mob = this.mobs.get(mobId);
      if (mob && mob.respawnAt === null) return; // still someone alive
    }
    this.distributeDungeonRewards(instance);
  }

  private distributeDungeonRewards(instance: DungeonInstance): void {
    instance.cleared = true;
    const tierDef = dungeonTierDef(instance.tier);
    const members = [...instance.memberIds].map((id) => this.players.get(id)).filter((p): p is PlayerState => !!p);
    const xpEach = Math.round(tierDef.rewardXp / Math.max(1, members.length));
    for (const member of members) {
      this.grantXp(member, xpEach);
      const items: { itemId: string; qty: number }[] = [];
      for (const roll of tierDef.rewardItems) {
        if (roll.chance !== undefined && Math.random() > roll.chance) continue;
        const qty = roll.min + Math.floor(Math.random() * (roll.max - roll.min + 1));
        if (qty <= 0) continue;
        const got = qty - addItem(member.inventory, roll.itemId, qty);
        if (got > 0) items.push({ itemId: roll.itemId, qty: got });
      }
      member.dirty = true;
      this.sendInventory(member);
      this.sendTo(member.peer, { t: "dungeonComplete", tier: instance.tier, xp: xpEach, items });
      this.teleportOutOfDungeon(member, instance);
    }
    this.broadcastChat(
      "system",
      `${members.map((m) => m.name).join(", ")} cleared the ${TIER_NAMES[instance.tier]} dungeon!`,
    );
    this.teardownInstance(instance.id);
  }

  /** Called from damagePlayer's death branch (and tickVitals' starvation
   *  death) -- if every member of this player's instance is now dead, start
   *  the wipe-eject countdown. Also called from completeRevive, which is
   *  what clears it back to null if someone revives in time. */
  private checkDungeonWipe(instanceId: string): void {
    const instance = this.dungeonInstances.get(instanceId);
    if (!instance) return;
    for (const id of instance.memberIds) {
      const member = this.players.get(id);
      if (member && !member.dead) {
        instance.wipedAt = null;
        return;
      }
    }
    if (instance.wipedAt === null) instance.wipedAt = Date.now();
  }

  private teardownInstance(instanceId: string): void {
    const instance = this.dungeonInstances.get(instanceId);
    if (!instance) return;
    for (const mobId of instance.mobIds) this.mobs.delete(mobId);
    this.dungeonInstances.delete(instanceId);
  }

  /** Piggybacked on the existing 0.5Hz party-frame tick cadence (see tick()).
   *  Tears down an instance nobody explicitly left but is truly empty
   *  (fully disconnected past the abandon timeout), and ejects a fully-dead
   *  party that nobody revived in time. */
  private tickDungeons(now: number): void {
    for (const instance of [...this.dungeonInstances.values()]) {
      if (instance.memberIds.size === 0) {
        this.teardownInstance(instance.id);
        continue;
      }
      const anyoneConnected = [...instance.memberIds].some((id) => this.players.has(id));
      if (!anyoneConnected && now - instance.lastActivityAt > DUNGEON_ABANDON_TIMEOUT_MS) {
        this.teardownInstance(instance.id);
        continue;
      }
      if (instance.wipedAt !== null && now - instance.wipedAt > DUNGEON_WIPE_EJECT_MS) {
        for (const id of [...instance.memberIds]) {
          const member = this.players.get(id);
          if (member) this.teleportOutOfDungeon(member, instance);
        }
        this.teardownInstance(instance.id);
      }
    }
  }

  // ============================ actions ============================

  private heldItem(player: PlayerState): InvItem | undefined {
    const item = findItem(player.inventory, "hotbar", player.selectedSlot);
    // A spell socketed into the selected slot isn't a real, wieldable item --
    // itemDef() would throw on it. Treat it the same as an empty hand.
    if (item?.itemId.startsWith("spell:")) return undefined;
    return item;
  }

  private setActionAnim(player: PlayerState, anim: AnimState, durationMs = ANIM_ACTION_MS): void {
    player.actionAnim = anim;
    player.actionAnimUntil = Date.now() + durationMs;
  }

  private handleGather(player: PlayerState, nodeId: string): void {
    if (player.dead) return;
    this.dismountForCombat(player);
    const now = Date.now();
    if (now < player.gatherReadyAt) return;
    const node = this.nodes.get(nodeId);
    if (!node || this.depletedNodes.has(nodeId)) return;
    if (dist3D(player.move.x, player.move.y, player.move.z, node.x, node.y, node.z) > GATHER_RANGE) return;

    const type = nodeTypeDef(node.type);
    const held = this.heldItem(player);
    let power = UNARMED_GATHER_POWER;
    if (type.nodeClass !== "pick" && held) {
      const def = itemDef(held.itemId);
      power = def.gatherPower?.[type.nodeClass] ?? UNARMED_GATHER_POWER;
    }

    player.gatherReadyAt = now + GATHER_COOLDOWN_S * 1000;
    this.setActionAnim(player, "gather");
    this.cancelCast(player);

    const remaining = (this.nodeHits.get(nodeId) ?? type.hits) - power;
    const gained = type.yieldPerHit * power;
    const overflow = addItem(player.inventory, type.yieldItem, gained);
    player.dirty = true;
    this.sendInventory(player);
    this.sendEvent(player, {
      t: "event",
      kind: "gather",
      itemId: type.yieldItem,
      amount: gained - overflow,
      x: node.x,
      y: node.y,
      z: node.z,
    });
    this.addQuestGatherProgress(player, type.yieldItem, gained - overflow);

    if (held && type.nodeClass !== "pick" && itemDef(held.itemId).gatherPower) {
      damageDurability(player.inventory, held, 1);
    }

    if (remaining <= 0) {
      this.nodeHits.delete(nodeId);
      const respawnAt = now + type.respawnS * 1000;
      this.depletedNodes.set(nodeId, respawnAt);
      void upsertDepletedNode(nodeId, respawnAt);
      this.broadcast({ t: "nodeUpdate", nodeId, depleted: true });
    } else {
      this.nodeHits.set(nodeId, remaining);
    }
  }

  private handleDrink(player: PlayerState): void {
    if (player.dead) return;
    // Near or in water: player position close to water level counts.
    const nearWater =
      player.move.y < WATER_LEVEL + 0.5 ||
      terrainHeight(player.move.x + WATER_PROXIMITY, player.move.z) < WATER_LEVEL ||
      terrainHeight(player.move.x - WATER_PROXIMITY, player.move.z) < WATER_LEVEL ||
      terrainHeight(player.move.x, player.move.z + WATER_PROXIMITY) < WATER_LEVEL ||
      terrainHeight(player.move.x, player.move.z - WATER_PROXIMITY) < WATER_LEVEL;
    if (!nearWater) {
      this.sendEvent(player, { t: "event", kind: "error", message: "No water nearby" });
      return;
    }
    player.thirst = clamp(player.thirst + DRINK_RESTORE, 0, 100);
    player.dirty = true;
    this.setActionAnim(player, "gather");
    this.sendSelf(player);
  }

  private handleMelee(player: PlayerState): void {
    if (player.dead) return;
    this.dismountForCombat(player);
    const now = Date.now();
    if (now < player.meleeReadyAt) return;
    player.meleeReadyAt = now + MELEE_COOLDOWN_S * 1000;
    this.setActionAnim(player, "attack");
    this.cancelCast(player);

    const held = this.heldItem(player);
    const damage = held ? (itemDef(held.itemId).damage ?? UNARMED_DAMAGE) : UNARMED_DAMAGE;

    const { mob: bestMob, foe: bestFoe } = this.findMeleeTarget(player, MELEE_RANGE);
    if (!bestMob && !bestFoe) return;
    if (held && itemDef(held.itemId).maxDurability) damageDurability(player.inventory, held, 1);
    if (bestFoe) this.damagePlayer(bestFoe, damage, player.id);
    else if (bestMob) this.damageMob(bestMob, damage, player);
  }

  /** dirX/dirZ is a world-space direction from the client (see DodgeMsg) --
   *  not necessarily unit length, and near-zero (e.g. no input held) falls
   *  back to the player's current facing rather than producing no movement. */
  private handleDodge(player: PlayerState, dirX: number, dirZ: number): void {
    if (player.dead || player.dodgeCharges <= 0) return;
    const now = Date.now();
    const mag = Math.hypot(dirX, dirZ);
    const nx = mag < 0.01 ? Math.sin(player.yaw) : dirX / mag;
    const nz = mag < 0.01 ? Math.cos(player.yaw) : dirZ / mag;

    player.dodgeCharges -= 1;
    player.dodgeChargeQueue.push(now + DODGE_CHARGE_REGEN_MS);

    const tx = clamp(player.move.x + nx * DODGE_DISTANCE, WORLD_MIN_X, WORLD_MAX_X);
    const tz = clamp(player.move.z + nz * DODGE_DISTANCE, WORLD_MIN_Z, WORLD_MAX_Z);
    player.move.x = tx;
    player.move.z = tz;
    player.move.y = Math.max(player.move.y, terrainHeight(tx, tz));
    player.dirty = true;
    this.sendSelf(player);
    
    this.broadcastNear(
      tx,
      tz,
      { t: "event", kind: "dodge", sourceId: player.id, dirX: nx, dirZ: nz, x: tx, y: player.move.y, z: tz },
      player.instanceId,
    );
  }

  /** Ticks each missing charge's individual regen timer, refilling one at a
   *  time as they complete (see PlayerState.dodgeChargeQueue). */
  private tickDodgeCharges(player: PlayerState, now: number): void {
    while (player.dodgeChargeQueue.length > 0 && now >= player.dodgeChargeQueue[0]!) {
      player.dodgeChargeQueue.shift();
      player.dodgeCharges = Math.min(DODGE_MAX_CHARGES, player.dodgeCharges + 1);
      player.dirty = true;
    }
  }

  private handleCastStart(player: PlayerState, spellId: string): void {
    if (player.dead || player.casting) return;
    this.dismountForCombat(player);
    if (!player.learnedSpells.includes(spellId)) {
      this.sendEvent(player, { t: "event", kind: "error", message: "Spell not learned" });
      return;
    }
    const spell = spellDef(spellId);
    if (player.level < (spell.requiredLevel ?? 1)) {
      this.sendEvent(player, { t: "event", kind: "error", message: `Requires level ${spell.requiredLevel ?? 1}` });
      return;
    }
    if (player.activeAuras.some((a) => auraDef(a.auraId).silences)) {
      this.sendEvent(player, { t: "event", kind: "error", message: "Silenced" });
      return;
    }
    const now = Date.now();
    if (now < (player.spellCooldowns.get(spellId) ?? 0)) return;
    if (player.mana < spell.resourceCost) {
      this.sendEvent(player, { t: "event", kind: "error", message: "Not enough resource" });
      return;
    }
    // Instant spells (melee/self abilities) resolve immediately -- no cast bar.
    if (spell.castTimeS <= 0) {
      this.resolveSpell(player, spell);
      return;
    }
    player.casting = {
      spellId,
      endsAt: now + spell.castTimeS * 1000,
    };
    this.setActionAnim(player, "cast", spell.castTimeS * 1000);
    this.sendSelf(player);
    this.broadcastNear(
      player.move.x,
      player.move.z,
      { t: "event", kind: "castStart", sourceId: player.id, spellId },
      player.instanceId,
    );
  }

  private cancelCast(player: PlayerState): void {
    if (!player.casting) return;
    player.casting = null;
    player.actionAnim = null;
    this.sendSelf(player);
  }

  private finishCast(player: PlayerState): void {
    const casting = player.casting!;
    player.casting = null;
    this.resolveSpell(player, spellDef(casting.spellId));
  }

  /** Deduct cost/cooldown, then resolve the spell per its targeting kind. */
  private resolveSpell(player: PlayerState, spell: SpellDef): void {
    player.mana = clamp(player.mana - spell.resourceCost, 0, this.maxMana(player));
    player.spellCooldowns.set(spell.id, Date.now() + spell.cooldownS * 1000);
    player.dirty = true;

    if (spell.targeting.kind === "self") {
      this.applySpellEffects(player, null, spell.effects);
      if (spell.summon) this.spawnPet(player, spell.summon.petType);
      // Instant self spells (e.g. Battle Fury) have no cast bar and no
      // damage/heal number of their own to confirm they fired — without
      // this, casting one is completely silent and looks like nothing
      // happened. Mirror the swing animation + a burst of spell-colored
      // particles around the caster that projectile/channeled spells
      // already get for free.
      this.setActionAnim(player, "attack");
      this.broadcastNear(
        player.move.x,
        player.move.z,
        { t: "event", kind: "spellHit", spellId: spell.id, sourceId: player.id, x: player.move.x, y: player.move.y + 1, z: player.move.z },
        player.instanceId,
      );
      this.sendSelf(player);
      return;
    }

    if (spell.targeting.kind === "melee") {
      const target = this.findMeleeTarget(player, spell.targeting.range);
      if (target.mob || target.foe) this.applySpellEffects(player, target, spell.effects);
      // Same reasoning as above: instant melee spells (Rend, Backstab,
      // Poison Strike) never triggered a swing animation, sound, or
      // particle burst before, unlike a plain attack — pressing the spell
      // key looked like it did nothing, especially with no target in range.
      this.setActionAnim(player, "attack");
      this.broadcastNear(
        player.move.x,
        player.move.z,
        { t: "event", kind: "spellHit", spellId: spell.id, sourceId: player.id, x: player.move.x, y: player.move.y + 1, z: player.move.z },
        player.instanceId,
      );
      this.sendSelf(player);
      return;
    }

    if (spell.targeting.kind === "aoe") {
      const r = spell.targeting.radius ?? 6;
      const healing = spell.effects.some((e) => e.type === "heal");
      if (healing) {
        // Allies (self + same party) within radius -- a damage aoe hits
        // enemies, so a heal aoe should hit friends instead of reusing the
        // same enemy-collection loop.
        this.applySpellEffects(player, { mob: null, foe: player }, spell.effects);
        for (const other of this.players.values()) {
          if (other.id === player.id || !player.partyId || other.partyId !== player.partyId) continue;
          if (!this.sameInstance(player, other)) continue;
          if (dist2D(player.move.x, player.move.z, other.move.x, other.move.z) > r) continue;
          this.applySpellEffects(player, { mob: null, foe: other }, spell.effects);
        }
      } else {
        // Every enemy in range takes the hit -- no single-best-match here,
        // unlike melee/projectile (which each resolve exactly one target).
        for (const mob of this.mobs.values()) {
          if (!this.sameInstance(player, mob)) continue;
          if (mob.respawnAt === null && dist2D(player.move.x, player.move.z, mob.x, mob.z) <= r) {
            this.applySpellEffects(player, { mob, foe: null }, spell.effects);
          }
        }
        if (player.pvp) {
          for (const other of this.players.values()) {
            if (other.id === player.id || other.dead || !other.pvp) continue;
            if (!this.sameInstance(player, other)) continue;
            if (dist2D(player.move.x, player.move.z, other.move.x, other.move.z) > r) continue;
            this.applySpellEffects(player, { mob: null, foe: other }, spell.effects);
          }
        }
      }
      this.setActionAnim(player, "attack");
      this.broadcastNear(
        player.move.x,
        player.move.z,
        { t: "event", kind: "spellHit", spellId: spell.id, sourceId: player.id, x: player.move.x, y: player.move.y + 1, z: player.move.z },
        player.instanceId,
      );
      this.sendSelf(player);
      return;
    }

    // Projectile: spawn a homing bolt; effects resolve on hit in tickProjectiles.
    const id = `p${++this.projectileSeq}`;
    const dx = Math.sin(player.yaw);
    const dz = Math.cos(player.yaw);
    const range = spell.targeting.range;
    // Lock onto the nearest enemy roughly ahead so loose aim still connects.
    const homingId = this.acquireHomingTarget(player, range);
    this.projectiles.set(id, {
      id,
      spellId: spell.id,
      ownerId: player.id,
      x: player.move.x + dx * 0.8,
      y: player.move.y + 1.4,
      z: player.move.z + dz * 0.8,
      dx,
      dy: 0,
      dz,
      traveled: 0,
      // A curving path is longer than a straight one — give homing shots slack.
      maxRange: homingId ? range * 1.7 : range,
      effects: spell.effects,
      speed: spell.targeting.projectileSpeed ?? 24,
      homingId,
      instanceId: player.instanceId,
    });
    this.sendSelf(player);
  }

  /** Nearest enemy (mob, or pvp player if caster is flagged) within range and
   *  a generous forward cone — the projectile then curves toward it. */
  private acquireHomingTarget(player: PlayerState, range: number): string | null {
    let bestId: string | null = null;
    let bestScore = Infinity;
    const consider = (tx: number, tz: number, id: string) => {
      const d = dist2D(player.move.x, player.move.z, tx, tz);
      if (d > range) return;
      const angle = Math.abs(wrapAngle(Math.atan2(tx - player.move.x, tz - player.move.z) - player.yaw));
      if (angle > Math.PI * 0.5) return; // must be within ~90° of facing
      const score = d + angle * 12; // prefer close + well-aimed
      if (score < bestScore) {
        bestScore = score;
        bestId = id;
      }
    };
    for (const mob of this.mobs.values()) {
      if (mob.respawnAt !== null || !this.sameInstance(player, mob)) continue;
      consider(mob.x, mob.z, mob.id);
    }
    if (player.pvp) {
      for (const other of this.players.values()) {
        if (other.id === player.id || other.dead || !other.pvp) continue;
        if (!this.sameInstance(player, other)) continue;
        consider(other.move.x, other.move.z, other.id);
      }
    }
    return bestId;
  }

  /** Current world position of a homing target (mob or player), or null. */
  private homingTargetPos(id: string): { x: number; y: number; z: number } | null {
    const mob = this.mobs.get(id);
    if (mob && mob.respawnAt === null) return { x: mob.x, y: mob.y + 0.8, z: mob.z };
    const player = this.players.get(id);
    if (player && !player.dead) return { x: player.move.x, y: player.move.y + 1.2, z: player.move.z };
    return null;
  }

  private handleCraft(player: PlayerState, recipeId: string): void {
    if (player.dead) return;
    const recipe = RECIPES[recipeId];
    if (!recipe) return;

    if (recipe.station) {
      const near = this.structures.some(
        (s) => s.type === recipe.station && dist2D(s.x, s.z, player.move.x, player.move.z) < 5,
      );
      if (!near) {
        this.sendEvent(player, { t: "event", kind: "error", message: `Requires a ${recipe.station} nearby` });
        return;
      }
    }

    // Get all items in the player's crafting grid slots (container: "crafting")
    const gridItems = player.inventory.filter((it) => it.container === "crafting");
    
    // Group grid items by itemId
    const gridTotals: Record<string, number> = {};
    for (const it of gridItems) {
      gridTotals[it.itemId] = (gridTotals[it.itemId] ?? 0) + it.qty;
    }

    // Verify ingredients are present in the grid in correct quantities
    for (const ing of recipe.ingredients) {
      const total = gridTotals[ing.itemId] ?? 0;
      if (total < ing.qty) {
        this.sendEvent(player, { t: "event", kind: "error", message: `Requires at least ${ing.qty}x ${itemDef(ing.itemId).name} in the grid` });
        return;
      }
    }

    // Check inventory capacity first by copying inventory
    const tempInv: InvItem[] = JSON.parse(JSON.stringify(player.inventory));

    // Remove ingredients from tempInv's crafting slots
    for (const ing of recipe.ingredients) {
      let remaining = ing.qty;
      for (let i = tempInv.length - 1; i >= 0 && remaining > 0; i--) {
        const item = tempInv[i]!;
        if (item.container === "crafting" && item.itemId === ing.itemId) {
          const take = Math.min(item.qty, remaining);
          item.qty -= take;
          remaining -= take;
          if (item.qty <= 0) {
            tempInv.splice(i, 1);
          }
        }
      }
    }

    // Extract all leftover/unneeded crafting items from tempInv to move them to inventory/hotbar
    const itemsToReturn: { itemId: string; qty: number }[] = [];
    for (let i = tempInv.length - 1; i >= 0; i--) {
      const item = tempInv[i]!;
      if (item.container === "crafting") {
        itemsToReturn.push({ itemId: item.itemId, qty: item.qty });
        tempInv.splice(i, 1);
      }
    }

    // Try to add returned items back to the player's inventory slots in tempInv
    for (const ret of itemsToReturn) {
      const overflow = addItem(tempInv, ret.itemId, ret.qty);
      if (overflow > 0) {
        this.sendEvent(player, { t: "event", kind: "error", message: "Inventory full (cannot return extra ingredients)" });
        return;
      }
    }

    // Try to add recipe output to the inventory slots in tempInv
    const outputOverflow = addItem(tempInv, recipe.output, recipe.outputQty);
    if (outputOverflow > 0) {
      this.sendEvent(player, { t: "event", kind: "error", message: "Inventory full" });
      return;
    }

    // All checks passed! Update player inventory
    player.inventory = tempInv;
    player.dirty = true;
    this.sendInventory(player);
    this.sendEvent(player, { t: "event", kind: "gather", itemId: recipe.output, amount: recipe.outputQty - outputOverflow });
  }

  private handleConsume(player: PlayerState, container: InvItem["container"], slot: number): void {
    if (player.dead) return;
    const item = findItem(player.inventory, container, slot);
    if (!item) return;
    const def = itemDef(item.itemId);

    if (def.type === "tome" && def.teachesSpell) {
      if (!player.learnedSpells.includes(def.teachesSpell)) {
        player.learnedSpells.push(def.teachesSpell);
        decrementSlot(player.inventory, container, slot);
        player.dirty = true;
        this.sendInventory(player);
        this.sendEvent(player, { t: "event", kind: "learnSpell", spellId: def.teachesSpell });
      }
      return;
    }

    if (def.type !== "consumable") return;

    let consumed = false;

    if (def.restore) {
      player.hp = clamp(player.hp + (def.restore.hp ?? 0), 0, this.maxHp(player));
      player.mana = clamp(player.mana + (def.restore.mana ?? 0), 0, this.maxMana(player));
      player.hunger = clamp(player.hunger + (def.restore.hunger ?? 0), 0, 100);
      player.thirst = clamp(player.thirst + (def.restore.thirst ?? 0), 0, 100);
      consumed = true;
    }

    if (def.applyAuraOnConsume) {
      player.activeAuras = applyAura(player.activeAuras, def.applyAuraOnConsume, player.id, Date.now());
      if (def.applyAuraOnConsume === "invisible") {
        for (const mob of this.mobs.values()) {
          if (mob.targetId === player.id) {
            mob.targetId = null;
          }
        }
      }
      consumed = true;
    }

    if (consumed) {
      decrementSlot(player.inventory, container, slot);
      player.dirty = true;
      this.setActionAnim(player, "gather");
      this.sendInventory(player);
      this.sendSelf(player);
    }
  }

  private async handlePlace(player: PlayerState, container: InvItem["container"], slot: number): Promise<void> {
    if (player.dead) return;
    const item = findItem(player.inventory, container, slot);
    if (!item) return;
    const def = itemDef(item.itemId);
    if (def.type !== "placeable" || !def.placesStructure) return;

    const x = player.move.x + Math.sin(player.yaw) * 2;
    const z = player.move.z + Math.cos(player.yaw) * 2;
    const y = terrainHeight(x, z);
    if (y < WATER_LEVEL) {
      this.sendEvent(player, { t: "event", kind: "error", message: "Can't place in water" });
      return;
    }

    decrementSlot(player.inventory, container, slot);
    player.dirty = true;
    const id = await insertStructure({ ownerId: player.id, type: def.placesStructure, x, y, z, yaw: player.yaw });
    const structure: StructureSnap = { id, type: def.placesStructure, ownerId: player.id, x, y, z, yaw: player.yaw };
    this.structures.push(structure);
    this.sendInventory(player);
    this.broadcast({ t: "structureAdd", structure });
  }

  /** Puts a *newly chosen* spell from the spellbook into a hotbar slot (or
   *  clears it with spellId: null). Rearranging a spell already slotted
   *  goes through the normal "moveItem" hotbar<->hotbar path instead --
   *  this one's only job is planting a fresh spell-marker entry. */
  private handleAssignSpell(player: PlayerState, spellId: string | null, slot: number): void {
    if (player.dead || slot >= HOTBAR_SLOTS) return;
    if (spellId !== null) {
      if (!player.learnedSpells.includes(spellId)) return;
      const spell = spellDef(spellId);
      if (player.level < (spell.requiredLevel ?? 1)) {
        this.sendEvent(player, { t: "event", kind: "error", message: `Requires level ${spell.requiredLevel ?? 1}` });
        return;
      }
    }
    // Clear the destination slot, and any other hotbar slot already holding
    // this same spell -- a spell can only occupy one bar slot at a time, so
    // picking it from the spellbook again relocates it instead of
    // duplicating it (the spellbook itself isn't a consumed source).
    for (let i = player.inventory.length - 1; i >= 0; i--) {
      const it = player.inventory[i]!;
      if (it.container !== "hotbar") continue;
      if (it.slot === slot || (spellId !== null && it.itemId === `spell:${spellId}`)) {
        player.inventory.splice(i, 1);
      }
    }
    if (spellId !== null) {
      player.inventory.push({ container: "hotbar", slot, itemId: `spell:${spellId}`, qty: 1, durability: null });
    }
    player.dirty = true;
    this.sendInventory(player);
  }

  private handleRespawn(player: PlayerState): void {
    if (!player.dead) return;
    player.dead = false;
    player.hp = this.maxHp(player) * RESPAWN_HP_FRACTION;
    player.mana = this.maxMana(player) * 0.5;
    player.hunger = Math.max(player.hunger, 30);
    player.thirst = Math.max(player.thirst, 30);

    // Respawn at the nearest village graveyard, falling back to world spawn.
    const grave = this.nearestGraveyard(player.move.x, player.move.z);
    player.move = {
      x: grave.x + (Math.random() - 0.5) * 6,
      y: terrainHeight(grave.x, grave.z) + 0.1,
      z: grave.z + (Math.random() - 0.5) * 6,
      vy: 0,
      grounded: true,
    };
    player.dirty = true;
    this.sendSelf(player);
  }

  private nearestGraveyard(x: number, z: number): { x: number; z: number } {
    // Respawn at the closest village; only fall back to world spawn if the
    // realm has no villages at all.
    let best: { x: number; z: number } | null = null;
    let bestDist = Infinity;
    for (const village of this.villages) {
      const d = dist2D(x, z, village.x, village.z);
      if (d < bestDist) {
        bestDist = d;
        best = { x: village.x, z: village.z };
      }
    }
    return best ?? { x: SPAWN_POINT.x, z: SPAWN_POINT.z };
  }

  // ============================ combat ============================

  private damageMob(mob: MobState, amount: number, attacker: PlayerState): void {
    mob.hp -= amount;
    mob.targetId = attacker.id;
    this.broadcastNear(
      mob.x,
      mob.z,
      { t: "event", kind: "damage", sourceId: attacker.id, targetId: mob.id, amount, x: mob.x, y: mob.y + 1, z: mob.z },
      mob.instanceId,
    );
    if (mob.hp <= 0) this.killMob(mob, attacker);
  }

  private killMob(mob: MobState, killer: PlayerState): void {
    const def = mobDef(mob.type);
    mob.targetId = null;
    mob.hp = 0;

    if (mob.instanceId) {
      // Dungeon mobs never respawn on the normal timer -- they're deleted
      // for real when the instance tears down (see teardownInstance) -- and
      // per-kill loot/XP/quest progress is suppressed in favor of the
      // single end-of-run reward bundle (see distributeDungeonRewards).
      mob.respawnAt = Infinity;
      const instance = this.dungeonInstances.get(mob.instanceId);
      if (instance) {
        instance.lastActivityAt = Date.now();
        this.broadcastDungeonState(instance);
        this.checkDungeonCleared(mob.instanceId);
      }
      return;
    }

    mob.respawnAt = Date.now() + def.respawnS * 1000;
    for (const loot of def.loot) {
      if (loot.chance !== undefined && Math.random() > loot.chance) continue;
      const qty = loot.min + Math.floor(Math.random() * (loot.max - loot.min + 1));
      if (qty > 0) {
        const got = qty - addItem(killer.inventory, loot.itemId, qty);
        if (got > 0) {
          this.sendEvent(killer, { t: "event", kind: "gather", itemId: loot.itemId, amount: got });
          this.addQuestGatherProgress(killer, loot.itemId, got);
        }
      }
    }
    killer.dirty = true;
    this.sendInventory(killer);
    this.grantXp(killer, def.xp);
    this.addQuestKillProgress(killer, mob.type);
  }

  private grantXp(player: PlayerState, amount: number): void {
    if (player.level >= MAX_LEVEL) return;
    player.xp += amount;
    this.sendEvent(player, { t: "event", kind: "xp", amount });
    while (player.level < MAX_LEVEL && player.xp >= xpForLevel(player.level)) {
      player.xp -= xpForLevel(player.level);
      player.level += 1;
      player.hp = this.maxHp(player); // level-up heals
      player.mana = this.maxMana(player);
      this.sendEvent(player, { t: "event", kind: "levelup", amount: player.level });
      this.broadcastChat("system", `${player.name} reached level ${player.level}!`);
      this.setActionAnim(player, "cheer", 1500);
    }
    player.dirty = true;
    this.sendSelf(player);
  }

  private damagePlayer(player: PlayerState, rawAmount: number, sourceId: string): void {
    if (player.dead) return;
    // Single choke point for all incoming damage (melee, mob attacks, spells,
    // aura DoTs) so equipped armor passively mitigates everything uniformly.
    const amount = rawAmount * armorMitigation(this.computeStats(player).armor) * (player.blocking ? 0.5 : 1);
    this.dismountForCombat(player);
    player.hp -= amount;
    player.dirty = true;
    this.cancelCast(player);
    this.cancelRevive(player);
    this.broadcastNear(
      player.move.x,
      player.move.z,
      { t: "event", kind: "damage", sourceId, targetId: player.id, amount, x: player.move.x, y: player.move.y + 1.5, z: player.move.z },
      player.instanceId,
    );
    if (player.hp <= 0) {
      player.hp = 0;
      player.dead = true;
      player.reviving = null;
      this.sendEvent(player, { t: "event", kind: "death" });
      const killer = this.players.get(sourceId);
      this.broadcastChat(
        "system",
        killer ? `${player.name} was slain by ${killer.name}!` : `${player.name} died.`,
      );
      for (const mob of this.mobs.values()) {
        if (mob.targetId === player.id) mob.targetId = null;
      }
      if (player.instanceId) this.checkDungeonWipe(player.instanceId);
    }
    this.sendSelf(player);
  }

  // ============================ tick ============================

  private tick(): void {
    this.tickCount++;
    const now = Date.now();

    for (const player of this.players.values()) {
      this.tickPlayerMovement(player, now);
      if (
        !this.regionTwoActive &&
        dist2D(player.move.x, player.move.z, REGION_TWO_GATE_X, REGION_TWO_GATE_Z) < REGION_TWO_TRIGGER_RADIUS
      ) {
        this.activateRegionTwo();
      }
      this.tickVitals(player, now);
      this.tickPlayerAuras(player, now);
      this.tickDodgeCharges(player, now);
      // Casting no longer cancels on movement -- players can walk/kite while
      // channeling, matching modern MMO combat instead of forcing a stop.
      // Taking damage still interrupts a cast (see damagePlayer).
      if (player.casting && now >= player.casting.endsAt) this.finishCast(player);
      if (player.actionAnim && now > player.actionAnimUntil) player.actionAnim = null;
    }

    this.tickProjectiles();
    this.tickMobs(now);
    this.tickPets(now);
    this.tickNodeRespawns(now);

    // Full 20Hz broadcast (sendSnapshots already includes each viewer's own
    // self-ack) -- previously throttled to every 2nd tick, but that 100ms
    // cadence forced a large client-side interpolation buffer to avoid
    // stutter, which in turn made remote mobs/pets feel visibly laggy next
    // to the player's own zero-latency prediction. Halving the cadence gap
    // lets the buffer shrink back down without reintroducing the stutter.
    this.sendSnapshots();
    // Party frames refresh at 0.5 Hz — enough for out-of-range member HP.
    if (this.tickCount % 40 === 0) {
      for (const partyId of this.parties.keys()) this.broadcastPartyState(partyId);
      this.broadcastRoster();
      this.tickDungeons(now);
    }
  }

  private tickPlayerMovement(player: PlayerState, now: number): void {
    if (player.dead) {
      player.inputQueue.length = 0;
      player.lastMoveMag = 0;
      return;
    }
    const inputs = player.inputQueue.splice(0, MAX_INPUTS_PER_TICK);
    const inDungeon = player.instanceId !== null;
    if (inputs.length === 0) {
      // Keep physics ticking (falling, water) even without fresh input.
      player.move = stepMovement(
        player.move,
        { moveX: 0, moveZ: 0, jump: false, sprint: false, mount: player.mount, inDungeon },
        TICK_DT,
      );
      player.lastMoveMag = 0;
      return;
    }
    for (const input of inputs) {
      player.yaw = input.yaw;
      player.blocking = input.block;
      // Sitting breaks the instant real movement input arrives -- checked
      // before zeroing below, so standing up and walking away happens in the
      // same tick instead of a dead frame.
      const wantsMove = input.moveX !== 0 || input.moveZ !== 0;
      if (player.sitting && wantsMove) player.sitting = null;
      const rooted = player.sitting !== null || input.block;
      const moveX = rooted ? 0 : input.moveX;
      const moveZ = rooted ? 0 : input.moveZ;
      player.move = stepMovement(
        player.move,
        { moveX, moveZ, jump: input.jump, sprint: input.sprint, mount: player.mount, inDungeon },
        TICK_DT,
      );
      player.lastAckSeq = input.seq;
      player.lastMoveMag = Math.hypot(moveX, moveZ);
    }
    // Only the final queued input's intent matters here (same as yaw/
    // blocking above) -- re-evaluated every tick against the *current*
    // position, so releasing E, moving out of range, or the target no
    // longer being dead all naturally end the channel with no separate
    // cancel message needed.
    this.updateRevive(player, inputs[inputs.length - 1]!.revivingId, now);
    player.dirty = true;
  }

  private updateRevive(player: PlayerState, targetId: string | null, now: number): void {
    if (!targetId) {
      this.cancelRevive(player);
      return;
    }
    const target = this.players.get(targetId);
    if (!target || !target.dead || dist2D(player.move.x, player.move.z, target.move.x, target.move.z) > REVIVE_RANGE) {
      this.cancelRevive(player);
      return;
    }
    if (!player.reviving || player.reviving.targetId !== targetId) {
      player.reviving = { targetId, startedAt: now };
      this.sendSelf(player);
      return;
    }
    if (now - player.reviving.startedAt >= REVIVE_HOLD_MS) {
      this.completeRevive(player, target);
    }
  }

  private completeRevive(reviver: PlayerState, target: PlayerState): void {
    reviver.reviving = null;
    target.dead = false;
    target.hp = this.maxHp(target) * REVIVE_HP_FRACTION;
    target.dirty = true;
    this.sendSelf(target);
    this.sendSelf(reviver);
    this.broadcastNear(
      target.move.x,
      target.move.z,
      { t: "event", kind: "revive", sourceId: reviver.id, targetId: target.id, x: target.move.x, y: target.move.y + 1.5, z: target.move.z },
      target.instanceId,
    );
    this.broadcastChat("system", `${reviver.name} revived ${target.name}.`);
    if (target.instanceId) this.checkDungeonWipe(target.instanceId);
  }

  private cancelRevive(player: PlayerState): void {
    if (!player.reviving) return;
    player.reviving = null;
    this.sendSelf(player);
  }

  private tickVitals(player: PlayerState, now: number): void {
    if (player.dead) return;
    player.hunger = clamp(player.hunger - HUNGER_DECAY_PER_S * TICK_DT, 0, 100);
    player.thirst = clamp(player.thirst - THIRST_DECAY_PER_S * TICK_DT, 0, 100);
    const manaMult = player.sitting !== null ? SIT_MANA_REGEN_MULT : 1;
    player.mana = clamp(player.mana + MANA_REGEN_PER_S * manaMult * TICK_DT, 0, this.maxMana(player));

    if (player.hunger <= 0 || player.thirst <= 0) {
      player.hp -= STARVATION_DPS * TICK_DT;
      if (player.hp <= 0) {
        player.hp = 0;
        player.dead = true;
        player.mount = null;
        this.sendEvent(player, { t: "event", kind: "death" });
        this.broadcastChat("system", `${player.name} starved to death.`);
        if (player.instanceId) this.checkDungeonWipe(player.instanceId);
      }
    } else if (player.hunger > 30 && player.thirst > 30) {
      player.hp = clamp(player.hp + HP_REGEN_PER_S * TICK_DT, 0, this.maxHp(player));
    }
  }

  private tickProjectiles(): void {
    for (const proj of [...this.projectiles.values()]) {
      // Homing: curve the velocity toward the locked target at a capped turn
      // rate so the bolt bends in rather than snapping.
      if (proj.homingId) {
        const tp = this.homingTargetPos(proj.homingId);
        if (!tp) {
          proj.homingId = null;
        } else {
          const dirX = tp.x - proj.x;
          const dirY = tp.y - proj.y;
          const dirZ = tp.z - proj.z;
          const len = Math.hypot(dirX, dirY, dirZ) || 1;
          // Curve harder when the target is close so fast bolts still bend in.
          const MAX_TURN = len < 8 ? 0.55 : 0.32;
          proj.dx += ((dirX / len) - proj.dx) * MAX_TURN;
          proj.dy += ((dirY / len) - proj.dy) * MAX_TURN;
          proj.dz += ((dirZ / len) - proj.dz) * MAX_TURN;
          const n = Math.hypot(proj.dx, proj.dy, proj.dz) || 1;
          proj.dx /= n;
          proj.dy /= n;
          proj.dz /= n;
        }
      }

      const step = proj.speed * TICK_DT;
      proj.x += proj.dx * step;
      proj.y += proj.dy * step;
      proj.z += proj.dz * step;
      proj.traveled += step;

      let hit = false;
      const owner = this.players.get(proj.ownerId);
      for (const mob of this.mobs.values()) {
        if (mob.respawnAt !== null || !this.sameInstance(proj, mob)) continue;
        if (dist3D(proj.x, proj.y, proj.z, mob.x, mob.y + 0.8, mob.z) < 1.7) {
          if (owner) this.applySpellEffects(owner, { mob, foe: null }, proj.effects);
          this.broadcastNear(
            proj.x,
            proj.z,
            { t: "event", kind: "spellHit", spellId: proj.spellId, x: proj.x, y: proj.y, z: proj.z },
            proj.instanceId,
          );
          hit = true;
          break;
        }
      }
      // PvP: firebolts strike flagged players when the caster is flagged too.
      if (!hit && owner?.pvp) {
        for (const other of this.players.values()) {
          if (other.id === proj.ownerId || other.dead || !other.pvp) continue;
          if (!this.sameInstance(proj, other)) continue;
          if (dist3D(proj.x, proj.y, proj.z, other.move.x, other.move.y + 1.2, other.move.z) < 1.7) {
            if (owner) this.applySpellEffects(owner, { mob: null, foe: other }, proj.effects);
            this.broadcastNear(
              proj.x,
              proj.z,
              { t: "event", kind: "spellHit", spellId: proj.spellId, x: proj.x, y: proj.y, z: proj.z },
              proj.instanceId,
            );
            hit = true;
            break;
          }
        }
      }
      const groundHit = proj.y < terrainHeight(proj.x, proj.z);
      if (hit || groundHit || proj.traveled >= proj.maxRange) {
        this.projectiles.delete(proj.id);
      }
    }
  }

  private tickMobs(now: number): void {
    for (const mob of this.mobs.values()) {
      const def = mobDef(mob.type);

      if (mob.respawnAt !== null) {
        // Infinity for a dungeon mob (see killMob) -- `now >= mob.respawnAt`
        // is never true, so it just stays inert until teardownInstance
        // deletes it for real.
        if (now >= mob.respawnAt) {
          mob.respawnAt = null;
          mob.hp = def.maxHp * mob.hpMult;
          mob.activeAuras = [];
          mob.x = mob.homeX;
          mob.z = mob.homeZ;
          mob.y = terrainHeight(mob.x, mob.z);
          mob.targetId = null;
        }
        continue;
      }

      this.tickMobAuras(mob, now);
      if (mob.respawnAt !== null) continue; // an aura DoT may have just killed it

      const distHome = dist2D(mob.x, mob.z, mob.homeX, mob.homeZ);

      // Acquire target.
      if (!mob.targetId) {
        for (const player of this.players.values()) {
          if (player.dead) continue;
          if (player.activeAuras.some((a) => a.auraId === "invisible")) continue;
          if (!this.sameInstance(mob, player)) continue;
          if (dist2D(mob.x, mob.z, player.move.x, player.move.z) < def.aggroRange) {
            mob.targetId = player.id;
            break;
          }
        }
      }

      // A mob's target may be a player OR a pet (whichever last damaged it --
      // see damageMob/damageMobFromPet) -- resolve either into one shape so
      // the chase/attack logic below doesn't need to care which it is.
      const target = mob.targetId ? this.mobTargetInfo(mob.targetId) : null;
      if (mob.targetId && (!target || target.dead)) {
        mob.targetId = null;
      }

      if (target && !target.dead && distHome < def.leashRange) {
        // Chase / attack.
        const d = dist2D(mob.x, mob.z, target.x, target.z);
        mob.yaw = turnToward(mob.yaw, Math.atan2(target.x - mob.x, target.z - mob.z), MOB_TURN_STEP);
        if (d > def.attackRange) {
          this.moveMob(mob, target.x, target.z, def.speed);
        } else if (now >= mob.attackReadyAt) {
          mob.attackReadyAt = now + def.attackCooldownS * 1000;
          mob.actionAnimUntil = now + ANIM_ACTION_MS;
          this.applyMobAttack(mob, mob.targetId!, def.damage * mob.dmgMult);
        }
      } else {
        if (mob.targetId) mob.targetId = null; // leash: give up
        if (distHome > 2 && distHome > def.leashRange * 0.5) {
          this.moveMob(mob, mob.homeX, mob.homeZ, def.speed * 0.9);
          if (distHome > def.leashRange * 0.9) mob.hp = def.maxHp * mob.hpMult; // reset heal
        } else {
          // Wander.
          if (now >= mob.nextWanderAt) {
            const r = hash2(now & 0xffff, Math.round(mob.homeX), Math.round(mob.homeZ));
            const angle = r * Math.PI * 2;
            const radius = 4 + r * 10;
            mob.wanderTx = mob.homeX + Math.sin(angle) * radius;
            mob.wanderTz = mob.homeZ + Math.cos(angle) * radius;
            mob.nextWanderAt = now + 3000 + r * 5000;
          }
          if (dist2D(mob.x, mob.z, mob.wanderTx, mob.wanderTz) > 1) {
            this.moveMob(mob, mob.wanderTx, mob.wanderTz, def.wanderSpeed);
          }
        }
      }
    }
  }

  /** Resolves a mob's targetId to whichever it actually is -- a player or a
   *  pet -- in one normalized shape, so tickMobs' chase/attack logic doesn't
   *  need two parallel branches for who it's fighting. */
  private mobTargetInfo(id: string): { x: number; z: number; dead: boolean } | null {
    const player = this.players.get(id);
    if (player) return { x: player.move.x, z: player.move.z, dead: player.dead };
    const pet = this.pets.get(id);
    if (pet) return { x: pet.x, z: pet.z, dead: pet.hp <= 0 };
    return null;
  }

  private findPetByOwner(ownerId: string): PetState | undefined {
    for (const pet of this.pets.values()) if (pet.ownerId === ownerId) return pet;
    return undefined;
  }

  /** A mob's attack lands on whichever kind of target it resolved to. */
  private applyMobAttack(mob: MobState, targetId: string, damage: number): void {
    const player = this.players.get(targetId);
    if (player) {
      this.damagePlayer(player, damage, mob.id);
      return;
    }
    const pet = this.pets.get(targetId);
    if (pet) this.damagePet(pet, damage, mob.id);
  }

  /** Mirrors damageMob, but for a pet's attacker: aggro snaps to the pet
   *  (so the mob retaliates against it, not the owner) and kill credit
   *  (loot/xp/quest progress) goes to the pet's owner instead. */
  private damageMobFromPet(mob: MobState, amount: number, pet: PetState): void {
    mob.hp -= amount;
    mob.targetId = pet.id;
    this.broadcastNear(
      mob.x,
      mob.z,
      { t: "event", kind: "damage", sourceId: pet.id, targetId: mob.id, amount, x: mob.x, y: mob.y + 1, z: mob.z },
      mob.instanceId,
    );
    if (mob.hp <= 0) {
      const owner = this.players.get(pet.ownerId);
      if (owner) {
        this.killMob(mob, owner);
      } else {
        const def = mobDef(mob.type);
        mob.respawnAt = mob.instanceId ? Infinity : Date.now() + def.respawnS * 1000;
        mob.targetId = null;
        mob.hp = 0;
      }
    }
  }

  /** Mirrors damagePlayer for a pet on the receiving end -- no armor
   *  mitigation (mobs don't mitigate against pets either), and death just
   *  removes it (no respawn/leash) and clears the owner's damage buff. */
  private damagePet(pet: PetState, rawAmount: number, sourceId: string): void {
    pet.hp -= rawAmount;
    this.broadcastNear(
      pet.x,
      pet.z,
      { t: "event", kind: "damage", sourceId, targetId: pet.id, amount: rawAmount, x: pet.x, y: pet.y + 1, z: pet.z },
      pet.instanceId,
    );
    if (pet.hp <= 0) {
      pet.hp = 0;
      this.pets.delete(pet.id);
      const owner = this.players.get(pet.ownerId);
      if (owner) {
        owner.activeAuras = removeAura(owner.activeAuras, "beast_mastery_buff");
        this.sendSelf(owner);
      }
    }
  }

  /** Beast Mastery et al: replace whatever pet this player already has (only
   *  one at a time) with a fresh one at full health beside them. */
  private spawnPet(owner: PlayerState, petType: string): void {
    for (const [id, existing] of this.pets) {
      if (existing.ownerId === owner.id) this.pets.delete(id);
    }
    const def = mobDef(petType);
    const ang = owner.yaw + Math.PI / 3;
    const x = owner.move.x + Math.sin(ang) * 1.5;
    const z = owner.move.z + Math.cos(ang) * 1.5;
    const id = `pet_${owner.id}_${Date.now()}`;
    this.pets.set(id, {
      id,
      ownerId: owner.id,
      type: petType,
      x,
      y: terrainHeight(x, z),
      z,
      yaw: owner.yaw,
      hp: def.maxHp,
      targetId: null,
      attackReadyAt: 0,
      actionAnimUntil: 0,
      following: false,
      instanceId: owner.instanceId,
    });
  }

  /** Pets: no leash/home/respawn -- follow the owner, defend them (or
   *  proactively engage whatever's nearby and hostile), and simply vanish on
   *  death or if the owner disconnects. Re-summoning (spawnPet) is the only
   *  way to get a new one, gated by the spell's own cooldown. */
  private tickPets(now: number): void {
    for (const [id, pet] of this.pets) {
      const owner = this.players.get(pet.ownerId);
      if (!owner || owner.dead || pet.hp <= 0) {
        this.pets.delete(id);
        if (owner) {
          owner.activeAuras = removeAura(owner.activeAuras, "beast_mastery_buff");
          this.sendSelf(owner);
        }
        continue;
      }

      // Defensive re-sync every tick rather than trusting every dungeon
      // enter/leave call site to have set it -- cheap, and a stale value
      // here would let a pet see/fight across instance boundaries.
      pet.instanceId = owner.instanceId;

      const def = mobDef(pet.type);
      let target = pet.targetId ? this.mobs.get(pet.targetId) : undefined;
      if (target && target.respawnAt !== null) target = undefined;

      // If owner has targeted a valid enemy, check if it's close enough in range
      let ownerTarget = owner.currentTargetId ? this.mobs.get(owner.currentTargetId) : undefined;
      if (ownerTarget && ownerTarget.respawnAt !== null) ownerTarget = undefined;
      if (ownerTarget && !this.sameInstance(owner, ownerTarget)) ownerTarget = undefined;

      if (ownerTarget) {
        const distToOwnerTarget = dist2D(owner.move.x, owner.move.z, ownerTarget.x, ownerTarget.z);
        if (distToOwnerTarget < 18) {
          target = ownerTarget;
          pet.targetId = ownerTarget.id;
        }
      }

      if (!target) pet.targetId = null;

      if (!target) {
        // Prefer whatever's already attacking the owner (defend); else the
        // nearest hostile within the pet's own aggro range (proactive).
        let bestDist = Infinity;
        for (const mob of this.mobs.values()) {
          if (mob.respawnAt !== null || !this.sameInstance(owner, mob)) continue;
          const mobDefC = mobDef(mob.type);
          const d = dist2D(owner.move.x, owner.move.z, mob.x, mob.z);
          const inRange = mob.targetId === owner.id ? d < mobDefC.leashRange : d < mobDefC.aggroRange;
          if (inRange && d < bestDist) {
            bestDist = d;
            target = mob;
          }
        }
        if (target) pet.targetId = target.id;
      }

      if (target) {
        const d = dist2D(pet.x, pet.z, target.x, target.z);
        pet.yaw = turnToward(pet.yaw, Math.atan2(target.x - pet.x, target.z - pet.z), MOB_TURN_STEP);
        if (d > def.attackRange) {
          const isOwnerTarget = owner.currentTargetId === target.id;
          const speedMult = isOwnerTarget ? 1.6 : 1.15;
          this.moveMob(pet, target.x, target.z, def.speed * speedMult);
        } else if (now >= pet.attackReadyAt) {
          pet.attackReadyAt = now + def.attackCooldownS * 1000;
          pet.actionAnimUntil = now + ANIM_ACTION_MS;
          const dmg = def.damage + this.computeStats(owner).power * 0.3;
          this.damageMobFromPet(target, dmg, pet);
        }
      } else {
        const d = dist2D(pet.x, pet.z, owner.move.x, owner.move.z);
        // Hysteresis, not a single threshold: a lone "d > 3" cutoff made the
        // pet flip between idle and run every tick whenever the gap hovered
        // right at the boundary -- which it constantly does while the owner
        // runs continuously. It still catches up gradually rather than
        // matching sprint speed -- trailing behind and eventually closing
        // the gap is the intended look, not an instant snap back to heel.
        if (d > 3) pet.following = true;
        else if (d < 1.2) pet.following = false;
        if (pet.following) {
          this.moveMob(pet, owner.move.x, owner.move.z, def.speed * 0.85);
        }
      }
    }
  }

  /** Shared by mobs and pets -- both are just an x/y/z/yaw position that
   *  steps toward a target each tick, so the type only needs those fields. */
  private moveMob(mob: { x: number; y: number; z: number; yaw: number }, tx: number, tz: number, speed: number): void {
    const dx = tx - mob.x;
    const dz = tz - mob.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.01) return;
    const step = Math.min(speed * TICK_DT, d);
    const nx = mob.x + (dx / d) * step;
    const nz = mob.z + (dz / d) * step;
    const ny = terrainHeight(nx, nz);
    if (ny < WATER_LEVEL - 0.2) return; // wolves won't swim
    mob.x = nx;
    mob.z = nz;
    mob.y = ny;
    mob.yaw = turnToward(mob.yaw, Math.atan2(dx, dz), MOB_TURN_STEP);
  }

  private tickNodeRespawns(now: number): void {
    if (this.tickCount % 20 !== 0) return; // check once a second
    const respawned: string[] = [];
    for (const [nodeId, at] of this.depletedNodes) {
      if (now >= at) {
        this.depletedNodes.delete(nodeId);
        respawned.push(nodeId);
        this.broadcast({ t: "nodeUpdate", nodeId, depleted: false });
      }
    }
    if (respawned.length > 0) void deleteDepletedNodes(respawned);
  }

  // ============================ snapshots ============================

  private timeOffset = 0.3;

  private timeOfDay(): number {
    return ((Date.now() - this.startedAt) / 1000 / DAY_LENGTH_S + this.timeOffset) % 1;
  }

  /** Dev tool: pin the current time-of-day to a value in [0,1). */
  setTimeOfDay(t: number): void {
    this.timeOffset = (t - (Date.now() - this.startedAt) / 1000 / DAY_LENGTH_S) % 1;
    if (this.timeOffset < 0) this.timeOffset += 1;
  }

  /** The dynamic stat calculation engine: base (from class) + level growth +
   *  equipped gear + active auras, recomputed on demand -- nothing here is
   *  ever persisted. */
  private computeStats(player: PlayerState) {
    const gearMods = EQUIP_SLOTS.map((_, slot) => findItem(player.inventory, "equip", slot))
      .filter((it): it is InvItem => !!it)
      .map((it) => itemDef(it.itemId).statModifiers ?? {});
    const auraMods = aggregateAuraModifiers(player.activeAuras);
    return computeActorStats(classDef(player.classId).baseStats, player.level, gearMods, auraMods);
  }

  private maxHp(player: PlayerState): number {
    return this.computeStats(player).maxHp;
  }

  private maxMana(player: PlayerState): number {
    return this.computeStats(player).maxMana;
  }

  /** Expire auras and resolve any due periodic ticks (DoT/HoT) for a player. */
  private tickPlayerAuras(player: PlayerState, now: number): void {
    player.activeAuras = expireAuras(player.activeAuras, now);
    const due = collectDueTicks(player.activeAuras, now);
    if (due.length === 0) return;
    const stats = this.computeStats(player);
    for (const { tick } of due) {
      const amount = (tick.base ?? 0) + stats.power * (tick.powerScale ?? 0);
      if (tick.type === "damage") this.damagePlayer(player, amount, "aura");
      else player.hp = Math.min(this.maxHp(player), player.hp + amount);
    }
    player.dirty = true;
    this.sendSelf(player);
  }

  /** Expire auras and resolve any due periodic ticks (DoT) for a mob, crediting the aura's source. */
  private tickMobAuras(mob: MobState, now: number): void {
    mob.activeAuras = expireAuras(mob.activeAuras, now);
    const due = collectDueTicks(mob.activeAuras, now);
    for (const { tick, aura } of due) {
      if (tick.type !== "damage") continue;
      const attacker = this.players.get(aura.sourceId);
      if (attacker) this.damageMob(mob, tick.base ?? 0, attacker);
    }
  }

  /** Nearest valid melee-range target (mob, or a flagged pvp foe) in a forward cone. */
  private findMeleeTarget(
    player: PlayerState,
    range: number,
  ): { mob: MobState | null; foe: PlayerState | null } {
    const inCone = (tx: number, tz: number) => {
      const angleTo = Math.atan2(tx - player.move.x, tz - player.move.z);
      return Math.abs(wrapAngle(angleTo - player.yaw)) <= Math.PI * 0.6;
    };
    let bestMob: MobState | null = null;
    let bestFoe: PlayerState | null = null;
    let bestDist = Infinity;
    for (const mob of this.mobs.values()) {
      if (mob.respawnAt !== null || !this.sameInstance(player, mob)) continue;
      const d = dist3D(player.move.x, player.move.y, player.move.z, mob.x, mob.y, mob.z);
      if (d > range + 0.6 || !inCone(mob.x, mob.z)) continue;
      if (d < bestDist) {
        bestMob = mob;
        bestFoe = null;
        bestDist = d;
      }
    }
    if (player.pvp) {
      for (const other of this.players.values()) {
        if (other.id === player.id || other.dead || !other.pvp) continue;
        if (!this.sameInstance(player, other)) continue;
        const d = dist3D(player.move.x, player.move.y, player.move.z, other.move.x, other.move.y, other.move.z);
        if (d > range + 0.6 || !inCone(other.move.x, other.move.z)) continue;
        if (d < bestDist) {
          bestFoe = other;
          bestMob = null;
          bestDist = d;
        }
      }
    }
    return { mob: bestMob, foe: bestFoe };
  }

  /** Resolve a spell's effect payload array against a resolved target (or null for self-only spells). */
  private applySpellEffects(
    caster: PlayerState,
    target: { mob: MobState | null; foe: PlayerState | null } | null,
    effects: SpellEffect[],
  ): void {
    const stats = this.computeStats(caster);
    const now = Date.now();
    for (const effect of effects) {
      const landsOnCaster = effect.landsOn === "caster";
      if (effect.type === "damage") {
        if (landsOnCaster) continue; // damage always needs a real target
        let amount = (effect.base ?? 0) + stats.power * (effect.powerScale ?? 0);
        if (effect.executeScale) {
          const targetMaxHp = target?.mob ? mobDef(target.mob.type).maxHp : target?.foe ? this.maxHp(target.foe) : null;
          const targetHp = target?.mob ? target.mob.hp : (target?.foe?.hp ?? null);
          if (targetMaxHp && targetHp !== null) {
            const missingFrac = 1 - clamp(targetHp / targetMaxHp, 0, 1);
            amount *= 1 + effect.executeScale * missingFrac;
          }
        }
        if (Math.random() < stats.critChance) amount *= 1.5;
        if (target?.mob) this.damageMob(target.mob, amount, caster);
        else if (target?.foe) this.damagePlayer(target.foe, amount, caster.id);
        if (effect.lifestealPct) {
          caster.hp = Math.min(this.maxHp(caster), caster.hp + amount * effect.lifestealPct);
          caster.dirty = true;
          this.sendSelf(caster);
        }
      } else if (effect.type === "heal") {
        const healTarget = landsOnCaster ? caster : (target?.foe ?? null);
        if (!healTarget) continue;
        const rawAmount = (effect.base ?? 0) + stats.power * (effect.powerScale ?? 0);
        // A self-heal with an active pet out splits its pool between the two
        // instead of stacking a free splash heal on top of the usual amount.
        const pet = landsOnCaster ? this.findPetByOwner(caster.id) : undefined;
        const amount = pet ? rawAmount * 0.65 : rawAmount;
        healTarget.hp = Math.min(this.maxHp(healTarget), healTarget.hp + amount);
        healTarget.dirty = true;
        this.broadcastNear(
          healTarget.move.x,
          healTarget.move.z,
          { t: "event", kind: "heal", sourceId: caster.id, targetId: healTarget.id, amount, x: healTarget.move.x, y: healTarget.move.y + 1.5, z: healTarget.move.z },
          healTarget.instanceId,
        );
        if (healTarget !== caster) this.sendSelf(healTarget);
        if (pet) {
          const petAmount = rawAmount * 0.35;
          pet.hp = Math.min(mobDef(pet.type).maxHp, pet.hp + petAmount);
          this.broadcastNear(
            pet.x,
            pet.z,
            { t: "event", kind: "heal", sourceId: caster.id, targetId: pet.id, amount: petAmount, x: pet.x, y: pet.y + 1.5, z: pet.z },
            pet.instanceId,
          );
        }
      } else if (effect.type === "applyAura" && effect.auraId) {
        if (landsOnCaster) {
          caster.activeAuras = applyAura(caster.activeAuras, effect.auraId, caster.id, now);
        } else if (target?.mob) {
          target.mob.activeAuras = applyAura(target.mob.activeAuras, effect.auraId, caster.id, now);
        } else if (target?.foe) {
          target.foe.activeAuras = applyAura(target.foe.activeAuras, effect.auraId, caster.id, now);
          this.sendSelf(target.foe);
        }
      }
    }
  }

  private playerAnim(player: PlayerState): AnimState {
    if (player.dead) return "dead";
    if (player.sitting) return "sit";
    if (player.blocking) return "block";
    if (player.casting) return "cast";
    if (player.actionAnim) return player.actionAnim;
    if (player.move.vy !== 0) return "jump";
    if (player.move.y < WATER_LEVEL - 0.4) return "swim";
    if (player.lastMoveMag > 0.1) return "run";
    return "idle";
  }

  private selfState(player: PlayerState): SelfState {
    return {
      x: player.move.x,
      y: player.move.y,
      z: player.move.z,
      vy: player.move.vy,
      grounded: player.move.grounded,
      hp: player.hp,
      maxHp: this.maxHp(player),
      mana: player.mana,
      maxMana: this.maxMana(player),
      hunger: player.hunger,
      thirst: player.thirst,
      xp: player.xp,
      xpNext: xpForLevel(player.level),
      level: player.level,
      dead: player.dead,
      ackSeq: player.lastAckSeq,
      castingSpell: player.casting?.spellId ?? null,
      castEndsAt: player.casting?.endsAt ?? null,
      revivingTargetId: player.reviving?.targetId ?? null,
      revivingEndsAt: player.reviving ? player.reviving.startedAt + REVIVE_HOLD_MS : null,
      mount: player.mount,
      sitting: player.sitting !== null,
      auras: player.activeAuras.map((a) => ({ auraId: a.auraId, expiresAt: a.expiresAt })),
      spellCooldowns: [...player.spellCooldowns]
        .filter(([, readyAt]) => readyAt > Date.now())
        .map(([spellId, readyAt]) => ({ spellId, readyAt })),
      dodgeCharges: player.dodgeCharges,
      dodgeNextChargeAt: player.dodgeChargeQueue[0] ?? null,
    };
  }

  /** Aura ids worth showing as a floating debuff icon over an entity's head
   *  -- damage-over-time only, not buffs/HoTs/silence (those are the
   *  caster's own business, not something bystanders need to see ticking). */
  private dotDebuffs(auras: ActiveAura[]): string[] {
    return auras.filter((a) => auraDef(a.auraId).tick?.type === "damage").map((a) => a.auraId);
  }

  private sendSnapshots(): void {
    const now = Date.now();
    const allPlayers = [...this.players.values()];
    for (const viewer of allPlayers) {
      const px = viewer.move.x;
      const pz = viewer.move.z;

      const players: PlayerSnap[] = [];
      for (const other of allPlayers) {
        if (!this.sameInstance(viewer, other)) continue;
        if (dist2D(px, pz, other.move.x, other.move.z) > INTEREST_RADIUS) continue;
        players.push({
          id: other.id,
          name: other.name,
          classId: other.classId,
          x: other.move.x,
          y: other.move.y,
          z: other.move.z,
          yaw: other.yaw,
          hp: other.hp,
          maxHp: this.maxHp(other),
          anim: this.playerAnim(other),
          pvp: other.pvp,
          mount: other.mount,
          weaponId: findItem(other.inventory, "equip", 0)?.itemId ?? null,
          debuffs: this.dotDebuffs(other.activeAuras),
        });
      }

      const mobs: MobSnap[] = [];
      for (const mob of this.mobs.values()) {
        if (mob.respawnAt !== null || !this.sameInstance(viewer, mob)) continue;
        if (dist2D(px, pz, mob.x, mob.z) > INTEREST_RADIUS) continue;
        const def = mobDef(mob.type);
        mobs.push({
          id: mob.id,
          type: mob.type,
          x: mob.x,
          y: mob.y,
          z: mob.z,
          yaw: mob.yaw,
          hp: mob.hp,
          maxHp: def.maxHp,
          anim: mob.actionAnimUntil > now ? "attack" : mob.targetId ? "run" : "idle",
          debuffs: this.dotDebuffs(mob.activeAuras),
        });
      }

      const pets: PetSnap[] = [];
      for (const pet of this.pets.values()) {
        if (!this.sameInstance(viewer, pet)) continue;
        if (dist2D(px, pz, pet.x, pet.z) > INTEREST_RADIUS) continue;
        const owner = this.players.get(pet.ownerId);
        pets.push({
          id: pet.id,
          ownerId: pet.ownerId,
          type: pet.type,
          name: owner ? `${owner.name}'s Wolf` : "Wolf",
          x: pet.x,
          y: pet.y,
          z: pet.z,
          yaw: pet.yaw,
          hp: pet.hp,
          maxHp: mobDef(pet.type).maxHp,
          anim: pet.actionAnimUntil > now ? "attack" : pet.targetId || pet.following ? "run" : "idle",
        });
      }

      const projectiles: ProjectileSnap[] = [];
      for (const proj of this.projectiles.values()) {
        if (!this.sameInstance(viewer, proj)) continue;
        if (dist2D(px, pz, proj.x, proj.z) > INTEREST_RADIUS) continue;
        projectiles.push({ id: proj.id, spellId: proj.spellId, x: proj.x, y: proj.y, z: proj.z });
      }

      // NPCs (village quest givers) only ever exist in the open world.
      const npcs: NpcSnap[] = [];
      if (!viewer.instanceId) {
        for (const npc of this.npcs) {
          if (dist2D(px, pz, npc.x, npc.z) > INTEREST_RADIUS) continue;
          npcs.push(this.npcSnapFor(npc, viewer));
        }
      }

      this.sendTo(viewer.peer, {
        t: "snapshot",
        tick: this.tickCount,
        timeOfDay: this.timeOfDay(),
        players,
        mobs,
        pets,
        projectiles,
        npcs,
      });
      this.sendSelf(viewer);
    }
  }

  // ============================ io helpers ============================

  private sendTo(peer: PeerLike, msg: ServerMsg): void {
    try {
      peer.send(JSON.stringify(msg));
    } catch {
      // peer already gone; cleanup happens on close event
    }
  }

  private sendSelf(player: PlayerState): void {
    this.sendTo(player.peer, { t: "self", self: this.selfState(player) });
  }

  private sendInventory(player: PlayerState): void {
    this.sendTo(player.peer, {
      t: "inventory",
      items: toSnaps(player.inventory),
      learnedSpells: player.learnedSpells,
      selectedSlot: player.selectedSlot,
    });
  }

  private sendEvent(player: PlayerState, msg: ServerMsg): void {
    this.sendTo(player.peer, msg);
  }

  private broadcast(msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const player of this.players.values()) {
      try {
        player.peer.send(data);
      } catch {
        /* ignore */
      }
    }
  }

  private broadcastNear(x: number, z: number, msg: ServerMsg, instanceId: string | null): void {
    const data = JSON.stringify(msg);
    for (const player of this.players.values()) {
      if (player.instanceId !== instanceId) continue;
      if (dist2D(x, z, player.move.x, player.move.z) > INTEREST_RADIUS) continue;
      try {
        player.peer.send(data);
      } catch {
        /* ignore */
      }
    }
  }

  private broadcastChat(from: string, text: string): void {
    this.broadcast({ t: "chat", channel: from === "system" ? "system" : "realm", from, text });
  }

  // ============================ persistence ============================

  private toPersisted(player: PlayerState): PersistedPlayer {
    return {
      id: player.id,
      accountId: player.accountId,
      name: player.name,
      classId: player.classId,
      level: player.level,
      xp: player.xp,
      x: player.move.x,
      y: player.move.y,
      z: player.move.z,
      yaw: player.yaw,
      hp: player.hp,
      mana: player.mana,
      hunger: player.hunger,
      thirst: player.thirst,
      learnedSpells: player.learnedSpells,
      inventory: player.inventory,
      questProgress: [...player.questProgress.entries()].map(([questId, e]) => ({
        questId,
        status: e.status,
        progress: e.progress,
      })),
    };
  }

  async flushDirty(): Promise<void> {
    for (const player of this.players.values()) {
      if (!player.dirty) continue;
      player.dirty = false;
      await savePlayer(this.toPersisted(player)).catch((e) => {
        player.dirty = true;
        console.error("[game] periodic save failed", e);
      });
    }
  }

  debugStatus() {
    return {
      started: this.started,
      tickCount: this.tickCount,
      players: [...this.players.keys()],
      mobs: this.mobs.size,
      nodes: this.nodes.size,
      depletedNodes: this.depletedNodes.size,
      structures: this.structures.length,
      projectiles: this.projectiles.size,
    };
  }

  /** Dev-only: spawn a mob of a given type next to a connected character. */
  debugSpawnMob(charId: string, type: string): boolean {
    const player = this.players.get(charId);
    if (!player) return false;
    const def = mobDef(type);
    const x = player.move.x + Math.sin(player.yaw) * 4;
    const z = player.move.z + Math.cos(player.yaw) * 4;
    const y = terrainHeight(x, z);
    const id = `dbg_${type}_${Date.now()}`;
    this.mobs.set(id, {
      id,
      type,
      x,
      y,
      z,
      yaw: 0,
      hp: def.maxHp,
      homeX: x,
      homeZ: z,
      targetId: null,
      attackReadyAt: 0,
      respawnAt: null,
      wanderTx: x,
      wanderTz: z,
      nextWanderAt: 0,
      actionAnimUntil: 0,
      activeAuras: [],
      instanceId: player.instanceId,
      hpMult: 1,
      dmgMult: 1,
    });
    return true;
  }

  /** Dev-only: hand an item to a connected character (verification tooling). */
  debugGive(charId: string, itemId: string, qty: number): boolean {
    const player = this.players.get(charId);
    if (!player) return false;
    addItem(player.inventory, itemId, qty);
    player.dirty = true;
    this.sendInventory(player);
    return true;
  }

  /** Dev-only: teleport a connected character (verification tooling -- e.g.
   *  reaching a far-flung dungeon portal without a long walk). */
  debugTeleport(charId: string, x: number, z: number): boolean {
    const player = this.players.get(charId);
    if (!player) return false;
    player.move = { x, y: terrainHeight(x, z), z, vy: 0, grounded: true };
    player.dead = false;
    player.hp = this.maxHp(player);
    player.mana = this.maxMana(player);
    player.hunger = 100;
    player.thirst = 100;
    // Ashenpeak is dense with hostile tier-3/4 mobs -- a teleport can easily
    // drop a low-level test character right next to one. Grant a brief
    // invisibility so verification isn't fighting random aggro.
    player.activeAuras = applyAura(player.activeAuras, "invisible", player.id, Date.now());
    for (const mob of this.mobs.values()) {
      if (mob.targetId === charId) mob.targetId = null;
    }
    player.dirty = true;
    this.sendSelf(player);
    return true;
  }

  async flushAll(): Promise<void> {
    for (const player of this.players.values()) {
      await savePlayer(this.toPersisted(player)).catch((e) => console.error("[game] flush failed", e));
    }
  }
}
