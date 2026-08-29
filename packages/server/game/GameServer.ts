import {
  TICK_MS,
  TICK_DT,
  TICK_RATE,
  SNAPSHOT_RATE,
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
  MAX_OXYGEN,
  OXYGEN_DRAIN_PER_S,
  OXYGEN_REGEN_PER_S,
  DROWN_DPS,
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
  dungeonFloorHeightAt,
  dungeonTierDef,
  pickDungeonMob,
  DUNGEON_PORTAL_ACTIVATION_RADIUS,
  DUNGEON_ABANDON_TIMEOUT_MS,
  DUNGEON_WIPE_EJECT_MS,
  TIER_NAMES,
  stepMovement,
  isSwimmingAt,
  isUnderwaterAt,
  isNearWaterAt,
  waterAt,
  dist2D,
  dist3D,
  clamp,
  wrapAngle,
  turnToward,
  hash2,
  itemDef,
  RECIPES,
  VENDORS,
  vendorDef,
  resolveVendorId,
  spellDef,
  SPELLS,
  mobDef,
  auraDef,
  nodeTypeDef,
  questDef,
  questsForVillage,
  QUEST_IDS,
  ACHIEVEMENTS,
  ACHIEVEMENT_IDS,
  achievementTarget,
  classDef,
  startingHotbarLoadout,
  computeActorStats,
  armorMitigation,
  applyAura,
  expireAuras,
  removeAura,
  aggregateAuraModifiers,
  moveSpeedMultFromAuras,
  collectDueTicks,
  spellTriggersGcd,
  hasteTimeMult,
  rollSpellHit,
  rollMeleeHit,
  shouldSwitchThreat,
  isInSpellQueueWindow,
  HEAL_THREAT_FRAC,
  SPELL_QUEUE_WINDOW_MS,
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
  type QuestDef,
  type FriendEntry,
  type AchievementSnap,
  type QuestStatus,
  type ClassId,
  type BaseStats,
  type SpellEffect,
  type SpellDef,
  type ActiveAura,
  type ComputedStats,
  type CombatOutcome,
  type LevelRewardChest,
  type PoiSpec,
  type DungeonLayoutSpec,
  type RegionBlueprint,
  type RegionPoi,
  levelUpRewards,
  sampleRegionHeight,
  regionAssetColliders,
  regionAllAssets,
  regionVolumeColliders,
  regionBarrierColliders,
  pickRegionMob,
  ensureRegionWorldOrigins,
  regionWorldOrigin,
  regionLocalToWorld,
  worldToRegionLocal,
  findRegionAtWorld,
  regionsNearWorld,
  regionWorldBounds,
  sampleRegionHeightWorld,
  sampleRegionWaterDepthWorld,
  REGION_STREAM_RADIUS_METERS,
  MAX_ACTIVE_REGIONS,
  worldNodesFromRegion,
  PLAYER_BODY_RADIUS,
  ClientMsg as ClientMsgSchema,
  InputMsg,
} from "@rustcraft/shared";
import {
  resolveCapsule,
  sampleGroundBelow,
  disposeRegionCollision,
  type RegionCollision,
  type PlacedCollider,
  type CollisionMeshData,
} from "@rustcraft/shared/collision";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/client";
import {
  getServerCollisionMesh,
  hasServerCollisionMesh,
  collisionModelKey,
} from "../utils/collision";
import { getRegionCollisionWorker } from "./regionCollisionWorker";
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
import { listRegionBlueprints } from "../utils/regions";
import {
  type WorldEventRuntime,
  createWorldEventRuntime,
  computeEventScale,
  cooldownMs,
  dist2 as eventDist2,
  recordEventDamage,
  decayParticipation,
  markInRadius,
  tierForScore,
  rollEventRewards,
  snapshotWorldEvent,
} from "./worldEvents";

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
  crouch: boolean;
  block: boolean;
  yaw: number;
  pitch: number;
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
  gender: string;
  hairStyle: string;
  facialHair: string;
  hairColor: number;
  eyeColor: number;
  outfitHue: number;
  hp: number;
  mana: number;
  hunger: number;
  thirst: number;
  oxygen: number;
  xp: number;
  level: number;
  learnedSpells: string[];
  friends: string[];
  coins: number;
  inventory: InvItem[];
  selectedSlot: number;
  dead: boolean;
  /** Spawn protection window: true from join until the client sends `ready`
   *  (region loaded) or `loadingUntil` passes. While true the player takes no
   *  damage, so it can't die mid-load in a hostile area. */
  loading: boolean;
  loadingUntil: number;
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
  /** Global cooldown ready-at (server ms). */
  gcdReadyAt: number;
  /** One-slot spell queue (WoW SQW) — flushed when cast/GCD ends. */
  spellQueue: { spellId: string; queuedAt: number } | null;
  meleeReadyAt: number;
  gatherReadyAt: number;
  actionAnim: AnimState | null;
  actionAnimUntil: number;
  dirty: boolean;
  /** Cached computeActorStats result — cleared on gear/aura/level changes. */
  statsCache: ComputedStats | null;
  /** Cached equip/held ids for snapshots — cleared on inventory/hotbar changes. */
  gearCache: {
    weaponId: string | null;
    heldItemId: string | null;
    headId: string | null;
    chestId: string | null;
    armsId: string | null;
    legsId: string | null;
    feetId: string | null;
    shouldersId: string | null;
    neckId: string | null;
    selectedSlot: number;
  } | null;
  /** Bumped only when playerGearSnap's recompute actually changes a gear/
   *  held-item id (not on every gearCache invalidation -- loot pickup and
   *  aura ticks invalidate the cache too but don't touch equip slots). Lets
   *  sendSnapshots() detect "did this player's gear actually change" per
   *  viewer without resending the whole gear block every tick. */
  gearVersion: number;
  pvp: boolean;
  mount: "horse" | "raft" | null;
  blocking: boolean;
  sitting: string | null; // structure id being rested at
  shrineCooldowns: Map<string, number>; // shrine id -> ready-at ms
  partyId: string | null;
  pendingInviteFrom: string | null; // inviter character id
  questProgress: Map<string, { status: "active" | "completed"; progress: number }>;
  /** Lifetime achievement counters + unlock timestamps. */
  achievements: Map<string, { progress: number; unlockedAt: number | null }>;
  /** Permanently-discovered POI ids -> discoveredAt (epoch ms). Binary/
   *  permanent, no progress dimension -- see RegionPoi. */
  discoveredPois: Map<string, number>;
  activeAuras: ActiveAura[];
  /** Unclaimed level-up care packages — claimed via claimLevelReward, auto-granted on logout. */
  pendingLevelRewards: LevelRewardChest[];
  currentTargetId: string | null;
  /** Which dungeon run this player is currently inside, or null while in
   *  the open world -- see the sameInstance guard threaded through every
   *  distance-based visibility/targeting site (sendSnapshots, broadcastNear,
   *  tickMobs' aggro acquisition, findMeleeTarget, etc). */
  instanceId: string | null;
  lastRegionId?: string;
  lastRegionX?: number;
  lastRegionZ?: number;
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
  /** Threat table: attacker character id → threat value. */
  threat: Map<string, number>;
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
  loot?: InvItem[];
  deathAt?: number | null;
  moving?: boolean;
  leashing?: boolean;
  /** When set, this mob belongs to an active world event (no corpse loot; personal rewards on success). */
  eventId?: string;
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
  threatMult: number;
  speed: number;
  /** Homing target: a mob id or a (pvp) player id, or null for a straight shot. */
  homingId: string | null;
  /** Inherited from the caster at creation -- a projectile fired inside a
   *  dungeon must only be visible to, and only able to hit, that instance. */
  instanceId: string | null;
}

export class GameServer {
  private players = new Map<string, PlayerState>();
  /** Per-viewer memory of the last PlayerSnap.gearVersion sent for each
   *  visible player -- lets sendSnapshots() omit name/appearance/gear
   *  fields once a viewer already has them and nothing's changed, instead
   *  of resending ~15 mostly-static fields for every player, every 100ms.
   *  Cleared per-viewer and per-target in removePlayer(). */
  private lastSentPlayerCosmetics = new Map<string, Map<string, number>>();
  private peerToChar = new Map<string, string>();
  private mobs = new Map<string, MobState>();
  /**
   * Region mobs waiting near a player before entering the live sim/snapshot
   * set. Avoids ticking/sending every authored spawn across the continent.
   */
  private dormantRegionMobs = new Map<string, MobState>();
  private pets = new Map<string, PetState>();
  private projectiles = new Map<string, Projectile>();
  private structures: StructureSnap[] = [];
  private nodes = new Map<string, WorldNode>();
  private nodeHits = new Map<string, number>();
  private depletedNodes = new Map<string, number>(); // nodeId -> respawn at ms
  private shrines = new Map<string, { x: number; y: number; z: number }>();
  private villages: { x: number; z: number }[] = [];
  private npcs: NpcSpec[] = []; // static base data; marker recomputed per-viewer
  private activeRegionNpcs = new Map<
    string,
    {
      id: string;
      name: string;
      regionId: string;
      instanceId: string;
      x: number;
      y: number;
      z: number;
      startX: number;
      startZ: number;
      hp: number;
      maxHp: number;
      waypoints?: { x: number; z: number }[];
      currentWpIdx?: number;
      activeQuestId?: string;
    }
  >();
  // Persists until the leader explicitly disbands it -- an ordinary member
  // leaving just removes them; if the leader leaves, leadership passes to
  // another member rather than ending the party (see leaveParty).
  private parties = new Map<string, { leaderId: string; members: Set<string>; tags: Map<string, string> }>();
  private partySeq = 0;
  private dungeonPortals = new Map<string, PoiSpec>();
  private dungeonInstances = new Map<string, DungeonInstance>();
  private dungeonSeq = 0;
  /** Every saved region's portal placement in the open world, keyed by
   *  region id -- read once at startup (see start()); a region created via
   *  the editor after the server is already running won't appear here until
   *  a restart (unlike dungeon-blueprint edits, which only ever needed a
   *  code change anyway). */
  private regionPortals = new Map<string, { id: string; name: string; x: number; z: number }>();
  /** Full blueprint per region id, kept resident for the server's lifetime
   *  once loaded -- needed on every tick a region mob moves (ground height
   *  comes from its own heightmap, not the open-world terrain function). */
  private regionBlueprints = new Map<string, RegionBlueprint>();
  /** True-geometry (BVH) collision per region, world-baked with the region's
   *  origin. Built lazily on first movement tick that needs it; invalidated
   *  (set to undefined via delete) on blueprint save / origin change /
   *  unregister so an editor edit re-bakes. `null` = built but nothing to
   *  collide (all assets un-meshed). Headless three-mesh-bvh. */
  private regionCollisionCache = new Map<string, RegionCollision | null>();
  /** Regions whose BVH is currently building off-thread — gates re-dispatch so
   *  we kick one worker build per region, not one per movement tick. */
  private regionCollisionBuilding = new Set<string>();
  /** Per-region build token. Bumped on invalidate so an in-flight worker result
   *  for a since-edited/removed region is discarded instead of caching stale. */
  private regionCollisionBuildSeq = new Map<string, number>();
  /** Capsule feet→head height (matches movement.ts's 1.7m head offset). */
  private static readonly PLAYER_CAPSULE_HEIGHT = 1.7;
  /** Regions whose NPCs/nodes/events (and dormant mob roster) are live.
   *  Region mobs stay in `dormantRegionMobs` until a player is nearby, then
   *  wake into `mobs` (see streamRegionMobs). */
  private activeRegionIds = new Set<string>();
  /** Active/cooldown world-event runtimes keyed by `${regionId}:${eventId}`. */
  private worldEvents = new Map<string, WorldEventRuntime>();
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
        threat: new Map(),
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

    // Regions are freely creatable from the editor (unlike dungeon tiers, a
    // fixed hand-curated set), so this reads whatever's on disk right now
    // rather than a bundled import -- see utils/regions.ts's comment for why.
    const regionList = listRegionBlueprints();
    ensureRegionWorldOrigins(regionList);
    for (const region of regionList) {
      this.registerRegionBlueprint(region);
    }

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
        threat: new Map(),
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

    // New characters are inserted at (0,0) with 0 XP. After their first
    // login we persist the starting-town pose, so later logins restore
    // whatever world position they had when they left.
    const isNew = persisted.xp === 0 && persisted.level <= 1 && persisted.x === 0 && persisted.z === 0;
    const loggedOutDead = persisted.hp <= 0;

    let instanceId: string | null = null;
    let x = persisted.x;
    let z = persisted.z;
    let y = persisted.y;
    let hp = persisted.hp;
    let mana = persisted.mana;
    let dead = false;

    if (isNew) {
      // Brand-new character → starting town entry only.
      const spawn = this.spawnInStartingRegion();
      instanceId = spawn.instanceId;
      x = spawn.x;
      y = spawn.y;
      z = spawn.z;
    } else if (loggedOutDead) {
      // Corpse logout → nearest village, still keeping continent ownership.
      const village = this.nearestVillageAt(x, z);
      const placed = this.restoreContinentPose(
        village.x + (Math.random() - 0.5) * 6,
        village.z + (Math.random() - 0.5) * 6,
      );
      instanceId = placed.instanceId;
      x = placed.x;
      y = placed.y;
      z = placed.z;
      hp = Math.max(1, persisted.hp);
      mana = Math.max(0, persisted.mana);
    } else {
      // Returning alive → exact logout X/Z (and the region that contains it).
      const placed = this.restoreContinentPose(x, z);
      instanceId = placed.instanceId;
      x = placed.x;
      y = placed.y;
      z = placed.z;
    }

    const player: PlayerState = {
      id: persisted.id,
      accountId: persisted.accountId,
      name: persisted.name,
      peer,
      move: { x, y, z, vy: 0, grounded: true },
      yaw: persisted.yaw,
      classId: (persisted.classId as ClassId) ?? "warrior",
      gender: persisted.gender,
      hairStyle: persisted.hairStyle,
      facialHair: persisted.facialHair,
      hairColor: persisted.hairColor,
      eyeColor: persisted.eyeColor,
      outfitHue: persisted.outfitHue,
      hp,
      mana,
      hunger: persisted.hunger,
      thirst: persisted.thirst,
      oxygen: MAX_OXYGEN,
      xp: persisted.xp,
      level: persisted.level,
      learnedSpells: [
        ...new Set([...persisted.learnedSpells, ...classDef((persisted.classId as ClassId) ?? "warrior").startingSpells]),
      ],
      friends: persisted.friends ?? [],
      coins: persisted.coins ?? 100,
      inventory: persisted.inventory,
      selectedSlot: 0,
      dead,
      // Spawn protection until the client reports its region loaded (or 30s
      // elapses as a safety net) -- see damagePlayer / the `ready` message.
      loading: !dead,
      loadingUntil: Date.now() + 30000,
      inputQueue: [],
      lastAckSeq: 0,
      lastMoveMag: 0,
      casting: null,
      reviving: null,
      dodgeCharges: DODGE_MAX_CHARGES,
      dodgeChargeQueue: [],
      spellCooldowns: new Map(),
      gcdReadyAt: 0,
      spellQueue: null,
      meleeReadyAt: 0,
      gatherReadyAt: 0,
      actionAnim: null,
      actionAnimUntil: 0,
      dirty: true,
      statsCache: null,
      gearCache: null,
      gearVersion: 0,
      pvp: false,
      mount: null,
      blocking: false,
      sitting: null,
      shrineCooldowns: new Map(),
      partyId: null,
      pendingInviteFrom: null,
      questProgress: new Map(persisted.questProgress.map((q) => [q.questId, { status: q.status, progress: q.progress }])),
      achievements: new Map(
        (persisted.achievements ?? []).map((a) => [
          a.achievementId,
          { progress: a.progress, unlockedAt: a.unlockedAt },
        ]),
      ),
      discoveredPois: new Map((persisted.discoveredPois ?? []).map((d) => [d.poiId, d.discoveredAt])),
      activeAuras: [],
      pendingLevelRewards: [],
      currentTargetId: null,
      instanceId,
    };

    if (loggedOutDead && !isNew) {
      player.hp = this.maxHp(player) * RESPAWN_HP_FRACTION;
      player.mana = this.maxMana(player) * 0.5;
      player.hunger = Math.max(player.hunger, 30);
      player.thirst = Math.max(player.thirst, 30);
    }

    this.ensureStartingHotbar(player);

    this.players.set(player.id, player);
    this.peerToChar.set(peer.id, player.id);
    this.broadcastRoster();
    this.sendFriendListUpdate(player);
    for (const other of this.players.values()) {
      if (other.id !== player.id && other.friends.some((f) => f.toLowerCase() === player.name.toLowerCase())) {
        this.sendFriendListUpdate(other);
      }
    }

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

    // Dungeon runs: alive members re-enter at the layout entry. Dead logouts
    // already woke at a village and must not be pulled back into the run.
    if (!loggedOutDead) {
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
    } else {
      // Drop stale dungeon membership so a corpse logout can't soft-lock them.
      for (const instance of this.dungeonInstances.values()) {
        instance.memberIds.delete(player.id);
      }
    }

    // Catch up quest/level achievements earned before this system existed.
    this.checkAndUnlockAchievements(player, { sync: false });

    // Continent regions: keep the restored world position — only sync UI/music.
    if (player.instanceId?.startsWith("region_")) {
      const regionId = player.instanceId.slice("region_".length);
      const region = this.regionBlueprints.get(regionId);
      if (region) {
        this.sendRegionState(player, region);
      } else {
        const placed = this.spawnInStartingRegion();
        player.instanceId = placed.instanceId;
        player.move = { x: placed.x, y: placed.y, z: placed.z, vy: 0, grounded: true };
        const start = this.getStartingRegion();
        if (start) this.sendRegionState(player, start);
      }
    } else if (!this.isDungeonInstance(player.instanceId)) {
      // Never leave players with a null open-world instance.
      const placed = this.spawnInStartingRegion();
      player.instanceId = placed.instanceId;
      player.move = { x: placed.x, y: placed.y, z: placed.z, vy: 0, grounded: true };
      const start = this.getStartingRegion();
      if (start) this.sendRegionState(player, start);
    }

    this.sendTo(peer, {
      t: "welcome",
      selfId: player.id,
      name: player.name,
      classId: player.classId,
      gender: player.gender,
      hairStyle: player.hairStyle,
      facialHair: player.facialHair,
      hairColor: player.hairColor,
      eyeColor: player.eyeColor,
      outfitHue: player.outfitHue,
      self: this.selfState(player),
      inventory: toSnaps(player.inventory),
      learnedSpells: player.learnedSpells,
      selectedSlot: player.selectedSlot,
      depletedNodes: [...this.depletedNodes.keys()],
      structures: this.structures,
      npcs: this.npcs.map((n) => this.npcSnapFor(n, player)),
      questLog: this.questLogFor(player),
      achievements: this.achievementsFor(player),
      discoveredPoiIds: [...player.discoveredPois.keys()],
      levelRewards: player.pendingLevelRewards,
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
    // Drop this player's own cosmetic-cache map (as a viewer) right away --
    // sendSnapshots() rebuilds every other viewer's map fresh each tick from
    // who's actually still visible, so their entry as a *target* self-clears
    // within one tick regardless; this just avoids a stale outer-map entry
    // (and a needless relogin-treated-as-already-sent) in the meantime.
    this.lastSentPlayerCosmetics.delete(charId);
    this.leaveParty(player, true);
    this.broadcastRoster();
    for (const mob of this.mobs.values()) {
      if (mob.targetId === charId) mob.targetId = null;
    }
    if (save) {
      // Dump unclaimed level chests into bags so logout never voids awards.
      this.flushPendingLevelRewards(player);
      // Alive: persist exact world coords. Dead: wake at nearest village so
      // the next login isn't a corpse at the death spot.
      this.applyLogoutSpawn(player);
      await savePlayer(this.toPersisted(player)).catch((e) => console.error("[game] save failed", e));
    }
  }

  /** Normalize logout position before persisting. */
  private applyLogoutSpawn(player: PlayerState): void {
    if (!player.dead) {
      // Keep live world/dungeon coords as-is.
      return;
    }

    // Leaving a dungeon as a corpse ejects them from the run.
    if (this.isDungeonInstance(player.instanceId)) {
      const instance = this.dungeonInstances.get(player.instanceId!);
      if (instance) instance.memberIds.delete(player.id);
    }

    const village = this.nearestVillageAt(player.move.x, player.move.z);
    const placed = this.placeInRegionAt(
      village.x + (Math.random() - 0.5) * 6,
      village.z + (Math.random() - 0.5) * 6,
    );
    player.instanceId = placed.instanceId;
    player.move = {
      x: placed.x,
      y: placed.y,
      z: placed.z,
      vy: 0,
      grounded: true,
    }
    player.dead = false;
    player.hp = this.maxHp(player) * RESPAWN_HP_FRACTION;
    player.mana = this.maxMana(player) * 0.5;
    player.hunger = Math.max(player.hunger, 30);
    player.thirst = Math.max(player.thirst, 30);
    player.oxygen = MAX_OXYGEN;
  }

  handleMessage(peer: PeerLike, raw: unknown): void {
    let json: unknown;
    try {
      json = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      this.sendTo(peer, { t: "error", message: "Bad message" });
      return;
    }

    const charId = this.peerToChar.get(peer.id);
    if (!charId) return;
    const player = this.players.get(charId);
    if (!player) return;

    // Hot path: 20Hz movement inputs — validate with the narrow Input schema
    // instead of walking the full ClientMsg discriminated union.
    if (json && typeof json === "object" && (json as { t?: string }).t === "input") {
      const input = InputMsg.safeParse(json);
      if (!input.success) {
        this.sendTo(peer, { t: "error", message: "Bad message" });
        return;
      }
      const parsed = input.data;
      player.yaw = parsed.yaw;
      if (player.inputQueue.length < MAX_INPUT_QUEUE) player.inputQueue.push(parsed);
      return;
    }

    let parsed: ClientMsg;
    try {
      parsed = ClientMsgSchema.parse(json);
    } catch {
      this.sendTo(peer, { t: "error", message: "Bad message" });
      return;
    }

    switch (parsed.t) {
      case "input":
        // Unreachable — handled above — kept for exhaustiveness.
        player.yaw = parsed.yaw;
        if (player.inputQueue.length < MAX_INPUT_QUEUE) player.inputQueue.push(parsed);
        break;
      case "interact":
        if (parsed.nodeId === "poi_dungeon_exit") this.handleDungeonLeave(player);
        else if (parsed.nodeId === "poi_region_exit") this.handleRegionLeave(player);
        else if (parsed.nodeId.startsWith("poi_shrine")) this.handleShrine(player, parsed.nodeId);
        else if (parsed.nodeId.startsWith("poi_dungeon")) this.handleDungeonPortal(player, parsed.nodeId);
        else if (parsed.nodeId.startsWith("poi_region_link_")) this.handleRegionPortal(player, "", parsed.nodeId.slice("poi_region_link_".length));
        else if (parsed.nodeId.startsWith("poi_region_")) this.handleRegionPortal(player, parsed.nodeId.slice("poi_region_".length));
        else if (parsed.nodeId.startsWith("poi_marker_")) this.handlePoiMarkerInteract(player, parsed.nodeId.slice("poi_marker_".length));
        else if (parsed.nodeId.startsWith("npc_") || parsed.nodeId.startsWith("rnpc_")) this.handleQuestGiverInteract(player, parsed.nodeId);
        else this.handleGather(player, parsed.nodeId);
        break;
      case "regionPortal":
        this.handleRegionPortal(player, parsed.regionId ?? "", parsed.portalId ?? undefined);
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
        if (moveItem(player.inventory, parsed.fromContainer, parsed.fromSlot, parsed.toContainer, parsed.toSlot, parsed.qty)) {
          player.dirty = true;
          this.invalidatePlayerCaches(player);
          this.sendInventory(player);
        }
        break;
      case "selectSlot":
        if (parsed.slot < HOTBAR_SLOTS) {
          player.selectedSlot = parsed.slot;
          player.gearCache = null;
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
      case "ready":
        // Region finished loading client-side -- lift spawn protection.
        player.loading = false;
        break;
      case "pvp":
        this.handlePvpToggle(player, parsed.enabled);
        break;
      case "party":
        this.handleParty(player, parsed.action, parsed.name, parsed.tag);
        break;
      case "friend":
        this.handleFriend(player, parsed.action, parsed.targetName);
        break;
      case "mount":
        this.handleMount(player);
        break;
      case "sit":
        this.handleSit(player);
        break;
      case "lootCorpse":
        this.handleLootCorpse(player, parsed.mobId, parsed.slot ?? undefined, parsed.lootAll ?? undefined);
        break;
      case "claimLevelReward":
        this.handleClaimLevelReward(player, parsed.rewardId ?? null);
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
      case "vendor":
        this.handleVendorAction(player, parsed);
        break;
    }
  }

  // ============================ chat & social ============================

  private handleChat(player: PlayerState, channel: "realm" | "region" | "party", text: string): void {
    if (text.startsWith("/") || text.startsWith(".")) {
      const parts = text.slice(1).trim().split(/\s+/);
      const cmd = parts[0]?.toLowerCase();

      if (cmd === "allspells" || cmd === "spells" || cmd === "unlockspells" || cmd === "gmspells" || cmd === "all") {
        const allSpellIds = Object.keys(SPELLS);
        player.learnedSpells = [...new Set([...player.learnedSpells, ...allSpellIds])];
        player.level = MAX_LEVEL;
        player.statsCache = null; // Invalidate stats cache for Level 60 stats
        const stats = this.computeStats(player);
        player.hp = stats.maxHp;
        player.mana = stats.maxMana;

        this.sendTo(player.peer, {
          t: "chat",
          channel: "system",
          from: "system",
          text: `[GM] Unlocked Level ${MAX_LEVEL} & all ${allSpellIds.length} spells for ${player.name}! (maxed level — use /level <n> to lower it for XP testing)`,
        });
        this.sendTo(player.peer, {
          t: "inventory",
          items: player.inventory,
          learnedSpells: player.learnedSpells,
          selectedSlot: player.selectedSlot,
        });
        return;
      }

      // GM: set level explicitly. /allspells maxes level (so every spell is
      // castable for VFX testing), which stops XP gain -- drop back down here
      // to test progression, then kill mobs to level up again.
      if (cmd === "level" || cmd === "setlevel" || cmd === "lvl") {
        const raw = Math.floor(Number(parts[1]));
        if (!Number.isFinite(raw)) {
          this.sendTo(player.peer, { t: "chat", channel: "system", from: "system", text: `[GM] Usage: /level <1-${MAX_LEVEL}>` });
          return;
        }
        const n = Math.max(1, Math.min(MAX_LEVEL, raw));
        player.level = n;
        player.xp = 0;
        player.statsCache = null;
        const stats = this.computeStats(player);
        player.hp = stats.maxHp;
        player.mana = stats.maxMana;
        player.dirty = true;
        this.sendSelf(player);
        this.sendTo(player.peer, {
          t: "chat",
          channel: "system",
          from: "system",
          text: `[GM] ${player.name} set to level ${n} (XP reset)${n < MAX_LEVEL ? " — kill mobs to progress" : ""}.`,
        });
        return;
      }
    }

    if (channel === "party") {
      if (!player.partyId) {
        this.sendEvent(player, { t: "event", kind: "error", message: "You are not in a party" });
        return;
      }
      this.sendToParty(player.partyId, { t: "chat", channel: "party", from: player.name, text });
      return;
    }
    if (channel === "region") {
      const regionId = this.regionIdFromInstance(player.instanceId) ?? player.lastRegionId;
      if (!regionId) {
        this.sendEvent(player, { t: "event", kind: "error", message: "You are not in a region" });
        return;
      }
      this.sendToRegion(regionId, { t: "chat", channel: "region", from: player.name, text });
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
    const region = this.regionBlueprintFor(player);
    const { surface, depth } = waterAt(player.move.x, player.move.z, region ?? undefined);
    const inWater = depth > 0.05 && player.move.y < surface + 0.35;
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

  private findQuest(player: PlayerState, questId: string): QuestDef | null {
    if (QUEST_IDS.includes(questId)) return questDef(questId);
    const regionId = this.regionIdFromInstance(player.instanceId) ?? player.lastRegionId;
    if (regionId) {
      const bp = this.regionBlueprints.get(regionId);
      if (bp?.npcs) {
        for (const npc of bp.npcs) {
          for (const q of npc.quests ?? []) {
            if (q.id === questId) {
              return {
                id: q.id,
                villageIndex: 0,
                name: q.name,
                description: q.description,
                tier: q.tier,
                minLevel: q.minLevel,
                objectiveKind: q.objectiveKind,
                objectiveTarget: q.objectiveTarget,
                objectiveCount: q.objectiveCount ?? 1,
                rewardXp: q.rewardXp,
                rewardItems: q.rewardItems ?? [],
              };
            }
          }
        }
      }
    }
    return null;
  }

  private questLogFor(player: PlayerState): QuestLogEntry[] {
    const entries: QuestLogEntry[] = [];
    for (const [questId, entry] of player.questProgress) {
      if (entry.status !== "active") continue;
      const quest = this.findQuest(player, questId);
      if (!quest) continue;
      entries.push({
        id: quest.id,
        name: quest.name,
        tier: quest.tier,
        objectiveKind: quest.objectiveKind,
        objectiveTarget: quest.objectiveTarget,
        objectiveCount: quest.objectiveCount,
        progress: entry.progress,
        status: entry.progress >= quest.objectiveCount ? "complete" : "active",
        waypoints: (quest as any).waypoints,
      });
    }
    return entries;
  }

  private achEntry(player: PlayerState, id: string): { progress: number; unlockedAt: number | null } {
    let e = player.achievements.get(id);
    if (!e) {
      e = { progress: 0, unlockedAt: null };
      player.achievements.set(id, e);
    }
    return e;
  }

  private achievementProgressValue(player: PlayerState, id: string): number {
    const def = ACHIEVEMENTS[id];
    if (!def) return 0;
    const entry = player.achievements.get(id);
    if (entry?.unlockedAt != null) return achievementTarget(def);
    const c = def.criteria;
    switch (c.kind) {
      case "quest_complete":
        return player.questProgress.get(c.questId)?.status === "completed" ? 1 : 0;
      case "quest_complete_any": {
        let n = 0;
        for (const e of player.questProgress.values()) if (e.status === "completed") n++;
        return n;
      }
      case "level":
        return player.level >= c.level ? 1 : 0;
      case "kill":
      case "gather":
      case "world_event":
      case "dungeon_complete":
        return entry?.progress ?? 0;
    }
  }

  private achievementsFor(player: PlayerState): AchievementSnap[] {
    return ACHIEVEMENT_IDS.map((id) => {
      const def = ACHIEVEMENTS[id]!;
      const target = achievementTarget(def);
      const entry = player.achievements.get(id);
      const progress = Math.min(target, this.achievementProgressValue(player, id));
      const complete = entry?.unlockedAt != null;
      return {
        id: def.id,
        name: def.name,
        description: def.description,
        requirement: def.requirement,
        category: def.category,
        rewardXp: def.rewardXp,
        rewardItems: def.rewardItems.map((r) => ({ ...r })),
        progress,
        target,
        complete,
        unlockedAt: entry?.unlockedAt ?? null,
      };
    });
  }

  private bumpAchievementCounter(
    player: PlayerState,
    kind: "kill" | "gather" | "world_event" | "dungeon_complete",
    key: string,
    amount: number,
  ): void {
    if (amount <= 0) return;
    for (const id of ACHIEVEMENT_IDS) {
      const def = ACHIEVEMENTS[id]!;
      const c = def.criteria;
      if (c.kind !== kind) continue;
      if (kind === "kill" && c.kind === "kill" && c.mobType !== key) continue;
      if (kind === "gather" && c.kind === "gather" && c.itemId !== key) continue;
      if (kind === "world_event" && c.kind === "world_event" && c.eventId && c.eventId !== key) continue;
      const entry = this.achEntry(player, id);
      if (entry.unlockedAt != null) continue;
      entry.progress = Math.min(achievementTarget(def), entry.progress + amount);
      player.dirty = true;
    }
    this.checkAndUnlockAchievements(player);
  }

  private unlockAchievement(player: PlayerState, id: string): void {
    const def = ACHIEVEMENTS[id];
    if (!def) return;
    const entry = this.achEntry(player, id);
    if (entry.unlockedAt != null) return;
    entry.unlockedAt = Date.now();
    entry.progress = achievementTarget(def);
    this.grantXp(player, def.rewardXp, { skipAchievements: true });
    const items: { itemId: string; qty: number }[] = [];
    for (const r of def.rewardItems) {
      addItem(player.inventory, r.itemId, r.qty);
      items.push({ itemId: r.itemId, qty: r.qty });
    }
    player.dirty = true;
    this.sendInventory(player);
    this.sendTo(player.peer, {
      t: "achievementUnlocked",
      id: def.id,
      name: def.name,
      xp: def.rewardXp,
      items,
    });
  }

  private checkAndUnlockAchievements(player: PlayerState, opts?: { sync?: boolean }): void {
    let unlocked = false;
    for (let pass = 0; pass < 3; pass++) {
      let passUnlock = false;
      for (const id of ACHIEVEMENT_IDS) {
        const def = ACHIEVEMENTS[id]!;
        const entry = this.achEntry(player, id);
        if (entry.unlockedAt != null) continue;
        const progress = this.achievementProgressValue(player, id);
        entry.progress = progress;
        if (progress >= achievementTarget(def)) {
          this.unlockAchievement(player, id);
          passUnlock = true;
          unlocked = true;
        }
      }
      if (!passUnlock) break;
    }
    if (opts?.sync !== false) {
      this.sendTo(player.peer, { t: "achievements", achievements: this.achievementsFor(player) });
    }
    if (unlocked) player.dirty = true;
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

    if (npcId.startsWith("rnpc_")) {
      const realId = npcId.slice(5);
      const regionId = this.regionIdFromInstance(player.instanceId) ?? player.lastRegionId;
      if (!regionId) return;
      const bp = this.regionBlueprints.get(regionId);
      if (!bp || !bp.npcs) return;
      const rNpc = bp.npcs.find((n) => n.id === realId);
      if (!rNpc) return;
      const npcW = regionLocalToWorld(bp, rNpc.localX, rNpc.localZ);
      if (dist2D(player.move.x, player.move.z, npcW.x, npcW.z) > 8) return;

      // ---- Vendor NPCs: open the merchant window ----
      const vId = resolveVendorId(rNpc);
      if (vId) {
        const vDef = vendorDef(vId);
        if (vDef) {
          this.sendTo(player.peer, {
            t: "vendorStock",
            npcId: vId,
            vendorName: rNpc.name,
            title: vDef.title,
            items: vDef.items,
          });
          return;
        }
      }

      const offers: QuestOfferInfo[] = [];

      for (const q of rNpc.quests ?? []) {
        const entry = player.questProgress.get(q.id);
        offers.push({
          id: q.id,
          name: q.name,
          description: q.description,
          tier: q.tier,
          minLevel: q.minLevel,
          objectiveKind: q.objectiveKind,
          objectiveTarget: q.objectiveTarget,
          objectiveCount: q.objectiveCount ?? 1,
          rewardXp: q.rewardXp,
          rewardItems: q.rewardItems ?? [],
          status: this.questStatusFor(player, {
            id: q.id,
            villageIndex: 0,
            name: q.name,
            description: q.description,
            tier: q.tier,
            minLevel: q.minLevel,
            objectiveKind: q.objectiveKind as any,
            objectiveTarget: q.objectiveTarget,
            objectiveCount: q.objectiveCount ?? 1,
            rewardXp: q.rewardXp,
            rewardItems: q.rewardItems ?? [],
          }),
          progress: entry?.progress ?? 0,
        });
      }

      if (rNpc.generateProceduralQuests !== false) {
        for (const q of questsForVillage(0)) {
          const entry = player.questProgress.get(q.id);
          offers.push({
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
          });
        }
      }

      this.sendTo(player.peer, { t: "questOffer", npcId, npcName: rNpc.name, offers });
      return;
    }

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
    if (action === "decline") return;
    const quest = this.findQuest(player, questId);
    if (!quest) return;

    let nearNpc = false;
    const regionId = this.regionIdFromInstance(player.instanceId) ?? player.lastRegionId;
    if (regionId) {
      const bp = this.regionBlueprints.get(regionId);
      if (bp?.npcs) {
        for (const rNpc of bp.npcs) {
          const npcW = regionLocalToWorld(bp, rNpc.localX, rNpc.localZ);
          if (dist2D(player.move.x, player.move.z, npcW.x, npcW.z) <= 8) {
            nearNpc = true;
            break;
          }
        }
      }
    }
    if (!nearNpc) {
      const npc = this.npcs.find((n) => n.villageIndex === quest.villageIndex);
      if (npc && dist2D(player.move.x, player.move.z, npc.x, npc.z) <= 6) {
        nearNpc = true;
      }
    }

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

      // Register escort NPC state on server if objective is escort or has waypoints
      const regionId = this.regionIdFromInstance(player.instanceId) ?? player.lastRegionId;
      if (regionId) {
        const bp = this.regionBlueprints.get(regionId);
        if (bp?.npcs) {
          for (const rNpc of bp.npcs) {
            const hasQuest = rNpc.quests?.some((q) => q.id === quest.id);
            if (hasQuest) {
              const waypoints = (quest as any).waypoints;
              const npcW = regionLocalToWorld(bp, rNpc.localX, rNpc.localZ);
              this.activeRegionNpcs.set(rNpc.id, {
                id: rNpc.id,
                name: rNpc.name,
                regionId,
                instanceId: player.instanceId ?? "",
                x: npcW.x,
                y: 0,
                z: npcW.z,
                startX: npcW.x,
                startZ: npcW.z,
                hp: 100,
                maxHp: 100,
                waypoints,
                currentWpIdx: 0,
                activeQuestId: quest.id,
              });
            }
          }
        }
      }

      this.sendTo(player.peer, { t: "questLog", quests: this.questLogFor(player) });
    } else if (action === "turnin") {
      const entry = player.questProgress.get(quest.id);
      if (!entry || entry.status !== "active") return;
      if (quest.objectiveKind !== "escort" && entry.progress < quest.objectiveCount) return;

      player.questProgress.set(quest.id, { status: "completed", progress: quest.objectiveCount });
      this.grantXp(player, quest.rewardXp);
      const coinReward = Math.max(50, quest.rewardXp * 2 + (quest.minLevel || 1) * 100);
      player.coins += coinReward;
      const rewards: { itemId: string; qty: number }[] = [];
      for (const item of quest.rewardItems) {
        addItem(player.inventory, item.itemId, item.qty);
        rewards.push({ itemId: item.itemId, qty: item.qty });
      }
      player.dirty = true;
      this.sendInventory(player);
      this.sendSelf(player);
      this.sendTo(player.peer, { t: "questLog", quests: this.questLogFor(player) });
      this.sendTo(player.peer, {
        t: "chat",
        channel: "system",
        from: "system",
        text: `Quest completed! Received +${this.formatCoinsText(coinReward)}.`,
      });
      this.checkAndUnlockAchievements(player);
      this.sendTo(player.peer, {
        t: "questComplete",
        questId: quest.id,
        questName: quest.name,
        xp: quest.rewardXp,
        items: rewards,
      });
      // Trigger WoW-style loot window with rewards!
      this.sendTo(player.peer, {
        t: "corpseLoot",
        mobId: `quest_${quest.id}`,
        mobType: quest.name,
        items: rewards,
      });
    }
  }

  private formatCoinsText(copper: number): string {
    const g = Math.floor(copper / 10000);
    const s = Math.floor((copper % 10000) / 100);
    const c = copper % 100;
    const parts: string[] = [];
    if (g > 0) parts.push(`${g}g`);
    if (s > 0) parts.push(`${s}s`);
    if (c > 0 || parts.length === 0) parts.push(`${c}c`);
    return parts.join(" ");
  }

  private handleVendorAction(
    player: PlayerState,
    msg: { action: "buy" | "sell" | "browse"; npcId: string; itemId?: string; container?: any; slot?: number; qty?: number },
  ): void {
    const vendor = vendorDef(msg.npcId) ?? VENDORS.vendor_merchant;

    if (msg.action === "browse") {
      this.sendTo(player.peer, {
        t: "vendorStock",
        npcId: vendor.id,
        vendorName: vendor.name,
        title: vendor.title,
        items: vendor.items,
      });
      return;
    }

    if (msg.action === "buy") {
      const itemId = msg.itemId;
      if (!itemId) return;
      const ware = vendor.items.find((i) => i.itemId === itemId);
      const unitPrice = ware ? ware.price : (itemDef(itemId).vendorPrice ?? 100);
      const qty = Math.max(1, msg.qty ?? 1);
      const totalPrice = unitPrice * qty;

      if (player.coins < totalPrice) {
        this.sendEvent(player, { t: "event", kind: "error", message: `Not enough SoEC coins! Need ${this.formatCoinsText(totalPrice)}.` });
        return;
      }

      const overflow = addItem(player.inventory, itemId, qty);
      if (overflow === qty) {
        this.sendEvent(player, { t: "event", kind: "error", message: "Inventory is full!" });
        return;
      }

      const purchasedQty = qty - overflow;
      const finalCost = unitPrice * purchasedQty;
      player.coins -= finalCost;
      player.dirty = true;
      this.sendInventory(player);
      this.sendSelf(player);

      const itemName = itemDef(itemId).name;
      this.sendTo(player.peer, {
        t: "chat",
        channel: "system",
        from: "system",
        text: `Bought ${purchasedQty}x ${itemName} for ${this.formatCoinsText(finalCost)}.`,
      });
      return;
    }

    if (msg.action === "sell") {
      const containerName = msg.container ?? "inventory";
      const slotIndex = msg.slot ?? 0;
      const targetContainer = player.inventory;
      const item = targetContainer.find((i) => i.container === containerName && i.slot === slotIndex);

      if (!item) {
        this.sendEvent(player, { t: "event", kind: "error", message: "Item not found in inventory." });
        return;
      }

      const def = itemDef(item.itemId);
      const basePrice = def.vendorPrice ?? 40;
      const sellUnitPrice = Math.max(1, Math.floor(basePrice * 0.25));
      const qtyToSell = Math.min(item.qty, msg.qty ?? item.qty);
      const totalEarned = sellUnitPrice * qtyToSell;

      // Remove qtyToSell from the slot
      item.qty -= qtyToSell;
      if (item.qty <= 0) {
        const idx = targetContainer.indexOf(item);
        if (idx >= 0) targetContainer.splice(idx, 1);
      }
      player.coins += totalEarned;
      player.dirty = true;
      this.sendInventory(player);
      this.sendSelf(player);

      this.sendTo(player.peer, {
        t: "chat",
        channel: "system",
        from: "system",
        text: `Sold ${qtyToSell}x ${def.name} for +${this.formatCoinsText(totalEarned)}.`,
      });
    }
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
      let quest;
      try {
        quest = questDef(questId);
      } catch {
        continue;
      }
      if (quest.objectiveKind !== "kill" || quest.objectiveTarget !== mobType) continue;
      if (entry.progress >= quest.objectiveCount) continue;
      entry.progress = Math.min(quest.objectiveCount, entry.progress + 1);
      changed = true;
    }
    this.bumpAchievementCounter(player, "kill", mobType, 1);
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
      let quest;
      try {
        quest = questDef(questId);
      } catch {
        continue;
      }
      if (quest.objectiveKind !== "gather" || quest.objectiveTarget !== itemId) continue;
      if (entry.progress >= quest.objectiveCount) continue;
      entry.progress = Math.min(quest.objectiveCount, entry.progress + qty);
      changed = true;
    }
    this.bumpAchievementCounter(player, "gather", itemId, qty);
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

  /** Marks a POI as permanently discovered for this character and pushes a
   *  targeted live-unlock message -- same shape as unlockAchievement, but
   *  binary (no progress/target) and idempotent (no-op if already known),
   *  which is what makes it safe for the client to trigger its discovery
   *  cinematic straight off this ack rather than the raw interact keypress:
   *  a spam-click or an out-of-range interact never reaches here twice. */
  private discoverPoi(
    player: PlayerState,
    poi: RegionPoi,
    regionId: string,
    world: { x: number; y: number; z: number },
    worldShape: { x: number; z: number }[],
  ): void {
    if (player.discoveredPois.has(poi.id)) return;
    player.discoveredPois.set(poi.id, Date.now());
    player.dirty = true;
    const xp = poi.rewardXp ?? 25;
    this.grantXp(player, xp);
    this.sendTo(player.peer, {
      t: "poiDiscovered",
      poiId: poi.id,
      regionId,
      name: poi.name,
      description: poi.description,
      x: world.x,
      y: world.y,
      z: world.z,
      revealShape: worldShape,
      xp,
    });
  }

  private handlePoiMarkerInteract(player: PlayerState, poiId: string): void {
    if (player.dead) return;
    const regionId = this.regionIdFromInstance(player.instanceId) ?? player.lastRegionId;
    if (!regionId) return;
    const bp = this.regionBlueprints.get(regionId);
    const poi = bp?.pois?.find((p) => p.id === poiId);
    if (!bp || !poi) return;
    const world = regionLocalToWorld(bp, poi.localX, poi.localZ);
    if (dist2D(player.move.x, player.move.z, world.x, world.z) > (poi.interactRadius ?? 6)) return;
    const y = sampleRegionHeight(bp, poi.localX, poi.localZ);
    const worldShape = (poi.revealShape ?? []).map((p) => regionLocalToWorld(bp, p.x, p.z));
    this.discoverPoi(player, poi, regionId, { x: world.x, y, z: world.z }, worldShape);
  }

  // ============================ parties ============================

  private handleParty(
    player: PlayerState,
    action: "invite" | "accept" | "decline" | "leave" | "disband" | "tag",
    name?: string,
    tag?: string,
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
          this.parties.set(partyId, { leaderId: inviter.id, members: new Set([inviter.id]), tags: new Map() });
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
      case "tag": {
        const partyId = player.partyId;
        if (!partyId) return;
        const party = this.parties.get(partyId);
        if (!party) return;
        if (party.leaderId !== player.id) {
          this.sendEvent(player, { t: "event", kind: "error", message: "Only party leader can assign tags" });
          return;
        }
        const targetName = name ?? "";
        const targetPlayer = [...this.players.values()].find((p) => p.name.toLowerCase() === targetName.toLowerCase());
        if (!targetPlayer || !party.members.has(targetPlayer.id)) return;

        if (tag === "clear" || !tag) {
          party.tags.delete(targetPlayer.id);
        } else {
          party.tags.set(targetPlayer.id, tag);
        }
        this.broadcastPartyState(partyId);
        break;
      }
    }
  }

  private async handleFriend(
    player: PlayerState,
    action: "add" | "accept" | "decline" | "remove",
    targetName: string,
  ): Promise<void> {
    const trimmedTarget = targetName.trim();
    if (!trimmedTarget || trimmedTarget.toLowerCase() === player.name.toLowerCase()) return;

    if (action === "add") {
      // 1. Add target to initiating player's friends list
      if (!player.friends.some((f) => f.toLowerCase() === trimmedTarget.toLowerCase())) {
        player.friends.push(trimmedTarget);
        this.savePlayerFriends(player);
        this.sendTo(player.peer, {
          t: "chat",
          channel: "system",
          from: "system",
          text: `Added ${trimmedTarget} to your friends list.`,
        });
      }
      this.sendFriendListUpdate(player);

      // 2. Notify target player if online & add reciprocating friend entry
      const onlineTarget = [...this.players.values()].find((p) => p.name.toLowerCase() === trimmedTarget.toLowerCase());
      if (onlineTarget) {
        if (!onlineTarget.friends.some((f) => f.toLowerCase() === player.name.toLowerCase())) {
          onlineTarget.friends.push(player.name);
          this.savePlayerFriends(onlineTarget);
        }
        this.sendTo(onlineTarget.peer, {
          t: "chat",
          channel: "system",
          from: "system",
          text: `🌟 ${player.name} added you as a friend!`,
        });
        this.sendEvent(onlineTarget, {
          t: "event",
          kind: "info",
          message: `${player.name} added you as a friend!`,
        });
        this.sendFriendListUpdate(onlineTarget);
      } else {
        // Target is offline: update their DB record so they see friendship when logging in
        const dbChar = await db.query.characters.findFirst({
          where: eq(schema.characters.name, trimmedTarget),
        }).catch(() => null);
        if (dbChar) {
          const currentFriends: string[] = (dbChar.friends as string[]) ?? [];
          if (!currentFriends.some((f) => f.toLowerCase() === player.name.toLowerCase())) {
            currentFriends.push(player.name);
            await db
              .update(schema.characters)
              .set({ friends: currentFriends })
              .where(eq(schema.characters.id, dbChar.id))
              .catch(() => {});
          }
        }
      }
    } else if (action === "remove") {
      player.friends = player.friends.filter((f) => f.toLowerCase() !== trimmedTarget.toLowerCase());
      this.savePlayerFriends(player);
      this.sendTo(player.peer, {
        t: "chat",
        channel: "system",
        from: "system",
        text: `Removed ${trimmedTarget} from your friends list.`,
      });
      this.sendFriendListUpdate(player);

      const onlineTarget = [...this.players.values()].find((p) => p.name.toLowerCase() === trimmedTarget.toLowerCase());
      if (onlineTarget) {
        onlineTarget.friends = onlineTarget.friends.filter((f) => f.toLowerCase() !== player.name.toLowerCase());
        this.savePlayerFriends(onlineTarget);
        this.sendFriendListUpdate(onlineTarget);
      }
    }
  }

  private savePlayerFriends(player: PlayerState): void {
    void db
      .update(schema.characters)
      .set({ friends: player.friends })
      .where(eq(schema.characters.id, player.id))
      .catch(() => {});
  }

  private sendFriendListUpdate(player: PlayerState): void {
    const list: FriendEntry[] = player.friends.map((name) => {
      const onlineTarget = [...this.players.values()].find((p) => p.name.toLowerCase() === name.toLowerCase());
      if (onlineTarget) {
        return {
          id: onlineTarget.id,
          name: onlineTarget.name,
          className: onlineTarget.classId,
          level: onlineTarget.level,
          online: true,
          regionName: this.regionIdFromInstance(onlineTarget.instanceId) ?? onlineTarget.lastRegionId ?? "Overworld",
        };
      }
      return {
        id: `offline_${name}`,
        name,
        className: "warrior",
        level: 1,
        online: false,
      };
    });
    this.sendTo(player.peer, { t: "friends", friends: list });
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
      const isLeader = id === party.leaderId;
      const assignedTag = party.tags.get(id);
      const tag = isLeader ? "crown" : assignedTag;
      return member
        ? {
            id: member.id,
            name: member.name,
            level: member.level,
            hp: member.hp,
            maxHp: this.maxHp(member),
            online: true,
            leader: isLeader,
            tag,
            x: member.move.x,
            z: member.move.z,
          }
        : { id, name: "…", level: 0, hp: 0, maxHp: 1, online: false, leader: isLeader, tag, x: 0, z: 0 };
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
    if (a.instanceId === b.instanceId) return true;
    // Open regions share one continent space (seamless streaming) — dungeons stay isolated.
    const ra = this.regionIdFromInstance(a.instanceId);
    const rb = this.regionIdFromInstance(b.instanceId);
    return ra !== null && rb !== null;
  }

  /** Grid cell size for the sendSnapshots() proximity grid below -- equal to
   *  INTEREST_RADIUS so a 120m query always needs exactly a 3x3 neighborhood
   *  (ceil(INTEREST_RADIUS / GRID_CELL) = 1 cell in each direction). */
  private static readonly GRID_CELL = INTEREST_RADIUS;

  /** Which spatial partition an instanceId belongs to, for the proximity
   *  grid -- mirrors sameInstance()'s truth table exactly (this must stay in
   *  sync with that function, not reimplement its own notion of "same
   *  place"): any "region_*" instance collapses into one shared "region"
   *  bucket (regions occupy non-overlapping world-space origins, so a plain
   *  distance check across them is valid); every other instanceId (dungeon
   *  runs, and the literal `null` overworld state that no connected player
   *  is ever actually in) is isolated by its own exact value, since dungeon
   *  runs through the same portal reuse identical local coordinates and must
   *  never be spatially compared against each other. */
  private partitionKey(instanceId: string | null): string {
    return instanceId !== null && this.regionIdFromInstance(instanceId) !== null ? "region" : (instanceId ?? "__null__");
  }

  private gridCellKey(partition: string, x: number, z: number): string {
    const cx = Math.floor(x / GameServer.GRID_CELL);
    const cz = Math.floor(z / GameServer.GRID_CELL);
    return `${partition}:${cx}:${cz}`;
  }

  /** Buckets `items` into a partition+cell keyed grid for sendSnapshots()'s
   *  interest-radius queries -- rebuilt fresh once per snapshot tick (not
   *  incrementally maintained; every entity can move every tick anyway, and
   *  a full rebuild is exactly the O(entities) cost that used to be paid
   *  once per VIEWER instead of once total). */
  private buildProximityGrid<T>(
    items: readonly T[],
    getInstanceId: (item: T) => string | null,
    getPos: (item: T) => { x: number; z: number },
  ): Map<string, T[]> {
    const grid = new Map<string, T[]>();
    for (const item of items) {
      const partition = this.partitionKey(getInstanceId(item));
      const { x, z } = getPos(item);
      const key = this.gridCellKey(partition, x, z);
      const bucket = grid.get(key);
      if (bucket) bucket.push(item);
      else grid.set(key, [item]);
    }
    return grid;
  }

  /** 3x3-neighborhood candidates around (x,z) in `grid`'s partition for
   *  `instanceId` -- a superset of what's actually within INTEREST_RADIUS;
   *  callers still run the exact dist2D + sameInstance checks on the result,
   *  same as before this grid existed. This only shrinks the candidate set,
   *  it never changes which entities end up in a snapshot. */
  private gridCandidates<T>(grid: Map<string, T[]>, instanceId: string | null, x: number, z: number): T[] {
    const partition = this.partitionKey(instanceId);
    const cx = Math.floor(x / GameServer.GRID_CELL);
    const cz = Math.floor(z / GameServer.GRID_CELL);
    const out: T[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = grid.get(`${partition}:${cx + dx}:${cz + dz}`);
        if (bucket) out.push(...bucket);
      }
    }
    return out;
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
      const y = dungeonFloorHeightAt(x, z) ?? layout.floorY;
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
        threat: new Map(),
        instanceId,
        hpMult: mult,
        dmgMult: mult,
      });
    }

    // Spawn Chest Nodes for this dungeon instance
    for (let i = 0; i < layout.chests.length; i++) {
      const c = layout.chests[i]!;
      const nodeId = `${instanceId}_chest_${i}`;
      this.nodes.set(nodeId, {
        id: nodeId,
        type: c.rarity === "rare" ? "dungeon_chest_rare" : "dungeon_chest_common",
        x: layout.center.x + c.localX,
        y: layout.center.y + c.localY,
        z: layout.center.z + c.localZ,
        variant: 0,
        biome: "forest" as const,
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
      member.move = { x: ex, y: layout.floorY + layout.spawnHeight, z: ez, vy: 0, grounded: true };
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
    if (instance) {
      const layout = generateDungeonLayout(instance.portalId);
      if (dist2D(player.move.x, player.move.z, layout.entryPoint.x, layout.entryPoint.z) > 6.0) {
        return; // Too far from the exit portal
      }
    }
    this.teleportOutOfDungeon(player, instance ?? null);
    if (instance) {
      instance.memberIds.delete(player.id);
      if (instance.memberIds.size === 0) this.teardownInstance(instance.id);
    }
  }

  private teleportOutOfDungeon(player: PlayerState, instance: DungeonInstance | null): void {
    // No open overworld — dungeon exits return to the starting town (or the
    // region that still contains the old portal coords, if any).
    const portal = instance ? this.dungeonPortals.get(instance.portalId) : null;
    const hintX = portal?.x ?? player.move.x;
    const hintZ = portal?.z ?? player.move.z;
    const placed = this.placeInRegionAt(hintX, hintZ);
    player.instanceId = placed.instanceId;
    player.move = { x: placed.x, y: placed.y, z: placed.z, vy: 0, grounded: true };
    player.dirty = true;
    for (const pet of this.pets.values()) {
      if (pet.ownerId === player.id) pet.instanceId = player.instanceId;
    }
    this.sendSelf(player);
    this.sendDungeonState(player, null);
    const regionId = this.regionIdFromInstance(player.instanceId);
    const region = regionId ? this.regionBlueprints.get(regionId) : undefined;
    if (region) this.sendRegionState(player, region);
  }

  private sendDungeonState(player: PlayerState, instance: DungeonInstance | null): void {
    if (!instance) {
      this.sendTo(player.peer, {
        t: "dungeonState",
        inDungeon: false,
        tier: null,
        partySize: 0,
        mobsRemaining: null,
        instanceId: null,
        portalId: null,
      });
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
      instanceId: instance.id,
      portalId: instance.portalId,
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
      this.bumpAchievementCounter(member, "dungeon_complete", "", 1);
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
    
    // Clean up chest nodes
    for (const nodeId of this.nodes.keys()) {
      if (nodeId.startsWith(`${instanceId}_chest_`)) {
        this.nodes.delete(nodeId);
      }
    }
    
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

  // ============================ regions ============================

  /** True whenever this is a real dungeon-run instanceId ("dgn_N") as
   *  opposed to a region's deterministic "region_<id>" tag or null -- a few
   *  death/respawn/loot code paths originally just checked instanceId
   *  truthiness (meaning "must be a dungeon"), which silently misbehaved
   *  for region players once regions started reusing the same tagging
   *  mechanism (see killMob/handleRespawn/moveMob). */
  private isDungeonInstance(instanceId: string | null): boolean {
    return instanceId !== null && instanceId.startsWith("dgn_");
  }

  private regionIdFromInstance(instanceId: string | null): string | null {
    return instanceId !== null && instanceId.startsWith("region_") ? instanceId.slice("region_".length) : null;
  }

  /** Spawns a region's mob roster the first time anyone enters it. Unlike
   *  dungeon mobs (one-off, deleted when the run's instance tears down),
   *  these behave exactly like overworld mobs -- normal loot/XP on kill,
   *  normal respawn timer -- since a region is a persistent shared zone,
   *  not a disposable run (see activeRegionIds). */
  private activateRegion(region: RegionBlueprint): void {
    if (this.activeRegionIds.has(region.id)) return;
    this.activeRegionIds.add(region.id);
    const instanceId = `region_${region.id}`;

    // Auto-generate mobSpawns along escort waypoints & area if empty in blueprint
    if (!region.mobSpawns || region.mobSpawns.length === 0) {
      const autoSpawns: { localX: number; localZ: number; type?: string }[] = [];
      for (const rNpc of region.npcs ?? []) {
        for (const q of rNpc.quests ?? []) {
          const wps = (q as any).waypoints;
          if (wps && Array.isArray(wps)) {
            for (const wp of wps) {
              autoSpawns.push({ localX: wp.x + (Math.random() - 0.5) * 6, localZ: wp.z + (Math.random() - 0.5) * 6 });
              autoSpawns.push({ localX: wp.x + (Math.random() - 0.5) * 10, localZ: wp.z + (Math.random() - 0.5) * 10 });
            }
          }
        }
      }
      if (autoSpawns.length === 0) {
        const entryX = region.entryLocal?.x ?? 0;
        const entryZ = region.entryLocal?.z ?? 0;
        for (let i = 0; i < 10; i++) {
          const angle = (i / 10) * Math.PI * 2;
          const dist = 12 + Math.random() * 20;
          autoSpawns.push({ localX: entryX + Math.sin(angle) * dist, localZ: entryZ + Math.cos(angle) * dist });
        }
      }
      region.mobSpawns = autoSpawns;
    }

    for (let i = 0; i < region.mobSpawns.length; i++) {
      const spawn = region.mobSpawns[i]!;
      const type = spawn.type ?? pickRegionMob(region.biome, Math.random());
      const def = mobDef(type);
      const world = regionLocalToWorld(region, spawn.localX, spawn.localZ);
      const y = sampleRegionHeight(region, spawn.localX, spawn.localZ);
      const mobId = `${instanceId}_${i}`;
      const scale = Math.max(0.25, spawn.difficulty ?? 1);
      // Stay dormant until a player walks near — keeps tickMobs + snapshots
      // cheap when a region has dozens of authored spawns.
      this.dormantRegionMobs.set(mobId, {
        id: mobId,
        type,
        x: world.x,
        y,
        z: world.z,
        yaw: 0,
        hp: def.maxHp * scale,
        homeX: world.x,
        homeZ: world.z,
        targetId: null,
        attackReadyAt: 0,
        respawnAt: null,
        wanderTx: world.x,
        wanderTz: world.z,
        nextWanderAt: 0,
        actionAnimUntil: 0,
        activeAuras: [],
        threat: new Map(),
        instanceId,
        hpMult: scale,
        dmgMult: scale,
      });
    }

    for (const rNpc of region.npcs ?? []) {
      const world = regionLocalToWorld(region, rNpc.localX, rNpc.localZ);
      const y = sampleRegionHeight(region, rNpc.localX, rNpc.localZ);
      this.activeRegionNpcs.set(rNpc.id, {
        id: rNpc.id,
        name: rNpc.name,
        regionId: region.id,
        instanceId,
        x: world.x,
        y,
        z: world.z,
        startX: world.x,
        startZ: world.z,
        hp: 100,
        maxHp: 100,
      });
    }

    this.syncRegionResourceNodes(region);

    const now = Date.now();
    for (const ev of region.worldEvents ?? []) {
      const key = `${region.id}:${ev.id}`;
      if (this.worldEvents.has(key)) continue;
      this.worldEvents.set(key, createWorldEventRuntime(ev, region.id, now));
    }

    // region.pois deliberately has no runtime seeding here -- discovery is
    // binary/permanent with no cooldown/phase state, so handlePoiMarkerInteract
    // resolves POIs straight from the blueprint on interact instead.
  }

  /** Replace gather nodes authored on a region (safe to call on editor re-save). */
  private syncRegionResourceNodes(region: RegionBlueprint): void {
    for (const id of [...this.nodes.keys()]) {
      // Authored ids always contain `_node` after the region prefix; mob ids do not.
      if (!id.startsWith(`region_${region.id}_`) || !id.includes("_node")) continue;
      this.nodes.delete(id);
      this.nodeHits.delete(id);
    }
    for (const node of worldNodesFromRegion(region)) {
      this.nodes.set(node.id, node);
    }
  }

  registerRegionBlueprint(blueprint: RegionBlueprint): void {
    this.regionBlueprints.set(blueprint.id, blueprint);
    // Editor saves re-register live — drop the stale BVH so it re-bakes with
    // the new asset placements/shapes on the next movement tick.
    this.invalidateRegionCollision(blueprint.id);
    this.regionPortals.set(blueprint.id, {
      id: blueprint.id,
      name: blueprint.name,
      x: blueprint.portalWorldX,
      z: blueprint.portalWorldZ,
    });
    this.activateRegion(blueprint);
    // activateRegion no-ops when already live — still refresh authored nodes.
    this.syncRegionResourceNodes(blueprint);
  }

  /**
   * Tear down a region that was deleted from disk: relocate players, drop
   * mobs/NPCs/nodes/events, scrub in-memory portal links on other regions,
   * and remove catalog entries.
   */
  unregisterRegionBlueprint(regionId: string): void {
    const instanceId = `region_${regionId}`;
    const fallback =
      [...this.regionBlueprints.values()].find((r) => r.id !== regionId && r.isStartingRegion) ??
      [...this.regionBlueprints.values()].find((r) => r.id !== regionId);
    if (fallback) {
      for (const player of this.players.values()) {
        if (this.regionIdFromInstance(player.instanceId) === regionId) {
          this.teleportToRegion(player, fallback.id, fallback.entryLocal.x, fallback.entryLocal.z);
        }
        if (player.lastRegionId === regionId) {
          player.lastRegionId = undefined;
          player.lastRegionX = undefined;
          player.lastRegionZ = undefined;
        }
      }
    }

    for (const id of [...this.mobs.keys()]) {
      const mob = this.mobs.get(id);
      if (mob?.instanceId === instanceId) this.mobs.delete(id);
    }
    for (const id of [...this.dormantRegionMobs.keys()]) {
      const mob = this.dormantRegionMobs.get(id);
      if (mob?.instanceId === instanceId) this.dormantRegionMobs.delete(id);
    }
    for (const [npcId, npc] of [...this.activeRegionNpcs.entries()]) {
      if (npc.regionId === regionId) this.activeRegionNpcs.delete(npcId);
    }
    for (const id of [...this.nodes.keys()]) {
      if (id.startsWith(`region_${regionId}_`)) {
        this.nodes.delete(id);
        this.nodeHits.delete(id);
      }
    }
    for (const key of [...this.worldEvents.keys()]) {
      if (key.startsWith(`${regionId}:`)) this.worldEvents.delete(key);
    }

    for (const bp of this.regionBlueprints.values()) {
      if (bp.id === regionId || !bp.portals?.length) continue;
      const next = bp.portals.filter((p) => p.targetRegionId !== regionId);
      if (next.length !== bp.portals.length) {
        bp.portals = next.length > 0 ? next : undefined;
      }
    }

    this.regionBlueprints.delete(regionId);
    this.invalidateRegionCollision(regionId);
    this.regionPortals.delete(regionId);
    this.activeRegionIds.delete(regionId);
  }

  /** Reposition a region on the continent map — rebases live mobs/NPCs by the
   *  origin delta so editor layout changes take effect without a restart. */
  updateRegionWorldOrigin(regionId: string, worldOriginX: number, worldOriginZ: number): void {
    const bp = this.regionBlueprints.get(regionId);
    if (!bp) return;
    const prev = regionWorldOrigin(bp);
    const dx = worldOriginX - prev.x;
    const dz = worldOriginZ - prev.z;
    bp.worldOriginX = worldOriginX;
    bp.worldOriginZ = worldOriginZ;
    this.regionBlueprints.set(regionId, bp);
    this.invalidateRegionCollision(regionId); // world-baked BVH must re-origin
    if (dx === 0 && dz === 0) return;

    const instanceId = `region_${regionId}`;
    for (const mob of this.mobs.values()) {
      if (mob.instanceId !== instanceId) continue;
      mob.x += dx;
      mob.z += dz;
      mob.homeX += dx;
      mob.homeZ += dz;
      mob.wanderTx += dx;
      mob.wanderTz += dz;
    }
    for (const mob of this.dormantRegionMobs.values()) {
      if (mob.instanceId !== instanceId) continue;
      mob.x += dx;
      mob.z += dz;
      mob.homeX += dx;
      mob.homeZ += dz;
      mob.wanderTx += dx;
      mob.wanderTz += dz;
    }
    for (const npc of this.activeRegionNpcs.values()) {
      if (npc.regionId !== regionId) continue;
      npc.x += dx;
      npc.z += dz;
      npc.startX += dx;
      npc.startZ += dz;
    }
    for (const player of this.players.values()) {
      if (this.regionIdFromInstance(player.instanceId) !== regionId) continue;
      player.move.x += dx;
      player.move.z += dz;
      player.dirty = true;
    }
    // Rebuild authored gather nodes at the new world origin.
    this.syncRegionResourceNodes(bp);
  }

  private getStartingRegion(): RegionBlueprint | undefined {
    for (const region of this.regionBlueprints.values()) {
      if (region.isStartingRegion) return region;
    }
    return (
      this.regionBlueprints.get("starting_town") ??
      this.regionBlueprints.get("hub") ??
      this.regionBlueprints.values().next().value
    );
  }

  /** Spawn pose at the starting region's entry (with a tiny jitter). */
  private spawnInStartingRegion(): { instanceId: string; x: number; y: number; z: number } {
    const startingRegion = this.getStartingRegion();
    if (!startingRegion) {
      return { instanceId: "", x: 0, y: 0, z: 0 };
    }
    this.activateRegion(startingRegion);
    const lx = startingRegion.entryLocal.x + (Math.random() - 0.5) * 2;
    const lz = startingRegion.entryLocal.z + (Math.random() - 0.5) * 2;
    const world = regionLocalToWorld(startingRegion, lx, lz);
    return {
      instanceId: `region_${startingRegion.id}`,
      x: world.x,
      y: sampleRegionHeight(startingRegion, lx, lz) + 0.1,
      z: world.z,
    };
  }

  /**
   * Restore a saved world pose into the continent. Keeps the exact (x,z) the
   * player logged out at — only used for returning characters, never to force
   * starting-town for veterans.
   */
  private restoreContinentPose(
    x: number,
    z: number,
  ): { instanceId: string; x: number; y: number; z: number } {
    const under =
      findRegionAtWorld(this.regionBlueprints.values(), x, z) ??
      this.nearestRegionToWorld(x, z);
    if (under) {
      this.activateRegion(under);
      const y = sampleRegionHeightWorld(under, x, z);
      return {
        instanceId: `region_${under.id}`,
        x,
        y: (y ?? this.continentGroundAt(x, z)) + 0.1,
        z,
      };
    }
    // No region blueprints loaded — last-resort starting town.
    return this.spawnInStartingRegion();
  }

  /** Closest region by distance to its world AABB (0 if inside). */
  private nearestRegionToWorld(wx: number, wz: number): RegionBlueprint | null {
    let best: RegionBlueprint | null = null;
    let bestDist = Infinity;
    for (const bp of this.regionBlueprints.values()) {
      const b = regionWorldBounds(bp);
      const dx = wx < b.minX ? b.minX - wx : wx > b.maxX ? wx - b.maxX : 0;
      const dz = wz < b.minZ ? b.minZ - wz : wz > b.maxZ ? wz - b.maxZ : 0;
      const d = dx * dx + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = bp;
      }
    }
    return best;
  }

  /** Alias used by dungeon exit / logout helpers. */
  private placeInRegionAt(
    x: number,
    z: number,
  ): { instanceId: string; x: number; y: number; z: number } {
    return this.restoreContinentPose(x, z);
  }

  private teleportToRegion(player: PlayerState, targetRegionId: string, targetX?: number, targetZ?: number): void {
    // Legacy "overworld" portal targets redirect to the starting town.
    if (targetRegionId === "overworld") {
      const start = this.getStartingRegion();
      if (!start) return;
      this.teleportToRegion(player, start.id, start.entryLocal.x, start.entryLocal.z);
      return;
    }
    const targetRegion = this.regionBlueprints.get(targetRegionId);
    if (!targetRegion) return;

    const currentRegionId = this.regionIdFromInstance(player.instanceId);
    if (currentRegionId && currentRegionId !== targetRegionId) {
      player.lastRegionId = currentRegionId;
      const cur = this.regionBlueprints.get(currentRegionId);
      if (cur) {
        const local = worldToRegionLocal(cur, player.move.x, player.move.z);
        player.lastRegionX = local.x;
        player.lastRegionZ = local.z;
      } else {
        player.lastRegionX = player.move.x;
        player.lastRegionZ = player.move.z;
      }
    }

    this.activateRegion(targetRegion);
    this.dismountForCombat(player);
    player.instanceId = `region_${targetRegionId}`;
    const lx = targetX ?? targetRegion.entryLocal.x;
    const lz = targetZ ?? targetRegion.entryLocal.z;
    const world = regionLocalToWorld(targetRegion, lx, lz);
    const ly = sampleRegionHeight(targetRegion, lx, lz);
    player.move = { x: world.x, y: ly, z: world.z, vy: 0, grounded: true };
    player.dirty = true;
    for (const pet of this.pets.values()) {
      if (pet.ownerId === player.id) pet.instanceId = player.instanceId;
    }
    this.sendSelf(player);
    this.sendRegionState(player, targetRegion);
  }

  /** Soft zone ownership change — no teleport, no loading screen. */
  private seamlessEnterRegion(player: PlayerState, region: RegionBlueprint): void {
    if (this.regionIdFromInstance(player.instanceId) === region.id) return;
    this.activateRegion(region);
    player.instanceId = `region_${region.id}`;
    for (const pet of this.pets.values()) {
      if (pet.ownerId === player.id) pet.instanceId = player.instanceId;
    }
    player.dirty = true;
    this.sendRegionState(player, region);
  }

  private continentGroundAt(wx: number, wz: number): number {
    for (const bp of this.regionBlueprints.values()) {
      const h = sampleRegionHeightWorld(bp, wx, wz);
      if (h !== null) return h;
    }
    // Outside all regions — deep ocean floor.
    return -16;
  }

  private continentWaterDepthAt(wx: number, wz: number): number {
    for (const bp of this.regionBlueprints.values()) {
      if (sampleRegionHeightWorld(bp, wx, wz) === null) continue;
      return sampleRegionWaterDepthWorld(bp, wx, wz);
    }
    // Outside all regions — ocean water depth (surface is at sea level 0).
    return 16;
  }

  private continentCollidersNear(wx: number, wz: number): ReturnType<typeof regionAssetColliders> {
    // Capped the same way as the client's RegionContinent.syncAround -- this
    // rebuilds every near region's collider array from scratch on every call
    // (this method runs once per player per tick), so an uncapped region
    // count under a dense multi-region continent is a real per-tick cost that
    // scales with how many regions happen to be packed within the radius.
    const near = regionsNearWorld(
      this.regionBlueprints.values(),
      wx,
      wz,
      REGION_STREAM_RADIUS_METERS,
      MAX_ACTIVE_REGIONS,
    );
    const out: ReturnType<typeof regionAssetColliders> = [];
    for (const bp of near) {
      const o = regionWorldOrigin(bp);
      // Solid assets whose mesh is baked into the region BVH are collided
      // there; keep them out of the analytic set to avoid double collision.
      const analyticAssets = regionAllAssets(bp).filter(
        (a) => !(a.solid && hasServerCollisionMesh(collisionModelKey(a.category, a.model))),
      );
      for (const c of [
        ...regionAssetColliders(analyticAssets),
        ...regionVolumeColliders(bp.terrainVolumes ?? []),
        ...regionBarrierColliders(bp.barrierVolumes),
      ]) {
        out.push({
          ...c,
          x: c.x + o.x,
          z: c.z + o.z,
        });
      }
    }
    return out;
  }

  /** Region BVH collision, built lazily and OFF-THREAD. Returns the cached BVH
   *  once ready, or null while it's still building (movement uses the analytic
   *  box/circle colliders in the meantime — same fallback as the client). The
   *  build is dispatched to a worker so a ~0.5s bake never stalls the loop for
   *  every connected player. */
  private getRegionCollision(regionId: string): RegionCollision | null {
    const cached = this.regionCollisionCache.get(regionId);
    if (cached !== undefined) return cached; // ready (BVH or final null)
    if (this.regionCollisionBuilding.has(regionId)) return null; // in flight
    const bp = this.regionBlueprints.get(regionId);
    if (!bp) {
      this.regionCollisionCache.set(regionId, null);
      return null;
    }
    const placed: PlacedCollider[] = [];
    const meshes: Record<string, CollisionMeshData> = {};
    for (const a of regionAllAssets(bp)) {
      if (!a.solid) continue;
      const key = collisionModelKey(a.category, a.model);
      if (!hasServerCollisionMesh(key)) continue;
      const mesh = getServerCollisionMesh(key);
      if (mesh) meshes[key] = mesh;
      placed.push({
        modelKey: key,
        x: a.localX,
        y: a.localY,
        z: a.localZ,
        yaw: a.yaw,
        scaleX: a.scaleX ?? a.scale ?? 1,
        scaleY: a.scaleY ?? a.scale ?? 1,
        scaleZ: a.scaleZ ?? a.scale ?? 1,
      });
    }
    if (placed.length === 0) {
      this.regionCollisionCache.set(regionId, null);
      return null;
    }
    const origin = regionWorldOrigin(bp);
    const token = (this.regionCollisionBuildSeq.get(regionId) ?? 0) + 1;
    this.regionCollisionBuildSeq.set(regionId, token);
    this.regionCollisionBuilding.add(regionId);
    void getRegionCollisionWorker()
      .build(placed, meshes, { x: origin.x, z: origin.z })
      .then((col) => {
        // Discard if the region was invalidated/removed while building (a newer
        // token means a re-bake was requested; drop this stale result).
        if (this.regionCollisionBuildSeq.get(regionId) !== token) {
          if (col) disposeRegionCollision(col);
          return;
        }
        this.regionCollisionCache.set(regionId, col);
      })
      .catch((err) => {
        console.error("[game] region collision build failed:", err);
      })
      .finally(() => {
        this.regionCollisionBuilding.delete(regionId);
      });
    return null;
  }

  /** Drop a region's cached BVH so the next movement tick re-bakes it. Bumps the
   *  build token so any in-flight worker build for this region is discarded. */
  private invalidateRegionCollision(regionId: string): void {
    const cached = this.regionCollisionCache.get(regionId);
    if (cached) disposeRegionCollision(cached);
    this.regionCollisionCache.delete(regionId);
    this.regionCollisionBuildSeq.set(regionId, (this.regionCollisionBuildSeq.get(regionId) ?? 0) + 1);
  }

  private handleRegionPortal(player: PlayerState, targetRegionId: string, portalId?: string): void {
    if (player.dead) return;
    const currentRegionId = this.regionIdFromInstance(player.instanceId);

    if (currentRegionId) {
      const currentRegion = this.regionBlueprints.get(currentRegionId);
      if (!currentRegion) return;

      // Check inter-region portal links (player is world-space; links are local).
      if (currentRegion.portals) {
        const link = currentRegion.portals.find((p) => p.id === portalId || p.targetRegionId === targetRegionId);
        if (link) {
          const linkW = regionLocalToWorld(currentRegion, link.localX, link.localZ);
          if (dist2D(player.move.x, player.move.z, linkW.x, linkW.z) <= 8.0) {
            this.teleportToRegion(player, link.targetRegionId, link.targetLocalX, link.targetLocalZ);
            return;
          }
        }
      }

      // No "leave to overworld" — entryLocal is just a landmark now.
    }
  }

  /** Legacy interact id — redirect home instead of dumping to overworld. */
  private handleRegionLeave(player: PlayerState): void {
    const start = this.getStartingRegion();
    if (!start) return;
    if (this.regionIdFromInstance(player.instanceId) === start.id) return;
    this.teleportToRegion(player, start.id, start.entryLocal.x, start.entryLocal.z);
  }

  private teleportOutOfRegion(player: PlayerState, _regionId: string): void {
    if (player.lastRegionId && this.regionBlueprints.has(player.lastRegionId)) {
      const returnRegionId = player.lastRegionId;
      const targetX = player.lastRegionX;
      const targetZ = player.lastRegionZ;
      player.lastRegionId = undefined;
      this.teleportToRegion(player, returnRegionId, targetX, targetZ);
      return;
    }

    const startingRegion = this.getStartingRegion();
    if (startingRegion) {
      this.teleportToRegion(player, startingRegion.id, startingRegion.entryLocal.x, startingRegion.entryLocal.z);
    }
  }

  private sendRegionState(player: PlayerState, region: RegionBlueprint): void {
    this.sendTo(player.peer, { t: "regionState", inRegion: true, regionId: region.id, regionName: region.name });
    this.sendWorldEventsToPlayer(player, region.id);
  }

  private worldEventKey(regionId: string, eventId: string): string {
    return `${regionId}:${eventId}`;
  }

  private worldEventKeyForMob(mob: MobState): string | null {
    if (!mob.eventId || !mob.instanceId?.startsWith("region_")) return null;
    const regionId = mob.instanceId.slice("region_".length);
    return this.worldEventKey(regionId, mob.eventId);
  }

  private tickWorldEvents(now: number): void {
    for (const rt of this.worldEvents.values()) {
      decayParticipation(rt, now);

      // Count players in radius for this region instance.
      let count = 0;
      for (const player of this.players.values()) {
        if (player.dead) continue;
        if (player.instanceId !== rt.instanceId) continue;
        if (eventDist2(player.move.x, player.move.z, rt.def.localX, rt.def.localZ) > rt.def.radius) continue;
        count++;
        markInRadius(rt, player.id, now);
      }
      if (count !== rt.playerCount) {
        rt.playerCount = count;
        rt.dirty = true;
      }

      if (
        (rt.phase === "success" || rt.phase === "failed") &&
        rt.phaseHoldUntil != null &&
        now >= rt.phaseHoldUntil
      ) {
        rt.phase = "cooldown";
        rt.phaseHoldUntil = null;
        rt.scores.clear();
        rt.dirty = true;
        continue;
      }

      if (rt.phase === "cooldown" && now >= rt.nextActiveAt) {
        this.startWorldEvent(rt, now);
        continue;
      }

      if (rt.phase === "active") {
        this.scaleWorldEventMobs(rt);
        // Prune dead mob ids from the set.
        for (const id of [...rt.mobIds]) {
          const mob = this.mobs.get(id);
          if (!mob || mob.hp <= 0) rt.mobIds.delete(id);
        }
        const bossDead = !rt.bossMobId || !rt.mobIds.has(rt.bossMobId);
        const waveClear = rt.mobIds.size === 0;
        const success = rt.def.bossType ? bossDead && waveClear : waveClear;
        if (success) {
          this.completeWorldEvent(rt, now, true);
          continue;
        }
        if (rt.endsAt != null && now >= rt.endsAt) {
          this.completeWorldEvent(rt, now, false);
        }
      }
    }
  }

  private startWorldEvent(rt: WorldEventRuntime, now: number): void {
    const region = this.regionBlueprints.get(rt.regionId);
    if (!region) return;
    this.despawnWorldEventMobs(rt);

    const scale = computeEventScale(rt.def.difficulty, Math.max(1, rt.playerCount));
    rt.lastScale = scale;
    rt.mobIds.clear();
    rt.bossMobId = null;
    rt.scores.clear();

    const types = rt.def.mobTypes.length > 0 ? rt.def.mobTypes : ["wolf"];
    const spawnCount = Math.min(8, Math.max(types.length, 3));
    for (let i = 0; i < spawnCount; i++) {
      const type = types[i % types.length]!;
      const ang = (i / spawnCount) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 4 + Math.random() * Math.max(4, rt.def.radius * 0.35);
      const x = rt.def.localX + Math.cos(ang) * dist;
      const z = rt.def.localZ + Math.sin(ang) * dist;
      const id = this.spawnWorldEventMob(rt, region, type, x, z, scale);
      rt.mobIds.add(id);
    }
    if (rt.def.bossType) {
      const id = this.spawnWorldEventMob(rt, region, rt.def.bossType, rt.def.localX, rt.def.localZ, scale * 1.15);
      rt.mobIds.add(id);
      rt.bossMobId = id;
    }

    rt.phase = "active";
    rt.endsAt = now + Math.max(60, rt.def.durationSec ?? 600) * 1000;
    rt.phaseHoldUntil = null;
    rt.dirty = true;
  }

  private spawnWorldEventMob(
    rt: WorldEventRuntime,
    region: RegionBlueprint,
    type: string,
    x: number,
    z: number,
    scale: number,
  ): string {
    const def = mobDef(type);
    const y = sampleRegionHeight(region, x, z);
    const id = `wevt_${rt.regionId}_${rt.def.id}_${this.tickCount}_${Math.floor(Math.random() * 1e6)}`;
    this.mobs.set(id, {
      id,
      type,
      x,
      y,
      z,
      yaw: Math.random() * Math.PI * 2,
      hp: def.maxHp * scale,
      homeX: x,
      homeZ: z,
      targetId: null,
      attackReadyAt: 0,
      respawnAt: Infinity, // event mobs never respawn on the normal timer
      wanderTx: x,
      wanderTz: z,
      nextWanderAt: 0,
      actionAnimUntil: 0,
      activeAuras: [],
      threat: new Map(),
      instanceId: rt.instanceId,
      hpMult: scale,
      dmgMult: scale,
      eventId: rt.def.id,
    });
    return id;
  }

  private scaleWorldEventMobs(rt: WorldEventRuntime): void {
    const scale = computeEventScale(rt.def.difficulty, Math.max(1, rt.playerCount));
    if (Math.abs(scale - rt.lastScale) < 0.05) return;
    const ratio = scale / Math.max(0.01, rt.lastScale);
    for (const id of rt.mobIds) {
      const mob = this.mobs.get(id);
      if (!mob || mob.hp <= 0) continue;
      const def = mobDef(mob.type);
      mob.hpMult = scale;
      mob.dmgMult = scale;
      const newMax = def.maxHp * scale;
      mob.hp = Math.min(newMax, Math.max(1, mob.hp * ratio));
    }
    rt.lastScale = scale;
    rt.dirty = true;
  }

  private despawnWorldEventMobs(rt: WorldEventRuntime): void {
    for (const id of rt.mobIds) {
      this.mobs.delete(id);
    }
    rt.mobIds.clear();
    rt.bossMobId = null;
  }

  private completeWorldEvent(rt: WorldEventRuntime, now: number, success: boolean): void {
    if (success) {
      rt.phase = "success";
      for (const [playerId, part] of rt.scores) {
        const tier = tierForScore(part.score);
        if (!tier) continue;
        const player = this.players.get(playerId);
        if (!player || player.instanceId !== rt.instanceId) continue;
        const rewards = rollEventRewards(tier, rt.def.lootAmount);
        for (const r of rewards) {
          addItem(player.inventory, r.itemId, r.qty);
          this.sendEvent(player, { t: "event", kind: "loot", itemId: r.itemId, amount: r.qty });
        }
        const xpGain = Math.round((tier === "gold" ? 80 : tier === "silver" ? 45 : 20) * rt.def.lootAmount);
        this.grantXp(player, xpGain);
        this.sendTo(player.peer, {
          t: "chat",
          channel: "system",
          from: "system",
          text: `${rt.def.name} complete — ${tier.toUpperCase()} rewards!`,
        });
        this.bumpAchievementCounter(player, "world_event", rt.def.id, 1);
        this.sendInventory(player);
        player.dirty = true;
      }
    } else {
      rt.phase = "failed";
    }
    this.despawnWorldEventMobs(rt);
    rt.endsAt = null;
    rt.nextActiveAt = now + Math.round(cooldownMs(rt.def.frequencyMin) * (success ? 1 : 0.65));
    // Hold success/fail on clients briefly, then cooldown starts at nextActiveAt - frequency.
    rt.phaseHoldUntil = now + 4000;
    rt.dirty = true;
  }

  private broadcastWorldEventStates(): void {
    for (const player of this.players.values()) {
      const regionId = this.regionIdFromInstance(player.instanceId);
      if (!regionId) continue;
      this.sendWorldEventsToPlayer(player, regionId);
    }
    for (const rt of this.worldEvents.values()) rt.dirty = false;
  }

  private sendWorldEventsToPlayer(player: PlayerState, regionId: string): void {
    const events = [];
    for (const rt of this.worldEvents.values()) {
      if (rt.regionId !== regionId) continue;
      events.push(snapshotWorldEvent(rt, player.id));
    }
    this.sendTo(player.peer, { t: "worldEventState", events });
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
    let power: number;
    if (type.nodeClass === "pick") {
      power = UNARMED_GATHER_POWER;
    } else {
      const heldPower = held ? itemDef(held.itemId).gatherPower?.[type.nodeClass] : undefined;
      // Hard-gated nodes (ore veins) require an actual matching tool -- bare
      // hands don't count, unlike wood/stone which can still be gathered
      // (slowly) unarmed. Without this, UNARMED_GATHER_POWER matching a
      // starter pickaxe's power let ore be mined with no tool at all.
      power = heldPower ?? (type.minPower !== undefined ? 0 : UNARMED_GATHER_POWER);
    }

    if (type.minPower !== undefined && power < type.minPower) {
      this.sendEvent(player, {
        t: "event",
        kind: "error",
        message: power === 0 ? "Requires a pickaxe" : "Requires a better pickaxe",
      });
      return;
    }

    player.gatherReadyAt = now + GATHER_COOLDOWN_S * 1000;
    this.setActionAnim(player, "gather");
    this.cancelCast(player);

    const remaining = (this.nodeHits.get(nodeId) ?? type.hits) - power;
    const gained = type.yieldPerHit * power;
    const overflow = addItem(player.inventory, type.yieldItem, gained);
    if (type.bonusYield && Math.random() < type.bonusYield.chance) {
      addItem(player.inventory, type.bonusYield.itemId, 1);
    }
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
    const region = this.regionBlueprintFor(player);
    if (!isNearWaterAt(player.move.x, player.move.y, player.move.z, region ?? undefined, WATER_PROXIMITY)) {
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
    const baseDamage = held ? (itemDef(held.itemId).damage ?? UNARMED_DAMAGE) : UNARMED_DAMAGE;
    const stats = this.computeStats(player);
    const roll = rollMeleeHit(stats.critChance);
    const damage = baseDamage * roll.mult * (1 + stats.masteryPct * 0.5);

    const { mob: bestMob, foe: bestFoe } = this.findMeleeTarget(player, MELEE_RANGE);
    if (!bestMob && !bestFoe) return;
    if (roll.outcome === "miss" || roll.outcome === "dodge") {
      const tx = bestMob?.x ?? bestFoe!.move.x;
      const ty = (bestMob?.y ?? bestFoe!.move.y) + 1;
      const tz = bestMob?.z ?? bestFoe!.move.z;
      const tid = bestMob?.id ?? bestFoe!.id;
      this.broadcastNear(
        tx,
        tz,
        {
          t: "event",
          kind: "damage",
          sourceId: player.id,
          targetId: tid,
          amount: 0,
          outcome: roll.outcome,
          x: tx,
          y: ty,
          z: tz,
        },
        player.instanceId,
      );
      return;
    }
    if (held && itemDef(held.itemId).maxDurability) damageDurability(player.inventory, held, 1);
    if (bestFoe) this.damagePlayer(bestFoe, damage, player.id, roll.outcome);
    else if (bestMob) this.damageMob(bestMob, damage, player, roll.outcome, 1, false);
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

    // Continent regions sit far outside the legacy overworld AABB — clamping
    // dodge to WORLD_* teleports fighters to the old map edge (other region).
    const inContinent = this.regionIdFromInstance(player.instanceId) !== null;
    const rawTx = player.move.x + nx * DODGE_DISTANCE;
    const rawTz = player.move.z + nz * DODGE_DISTANCE;
    const tx = inContinent ? rawTx : clamp(rawTx, WORLD_MIN_X, WORLD_MAX_X);
    const tz = inContinent ? rawTz : clamp(rawTz, WORLD_MIN_Z, WORLD_MAX_Z);
    player.move.x = tx;
    player.move.z = tz;
    player.move.y = inContinent
      ? this.continentGroundAt(tx, tz)
      : Math.max(player.move.y, terrainHeight(tx, tz));
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
    if (player.dead) return;
    this.dismountForCombat(player);
    if (!player.learnedSpells.includes(spellId)) {
      this.sendEvent(player, { t: "event", kind: "error", message: "Spell not learned" });
      return;
    }
    const spell = spellDef(spellId);
    if (spell.allowedWeaponTypes) {
      const weapon = findItem(player.inventory, "equip", 0);
      const weaponType = weapon ? itemDef(weapon.itemId).weaponType : undefined;
      if (!weaponType || !spell.allowedWeaponTypes.includes(weaponType)) {
        const need = spell.allowedWeaponTypes.map((t) => t[0]!.toUpperCase() + t.slice(1)).join(", ");
        this.sendEvent(player, { t: "event", kind: "error", message: `Requires: ${need}` });
        return;
      }
    }
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

    const triggersGcd = spellTriggersGcd(spell);
    const busyUntil = Math.max(player.casting?.endsAt ?? 0, triggersGcd ? player.gcdReadyAt : 0);
    if (player.casting || (triggersGcd && now < player.gcdReadyAt)) {
      // Spell queue window: buffer one ability to fire when cast/GCD ends.
      if (isInSpellQueueWindow(busyUntil, now) || busyUntil - now <= SPELL_QUEUE_WINDOW_MS) {
        player.spellQueue = { spellId, queuedAt: now };
        this.sendSelf(player);
      }
      return;
    }

    this.beginSpell(player, spell, now);
  }

  private beginSpell(player: PlayerState, spell: SpellDef, now: number): void {
    const stats = this.computeStats(player);
    const castMult = hasteTimeMult(stats.hastePct);
    const castMs = spell.castTimeS <= 0 ? 0 : spell.castTimeS * 1000 * castMult;

    if (castMs <= 0) {
      this.resolveSpell(player, spell);
      return;
    }
    player.casting = { spellId: spell.id, endsAt: now + castMs };
    this.setActionAnim(player, "cast", castMs);
    this.sendSelf(player);
    this.broadcastNear(
      player.move.x,
      player.move.z,
      { t: "event", kind: "castStart", sourceId: player.id, spellId: spell.id },
      player.instanceId,
    );
  }

  private cancelCast(player: PlayerState): void {
    if (!player.casting) return;
    player.casting = null;
    player.actionAnim = null;
    player.spellQueue = null;
    this.sendSelf(player);
  }

  private finishCast(player: PlayerState): void {
    const casting = player.casting!;
    player.casting = null;
    this.resolveSpell(player, spellDef(casting.spellId));
  }

  /** After a spell resolves (or GCD ends), fire the queued ability if ready. */
  private flushSpellQueue(player: PlayerState): void {
    const queued = player.spellQueue;
    if (!queued) return;
    const now = Date.now();
    if (now < player.gcdReadyAt || player.casting) return;
    player.spellQueue = null;
    // Re-validate through the normal entry (mana/CD/silence may have changed).
    this.handleCastStart(player, queued.spellId);
  }

  /** Deduct cost/cooldown/GCD, then resolve the spell per its targeting kind. */
  private resolveSpell(player: PlayerState, spell: SpellDef): void {
    const stats = this.computeStats(player);
    const now = Date.now();
    player.mana = clamp(player.mana - spell.resourceCost, 0, this.maxMana(player));
    const cdMult = hasteTimeMult(stats.hastePct);
    player.spellCooldowns.set(spell.id, now + spell.cooldownS * 1000 * cdMult);
    if (spellTriggersGcd(spell)) {
      player.gcdReadyAt = now + stats.gcdS * 1000;
    }
    player.dirty = true;

    if (spell.targeting.kind === "self") {
      this.applySpellEffects(player, null, spell.effects, spell);
      if (spell.summon) this.spawnPet(player, spell.summon.petType);
      this.setActionAnim(player, "attack");
      this.broadcastNear(
        player.move.x,
        player.move.z,
        { t: "event", kind: "spellHit", spellId: spell.id, sourceId: player.id, x: player.move.x, y: player.move.y + 1, z: player.move.z },
        player.instanceId,
      );
      this.sendSelf(player);
      this.flushSpellQueue(player);
      return;
    }

    if (spell.targeting.kind === "melee") {
      const target = this.findMeleeTarget(player, spell.targeting.range);
      if (target.mob || target.foe) this.applySpellEffects(player, target, spell.effects, spell);
      this.setActionAnim(player, "attack");
      this.broadcastNear(
        player.move.x,
        player.move.z,
        { t: "event", kind: "spellHit", spellId: spell.id, sourceId: player.id, x: player.move.x, y: player.move.y + 1, z: player.move.z },
        player.instanceId,
      );
      this.sendSelf(player);
      this.flushSpellQueue(player);
      return;
    }

    if (spell.targeting.kind === "aoe") {
      const r = spell.targeting.radius ?? 6;
      const healing = spell.effects.some((e) => e.type === "heal");
      if (healing) {
        // Allies (self + same party) within radius -- a damage aoe hits
        // enemies, so a heal aoe should hit friends instead of reusing the
        // same enemy-collection loop.
        this.applySpellEffects(player, { mob: null, foe: player }, spell.effects, spell);
        for (const other of this.players.values()) {
          if (other.id === player.id || !player.partyId || other.partyId !== player.partyId) continue;
          if (!this.sameInstance(player, other)) continue;
          if (dist2D(player.move.x, player.move.z, other.move.x, other.move.z) > r) continue;
          this.applySpellEffects(player, { mob: null, foe: other }, spell.effects, spell);
        }
      } else {
        // Every enemy in range takes the hit -- no single-best-match here,
        // unlike melee/projectile (which each resolve exactly one target).
        for (const mob of this.mobs.values()) {
          if (!this.sameInstance(player, mob)) continue;
          if (mob.respawnAt === null && dist2D(player.move.x, player.move.z, mob.x, mob.z) <= r) {
            this.applySpellEffects(player, { mob, foe: null }, spell.effects, spell);
          }
        }
        if (player.pvp) {
          for (const other of this.players.values()) {
            if (other.id === player.id || other.dead || !other.pvp) continue;
            if (!this.sameInstance(player, other)) continue;
            if (dist2D(player.move.x, player.move.z, other.move.x, other.move.z) > r) continue;
            this.applySpellEffects(player, { mob: null, foe: other }, spell.effects, spell);
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
      this.flushSpellQueue(player);
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
      threatMult: spell.threatMult ?? 1,
      speed: spell.targeting.projectileSpeed ?? 24,
      homingId,
      instanceId: player.instanceId,
    });
    this.sendSelf(player);
    this.flushSpellQueue(player);
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
      if (mob.hp <= 0 || mob.respawnAt !== null || !this.sameInstance(player, mob)) continue;
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
    if (mob && mob.hp > 0 && mob.respawnAt === null) return { x: mob.x, y: mob.y + 0.8, z: mob.z };
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

    // Recipe-based crafting: ingredients are pulled from the player's backpack
    // (main inventory + hotbar), matching the client UI which crafts straight
    // from a selected recipe -- there's no manual placement grid to fill. Work
    // on a copy so any failure leaves the real inventory untouched.
    const tempInv: InvItem[] = JSON.parse(JSON.stringify(player.inventory));
    const consumable = (it: InvItem): boolean => it.container === "inventory" || it.container === "hotbar";

    // Verify every ingredient is available in the required quantity.
    for (const ing of recipe.ingredients) {
      let have = 0;
      for (const it of tempInv) if (consumable(it) && it.itemId === ing.itemId) have += it.qty;
      if (have < ing.qty) {
        this.sendEvent(player, { t: "event", kind: "error", message: `Need ${ing.qty}× ${itemDef(ing.itemId).name}` });
        return;
      }
    }

    // Consume the ingredients.
    for (const ing of recipe.ingredients) {
      let remaining = ing.qty;
      for (let i = tempInv.length - 1; i >= 0 && remaining > 0; i--) {
        const item = tempInv[i]!;
        if (consumable(item) && item.itemId === ing.itemId) {
          const take = Math.min(item.qty, remaining);
          item.qty -= take;
          remaining -= take;
          if (item.qty <= 0) tempInv.splice(i, 1);
        }
      }
    }

    // Add the output (rolls back via tempInv if the backpack is full).
    const outputOverflow = addItem(tempInv, recipe.output, recipe.outputQty);
    if (outputOverflow > 0) {
      this.sendEvent(player, { t: "event", kind: "error", message: "Inventory full" });
      return;
    }

    player.inventory = tempInv;
    player.dirty = true;
    this.sendInventory(player);
    this.sendEvent(player, { t: "event", kind: "gather", itemId: recipe.output, amount: recipe.outputQty });
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

  /**
   * Fill empty default hotbar slots (attack on `1`, Heal on `Q`) without
   * overwriting slots the player already arranged.
   */
  private ensureStartingHotbar(player: PlayerState): void {
    const loadout = startingHotbarLoadout(classDef(player.classId));
    let changed = false;
    for (const { slot, spellId } of loadout) {
      if (!player.learnedSpells.includes(spellId)) continue;
      const marker = `spell:${spellId}`;
      if (player.inventory.some((it) => it.container === "hotbar" && it.itemId === marker)) continue;
      if (player.inventory.some((it) => it.container === "hotbar" && it.slot === slot)) continue;
      player.inventory.push({ container: "hotbar", slot, itemId: marker, qty: 1, durability: null });
      changed = true;
    }
    if (changed) player.dirty = true;
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

    const regionId = this.regionIdFromInstance(player.instanceId);
    if (regionId) {
      const region = this.regionBlueprints.get(regionId);
      if (region) {
        // Prefer a village in the region you died in (seam fights shouldn't
        // respawn you across the continent into a neighbor).
        const village = this.nearestVillageAt(player.move.x, player.move.z, regionId);
        const placed = this.placeInRegionAt(
          village.x + (Math.random() - 0.5) * 6,
          village.z + (Math.random() - 0.5) * 6,
        );
        player.instanceId = placed.instanceId;
        player.move = {
          x: placed.x,
          y: placed.y,
          z: placed.z,
          vy: 0,
          grounded: true,
        };
      } else {
        const placed = this.spawnInStartingRegion();
        player.instanceId = placed.instanceId;
        player.move = { x: placed.x, y: placed.y, z: placed.z, vy: 0, grounded: true };
      }
    } else if (player.instanceId) {
      const instance = this.dungeonInstances.get(player.instanceId);
      if (instance) {
        instance.wipedAt = null; // Clear the wipe/eject timer
        const layout = generateDungeonLayout(instance.portalId);
        player.move = {
          x: layout.entryPoint.x + (Math.random() - 0.5) * 3,
          y: layout.floorY + layout.spawnHeight + 0.1,
          z: layout.entryPoint.z + (Math.random() - 0.5) * 3,
          vy: 0,
          grounded: true,
        };
      } else {
        const placed = this.spawnInStartingRegion();
        player.instanceId = placed.instanceId;
        player.move = { x: placed.x, y: placed.y, z: placed.z, vy: 0, grounded: true };
      }
    } else {
      const village = this.nearestVillageAt(player.move.x, player.move.z);
      const placed = this.placeInRegionAt(
        village.x + (Math.random() - 0.5) * 6,
        village.z + (Math.random() - 0.5) * 6,
      );
      player.instanceId = placed.instanceId;
      player.move = { x: placed.x, y: placed.y, z: placed.z, vy: 0, grounded: true };
    }
    player.dirty = true;
    this.sendSelf(player);
    const rid = this.regionIdFromInstance(player.instanceId);
    const bp = rid ? this.regionBlueprints.get(rid) : undefined;
    if (bp) this.sendRegionState(player, bp);
  }

  private nearestGraveyard(x: number, z: number): { x: number; z: number } {
    return this.nearestVillageAt(x, z);
  }

  /** Closest region-authored village in world space (continent only).
   *  When `preferRegionId` is set, villages in that region win unless none exist. */
  private nearestVillageAt(
    x: number,
    z: number,
    preferRegionId?: string,
  ): { x: number; z: number } {
    const pick = (onlyId?: string): { x: number; z: number } | null => {
      let best: { x: number; z: number } | null = null;
      let bestDist = Infinity;
      for (const bp of this.regionBlueprints.values()) {
        if (onlyId && bp.id !== onlyId) continue;
        for (const v of bp.villages ?? []) {
          const world = regionLocalToWorld(bp, v.localX, v.localZ);
          const d = dist2D(x, z, world.x, world.z);
          if (d < bestDist) {
            bestDist = d;
            best = world;
          }
        }
      }
      return best;
    };

    const preferred = preferRegionId ? pick(preferRegionId) : null;
    if (preferred) return preferred;
    const any = pick();
    if (any) return any;

    const under =
      (preferRegionId ? this.regionBlueprints.get(preferRegionId) : null) ??
      findRegionAtWorld(this.regionBlueprints.values(), x, z) ??
      this.getStartingRegion();
    if (under) {
      return regionLocalToWorld(under, under.entryLocal.x, under.entryLocal.z);
    }
    return { x: 0, z: 0 };
  }

  // ============================ combat ============================

  private grantXp(player: PlayerState, amount: number, opts?: { skipAchievements?: boolean; deferSelf?: boolean }): void {
    if (player.level >= MAX_LEVEL || amount <= 0) return;
    player.xp += amount;
    this.sendEvent(player, { t: "event", kind: "xp", amount });
    let leveled = false;
    while (player.level < MAX_LEVEL && player.xp >= xpForLevel(player.level)) {
      player.xp -= xpForLevel(player.level);
      player.level += 1;
      player.hp = this.maxHp(player); // level-up heals
      player.mana = this.maxMana(player);
      player.statsCache = null;
      leveled = true;
      this.queueLevelReward(player, player.level);
      this.sendEvent(player, { t: "event", kind: "levelup", amount: player.level, x: player.move.x, y: player.move.y + 1, z: player.move.z });
      this.broadcastChat("system", `${player.name} reached level ${player.level}!`);
      this.setActionAnim(player, "cheer", 1800);
    }
    player.dirty = true;
    if (!opts?.deferSelf) this.sendSelf(player);
    if (leveled) this.sendLevelRewards(player);
    if (!opts?.skipAchievements) this.checkAndUnlockAchievements(player);
  }

  private queueLevelReward(player: PlayerState, level: number): void {
    const items = levelUpRewards(level);
    if (items.length === 0) return;
    const chest: LevelRewardChest = {
      id: `lr_${player.id}_${level}_${Date.now().toString(36)}`,
      level,
      items,
    };
    player.pendingLevelRewards.push(chest);
    this.sendEvent(player, {
      t: "event",
      kind: "levelReward",
      amount: level,
      message: `Level ${level} reward ready — open the chest!`,
    });
  }

  private sendLevelRewards(player: PlayerState): void {
    this.sendTo(player.peer, { t: "levelRewards", chests: player.pendingLevelRewards });
  }

  private handleClaimLevelReward(player: PlayerState, rewardId: string | null): void {
    if (player.pendingLevelRewards.length === 0) return;
    const idx = rewardId
      ? player.pendingLevelRewards.findIndex((c) => c.id === rewardId)
      : 0;
    if (idx < 0) return;
    const [chest] = player.pendingLevelRewards.splice(idx, 1);
    if (!chest) return;
    for (const item of chest.items) {
      const overflow = addItem(player.inventory, item.itemId, item.qty);
      const granted = item.qty - overflow;
      if (granted > 0) {
        this.sendEvent(player, { t: "event", kind: "loot", itemId: item.itemId, amount: granted });
      }
      if (overflow > 0) {
        this.sendEvent(player, {
          t: "event",
          kind: "error",
          message: `Inventory full — lost ${overflow}× ${item.itemId}`,
        });
      }
    }
    // Grant SoEC coins scaled by level (100c × level, so level 10 = 10s, level 50 = 5g)
    const coinBonus = chest.level * 100;
    player.coins += coinBonus;
    this.sendTo(player.peer, {
      t: "chat",
      channel: "system",
      from: "system",
      text: `🌟 Level-up bonus: +${this.formatCoinsText(coinBonus)} SoEC`,
    });
    player.dirty = true;
    this.invalidatePlayerCaches(player);
    this.sendInventory(player);
    this.sendSelf(player);
    this.sendLevelRewards(player);
  }

  /** Move every pending chest into inventory (used on logout). */
  private flushPendingLevelRewards(player: PlayerState): void {
    if (player.pendingLevelRewards.length === 0) return;
    for (const chest of player.pendingLevelRewards) {
      for (const item of chest.items) {
        addItem(player.inventory, item.itemId, item.qty);
      }
    }
    player.pendingLevelRewards = [];
  }

  private damagePlayer(
    player: PlayerState,
    rawAmount: number,
    sourceId: string,
    outcome: CombatOutcome = "hit",
  ): void {
    if (player.dead) return;
    // Spawn protection: no damage while the player is still loading its region
    // (until the client's `ready`, or the loadingUntil safety timeout). Prevents
    // dying in a hostile area before anything has rendered.
    if (player.loading) {
      if (Date.now() < player.loadingUntil) return;
      player.loading = false; // safety timeout elapsed -- treat as live
    }
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
      {
        t: "event",
        kind: "damage",
        sourceId,
        targetId: player.id,
        amount,
        outcome,
        x: player.move.x,
        y: player.move.y + 1.5,
        z: player.move.z,
      },
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
      for (const rNpc of this.activeRegionNpcs.values()) {
        if (rNpc.instanceId === player.instanceId && rNpc.activeQuestId) {
          if (player.questProgress.has(rNpc.activeQuestId)) {
            player.questProgress.delete(rNpc.activeQuestId);
            player.dirty = true;
            this.sendTo(player.peer, { t: "questLog", quests: this.questLogFor(player) });
          }
          this.handleEscortNpcDeath(rNpc);
        }
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
      else if (!player.casting && player.spellQueue && now >= player.gcdReadyAt) {
        this.flushSpellQueue(player);
      }
      if (player.actionAnim && now > player.actionAnimUntil) player.actionAnim = null;
    }

    this.tickProjectiles();
    this.streamRegionMobs();
    this.tickMobs(now);
    this.tickPets(now);
    this.tickNodeRespawns(now);
    this.tickEscortNpcs(TICK_DT);
    if (this.tickCount % 20 === 0) this.tickWorldEvents(now);

    // World snapshots at SNAPSHOT_RATE (10Hz). Self-ack still goes every tick
    // so client prediction / dodge ackSeq stays 20Hz without the fat AOI JSON.
    const snapEvery = Math.max(1, Math.round(TICK_RATE / SNAPSHOT_RATE));
    if (this.tickCount % snapEvery === 0) {
      this.sendSnapshots();
    } else {
      for (const player of this.players.values()) this.sendSelf(player);
    }
    // Party frames refresh at 0.5 Hz — enough for out-of-range member HP.
    if (this.tickCount % 40 === 0) {
      for (const partyId of this.parties.keys()) this.broadcastPartyState(partyId);
      this.broadcastRoster();
      this.tickDungeons(now);
      this.broadcastWorldEventStates();
    }
  }

  private tickPlayerMovement(player: PlayerState, now: number): void {
    if (player.dead) {
      player.inputQueue.length = 0;
      player.lastMoveMag = 0;
      return;
    }
    const inputs = player.inputQueue.splice(0, MAX_INPUTS_PER_TICK);
    const inDungeon = this.isDungeonInstance(player.instanceId);
    const regionId = this.regionIdFromInstance(player.instanceId);
    const inContinent = regionId !== null;
    const groundAt = inContinent ? (x: number, z: number) => this.continentGroundAt(x, z) : undefined;
    const waterDepthAt = inContinent ? (x: number, z: number) => this.continentWaterDepthAt(x, z) : undefined;
    const regionAssets = inContinent
      ? this.continentCollidersNear(player.move.x, player.move.z)
      : undefined;
    // Authoritative true-geometry (BVH) collision — reproduces the client's
    // capsule-vs-mesh result headless so meshed solids can't be walked through
    // and bridge decks are standable / passable-under. Uses the player's
    // current region BVH (built lazily, world-baked with its origin).
    const regionCol = inContinent && regionId ? this.getRegionCollision(regionId) : null;
    const meshResolve = regionCol
      ? (x: number, y: number, z: number) =>
          resolveCapsule(regionCol, x, y, z, {
            radius: PLAYER_BODY_RADIUS,
            height: GameServer.PLAYER_CAPSULE_HEIGHT,
          })
      : undefined;
    const meshGroundBelow = regionCol
      ? (x: number, z: number, fromY: number, maxDrop: number) =>
          sampleGroundBelow(regionCol, x, z, fromY, PLAYER_BODY_RADIUS, maxDrop)
      : undefined;
    // At a shared seam between two independently-sculpted regions the edge
    // heights can differ by many meters; without this the cliff guard in
    // stepMovement would treat every region border as a cliff and freeze the
    // player at the edge. Only a true region-to-region crossing lifts the
    // guard -- stepping into the void (no neighbor) still blocks.
    const crossesRegionSeam = inContinent
      ? (x0: number, z0: number, x1: number, z1: number) => {
          const a = findRegionAtWorld(this.regionBlueprints.values(), x0, z0);
          const b = findRegionAtWorld(this.regionBlueprints.values(), x1, z1);
          return a !== b;
        }
      : undefined;
    const moveOpts = {
      mount: player.mount,
      inDungeon,
      groundAt,
      waterDepthAt,
      regionAssets,
      meshResolve,
      meshGroundBelow,
      crossesRegionSeam,
    };
    if (inputs.length === 0) {
      // Keep physics ticking (falling, water) even without fresh input.
      player.move = stepMovement(
        player.move,
        {
          moveX: 0,
          moveZ: 0,
          jump: false,
          sprint: false,
          crouch: false,
          lookPitch: 0,
          ...moveOpts,
        },
        TICK_DT,
      );
      player.lastMoveMag = 0;
      if (inContinent) this.updateContinentZone(player);
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
        {
          moveX,
          moveZ,
          jump: input.jump,
          sprint: input.sprint,
          crouch: input.crouch,
          lookPitch: input.pitch,
          ...moveOpts,
        },
        TICK_DT,
      );
      player.lastAckSeq = input.seq;
      player.lastMoveMag = Math.hypot(moveX, moveZ);
    }
    if (inContinent) this.updateContinentZone(player);
    // Only the final queued input's intent matters here (same as yaw/
    // blocking above) -- re-evaluated every tick against the *current*
    // position, so releasing E, moving out of range, or the target no
    // longer being dead all naturally end the channel with no separate
    // cancel message needed.
    this.updateRevive(player, inputs[inputs.length - 1]!.revivingId, now);
    player.dirty = true;
  }

  /** When the player walks into a neighboring region's bounds, soft-switch
   *  ownership so UI/music/interest follow — coords stay world-space. */
  private updateContinentZone(player: PlayerState): void {
    const under = findRegionAtWorld(this.regionBlueprints.values(), player.move.x, player.move.z);
    if (!under) return;
    const cur = this.regionIdFromInstance(player.instanceId);
    if (cur !== under.id) this.seamlessEnterRegion(player, under);
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
    player.hunger = 100;
    player.thirst = 100;
    const manaMult = player.sitting !== null ? SIT_MANA_REGEN_MULT : 1;
    player.mana = clamp(player.mana + MANA_REGEN_PER_S * manaMult * TICK_DT, 0, this.maxMana(player));

    const region = this.regionBlueprintFor(player);
    const inContinent = this.regionIdFromInstance(player.instanceId) !== null;
    const underwater = isUnderwaterAt(
      player.move.x,
      player.move.y,
      player.move.z,
      inContinent ? undefined : region ?? undefined,
      inContinent ? (x, z) => this.continentGroundAt(x, z) : undefined,
      inContinent ? (x, z) => this.continentWaterDepthAt(x, z) : undefined,
    );
    if (underwater) {
      player.oxygen = clamp(player.oxygen - OXYGEN_DRAIN_PER_S * TICK_DT, 0, MAX_OXYGEN);
    } else {
      player.oxygen = clamp(player.oxygen + OXYGEN_REGEN_PER_S * TICK_DT, 0, MAX_OXYGEN);
    }

    if (!player.dead) {
      player.hp = clamp(player.hp + HP_REGEN_PER_S * TICK_DT, 0, this.maxHp(player));
    }

    if (!player.dead && underwater && player.oxygen <= 0) {
      player.hp -= DROWN_DPS * TICK_DT;
      if (player.hp <= 0) {
        player.hp = 0;
        player.dead = true;
        player.mount = null;
        this.sendEvent(player, { t: "event", kind: "death" });
        this.broadcastChat("system", `${player.name} drowned.`);
        if (player.instanceId) this.checkDungeonWipe(player.instanceId);
      }
    }
  }

  private tickProjectiles(): void {
    const HIT_R2 = 2.2 * 2.2;
    const toDelete: string[] = [];
    for (const proj of this.projectiles.values()) {
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
          proj.dx += (dirX / len - proj.dx) * MAX_TURN;
          proj.dy += (dirY / len - proj.dy) * MAX_TURN;
          proj.dz += (dirZ / len - proj.dz) * MAX_TURN;
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

      // Locked homing target: only test that entity (O(1) vs O(mobs)).
      if (proj.homingId) {
        const mob = this.mobs.get(proj.homingId);
        if (mob && mob.hp > 0 && mob.respawnAt === null && this.sameInstance(proj, mob)) {
          const dx = proj.x - mob.x;
          const dz = proj.z - mob.z;
          if (dx * dx + dz * dz < HIT_R2 && Math.abs(proj.y - (mob.y + 0.8)) < 4.5) {
            if (owner) this.applySpellEffects(owner, { mob, foe: null }, proj.effects, spellDef(proj.spellId));
            this.broadcastNear(
              proj.x,
              proj.z,
              { t: "event", kind: "spellHit", spellId: proj.spellId, x: proj.x, y: proj.y, z: proj.z },
              proj.instanceId,
            );
            hit = true;
          }
        } else if (owner?.pvp) {
          const other = this.players.get(proj.homingId);
          if (other && other.id !== proj.ownerId && !other.dead && other.pvp && this.sameInstance(proj, other)) {
            if (dist3D(proj.x, proj.y, proj.z, other.move.x, other.move.y + 1.2, other.move.z) < 1.7) {
              if (owner) this.applySpellEffects(owner, { mob: null, foe: other }, proj.effects, spellDef(proj.spellId));
              this.broadcastNear(
                proj.x,
                proj.z,
                { t: "event", kind: "spellHit", spellId: proj.spellId, x: proj.x, y: proj.y, z: proj.z },
                proj.instanceId,
              );
              hit = true;
            }
          }
        }
      } else {
        for (const mob of this.mobs.values()) {
          if (mob.hp <= 0 || mob.respawnAt !== null || !this.sameInstance(proj, mob)) continue;
          const dx = proj.x - mob.x;
          const dz = proj.z - mob.z;
          if (dx * dx + dz * dz >= HIT_R2) continue;
          if (Math.abs(proj.y - (mob.y + 0.8)) >= 4.5) continue;
          if (owner) this.applySpellEffects(owner, { mob, foe: null }, proj.effects, spellDef(proj.spellId));
          this.broadcastNear(
            proj.x,
            proj.z,
            { t: "event", kind: "spellHit", spellId: proj.spellId, x: proj.x, y: proj.y, z: proj.z },
            proj.instanceId,
          );
          hit = true;
          break;
        }
        // PvP: firebolts strike flagged players when the caster is flagged too.
        if (!hit && owner?.pvp) {
          for (const other of this.players.values()) {
            if (other.id === proj.ownerId || other.dead || !other.pvp) continue;
            if (!this.sameInstance(proj, other)) continue;
            if (dist3D(proj.x, proj.y, proj.z, other.move.x, other.move.y + 1.2, other.move.z) < 1.7) {
              if (owner) this.applySpellEffects(owner, { mob: null, foe: other }, proj.effects, spellDef(proj.spellId));
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
      }

      const groundHit = proj.y < terrainHeight(proj.x, proj.z);
      if (hit || groundHit || proj.traveled >= proj.maxRange) {
        toDelete.push(proj.id);
      }
    }
    for (const id of toDelete) this.projectiles.delete(id);
  }

  /**
   * Wake dormant region mobs near any player; put idle far-away region mobs
   * back to sleep. Combat / corpses stay awake so combat and loot don't vanish.
   */
  private streamRegionMobs(): void {
    if (this.dormantRegionMobs.size === 0 && this.mobs.size === 0) return;
    const wakeR = INTEREST_RADIUS + 40;
    const sleepR = INTEREST_RADIUS + 90;
    const wakeR2 = wakeR * wakeR;
    const sleepR2 = sleepR * sleepR;

    if (this.dormantRegionMobs.size > 0 && this.players.size > 0) {
      for (const [id, mob] of [...this.dormantRegionMobs]) {
        for (const player of this.players.values()) {
          if (player.dead) continue;
          if (!this.sameInstance(mob, player)) continue;
          const dx = mob.x - player.move.x;
          const dz = mob.z - player.move.z;
          if (dx * dx + dz * dz <= wakeR2) {
            this.dormantRegionMobs.delete(id);
            this.mobs.set(id, mob);
            break;
          }
        }
      }
    }

    // Sleep infrequently — every ~0.5s — so we don't thrash at the boundary.
    if (this.tickCount % 10 !== 0) return;
    for (const [id, mob] of [...this.mobs]) {
      if (!mob.instanceId?.startsWith("region_")) continue;
      if (mob.targetId || mob.hp <= 0 || mob.respawnAt !== null || mob.leashing) continue;
      let near = false;
      for (const player of this.players.values()) {
        if (player.dead) continue;
        if (!this.sameInstance(mob, player)) continue;
        const dx = mob.x - player.move.x;
        const dz = mob.z - player.move.z;
        if (dx * dx + dz * dz <= sleepR2) {
          near = true;
          break;
        }
      }
      if (!near) {
        this.mobs.delete(id);
        this.dormantRegionMobs.set(id, mob);
      }
    }
  }

  private tickMobs(now: number): void {
    for (const mob of this.mobs.values()) {
      const def = mobDef(mob.type);

      if (mob.respawnAt !== null) {
        if (mob.eventId && mob.hp <= 0) {
          const corpseAge = mob.deathAt ? now - mob.deathAt : 0;
          if (corpseAge > 30000) this.mobs.delete(mob.id);
          continue;
        }
        if (now >= mob.respawnAt) {
          mob.respawnAt = null;
          mob.hp = def.maxHp * mob.hpMult;
          mob.activeAuras = [];
          mob.x = mob.homeX;
          mob.z = mob.homeZ;
          mob.y = terrainHeight(mob.x, mob.z);
          mob.targetId = null;
          mob.loot = [];
          mob.deathAt = null;
        }
        continue;
      }

      if (mob.hp <= 0) {
        const corpseAge = mob.deathAt ? now - mob.deathAt : 0;
        if (mob.respawnAt === null && corpseAge > 30000) {
          mob.loot = [];
          mob.respawnAt = this.isDungeonInstance(mob.instanceId) ? Infinity : now + def.respawnS * 1000;
        } else if (mob.eventId && corpseAge > 30000) {
          this.mobs.delete(mob.id);
        }
        continue;
      }

      // Overworld / far idle: skip AI until someone is in interest range.
      if (!mob.targetId && !mob.leashing && !mob.instanceId?.startsWith("region_")) {
        let near = false;
        const r2 = (INTEREST_RADIUS + 40) * (INTEREST_RADIUS + 40);
        for (const player of this.players.values()) {
          if (player.dead) continue;
          if (!this.sameInstance(mob, player)) continue;
          const dx = mob.x - player.move.x;
          const dz = mob.z - player.move.z;
          if (dx * dx + dz * dz <= r2) {
            near = true;
            break;
          }
        }
        if (!near) continue;
      }

      this.tickMobAuras(mob, now);
      if (mob.respawnAt !== null) continue; // an aura DoT may have just killed it

      mob.moving = false;
      const distHome = dist2D(mob.x, mob.z, mob.homeX, mob.homeZ);

      // Acquire target (only if not currently leashing home)
      if (!mob.targetId && !mob.leashing) {
        // Priority 1: Active Escort NPC in range
        for (const [rNpcId, rNpc] of this.activeRegionNpcs) {
          if (rNpc.hp <= 0 || !rNpc.waypoints) continue;
          if (rNpc.instanceId !== mob.instanceId) continue;
          if (dist2D(mob.x, mob.z, rNpc.x, rNpc.z) < Math.max(14, def.aggroRange * 1.3)) {
            mob.targetId = `rnpc_${rNpcId}`;
            break;
          }
        }
        // Priority 2: Player in range
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
      }

      const target = mob.targetId ? this.mobTargetInfo(mob.targetId) : null;
      if (mob.targetId && (!target || target.dead || distHome > def.leashRange)) {
        mob.targetId = null;
        mob.leashing = true; // Player escaped or out of leash range
      }

      if (target && !target.dead && !mob.leashing) {
        // Chase / attack
        const d = dist2D(mob.x, mob.z, target.x, target.z);
        mob.yaw = turnToward(mob.yaw, Math.atan2(target.x - mob.x, target.z - mob.z), MOB_TURN_STEP);
        if (d > def.attackRange) {
          this.moveMob(mob, target.x, target.z, def.speed);
        } else if (now >= mob.attackReadyAt) {
          mob.attackReadyAt = now + def.attackCooldownS * 1000;
          mob.actionAnimUntil = now + ANIM_ACTION_MS;
          this.applyMobAttack(mob, mob.targetId!, def.damage * mob.dmgMult);
        }
      } else if (mob.leashing) {
        // Leashing back to home spawn point
        if (distHome > 1.5) {
          this.moveMob(mob, mob.homeX, mob.homeZ, def.speed * 1.1);
        } else {
          // Fully arrived back home -- restore health and exit leashing state
          mob.leashing = false;
          mob.hp = def.maxHp * mob.hpMult;
        }
      } else {
        // Peaceful wander around home spawn
        if (now >= mob.nextWanderAt) {
          const r = hash2(now & 0xffff, Math.round(mob.homeX), Math.round(mob.homeZ));
          const angle = r * Math.PI * 2;
          const radius = 3 + r * 6;
          mob.wanderTx = mob.homeX + Math.sin(angle) * radius;
          mob.wanderTz = mob.homeZ + Math.cos(angle) * radius;
          mob.nextWanderAt = now + 4000 + r * 6000;
        }
        if (dist2D(mob.x, mob.z, mob.wanderTx, mob.wanderTz) > 0.8) {
          this.moveMob(mob, mob.wanderTx, mob.wanderTz, def.wanderSpeed);
        }
      }
    }
  }

  /** Resolves a mob's targetId to whichever it actually is -- a player, a pet,
   *  or an escort NPC -- in one normalized shape. */
  private mobTargetInfo(id: string): { x: number; z: number; dead: boolean } | null {
    if (id.startsWith("rnpc_")) {
      const realId = id.slice(5);
      const rNpc = this.activeRegionNpcs.get(realId);
      if (rNpc) return { x: rNpc.x, z: rNpc.z, dead: rNpc.hp <= 0 };
    }
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
    if (targetId.startsWith("rnpc_")) {
      const realId = targetId.slice(5);
      const rNpc = this.activeRegionNpcs.get(realId);
      if (rNpc) {
        rNpc.hp = Math.max(0, rNpc.hp - Math.round(damage));
        this.broadcastNear(
          rNpc.x,
          rNpc.z,
          {
            t: "event",
            kind: "damage",
            sourceId: mob.id,
            targetId,
            amount: Math.round(damage),
            x: rNpc.x,
            y: rNpc.y + 1.5,
            z: rNpc.z,
          },
          rNpc.instanceId,
        );
        if (rNpc.hp <= 0) {
          this.handleEscortNpcDeath(rNpc);
        }
      }
      return;
    }
    const player = this.players.get(targetId);
    if (player) {
      this.damagePlayer(player, damage, mob.id);
      return;
    }
    const pet = this.pets.get(targetId);
    if (pet) this.damagePet(pet, damage, mob.id);
  }

  private handleEscortNpcDeath(rNpc: {
    id: string;
    activeQuestId?: string;
    instanceId: string;
    startX: number;
    startZ: number;
    hp: number;
    maxHp: number;
    waypoints?: any;
    currentWpIdx?: any;
    x: number;
    z: number;
  }): void {
    const qId = rNpc.activeQuestId;
    rNpc.hp = rNpc.maxHp;
    rNpc.x = rNpc.startX;
    rNpc.z = rNpc.startZ;
    rNpc.waypoints = undefined;
    rNpc.currentWpIdx = undefined;
    rNpc.activeQuestId = undefined;

    for (const player of this.players.values()) {
      if (player.instanceId === rNpc.instanceId) {
        if (qId && player.questProgress.has(qId)) {
          player.questProgress.delete(qId);
          player.dirty = true;
          this.sendTo(player.peer, { t: "questLog", quests: this.questLogFor(player) });
        }
        this.sendEvent(player, { t: "event", kind: "error", message: "Quest Failed: Escort NPC Perished" });
      }
    }
  }

  private tickEscortNpcs(dt: number): void {
    for (const rNpc of this.activeRegionNpcs.values()) {
      if (rNpc.hp <= 0 || !rNpc.waypoints || rNpc.currentWpIdx === undefined) continue;

      const wp = rNpc.waypoints[rNpc.currentWpIdx];
      if (!wp) continue;

      const dx = wp.x - rNpc.x;
      const dz = wp.z - rNpc.z;
      const dist = Math.hypot(dx, dz);

      if (dist > 0.5) {
        const speed = 3.2;
        const step = Math.min(dist, speed * dt);
        rNpc.x += (dx / dist) * step;
        rNpc.z += (dz / dist) * step;
      } else {
        rNpc.currentWpIdx++;
        if (rNpc.currentWpIdx >= rNpc.waypoints.length) {
          const qId = rNpc.activeQuestId;
          rNpc.waypoints = undefined;
          rNpc.currentWpIdx = undefined;
          rNpc.activeQuestId = undefined;

          if (qId) {
            for (const player of this.players.values()) {
              if (player.instanceId === rNpc.instanceId) {
                const entry = player.questProgress.get(qId);
                if (entry && entry.status === "active") {
                  this.handleQuestAction(player, "turnin", qId);
                }
              }
            }
          }
        }
      }
    }
  }

  /** Generates loot drops, awards XP, updates quests, and leaves mob corpse in the world. */
  private killMob(mob: MobState, killer: PlayerState): void {
    if (mob.hp <= 0 && mob.deathAt) return; // Guard against duplicate kills
    const def = mobDef(mob.type);
    mob.hp = 0;
    mob.targetId = null;
    mob.threat.clear();
    mob.deathAt = Date.now();
    mob.respawnAt = mob.eventId ? Infinity : null;

    mob.loot = [];
    if (!mob.eventId && def.loot) {
      for (const drop of def.loot) {
        if (drop.chance === undefined || Math.random() < drop.chance) {
          const qty = drop.min + Math.floor(Math.random() * (drop.max - drop.min + 1));
          if (qty > 0) {
            mob.loot.push({
              container: "inventory",
              slot: mob.loot.length,
              itemId: drop.itemId,
              qty,
              durability: itemDef(drop.itemId).maxDurability ?? null,
            });
          }
        }
      }
    }

    const xpGained = Math.round((def.xp ?? 20) * (mob.hpMult ?? 1));
    // Defer sendSelf — end-of-tick snapshots already push dirty self state.
    this.grantXp(killer, xpGained, { deferSelf: true });
    this.addQuestKillProgress(killer, mob.type);

    this.broadcastNear(
      mob.x,
      mob.z,
      { t: "event", kind: "death", sourceId: killer.id, targetId: mob.id, x: mob.x, y: mob.y, z: mob.z },
      mob.instanceId,
    );

    killer.dirty = true;
  }

  private damageMob(
    mob: MobState,
    amount: number,
    attacker: PlayerState,
    outcome: CombatOutcome = "hit",
    threatMult = 1,
    ranged = false,
  ): void {
    if (mob.hp <= 0) return;
    mob.hp -= amount;
    this.addThreat(mob, attacker.id, amount * threatMult, ranged);
    if (mob.eventId) {
      const key = this.worldEventKeyForMob(mob);
      const rt = key ? this.worldEvents.get(key) : undefined;
      if (rt) recordEventDamage(rt, attacker.id, mob.id, amount, Date.now());
    }
    this.broadcastNear(
      mob.x,
      mob.z,
      {
        t: "event",
        kind: "damage",
        sourceId: attacker.id,
        targetId: mob.id,
        amount,
        outcome,
        x: mob.x,
        y: mob.y + 1,
        z: mob.z,
      },
      mob.instanceId,
    );
    if (mob.hp <= 0) {
      this.killMob(mob, attacker);
    }
  }

  /** Accumulate threat and switch target when the challenger exceeds the lock ratio. */
  private addThreat(mob: MobState, attackerId: string, amount: number, ranged: boolean): void {
    if (!(amount > 0)) return;
    const next = (mob.threat.get(attackerId) ?? 0) + amount;
    mob.threat.set(attackerId, next);
    const currentId = mob.targetId;
    const currentThreat = currentId ? (mob.threat.get(currentId) ?? 0) : 0;
    if (shouldSwitchThreat(currentId, currentThreat, attackerId, next, ranged)) {
      mob.targetId = attackerId;
    }
  }

  private handleLootCorpse(player: PlayerState, mobId: string, slot: number | undefined, lootAll: boolean | undefined): void {
    if (player.dead) return;
    const mob = this.mobs.get(mobId);
    if (!mob || mob.hp > 0) return;
    const dist = dist2D(player.move.x, player.move.z, mob.x, mob.z);
    if (dist > 7.5) {
      this.sendEvent(player, { t: "event", kind: "error", message: "Too far from corpse" });
      return;
    }
    if (!mob.loot) mob.loot = [];

    if (lootAll) {
      const remainingLoot: InvItem[] = [];
      let anyTaken = false;
      for (const item of mob.loot) {
        const overflow = addItem(player.inventory, item.itemId, item.qty);
        const taken = item.qty - overflow;
        if (taken > 0) {
          anyTaken = true;
          this.sendEvent(player, { t: "event", kind: "loot", itemId: item.itemId, amount: taken });
        }
        if (overflow > 0) {
          remainingLoot.push({ ...item, qty: overflow });
        }
      }
      mob.loot = remainingLoot;
      if (anyTaken) {
        player.dirty = true;
        this.invalidatePlayerCaches(player);
        this.sendInventory(player);
      }

      if (mob.loot.length === 0) {
        const def = mobDef(mob.type);
        mob.deathAt = Date.now();
        mob.respawnAt = this.isDungeonInstance(mob.instanceId) ? Infinity : Date.now() + def.respawnS * 1000;
      } else if (anyTaken) {
        this.sendEvent(player, { t: "event", kind: "error", message: "Inventory full" });
      }
      this.sendTo(player.peer, { t: "corpseLoot", mobId: mob.id, mobType: mob.type, items: mob.loot });
      return;
    }

    if (slot !== undefined && slot >= 0 && slot < mob.loot.length) {
      const item = mob.loot[slot]!;
      const overflow = addItem(player.inventory, item.itemId, item.qty);
      const taken = item.qty - overflow;
      if (taken > 0) {
        this.sendEvent(player, { t: "event", kind: "loot", itemId: item.itemId, amount: taken });
        if (overflow > 0) {
          item.qty = overflow;
        } else {
          mob.loot.splice(slot, 1);
        }
        player.dirty = true;
        this.invalidatePlayerCaches(player);
        this.sendInventory(player);
      } else {
        this.sendEvent(player, { t: "event", kind: "error", message: "Inventory full" });
      }

      if (mob.loot.length === 0) {
        const def = mobDef(mob.type);
        mob.deathAt = Date.now();
        mob.respawnAt = this.isDungeonInstance(mob.instanceId) ? Infinity : Date.now() + def.respawnS * 1000;
      }
      this.sendTo(player.peer, { t: "corpseLoot", mobId: mob.id, mobType: mob.type, items: mob.loot });
      return;
    }

    this.sendTo(player.peer, { t: "corpseLoot", mobId: mob.id, mobType: mob.type, items: mob.loot });
  }

  /** Mirrors damageMob, but for a pet's attacker: aggro snaps to the pet
   *  (so the mob retaliates against it, not the owner) and kill credit
   *  (loot/xp/quest progress) goes to the pet's owner instead. */
  private damageMobFromPet(mob: MobState, amount: number, pet: PetState): void {
    if (mob.hp <= 0) return;
    mob.hp -= amount;
    mob.targetId = pet.id;
    const owner = this.players.get(pet.ownerId);
    if (owner) this.addThreat(mob, owner.id, amount, false);
    this.broadcastNear(
      mob.x,
      mob.z,
      {
        t: "event",
        kind: "damage",
        sourceId: pet.id,
        targetId: mob.id,
        amount,
        outcome: "hit",
        x: mob.x,
        y: mob.y + 1,
        z: mob.z,
      },
      mob.instanceId,
    );
    if (mob.hp <= 0) {
      if (owner) {
        this.killMob(mob, owner);
      } else {
        const def = mobDef(mob.type);
        mob.respawnAt = this.isDungeonInstance(mob.instanceId) ? Infinity : Date.now() + def.respawnS * 1000;
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
   *  steps toward a target each tick, so the type only needs those fields.
   *  `moving`/`activeAuras` stay optional since PetState tracks neither
   *  (pet anim is derived from actionAnimUntil/targetId/following instead,
   *  and pets don't currently carry auras). */
  private moveMob(
    mob: { x: number; y: number; z: number; yaw: number; instanceId: string | null; moving?: boolean; activeAuras?: ActiveAura[] },
    tx: number,
    tz: number,
    speed: number,
  ): void {
    if (mob.activeAuras && mob.activeAuras.length > 0) {
      speed *= moveSpeedMultFromAuras(mob.activeAuras);
    }
    if (speed <= 0) return;
    const dx = tx - mob.x;
    const dz = tz - mob.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    mob.moving = true;
    const step = Math.min(speed * TICK_DT, d);
    const nx = mob.x + (dx / d) * step;
    const nz = mob.z + (dz / d) * step;

    let ny: number | null;
    const regionId = this.regionIdFromInstance(mob.instanceId);
    if (regionId) {
      // Continent mobs live in world space — sample across neighboring regions.
      ny = this.continentGroundAt(nx, nz);
    } else if (mob.instanceId !== null) {
      ny = dungeonFloorHeightAt(nx, nz);
      if (ny === null) return; // Block mobs from clipping walls
      if (Math.abs(ny - mob.y) > 1.5) return; // Block steep jumps
    } else {
      ny = dungeonFloorHeightAt(nx, nz) ?? terrainHeight(nx, nz);
      if (ny < WATER_LEVEL - 0.2) return; // wolves won't swim
    }

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
   *  equipped gear + active auras. Cached until inventory/aura/level changes. */
  private invalidatePlayerCaches(player: PlayerState): void {
    player.statsCache = null;
    player.gearCache = null;
  }

  private computeStats(player: PlayerState) {
    if (player.statsCache) return player.statsCache;
    const gearMods = EQUIP_SLOTS.map((_, slot) => findItem(player.inventory, "equip", slot))
      .filter((it): it is InvItem => !!it)
      .map((it) => itemDef(it.itemId).statModifiers ?? {});
    const auraMods = aggregateAuraModifiers(player.activeAuras);
    player.statsCache = computeActorStats(classDef(player.classId).baseStats, player.level, gearMods, auraMods);
    return player.statsCache;
  }

  private maxHp(player: PlayerState): number {
    return this.computeStats(player).maxHp;
  }

  private maxMana(player: PlayerState): number {
    return this.computeStats(player).maxMana;
  }

  private playerGearSnap(player: PlayerState): NonNullable<PlayerState["gearCache"]> {
    if (player.gearCache && player.gearCache.selectedSlot === player.selectedSlot) {
      return player.gearCache;
    }
    const prev = player.gearCache;
    const heldItem = findItem(player.inventory, "hotbar", player.selectedSlot);
    const gear = {
      weaponId: findItem(player.inventory, "equip", 0)?.itemId ?? null,
      heldItemId: heldItem && !heldItem.itemId.startsWith("spell:") ? heldItem.itemId : null,
      headId: findItem(player.inventory, "equip", EQUIP_SLOTS.indexOf("head"))?.itemId ?? null,
      chestId: findItem(player.inventory, "equip", EQUIP_SLOTS.indexOf("chest"))?.itemId ?? null,
      armsId: findItem(player.inventory, "equip", EQUIP_SLOTS.indexOf("arms"))?.itemId ?? null,
      legsId: findItem(player.inventory, "equip", EQUIP_SLOTS.indexOf("legs"))?.itemId ?? null,
      feetId: findItem(player.inventory, "equip", EQUIP_SLOTS.indexOf("feet"))?.itemId ?? null,
      shouldersId: findItem(player.inventory, "equip", EQUIP_SLOTS.indexOf("shoulders"))?.itemId ?? null,
      neckId: findItem(player.inventory, "equip", EQUIP_SLOTS.indexOf("neck"))?.itemId ?? null,
      selectedSlot: player.selectedSlot,
    };
    // gearCache gets invalidated for reasons that don't touch equip slots
    // (loot pickup, aura ticks) -- only bump the version viewers key off of
    // when a gear/held-item id actually differs from what was here before.
    if (
      !prev ||
      prev.weaponId !== gear.weaponId ||
      prev.heldItemId !== gear.heldItemId ||
      prev.headId !== gear.headId ||
      prev.chestId !== gear.chestId ||
      prev.armsId !== gear.armsId ||
      prev.legsId !== gear.legsId ||
      prev.feetId !== gear.feetId ||
      prev.shouldersId !== gear.shouldersId ||
      prev.neckId !== gear.neckId
    ) {
      player.gearVersion++;
    }
    player.gearCache = gear;
    return gear;
  }

  /** Expire auras and resolve any due periodic ticks (DoT/HoT) for a player. */
  private tickPlayerAuras(player: PlayerState, now: number): void {
    const beforeLen = player.activeAuras.length;
    player.activeAuras = expireAuras(player.activeAuras, now);
    if (player.activeAuras.length !== beforeLen) this.invalidatePlayerCaches(player);
    const due = collectDueTicks(player.activeAuras, now);
    if (due.length === 0) return;
    this.invalidatePlayerCaches(player);
    const stats = this.computeStats(player);
    for (const { tick } of due) {
      const amount = (tick.base ?? 0) + stats.power * (tick.powerScale ?? 0);
      if (tick.type === "damage") this.damagePlayer(player, amount, "aura");
      else player.hp = Math.min(this.maxHp(player), player.hp + amount);
    }
    player.dirty = true;
    // Self HP is already pushed every tick via sendSelf — avoid a duplicate WS frame.
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
      if (mob.hp <= 0 || mob.deathAt !== null || mob.respawnAt !== null || !this.sameInstance(player, mob)) continue;
      const d = dist2D(player.move.x, player.move.z, mob.x, mob.z);
      if (d > range + 1.2 || Math.abs(player.move.y - mob.y) > 4.5 || !inCone(mob.x, mob.z)) continue;
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
    spell?: SpellDef,
  ): void {
    const stats = this.computeStats(caster);
    const now = Date.now();
    const threatMult = spell?.threatMult ?? 1;
    const ranged = spell?.targeting.kind === "projectile" || spell?.targeting.kind === "aoe";
    const isMeleeAbility = spell?.targeting.kind === "melee";

    for (const effect of effects) {
      const landsOnCaster = effect.landsOn === "caster";
      if (effect.type === "damage") {
        if (landsOnCaster) continue; // damage always needs a real target
        let amount = (effect.base ?? 0) + stats.power * (effect.powerScale ?? 0);
        amount *= 1 + stats.masteryPct * 0.35;
        if (effect.executeScale) {
          const targetMaxHp = target?.mob ? mobDef(target.mob.type).maxHp : target?.foe ? this.maxHp(target.foe) : null;
          const targetHp = target?.mob ? target.mob.hp : (target?.foe?.hp ?? null);
          if (targetMaxHp && targetHp !== null) {
            const missingFrac = 1 - clamp(targetHp / targetMaxHp, 0, 1);
            amount *= 1 + effect.executeScale * missingFrac;
          }
        }

        // Melee abilities use the single-roll table; spells use two-roll.
        const roll = isMeleeAbility
          ? rollMeleeHit(stats.critChance)
          : rollSpellHit(stats.hitChance, stats.critChance);
        if (roll.outcome === "miss" || roll.outcome === "dodge") {
          const tx = target?.mob?.x ?? target?.foe?.move.x ?? caster.move.x;
          const ty = (target?.mob?.y ?? target?.foe?.move.y ?? caster.move.y) + 1;
          const tz = target?.mob?.z ?? target?.foe?.move.z ?? caster.move.z;
          const tid = target?.mob?.id ?? target?.foe?.id;
          this.broadcastNear(
            tx,
            tz,
            {
              t: "event",
              kind: "damage",
              sourceId: caster.id,
              targetId: tid,
              amount: 0,
              outcome: roll.outcome,
              spellId: spell?.id,
              x: tx,
              y: ty,
              z: tz,
            },
            caster.instanceId,
          );
          continue;
        }
        amount *= roll.mult;

        if (target?.mob) this.damageMob(target.mob, amount, caster, roll.outcome, threatMult, ranged);
        else if (target?.foe) this.damagePlayer(target.foe, amount, caster.id, roll.outcome);
        if (effect.lifestealPct && roll.mult > 0) {
          caster.hp = Math.min(this.maxHp(caster), caster.hp + amount * effect.lifestealPct);
          caster.dirty = true;
          this.sendSelf(caster);
        }
      } else if (effect.type === "heal") {
        const healTarget = landsOnCaster ? caster : (target?.foe ?? null);
        if (!healTarget) continue;
        const healRoll = rollSpellHit(stats.hitChance, stats.critChance);
        if (healRoll.outcome === "miss") continue;
        const rawAmount =
          ((effect.base ?? 0) + stats.power * (effect.powerScale ?? 0)) *
          (1 + stats.masteryPct * 0.35) *
          healRoll.mult;
        // A self-heal with an active pet out splits its pool between the two
        // instead of stacking a free splash heal on top of the usual amount.
        const pet = landsOnCaster ? this.findPetByOwner(caster.id) : undefined;
        const amount = pet ? rawAmount * 0.65 : rawAmount;
        healTarget.hp = Math.min(this.maxHp(healTarget), healTarget.hp + amount);
        healTarget.dirty = true;
        this.broadcastNear(
          healTarget.move.x,
          healTarget.move.z,
          {
            t: "event",
            kind: "heal",
            sourceId: caster.id,
            targetId: healTarget.id,
            amount,
            outcome: healRoll.outcome,
            x: healTarget.move.x,
            y: healTarget.move.y + 1.5,
            z: healTarget.move.z,
          },
          healTarget.instanceId,
        );
        if (healTarget !== caster) this.sendSelf(healTarget);
        // Healing threat: sprinkle onto nearby engaged mobs.
        const healThreat = amount * (spell?.threatMult ?? HEAL_THREAT_FRAC);
        if (healThreat > 0) {
          for (const mob of this.mobs.values()) {
            if (mob.hp <= 0 || mob.respawnAt !== null || !this.sameInstance(caster, mob)) continue;
            if (dist2D(caster.move.x, caster.move.z, mob.x, mob.z) > 30) continue;
            if (mob.targetId) this.addThreat(mob, caster.id, healThreat, true);
          }
        }
        if (pet) {
          const petAmount = rawAmount * 0.35;
          pet.hp = Math.min(mobDef(pet.type).maxHp, pet.hp + petAmount);
          this.broadcastNear(
            pet.x,
            pet.z,
            {
              t: "event",
              kind: "heal",
              sourceId: caster.id,
              targetId: pet.id,
              amount: petAmount,
              outcome: healRoll.outcome,
              x: pet.x,
              y: pet.y + 1.5,
              z: pet.z,
            },
            pet.instanceId,
          );
        }
        // Also heal nearby active Escort NPCs in the same instance
        for (const [rNpcId, rNpc] of this.activeRegionNpcs) {
          if (rNpc.hp > 0 && rNpc.hp < rNpc.maxHp && rNpc.instanceId === caster.instanceId) {
            if (dist2D(caster.move.x, caster.move.z, rNpc.x, rNpc.z) <= 12) {
              const healAmt = Math.round(amount * 0.8);
              rNpc.hp = Math.min(rNpc.maxHp, rNpc.hp + healAmt);
              this.broadcastNear(
                rNpc.x,
                rNpc.z,
                {
                  t: "event",
                  kind: "heal",
                  sourceId: caster.id,
                  targetId: `rnpc_${rNpcId}`,
                  amount: healAmt,
                  outcome: healRoll.outcome,
                  x: rNpc.x,
                  y: rNpc.y + 1.5,
                  z: rNpc.z,
                },
                caster.instanceId,
              );
            }
          }
        }
      } else if (effect.type === "applyAura" && effect.auraId) {
        if (landsOnCaster) {
          caster.activeAuras = applyAura(caster.activeAuras, effect.auraId, caster.id, now);
          this.invalidatePlayerCaches(caster);
        } else if (target?.mob) {
          target.mob.activeAuras = applyAura(target.mob.activeAuras, effect.auraId, caster.id, now);
        } else if (target?.foe) {
          target.foe.activeAuras = applyAura(target.foe.activeAuras, effect.auraId, caster.id, now);
          this.invalidatePlayerCaches(target.foe);
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
    const region = this.regionBlueprintFor(player);
    const inContinent = this.regionIdFromInstance(player.instanceId) !== null;
    if (
      isSwimmingAt(
        player.move.x,
        player.move.y,
        player.move.z,
        inContinent ? undefined : region ?? undefined,
        inContinent ? (x, z) => this.continentGroundAt(x, z) : undefined,
        inContinent ? (x, z) => this.continentWaterDepthAt(x, z) : undefined,
      )
    ) {
      return "swim";
    }
    if (player.lastMoveMag > 0.1) return "run";
    return "idle";
  }

  private regionBlueprintFor(player: PlayerState): RegionBlueprint | null {
    const regionId = this.regionIdFromInstance(player.instanceId);
    if (!regionId) return null;
    return this.regionBlueprints.get(regionId) ?? null;
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
      oxygen: player.oxygen,
      xp: player.xp,
      xpNext: xpForLevel(player.level),
      level: player.level,
      coins: player.coins,
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
      gcdReadyAt: player.gcdReadyAt,
      queuedSpellId: player.spellQueue?.spellId ?? null,
      dodgeCharges: player.dodgeCharges,
      dodgeNextChargeAt: player.dodgeChargeQueue[0] ?? null,
    };
  }

  /** Aura ids worth showing as floating debuffs / 3D effects on an entity --
   *  all negative debuffs (DoTs, freezes, slows, roots). */
  private dotDebuffs(auras: ActiveAura[]): string[] {
    return auras.filter((a) => !auraDef(a.auraId).positive).map((a) => a.auraId);
  }

  private sendSnapshots(): void {
    const now = Date.now();
    const allPlayers = [...this.players.values()];
    // Proximity grids, rebuilt fresh once per tick (not per viewer) -- see
    // buildProximityGrid()'s doc comment. Each viewer's candidate lists below
    // are still run through the exact sameInstance + dist2D checks that were
    // already here; the grid only shrinks what gets checked, it never
    // changes which entities end up in a snapshot.
    const playerGrid = this.buildProximityGrid(allPlayers, (p) => p.instanceId, (p) => ({ x: p.move.x, z: p.move.z }));
    const mobGrid = this.buildProximityGrid([...this.mobs.values()], (m) => m.instanceId, (m) => ({ x: m.x, z: m.z }));
    const petGrid = this.buildProximityGrid([...this.pets.values()], (p) => p.instanceId, (p) => ({ x: p.x, z: p.z }));
    const projectileGrid = this.buildProximityGrid([...this.projectiles.values()], (p) => p.instanceId, (p) => ({ x: p.x, z: p.z }));
    for (const viewer of allPlayers) {
      const px = viewer.move.x;
      const pz = viewer.move.z;

      const players: PlayerSnap[] = [];
      // Name/appearance/gear are the bulk of PlayerSnap's fields but almost
      // never change tick-to-tick -- appearance is fixed for a character's
      // lifetime and gear only moves on equip. Track what this specific
      // viewer already has cached client-side and omit anything unchanged
      // instead of resending it every 100ms for every visible player.
      //
      // Rebuilt fresh each tick (not mutated in place) containing only THIS
      // tick's visible targets: a player who drops out of interest radius
      // even briefly is gone from next tick's map, so if they re-enter they
      // read back as "first sight" again. That has to match the client's own
      // despawn threshold (entities.ts's DESPAWN_AFTER_MS) -- once a target
      // stops appearing in snapshots for >1.2s the client disposes its
      // RemoteEntity entirely, so re-sending stale "unchanged" gear/
      // appearance to a client that already forgot everything would leave it
      // stuck with an unnamed, bare-appearance ghost.
      const prevCosmetics = this.lastSentPlayerCosmetics.get(viewer.id);
      const nextCosmetics = new Map<string, number>();
      this.lastSentPlayerCosmetics.set(viewer.id, nextCosmetics);
      for (const other of this.gridCandidates(playerGrid, viewer.instanceId, px, pz)) {
        if (!this.sameInstance(viewer, other)) continue;
        if (dist2D(px, pz, other.move.x, other.move.z) > INTEREST_RADIUS) continue;
        const gear = this.playerGearSnap(other);
        const prevVersion = prevCosmetics?.get(other.id);
        const isFirstSight = prevVersion === undefined;
        const gearChanged = isFirstSight || prevVersion !== other.gearVersion;
        nextCosmetics.set(other.id, other.gearVersion);

        const snap: PlayerSnap = {
          id: other.id,
          x: other.move.x,
          y: other.move.y,
          z: other.move.z,
          yaw: other.yaw,
          hp: other.hp,
          maxHp: this.maxHp(other),
          anim: this.playerAnim(other),
          pvp: other.pvp,
          mount: other.mount,
          debuffs: this.dotDebuffs(other.activeAuras),
        };
        if (isFirstSight) {
          snap.name = other.name;
          snap.classId = other.classId;
          snap.gender = other.gender;
          snap.hairStyle = other.hairStyle;
          snap.facialHair = other.facialHair;
          snap.hairColor = other.hairColor;
          snap.eyeColor = other.eyeColor;
          snap.outfitHue = other.outfitHue;
        }
        if (gearChanged) {
          snap.weaponId = gear.weaponId;
          snap.heldItemId = gear.heldItemId;
          snap.headId = gear.headId;
          snap.chestId = gear.chestId;
          snap.armsId = gear.armsId;
          snap.legsId = gear.legsId;
          snap.feetId = gear.feetId;
          snap.shouldersId = gear.shouldersId;
          snap.neckId = gear.neckId;
        }
        players.push(snap);
      }

      const mobs: MobSnap[] = [];
      for (const mob of this.gridCandidates(mobGrid, viewer.instanceId, px, pz)) {
        if (!this.sameInstance(viewer, mob)) continue;
        if (dist2D(px, pz, mob.x, mob.z) > INTEREST_RADIUS) continue;
        const def = mobDef(mob.type);
        const isDead = mob.hp <= 0;
        if (isDead) {
          const corpseAge = mob.deathAt ? now - mob.deathAt : 0;
          if (mob.respawnAt !== null && (!mob.loot || mob.loot.length === 0) && corpseAge > 10000) continue;
        }
        mobs.push({
          id: mob.id,
          type: mob.type,
          x: mob.x,
          y: mob.y,
          z: mob.z,
          yaw: mob.yaw,
          hp: mob.hp,
          maxHp: def.maxHp,
          anim: isDead ? "dead" : mob.actionAnimUntil > now ? "attack" : mob.moving ? "run" : "idle",
          debuffs: this.dotDebuffs(mob.activeAuras),
          lootable: isDead && (mob.loot?.length ?? 0) > 0,
        });
      }

      const pets: PetSnap[] = [];
      for (const pet of this.gridCandidates(petGrid, viewer.instanceId, px, pz)) {
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
      for (const proj of this.gridCandidates(projectileGrid, viewer.instanceId, px, pz)) {
        if (!this.sameInstance(viewer, proj)) continue;
        if (dist2D(px, pz, proj.x, proj.z) > INTEREST_RADIUS) continue;
        projectiles.push({ id: proj.id, spellId: proj.spellId, x: proj.x, y: proj.y, z: proj.z });
      }

      // NPCs (village quest givers) only ever exist in the open world. Left
      // exactly as-is (not routed through the grid) -- see partitionKey()'s
      // doc comment: no connected player is ever actually instanceId===null,
      // so this condition never fires in practice today, which is a
      // pre-existing oddity out of scope for this change.
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
    this.invalidatePlayerCaches(player);
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

  /** Deliver to everyone currently in (or last belonging to) a region. */
  private sendToRegion(regionId: string, msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const player of this.players.values()) {
      const id = this.regionIdFromInstance(player.instanceId) ?? player.lastRegionId;
      if (id !== regionId) continue;
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
      gender: player.gender,
      hairStyle: player.hairStyle,
      facialHair: player.facialHair,
      hairColor: player.hairColor,
      eyeColor: player.eyeColor,
      outfitHue: player.outfitHue,
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
      friends: player.friends,
      coins: player.coins,
      inventory: player.inventory,
      questProgress: [...player.questProgress.entries()].map(([questId, e]) => ({
        questId,
        status: e.status,
        progress: e.progress,
      })),
      achievements: [...player.achievements.entries()].map(([achievementId, e]) => ({
        achievementId,
        progress: e.progress,
        unlockedAt: e.unlockedAt,
      })),
      discoveredPois: [...player.discoveredPois.entries()].map(([poiId, discoveredAt]) => ({
        poiId,
        discoveredAt,
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
      threat: new Map(),
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

  /** Dev-only: grant XP directly (verification tooling -- triggering a
   *  level-up without a long grind). */
  debugGrantXp(charId: string, amount: number): boolean {
    const player = this.players.get(charId);
    if (!player) return false;
    this.grantXp(player, amount);
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
