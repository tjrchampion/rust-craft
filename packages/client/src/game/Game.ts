import * as THREE from "three";
import {
  stepMovement,
  isSwimmingAt,
  isUnderwaterAt,
  isNearWaterAt,
  waterAt,
  terrainHeight,
  TICK_DT,
  WATER_LEVEL,
  clamp,
  dist2D,
  hashString,
  itemDef,
  mobDef,
  nodeTypeDef,
  spellDef,
  zoneAt,
  HOTBAR_SLOTS,
  EQUIP_SLOTS,
  generateVillages,
  adtKey,
  adtIndex,
  adtRingKeys,
  ADT_VILLAGE_RING,
  clampRegionFogDensity,
  clampGraphicsSettings,
  effectivePixelRatio,
  cameraFarForStreamRing,
  overworldFogForRing,
  type GraphicsSettings,
  REGION_COLOR_PRESETS,
  REVIVE_RANGE,
  DODGE_DISTANCE,
  SWIM_FLOAT_OFFSET,
  DUNGEON_PORTAL_ACTIVATION_RADIUS,
  dungeonTierDef,
  dungeonPortalAt,
  generateDungeonLayout,
  dungeonFloorHeightAt,
  TIER_NAMES,
  WORLD_MIN_X,
  WORLD_MAX_X,
  WORLD_MIN_Z,
  WORLD_MAX_Z,
  sampleRegionWaterDepth,
  ensureRegionWorldOrigins,
  regionLocalToWorld,
  worldToRegionLocal,
  type MoveState,
  type ServerMsg,
  type SelfState,
  type ItemSnap,
  type ItemDef,
  type PoiSpec,
  type RegionBlueprint,
  type RegionMapEntry,
  type RegionAssetCollider,
  type CharacterGender,
  type CharacterAppearance,
  regionAssetColliders,
  regionVolumeColliders,
  regionBarrierColliders,
  pointInColliderXZ,
  regionMusicTrackUrl,
  worldNodesFromRegion,
  type WorldNode,
} from "@rustcraft/shared";
import { Connection } from "../net/connection";
import { InputManager } from "../input/input";
import { buildTerrain, buildWater, applyWaterEnvironment, type WaterField } from "../render/terrain";
import { buildHorizonMountains } from "../render/horizon";
import { buildClouds, type CloudField } from "../render/clouds";
import { buildNameplate, buildHorse, buildRaft, type MountParts } from "../render/models";
import { NodeManager } from "../render/nodes";
import { GrassField } from "../render/grass";
import { EntityManager } from "../render/entities";
import { applyModularGearFromInventory, applyModularGearFromInventoryAsync } from "../render/modularGear";
import { playerModelUrl, CLASS_WEAPON_NODES } from "../render/classModels";
import { AnimatedModel, PLAYER_ANIMS, logicalFromState, dodgeLogicalFor, warmAllPackedAssets } from "../render/gltf";
import { preloadAssetPack } from "../render/assetPack";
import { getSharedKtx2Loader } from "../render/sharedGltf";
import {
  buildWorldStatic,
  buildVillage,
  animateSettlements,
  flushSettlementQueue,
  clearSettlementQueue,
  type SettlementHandles,
} from "../render/settlements";
import { DUNGEON_THEME_COLORS, DungeonInteriorRenderer } from "../render/dungeonInterior";
import { RegionInteriorRenderer } from "../render/regionInterior";
import { RegionContinent } from "../render/regionContinent";
import {
  atmosphereFromGrading,
  cloneAtmosphere,
  lerpAtmosphere,
  sampleBlendedAtmosphere,
  REGION_ATMOSPHERE_LERP_RATE,
  type AtmosphereSample,
} from "../render/regionAtmosphere";
import { SkyDome } from "../render/skyDome";
import { buildShrine } from "../render/models";
import { NpcManager } from "../render/npcs";
import { sound, resolveFootSurface } from "./sound";
import { music } from "./music";
import { game as ui, type CharacterTab } from "../ui/gameState.svelte";
import { app } from "../ui/appState.svelte";

/** Default orbit arm — also the farthest zoom-out. */
const CAMERA_DISTANCE_DEFAULT = 6.5;
const CAMERA_DISTANCE_MIN = 2.4;
const CAMERA_DISTANCE_MAX = CAMERA_DISTANCE_DEFAULT;
/** One scroll / trackpad tick. Keep small so a single gesture is subtle. */
const CAMERA_ZOOM_STEP = 0.35;
const CAMERA_HEIGHT = 2.2;
const GATHER_RANGE = 4.0;
/** How often the interact-prompt label (and its underlying node/corpse/dead-
 *  player scans) is recomputed. It's a UI string, not a physics check, so it
 *  doesn't need 60Hz precision -- ~8Hz is imperceptibly different to a player
 *  but cuts several full linear scans down to a fraction of their frame cost. */
const INTERACT_PROMPT_INTERVAL_MS = 120;
/** Left-to-right tab order for gamepad LB/RB cycling in the character screen. */
const TAB_ORDER: CharacterTab[] = ["inventory", "quests", "achievements", "spellbook", "craft", "party", "system"];

interface PendingInput {
  seq: number;
  moveX: number;
  moveZ: number;
  jump: boolean;
  sprint: boolean;
  crouch: boolean;
  block: boolean;
  lookPitch: number;
  mount: "horse" | "raft" | null;
  revivingId: string | null;
  inDungeon?: boolean;
  regionHeightmap?: Pick<RegionBlueprint, "gridSize" | "pitch" | "heights">;
  regionAssets?: RegionAssetCollider[];
  groundAt?: (x: number, z: number) => number;
  waterDepthAt?: (x: number, z: number) => number;
}

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private overworldGroup = new THREE.Group();
  private camera: THREE.PerspectiveCamera;
  private sun: THREE.DirectionalLight;
  private ambient: THREE.AmbientLight;
  /** Soft sky/ground bounce — driven by region color grading fillIntensity. */
  private fillLight = new THREE.HemisphereLight(0xffffff, 0x3a4a2a, 0);
  /** Set while standing inside a dungeon's enclosed room -- drives the
   *  day/night override in updateDayNight (fixed themed lighting instead
   *  of the outdoor sky/sun). */
  private insideDungeonPortal: PoiSpec | null = null;
  private activeDungeonGroup: THREE.Group | null = null;
  private activeDungeonPortalId: string | null = null;
  private dungeonRenderer: DungeonInteriorRenderer | null = null;
  /** Mirrors the dungeon fields above, but gated purely on ui.regionState
   *  (server-authoritative). Outdoor regions share one continent streamer so
   *  walking a seam does not tear down / reload. */
  private activeRegionId: string | null = null;
  /** Primary (ownership) region renderer — fog/music/UI; may differ from
   *  other mounted neighbor layers on the continent. */
  private regionRenderer: RegionInteriorRenderer | null = null;
  private continent: RegionContinent | null = null;
  /** Camera-centric layered skydome (gradient + clouds + stars + fog skirt). */
  private skyDome = new SkyDome();
  /** Spatially blended region grading, eased frame-to-frame across seams. */
  private atmosphereDisplay: AtmosphereSample | null = null;
  /** Layout stubs (origins + span) for streaming; full BPs live in cache. */
  private regionCatalog: RegionBlueprint[] = [];
  private regionBlueprintCache = new Map<string, RegionBlueprint>();
  private regionPortals: { id: string; name: string; x: number; z: number }[] = [];
  /** id → display name for all known regions, populated at load time. */
  private regionNameMap = new Map<string, string>();
  /** True after tearDownOverworld() until rebuildOverworld() -- region/dungeon visits. */
  private overworldSuspended = false;
  /** In-flight region interior load — preloadAndEnter awaits this so the
   *  loading screen stays up until terrain + assets exist. */
  private regionEnterPromise: Promise<void> | null = null;
  /** Throttle continent mount/unmount sync (world meters + time). */
  private continentSyncAt = { x: Number.NaN, z: Number.NaN, t: 0 };
  /** Throttle updateInteractPrompt -- it's a UI-only label so it doesn't need
   *  the several full linear scans (nodes/corpses/dead players) it does at
   *  60Hz; ms timestamp of the last recompute. */
  private interactPromptAt = -Infinity;
  /** Depleted gather-node ids from welcome / nodeUpdate. */
  private depletedNodeIds = new Set<string>();
  /** Last mounted-region signature used for authored gather-node sync. */
  private regionNodesSyncKey = "";

  private connection = new Connection();
  private input: InputManager;
  private nodes!: NodeManager;
  readonly entities!: EntityManager;
  private settlements!: SettlementHandles;
  private overworldSigns: THREE.Object3D[] = [];
  private npcManager!: NpcManager;
  private grass!: GrassField;
  private clouds!: CloudField;
  private water!: WaterField;
  /** Villages keyed by id → scene group; streamed by ADT tile ring. */
  private streamedVillages = new Map<string, { group: THREE.Group; signs: THREE.Object3D[] }>();
  /** Latest viewer pose for deferred ADT/village streaming (runs after paint). */
  private streamArgs: { x: number; z: number; dt: number } | null = null;
  private streamTimer = 0;
  private mountMesh: MountParts | null = null;
  private currentMount: "horse" | "raft" | null = null;

  /** Orbit arm length; scroll wheel adjusts while pointer-locked. */
  private cameraDistance = CAMERA_DISTANCE_DEFAULT;
  private selfId = "";
  private selfClassId = "warrior";
  private selfGender: CharacterGender = "male";
  private selfAppearance: CharacterAppearance = {
    gender: "male",
    hairStyle: "none",
    facialHair: "none",
    hairColor: 0x2b1a12,
    eyeColor: 0x6b4423,
    outfitHue: 0xffffff,
  };
  private equippedWeaponDef: ItemDef | null = null;
  private avatar: AnimatedModel;
  private selfNameplate: THREE.Sprite;
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
  /** Smoothed body pitch while swimming — driven by camera look angle. */
  private swimBodyPitch = 0;
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
  private footstepAccum = 0;
  private unsubscribe: (() => void) | null = null;
  /** Live graphics prefs (mirrored from ui.graphics; applied to renderer/stream). */
  private graphics: GraphicsSettings = clampGraphicsSettings(undefined);
  /** Fog density multiplier from graphics settings (region FogExp2 path). */
  private fogScale = 1;
  /** AA flag used when the WebGL context was created — change needs re-enter world. */
  private antialiasActive = true;

  constructor(
    canvas: HTMLCanvasElement,
    characterId: string,
    characterName: string,
    private wsAddress: string,
  ) {
    this.graphics = clampGraphicsSettings(ui.graphics);
    this.fogScale = this.graphics.fogScale;
    this.antialiasActive = this.graphics.antialias;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.antialiasActive });
    this.renderer.setPixelRatio(effectivePixelRatio(this.graphics, window.devicePixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = this.graphics.shadowsEnabled;
    // Soft PCF over a huge ortho frustum + dense foliage was a major GPU cost.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    getSharedKtx2Loader(this.renderer);

    this.camera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      cameraFarForStreamRing(this.graphics.streamRing),
    );
    // Fog far matches village/tree ADT stream edge so content fades before unload.
    const fog0 = overworldFogForRing(this.graphics.streamRing);
    this.scene.fog = new THREE.Fog(0x87b5d9, fog0.near, fog0.far);
    // Near-black clear so the skydome (not a flat Color) is the visible sky.
    this.scene.background = new THREE.Color(0x02040a);
    this.scene.add(this.skyDome.group);

    this.sun = new THREE.DirectionalLight(0xfff4e0, 2.4);
    this.sun.position.set(80, 120, 40);
    this.sun.castShadow = this.graphics.shadowsEnabled;
    this.sun.shadow.mapSize.set(this.graphics.shadowMapSize, this.graphics.shadowMapSize);
    this.sun.shadow.camera.left = -40;
    this.sun.shadow.camera.right = 40;
    this.sun.shadow.camera.top = 40;
    this.sun.shadow.camera.bottom = -40;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 240;
    this.sun.shadow.bias = -0.0015;
    this.scene.add(this.sun.target);
    this.ambient = new THREE.AmbientLight(0x8899bb, 0.75);
    this.scene.add(this.sun, this.ambient, this.fillLight);

    // Regions-only: no procedural overworld map. Catalog + name map still load
    // so the continent streamer can mount neighboring regions.
    this.overworldSuspended = true;
    void this.loadRegionCatalog();
    this.npcManager = new NpcManager(this.scene);

    this.avatar = new AnimatedModel(PLAYER_ANIMS);
    this.selfNameplate = buildNameplate(characterName, "#ffe9a8");
    this.selfNameplate.position.y = 2.35;
    this.selfNameplate.visible = ui.showPlayerNameplates;
    this.avatar.group.add(this.selfNameplate);
    this.scene.add(this.avatar.group);

    this.entities = new EntityManager(this.scene);
    this.entities.showPlayerNameplates = ui.showPlayerNameplates;
    this.entities.showMobNameplates = ui.showMobNameplates;
    this.entities.prewarmVfx(this.renderer, this.camera);
    this.input = new InputManager(canvas);

    canvas.oncontextmenu = (e) => {
      e.preventDefault();
      const hit = this.entities.raycastPlayer(this.camera, e.clientX, e.clientY);
      if (hit) {
        this.selectTarget(hit.id);
        ui.playerContextMenu = {
          x: e.clientX,
          y: e.clientY,
          playerName: hit.name,
          playerLevel: hit.level,
          playerClass: hit.classId,
        };
      }
      return false;
    };
    canvas.onauxclick = (e) => {
      e.preventDefault();
      return false;
    };

    canvas.addEventListener("mousedown", (e) => {
      // While the pointer is locked, real mouse events carry a frozen position
      // and all target the canvas -- ignore them; InputManager re-dispatches a
      // synthetic mousedown (isTrusted === false) at the software-cursor point,
      // which is the one we act on. When unlocked, the real event is correct.
      if (document.pointerLockElement && e.isTrusted) return;
      if (e.button === 0) {
        const hit = this.entities.raycastPlayer(this.camera, e.clientX, e.clientY);
        if (hit) {
          this.selectTarget(hit.id);
          sound.play("target");
        }
      }
    });

    window.addEventListener("resize", this.onResize);

    this.unsubscribe = this.connection.onMessage((msg) => this.onServerMsg(msg));
    void this.connect(characterId);

    // Unlock/synthesize audio (constructed within the character-select gesture).
    sound.init();
    sound.setVolume(ui.sfxVolume);
    music.setVolume(ui.musicVolume);

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

  /** No-op: overworld map removed — gameplay is continent regions only. */
  private tearDownOverworld(): void {
    this.overworldSuspended = true;
    if (this.overworldGroup.parent) this.scene.remove(this.overworldGroup);
    this.overworldGroup.clear();
    this.overworldSigns = [];
    this.streamedVillages.clear();
  }

  private rebuildOverworld(): void {
    // Overworld map removed — never recreate it.
    this.tearDownOverworld();
  }

  /** Loads region layout stubs + names for continent streaming (no overworld props). */
  private async loadRegionCatalog(): Promise<void> {
    try {
      const res = await fetch(app.apiUrl("/api/regions"), { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        regions: {
          id: string;
          name: string;
          biome: RegionBlueprint["biome"];
          portalWorldX: number;
          portalWorldZ: number;
          gridSize: number;
          pitch: number;
          worldOriginX: number;
          worldOriginZ: number;
          colorGrading?: RegionBlueprint["colorGrading"];
        }[];
      };
      for (const r of data.regions) this.regionNameMap.set(r.id, r.name);
      this.regionCatalog = data.regions.map((r) => ({
        id: r.id,
        name: r.name,
        biome: r.biome,
        gridSize: r.gridSize,
        pitch: r.pitch,
        heights: [],
        assets: [],
        mobSpawns: [],
        villages: [],
        colorGrading: r.colorGrading ?? {
          sunColor: "#ffffff",
          sunIntensity: 1,
          ambientColor: "#ffffff",
          ambientIntensity: 0.5,
          skyColor: "#87b5d9",
          fogColor: "#87b5d9",
          fogDensity: 0.01,
          groundTint: "#6b8f4e",
        },
        entryLocal: { x: 0, z: 0 },
        portalWorldX: r.portalWorldX,
        portalWorldZ: r.portalWorldZ,
        worldOriginX: r.worldOriginX,
        worldOriginZ: r.worldOriginZ,
      }));
      ensureRegionWorldOrigins(this.regionCatalog);
      this.regionPortals = data.regions
        .filter((r) => r.portalWorldX !== 0 || r.portalWorldZ !== 0)
        .map((r) => ({ id: r.id, name: r.name, x: r.portalWorldX, z: r.portalWorldZ }));
    } catch {
      // Catalog is required for streaming; a failed fetch just delays mounts.
    }
  }

  private continentCatalog(): RegionBlueprint[] {
    return this.regionCatalog.map((stub) => this.regionBlueprintCache.get(stub.id) ?? stub);
  }

  /** Keep NodeManager in sync with mounted continent region.resourceNodes. */
  private syncAuthoredRegionNodes(force = false): void {
    if (!this.nodes || !this.continent) return;
    const layers = this.continent.mountedBlueprints();
    const key = layers
      .map((bp) => {
        const nodes = (bp.resourceNodes ?? [])
          .map((n) => `${n.id ?? ""}:${n.type}:${n.model ?? ""}:${n.localX.toFixed(2)},${n.localZ.toFixed(2)}`)
          .join(";");
        return `${bp.id}@${bp.worldOriginX ?? 0},${bp.worldOriginZ ?? 0}:${nodes}`;
      })
      .sort()
      .join("|");
    if (!force && key === this.regionNodesSyncKey) return;
    this.regionNodesSyncKey = key;
    const list: WorldNode[] = layers.flatMap((bp) => worldNodesFromRegion(bp));
    this.nodes.removeRegionResourceNodes();
    this.nodes.addDynamicNodes(list);
    for (const node of list) {
      if (this.depletedNodeIds.has(node.id)) this.nodes.setDepleted(node.id, true);
    }
  }

  private ensureContinent(): RegionContinent {
    if (!this.continent) {
      this.continent = new RegionContinent(
        this.scene,
        async (id) => {
          // Instant RAM cache lookup -- eliminate network requests during gameplay
          const cached = this.regionBlueprintCache.get(id);
          if (cached?.heights?.length) return cached;

          try {
            const res = await fetch(app.apiUrl(`/api/regions/${id}`), { credentials: "include" });
            if (res.ok) {
              const data = (await res.json()) as { blueprint: RegionBlueprint };
              this.regionBlueprintCache.set(id, data.blueprint);
              this.continent?.updateLayerBlueprint(data.blueprint);
              this.regionNodesSyncKey = "";
              return data.blueprint;
            }
          } catch {
            /* fall through to cache */
          }
          if (cached) return cached;
          throw new Error(`Failed to fetch region ${id}`);
        },
        this.regionNameMap,
      );
      this.continent.setGraphicsOptions({
        streamRing: this.graphics.streamRing,
        grassDrawDistance: this.graphics.grassDrawDistance,
      });
    }
    this.continent.setNameMap(this.regionNameMap);
    return this.continent;
  }

  private continentGroundAt = (x: number, z: number): number => {
    if (!this.continent) return 0;
    return this.continent.groundAt(x, z, this.continentCatalog());
  };

  private continentWaterDepthAt = (x: number, z: number): number => {
    if (!this.continent) return 0;
    return this.continent.waterDepthAt(x, z, this.continentCatalog());
  };

  /** Bind primary renderer/music to the ownership region (no tear-down). */
  private bindPrimaryRegion(regionId: string): void {
    const layer = this.continent?.getLayer(regionId) ?? null;
    const prevId = this.activeRegionId;
    this.activeRegionId = regionId;
    this.regionRenderer = layer?.renderer ?? null;
    this.entities.heightSampler = (x, z) => this.continentGroundAt(x, z);
    if (this.regionRenderer && (prevId === null || prevId !== regionId)) {
      music.play(regionMusicTrackUrl(this.regionRenderer.musicTrack), 3000);
    }
  }

  private destroyContinent(): void {
    this.continent?.destroy();
    this.continent = null;
    this.regionRenderer = null;
    this.activeRegionId = null;
    this.entities.heightSampler = undefined;
    music.stop();
  }

  private async connect(characterId: string): Promise<void> {
    try {
      ui.loading = true;
      ui.loadingMessage = "Connecting to server...";
      ui.loadingProgress = 10;
      await this.connection.connect(characterId, this.wsAddress);
      this.running = true;
      requestAnimationFrame(this.frame);
    } catch {
      ui.loading = false;
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
        this.selfGender = msg.gender as CharacterGender;
        this.selfAppearance = {
          gender: msg.gender as CharacterGender,
          hairStyle: msg.hairStyle as CharacterAppearance["hairStyle"],
          facialHair: msg.facialHair as CharacterAppearance["facialHair"],
          hairColor: msg.hairColor,
          eyeColor: msg.eyeColor,
          outfitHue: msg.outfitHue,
        };
        ui.gender = this.selfGender;
        ui.appearance = this.selfAppearance;
        ui.serverTimeOffset = msg.serverTime - Date.now();
        ui.self = msg.self;
        ui.inventory = msg.inventory;
        ui.learnedSpells = msg.learnedSpells;
        ui.selectedSlot = msg.selectedSlot;
        ui.timeOfDay = msg.timeOfDay;
        this.move = { x: msg.self.x, y: msg.self.y, z: msg.self.z, vy: msg.self.vy, grounded: msg.self.grounded };
        this.depletedNodeIds = new Set(msg.depletedNodes);
        // Continent gatherables come from authored region.resourceNodes — not procedural overworld scatter.
        this.nodes = new NodeManager(this.scene, msg.depletedNodes, []);
        this.regionNodesSyncKey = "";
        for (const structure of msg.structures) this.entities.addStructure(structure);
        for (const npc of msg.npcs) this.npcManager.applySnap(npc);
        ui.questMarkers = this.npcManager.questMarkers();
        ui.questLog = msg.questLog;
        ui.achievements = msg.achievements ?? [];
        ui.levelRewards = msg.levelRewards ?? [];
        ui.levelRewardOpenId = null;
        void this.preloadAndEnter(msg);
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
        this.applyEquippedGear(msg.items);
        break;
      case "nodeUpdate":
        if (msg.depleted) this.depletedNodeIds.add(msg.nodeId);
        else this.depletedNodeIds.delete(msg.nodeId);
        this.nodes?.setDepleted(msg.nodeId, msg.depleted);
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
        if (msg.inviteFrom) {
          ui.pendingInvite = msg.inviteFrom;
          ui.toast(`⚔️ Party invite received from ${msg.inviteFrom}!`);
        }
        break;
      case "friends":
        ui.friends = (msg as any).friends ?? [];
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
      case "vendorStock":
        ui.vendorWares = msg as any;
        ui.vendorOpen = true;
        this.setUiMode(true);
        break;
      case "questLog":
        ui.questLog = msg.quests;
        break;
      case "achievements":
        ui.achievements = msg.achievements;
        break;
      case "achievementUnlocked": {
        ui.toast(`Achievement: ${msg.name} (+${msg.xp} XP)`);
        ui.addCombat(`Achievement unlocked: ${msg.name}`);
        sound.play("levelup");
        break;
      }
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

          // Register dynamic chest nodes from the dungeon layout
          if (msg.portalId && msg.instanceId) {
            const layout = generateDungeonLayout(msg.portalId);
            const chestNodes = layout.chests.map((c, idx) => ({
              id: `${msg.instanceId}_chest_${idx}`,
              type: c.rarity === "rare" ? "dungeon_chest_rare" : "dungeon_chest_common",
              x: layout.center.x + c.localX,
              y: layout.center.y + c.localY,
              z: layout.center.z + c.localZ,
              variant: 0,
              biome: "forest" as const,
            }));
            this.nodes?.addDynamicNodes(chestNodes);
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
      case "regionState": {
        const wasInRegion = ui.regionState !== null;
        if (msg.inRegion && msg.regionId) {
          ui.regionState = { regionId: msg.regionId, regionName: msg.regionName ?? "" };
          // Hard UI reset only when first entering the continent — seamless
          // zone ownership changes keep targeting/inventory intact.
          if (!wasInRegion) {
            this.interactNodeId = null;
            this.reviveTargetId = null;
            this.entities.setTarget(null);
            ui.inventoryOpen = false;
            ui.worldMapOpen = false;
            if (ui.questOffer) this.closeQuestDialog();
            this.posError.set(0, 0, 0);
          } else if (this.activeRegionId !== msg.regionId) {
            this.bindPrimaryRegion(msg.regionId);
          }
        } else {
          ui.regionState = null;
          ui.worldEvents = [];
          this.posError.set(0, 0, 0);
        }
        break;
      }
      case "worldEventState": {
        ui.worldEvents = msg.events ?? [];
        break;
      }
      case "corpseLoot":
        if (msg.items && msg.items.length > 0) {
          ui.activeCorpseLoot = { mobId: msg.mobId, mobType: msg.mobType, items: msg.items };
          this.setUiMode(true);
          sound.play("lootDrop");
        } else {
          ui.activeCorpseLoot = null;
          this.setUiMode(false);
        }
        break;
      case "levelRewards":
        ui.levelRewards = msg.chests;
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

  private async preloadAndEnter(msg: Extract<ServerMsg, { t: "welcome" }>): Promise<void> {
    try {
      ui.loadingMessage = "Loading character...";
      ui.loadingProgress = 20;

      // Parallelise: avatar load + region catalog fetch + master asset pack download
      const avatarLoad = (async () => {
        await this.avatar.loadFrom(playerModelUrl(this.selfGender), 1.8);
        await this.avatar.applyAppearance(this.selfGender, this.selfAppearance);
      })();
      const catalogLoad = this.regionCatalog.length === 0 ? this.loadRegionCatalog() : Promise.resolve();
      const packLoad = preloadAssetPack();

      ui.loadingProgress = 30;
      await Promise.all([avatarLoad, catalogLoad, packLoad]);

      // Pre-fetch all full region blueprints in parallel during loading screen
      if (this.regionCatalog.length > 0) {
        await Promise.all(
          this.regionCatalog.map(async (r) => {
            if (this.regionBlueprintCache.get(r.id)?.heights?.length) return;
            try {
              const res = await fetch(app.apiUrl(`/api/regions/${r.id}`), { credentials: "include" });
              if (res.ok) {
                const data = (await res.json()) as { blueprint: RegionBlueprint };
                this.regionBlueprintCache.set(r.id, data.blueprint);
              }
            } catch {}
          }),
        );
      }

      ui.loadingProgress = 45;

      ui.loadingMessage = "Warming 3D asset catalog…";
      await warmAllPackedAssets((loaded, total) => {
        const pct = Math.floor(45 + (loaded / total) * 15);
        ui.loadingProgress = pct;
        ui.loadingMessage = `Warming 3D assets (${loaded}/${total})…`;
      });
      ui.loadingProgress = 60;

      await this.applyEquippedGearAsync(msg.inventory);
      ui.loadingProgress = 65;

      // The server sends `regionState` *before* `welcome`, but there is a
      // micro-task gap between WebSocket message dispatch and our onServerMsg
      // handler. Retry for up to 2 s before giving up — covers any edge case
      // where the two messages arrive in the same Event Loop tick.
      let regionId = ui.regionState?.regionId;
      if (!regionId) {
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 50));
          regionId = ui.regionState?.regionId;
          if (regionId) break;
        }
      }

      if (regionId) {
        ui.loadingMessage = "Loading region…";
        ui.loadingProgress = 70;
        this.tearDownOverworld();
        this.regionEnterPromise = this.enterRegionInterior(regionId);
        if (this.regionEnterPromise) await this.regionEnterPromise;
      } else {
        // No region — connected to the open overworld. Finish cleanly.
        console.warn("[Game] No regionState after welcome — entering without region.");
        ui.loadingProgress = 100;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      ui.loadingProgress = 100;
      ui.loading = false;
      ui.connected = true;
    } catch (e) {
      console.error("[Game] Preload failed", e);
      // Fallback: connect anyway so they aren't stuck on a black screen
      ui.loading = false;
      ui.connected = true;
    }
  }

  private onEvent(msg: Extract<ServerMsg, { t: "event" }>): void {
    switch (msg.kind) {
      case "damage":
        if (msg.x !== undefined) {
          const mine = msg.sourceId === this.selfId;
          const toMe = msg.targetId === this.selfId;
          const outcome = msg.outcome ?? "hit";
          if (outcome === "miss" || outcome === "dodge") {
            if (mine || toMe) {
              this.entities.spawnDamageNumber(
                msg.x,
                (msg.y ?? 0) + 0.6,
                msg.z ?? 0,
                0,
                "#c8c8c8",
                outcome === "dodge" ? "Dodge" : "Miss",
              );
              ui.addCombat(
                outcome === "dodge"
                  ? `${ui.nameOf(msg.targetId)} dodged ${ui.nameOf(msg.sourceId)}`
                  : `${ui.nameOf(msg.sourceId)} missed ${ui.nameOf(msg.targetId)}`,
              );
            }
            break;
          }
          if (!msg.amount) break;
          if (toMe) this.avatar.play("hit");
          else if (mine && msg.targetId) this.entities.playHit(msg.targetId);
          if (mine || toMe) {
            const crit = outcome === "crit";
            this.entities.spawnDamageNumber(
              msg.x,
              (msg.y ?? 0) + 0.6,
              msg.z ?? 0,
              msg.amount,
              toMe ? "#ff6b5e" : crit ? "#ffb347" : "#ffe08a",
              crit ? `${Math.round(msg.amount)}!` : undefined,
            );
            if (crit && mine) {
              this.entities.spawnSpellBurst(msg.x, (msg.y ?? 0) + 0.4, msg.z ?? 0, msg.spellId ?? "rend", 1.45);
            }
            ui.addCombat(
              `${ui.nameOf(msg.sourceId)} ${crit ? "critically hit" : "hit"} ${ui.nameOf(msg.targetId)} for ${Math.round(msg.amount)}`,
            );
            sound.play(toMe ? "hitTaken" : "hitFlesh", { classId: this.selfClassId });
          } else if (msg.sourceId?.startsWith("m_") || msg.sourceId?.startsWith("wevt_")) {
            sound.play("mobAttack", { volume: 0.35 });
          }
        }
        break;
      case "heal":
        if (msg.targetId === this.selfId) {
          if (msg.spellId === "shrine") ui.addCombat("You feel the shrine's blessing — fully restored");
          else {
            const crit = msg.outcome === "crit";
            ui.addCombat(
              `${ui.nameOf(msg.sourceId)} ${crit ? "critically healed" : "healed"} ${ui.nameOf(msg.targetId)} for ${Math.round(msg.amount ?? 0)}`,
            );
          }
          sound.play("levelup");
        }
        if (msg.x !== undefined && msg.amount) {
          const crit = msg.outcome === "crit";
          this.entities.spawnDamageNumber(
            msg.x,
            (msg.y ?? 0) + 0.6,
            msg.z ?? 0,
            msg.amount,
            crit ? "#b8ff9a" : "#7be07b",
            crit ? `${Math.round(msg.amount)}!` : undefined,
          );
        }
        // Green rising-mote flourish on whoever was healed -- the local
        // avatar for self-heals, otherwise the tracked ally/mob group.
        {
          const healed = msg.targetId === this.selfId ? this.avatar.group : msg.targetId ? this.entities.groupOf(msg.targetId) : null;
          if (healed) this.entities.spawnHealAura(healed);
        }
        break;
      case "gather":
        if (msg.itemId && msg.amount) {
          ui.toast(`+${msg.amount} ${itemDef(msg.itemId).name}`);
          sound.play("loot", { volume: 0.7 });
        }
        break;
      case "xp":
        if (msg.amount) {
          ui.toast(`+${msg.amount} XP`);
          ui.addCombat(`You gain ${msg.amount} experience`);
        }
        break;
      case "levelup": {
        const level = msg.amount ?? (ui.self?.level ?? 0);
        ui.toast(`Level up! You are now level ${level}`);
        ui.addCombat(`You reached level ${level}!`);
        ui.showLevelUpBanner(level);
        sound.play("levelup");
        this.avatar.play("cheer");
        const lx = msg.x ?? this.move.x;
        const ly = msg.y ?? this.move.y + 1;
        const lz = msg.z ?? this.move.z;
        this.entities.spawnLevelUpVfx(lx, ly, lz);
        break;
      }
      case "levelReward":
        if (msg.message) ui.toast(msg.message);
        break;
      case "learnSpell":
        if (msg.spellId) {
          ui.toast(`Learned spell: ${msg.spellId}`);
          sound.play("craft");
        }
        break;
      case "death":
        // Mob kills broadcast "death" with targetId = mob id to everyone nearby.
        // Player death is sent only to the victim and usually has no targetId.
        if (!msg.targetId || msg.targetId === this.selfId) {
          ui.toast("You died");
          ui.addCombat("You died");
          sound.play("death", { classId: this.selfClassId });
        }
        break;
      case "revive":
        if (msg.targetId === this.selfId) {
          ui.toast(`${ui.nameOf(msg.sourceId)} revived you!`);
          sound.play("levelup");
        }
        ui.addCombat(`${ui.nameOf(msg.sourceId)} revived ${ui.nameOf(msg.targetId)}`);
        break;
      case "spellHit":
        sound.play("spellHit", { spellId: msg.spellId, classId: this.selfClassId });
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
        if (msg.sourceId === this.selfId) sound.play("castStart", { spellId: msg.spellId, classId: this.selfClassId });
        if (msg.spellId) {
          const pos = (msg.sourceId ? this.entities.entityWorldPos(msg.sourceId) : null) ?? new THREE.Vector3(this.move.x, this.move.y, this.move.z);
          this.entities.spawnCastWindup(msg.spellId, pos);
        }
        break;
      case "error":
        if (msg.message) ui.toast(msg.message);
        break;
    }
  }

  /** Show whichever weapon-mesh variant matches the equip slot's current
   *  item, hiding every other variant baked into the local avatar's rig --
   *  unless the active hotbar slot holds its own visual item (a tool like a
   *  Pickaxe/Torch, or a potion), in which case that takes over the held
   *  model instead, matching gather/attack logic (which already reads the
   *  hotbar selection, not the equip slot, for what you're "using"). */
  private applyEquippedGear(items: ItemSnap[]): void {
    void this.applyEquippedGearAsync(items);
  }

  private async applyEquippedGearAsync(items: ItemSnap[]): Promise<void> {
    const weapon = items.find((i) => i.container === "equip" && i.slot === 0);
    const equipDef = weapon ? itemDef(weapon.itemId) : null;
    const allKnown = CLASS_WEAPON_NODES[this.selfClassId as keyof typeof CLASS_WEAPON_NODES] ?? [];

    const hotbarItem = items.find((i) => i.container === "hotbar" && i.slot === ui.selectedSlot);
    const hotbarDef = hotbarItem && !hotbarItem.itemId.startsWith("spell:") ? itemDef(hotbarItem.itemId) : null;
    const heldDef = hotbarDef && (hotbarDef.weaponProp || hotbarDef.weaponModel) ? hotbarDef : equipDef;

    const hasBakedIn = heldDef && heldDef.weaponModel && heldDef.weaponModel.some(nodeName => allKnown.includes(nodeName));
    if (hasBakedIn) {
      this.avatar.setWeapon(heldDef!.weaponModel!, allKnown);
      await this.avatar.setWeaponProp(null);
    } else if (heldDef && heldDef.weaponProp) {
      this.avatar.setWeapon([], allKnown);
      await this.avatar.setWeaponProp(heldDef.weaponProp);
    } else {
      this.avatar.setWeapon([], allKnown);
      await this.avatar.setWeaponProp(null);
    }
    // Cast/attack animation overrides stay tied to the *equipped* weapon
    // (e.g. Firebolt's staff-channel pose), independent of whatever tool is
    // currently held for gathering.
    this.equippedWeaponDef = equipDef;

    // Modular Fantasy outfit pieces (Quaternius Universal rig + UAL clips).
    await applyModularGearFromInventoryAsync(this.avatar, this.selfGender, items);
  }

  /** The unified action bar: a slot either holds a real item (select it, same
   *  as before) or a spell marker ("spell:<id>", see the assignSpell flow in
   *  CharacterScreen) -- cast it directly instead. */
  useHotbarSlot(slot: number): void {
    const entry = ui.inventory.find((i) => i.container === "hotbar" && i.slot === slot);
    if (entry?.itemId.startsWith("spell:")) {
      const spellId = entry.itemId.slice("spell:".length);
      this.faceTarget();
      this.queueOrCastSpell(spellId);
      return;
    }
    this.connection.send({ t: "selectSlot", slot });
  }

  /**
   * Client-side spell queue: if GCD/cast is active, remember the intent and
   * auto-send when the window opens (mirrors server SQW). Otherwise cast now.
   */
  private clientSpellQueue: { spellId: string; at: number } | null = null;

  private queueOrCastSpell(spellId: string): void {
    const def = spellDef(spellId);
    const now = Date.now();
    const serverNow = now - ui.serverTimeOffset;
    const gcdReady = ui.self?.gcdReadyAt ?? 0;
    const castEnds = ui.self?.castEndsAt ?? 0;
    const busyUntil = Math.max(gcdReady, castEnds);
    const onGcd = def.triggersGcd !== false && serverNow < gcdReady;
    const casting = !!ui.self?.castingSpell;

    if (onGcd || casting) {
      this.clientSpellQueue = { spellId, at: now };
      // Still send — server will buffer if inside the queue window.
      this.connection.send({ t: "cast", spellId });
      return;
    }

    this.clientSpellQueue = null;
    this.connection.send({ t: "cast", spellId });
    if (def.castTimeS <= 0) {
      this.avatar.play("attack");
      const school = def.effects.find((e) => e.type === "damage")?.damageType;
      if (school === "physical" || spellId === "attack") {
        const ranged =
          this.equippedWeaponDef?.weaponType === "bow" || this.equippedWeaponDef?.weaponType === "crossbow";
        sound.play(ranged ? "bowShot" : "swing", { classId: this.selfClassId });
      } else {
        sound.play("castStart", { spellId, classId: this.selfClassId });
      }
    }
  }

  /** Flush client spell queue once GCD/cast frees up (backup if server queue missed). */
  private tickClientSpellQueue(): void {
    const q = this.clientSpellQueue;
    if (!q || !ui.self) return;
    const serverNow = Date.now() - ui.serverTimeOffset;
    if (ui.self.castingSpell) return;
    if (ui.self.gcdReadyAt > serverNow) return;
    // If the server already accepted/queued this press, SelfState.queuedSpellId
    // will match — don't double-fire. Otherwise re-send (press was outside SQW).
    const spellId = q.spellId;
    this.clientSpellQueue = null;
    if (ui.self.queuedSpellId === spellId) return;
    this.connection.send({ t: "cast", spellId });
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
    // Use live colliders/ground (not the snapshot from input time) so barriers
    // that finished loading still block during reconcile.
    const inContinent = this.continent !== null && ui.regionState !== null;
    const liveAssets = inContinent
      ? this.continent!.collidersWorld()
      : this.regionRenderer
        ? [
            ...regionAssetColliders(this.regionRenderer.assets),
            ...regionVolumeColliders(this.regionRenderer.terrainVolumes ?? []),
            ...regionBarrierColliders(this.regionRenderer.blueprint.barrierVolumes),
          ]
        : undefined;
    const liveGround = inContinent ? this.continentGroundAt : undefined;
    const liveWater = inContinent ? this.continentWaterDepthAt : undefined;
    // True-geometry (BVH) collision closures — matches the authoritative
    // server so reconcile settles at the same wall/deck instead of snapping.
    const meshResolve = inContinent ? this.continent!.meshResolveWorld : undefined;
    const meshGroundBelow = inContinent ? this.continent!.meshGroundBelowWorld : undefined;
    let replayed = serverState;
    for (const p of this.pending) {
      replayed = stepMovement(
        replayed,
        {
          ...p,
          regionAssets: liveAssets ?? p.regionAssets,
          groundAt: liveGround ?? p.groundAt,
          waterDepthAt: liveWater ?? p.waterDepthAt,
          meshResolve,
          meshGroundBelow,
        },
        TICK_DT,
      );
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

    // Do NOT tick or render while the loading screen is active — it causes
    // WebGL canvas flicker through the Svelte loading overlay, and streaming
    // code that runs here can interfere with the async loading pipeline.
    if (ui.loading) return;

    const actions = this.input.sample(dt);
    ui.lastDevice = this.input.lastDevice;

    // Camera orbit
    this.cameraYaw += actions.lookX;
    // Allow steeper look-down so swim aiming can point into the water.
    this.cameraPitch = clamp(this.cameraPitch + actions.lookY, -1.45, 0.55);
    ui.compassYaw = this.cameraYaw;

    const dead = ui.self?.dead ?? false;

    // Character screen toggle -- Tab/I/L/K/J/U/O (and gamepad Start) each open
    // the same full-page panel directly on their own tab, or close it if it's
    // already open showing that tab. One shared panel, not separate modals.
    if (actions.inventoryPressed && !dead) this.toggleCharacterTab("inventory");
    if (actions.questsPressed && !dead) this.toggleCharacterTab("quests");
    if (actions.achievementsPressed && !dead) this.toggleCharacterTab("achievements");
    if (actions.spellbookPressed && !dead) this.toggleCharacterTab("spellbook");
    if (actions.craftingPressed && !dead) this.toggleCharacterTab("craft");
    if (actions.partyPressed && !dead) this.toggleCharacterTab("party");
    if (actions.systemPressed && !dead) this.toggleCharacterTab("system");
    if (actions.systemMenuPressed && !dead) this.toggleCharacterTab("system");

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

    if (actions.zoomDelta !== 0) {
      // One input tick → one small step (max zoom-out is the default arm).
      this.cameraDistance = clamp(
        this.cameraDistance + Math.sign(actions.zoomDelta) * CAMERA_ZOOM_STEP,
        CAMERA_DISTANCE_MIN,
        CAMERA_DISTANCE_MAX,
      );
    }

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
        this.avatar.play("attack", this.equippedWeaponDef?.attackAnim);
        const ranged =
          this.equippedWeaponDef?.weaponType === "bow" || this.equippedWeaponDef?.weaponType === "crossbow";
        sound.play(ranged ? "bowShot" : "swing", { classId: this.selfClassId });
      }
      if (actions.dodgePressed) this.tryDodge(actions);
      if (actions.interactPressed) {
        if (this.interactNodeId) {
          this.avatar.play("gather");
          // Gather feedback: node shake, chip particles, tool sound.
          if (!this.interactNodeId.startsWith("poi_") && this.nodes) {
            this.nodes.hitNode(this.interactNodeId);
            const nt = this.nodes.nodes.get(this.interactNodeId)?.node.type;
            sound.play(nt === "tree" ? "chop" : nt === "rock" ? "mine" : "pick");
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
    // YXZ: yaw to face camera, then pitch for swim aim (look down → nose down).
    this.avatar.group.rotation.order = "YXZ";
    this.avatar.group.rotation.y = this.cameraYaw;
    this.avatar.group.rotation.x = this.swimBodyPitch;
    this.avatar.group.rotation.z = 0;
    if (this.mountMesh) {
      this.mountMesh.group.position.set(rx, ry, rz);
      this.mountMesh.group.rotation.y = this.cameraYaw;
    }
    this.animateSelf(dt, actions);
    this.updateCamera(rx, ry, rz);
    this.syncAuthoredRegionNodes();
    this.nodes?.update(rx, rz, now, dt);
    // Mirror the local player's lasting positive buffs (HoTs, shields, haste)
    // as auras on their own body -- see CharacterAuras.syncBuffs.
    this.entities.syncSelfBuffs(this.avatar.group, ui.self?.auras.map((a) => a.auraId) ?? []);
    this.entities.update(now, dt, this.camera);
    this.tickClientSpellQueue();
    if (now - this.interactPromptAt >= INTERACT_PROMPT_INTERVAL_MS) {
      this.interactPromptAt = now;
      this.updateInteractPrompt();
    }
    this.updateDayNight(rx, rz, dt);
    this.skyDome.update(dt, this.camera);

    this.renderer.render(this.scene, this.camera);
    // Yield to the browser so this frame can paint before ADT/village work.
    // setTimeout(0) runs after paint; rAF-sync streaming blocked compositing.
    this.streamArgs = { x: rx, z: rz, dt };
    if (!this.streamTimer) {
      this.streamTimer = window.setTimeout(() => {
        this.streamTimer = 0;
        if (this.disposed) return;
        const args = this.streamArgs;
        if (args) this.updateZoneAndStreaming(args.x, args.z, args.dt);
      }, 0);
    }
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

  private updateZoneAndStreaming(x: number, z: number, dt = 0.016): void {
    // Dungeons take priority while the server says we're in one; otherwise
    // the continent streamer owns the scene (no procedural overworld).
    const inDungeon = ui.dungeonState !== null;
    this.insideDungeonPortal = inDungeon ? dungeonPortalAt(x, z) : null;

    if (inDungeon && ui.dungeonState) {
      const zone = zoneAt(x, z, true);
      ui.enterZone(zone.id, zone.name, zone.subtitle);
      if (this.activeDungeonPortalId !== (this.insideDungeonPortal?.id ?? this.activeDungeonPortalId)) {
        // Keep existing dungeon group if portal id unknown; layout from state.
      }
      if (ui.dungeonState && !this.dungeonRenderer && this.insideDungeonPortal) {
        if (this.activeDungeonGroup) {
          this.scene.remove(this.activeDungeonGroup);
          this.disposeHierarchy(this.activeDungeonGroup);
        }
        this.activeDungeonPortalId = this.insideDungeonPortal.id;
        this.activeDungeonGroup = new THREE.Group();
        const layout = generateDungeonLayout(this.insideDungeonPortal.id);
        this.dungeonRenderer = new DungeonInteriorRenderer(this.activeDungeonGroup, layout);
        this.scene.add(this.activeDungeonGroup);
      }
      if (this.dungeonRenderer) this.dungeonRenderer.update(x, z);
      return;
    }

    // Left dungeon — tear down interior mesh if still present.
    if (this.dungeonRenderer) {
      this.dungeonRenderer.destroy();
      this.dungeonRenderer = null;
    }
    if (this.activeDungeonGroup) {
      this.scene.remove(this.activeDungeonGroup);
      this.disposeHierarchy(this.activeDungeonGroup);
      this.activeDungeonGroup = null;
      this.activeDungeonPortalId = null;
    }

    const regionId = ui.regionState?.regionId ?? this.activeRegionId ?? this.regionCatalog[0]?.id;
    if (!regionId) return;

    ui.enterZone(
      `region_${regionId}`,
      ui.regionState?.regionName ?? this.regionNameMap.get(regionId) ?? "Region",
      "",
    );

    if (!this.continent || !this.continent.getLayer(regionId)) {
      if (!this.regionEnterPromise) {
        this.regionEnterPromise = this.enterRegionInterior(regionId);
        void this.regionEnterPromise.finally(() => {
          if (this.activeRegionId === regionId) this.regionEnterPromise = null;
        });
      }
    } else if (this.activeRegionId !== regionId) {
      this.bindPrimaryRegion(regionId);
    }

    if (this.continent && !this.regionEnterPromise) {
      const now = performance.now();
      const moved =
        !Number.isFinite(this.continentSyncAt.x) ||
        Math.hypot(x - this.continentSyncAt.x, z - this.continentSyncAt.z) > 24;
      if (moved || now - this.continentSyncAt.t > 1500) {
        this.continentSyncAt = { x, z, t: now };
        void this.continent.syncAround(x, z, this.continentCatalog(), { urgentId: regionId });
      }
    }
    this.continent?.update(dt, this.sun, x, z, this.camera);
  }

  /** Mount the continent streamer around the player. Neighbor regions stay
   *  resident across seams — only the first entry (or a far teleport) shows
   *  a loading screen. */
  private async enterRegionInterior(regionId: string): Promise<void> {
    const alreadyMounted = !!this.continent?.getLayer(regionId);
    const showLoading = !alreadyMounted;
    const parentLoading = ui.loading;
    if (showLoading && !parentLoading) {
      ui.loading = true;
      ui.loadingMessage = "Loading region…";
      ui.loadingProgress = 10;
    }

    try {
      // Region catalog is already loaded by preloadAndEnter before we're called;
      // only fall back if somehow we arrive here outside that flow.
      if (this.regionCatalog.length === 0) await this.loadRegionCatalog();
      const continent = this.ensureContinent();

      if (showLoading || parentLoading) {
        ui.loadingProgress = Math.max(ui.loadingProgress, 75);
        ui.loadingMessage = "Streaming terrain & assets…";
      }

      await continent.syncAround(this.move.x, this.move.z, this.continentCatalog(), {
        urgentId: regionId,
      });

      // Left the continent while loading.
      if (!ui.regionState?.regionId) {
        if (showLoading && !parentLoading) ui.loading = false;
        return;
      }

      this.bindPrimaryRegion(ui.regionState.regionId);
      const layer = continent.getLayer(regionId);
      if (layer) {
        const local = worldToRegionLocal(layer.blueprint, this.move.x, this.move.z);
        layer.renderer.warmAround(local.x, local.z);
      }

      this.move.y = this.continentGroundAt(this.move.x, this.move.z) + 0.05;
      this.move.vy = 0;
      this.move.grounded = true;
      this.posError.set(0, 0, 0);
      this.tickRenderFrom.x = this.move.x;
      this.tickRenderFrom.y = this.move.y;
      this.tickRenderFrom.z = this.move.z;

      if (showLoading || parentLoading) {
        ui.loadingMessage = "Warming 360° graphics & shaders…";
        ui.loadingProgress = 95;
        this.prewarm360GpuPass();
        ui.loadingProgress = 100;
        if (!parentLoading) ui.loading = false;
      }
    } catch (e) {
      console.error("[Game] Continent enter failed", e);
      if (showLoading && !parentLoading) ui.loading = false;
    } finally {
      this.regionEnterPromise = null;
    }
  }

  /** Perform a 360-degree GPU pre-warm sweep pass before dropping the loading screen.
   *  Rotates the camera through 8 cardinal & diagonal angles around the player pose,
   *  updating continent streamers, grass, and rendering 1 frame at each angle.
   *  This pre-compiles all WebGL shaders, terrain splat maps, foliage textures,
   *  creature models, and shadow map depth buffers 360° around the player, making
   *  subsequent camera turns 100% stutter-free. */
  private prewarm360GpuPass(): void {
    if (!this.renderer || !this.scene || !this.camera) return;
    const px = this.move.x;
    const py = this.move.y;
    const pz = this.move.z;
    const origYaw = this.cameraYaw;

    try {
      // --- Pass 1: compile shaders ---
      // Sweep 8 angles and compile() at each so WebGL programs for every
      // material visible in any direction are built before the player can turn.
      const angles = [
        0,
        Math.PI / 4,
        Math.PI / 2,
        (3 * Math.PI) / 4,
        Math.PI,
        (5 * Math.PI) / 4,
        (3 * Math.PI) / 2,
        (7 * Math.PI) / 4,
      ];

      for (const angle of angles) {
        this.cameraYaw = angle;
        this.updateCamera(px, py, pz);
        if (this.continent) {
          this.continent.update(0, this.sun, px, pz, this.camera);
        }
        this.renderer.compile(this.scene, this.camera);
      }

      // --- Pass 2: render (offscreen-equivalent) to upload texture data to VRAM ---
      // Three.js lazily uploads texture data on the first real render() where a
      // texture is bound. compile() only uploads shader programs, NOT textures.
      // A single render() sweep at original yaw forces all visible texture uploads
      // before the loading screen drops, eliminating first-rotation stutter.
      this.cameraYaw = origYaw;
      this.updateCamera(px, py, pz);
      const target = new THREE.WebGLRenderTarget(512, 512);
      this.renderer.setRenderTarget(target);
      for (const angle of angles) {
        this.cameraYaw = angle;
        this.updateCamera(px, py, pz);
        this.renderer.render(this.scene, this.camera);
      }
      this.renderer.setRenderTarget(null);
      target.dispose();
    } catch (e) {
      console.warn("[Game] prewarm360GpuPass completed with warning:", e);
    } finally {
      this.cameraYaw = origYaw;
      this.updateCamera(px, py, pz);
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
    const input = {
      moveX: 0,
      moveZ: 0,
      jump: false,
      sprint: false,
      crouch: false,
      block: false,
      lookPitch: this.cameraPitch,
      revivingId: null,
    };
    this.pending.push({ seq, ...input, mount: ui.self?.mount ?? null });
    this.connection.send({ t: "input", seq, ...input, yaw, pitch: this.cameraPitch });
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
      crouch: actions.crouch,
      block: actions.block,
      lookPitch: this.cameraPitch,
      revivingId: actions.interactHeld ? this.reviveTargetId : null,
    };
    this.jumpQueued = false;
    const mount = ui.self?.mount ?? null;

    const inDungeon = ui.dungeonState !== null;
    const inContinent = this.continent !== null && ui.regionState !== null;
    const groundAt = inContinent ? this.continentGroundAt : undefined;
    const waterDepthAt = inContinent ? this.continentWaterDepthAt : undefined;
    const regionHeightmap = !inContinent ? this.regionRenderer?.heightmap : undefined;
    const regionAssets = inContinent
      ? this.continent!.collidersWorld()
      : this.regionRenderer
        ? [
            ...regionAssetColliders(this.regionRenderer.assets),
            ...regionVolumeColliders(this.regionRenderer.terrainVolumes ?? []),
            ...regionBarrierColliders(this.regionRenderer.blueprint.barrierVolumes),
          ]
        : undefined;
    // True-geometry (BVH) collision closures (continent only) — same as the
    // authoritative server so prediction doesn't rubber-band at walls/decks.
    const meshResolve = inContinent ? this.continent!.meshResolveWorld : undefined;
    const meshGroundBelow = inContinent ? this.continent!.meshGroundBelowWorld : undefined;
    const seq = ++this.inputSeq;
    this.pending.push({
      seq,
      ...input,
      mount,
      inDungeon,
      regionHeightmap,
      regionAssets,
      groundAt,
      waterDepthAt,
    });
    if (this.pending.length > 120) this.pending.shift();

    // Predict with the mount so speed matches the server; the wire message
    // omits mount (server is authoritative on mount state).
    this.move = stepMovement(
      this.move,
      { ...input, mount, inDungeon, regionHeightmap, regionAssets, groundAt, waterDepthAt, meshResolve, meshGroundBelow },
      TICK_DT,
    );
    this.connection.send({
      t: "input",
      seq,
      moveX: input.moveX,
      moveZ: input.moveZ,
      jump: input.jump,
      sprint: input.sprint,
      crouch: input.crouch,
      block: input.block,
      revivingId: input.revivingId,
      yaw: this.cameraYaw,
      pitch: this.cameraPitch,
    });
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

    // Continent play is outside the legacy overworld AABB — do not clamp to
    // WORLD_* (that was yanking dodges to x=±300 / another region).
    const inContinent = this.continent !== null && ui.regionState !== null;
    const tx = inContinent ? rawTx : clamp(rawTx, WORLD_MIN_X, WORLD_MAX_X);
    const tz = inContinent ? rawTz : clamp(rawTz, WORLD_MIN_Z, WORLD_MAX_Z);

    this.move.x = tx;
    this.move.z = tz;
    this.move.y = inContinent
      ? this.continentGroundAt(tx, tz)
      : Math.max(oldY, terrainHeight(tx, tz));

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
    sound.play("dodge", { volume: 0.75, classId: this.selfClassId });

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
    // jump > cast > swim > idle. vy is only ever nonzero mid-jump/fall --
    // swimming pins it to exactly 0 even though `grounded` is also false
    // there, so checking vy (not grounded) keeps the jump pose from showing
    // while treading water.
    const regionHm = this.continent ? undefined : this.regionRenderer?.heightmap;
    const groundAt = this.continent ? this.continentGroundAt : undefined;
    const waterDepthAt = this.continent ? this.continentWaterDepthAt : undefined;
    const swimming = isSwimmingAt(this.move.x, this.move.y, this.move.z, regionHm, groundAt, waterDepthAt);
    const underwater = isUnderwaterAt(this.move.x, this.move.y, this.move.z, regionHm, groundAt, waterDepthAt);
    const waterHere = waterAt(this.move.x, this.move.z, regionHm, groundAt, waterDepthAt);
    const camUnder =
      swimming && waterHere.depth > 0 && this.camera.position.y < waterHere.surface - 0.05;
    ui.underwater = !ui.self?.dead && (underwater || camUnder);
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
              : swimming
                ? "swim"
                : "idle";
    const speed = this.lastAnimSpeed * (actions.sprint ? 6.8 : 4.6);
    // Body pitch follows the camera while swimming (continuous, not binary
    // up/down clips). Neutral at the default orbit pitch; look down → dive.
    const SWIM_NEUTRAL_CAM = -0.35;
    const pitchTarget = swimming
      ? clamp(-(this.cameraPitch - SWIM_NEUTRAL_CAM) * 1.15, -1.05, 1.2)
      : 0;
    this.swimBodyPitch += (pitchTarget - this.swimBodyPitch) * Math.min(1, dt * 9);
    if (Math.abs(this.swimBodyPitch) < 0.001) this.swimBodyPitch = 0;

    // Stroke intensity only — angle comes from swimBodyPitch above.
    let swimVert = 0;
    if (swimming && waterHere.depth > 0) {
      const floatY = waterHere.surface - SWIM_FLOAT_OFFSET;
      const belowTread = this.move.y < floatY - 0.12;
      if ((actions.jump || this.cameraPitch > 0.08) && belowTread) swimVert = 1;
      else if (actions.crouch || this.cameraPitch < -0.42) swimVert = -1;
    }
    const logical = logicalFromState(
      serverAnim,
      swimming && swimVert !== 0 ? Math.max(speed, 2) : speed,
      3.5,
      actions.moveX,
      actions.moveY,
      swimVert,
    );
    this.avatar.setLocomotionSpeed(speed, 3.5);
    const overrides =
      logical === "cast"
        ? this.equippedWeaponDef?.castAnim
        : logical === "attack"
          ? this.equippedWeaponDef?.attackAnim
          : undefined;
    this.avatar.play(logical, overrides);
    this.avatar.update(dt);

    // Footsteps: same clip bank for walk/sprint; only cadence (+ slight rate) changes.
    // Skip while swimming — feet aren't contacting ground.
    const isLoco =
      !ui.self?.dead &&
      !ui.self?.sitting &&
      !swimming &&
      this.move.grounded &&
      this.move.vy === 0 &&
      this.lastAnimSpeed > 0.18 &&
      serverAnim === "idle";
    if (isLoco) {
      const stepEvery = actions.sprint ? 0.32 : 0.48;
      this.footstepAccum += dt * (0.65 + this.lastAnimSpeed);
      if (this.footstepAccum >= stepEvery) {
        this.footstepAccum = 0;
        const regionWater = this.continent
          ? this.continentWaterDepthAt(this.move.x, this.move.z)
          : this.regionRenderer != null
            ? sampleRegionWaterDepth(this.regionRenderer.heightmap, this.move.x, this.move.z)
            : 0;
        const surface = resolveFootSurface({
          x: this.move.x,
          y: this.move.y,
          z: this.move.z,
          inRegion: !!ui.regionState,
          inDungeon: !!this.insideDungeonPortal,
          regionWaterDepth: regionWater,
        });
        sound.play("footstep", {
          surface,
          volume: actions.sprint ? 0.62 : 0.5,
          playbackRate: actions.sprint ? 1.08 : 1,
        });
      }
    } else {
      this.footstepAccum = 0;
    }
  }

  private updateCamera(px: number, py: number, pz: number): void {
    const cy = this.cameraYaw;
    const cp = this.cameraPitch;

    let distance = this.cameraDistance;

    // Inside regions: pull the camera in when the arm hits solid walls so
    // interiors / upstairs rooms stay usable instead of clipping through.
    if (this.continent || this.regionRenderer) {
      const colliders = this.continent
        ? this.continent.collidersWorld()
        : [
            ...regionAssetColliders(this.regionRenderer!.assets),
            ...regionVolumeColliders(this.regionRenderer!.terrainVolumes ?? []),
            ...regionBarrierColliders(this.regionRenderer!.blueprint.barrierVolumes),
          ];
      const headY = py + 1.5;
      for (let t = 0.6; t < distance; t += 0.35) {
        const sx = px - Math.sin(cy) * (t * Math.cos(cp));
        const sy = headY - t * Math.sin(cp);
        const sz = pz - Math.cos(cy) * (t * Math.cos(cp));
        let blocked = false;
        for (const c of colliders) {
          // Invisible barriers use a huge circumradius for player OBB tests —
          // never treat them as camera blockers (they'd pin the arm at ~1m).
          if (c.climbable || c.solid || c.radius <= 0) continue;
          if (c.halfX !== undefined && c.halfZ !== undefined) {
            if (!pointInColliderXZ(sx, sz, c, 0.15)) continue;
          } else {
            const dx = sx - c.x;
            const dz = sz - c.z;
            if (dx * dx + dz * dz >= c.radius * c.radius) continue;
          }
          if (sy >= c.baseY - 0.2 && sy <= c.topY + 0.3) {
            blocked = true;
            break;
          }
        }
        if (blocked) {
          distance = Math.max(0.9, t - 0.25);
          break;
        }
      }
    }

    let targetX = px - Math.sin(cy) * (distance * Math.cos(cp));
    let targetZ = pz - Math.cos(cy) * (distance * Math.cos(cp));
    // Standard orbit: look down (negative pitch) raises the camera and aims
    // into the water — same as land. Do not invert Y while swimming.
    let targetY = py + CAMERA_HEIGHT - distance * Math.sin(cp);

    const regionHm = this.continent ? undefined : this.regionRenderer?.heightmap;
    const groundAt = this.continent ? this.continentGroundAt : undefined;
    const waterDepthAt = this.continent ? this.continentWaterDepthAt : undefined;
    const swimming = isSwimmingAt(px, py, pz, regionHm, groundAt, waterDepthAt);
    const underwater = isUnderwaterAt(px, py, pz, regionHm, groundAt, waterDepthAt);

    if (this.continent || this.regionRenderer) {
      const h = this.continent
        ? this.continentGroundAt(px, pz)
        : this.regionRenderer!.heightAt(px, pz);
      const wd = this.continent
        ? this.continentWaterDepthAt(px, pz)
        : sampleRegionWaterDepth(this.regionRenderer!.heightmap, px, pz);
      targetY = Math.min(targetY, py + 2.7);
      // Stay above terrain, but do not clamp to the water surface while
      // swimming/diving — otherwise the camera can never go underwater.
      const floorY = h + 0.45;
      if (swimming || underwater) {
        targetY = Math.max(targetY, floorY);
      } else {
        targetY = Math.max(targetY, floorY, h + wd + 0.35);
      }
    } else if (this.insideDungeonPortal) {
      const h = dungeonFloorHeightAt(px, pz);
      if (h !== null) {
        targetY = Math.min(targetY, py + 2.7);
        targetY = Math.max(targetY, h + 0.6);
      }
    } else {
      const ground = terrainHeight(targetX, targetZ);
      if (swimming || underwater) {
        targetY = Math.max(targetY, ground + 0.45);
      } else {
        targetY = Math.max(targetY, ground + 0.6, WATER_LEVEL + 0.4);
      }
    }

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

    // Lootable corpse nearby? (High priority so mobs killed near nodes, NPCs, or water take precedence)
    const corpse = this.entities.nearestLootableCorpse(this.move.x, this.move.y, this.move.z, 6.0);
    if (corpse) {
      ui.interactLabel = `Loot ${corpse.name}`;
      this.lootCorpseId = corpse.id;
      this.interactNodeId = null;
      return;
    }
    this.lootCorpseId = null;

    const node = this.nodes.findTarget(this.move.x, this.move.y, this.move.z, this.cameraYaw, GATHER_RANGE);
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
    // Exit dungeon portal nearby?
    if (this.insideDungeonPortal) {
      const layout = generateDungeonLayout(this.insideDungeonPortal.id);
      if (dist2D(this.move.x, this.move.z, layout.entryPoint.x, layout.entryPoint.z) < 4.5) {
        ui.interactLabel = "Leave Dungeon";
        this.interactNodeId = "poi_dungeon_exit";
        return;
      }
    }
    // Shrine nearby?
    if (this.settlements) {
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
    }
    // If inside a region, check inter-region portal links and region exit
    if (this.activeRegionId && this.regionRenderer) {
      const activeBp = this.regionRenderer.blueprint;
      if (activeBp?.portals) {
        for (const portalLink of activeBp.portals) {
          const linkW = regionLocalToWorld(activeBp, portalLink.localX, portalLink.localZ);
          if (dist2D(this.move.x, this.move.z, linkW.x, linkW.z) <= 6.0) {
            const destName = this.regionNameMap.get(portalLink.targetRegionId) || portalLink.name || "Region Portal";
            ui.interactLabel = `Travel to ${destName}`;
            this.interactNodeId = `poi_region_link_${portalLink.id}`;
            return;
          }
        }
      }
      if (activeBp?.npcs) {
        for (const rNpc of activeBp.npcs) {
          const npcW = regionLocalToWorld(activeBp, rNpc.localX, rNpc.localZ);
          if (dist2D(this.move.x, this.move.z, npcW.x, npcW.z) <= 6.0) {
            ui.interactLabel = `Talk to ${rNpc.name}`;
            this.interactNodeId = `rnpc_${rNpc.id}`;
            return;
          }
        }
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
  private lootCorpseId: string | null = null;
  private reviveTargetId: string | null = null;
  private nearCampfire = false;

  private nearWater(): boolean {
    if (this.dungeonRenderer) return false;
    if (this.continent) {
      return isNearWaterAt(
        this.move.x,
        this.move.y,
        this.move.z,
        undefined,
        3,
        this.continentGroundAt,
        this.continentWaterDepthAt,
      );
    }
    return isNearWaterAt(this.move.x, this.move.y, this.move.z, this.regionRenderer?.heightmap);
  }

  private doInteract(): void {
    const targetId = this.entities.getTargetId();
    const targetEntity = targetId ? this.entities.getEntity(targetId) : null;
    const corpseId =
      targetEntity && targetEntity.kind === "mob" && targetEntity.hp <= 0
        ? targetEntity.id
        : this.lootCorpseId;

    if (corpseId) {
      if (ui.autoLoot) {
        this.connection.send({ t: "lootCorpse", mobId: corpseId, lootAll: true });
      } else {
        this.connection.send({ t: "lootCorpse", mobId: corpseId });
      }
      return;
    }
    if (this.interactNodeId) {
      this.connection.send({ t: "interact", nodeId: this.interactNodeId });
    } else if (ui.self?.sitting || this.nearCampfire) {
      this.connection.send({ t: "sit" });
    } else if (this.nearWater()) {
      this.connection.send({ t: "drink" });
    }
  }

  private updateDayNight(px: number, pz: number, dt = 1 / 60): void {
    const tod = ui.timeOfDay;
    this.skyDome.setTimeOfDay(tod);
    this.skyDome.group.visible = !this.insideDungeonPortal;

    if (this.regionRenderer) {
      // Region grading spatially blends near seams; TOD timeline drives the
      // layered skydome + sun elevation (WoW-style LightData).
      const sources = this.continent
        ? this.continentCatalog().filter((bp) => !!bp.colorGrading && bp.gridSize >= 2 && bp.pitch > 0)
        : [this.regionRenderer.blueprint];
      const target =
        sampleBlendedAtmosphere(sources, px, pz, undefined, tod) ??
        atmosphereFromGrading(this.regionRenderer.colorGrading, tod);
      if (!this.atmosphereDisplay) {
        this.atmosphereDisplay = cloneAtmosphere(target);
      } else {
        const k = 1 - Math.exp(-dt * REGION_ATMOSPHERE_LERP_RATE);
        this.atmosphereDisplay = lerpAtmosphere(this.atmosphereDisplay, target, k);
      }
      const a = this.atmosphereDisplay;
      this.sun.intensity = a.sunIntensity;
      this.sun.color.copy(a.sunColor);
      this.ambient.intensity = a.ambientIntensity;
      this.ambient.color.copy(a.ambientColor);
      this.fillLight.color.copy(a.skyMidColor);
      this.fillLight.groundColor.copy(a.fillColor);
      this.fillLight.intensity = a.fillIntensity;
      this.renderer.toneMappingExposure = a.exposure;
      (this.scene.background as THREE.Color).set(0x02040a);

      // Key light follows timeline elevation, but stays a soft fill after
      // sundown so meshes don't flip to a harsh under-lit night angle.
      const elevRad = (a.layers.sunElevation * Math.PI) / 180;
      const az = tod * Math.PI * 2;
      const dist = 120;
      const elevY = Math.sin(Math.max(elevRad, 0.12)) * dist;
      this.sun.position.set(
        px + Math.cos(az) * dist * Math.cos(Math.max(elevRad, 0)),
        Math.max(28, elevY),
        pz + Math.sin(az) * dist * Math.cos(Math.max(elevRad, 0)) * 0.35 + 40,
      );
      this.sun.target.position.set(px, 0, pz);

      this.skyDome.setAtmosphere(a);

      let fogWeight = 0;
      let fogColor = a.fogColor.clone();
      const camY = this.camera.position.y;
      const camX = this.camera.position.x;
      const camZ = this.camera.position.z;
      if (this.continent) {
        this.continent.forEachLayer((layer) => {
          const local = worldToRegionLocal(layer.blueprint, camX, camZ);
          const sample = layer.renderer.fogInfluenceAt(local.x, camY, local.z, a.fogColor);
          if (sample.weight > fogWeight) {
            fogWeight = sample.weight;
            fogColor = sample.color;
          }
        });
      } else {
        const fogLocalPos = worldToRegionLocal(this.regionRenderer.blueprint, camX, camZ);
        const fogLocal = this.regionRenderer.fogInfluenceAt(
          fogLocalPos.x,
          camY,
          fogLocalPos.z,
          a.fogColor,
        );
        fogWeight = fogLocal.weight;
        fogColor = fogLocal.color;
      }
      const baseDensity = clampRegionFogDensity(a.fogDensity);
      const density = Math.min(0.12, (baseDensity + fogWeight * 0.04) * this.fogScale);
      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.color.copy(fogColor);
        this.scene.fog.density = density;
      } else {
        this.scene.fog = new THREE.FogExp2(fogColor.getHex(), density);
      }

      const waterEnv = {
        skyColor: a.skyMidColor,
        fogColor: a.fogColor,
        groundTint: a.groundTint,
      };
      if (this.continent) {
        this.continent.forEachLayer((layer) => layer.renderer.syncWaterEnvironment(waterEnv));
      } else {
        this.regionRenderer.syncWaterEnvironment(waterEnv);
      }
      return;
    }
    this.atmosphereDisplay = null;
    // Leave region fill / exposure so overworld day-night stays consistent.
    this.fillLight.intensity = 0;
    this.renderer.toneMappingExposure = 1;
    // A region visit may have swapped scene.fog to a FogExp2 above --
    // restore the linear Fog the rest of this function assumes before
    // falling through to the dungeon/outdoor branches.
    if (!(this.scene.fog instanceof THREE.Fog)) {
      const fog = overworldFogForRing(this.graphics.streamRing);
      this.scene.fog = new THREE.Fog(0x87b5d9, fog.near, fog.far);
    }
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
      const fog = overworldFogForRing(this.graphics.streamRing);
      this.scene.fog.near = fog.near;
      this.scene.fog.far = fog.far;
    }
    this.ambient.color.set(0x8899bb);

    const t = tod;
    const angle = t * Math.PI * 2;
    const elevation = Math.sin(angle);
    this.sun.position.set(px + Math.cos(angle) * 120, Math.max(20, elevation * 140), pz + 40);
    this.sun.target.position.set(px, 0, pz);
    const dayness = clamp(elevation * 1.6 + 0.25, 0.04, 1);
    this.sun.intensity = 2.4 * dayness;
    this.ambient.intensity = 0.2 + 0.6 * dayness;

    // Fallback outdoor path: sunny timeline when no region is mounted.
    const outdoor = atmosphereFromGrading(
      { ...REGION_COLOR_PRESETS.grassland, skyPreset: "sunny" },
      tod,
    );
    this.skyDome.setAtmosphere(outdoor);
    (this.scene.background as THREE.Color).set(0x02040a);
    this.scene.fog!.color.copy(outdoor.fogColor);
    this.clouds?.setDayness?.(dayness);
    if (this.water?.mesh.material instanceof THREE.MeshLambertMaterial) {
      applyWaterEnvironment(this.water.mesh.material, {
        skyColor: outdoor.skyMidColor,
        fogColor: outdoor.fogColor,
        groundTint: outdoor.groundTint,
      });
    }
  }

  // ============ hooks for HUD ============

  sendChat(text: string, channel: "realm" | "region" | "party" = "realm"): void {
    this.connection.send({ t: "chat", channel, text });
  }

  sendParty(action: "invite" | "accept" | "decline" | "leave" | "disband" | "tag", name?: string, tag?: string): void {
    if (action === "accept" || action === "decline") {
      ui.pendingInvite = null;
    }
    this.connection.send({ t: "party", action, name, tag });
  }

  sendPartyTag(targetName: string, tag: string): void {
    this.connection.send({ t: "party", action: "tag", name: targetName, tag });
  }

  sendFriend(action: "add" | "accept" | "decline" | "remove", targetName: string): void {
    this.connection.send({ t: "friend", action, targetName });
  }

  sendPvp(enabled: boolean): void {
    this.connection.send({ t: "pvp", enabled });
  }

  sendVendorBuy(npcId: string, itemId: string, qty = 1): void {
    this.connection.send({ t: "vendor", action: "buy", npcId, itemId, qty });
  }

  sendVendorSell(npcId: string, container: string, slot: number, qty = 1): void {
    this.connection.send({ t: "vendor", action: "sell", npcId, container, slot, qty });
  }

  /** Push Display → nameplate toggles to the local plate + remote entities. */
  syncNameplateVisibility(): void {
    this.selfNameplate.visible = ui.showPlayerNameplates;
    this.entities.showPlayerNameplates = ui.showPlayerNameplates;
    this.entities.showMobNameplates = ui.showMobNameplates;
    this.entities.syncNameplateVisibility();
  }

  /**
   * Apply graphics prefs live (resolution, shadows, stream/grass distance, fog).
   * Antialiasing only takes effect when the WebGL context is created (enter world).
   */
  applyGraphicsSettings(partial?: Partial<GraphicsSettings>): void {
    const next = clampGraphicsSettings({ ...this.graphics, ...(partial ?? {}), ...ui.graphics });
    this.graphics = next;
    this.fogScale = next.fogScale;

    this.renderer.setPixelRatio(effectivePixelRatio(next, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = next.shadowsEnabled;
    this.sun.castShadow = next.shadowsEnabled;
    if (
      this.sun.shadow.mapSize.x !== next.shadowMapSize ||
      this.sun.shadow.mapSize.y !== next.shadowMapSize
    ) {
      this.sun.shadow.mapSize.set(next.shadowMapSize, next.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }

    this.camera.far = cameraFarForStreamRing(next.streamRing);
    this.camera.updateProjectionMatrix();

    const streamOpts = {
      streamRing: next.streamRing,
      grassDrawDistance: next.grassDrawDistance,
    };
    this.continent?.setGraphicsOptions(streamOpts);
    this.regionRenderer?.applyGraphicsSettings(streamOpts);

    if (partial?.antialias !== undefined && next.antialias !== this.antialiasActive) {
      ui.toast("Antialiasing applies next time you enter the world");
    }
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
    qty?: number,
  ): void {
    this.connection.send({ t: "moveItem", fromContainer: fc, fromSlot: fs, toContainer: tc, toSlot: ts, qty });
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

  sendLootCorpse(mobId: string, slot?: number, lootAll?: boolean): void {
    this.connection.send({ t: "lootCorpse", mobId, slot, lootAll });
    sound.play("loot");
  }

  sendClaimLevelReward(rewardId: string | null = null): void {
    this.connection.send({ t: "claimLevelReward", rewardId });
    sound.play("loot");
  }

  setUiMode(open: boolean): void {
    this.input.uiMode = open;
  }

  /** Open the character screen directly on `tab`, or close it if it's
   *  already open showing that same tab -- shared by every key/button that
   *  jumps to a specific tab (Tab/I, L, K, J, U, O, gamepad Start). */
  toggleCharacterTab(tab: CharacterTab): void {
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

  /** Resolve a region's world origin for UI maps (minimap / overlays). */
  regionWorldOriginOf(regionId: string): { x: number; z: number } | null {
    const bp =
      this.regionBlueprintCache.get(regionId) ??
      this.regionCatalog.find((r) => r.id === regionId);
    if (!bp) return null;
    return { x: bp.worldOriginX ?? 0, z: bp.worldOriginZ ?? 0 };
  }

  /** Lightweight continent stubs for the world map (layout + optional overlays). */
  getRegionMapCatalog(): RegionMapEntry[] {
    return this.regionCatalog.map((stub) => {
      const full = this.regionBlueprintCache.get(stub.id);
      const src = full ?? stub;
      return {
        id: src.id,
        name: src.name,
        biome: src.biome,
        gridSize: src.gridSize,
        pitch: src.pitch,
        worldOriginX: src.worldOriginX ?? 0,
        worldOriginZ: src.worldOriginZ ?? 0,
        portalWorldX: src.portalWorldX,
        portalWorldZ: src.portalWorldZ,
        isStartingRegion: src.isStartingRegion,
        entryLocal: src.entryLocal ?? { x: 0, z: 0 },
        colorGrading: src.colorGrading,
        villages: (src.villages ?? []).map((v) => ({
          name: v.name,
          localX: v.localX,
          localZ: v.localZ,
          radius: v.radius,
        })),
        portals: (src.portals ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          localX: p.localX,
          localZ: p.localZ,
          targetRegionId: p.targetRegionId,
        })),
        worldEvents: (src.worldEvents ?? []).map((e) => ({
          id: e.id,
          name: e.name,
          localX: e.localX,
          localZ: e.localZ,
          radius: e.radius,
        })),
        npcs: (src.npcs ?? []).map((n) => ({
          id: n.id,
          name: n.name,
          localX: n.localX,
          localZ: n.localZ,
          title: n.title,
          hasQuests: Boolean(n.quests?.length) || (n.generateProceduralQuests !== false && !n.vendorId),
          vendorId: n.vendorId,
        })),
      };
    });
  }

  /** Ensure the region catalog is loaded (used by the world map). */
  async ensureRegionMapCatalog(): Promise<RegionMapEntry[]> {
    if (this.regionCatalog.length === 0) await this.loadRegionCatalog();
    return this.getRegionMapCatalog();
  }

  /** Full blueprint (with heights) for a region — used by the world map for
   *  painted heightmap thumbnails. Returns cached data, else fetches once. */
  async ensureRegionBlueprint(id: string): Promise<RegionBlueprint | null> {
    const cached = this.regionBlueprintCache.get(id);
    if (cached?.heights?.length) return cached;
    try {
      const res = await fetch(app.apiUrl(`/api/regions/${id}`), { credentials: "include" });
      if (res.ok) {
        const data = (await res.json()) as { blueprint: RegionBlueprint };
        if (data.blueprint?.heights?.length) {
          this.regionBlueprintCache.set(id, data.blueprint);
          return data.blueprint;
        }
      }
    } catch {
      /* fall through */
    }
    return this.regionBlueprintCache.get(id) ?? null;
  }

  get inputManager(): InputManager {
    return this.input;
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(effectivePixelRatio(this.graphics, window.devicePixelRatio));
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
    if (this.streamTimer) {
      clearTimeout(this.streamTimer);
      this.streamTimer = 0;
    }
    this.streamArgs = null;
    this.destroyContinent();
    this.skyDome.dispose();
    this.scene.remove(this.skyDome.group);
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
