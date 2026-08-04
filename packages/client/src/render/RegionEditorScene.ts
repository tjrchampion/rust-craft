import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { SelectionBox } from "three/examples/jsm/interactive/SelectionBox.js";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import { load, AnimatedModel, PLAYER_ANIMS, logicalFromState } from "./gltf";
import { GENDER_MODEL_URLS, CLASS_GENDER } from "./classModels";
import { buildNameplate } from "./models";
import { buildGatherNodeMesh } from "./nodes";
import { measureObjectSolidBox } from "./measureSolidBox";
import {
  type RegionBlueprint,
  type RegionAssetCategory,
  type RegionBiome,
  type RegionColorGrading,
  type RegionRoad,
  type RegionPointLight,
  type RegionFogVolume,
  type RegionFogShape,
  type RegionBarrierVolume,
  type RegionCloud,
  type RegionCloudShape,
  type RegionHouse,
  type RegionNPC,
  type RegionQuest,
  type RegionWorldEvent,
  type RegionResourceNode,
  nodeTypeDef,
  isPlaceableRegionNodeType,
  type ClassId,
  type GrassPatch,
  type GrassExclusion,
  type GrassColor,
  type RegionWind,
  type RegionTerrainVolume,
  type TerrainVolumeShape,
  type TerrainVolumeMaterial,
  type RegionAssetLight,
  type RegionAssetSolidBox,
  sampleRegionWaterDepth,
  REGION_COLOR_PRESETS,
  REGION_ASSET_LIGHT_DEFAULTS,
  isRegionAssetLightModel,
  resolveRegionAssetLight,
  resolveAssetCollision,
  solidBoxColliderFields,
  regionAssetScale,
  regionAssetScaleFields,
  REGION_ASSET_COLLISION_RADIUS,
  REGION_ASSET_COLLISION_HEIGHT,
  isRockLikeAssetModel,
  REGION_TREE_BRUSH,
  pickRandomRegionTreeModel,
  foliageModelToResourceType,
  CLASS_IDS,
  WALK_SPEED,
  SPRINT_SPEED,
  JUMP_VELOCITY,
  GRAVITY,
  MAX_STEP_DOWN,
  WADE_DEPTH,
  SWIM_BODY_OFFSET,
  regionMusicTrackUrl,
  hashString,
  regionBiomeToWorldBiome,
  terrainVolumeRadius,
  terrainVolumeTopY,
  isTerrainStroke,
  strokePointHalfWidth,
  strokePointTopY,
  carveBlocksSurface,
  type TerrainVolumeCarve,
  clampRegionFogDensity,
  REGION_FOG_DENSITY_MIN,
  regionWorldOrigin,
  regionBarrierColliders,
  regionAssetColliders,
  regionVolumeColliders,
  pointInColliderXZ,
  segmentHitsColliderXZ,
  PLAYER_BODY_RADIUS,
  stepMovement,
  TICK_DT,
  mergeQuickGrassSettings,
  DEFAULT_QUICK_GRASS_SETTINGS,
  type QuickGrassSettings,
} from "@rustcraft/shared";
import {
  applyGroundBlendShader,
  regionGroundWeights,
  regionRoadBlendAt,
  buildRegionBlueprintTerrain,
  buildRegionWaterMesh,
  applyWaterEnvironment,
  type RegionWaterMeshField,
} from "./terrain";
import { createQuickGrassField, type QuickGrassField } from "./quickGrass/field";
import { generateHouseAssets, resolveHouseType, expandHousesToAssets, type HouseType } from "./houseGen";
import {
  generateCastleAssets,
  resolveCastleStyle,
  type CastleStyle,
  type CastleSize,
  type CastleHeight,
} from "./castleGen";
import { generateFantasticBuildingAssets, type FantasticBuildingType } from "./fantasticBuildingGen";
import {
  buildRegionCollisionBVH,
  resolveCapsule,
  sampleGroundBelow,
  disposeRegionCollision,
  type RegionCollision,
  type PlacedCollider,
} from "@rustcraft/shared/collision";
import { preloadCollision, getCollisionMesh, collisionModelKey } from "./collisionData";
import type { RegionAsset } from "@rustcraft/shared";
import {
  createTerrainVolumeMesh,
  createTerrainVolumeGhost,
  defaultVolumeScale,
  rebuildTerrainStrokeMesh,
  rebuildTerrainVolumeMesh,
  strokeSizeFromBrush,
} from "./terrainVolumes";
import { createFogVolumeMesh, syncFogVolumeMesh } from "./fogVolumes";
import {
  createBarrierMesh,
  syncBarrierMesh,
  setBarrierSelected,
  setBarrierHandleHover,
  barrierHandleMeshes,
  applyBarrierHandleResize,
  worldToBarrierLocalMeters,
  type BarrierHandleId,
} from "./regionBarriers";
import { createRegionCloudMesh, syncRegionCloudMesh } from "./regionClouds";
import { buildRegionHorizon } from "./regionHorizon";
import { atmosphereFromGrading } from "./regionAtmosphere";
import { SkyDome } from "./skyDome";
import { music } from "../game/music";

export type EditorTransformMode = "translate" | "rotate" | "scale";
export type EditorMarkerKind =
  | "mobSpawn"
  | "resourceNode"
  | "village"
  | "entry"
  | "portal"
  | "npc"
  | "worldEvent";
export type SculptMode = "raise" | "lower" | "mold" | "smooth" | "carve" | null;
export type WaterBrushMode = "add" | "remove" | null;

type CanvasWithScene = HTMLCanvasElement & { __regionEditorScene?: RegionEditorScene };

const ASSET_DIR: Record<RegionAssetCategory, string> = {
  building: "buildings",
  foliage: "foliage",
  prop: "props",
};

/** Soft radial glow used to mark a placed point light -- deliberately not a
 *  solid sphere (that read as a placeable object rather than a light). A
 *  single canvas texture is generated once and shared by every light sprite. */
let glowTexture: THREE.CanvasTexture | null = null;
function getGlowTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.35, "rgba(255,255,255,0.6)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}

const MARKER_COLORS: Record<EditorMarkerKind, number> = {
  mobSpawn: 0xff5533,
  resourceNode: 0x66cc44,
  village: 0xffd23f,
  entry: 0x44dd66,
  portal: 0x9944ff,
  npc: 0x33b5e5,
  worldEvent: 0xff8800,
};

const ARROW_PAN_STEP = 4;
const ARROW_PAN_STEP_FAST = 16;
const TRANSLATE_SNAP = 0.5; // meters
const TRANSLATE_SNAP_FINE = 0.1;
const ROTATE_SNAP = Math.PI / 12; // 15°
const SCALE_SNAP = 0.1;
const NUDGE_STEP = 0.5;
const NUDGE_STEP_FINE = 0.1;

/** Yaw around world +Y. Do not use Euler XYZ `.y` — world-space
 *  TransformControls often decomposes to (-π, ε, -π) where `.y` is near 0
 *  even though the object is rotated ~180°, so saves silently drop rotation. */
const _yawForward = new THREE.Vector3();
function yawFromQuaternion(q: THREE.Quaternion): number {
  _yawForward.set(0, 0, 1).applyQuaternion(q);
  return Math.atan2(_yawForward.x, _yawForward.z);
}

export interface EditorSelection {
  kind: "asset" | "marker" | "light" | "volume" | "fog" | "house" | "barrier" | "cloud";
  id: string;
  model?: string;
  category?: RegionAssetCategory;
  markerKind?: EditorMarkerKind;
  name?: string;
  /** Procedural house archetype (when kind === "house"). */
  houseType?: string;
  radius?: number;
  targetRegionId?: string;
  targetLocalX?: number;
  targetLocalZ?: number;
  npcData?: RegionNPC;
  color?: string;
  intensity?: number;
  distance?: number;
  decay?: number;
  /** Asset-attached light (lanterns). Absent on non-emitter props unless toggled on. */
  lightEnabled?: boolean;
  lightOffsetX?: number;
  lightOffsetY?: number;
  lightOffsetZ?: number;
  fogShape?: RegionFogShape;
  fogDensity?: number;
  fogOpacity?: number;
  fogFeather?: number;
  cloudShape?: RegionCloudShape;
  cloudOpacity?: number;
  driftSpeed?: number;
  bobAmp?: number;
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
  sizeX?: number;
  sizeY?: number;
  sizeZ?: number;
  /** Present when this asset is part of a legacy multi-piece house group. */
  groupId?: string;
  volumeShape?: TerrainVolumeShape;
  volumeMaterial?: TerrainVolumeMaterial;
  frequencyMin?: number;
  difficulty?: number;
  lootAmount?: number;
  mobTypes?: string[];
  /** Pinned mob type for a mobSpawn marker (biome roll when absent). */
  mobType?: string;
  /** Gather node type for a resourceNode marker. */
  nodeType?: string;
  /** Foliage model filename for tree resource nodes (e.g. pine_1.glb). */
  nodeModel?: string;
  bossType?: string;
  durationSec?: number;
  /** Hard-block walking through this asset placement. */
  solid?: boolean;
  /** Mesh-measured local collision box when solid. */
  solidBox?: RegionAssetSolidBox;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

export type EditorContextMenuActionId = "assignResource" | "delete";

export interface EditorContextMenuState {
  x: number;
  y: number;
  title: string;
  actions: { id: EditorContextMenuActionId; label: string }[];
}

interface AssetEntry {
  id: string;
  model: string;
  category: RegionAssetCategory;
  obj: THREE.Object3D;
  /** Shared across every piece of a generated house -- see RegionAsset.groupId. */
  groupId?: string;
  /** Authored / default attached light for emitter props. */
  light?: RegionAssetLight;
  pointLight?: THREE.PointLight;
  /** Editor-only marker so the bulb offset is visible while adjusting. */
  lightMarker?: THREE.Sprite;
  /** Hard-block walking; persisted on RegionAsset.solid. */
  solid?: boolean;
  /** Mesh AABB in model-local space; used with solid for oriented collision. */
  solidBox?: RegionAssetSolidBox;
}

interface VolumeEntry {
  id: string;
  data: RegionTerrainVolume;
  obj: THREE.Mesh;
}

interface MarkerEntry {
  id: string;
  kind: EditorMarkerKind;
  obj: THREE.Object3D;
  name?: string;
  radius?: number;
  targetRegionId?: string;
  targetLocalX?: number;
  targetLocalZ?: number;
  npcData?: RegionNPC;
  ring?: THREE.Mesh;
  animModel?: AnimatedModel;
  frequencyMin?: number;
  difficulty?: number;
  lootAmount?: number;
  mobTypes?: string[];
  /** Single pinned type for mobSpawn markers. */
  mobType?: string;
  /** Gather node type for resourceNode markers. */
  nodeType?: string;
  /** Foliage model filename for tree resource nodes. */
  nodeModel?: string;
  bossType?: string;
  durationSec?: number;
}

interface LightEntry {
  id: string;
  color: string;
  intensity: number;
  distance: number;
  decay: number;
  obj: THREE.Group;
  light: THREE.PointLight;
  bulb: THREE.Sprite;
}

interface FogEntry {
  id: string;
  data: RegionFogVolume;
  mesh: THREE.Mesh;
}

interface BarrierEntry {
  id: string;
  data: RegionBarrierVolume;
  group: THREE.Group;
}

interface BarrierResizeDrag {
  id: string;
  handle: BarrierHandleId;
  planeY: number;
  start: {
    sizeX: number;
    sizeY: number;
    sizeZ: number;
    localX: number;
    localY: number;
    localZ: number;
    yaw: number;
  };
}

interface CloudEntry {
  id: string;
  data: RegionCloud;
  group: THREE.Group;
}

interface HouseEntry {
  id: string;
  data: RegionHouse;
  group: THREE.Group;
}

const DEFAULT_GRID_SIZE = 64;
const DEFAULT_PITCH = 2.5;

/** Standalone THREE.js scene for the region editor -- an OrbitControls-driven
 *  viewport over a real sculptable heightmap terrain where the author raises/
 *  lowers ground, freely places nature/building props, drops mob-spawn and
 *  named-village markers, and color-grades the sky/fog/lighting, then exports
 *  the result as a RegionBlueprint. Modeled directly on DungeonEditorScene's
 *  shell and interaction patterns (OrbitControls/TransformControls/Raycaster,
 *  world-space selection reads, canvas-instance HMR guard, arrow-key pan,
 *  Cmd+D duplicate / Cmd+C+V clipboard) but placement here is freeform over a
 *  continuous sculpted surface rather than a fixed snap grid, since regions
 *  aren't tile-based the way dungeon interiors are. */
export class RegionEditorScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private orbit: OrbitControls;
  private transform: TransformControls;
  private raycaster = new THREE.Raycaster();
  private running = true;

  private ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
  private fillLight = new THREE.HemisphereLight(0xffffff, 0x3a4a2a, 0);
  private sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
  private colorGrading: RegionColorGrading = { ...REGION_COLOR_PRESETS.grassland };
  private meta = {
    id: "",
    name: "New Region",
    biome: "grassland" as RegionBiome,
    portalWorldX: 0,
    portalWorldZ: 0,
    worldOriginX: undefined as number | undefined,
    worldOriginZ: undefined as number | undefined,
    isStartingRegion: false,
    musicTrack: null as string | null,
  };

  private gridSize = DEFAULT_GRID_SIZE;
  private pitch = DEFAULT_PITCH;
  private heights: number[] = new Array(DEFAULT_GRID_SIZE * DEFAULT_GRID_SIZE).fill(0);
  private customTextures: number[] = new Array(DEFAULT_GRID_SIZE * DEFAULT_GRID_SIZE).fill(0);
  private terrainMesh: THREE.Mesh;
  /** Read-only adjacent regions (terrain/volumes/water) for seam moulding. */
  private neighborGroups = new Map<string, THREE.Group>();
  private static readonly CAMERA_FAR_DEFAULT = 800;
  private static readonly CAMERA_FAR_NEIGHBORS = 2800;

  private assets = new Map<string, AssetEntry>();
  private volumes = new Map<string, VolumeEntry>();
  private markers = new Map<string, MarkerEntry>();
  private lights = new Map<string, LightEntry>();
  private fogVolumes = new Map<string, FogEntry>();
  private barrierVolumes = new Map<string, BarrierEntry>();
  private clouds = new Map<string, CloudEntry>();
  private horizonGroup: THREE.Group | null = null;
  /** Procedural houses — one Group each (not dozens of loose assets). */
  private houses = new Map<string, HouseEntry>();
  /** Expanded house pieces for playtest collision (rebuilt on house edits). */
  private houseCollisionAssets: RegionAsset[] = [];
  private entryMarker: MarkerEntry | null = null;

  private armedModel: { model: string; category: RegionAssetCategory } | null = null;
  private armedMarkerKind: EditorMarkerKind | null = null;
  /** Defaults applied to each newly placed mobSpawn marker. */
  private mobSpawnDifficulty = 1;
  private mobSpawnType: string | null = null;
  /** Default type for newly placed resourceNode markers. */
  private resourceNodeType = "rock";
  private armedLightColor: string | null = null;
  private armedFogColor: string | null = null;
  private armedFogShape: RegionFogShape = "sphere";
  private armedBarrier = false;
  private armedCloudShape: RegionCloudShape | null = null;
  /** House-placement tool armed -- next click generates a procedural house
   *  (see houseGen.ts's generateHouseAssets) centered on the clicked ground
   *  point, placed as ordinary building-category assets. Single-click only
   *  (unlike armedModel's click-and-drag painting): a house is dozens of
   *  pieces, so dragging would spam-generate overlapping houses. */
  private armedHouse = false;
  private armedHouseType: HouseType = "random";
  /** Procedural castle tool — next click drops a full curtain-wall keep. */
  private armedCastle = false;
  private armedCastleStyle: CastleStyle = "random";
  private armedCastleSize: CastleSize = 2;
  private armedCastleHeight: CastleHeight = 2;
  /** Procedural fantasy-village building tool — next click drops a whole
   *  building (base + capped body shell + door/windows/etc, see
   *  fantasticBuildingGen.ts) as ordinary building-category assets. */
  private armedFantasticBuilding = false;
  private armedFantasticBuildingType: FantasticBuildingType = "random";
  /** Volume-sculpt brush -- stamps real 3D primitives into the world instead
   *  of deforming the heightmap. `place` drops one shape at a time; `sculpt`
   *  is a continuous drag brush that sprays overlapping stamps along the stroke;
   *  `clay` is Blender-style add/sub on the 3D surface (boulder/block). */
  private volumeStampActive = false;
  private volumeBrushStyle: "place" | "sculpt" | "clay" = "place";
  /** Clay brush polarity — add piles blobs; sub punches carve spheres. */
  private volumeSculptOp: "add" | "sub" = "add";
  private volumeShape: TerrainVolumeShape = "boulder";
  private volumeMaterial: TerrainVolumeMaterial = "rock";
  private volumeGhost: THREE.Mesh | null = null;
  /** Flat ring showing the sculpt-brush footprint while dragging/hovering. */
  private volumeBrushRing: THREE.Mesh | null = null;
  private isVolumeStamping = false;
  /** Last world hit along the current volume stroke -- distance-spaced stamps. */
  private lastVolumeStrokePos: THREE.Vector3 | null = null;
  /** In-progress drag-sculpt stroke (one continuous mesh, finalized on mouseup).
   *  Centerline appends along the mouse path on the starting-height plane so
   *  the ridge tracks the cursor exactly without climbing onto itself. */
  private activeStroke: {
    id: string;
    start: { x: number; y: number; z: number };
    path: Array<{ x: number; y: number; z: number }>;
    mesh: THREE.Mesh;
    data: RegionTerrainVolume;
  } | null = null;
  private sculptMode: SculptMode = null;
  private texturePaintMode: number | null = null;
  private moldTargetHeight: number | null = null;
  /** Last carve stamp position while drag-punching holes (distance-spaced). */
  private lastCarvePos: THREE.Vector3 | null = null;
  private waterBrushMode: WaterBrushMode = null;
  private waterPhysicsSimulating = true;
  private waterHeights: Float32Array = new Float32Array(0);
  /** Grid-index AABB covering every cell that currently (or recently) had
   *  water, kept slightly loose (union-grown, never shrunk except on a full
   *  recompute). stepWaterPhysics() iterates only this region each frame
   *  instead of the entire heightmap -- unbounded, the flow simulation scanned
   *  every cell every frame regardless of how small the actual pond was. */
  private waterActiveBounds: { tx0: number; tx1: number; tz0: number; tz1: number } | null = null;
  private waterFlowScratch: Float32Array | null = null;
  private waterMeshField: RegionWaterMeshField | null = null;
  private waterParticlesGroup = new THREE.Group();
  private waterParticles: { obj: THREE.Mesh; vel: THREE.Vector3; life: number; maxLife: number }[] = [];
  private brushRadius = 8;
  private brushStrength = 1;

  private grassPatches: GrassPatch[] = [];
  /** Fine-grained holes carved by the erase-grass brush -- see
   *  GrassExclusion's doc comment. Kept separate from erasing whole
   *  grassPatches records so a small brush stroke can thin out part of a
   *  large patch without deleting the rest of it. */
  private grassExclusions: GrassExclusion[] = [];
  private grassColor: GrassColor = { bottom: "#4f7c13", top: "#79a01c" };
  private wind: RegionWind = { direction: 0, strength: 1 };
  private grassLength = 1;
  private grassSway = 1;
  private grassSettings: QuickGrassSettings = { ...DEFAULT_QUICK_GRASS_SETTINGS };
  /** Quick Grass field — patch-streamed procedural blades (see quickGrass/). */
  private grassField: QuickGrassField | null = null;
  private grassPreviewGroup = new THREE.Group();
  private skyDome = new SkyDome();
  private grassPreviewDirty = false;
  /** True after any grass paint/erase dab this pointer gesture (for one history push). */
  private grassStrokeDirty = false;
  private lastGrassStrokePos: { x: number; z: number } | null = null;

  private roads: RegionRoad[] = [];
  private roadPaintArmed = false;
  private roadWidth = 4;
  /** Points collected for the road currently being dragged out; folded into
   *  this.roads on mouseup. Also factored into the live texture preview
   *  (see roadBlendAt) so the dirt strip appears while still dragging. */
  private paintingRoad: { x: number; z: number }[] | null = null;

  public activeEscortQuest: { markerId: string; questId: string } | null = null;
  public escortPathTracingActive = false;
  private escortPathGroup = new THREE.Group();

  private selectedIds = new Set<string>();
  private selectionGroup = new THREE.Group();
  private selectionHelpers = new Map<string, THREE.BoxHelper>();
  private nextId = 1;

  private isDraggingToPlace = false;
  private isDraggingWaypoint = false;
  private isSculpting = false;
  private isWatering = false;
  private isTexturePainting = false;
  private isTreeBrushing = false;
  private randomTreeBrushActive = false;
  private isGrassBrushing = false;
  private grassBrushActive = false;
  private isErasingGrass = false;
  private grassEraseBrushActive = false;
  private isErasing = false;
  private eraseBrushActive = false;
  private lastPlaceTime = 0;
  private dragStart: { x: number; y: number } | null = null;
  private barrierResizeDrag: BarrierResizeDrag | null = null;
  private barrierHoverHandle: { id: string; handle: BarrierHandleId } | null = null;
  private isRestoring = false;
  private dragStartPos = new THREE.Vector3();
  private dragStartRot = new THREE.Euler();
  private scratchWorldPos = new THREE.Vector3();

  private history: string[] = [];
  private historyIndex = -1;
  private clipboardIds: Set<string> = new Set();

  /** Shift+drag marquee multi-select (same SelectionBox pattern as the dungeon editor). */
  private selectionBox: SelectionBox;
  private marqueeStart: { x: number; y: number } | null = null;
  private lastMarqueeEnd = 0;
  private onMarqueeUpdate?: (box: { startX: number; startY: number; endX: number; endY: number } | null) => void;

  // ============================ playtest ============================
  // Mirrors Game.ts's real third-person controller (camera-orbit constants,
  // camera-relative WASD, avatar yaw locked to camera yaw, walk/run anim
  // selection) rather than a generic fly-camera, so what you see here is
  // what a player would actually experience walking through this region.
  private playtestActive = false;
  private cameraYaw = 0;
  private cameraPitch = -0.35;
  private playtestKeys = new Set<string>();
  private playtestSavedCameraPos = new THREE.Vector3();
  private playtestSavedTarget = new THREE.Vector3();
  private playtestPos = new THREE.Vector3();
  private playtestAvatar: AnimatedModel | null = null;
  private playtestAnimSpeed = 0;
  private playtestVelocityY = 0;
  private playtestGrounded = true;
  /** True-geometry (BVH) collision for solid assets during playtest; built on
   *  enterPlaytest from the offline collision meshes, disposed on exit. */
  private playtestCollision: RegionCollision | null = null;
  /** Capsule feet→head height for playtest collision (matches movement.ts's
   *  hard-coded 1.7m head offset). */
  private static readonly PLAYTEST_CAPSULE_HEIGHT = 1.7;
  private lastFrameTime = performance.now();
  private static readonly PLAYTEST_AVATAR_HEIGHT = 1.75;
  private static readonly PLAYTEST_CAMERA_DISTANCE = 6.5;
  private static readonly PLAYTEST_CAMERA_DISTANCE_MIN = 2.4;
  private static readonly PLAYTEST_CAMERA_DISTANCE_MAX = RegionEditorScene.PLAYTEST_CAMERA_DISTANCE;
  private static readonly PLAYTEST_CAMERA_ZOOM_STEP = 0.35;
  private static readonly PLAYTEST_CAMERA_HEIGHT = 2.2;
  private playtestCameraDistance = RegionEditorScene.PLAYTEST_CAMERA_DISTANCE;
  private static readonly PLAYTEST_MOUSE_SENSITIVITY = 0.0024;

  // ============================ navigation (default = Minecraft creative fly) ============================
  private navMode: "fly" | "orbit" = "fly";
  /** True while in creative flight; false = walking on ground. */
  private flyFlying = true;
  private flyKeys = new Set<string>();
  private flyPos = new THREE.Vector3();
  private flyYaw = 0;
  private flyPitch = -0.35;
  private flyVelocityY = 0;
  private flyGrounded = false;
  private flyLastSpaceAt = 0;
  /** RMB held — look while stationary (no movement keys). */
  private flyLookDragging = false;
  /** Debounce unlock so key transitions don't flicker pointer lock. */
  private flyUnlockTimer: number | null = null;
  private readonly flyLookDir = new THREE.Vector3();
  private readonly flyMoveVec = new THREE.Vector3();
  private readonly flyRightVec = new THREE.Vector3();
  private static readonly FLY_EYE_HEIGHT = 1.62;
  private static readonly FLY_UNLOCK_DELAY_MS = 140;
  private static readonly FLY_WALK_SPEED = 12;
  private static readonly FLY_SPRINT_SPEED = 22;
  private static readonly FLY_SNEAK_SPEED = 4;
  /** Editor fly — much faster than Minecraft so continents are traversable. */
  private static readonly FLY_FLY_SPEED = 55;
  private static readonly FLY_FLY_SPRINT_SPEED = 110;
  private static readonly FLY_DOUBLE_TAP_MS = 300;
  private static readonly FLY_MOUSE_SENSITIVITY = 0.0024;

  private onContextMenuUi: ((state: EditorContextMenuState | null) => void) | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private onSelectionChange: (sel: EditorSelection[]) => void,
    private onChange?: () => void,
    private onPlaytestChange?: (active: boolean) => void,
    onMarquee?: (box: { startX: number; startY: number; endX: number; endY: number } | null) => void,
    private onSnapChange?: (enabled: boolean) => void,
    private onFlyChange?: (active: boolean) => void,
  ) {
    // Guard against two live instances ever listening on the same canvas at
    // once (e.g. a leftover instance from a Vite HMR reload that never got
    // disposed) -- see DungeonEditorScene's identical guard for the exact
    // failure mode this prevents.
    const stale = (canvas as CanvasWithScene).__regionEditorScene;
    if (stale) stale.dispose();
    (canvas as CanvasWithScene).__regionEditorScene = this;

    this.onMarqueeUpdate = onMarquee;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, RegionEditorScene.CAMERA_FAR_DEFAULT);
    this.camera.position.set(60, 60, 60);

    this.scene.add(this.ambientLight);
    this.scene.add(this.fillLight);
    this.sunLight.position.set(80, 100, 40);
    this.scene.add(this.sunLight);
    this.scene.fog = new THREE.FogExp2(0xbcd9f0, REGION_FOG_DENSITY_MIN);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;

    this.selectionBox = new SelectionBox(this.camera, this.scene);

    // isRestoring suppresses triggerChange's onChange/pushHistory -- needed
    // here because applyColorGrading() below fires triggerChange, and
    // without this guard that fires a premature autosave of empty default
    // state (no region loaded yet) that can race the real loadBlueprint()
    // call the editor UI kicks off right after construction (loadBlueprint
    // awaits one GLTF fetch per asset, sequentially, so a region with
    // hundreds of assets easily takes longer than the autosave's 1s debounce)
    // and clobber or duplicate whatever region was actually being loaded.
    this.isRestoring = true;
    this.terrainMesh = this.buildTerrainGeometry();
    this.scene.add(this.terrainMesh);
    this.scene.add(this.selectionGroup);
    this.grassPreviewGroup.name = "grass-preview";
    this.scene.add(this.grassPreviewGroup);
    this.scene.background = new THREE.Color(0x02040a);
    this.scene.add(this.skyDome.group);
    this.scene.add(this.waterParticlesGroup);
    this.scene.add(this.escortPathGroup);
    this.applyColorGrading(this.colorGrading);
    this.isRestoring = false;

    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.target.set(0, 0, 0);
    this.orbit.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.orbit.enableDamping = true;
    this.orbit.update();

    this.transform = new TransformControls(this.camera, canvas);
    this.transform.setMode("translate");
    this.transform.setSpace("world");
    this.applyTransformSnap(true);
    this.scene.add(this.transform.getHelper());
    this.transform.addEventListener("dragging-changed", (e) => {
      const isDragging = (e as unknown as { value: boolean }).value;
      this.orbit.enabled = this.navMode === "orbit" && !isDragging && !this.playtestActive;
      if (isDragging) {
        this.dragStartPos.copy(this.selectionGroup.position);
        this.dragStartRot.copy(this.selectionGroup.rotation);
      } else {
        this.bakeSelectionYaw();
        for (const id of this.selectedIds) {
          const a = this.assets.get(id);
          if (a?.solid) a.solidBox = measureObjectSolidBox(a.obj) ?? a.solidBox;
        }
        this.emitSelection();
        this.triggerChange();
      }
    });
    this.transform.addEventListener("objectChange", this.onTransformChange);

    canvas.addEventListener("mousedown", this.onMouseDown);
    canvas.addEventListener("mousemove", this.onMouseMove);
    canvas.addEventListener("mouseup", this.onMouseUp);
    canvas.addEventListener("mouseleave", this.onMouseUp);
    canvas.addEventListener("click", this.onClick);
    canvas.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);

    this.resize();
    // Default navigation is Minecraft creative fly (not orbit).
    this.initFlyPoseFromCamera();
    this.applyNavMode("fly");
    requestAnimationFrame(this.frame);
  }

  // ============================ terrain ============================

  private buildTerrainGeometry(): THREE.Mesh {
    const span = (this.gridSize - 1) * this.pitch;
    const geo = new THREE.PlaneGeometry(span, span, this.gridSize - 1, this.gridSize - 1);
    geo.rotateX(-Math.PI / 2);
    const count = (geo.attributes.position as THREE.BufferAttribute).count;
    geo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute("weightsA", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute("weightsB", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute("terrainUv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    applyGroundBlendShader(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = "region-terrain";
    this.syncTerrainMeshHeights(mesh);
    return mesh;
  }

  private customTextureAt(x: number, z: number): number {
    if (!this.customTextures || this.customTextures.length === 0) return 0;
    const half = ((this.gridSize - 1) * this.pitch) / 2;
    const gx = Math.round((x + half) / this.pitch);
    const gz = Math.round((z + half) / this.pitch);
    const cx = Math.min(this.gridSize - 1, Math.max(0, gx));
    const cz = Math.min(this.gridSize - 1, Math.max(0, gz));
    return this.customTextures[cz * this.gridSize + cx] ?? 0;
  }

  /** Re-reads every vertex's world (x,z) and looks up the matching heights[]
   *  cell, rather than assuming PlaneGeometry's internal vertex ordering --
   *  robust regardless of its winding convention, and reusable for both the
   *  initial build and every sculpt edit. Also recomputes the ground-texture
   *  weights (grass/rock/sand/snow/dirt/cobble) from height + local slope, so a
   *  sculpt stroke that carves a cliff immediately shows rock/snow instead
   *  of a flat green plane stretched over the new shape. */
  private syncTerrainMeshHeights(
    mesh: THREE.Mesh = this.terrainMesh,
    dirtyRect?: { minX: number; maxX: number; minZ: number; maxZ: number },
  ): void {
    const half = ((this.gridSize - 1) * this.pitch) / 2;
    const span = (this.gridSize - 1) * this.pitch;
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const terrainUv = mesh.geometry.attributes.terrainUv as THREE.BufferAttribute | undefined;
    const tints = mesh.geometry.attributes.color as THREE.BufferAttribute | undefined;
    const weightsA = mesh.geometry.attributes.weightsA as THREE.BufferAttribute | undefined;
    const weightsB = mesh.geometry.attributes.weightsB as THREE.BufferAttribute | undefined;
    // Fold the road currently being dragged out in alongside the finalized
    // ones so the dirt strip previews live while painting, not just after
    // mouseup -- built once per sync call, not per vertex.
    const effectiveRoads =
      this.paintingRoad && this.paintingRoad.length >= 2
        ? [...this.roads, { points: this.paintingRoad, width: this.roadWidth }]
        : this.roads;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = this.heightAt(x, z);
      pos.setY(i, y);

      // Brush calls pass a dirty rect so this skips the (relatively costly)
      // slope + texture-weight recompute for vertices the brush didn't
      // touch -- unbounded, this ran for every vertex on every dab.
      if (dirtyRect && (x < dirtyRect.minX || x > dirtyRect.maxX || z < dirtyRect.minZ || z > dirtyRect.maxZ)) {
        continue;
      }

      if (terrainUv) terrainUv.setXY(i, (x + span / 2) / span, (z + span / 2) / span);
      if (weightsA && weightsB && tints) {
        const slope = Math.hypot(
          this.heightAt(x + this.pitch, z) - this.heightAt(x - this.pitch, z),
          this.heightAt(x, z + this.pitch) - this.heightAt(x, z - this.pitch),
        ) / (2 * this.pitch);
        const roadBlend = regionRoadBlendAt(effectiveRoads, x, z);
        const customTex = this.customTextureAt(x, z);
        const w = regionGroundWeights(this.meta.biome, y, slope, roadBlend, this.colorGrading.groundTint, customTex);
        weightsA.setXYZ(i, w.wGrass, w.wRock, w.wSand);
        weightsB.setXYZ(i, w.wSnow, w.wDirt, w.wCobble);
        tints.setXYZ(i, w.tint.r, w.tint.g, w.tint.b);
      }
    }
    pos.needsUpdate = true;
    if (terrainUv) terrainUv.needsUpdate = true;
    if (weightsA) weightsA.needsUpdate = true;
    if (weightsB) weightsB.needsUpdate = true;
    if (tints) tints.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    if (this.grassField) {
      this.grassField.setHeightmap({
        gridSize: this.gridSize,
        pitch: this.pitch,
        heights: this.heights,
      });
    }
  }

  private heightAt(x: number, z: number): number {
    const half = ((this.gridSize - 1) * this.pitch) / 2;
    const tx = Math.min(this.gridSize - 1, Math.max(0, Math.round((x + half) / this.pitch)));
    const tz = Math.min(this.gridSize - 1, Math.max(0, Math.round((z + half) / this.pitch)));
    return this.heights[tz * this.gridSize + tx] ?? 0;
  }

  /** Grid index range covering a world-space brush circle, clamped to the
   *  terrain grid. Sculpt/paint loops iterate only this range instead of the
   *  full gridSize×gridSize heightmap on every dab -- on a large region the
   *  unbounded scan was the dominant per-mousemove cost. */
  private brushGridBounds(
    hitX: number,
    hitZ: number,
    radius: number,
  ): { tx0: number; tx1: number; tz0: number; tz1: number } {
    const half = ((this.gridSize - 1) * this.pitch) / 2;
    const tx0 = Math.max(0, Math.floor((hitX - radius + half) / this.pitch));
    const tx1 = Math.min(this.gridSize - 1, Math.ceil((hitX + radius + half) / this.pitch));
    const tz0 = Math.max(0, Math.floor((hitZ - radius + half) / this.pitch));
    const tz1 = Math.min(this.gridSize - 1, Math.ceil((hitZ + radius + half) / this.pitch));
    return { tx0, tx1, tz0, tz1 };
  }

  /** World-space AABB covering a brush circle, padded for slope/neighbor
   *  sampling -- passed to syncTerrainMeshHeights() so it skips the
   *  per-vertex texture-weight recompute outside the affected area. */
  private worldRectFromBrush(
    hitX: number,
    hitZ: number,
    radius: number,
  ): { minX: number; maxX: number; minZ: number; maxZ: number } {
    const pad = this.pitch * 2;
    return { minX: hitX - radius - pad, maxX: hitX + radius + pad, minZ: hitZ - radius - pad, maxZ: hitZ + radius + pad };
  }

  private sculptAt(hitX: number, hitY: number, hitZ: number, mode: SculptMode): void {
    if (!mode) return;

    if (mode === "carve") {
      this.carveAt(hitX, hitY, hitZ);
      return;
    }

    // With volumes selected, deform only those -- leave the heightmap alone.
    const selectedVolumes = this.selectedVolumeIds();
    if (selectedVolumes.size > 0) {
      this.sculptVolumesAt(hitX, hitZ, mode, selectedVolumes);
      this.triggerChange();
      return;
    }

    const half = ((this.gridSize - 1) * this.pitch) / 2;

    if (mode === "raise" || mode === "lower") {
      const sign = mode === "raise" ? 1 : -1;
      const { tx0, tx1, tz0, tz1 } = this.brushGridBounds(hitX, hitZ, this.brushRadius);
      for (let tz = tz0; tz <= tz1; tz++) {
        const wz = tz * this.pitch - half;
        for (let tx = tx0; tx <= tx1; tx++) {
          const wx = tx * this.pitch - half;
          const d = Math.hypot(wx - hitX, wz - hitZ);
          if (d > this.brushRadius) continue;
          const falloff = 1 - d / this.brushRadius;
          this.heights[tz * this.gridSize + tx]! += sign * this.brushStrength * falloff * 0.8;
        }
      }
    } else if (mode === "mold") {
      if (this.moldTargetHeight === null) {
        this.moldTargetHeight = this.heightAt(hitX, hitZ);
      }
      const targetH = this.moldTargetHeight;
      const { tx0, tx1, tz0, tz1 } = this.brushGridBounds(hitX, hitZ, this.brushRadius);
      for (let tz = tz0; tz <= tz1; tz++) {
        const wz = tz * this.pitch - half;
        for (let tx = tx0; tx <= tx1; tx++) {
          const wx = tx * this.pitch - half;
          const d = Math.hypot(wx - hitX, wz - hitZ);
          if (d > this.brushRadius) continue;
          const falloff = 1 - d / this.brushRadius;
          const idx = tz * this.gridSize + tx;
          const currentH = this.heights[idx]!;
          const factor = Math.min(0.8, this.brushStrength * falloff * 0.5);
          this.heights[idx] = currentH + (targetH - currentH) * factor;
        }
      }
    } else if (mode === "smooth") {
      const gSize = this.gridSize;
      const { tx0, tx1, tz0, tz1 } = this.brushGridBounds(hitX, hitZ, this.brushRadius);
      // Snapshot only the affected sub-rectangle (padded by 1 cell for
      // neighbor averaging) instead of copying the entire heightmap.
      const ptx0 = Math.max(0, tx0 - 1);
      const ptx1 = Math.min(gSize - 1, tx1 + 1);
      const ptz0 = Math.max(0, tz0 - 1);
      const ptz1 = Math.min(gSize - 1, tz1 + 1);
      const pw = ptx1 - ptx0 + 1;
      const snapshot = new Float32Array(pw * (ptz1 - ptz0 + 1));
      for (let tz = ptz0; tz <= ptz1; tz++) {
        for (let tx = ptx0; tx <= ptx1; tx++) {
          snapshot[(tz - ptz0) * pw + (tx - ptx0)] = this.heights[tz * gSize + tx]!;
        }
      }
      const snap = (tx: number, tz: number): number => snapshot[(tz - ptz0) * pw + (tx - ptx0)]!;
      for (let tz = tz0; tz <= tz1; tz++) {
        const wz = tz * this.pitch - half;
        for (let tx = tx0; tx <= tx1; tx++) {
          const wx = tx * this.pitch - half;
          const d = Math.hypot(wx - hitX, wz - hitZ);
          if (d > this.brushRadius) continue;
          const falloff = 1 - d / this.brushRadius;
          const idx = tz * gSize + tx;

          let sum = snap(tx, tz);
          let count = 1;
          if (tx > 0) { sum += snap(tx - 1, tz); count++; }
          if (tx < gSize - 1) { sum += snap(tx + 1, tz); count++; }
          if (tz > 0) { sum += snap(tx, tz - 1); count++; }
          if (tz < gSize - 1) { sum += snap(tx, tz + 1); count++; }
          const avg = sum / count;

          const factor = Math.min(0.8, this.brushStrength * falloff * 0.6);
          this.heights[idx] = snap(tx, tz) + (avg - snap(tx, tz)) * factor;
        }
      }
    }

    this.syncTerrainMeshHeights(this.terrainMesh, this.worldRectFromBrush(hitX, hitZ, this.brushRadius));
    // No volume selection -- only sculpt the heightmap (volumes need an
    // explicit selection so nearby stamps aren't accidentally reshaped).
    this.triggerChange();
  }

  /**
   * Punch holes through terrain volumes only (never the heightmap). Hole
   * radius follows brush size. With a selection, only those volumes; otherwise
   * any volume the brush sphere intersects.
   */
  private carveAt(hitX: number, hitY: number, hitZ: number): void {
    const radius = Math.max(0.35, this.brushRadius * 0.55);
    const spacing = Math.max(0.25, radius * 0.55);
    if (this.lastCarvePos) {
      const dist = Math.hypot(
        hitX - this.lastCarvePos.x,
        hitY - this.lastCarvePos.y,
        hitZ - this.lastCarvePos.z,
      );
      if (dist < spacing) return;
    }
    this.lastCarvePos = new THREE.Vector3(hitX, hitY, hitZ);

    const selected = this.selectedVolumeIds();
    const carve: TerrainVolumeCarve = { x: hitX, y: hitY, z: hitZ, radius };
    let any = false;

    for (const entry of this.volumes.values()) {
      if (selected.size > 0 && !selected.has(entry.id)) continue;
      if (!this.volumeIntersectsCarve(entry.data, carve)) continue;
      if (!entry.data.carves) entry.data.carves = [];
      const dup = entry.data.carves.some(
        (c) => Math.hypot(c.x - carve.x, c.y - carve.y, c.z - carve.z) < radius * 0.35
          && Math.abs(c.radius - carve.radius) < 0.05,
      );
      if (dup) continue;
      entry.data.carves.push({ ...carve });
      rebuildTerrainVolumeMesh(entry.obj, entry.data);
      any = true;
    }

    if (any) {
      for (const helper of this.selectionHelpers.values()) helper.update();
      this.triggerChange();
    }
  }

  /** Rough intersection test: carve sphere vs volume footprint/top. */
  private volumeIntersectsCarve(v: RegionTerrainVolume, carve: TerrainVolumeCarve): boolean {
    if (isTerrainStroke(v) && v.path) {
      for (const p of v.path) {
        const halfW = strokePointHalfWidth(v, p);
        const top = strokePointTopY(v, p);
        const midY = (p.y + top) * 0.5;
        const dx = p.x - carve.x;
        const dy = midY - carve.y;
        const dz = p.z - carve.z;
        const reach = halfW + carve.radius + Math.max(0.1, (top - p.y) * 0.5);
        if (dx * dx + dy * dy + dz * dz < reach * reach) return true;
      }
      return false;
    }
    const r = terrainVolumeRadius(v) + carve.radius;
    const dx = v.localX - carve.x;
    const dz = v.localZ - carve.z;
    if (dx * dx + dz * dz > r * r) return false;
    const top = terrainVolumeTopY(v);
    const bot = top - v.scaleY * 2;
    return carve.y + carve.radius >= bot && carve.y - carve.radius <= top;
  }

  /** Ids of currently selected terrain volumes (empty if none). */
  private selectedVolumeIds(): Set<string> {
    const ids = new Set<string>();
    for (const id of this.selectedIds) {
      if (this.volumes.has(id)) ids.add(id);
    }
    return ids;
  }

  /** Raise / lower / mold / smooth stamped terrain volumes the same way the
   *  heightmap brush works -- strokes deform locally via path `h`/`w`, discrete
   *  stamps grow/shrink while keeping their base planted.
   *  When `onlyIds` is set, only those volumes are touched. */
  private sculptVolumesAt(
    hitX: number,
    hitZ: number,
    mode: SculptMode,
    onlyIds?: Set<string>,
  ): void {
    if (!mode) return;
    let anyTouched = false;

    for (const entry of this.volumes.values()) {
      if (onlyIds && !onlyIds.has(entry.id)) continue;
      const v = entry.data;
      if (isTerrainStroke(v) && v.path && v.path.length >= 2) {
        let strokeTouched = false;
        if (mode === "smooth") {
          const copy = v.path.map((p) => ({
            h: p.h ?? 1,
            w: p.w ?? 1,
            y: p.y,
          }));
          for (let i = 0; i < v.path.length; i++) {
            const p = v.path[i]!;
            const d = Math.hypot(p.x - hitX, p.z - hitZ);
            if (d > this.brushRadius) continue;
            const falloff = 1 - d / this.brushRadius;
            let sumH = copy[i]!.h;
            let sumW = copy[i]!.w;
            let sumY = copy[i]!.y;
            let count = 1;
            if (i > 0) {
              sumH += copy[i - 1]!.h;
              sumW += copy[i - 1]!.w;
              sumY += copy[i - 1]!.y;
              count++;
            }
            if (i < v.path.length - 1) {
              sumH += copy[i + 1]!.h;
              sumW += copy[i + 1]!.w;
              sumY += copy[i + 1]!.y;
              count++;
            }
            const factor = Math.min(0.8, this.brushStrength * falloff * 0.3);
            p.h = copy[i]!.h + (sumH / count - copy[i]!.h) * factor;
            p.w = copy[i]!.w + (sumW / count - copy[i]!.w) * factor;
            p.y = copy[i]!.y + (sumY / count - copy[i]!.y) * factor;
            strokeTouched = true;
          }
        } else {
          for (const p of v.path) {
            const d = Math.hypot(p.x - hitX, p.z - hitZ);
            if (d > this.brushRadius) continue;
            const falloff = 1 - d / this.brushRadius;
            const curH = p.h ?? 1;
            const curW = p.w ?? 1;
            if (mode === "raise" || mode === "lower") {
              const sign = mode === "raise" ? 1 : -1;
              p.h = Math.max(0.08, curH + sign * this.brushStrength * falloff * 0.18);
              p.w = Math.max(0.15, curW + sign * this.brushStrength * falloff * 0.06);
              strokeTouched = true;
            } else if (mode === "mold" && this.moldTargetHeight !== null) {
              const targetH = Math.max(0.08, (this.moldTargetHeight - p.y) / Math.max(0.08, v.scaleY));
              const factor = Math.min(0.8, this.brushStrength * falloff * 0.25);
              p.h = curH + (targetH - curH) * factor;
              const widthTarget = Math.max(0.2, Math.min(1.6, 0.55 + p.h * 0.45));
              p.w = curW + (widthTarget - curW) * factor * 0.5;
              strokeTouched = true;
            }
          }
        }
        if (strokeTouched) {
          const cx = v.path.reduce((s, p) => s + p.x, 0) / v.path.length;
          const cy = v.path.reduce((s, p) => s + p.y, 0) / v.path.length;
          const cz = v.path.reduce((s, p) => s + p.z, 0) / v.path.length;
          v.localX = cx;
          v.localY = cy;
          v.localZ = cz;
          rebuildTerrainStrokeMesh(entry.obj, v);
          anyTouched = true;
        }
        continue;
      }

      // Discrete stamp -- deform scale while keeping the underside planted.
      const r = terrainVolumeRadius(v);
      const d = Math.hypot(v.localX - hitX, v.localZ - hitZ);
      if (d > this.brushRadius + r * 0.35) continue;
      const falloff = 1 - Math.min(1, d / Math.max(0.01, this.brushRadius + r * 0.35));
      const oldSY = v.scaleY;
      if (mode === "raise" || mode === "lower") {
        const sign = mode === "raise" ? 1 : -1;
        const next = Math.max(0.15, oldSY + sign * this.brushStrength * falloff * 0.25);
        v.scaleY = next;
        v.scaleX = Math.max(0.15, v.scaleX + sign * this.brushStrength * falloff * 0.1);
        v.scaleZ = Math.max(0.15, v.scaleZ + sign * this.brushStrength * falloff * 0.1);
        v.localY += next - oldSY;
      } else if (mode === "mold" && this.moldTargetHeight !== null) {
        const top = terrainVolumeTopY(v);
        const factor = Math.min(0.8, this.brushStrength * falloff * 0.25);
        const newTop = top + (this.moldTargetHeight - top) * factor;
        const next = Math.max(0.15, oldSY + (newTop - top));
        v.scaleY = next;
        v.localY += next - oldSY;
      } else if (mode === "smooth") {
        let sum = oldSY;
        let count = 1;
        for (const other of this.volumes.values()) {
          if (other.id === entry.id || isTerrainStroke(other.data)) continue;
          const od = Math.hypot(other.data.localX - v.localX, other.data.localZ - v.localZ);
          if (od > this.brushRadius * 1.5) continue;
          sum += other.data.scaleY;
          count++;
        }
        const avg = sum / count;
        const factor = Math.min(0.8, this.brushStrength * falloff * 0.3);
        const next = Math.max(0.15, oldSY + (avg - oldSY) * factor);
        v.scaleY = next;
        v.localY += next - oldSY;
      } else {
        continue;
      }
      entry.obj.position.set(v.localX, v.localY, v.localZ);
      entry.obj.scale.set(v.scaleX, v.scaleY, v.scaleZ);
      anyTouched = true;
    }

    if (anyTouched) {
      for (const helper of this.selectionHelpers.values()) helper.update();
    }
  }

  setTexturePaintMode(mode: number | null): void {
    this.texturePaintMode = mode;
    if (mode !== null) {
      this.armedModel = null;
      this.armedMarkerKind = null;
      this.armedHouse = false;
      this.armedLightColor = null;
      this.armedFogColor = null;
      this.clearVolumeStamp();
      this.sculptMode = null;
      this.waterBrushMode = null;
      this.randomTreeBrushActive = false;
      this.grassBrushActive = false;
      this.grassEraseBrushActive = false;
      this.eraseBrushActive = false;
      this.roadPaintArmed = false;
      this.transform.detach();
      this.deselect();
    }
    this.orbit.enablePan = mode === null;
  }

  private paintTextureAt(hitX: number, hitZ: number, texType: number): void {
    if (this.customTextures.length !== this.gridSize * this.gridSize) {
      this.customTextures = new Array(this.gridSize * this.gridSize).fill(0);
    }
    const half = ((this.gridSize - 1) * this.pitch) / 2;
    let changed = false;

    const { tx0, tx1, tz0, tz1 } = this.brushGridBounds(hitX, hitZ, this.brushRadius);
    for (let tz = tz0; tz <= tz1; tz++) {
      const wz = tz * this.pitch - half;
      for (let tx = tx0; tx <= tx1; tx++) {
        const wx = tx * this.pitch - half;
        const d = Math.hypot(wx - hitX, wz - hitZ);
        if (d > this.brushRadius) continue;
        const idx = tz * this.gridSize + tx;
        if (this.customTextures[idx] !== texType) {
          this.customTextures[idx] = texType;
          changed = true;
        }
      }
    }

    if (changed) {
      this.syncTerrainMeshHeights(this.terrainMesh, this.worldRectFromBrush(hitX, hitZ, this.brushRadius));
      this.triggerChange();
    }
  }

  setSculptMode(mode: SculptMode): void {
    this.sculptMode = mode;
    if (mode) {
      this.armedModel = null;
      this.armedMarkerKind = null;
      this.armedHouse = false;
      this.clearVolumeStamp();
      this.armedLightColor = null;
      this.armedFogColor = null;
      this.texturePaintMode = null;
      this.waterBrushMode = null;
      this.randomTreeBrushActive = false;
      this.grassBrushActive = false;
      this.grassEraseBrushActive = false;
      this.eraseBrushActive = false;
      this.roadPaintArmed = false;
      // Keep volume selection so raise/lower/mold/smooth can target only those
      // volumes. Detach them into world space (and hide the gizmo) so stroke
      // rebuilds write world positions correctly while sculpting.
      for (const obj of [...this.selectionGroup.children]) this.scene.attach(obj);
      this.transform.detach();
      for (const helper of this.selectionHelpers.values()) helper.update();
    } else if (this.selectedIds.size > 0) {
      this.updateSelectionGroup();
    }
    this.orbit.enablePan = !mode;
  }

  /** Arms the freeform volume tool. `place` = drop one primitive (click or
   *  light drag). `sculpt` = continuous ridge along a locked-Y plane.
   *  `clay` = Blender-style add/sub following the 3D surface (boulder/block). */
  armVolumeStamp(
    shape: TerrainVolumeShape,
    material: TerrainVolumeMaterial = this.volumeMaterial,
    style: "place" | "sculpt" | "clay" = "place",
  ): void {
    this.armedModel = null;
    this.armedMarkerKind = null;
    this.armedHouse = false;
    this.armedLightColor = null;
    this.armedFogColor = null;
    this.sculptMode = null;
    this.texturePaintMode = null;
    this.waterBrushMode = null;
    this.randomTreeBrushActive = false;
    this.grassBrushActive = false;
    this.grassEraseBrushActive = false;
    this.eraseBrushActive = false;
    this.roadPaintArmed = false;
    this.volumeStampActive = true;
    this.volumeBrushStyle = style;
    this.volumeShape = style === "clay" && shape !== "block" ? "boulder" : shape;
    this.volumeMaterial = material;
    this.lastVolumeStrokePos = null;
    this.lastCarvePos = null;
    this.rebuildVolumeGhost();
    this.transform.detach();
    this.deselect();
    this.orbit.enablePan = false;
  }

  setVolumeMaterial(material: TerrainVolumeMaterial): void {
    this.volumeMaterial = material;
    if (this.volumeStampActive) this.rebuildVolumeGhost();
  }

  setVolumeShape(shape: TerrainVolumeShape): void {
    if (this.volumeBrushStyle === "clay" && shape !== "boulder" && shape !== "block") {
      shape = "boulder";
    }
    this.volumeShape = shape;
    if (this.volumeStampActive) this.rebuildVolumeGhost();
  }

  setVolumeSculptOp(op: "add" | "sub"): void {
    this.volumeSculptOp = op;
    if (this.volumeStampActive && this.volumeBrushStyle === "clay") {
      this.rebuildVolumeGhost();
    }
  }

  get volumeBrushStyleActive(): "place" | "sculpt" | "clay" | null {
    return this.volumeStampActive ? this.volumeBrushStyle : null;
  }

  get volumeSculptOpActive(): "add" | "sub" {
    return this.volumeSculptOp;
  }

  private clearVolumeStamp(): void {
    this.volumeStampActive = false;
    this.isVolumeStamping = false;
    this.lastVolumeStrokePos = null;
    this.cancelActiveStroke();
    if (this.volumeGhost) {
      this.scene.remove(this.volumeGhost);
      // Ghost uses a cloned material; shared geometry must not be disposed.
      (this.volumeGhost.material as THREE.Material).dispose();
      this.volumeGhost = null;
    }
    if (this.volumeBrushRing) {
      this.scene.remove(this.volumeBrushRing);
      this.volumeBrushRing.geometry.dispose();
      (this.volumeBrushRing.material as THREE.Material).dispose();
      this.volumeBrushRing = null;
    }
  }

  private rebuildVolumeGhost(): void {
    if (this.volumeGhost) {
      this.scene.remove(this.volumeGhost);
      (this.volumeGhost.material as THREE.Material).dispose();
      this.volumeGhost = null;
    }
    if (this.volumeBrushRing) {
      this.scene.remove(this.volumeBrushRing);
      this.volumeBrushRing.geometry.dispose();
      (this.volumeBrushRing.material as THREE.Material).dispose();
      this.volumeBrushRing = null;
    }
    if (!this.volumeStampActive) return;
    this.volumeGhost = createTerrainVolumeGhost(this.volumeShape, this.volumeMaterial);
    const ghostR =
      this.volumeBrushStyle === "sculpt" || this.volumeBrushStyle === "clay"
        ? this.brushRadius * 0.45
        : this.brushRadius;
    const s = defaultVolumeScale(this.volumeShape, ghostR);
    this.volumeGhost.scale.set(s.scaleX, s.scaleY, s.scaleZ);
    this.volumeGhost.visible = false;
    this.scene.add(this.volumeGhost);

    if (this.volumeBrushStyle === "sculpt" || this.volumeBrushStyle === "clay") {
      const ringGeo = new THREE.RingGeometry(this.brushRadius * 0.92, this.brushRadius, 48);
      ringGeo.rotateX(-Math.PI / 2);
      const ringColor =
        this.volumeBrushStyle === "clay" && this.volumeSculptOp === "sub" ? 0xf07178 : 0x7dd3a0;
      this.volumeBrushRing = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: ringColor,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      this.volumeBrushRing.visible = false;
      this.volumeBrushRing.frustumCulled = false;
      this.scene.add(this.volumeBrushRing);
    }
  }

  armLightPlacement(color = "#ff9933"): void {
    this.armedModel = null;
    this.armedMarkerKind = null;
    this.armedHouse = false;
    this.clearVolumeStamp();
    this.armedFogColor = null;
    this.armedBarrier = false;
    this.armedCloudShape = null;
    this.armedLightColor = color;
    this.sculptMode = null;
    this.texturePaintMode = null;
    this.waterBrushMode = null;
    this.randomTreeBrushActive = false;
    this.grassBrushActive = false;
    this.grassEraseBrushActive = false;
    this.eraseBrushActive = false;
    this.roadPaintArmed = false;
    this.transform.detach();
    this.deselect();
    this.orbit.enablePan = false;
  }

  armFogPlacement(color = "#c8dce8", shape: RegionFogShape = "sphere"): void {
    this.armedModel = null;
    this.armedMarkerKind = null;
    this.armedHouse = false;
    this.clearVolumeStamp();
    this.armedLightColor = null;
    this.armedBarrier = false;
    this.armedCloudShape = null;
    this.armedFogColor = color;
    this.armedFogShape = shape;
    this.sculptMode = null;
    this.texturePaintMode = null;
    this.waterBrushMode = null;
    this.randomTreeBrushActive = false;
    this.grassBrushActive = false;
    this.grassEraseBrushActive = false;
    this.eraseBrushActive = false;
    this.roadPaintArmed = false;
    this.transform.detach();
    this.deselect();
    this.orbit.enablePan = false;
  }

  armBarrierPlacement(): void {
    this.armedModel = null;
    this.armedMarkerKind = null;
    this.armedHouse = false;
    this.clearVolumeStamp();
    this.armedLightColor = null;
    this.armedFogColor = null;
    this.armedCloudShape = null;
    this.armedBarrier = true;
    this.sculptMode = null;
    this.texturePaintMode = null;
    this.waterBrushMode = null;
    this.randomTreeBrushActive = false;
    this.grassBrushActive = false;
    this.grassEraseBrushActive = false;
    this.eraseBrushActive = false;
    this.roadPaintArmed = false;
    this.transform.detach();
    this.deselect();
    this.orbit.enablePan = false;
  }

  armCloudPlacement(shape: RegionCloudShape = "cumulus"): void {
    this.armedModel = null;
    this.armedMarkerKind = null;
    this.armedHouse = false;
    this.clearVolumeStamp();
    this.armedLightColor = null;
    this.armedFogColor = null;
    this.armedBarrier = false;
    this.armedCloudShape = shape;
    this.sculptMode = null;
    this.texturePaintMode = null;
    this.waterBrushMode = null;
    this.randomTreeBrushActive = false;
    this.grassBrushActive = false;
    this.grassEraseBrushActive = false;
    this.eraseBrushActive = false;
    this.roadPaintArmed = false;
    this.transform.detach();
    this.deselect();
    this.orbit.enablePan = false;
  }

  public placeLight(x: number, y: number, z: number, color = "#ff9933", intensity = 8, distance = 80, decay = 1): string {
    const id = `light_${this.nextId++}`;
    const group = new THREE.Group();
    group.position.set(x, y + 1.5, z);

    const pointLight = new THREE.PointLight(color, intensity, distance, decay);
    group.add(pointLight);

    const bulb = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getGlowTexture(),
      color: new THREE.Color(color),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    bulb.scale.setScalar(1.4);
    group.add(bulb);

    group.userData.editorKind = "light";
    group.userData.editorId = id;
    this.scene.add(group);

    const entry: LightEntry = { id, color, intensity, distance, decay, obj: group, light: pointLight, bulb };
    this.lights.set(id, entry);
    this.select("light", id, false);
    this.triggerChange();
    return id;
  }

  public placeFogVolume(
    x: number,
    y: number,
    z: number,
    color = "#c8dce8",
    shape: RegionFogShape = "sphere",
    size = 14,
  ): string {
    const id = `fog_${this.nextId++}`;
    const data: RegionFogVolume = {
      id,
      localX: x,
      localY: y + size * 0.35,
      localZ: z,
      shape,
      sizeX: size,
      sizeY: size * (shape === "box" ? 0.55 : 0.7),
      sizeZ: size,
      color,
      density: 0.7,
      opacity: 0.75,
      feather: 0.65,
    };
    const mesh = createFogVolumeMesh(data);
    mesh.userData.editorKind = "fog";
    mesh.userData.editorId = id;
    this.scene.add(mesh);
    this.fogVolumes.set(id, { id, data, mesh });
    this.select("fog", id, false);
    this.triggerChange();
    return id;
  }

  public placeBarrierVolume(
    x: number,
    y: number,
    z: number,
    sizeX = 8,
    sizeY = 6,
    sizeZ = 1.25,
    yaw = 0,
  ): string {
    const id = `barrier_${this.nextId++}`;
    // Center the box so it sits on the ground and rises upward.
    const data: RegionBarrierVolume = {
      id,
      localX: x,
      localY: y + sizeY,
      localZ: z,
      yaw,
      sizeX,
      sizeY,
      sizeZ,
    };
    const group = createBarrierMesh(data);
    group.userData.editorKind = "barrier";
    group.userData.editorId = id;
    this.scene.add(group);
    this.barrierVolumes.set(id, { id, data, group });
    this.select("barrier", id, false);
    this.triggerChange();
    return id;
  }

  public placeCloud(
    x: number,
    y: number,
    z: number,
    shape: RegionCloudShape = "cumulus",
    color = "#eef2f8",
  ): string {
    const id = `cloud_${this.nextId++}`;
    const data: RegionCloud = {
      id,
      localX: x,
      localY: y + 28,
      localZ: z,
      yaw: 0,
      scaleX: 1,
      scaleY: 1,
      scaleZ: 1,
      color,
      opacity: 0.85,
      shape,
      driftSpeed: 1.2,
      bobAmp: 0.4,
    };
    const group = createRegionCloudMesh(data);
    group.userData.editorKind = "cloud";
    group.userData.editorId = id;
    this.scene.add(group);
    this.clouds.set(id, { id, data, group });
    this.select("cloud", id, false);
    this.triggerChange();
    return id;
  }

  setBrushRadius(r: number): void {
    this.brushRadius = Math.max(1, r);
    if (this.volumeStampActive) {
      // Rebuild so the sculpt ring matches the new radius.
      this.rebuildVolumeGhost();
    }
  }

  setBrushStrength(s: number): void {
    this.brushStrength = Math.max(0.1, s);
    if (this.volumeStampActive && this.volumeBrushStyle === "clay") {
      this.rebuildVolumeGhost();
    }
  }

  // ============================ road painting ============================

  armRoadPainting(): void {
    this.armedModel = null;
    this.armedMarkerKind = null;
    this.armedHouse = false;
    this.clearVolumeStamp();
    this.sculptMode = null;
    this.waterBrushMode = null;
    this.randomTreeBrushActive = false;
    this.grassBrushActive = false;
    this.grassEraseBrushActive = false;
    this.eraseBrushActive = false;
    this.roadPaintArmed = true;
    this.transform.detach();
    this.deselect();
    this.orbit.enablePan = false;
  }

  setRoadWidth(w: number): void {
    this.roadWidth = Math.max(1, w);
  }

  // ============================ water physics & brush ============================

  setWaterBrushMode(mode: WaterBrushMode): void {
    this.waterBrushMode = mode;
    if (mode) {
      this.armedModel = null;
      this.armedMarkerKind = null;
      this.armedHouse = false;
      this.clearVolumeStamp();
      this.sculptMode = null;
      this.randomTreeBrushActive = false;
      this.grassBrushActive = false;
      this.grassEraseBrushActive = false;
      this.eraseBrushActive = false;
      this.roadPaintArmed = false;
      this.transform.detach();
      this.deselect();
    }
    this.orbit.enablePan = !mode;
  }

  setWaterPhysicsSimulating(sim: boolean): void {
    this.waterPhysicsSimulating = sim;
  }

  setRandomTreeBrush(active: boolean): void {
    this.randomTreeBrushActive = active;
    if (active) {
      this.armedModel = null;
      this.armedMarkerKind = null;
      this.armedHouse = false;
      this.clearVolumeStamp();
      this.sculptMode = null;
      this.waterBrushMode = null;
      this.roadPaintArmed = false;
      this.grassBrushActive = false;
      this.grassEraseBrushActive = false;
      this.eraseBrushActive = false;
      this.transform.detach();
      this.deselect();
    }
    this.orbit.enablePan = !active;
  }

  setGrassBrush(active: boolean): void {
    this.grassBrushActive = active;
    if (active) {
      this.armedModel = null;
      this.armedMarkerKind = null;
      this.armedHouse = false;
      this.clearVolumeStamp();
      this.sculptMode = null;
      this.waterBrushMode = null;
      this.roadPaintArmed = false;
      this.randomTreeBrushActive = false;
      this.grassEraseBrushActive = false;
      this.eraseBrushActive = false;
      this.transform.detach();
      this.deselect();
    }
    this.orbit.enablePan = !active;
  }

  setGrassEraseBrush(active: boolean): void {
    this.grassEraseBrushActive = active;
    if (active) {
      this.armedModel = null;
      this.armedMarkerKind = null;
      this.armedHouse = false;
      this.clearVolumeStamp();
      this.sculptMode = null;
      this.waterBrushMode = null;
      this.roadPaintArmed = false;
      this.randomTreeBrushActive = false;
      this.grassBrushActive = false;
      this.eraseBrushActive = false;
      this.transform.detach();
      this.deselect();
    }
    this.orbit.enablePan = !active;
  }

  setEraseBrush(active: boolean): void {
    this.eraseBrushActive = active;
    if (active) {
      this.armedModel = null;
      this.armedMarkerKind = null;
      this.armedHouse = false;
      this.clearVolumeStamp();
      this.armedLightColor = null;
      this.armedFogColor = null;
      this.sculptMode = null;
      this.waterBrushMode = null;
      this.texturePaintMode = null;
      this.roadPaintArmed = false;
      this.randomTreeBrushActive = false;
      this.grassBrushActive = false;
      this.grassEraseBrushActive = false;
      this.transform.detach();
      this.deselect();
    }
    this.orbit.enablePan = !active;
  }

  private eraseAssetsAt(hitX: number, hitZ: number): void {
    const now = performance.now();
    if (now - this.lastPlaceTime < 120) return;
    this.lastPlaceTime = now;

    for (const [id, a] of [...this.assets]) {
      const dx = a.obj.position.x - hitX;
      const dz = a.obj.position.z - hitZ;
      if (dx * dx + dz * dz > this.brushRadius * this.brushRadius) continue;
      const helper = this.selectionHelpers.get(id);
      if (helper) {
        this.scene.remove(helper);
        helper.dispose();
        this.selectionHelpers.delete(id);
      }
      this.selectedIds.delete(id);
      this.scene.remove(a.obj);
      this.disposeObject(a.obj);
      this.assets.delete(id);
    }

    for (const [id, v] of [...this.volumes]) {
      const dx = v.obj.position.x - hitX;
      const dz = v.obj.position.z - hitZ;
      if (dx * dx + dz * dz > this.brushRadius * this.brushRadius) continue;
      const helper = this.selectionHelpers.get(id);
      if (helper) {
        this.scene.remove(helper);
        helper.dispose();
        this.selectionHelpers.delete(id);
      }
      this.selectedIds.delete(id);
      this.removeVolume(id);
    }

    // Grass patches have no per-object scene presence to clean up
    // individually -- just drop matching records and mark the preview dirty.
    const before = this.grassPatches.length;
    this.grassPatches = this.grassPatches.filter((p) => {
      const dx = p.localX - hitX;
      const dz = p.localZ - hitZ;
      return dx * dx + dz * dz > this.brushRadius * this.brushRadius;
    });
    if (this.grassPatches.length !== before) this.rebuildGrassPreview(true);

    this.emitSelection();
    this.triggerChange();
  }

  private scatterRandomTreesAt(hitX: number, hitZ: number): void {
    const now = performance.now();
    if (now - this.lastPlaceTime < 240) return;
    this.lastPlaceTime = now;

    const foliageList = REGION_TREE_BRUSH[this.meta.biome] ?? REGION_TREE_BRUSH.grassland;
    const treeCount = Math.max(1, Math.floor(this.brushStrength * 1.5));

    for (let i = 0; i < treeCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * this.brushRadius;
      const tx = hitX + Math.cos(angle) * dist;
      const tz = hitZ + Math.sin(angle) * dist;

      // Ensure dry ground
      const waterDepth = this.sampleWaterDepth(tx, tz);
      if (waterDepth > 0.05) continue;

      const ty = this.heightAt(tx, tz);
      const treeModel = foliageList[Math.floor(Math.random() * foliageList.length)]!;
      const yaw = Math.random() * Math.PI * 2;
      const scale = 0.85 + Math.random() * 0.5;

      void this.placeAsset(treeModel, "foliage", tx, ty, tz, yaw, scale);
    }
  }

  /** Spacing between grass dabs while dragging (fraction of brush radius). */
  private static readonly GRASS_STROKE_SPACING = 0.35;

  private grassStrokeSpacing(): number {
    return Math.max(0.45, this.brushRadius * RegionEditorScene.GRASS_STROKE_SPACING);
  }

  private acceptGrassStrokeSample(hitX: number, hitZ: number): boolean {
    if (this.lastGrassStrokePos) {
      const dist = Math.hypot(hitX - this.lastGrassStrokePos.x, hitZ - this.lastGrassStrokePos.z);
      if (dist < this.grassStrokeSpacing()) return false;
    }
    this.lastGrassStrokePos = { x: hitX, z: hitZ };
    return true;
  }

  /** Appends one GrassPatch dab; density texture refreshes on the frame loop / mouseup. */
  private paintGrassPatchAt(hitX: number, hitZ: number): void {
    if (!this.acceptGrassStrokeSample(hitX, hitZ)) return;

    const waterDepth = this.sampleWaterDepth(hitX, hitZ);
    if (waterDepth > 0.05) return;

    // Paint wins over erase: drop exclusions that overlap this dab so grass can
    // grow again in previously erased / empty-looking ground.
    const brushR = this.brushRadius;
    this.grassExclusions = this.grassExclusions.filter((ex) => {
      return Math.hypot(ex.localX - hitX, ex.localZ - hitZ) >= brushR + ex.radius;
    });

    const id = `grass_${this.nextId++}`;
    this.grassPatches.push({
      id,
      localX: hitX,
      localZ: hitZ,
      radius: brushR,
      density: Math.min(1, Math.max(0.1, this.brushStrength / 3)),
      seed: hashString(id),
      lengthScale: this.grassLength,
    });
    this.grassPreviewDirty = true;
    this.grassStrokeDirty = true;
  }

  /** Fine-grained grass removal while dragging — exclusion circles, live preview. */
  private eraseGrassAt(hitX: number, hitZ: number): void {
    if (!this.acceptGrassStrokeSample(hitX, hitZ)) return;

    const id = `grasserase_${this.nextId++}`;
    this.grassExclusions.push({
      localX: hitX,
      localZ: hitZ,
      radius: this.brushRadius,
      strength: Math.min(1, Math.max(0.05, this.brushStrength / 3)),
      seed: hashString(id),
    });
    this.grassPreviewDirty = true;
    this.grassStrokeDirty = true;
  }

  private ensureQuickGrassField(): QuickGrassField {
    if (!this.grassField) {
      this.grassField = createQuickGrassField(this.grassPreviewGroup, this.grassSettings);
      this.grassField.setHeightmap({
        gridSize: this.gridSize,
        pitch: this.pitch,
        heights: this.heights,
      });
    }
    return this.grassField;
  }

  /** Sync Quick Grass coverage (+ heightmap) from authored strokes. */
  private rebuildGrassPreview(_forceFull = false): void {
    if (this.grassPatches.length === 0) {
      if (this.grassField) {
        this.grassField.setCoverage([], this.grassExclusions);
      }
      this.grassPreviewDirty = false;
      return;
    }
    const field = this.ensureQuickGrassField();
    field.setHeightmap({ gridSize: this.gridSize, pitch: this.pitch, heights: this.heights });
    field.setCoverage(this.grassPatches, this.grassExclusions);
    field.setSettings(this.grassSettings);
    this.grassPreviewDirty = false;
  }

  /** Refresh density while brushing so paint/erase appear under the cursor.
   *  Coverage-only — skips the heightmap texture re-upload that the full
   *  rebuildGrassPreview() does, since paint/erase strokes never touch
   *  terrain heights. This runs on every mousemove while brushing (plus once
   *  per animation frame), so re-uploading the heightmap texture there was a
   *  measurable per-stroke GPU cost for no visual benefit. */
  private flushGrassPreviewWhileBrushing(): void {
    if (!this.grassPreviewDirty) return;
    if (this.grassPatches.length === 0 && !this.grassField) {
      this.grassPreviewDirty = false;
      return;
    }
    const field = this.ensureQuickGrassField();
    field.setCoverage(this.grassPatches, this.grassExclusions);
    this.grassPreviewDirty = false;
  }

  clearWater(): void {
    this.waterHeights.fill(0);
    this.waterActiveBounds = null;
    this.syncWaterMesh();
    this.triggerChange();
  }

  private syncWaterMesh(): void {
    if (this.waterHeights.length !== this.gridSize * this.gridSize) {
      this.waterHeights = new Float32Array(this.gridSize * this.gridSize);
      this.waterActiveBounds = null;
      this.waterFlowScratch = null;
    }
    if (!this.waterMeshField) {
      this.waterMeshField = buildRegionWaterMesh(this.gridSize, this.pitch, this.heights, this.waterHeights);
      this.scene.add(this.waterMeshField.mesh);
      applyWaterEnvironment(this.waterMeshField.mesh.material as THREE.MeshLambertMaterial, {
        skyColor: this.colorGrading.skyColor,
        fogColor: this.colorGrading.fogColor,
        groundTint: this.colorGrading.groundTint,
      });
    } else {
      this.waterMeshField.updateGeometry(this.heights, this.waterHeights, this.gridSize, this.pitch);
    }
  }

  private sampleWaterDepth(x: number, z: number): number {
    if (!this.waterHeights || this.waterHeights.length === 0) return 0;
    const half = ((this.gridSize - 1) * this.pitch) / 2;
    const gx = (x + half) / this.pitch;
    const gz = (z + half) / this.pitch;
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const tx = Math.min(1, Math.max(0, gx - x0));
    const tz = Math.min(1, Math.max(0, gz - z0));
    const cx0 = Math.min(this.gridSize - 1, Math.max(0, x0));
    const cx1 = Math.min(this.gridSize - 1, Math.max(0, x0 + 1));
    const cz0 = Math.min(this.gridSize - 1, Math.max(0, z0));
    const cz1 = Math.min(this.gridSize - 1, Math.max(0, z0 + 1));
    const w00 = this.waterHeights[cz0 * this.gridSize + cx0] ?? 0;
    const w10 = this.waterHeights[cz0 * this.gridSize + cx1] ?? 0;
    const w01 = this.waterHeights[cz1 * this.gridSize + cx0] ?? 0;
    const w11 = this.waterHeights[cz1 * this.gridSize + cx1] ?? 0;
    const a = w00 + (w10 - w00) * tx;
    const b = w01 + (w11 - w01) * tx;
    return Math.max(0, a + (b - a) * tz);
  }

  private dropWaterAt(hitX: number, hitZ: number, mode: "add" | "remove"): void {
    if (this.waterHeights.length !== this.gridSize * this.gridSize) {
      this.waterHeights = new Float32Array(this.gridSize * this.gridSize);
    }
    const half = ((this.gridSize - 1) * this.pitch) / 2;
    const clickGroundY = this.heightAt(hitX, hitZ);
    const clickWaterDepth = this.sampleWaterDepth(hitX, hitZ);
    const targetSurfaceY = clickGroundY + clickWaterDepth + (mode === "add" ? this.brushStrength * 1.5 : -this.brushStrength * 2.0);

    let changed = false;

    const { tx0, tx1, tz0, tz1 } = this.brushGridBounds(hitX, hitZ, this.brushRadius);
    if (mode === "add") this.growWaterBounds(tx0, tx1, tz0, tz1);
    for (let tz = tz0; tz <= tz1; tz++) {
      const wz = tz * this.pitch - half;
      for (let tx = tx0; tx <= tx1; tx++) {
        const wx = tx * this.pitch - half;
        const d = Math.hypot(wx - hitX, wz - hitZ);
        if (d > this.brushRadius) continue;
        const falloff = 1 - d / this.brushRadius;
        const idx = tz * this.gridSize + tx;
        const oldW = this.waterHeights[idx]!;
        const groundH = this.heights[idx]!;

        if (mode === "add") {
          // Fill deep holes up to target surface height
          const desiredW = Math.max(0.8, targetSurfaceY - groundH);
          const newW = Math.max(oldW, oldW + (desiredW - oldW) * falloff * 0.75);
          if (Math.abs(oldW - newW) > 0.001) {
            this.waterHeights[idx] = newW;
            changed = true;
          }
        } else {
          // Drain water
          const newW = Math.max(0, oldW - this.brushStrength * 1.5 * falloff);
          if (oldW !== newW) {
            this.waterHeights[idx] = newW;
            changed = true;
          }
        }
      }
    }

    if (mode === "add") {
      this.spawnWaterParticles(hitX, hitZ);
    }

    if (changed) {
      this.syncWaterMesh();
      this.triggerChange();
    }
  }

  private spawnWaterParticles(hitX: number, hitZ: number): void {
    const count = 3 + Math.floor(Math.random() * 3);
    const dropGeo = new THREE.SphereGeometry(0.25, 6, 6);
    const dropMat = new THREE.MeshBasicMaterial({ color: 0x44c0ff, transparent: true, opacity: 0.85 });
    const groundY = this.heightAt(hitX, hitZ);

    for (let i = 0; i < count; i++) {
      const pMesh = new THREE.Mesh(dropGeo, dropMat);
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * this.brushRadius * 0.4;
      const px = hitX + Math.cos(angle) * dist;
      const pz = hitZ + Math.sin(angle) * dist;
      const py = groundY + 2.5 + Math.random() * 2;
      pMesh.position.set(px, py, pz);
      this.waterParticlesGroup.add(pMesh);

      const vx = (Math.random() - 0.5) * 2;
      const vy = -5 - Math.random() * 3;
      const vz = (Math.random() - 0.5) * 2;

      this.waterParticles.push({
        obj: pMesh,
        vel: new THREE.Vector3(vx, vy, vz),
        life: 0,
        maxLife: 0.35 + Math.random() * 0.3,
      });
    }
  }

  private updateWaterParticles(dt: number): void {
    for (let i = this.waterParticles.length - 1; i >= 0; i--) {
      const p = this.waterParticles[i]!;
      p.life += dt;
      p.obj.position.addScaledVector(p.vel, dt);
      const groundY = this.heightAt(p.obj.position.x, p.obj.position.z);
      if (p.obj.position.y <= groundY || p.life >= p.maxLife) {
        this.waterParticlesGroup.remove(p.obj);
        p.obj.geometry.dispose();
        this.waterParticles.splice(i, 1);
      }
    }
  }

  /** Expands waterActiveBounds to include the given grid-index rectangle. */
  private growWaterBounds(tx0: number, tx1: number, tz0: number, tz1: number): void {
    const b = this.waterActiveBounds;
    this.waterActiveBounds = b
      ? { tx0: Math.min(b.tx0, tx0), tx1: Math.max(b.tx1, tx1), tz0: Math.min(b.tz0, tz0), tz1: Math.max(b.tz1, tz1) }
      : { tx0, tx1, tz0, tz1 };
  }

  /** Scans the full waterHeights array once for a tight active-water AABB --
   *  used only after a wholesale load (blueprint import), never per frame. */
  private recomputeWaterBoundsFull(): void {
    const gSize = this.gridSize;
    let tx0 = Infinity, tx1 = -Infinity, tz0 = Infinity, tz1 = -Infinity;
    for (let tz = 0; tz < gSize; tz++) {
      for (let tx = 0; tx < gSize; tx++) {
        if (this.waterHeights[tz * gSize + tx]! > 0.002) {
          if (tx < tx0) tx0 = tx;
          if (tx > tx1) tx1 = tx;
          if (tz < tz0) tz0 = tz;
          if (tz > tz1) tz1 = tz;
        }
      }
    }
    this.waterActiveBounds = tx0 <= tx1 ? { tx0, tx1, tz0, tz1 } : null;
  }

  private stepWaterPhysics(dt: number): void {
    if (!this.waterPhysicsSimulating || this.waterHeights.length === 0) return;
    const bounds = this.waterActiveBounds;
    if (!bounds) return;

    const gSize = this.gridSize;
    // Pad by 1 cell so flow can spread just past the tracked bounds; grown
    // back into waterActiveBounds below when that happens.
    const tx0 = Math.max(0, bounds.tx0 - 1);
    const tx1 = Math.min(gSize - 1, bounds.tx1 + 1);
    const tz0 = Math.max(0, bounds.tz0 - 1);
    const tz1 = Math.min(gSize - 1, bounds.tz1 + 1);

    // Run 3 fast sub-iterations per frame for smooth self-leveling pool surfaces
    const iterations = 3;
    const subDt = Math.min(0.033, dt) / iterations;
    const flowCoeff = subDt * 14.0;
    let totalChanged = false;

    if (!this.waterFlowScratch || this.waterFlowScratch.length !== this.waterHeights.length) {
      this.waterFlowScratch = new Float32Array(this.waterHeights.length);
    }
    const nextWater = this.waterFlowScratch;

    for (let iter = 0; iter < iterations; iter++) {
      // Snapshot only the region this iteration touches (bounded, not O(gridSize^2)).
      for (let tz = tz0; tz <= tz1; tz++) {
        const rowStart = tz * gSize;
        nextWater.set(this.waterHeights.subarray(rowStart + tx0, rowStart + tx1 + 1), rowStart + tx0);
      }
      let changed = false;

      for (let tz = tz0; tz <= tz1; tz++) {
        for (let tx = tx0; tx <= tx1; tx++) {
          const idx = tz * gSize + tx;
          const wCurr = this.waterHeights[idx]!;
          if (wCurr <= 0.001) continue;
          const hCurr = this.heights[idx]!;
          const sCurr = hCurr + wCurr;

          for (let n = 0; n < 4; n++) {
            let nIdx: number;
            if (n === 0) { if (tx <= 0) continue; nIdx = idx - 1; }
            else if (n === 1) { if (tx >= gSize - 1) continue; nIdx = idx + 1; }
            else if (n === 2) { if (tz <= 0) continue; nIdx = idx - gSize; }
            else { if (tz >= gSize - 1) continue; nIdx = idx + gSize; }

            const wNbr = this.waterHeights[nIdx]!;
            const hNbr = this.heights[nIdx]!;
            const sNbr = hNbr + wNbr;

            // Self-leveling & hole-filling flow: transfer fluid if current surface > neighbor surface
            if (sCurr > sNbr + 0.0001) {
              const diff = sCurr - sNbr;
              // If neighbor ground is lower than current surface, allow generous flow into deep hole
              const flowScale = (hNbr < sCurr) ? 0.75 : 0.4;
              const flow = Math.min(wCurr * 0.5, diff * flowScale * flowCoeff);
              if (flow > 0.00005) {
                nextWater[idx]! -= flow;
                nextWater[nIdx]! += flow;
                changed = true;
              }
            }
          }
        }
      }

      if (changed) {
        for (let tz = tz0; tz <= tz1; tz++) {
          const rowStart = tz * gSize;
          this.waterHeights.set(nextWater.subarray(rowStart + tx0, rowStart + tx1 + 1), rowStart + tx0);
        }
        totalChanged = true;
        // Ratchet tracked bounds to cover the padded region flow just
        // touched, so a spreading pond keeps widening its own pad ring
        // frame over frame instead of getting capped at the original AABB.
        this.growWaterBounds(tx0, tx1, tz0, tz1);
      } else {
        break;
      }
    }

    // Clean up ultra-thin residual film (< 0.003) so dry terrain stays clean
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const idx = tz * gSize + tx;
        if (this.waterHeights[idx]! > 0 && this.waterHeights[idx]! < 0.003) {
          this.waterHeights[idx] = 0;
          totalChanged = true;
        }
      }
    }

    if (totalChanged) {
      this.syncWaterMesh();
    }
  }

  // ============================ history ============================

  initHistory(): void {
    this.history = [];
    this.historyIndex = -1;
    this.pushHistory();
  }

  setMeta(
    patch: Partial<{
      id: string;
      name: string;
      biome: RegionBiome;
      portalWorldX: number;
      portalWorldZ: number;
      worldOriginX: number | undefined;
      worldOriginZ: number | undefined;
      isStartingRegion: boolean;
      musicTrack: string | null;
    }>,
  ): void {
    const originChanged =
      (patch.worldOriginX !== undefined && patch.worldOriginX !== this.meta.worldOriginX) ||
      (patch.worldOriginZ !== undefined && patch.worldOriginZ !== this.meta.worldOriginZ);
    this.meta = { ...this.meta, ...patch };
    if (patch.musicTrack !== undefined && this.playtestActive) {
      music.play(regionMusicTrackUrl(this.meta.musicTrack), 3000);
    }
    if (originChanged) this.updateNeighborReferenceOffsets();
  }

  getMeta(): {
    id: string;
    name: string;
    biome: RegionBiome;
    portalWorldX: number;
    portalWorldZ: number;
    worldOriginX: number | undefined;
    worldOriginZ: number | undefined;
    isStartingRegion: boolean;
    musicTrack: string | null;
  } {
    return { ...this.meta };
  }

  /** Heightmap span for continent layout map tiles. */
  getLayoutSpan(): { gridSize: number; pitch: number; worldOriginX: number; worldOriginZ: number } {
    return {
      gridSize: this.gridSize,
      pitch: this.pitch,
      worldOriginX: this.meta.worldOriginX ?? 0,
      worldOriginZ: this.meta.worldOriginZ ?? 0,
    };
  }

  get neighborReferenceCount(): number {
    return this.neighborGroups.size;
  }

  /**
   * Mount adjacent regions as dimmed, non-editable reference geometry so you
   * can mould the local seam against their terrain. Groups are offset by
   * world-origin delta into the editor's local frame.
   */
  setNeighborReferences(neighbors: RegionBlueprint[]): void {
    this.clearNeighborReferences();
    const editO = regionWorldOrigin(this.meta);
    for (const bp of neighbors) {
      if (!bp.heights?.length || bp.gridSize < 2) continue;
      if (bp.id && bp.id === this.meta.id) continue;
      const group = new THREE.Group();
      group.name = `region-reference:${bp.id || "anon"}`;
      group.userData.referenceRegionId = bp.id;
      const o = regionWorldOrigin(bp);
      group.userData.worldOriginX = o.x;
      group.userData.worldOriginZ = o.z;
      // Slight Y bias reduces seam z-fighting with the editable mesh.
      group.position.set(o.x - editO.x, -0.04, o.z - editO.z);

      const terrain = buildRegionBlueprintTerrain(bp);
      terrain.name = `region-reference-terrain:${bp.id}`;
      this.stylizeReferenceObject(terrain, 0.72);
      group.add(terrain);

      for (const vol of bp.terrainVolumes ?? []) {
        const mesh = createTerrainVolumeMesh(vol);
        delete mesh.userData.editorId;
        delete mesh.userData.editorKind;
        this.stylizeReferenceObject(mesh, 0.65);
        group.add(mesh);
      }

      if (bp.waterHeights && bp.waterHeights.length === bp.gridSize * bp.gridSize) {
        const water = buildRegionWaterMesh(bp.gridSize, bp.pitch, bp.heights, bp.waterHeights);
        applyWaterEnvironment(water.mesh.material as THREE.MeshLambertMaterial, {
          skyColor: bp.colorGrading.skyColor,
          fogColor: bp.colorGrading.fogColor,
          groundTint: bp.colorGrading.groundTint,
        });
        this.stylizeReferenceObject(water.mesh, 0.55);
        group.add(water.mesh);
      }

      this.scene.add(group);
      this.neighborGroups.set(bp.id || group.uuid, group);
    }
    this.camera.far =
      this.neighborGroups.size > 0
        ? RegionEditorScene.CAMERA_FAR_NEIGHBORS
        : RegionEditorScene.CAMERA_FAR_DEFAULT;
    this.camera.updateProjectionMatrix();
  }

  clearNeighborReferences(): void {
    for (const group of this.neighborGroups.values()) {
      this.scene.remove(group);
      this.disposeObject(group);
    }
    this.neighborGroups.clear();
    this.camera.far = RegionEditorScene.CAMERA_FAR_DEFAULT;
    this.camera.updateProjectionMatrix();
  }

  /** Re-offset references after the open region's world origin changes. */
  updateNeighborReferenceOffsets(): void {
    if (this.neighborGroups.size === 0) return;
    const editO = regionWorldOrigin(this.meta);
    for (const group of this.neighborGroups.values()) {
      const nOx = group.userData.worldOriginX as number | undefined;
      const nOz = group.userData.worldOriginZ as number | undefined;
      if (nOx === undefined || nOz === undefined) continue;
      group.position.set(nOx - editO.x, -0.04, nOz - editO.z);
    }
  }

  private stylizeReferenceObject(obj: THREE.Object3D, opacity: number): void {
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      delete mesh.userData.editorId;
      delete mesh.userData.editorKind;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const cloned = mats.map((m) => {
        const c = (m as THREE.Material).clone();
        c.transparent = true;
        c.opacity = opacity;
        c.depthWrite = opacity >= 0.9;
        if ("polygonOffset" in c) {
          (c as THREE.MeshLambertMaterial).polygonOffset = true;
          (c as THREE.MeshLambertMaterial).polygonOffsetFactor = 1;
          (c as THREE.MeshLambertMaterial).polygonOffsetUnits = 1;
        }
        return c;
      });
      mesh.material = Array.isArray(mesh.material) ? cloned : cloned[0]!;
    });
  }

  private pushHistory(): void {
    if (this.isRestoring) return;
    const snap = JSON.stringify(this.exportBlueprint());
    if (this.historyIndex >= 0 && this.history[this.historyIndex] === snap) return;
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(snap);
    this.historyIndex = this.history.length - 1;
  }

  undo(): void {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      const snap = JSON.parse(this.history[this.historyIndex]!) as RegionBlueprint;
      void this.loadBlueprint(snap).then(() => this.onChange?.());
    }
  }

  redo(): void {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      const snap = JSON.parse(this.history[this.historyIndex]!) as RegionBlueprint;
      void this.loadBlueprint(snap).then(() => this.onChange?.());
    }
  }

  private triggerChange(): void {
    if (!this.isRestoring) {
      this.pushHistory();
      this.onChange?.();
    }
  }

  // ============================ camera / viewport ============================

  resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private panCamera(dx: number, dz: number): void {
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    right.y = 0;
    right.normalize();
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    const offset = right.multiplyScalar(dx).add(forward.multiplyScalar(dz));
    this.camera.position.add(offset);
    this.orbit.target.add(offset);
    this.orbit.update();
  }

  private snapEnabled = true;

  setTransformMode(mode: EditorTransformMode): void {
    this.transform.setMode(mode);
    // Blueprints only persist yaw — hide pitch/roll handles in rotate mode.
    const yawOnly = mode === "rotate";
    this.transform.showX = !yawOnly;
    this.transform.showZ = !yawOnly;
    this.transform.showY = true;
    this.applyTransformSnap(this.snapEnabled);
  }

  setTransformSnap(enabled: boolean): void {
    this.snapEnabled = enabled;
    this.applyTransformSnap(enabled);
    this.onSnapChange?.(enabled);
  }

  isTransformSnapEnabled(): boolean {
    return this.snapEnabled;
  }

  private applyTransformSnap(enabled: boolean): void {
    if (!enabled) {
      this.transform.setTranslationSnap(null);
      this.transform.setRotationSnap(null);
      this.transform.setScaleSnap(null);
      return;
    }
    this.transform.setTranslationSnap(TRANSLATE_SNAP);
    this.transform.setRotationSnap(ROTATE_SNAP);
    this.transform.setScaleSnap(SCALE_SNAP);
  }

  /** Drop the current selection so its bounding-box floor sits on the heightmap. */
  dropSelectionToGround(): void {
    if (this.selectedIds.size === 0) return;
    this.selectionGroup.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.selectionGroup);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const groundY = this.heightAt(center.x, center.z);
    const delta = groundY - box.min.y;
    if (Math.abs(delta) < 1e-4) return;
    this.selectionGroup.position.y += delta;
    this.onTransformChange();
  }

  /** Nudge selection in camera-relative XZ (and Y with PageUp/PageDown). */
  private nudgeSelection(dx: number, dy: number, dz: number, fine = false): void {
    if (this.selectedIds.size === 0) return;
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    else forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    this.selectionGroup.position.addScaledVector(right, dx);
    this.selectionGroup.position.y += dy;
    this.selectionGroup.position.addScaledVector(forward, dz);
    if (this.snapEnabled) {
      const p = this.selectionGroup.position;
      const snap = fine ? TRANSLATE_SNAP_FINE : TRANSLATE_SNAP;
      p.x = Math.round(p.x / snap) * snap;
      p.y = Math.round(p.y / snap) * snap;
      p.z = Math.round(p.z / snap) * snap;
    }
    this.onTransformChange();
  }

  // ============================ playtest ============================
  // A real third-person walk-around mode for verifying scale/layout/color
  // grading in-place, without leaving the editor for a dev-login + teleport
  // round trip -- mirrors Game.ts's actual controller (same camera-orbit
  // constants, camera-relative WASD, avatar yaw locked to camera yaw,
  // walk/run animation selection) with a random class model standing in for
  // the player, rather than a generic disembodied fly-camera. Ground-clamped
  // only (no collision against props), same as the real game's own camera
  // ground-clamp branch for outdoor terrain.

  get isPlaytesting(): boolean {
    return this.playtestActive;
  }

  togglePlaytest(): boolean {
    if (this.playtestActive) this.exitPlaytest();
    else this.enterPlaytest();
    return this.playtestActive;
  }

  get navigationMode(): "fly" | "orbit" {
    return this.navMode;
  }

  /** Switch editor camera: Minecraft creative fly (default) or classic orbit. */
  setNavigationMode(mode: "fly" | "orbit"): void {
    if (this.playtestActive) this.exitPlaytest();
    this.applyNavMode(mode);
  }

  private setMarkersVisible(visible: boolean): void {
    for (const m of this.markers.values()) m.obj.visible = visible;
    if (this.entryMarker) this.entryMarker.obj.visible = visible;
  }

  private enterPlaytest(): void {
    this.suspendFlyNavListeners();
    this.disarm();
    this.deselect();
    this.setMarkersVisible(false);

    this.playtestSavedCameraPos.copy(this.camera.position);
    this.playtestSavedTarget.copy(this.orbit.target);
    this.orbit.enabled = false;

    const startX = this.entryMarker ? this.entryMarker.obj.position.x : this.camera.position.x;
    const startZ = this.entryMarker ? this.entryMarker.obj.position.z : this.camera.position.z;
    this.playtestPos.set(startX, this.heightAt(startX, startZ), startZ);
    this.cameraYaw = 0;
    this.cameraPitch = -0.35;
    this.playtestCameraDistance = RegionEditorScene.PLAYTEST_CAMERA_DISTANCE;
    this.playtestWheelAccum = 0;
    this.playtestAnimSpeed = 0;
    this.playtestVelocityY = 0;
    this.playtestGrounded = true;
    this.updatePlaytestCamera();

    const classId = CLASS_IDS[Math.floor(Math.random() * CLASS_IDS.length)]!;
    void this.spawnPlaytestAvatar(classId);

    // The Playtest button itself still has keyboard focus from the click
    // that got us here -- without blurring it, Space (jump) would also fire
    // the button's own default "activate on Space" behavior and immediately
    // toggle playtest back off.
    (document.activeElement as HTMLElement | null)?.blur();

    this.playtestKeys.clear();
    window.addEventListener("keydown", this.onPlaytestKeyDown);
    window.addEventListener("keyup", this.onPlaytestKeyUp);
    this.canvas.addEventListener("mousemove", this.onPlaytestMouseMove);
    this.canvas.addEventListener("wheel", this.onPlaytestWheel, { passive: false });
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    this.canvas.requestPointerLock();

    this.playtestActive = true;
    this.onPlaytestChange?.(true);
    // Build true-geometry (BVH) collision for solid assets (async: fetches the
    // offline meshes, then swaps in). Until it's ready, solids still collide
    // via the analytic fallback in playtestColliders().
    void this.rebuildPlaytestCollision();
    music.play(regionMusicTrackUrl(this.meta.musicTrack), 3000);
  }

  /** Bake solid assets' offline collision meshes into one region BVH for the
   *  playtest capsule. Rebuild after asset transform edits or on entry. */
  private async rebuildPlaytestCollision(): Promise<void> {
    const placed: PlacedCollider[] = [];
    const keys = new Set<string>();
    for (const a of this.assets.values()) {
      if (!a.solid) continue;
      const key = collisionModelKey(a.category, a.model);
      keys.add(key);
      placed.push({
        modelKey: key,
        x: a.obj.position.x,
        y: a.obj.position.y,
        z: a.obj.position.z,
        yaw: a.obj.rotation.y,
        scaleX: a.obj.scale.x || 1,
        scaleY: a.obj.scale.y || 1,
        scaleZ: a.obj.scale.z || 1,
      });
    }
    await preloadCollision(keys);
    if (!this.playtestActive) return; // exited while fetching
    const next = buildRegionCollisionBVH(placed, getCollisionMesh, { x: 0, z: 0 });
    disposeRegionCollision(this.playtestCollision);
    this.playtestCollision = next;
  }

  private async spawnPlaytestAvatar(classId: ClassId): Promise<void> {
    const model = new AnimatedModel(PLAYER_ANIMS);
    const gender = CLASS_GENDER[classId];
    model.group.visible = false;
    this.scene.add(model.group);
    await model.loadFrom(GENDER_MODEL_URLS[gender], RegionEditorScene.PLAYTEST_AVATAR_HEIGHT);
    // Base rig always hides its baked-in "Eyebrows" node (see AnimatedModel)
    // in favor of a real hair/eyebrows overlay -- without this the playtest
    // dummy would render bald and browless.
    await model.applyAppearance(gender, {
      gender,
      hairStyle: "none",
      facialHair: "none",
      hairColor: 0x2b1a12,
      eyeColor: 0x6b4423,
      outfitHue: 0xffffff,
    });
    if (!this.playtestActive) {
      // Exited before the model finished loading -- drop it rather than
      // leaving an orphaned, invisible group in the scene.
      this.scene.remove(model.group);
      return;
    }
    this.playtestAvatar = model;
    model.group.position.copy(this.playtestPos);
    model.group.rotation.y = this.cameraYaw;
    model.group.visible = true;
    model.play("idle");
  }

  private exitPlaytest(): void {
    this.playtestActive = false;
    window.removeEventListener("keydown", this.onPlaytestKeyDown);
    window.removeEventListener("keyup", this.onPlaytestKeyUp);
    this.canvas.removeEventListener("mousemove", this.onPlaytestMouseMove);
    this.canvas.removeEventListener("wheel", this.onPlaytestWheel);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();

    if (this.playtestAvatar) {
      this.scene.remove(this.playtestAvatar.group);
      this.playtestAvatar = null;
    }

    disposeRegionCollision(this.playtestCollision);
    this.playtestCollision = null;

    this.setMarkersVisible(true);
    // Resume whatever navigation mode was active before playtest.
    this.camera.position.copy(this.playtestSavedCameraPos);
    this.orbit.target.copy(this.playtestSavedTarget);
    this.applyNavMode(this.navMode);
    this.onPlaytestChange?.(false);
    music.stop();
  }

  private onPointerLockChange = (): void => {
    // Playtest still exits when the browser drops pointer lock (Esc / tab away).
    if (this.playtestActive && document.pointerLockElement !== this.canvas) {
      this.exitPlaytest();
    }
  };

  // ============================ fly navigation (default) ============================

  private applyNavMode(mode: "fly" | "orbit"): void {
    this.navMode = mode;
    this.flyLookDragging = false;
    if (mode === "fly") {
      // Hard-disable orbit so damping / RMB rotate can't fight the fly camera.
      this.orbit.enabled = false;
      this.orbit.enableDamping = false;
      this.initFlyPoseFromCamera();
      this.flyFlying = true;
      this.flyVelocityY = 0;
      this.flyGrounded = false;
      this.applyFlyCamera();
      this.bindFlyNavListeners();
    } else {
      this.suspendFlyNavListeners();
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      // Point orbit target ahead of the fly camera so the handoff feels natural.
      this.orbit.target.set(
        this.flyPos.x - Math.sin(this.flyYaw) * 20,
        this.flyPos.y + Math.sin(this.flyPitch) * 20,
        this.flyPos.z - Math.cos(this.flyYaw) * 20,
      );
      this.camera.rotation.order = "XYZ";
      this.camera.rotation.set(0, 0, 0);
      this.camera.position.copy(this.flyPos);
      this.orbit.enableDamping = true;
      this.orbit.enabled = true;
      this.orbit.update();
    }
    this.onFlyChange?.(mode === "fly");
  }

  private initFlyPoseFromCamera(): void {
    this.flyPos.copy(this.camera.position);
    const ground = this.heightAt(this.flyPos.x, this.flyPos.z);
    if (this.flyPos.y < ground + RegionEditorScene.FLY_EYE_HEIGHT) {
      this.flyPos.y = ground + RegionEditorScene.FLY_EYE_HEIGHT;
    }
    const to = new THREE.Vector3().subVectors(this.orbit.target, this.camera.position);
    if (to.lengthSq() > 1e-6) {
      this.flyYaw = Math.atan2(-to.x, -to.z);
      const flat = Math.hypot(to.x, to.z);
      this.flyPitch = flat > 1e-4 ? Math.atan2(to.y, flat) : -0.35;
    }
    this.flyPitch = Math.max(-1.55, Math.min(1.55, this.flyPitch));
  }

  private bindFlyNavListeners(): void {
    this.suspendFlyNavListeners();
    window.addEventListener("keydown", this.onFlyKeyDown);
    window.addEventListener("keyup", this.onFlyKeyUp);
  }

  private suspendFlyNavListeners(): void {
    window.removeEventListener("keydown", this.onFlyKeyDown);
    window.removeEventListener("keyup", this.onFlyKeyUp);
    this.flyKeys.clear();
    this.flyLookDragging = false;
    this.clearFlyUnlockTimer();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private isFlyMoveCode(code: string): boolean {
    return (
      code === "KeyW" ||
      code === "KeyA" ||
      code === "KeyS" ||
      code === "KeyD" ||
      code === "ArrowUp" ||
      code === "ArrowDown" ||
      code === "ArrowLeft" ||
      code === "ArrowRight" ||
      code === "ShiftLeft" ||
      code === "ShiftRight" ||
      code === "ControlLeft" ||
      code === "ControlRight" ||
      code === "Space"
    );
  }

  /** True while WASD / Space / arrows are steering — not Shift alone (that's select). */
  private flyIsNavigating(): boolean {
    return (
      this.flyKeyDown("KeyW") ||
      this.flyKeyDown("KeyA") ||
      this.flyKeyDown("KeyS") ||
      this.flyKeyDown("KeyD") ||
      this.flyKeyDown("ArrowUp") ||
      this.flyKeyDown("ArrowDown") ||
      this.flyKeyDown("ArrowLeft") ||
      this.flyKeyDown("ArrowRight") ||
      this.flyKeys.has("space")
    );
  }

  /** Keys that mean "I'm flying" — auto pointer-lock while any are held.
   *  Shift alone must NOT lock: cursor stays visible for Shift+marquee select. */
  private flyWantsLookLock(): boolean {
    if (this.navMode !== "fly" || this.playtestActive) return false;
    return this.flyIsNavigating();
  }

  private clearFlyUnlockTimer(): void {
    if (this.flyUnlockTimer !== null) {
      window.clearTimeout(this.flyUnlockTimer);
      this.flyUnlockTimer = null;
    }
  }

  private syncFlyPointerLock(): void {
    if (this.navMode !== "fly" || this.playtestActive) return;
    if (this.flyWantsLookLock()) {
      this.clearFlyUnlockTimer();
      if (document.pointerLockElement !== this.canvas) {
        void this.canvas.requestPointerLock();
      }
      return;
    }
    // Stay locked while RMB look is held; otherwise release after a short debounce.
    if (this.flyLookDragging) {
      this.clearFlyUnlockTimer();
      return;
    }
    if (document.pointerLockElement !== this.canvas) {
      this.clearFlyUnlockTimer();
      return;
    }
    if (this.flyUnlockTimer !== null) return;
    this.flyUnlockTimer = window.setTimeout(() => {
      this.flyUnlockTimer = null;
      if (
        !this.flyWantsLookLock() &&
        !this.flyLookDragging &&
        document.pointerLockElement === this.canvas
      ) {
        document.exitPointerLock();
      }
    }, RegionEditorScene.FLY_UNLOCK_DELAY_MS);
  }

  private onFlyKeyDown = (e: KeyboardEvent): void => {
    if (this.playtestActive || this.navMode !== "fly") return;
    const tag = (document.activeElement?.tagName ?? "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;

    if (e.key === "Escape") {
      // Unlock cursor for UI — stay in fly nav (unlike playtest exit).
      this.clearFlyUnlockTimer();
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
      this.flyKeys.clear();
      return;
    }
    if (e.code === "Space") {
      e.preventDefault();
      // keydown auto-repeats while held — must not count as double-tap or
      // fly/walk toggles every ~50ms and gravity makes movement feel choppy.
      if (!e.repeat) {
        const now = performance.now();
        if (now - this.flyLastSpaceAt < RegionEditorScene.FLY_DOUBLE_TAP_MS) {
          this.flyFlying = !this.flyFlying;
          this.flyVelocityY = 0;
          if (!this.flyFlying) this.flyGrounded = false;
          this.flyLastSpaceAt = 0;
        } else {
          this.flyLastSpaceAt = now;
          if (!this.flyFlying && this.flyGrounded) {
            this.flyVelocityY = JUMP_VELOCITY;
            this.flyGrounded = false;
          }
        }
      }
      this.flyKeys.add("space");
      this.syncFlyPointerLock();
      return;
    }
    if (e.repeat) return;
    // Cmd/Ctrl+D is duplicate — never treat D as strafe while the chord is held.
    if ((e.metaKey || e.ctrlKey) && e.code === "KeyD") return;
    // Cmd+letter never drives fly (Mac); Ctrl+WASD still sprints on W/A/S.
    if (e.metaKey && e.code.startsWith("Key")) return;
    // Allow Ctrl+WASD (sprint) / Shift+WASD; still ignore unrelated ctrl/meta shortcuts.
    if ((e.metaKey || e.ctrlKey) && !this.isFlyMoveCode(e.code)) return;
    this.flyKeys.add(e.code);
    this.syncFlyPointerLock();
  };

  private onFlyKeyUp = (e: KeyboardEvent): void => {
    if (e.code === "Space") {
      e.preventDefault();
      this.flyKeys.delete("space");
      this.syncFlyPointerLock();
      return;
    }
    this.flyKeys.delete(e.code);
    this.syncFlyPointerLock();
  };

  private onFlyLookMove(e: MouseEvent): void {
    if (this.navMode !== "fly" || this.playtestActive) return;
    const looking =
      this.flyLookDragging || document.pointerLockElement === this.canvas;
    if (!looking) return;
    this.flyYaw -= e.movementX * RegionEditorScene.FLY_MOUSE_SENSITIVITY;
    this.flyPitch -= e.movementY * RegionEditorScene.FLY_MOUSE_SENSITIVITY;
    this.flyPitch = Math.max(-1.55, Math.min(1.55, this.flyPitch));
  }

  private flyKeyDown(code: string): boolean {
    return this.flyKeys.has(code);
  }

  /** Unit look vector — must stay in lockstep with applyFlyCamera(). */
  private flyLookVector(out: THREE.Vector3): THREE.Vector3 {
    const cosP = Math.cos(this.flyPitch);
    const sinP = Math.sin(this.flyPitch);
    const sinY = Math.sin(this.flyYaw);
    const cosY = Math.cos(this.flyYaw);
    return out.set(-sinY * cosP, sinP, -cosY * cosP);
  }

  private updateFly(dt: number): void {
    const forward =
      (this.flyKeyDown("KeyW") || this.flyKeyDown("ArrowUp") ? 1 : 0) -
      (this.flyKeyDown("KeyS") || this.flyKeyDown("ArrowDown") ? 1 : 0);
    const strafe =
      (this.flyKeyDown("KeyD") || this.flyKeyDown("ArrowRight") ? 1 : 0) -
      (this.flyKeyDown("KeyA") || this.flyKeyDown("ArrowLeft") ? 1 : 0);
    const sprint = this.flyKeyDown("ControlLeft") || this.flyKeyDown("ControlRight");
    // Shift = descend only while actually flying; idle + visible cursor → Shift+select.
    const sneak =
      this.flyIsNavigating() &&
      (this.flyKeyDown("ShiftLeft") || this.flyKeyDown("ShiftRight"));
    const upHeld = this.flyKeys.has("space");

    const sinY = Math.sin(this.flyYaw);
    const cosY = Math.cos(this.flyYaw);
    // Horizontal strafe (level with the ground).
    const rightX = cosY;
    const rightZ = -sinY;

    if (this.flyFlying) {
      const speed = sprint
        ? RegionEditorScene.FLY_FLY_SPRINT_SPEED
        : RegionEditorScene.FLY_FLY_SPEED;
      // W/S fly along the look ray (look up → climb forward; look at a hill → go there).
      this.flyLookVector(this.flyLookDir);
      this.flyRightVec.set(rightX, 0, rightZ);
      this.flyMoveVec
        .copy(this.flyLookDir)
        .multiplyScalar(forward)
        .addScaledVector(this.flyRightVec, strafe);
      if (upHeld) this.flyMoveVec.y += 1;
      if (sneak) this.flyMoveVec.y -= 1;
      if (this.flyMoveVec.lengthSq() > 1e-8) {
        this.flyMoveVec.normalize().multiplyScalar(speed * dt);
        this.flyPos.add(this.flyMoveVec);
      }
      this.flyVelocityY = 0;
      this.flyGrounded = false;
    } else {
      // Ground walk: horizontal only.
      let moveX = -forward * sinY + strafe * rightX;
      let moveZ = -forward * cosY + strafe * rightZ;
      const mag = Math.hypot(moveX, moveZ);
      if (mag > 1) {
        moveX /= mag;
        moveZ /= mag;
      }
      const speed = sneak
        ? RegionEditorScene.FLY_SNEAK_SPEED
        : sprint
          ? RegionEditorScene.FLY_SPRINT_SPEED
          : RegionEditorScene.FLY_WALK_SPEED;
      this.flyPos.x += moveX * speed * dt;
      this.flyPos.z += moveZ * speed * dt;

      const ground = this.heightAt(this.flyPos.x, this.flyPos.z);
      const footY = this.flyPos.y - RegionEditorScene.FLY_EYE_HEIGHT;
      if (this.flyGrounded) {
        if (ground >= footY - MAX_STEP_DOWN) {
          this.flyPos.y = ground + RegionEditorScene.FLY_EYE_HEIGHT;
          this.flyVelocityY = 0;
          this.flyGrounded = true;
        } else {
          this.flyGrounded = false;
          this.flyVelocityY -= GRAVITY * dt;
          this.flyPos.y += this.flyVelocityY * dt;
        }
      } else {
        this.flyVelocityY -= GRAVITY * dt;
        this.flyPos.y += this.flyVelocityY * dt;
        const newFoot = this.flyPos.y - RegionEditorScene.FLY_EYE_HEIGHT;
        if (newFoot <= ground) {
          this.flyPos.y = ground + RegionEditorScene.FLY_EYE_HEIGHT;
          this.flyVelocityY = 0;
          this.flyGrounded = true;
        }
      }
    }

    this.applyFlyCamera();
  }

  private applyFlyCamera(): void {
    this.camera.position.copy(this.flyPos);
    // YXZ: rotation.x = +pitch matches look vector / lookAt (not negated).
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.y = this.flyYaw;
    this.camera.rotation.x = this.flyPitch;
    this.camera.rotation.z = 0;
  }

  private onPlaytestKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      this.exitPlaytest();
      return;
    }
    if (e.code === "Space") {
      // preventDefault on both keydown and keyup -- a focused button
      // activates on the Space *keyup* per the HTML spec, so keydown alone
      // isn't enough to stop it from re-toggling playtest.
      e.preventDefault();
      if (this.playtestGrounded) {
        this.playtestVelocityY = JUMP_VELOCITY;
        this.playtestGrounded = false;
      }
      return;
    }
    this.playtestKeys.add(e.key.toLowerCase());
  };

  private onPlaytestKeyUp = (e: KeyboardEvent): void => {
    if (e.code === "Space") {
      e.preventDefault();
      return;
    }
    this.playtestKeys.delete(e.key.toLowerCase());
  };

  /** Orbits the camera, not the avatar -- exactly Game.ts's pointer-lock
   *  mouse-look (same sensitivity, same pitch clamp), just renamed to match
   *  its real semantics (cameraYaw/cameraPitch) instead of the old FPS
   *  playtest's "camera IS the look direction" framing. */
  private onPlaytestMouseMove = (e: MouseEvent): void => {
    if (!this.playtestActive) return;
    this.cameraYaw -= e.movementX * RegionEditorScene.PLAYTEST_MOUSE_SENSITIVITY;
    this.cameraPitch -= e.movementY * RegionEditorScene.PLAYTEST_MOUSE_SENSITIVITY;
    this.cameraPitch = Math.max(-1.2, Math.min(0.5, this.cameraPitch));
  };

  private playtestWheelAccum = 0;
  private onPlaytestWheel = (e: WheelEvent): void => {
    if (!this.playtestActive) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 40 : e.deltaY;
    this.playtestWheelAccum += dy;
    const stepPx = 48;
    if (Math.abs(this.playtestWheelAccum) < stepPx) return;
    const dir = Math.sign(this.playtestWheelAccum);
    this.playtestWheelAccum -= dir * stepPx;
    if (Math.abs(this.playtestWheelAccum) > stepPx * 2) this.playtestWheelAccum = dir * stepPx;
    this.playtestCameraDistance = Math.max(
      RegionEditorScene.PLAYTEST_CAMERA_DISTANCE_MIN,
      Math.min(
        RegionEditorScene.PLAYTEST_CAMERA_DISTANCE_MAX,
        this.playtestCameraDistance + dir * RegionEditorScene.PLAYTEST_CAMERA_ZOOM_STEP,
      ),
    );
  };

  private updatePlaytest(dt: number): void {
    // Camera-relative WASD -> world-space movement, identical to Game.ts's
    // stepLocal(): forward = (sin yaw, cos yaw), screen-right = (-cos, sin).
    const moveXInput = (this.playtestKeys.has("d") ? 1 : 0) - (this.playtestKeys.has("a") ? 1 : 0);
    const moveYInput = (this.playtestKeys.has("s") ? 1 : 0) - (this.playtestKeys.has("w") ? 1 : 0);
    const sin = Math.sin(this.cameraYaw);
    const cos = Math.cos(this.cameraYaw);
    let moveX = -moveXInput * cos - moveYInput * sin;
    let moveZ = moveXInput * sin - moveYInput * cos;
    const mag = Math.hypot(moveX, moveZ);
    if (mag > 1) {
      moveX /= mag;
      moveZ /= mag;
    }

    const sprint = this.playtestKeys.has("shift");
    // Same sim as live gameplay: terrain(+volumes) via groundAt, asset decks
    // via regionAssets — don't fold asset tops into groundAt (that used a
    // stale playtest Y and fought stepMovement's own climbable snap).
    const regionAssets = this.playtestColliders();
    const groundAt = (x: number, z: number) => this.terrainVolumeGroundAt(x, z);
    const waterDepthAt = (x: number, z: number) => this.sampleWaterDepth(x, z);
    // True-geometry (BVH) collision for solid assets; the analytic colliders
    // above cover only the rest (see playtestColliders()).
    const col = this.playtestCollision;
    const r = PLAYER_BODY_RADIUS;
    const h = RegionEditorScene.PLAYTEST_CAPSULE_HEIGHT;
    const meshResolve = col
      ? (x: number, y: number, z: number) => resolveCapsule(col, x, y, z, { radius: r, height: h })
      : undefined;
    const meshGroundBelow = col
      ? (x: number, z: number, fromY: number, maxDrop: number) =>
          sampleGroundBelow(col, x, z, fromY, r, maxDrop)
      : undefined;
    let state = {
      x: this.playtestPos.x,
      y: this.playtestPos.y,
      z: this.playtestPos.z,
      vy: this.playtestVelocityY,
      grounded: this.playtestGrounded,
    };
    let remaining = Math.max(0, dt);
    while (remaining > 1e-6) {
      const step = Math.min(TICK_DT, remaining);
      state = stepMovement(
        state,
        { moveX, moveZ, jump: false, sprint, groundAt, waterDepthAt, regionAssets, meshResolve, meshGroundBelow },
        step,
      );
      remaining -= step;
    }
    this.playtestPos.x = state.x;
    this.playtestPos.y = state.y;
    this.playtestPos.z = state.z;
    this.playtestVelocityY = state.vy;
    this.playtestGrounded = state.grounded;

    const terrainY = this.heightAt(this.playtestPos.x, this.playtestPos.z);
    const waterDepth = this.sampleWaterDepth(this.playtestPos.x, this.playtestPos.z);
    const waterSurface = waterDepth > 0.05 ? terrainY + waterDepth : -Infinity;
    const swimmingNow =
      waterSurface > -Infinity &&
      waterDepth >= WADE_DEPTH &&
      this.playtestPos.y < waterSurface - SWIM_BODY_OFFSET;
    const speed = sprint ? SPRINT_SPEED : WALK_SPEED;

    if (this.playtestAvatar) {
      // Smoothed input magnitude -> anim speed, same shape as Game.ts's
      // animateSelf() so idle/walk/run thresholds land the same way.
      const inputMag = Math.min(1, Math.hypot(moveXInput, moveYInput));
      this.playtestAnimSpeed += (inputMag - this.playtestAnimSpeed) * Math.min(1, dt * 10);
      const animSpeed = this.playtestAnimSpeed * speed;
      this.playtestAvatar.group.position.copy(this.playtestPos);
      // Avatar always faces camera yaw, not its movement direction -- the
      // same "camera steers the body" scheme the real game uses, which is
      // why directionalMove()/logicalFromState() need the raw input axes
      // (not the world-space move vector) to pick strafe/walk-back clips.
      this.playtestAvatar.group.rotation.y = this.cameraYaw;
      const serverAnim = swimmingNow ? "swim" : this.playtestGrounded ? "idle" : "jump";
      const logical = logicalFromState(serverAnim, animSpeed, 3.5, moveXInput, moveYInput);
      this.playtestAvatar.play(logical);
      this.playtestAvatar.update(dt);
    }

    this.updatePlaytestCamera();
  }

  /** Live editor colliders for playtest — same bake as client/server movement. */
  private playtestColliders() {
    const bvhActive = this.playtestCollision !== null;
    const assets: RegionAsset[] = [...this.assets.values()]
      // Solid assets whose mesh is baked into the BVH are handled there — keep
      // them out of the analytic set to avoid double collision. Un-meshed
      // solids (e.g. meshopt rocks) and all non-solid props stay analytic.
      .filter((a) => !(bvhActive && a.solid && getCollisionMesh(collisionModelKey(a.category, a.model)) != null))
      .map((a) => {
      const s = regionAssetScaleFields(a.obj.scale.x || 1, a.obj.scale.y || 1, a.obj.scale.z || 1);
      return {
        model: a.model,
        category: a.category,
        localX: a.obj.position.x,
        localY: a.obj.position.y,
        localZ: a.obj.position.z,
        yaw: a.obj.rotation.y,
        ...s,
        ...(a.solid ? { solid: true } : {}),
        ...(a.solid && a.solidBox ? { solidBox: { ...a.solidBox } } : {}),
      };
    });
    const volumes = [...this.volumes.values()].map((v) => {
      this.syncVolumeDataFromMesh(v);
      return v.data;
    });
    const barriers = [...this.barrierVolumes.values()].map((b) => {
      this.syncBarrierDataFromGroup(b);
      return b.data;
    });
    return [
      ...regionAssetColliders([...assets, ...this.houseCollisionAssets]),
      ...regionVolumeColliders(volumes),
      ...regionBarrierColliders(barriers),
    ];
  }

  /** Returns resolved collision data for a placed asset entry, mirroring the
   *  shared resolveCollisionOverride() logic so playtest matches the game.
   *  Returns null if the model explicitly has no collision. */
  private resolveCollisionForAsset(a: AssetEntry): {
    radius: number; height: number; climbable: boolean;
    stairHalfLength?: number;
    solid?: boolean;
    halfX?: number;
    halfZ?: number;
    yaw?: number;
    baseY?: number;
    topY?: number;
    x?: number;
    z?: number;
  } | null {
    if (a.solid && a.solidBox) {
      const box = solidBoxColliderFields({
        localX: a.obj.position.x,
        localY: a.obj.position.y,
        localZ: a.obj.position.z,
        yaw: a.obj.rotation.y,
        ...regionAssetScaleFields(a.obj.scale.x || 1, a.obj.scale.y || 1, a.obj.scale.z || 1),
        solidBox: a.solidBox,
      });
      if (box) {
        return {
          radius: box.radius,
          height: box.topY - box.baseY,
          climbable: true,
          solid: true,
          halfX: box.halfX,
          halfZ: box.halfZ,
          yaw: box.yaw,
          baseY: box.baseY,
          topY: box.topY,
          x: box.x,
          z: box.z,
        };
      }
    }
    const ov = resolveAssetCollision(a.model, a.category);
    if (a.solid) {
      return ov
        ? { radius: Math.max(ov.radius, 0.35), height: ov.height, climbable: true, solid: true }
        : {
            radius: REGION_ASSET_COLLISION_RADIUS[a.category],
            height: REGION_ASSET_COLLISION_HEIGHT[a.category],
            climbable: true,
            solid: true,
          };
    }
    return ov;
  }

  /** Measure mesh AABB into model-local solidBox (and enable solid). */
  private applyMeasuredSolid(a: AssetEntry): void {
    const box = measureObjectSolidBox(a.obj);
    a.solid = true;
    a.solidBox = box ?? undefined;
  }

  /** Circle-collides (x,z) against every currently-placed asset, using the
   *  per-model override table (with per-category fallback) that
   *  regionAssetColliders() bakes into the real game's stepMovement() --
   *  reads straight off the live THREE objects rather than exporting a
   *  blueprint every frame. Only blocks entering a collider from outside it,
   *  same "allow escape" rule as stepMovement's own regionAssets check.
   *  Stair ramp assets are never blocked so you can walk up them. */
  private collidesWithAsset(x: number, z: number, oldX: number, oldZ: number, playerY: number): boolean {
    const blockAt = (ax: number, az: number, radius: number, climbable: boolean, stair: boolean): boolean => {
      if (stair || climbable) return false;
      if (radius <= 0) return false;
      const dx = x - ax;
      const dz = z - az;
      if (dx * dx + dz * dz >= radius * radius) return false;
      const oldDx = oldX - ax;
      const oldDz = oldZ - az;
      return oldDx * oldDx + oldDz * oldDz >= radius * radius;
    };

    for (const a of this.assets.values()) {
      const ov = this.resolveCollisionForAsset(a);
      if (!ov) continue;
      const scaleXZ = Math.max(a.obj.scale.x || 1, a.obj.scale.z || 1);
      if (blockAt(a.obj.position.x, a.obj.position.z, ov.radius * scaleXZ, ov.climbable, ov.stairHalfLength !== undefined)) {
        return true;
      }
    }
    for (const piece of this.houseCollisionAssets) {
      const ov = resolveAssetCollision(piece.model, "building");
      if (!ov) continue;
      const scale = piece.scale ?? 1;
      if (blockAt(piece.localX, piece.localZ, ov.radius * scale, ov.climbable, ov.stairHalfLength !== undefined)) {
        return true;
      }
    }
    for (const v of this.volumes.values()) {
      this.syncVolumeDataFromMesh(v);
      if (isTerrainStroke(v.data) && v.data.path) {
        for (const p of v.data.path) {
          const halfW = strokePointHalfWidth(v.data, p);
          const topY = strokePointTopY(v.data, p);
          if (carveBlocksSurface(v.data, p.x, p.z, topY)) continue;
          if (playerY >= topY - 0.3) continue;
          const dx = x - p.x;
          const dz = z - p.z;
          if (dx * dx + dz * dz < halfW * halfW) {
            const oldDx = oldX - p.x;
            const oldDz = oldZ - p.z;
            if (oldDx * oldDx + oldDz * oldDz >= halfW * halfW) return true;
          }
        }
        continue;
      }
      const radius = terrainVolumeRadius(v.data);
      if (radius <= 0.05) continue;
      if (v.data.shape === "ramp") continue;
      const topY = terrainVolumeTopY(v.data);
      if (carveBlocksSurface(v.data, x, z, topY)) continue;
      if (playerY >= topY - 0.3) continue;
      const dx = x - v.data.localX;
      const dz = z - v.data.localZ;
      if (dx * dx + dz * dz < radius * radius) {
        const oldDx = oldX - v.data.localX;
        const oldDz = oldZ - v.data.localZ;
        const alreadyInside = oldDx * oldDx + oldDz * oldDz < radius * radius;
        if (!alreadyInside) return true;
      }
    }
    const headY = playerY + 1.7;
    const barrierData = [...this.barrierVolumes.values()].map((b) => {
      this.syncBarrierDataFromGroup(b);
      return b.data;
    });
    for (const c of regionBarrierColliders(barrierData)) {
      if (headY <= c.baseY || playerY >= c.topY) continue;
      if (pointInColliderXZ(oldX, oldZ, c, PLAYER_BODY_RADIUS)) return true;
      if (segmentHitsColliderXZ(oldX, oldZ, x, z, c, PLAYER_BODY_RADIUS)) return true;
    }
    return false;
  }

  /** Terrain height at (x,z), raised to any climbable asset's own top
   *  surface (or interpolated along stair ramps) if the point falls within
   *  its footprint -- mirrors shared stepMovement()'s ground computation
   *  so a player who's jumped onto a rock rests on top of it, and stairs
   *  are smoothly walkable rather than solid walls. */
  private groundHeightAt(x: number, z: number, playerY = this.playtestPos.y): number {
    let ground = this.terrainVolumeGroundAt(x, z);
    const maxSurface = playerY + 1.15;

    // Same bake as playtest movement — OBB solids standable via climbable tops.
    for (const asset of this.playtestColliders()) {
      if (!pointInColliderXZ(x, z, asset, 0)) continue;
      if (asset.stairRamp) {
        const dx = x - asset.x;
        const dz = z - asset.z;
        const { dx: rdx, dz: rdz, halfLength, rise } = asset.stairRamp;
        const proj = (dx * rdx + dz * rdz) / halfLength;
        const t = Math.max(0, Math.min(1, (proj + 1) / 2));
        const rampY = asset.topY - rise + t * rise;
        if (rampY <= maxSurface && rampY > ground) ground = rampY;
      } else if (asset.climbable) {
        if (asset.topY <= maxSurface && asset.topY > ground) ground = asset.topY;
      }
    }
    return ground;
  }

  /** Heightmap + stamped volume tops only (no asset decks). */
  private terrainVolumeGroundAt(x: number, z: number): number {
    let ground = this.heightAt(x, z);

    for (const v of this.volumes.values()) {
      this.syncVolumeDataFromMesh(v);
      if (isTerrainStroke(v.data) && v.data.path) {
        for (const p of v.data.path) {
          const halfW = strokePointHalfWidth(v.data, p);
          const dx = x - p.x;
          const dz = z - p.z;
          if (dx * dx + dz * dz >= halfW * halfW) continue;
          const topY = strokePointTopY(v.data, p);
          if (carveBlocksSurface(v.data, p.x, p.z, topY)) continue;
          if (topY > ground) ground = topY;
        }
        continue;
      }
      const radius = terrainVolumeRadius(v.data);
      if (radius <= 0.05) continue;
      const dx = x - v.data.localX;
      const dz = z - v.data.localZ;
      if (dx * dx + dz * dz >= radius * radius) continue;
      if (v.data.shape === "ramp") {
        const sin = Math.sin(v.data.yaw);
        const cos = Math.cos(v.data.yaw);
        const halfLength = Math.max(0.5, v.data.scaleZ);
        const rise = v.data.scaleY * 2;
        const proj = (dx * -sin + dz * -cos) / halfLength;
        const t = Math.max(0, Math.min(1, (proj + 1) / 2));
        const baseY = v.data.localY - v.data.scaleY;
        const rampY = baseY + t * rise;
        if (carveBlocksSurface(v.data, x, z, rampY)) continue;
        if (rampY > ground) ground = rampY;
      } else {
        const topY = terrainVolumeTopY(v.data);
        if (carveBlocksSurface(v.data, x, z, topY)) continue;
        if (topY > ground) ground = topY;
      }
    }
    return ground;
  }

  /** Ported from Game.ts's updateCamera(), minus the indoor/dungeon
   *  ceiling-clamp branches (the editor is always outdoor sculpted terrain,
   *  no ceiling or water-level concept to clamp against). */
  private updatePlaytestCamera(): void {
    const px = this.playtestPos.x;
    const py = this.playtestPos.y;
    const pz = this.playtestPos.z;
    const cy = this.cameraYaw;
    const cp = this.cameraPitch;
    let distance = this.playtestCameraDistance;

    // Pull camera in when the arm hits a solid wall (indoors / tight yards).
    // Invisible barriers are intentionally ignored — same as live Game camera.
    const headY = py + 1.5;
    for (let t = 0.6; t < distance; t += 0.35) {
      const sx = px - Math.sin(cy) * (t * Math.cos(cp));
      const sy = headY - t * Math.sin(cp);
      const sz = pz - Math.cos(cy) * (t * Math.cos(cp));
      if (this.cameraBlockedAt(sx, sy, sz)) {
        distance = Math.max(0.9, t - 0.25);
        break;
      }
    }

    const targetX = px - Math.sin(cy) * (distance * Math.cos(cp));
    const targetZ = pz - Math.cos(cy) * (distance * Math.cos(cp));
    let targetY = py + RegionEditorScene.PLAYTEST_CAMERA_HEIGHT - distance * Math.sin(cp);
    targetY = Math.max(targetY, this.heightAt(targetX, targetZ) + 0.6);

    this.camera.position.set(targetX, targetY, targetZ);
    this.camera.lookAt(px, py + 1.5, pz);
  }

  /** True when a camera sample point sits inside a solid (non-climbable) collider. */
  private cameraBlockedAt(x: number, y: number, z: number): boolean {
    const hit = (ax: number, az: number, baseY: number, radius: number, height: number, climbable: boolean) => {
      if (climbable || radius <= 0) return false;
      const dx = x - ax;
      const dz = z - az;
      if (dx * dx + dz * dz >= radius * radius) return false;
      return y >= baseY - 0.2 && y <= baseY + height + 0.2;
    };
    for (const a of this.assets.values()) {
      if (a.solid && a.solidBox) {
        const box = solidBoxColliderFields({
          localX: a.obj.position.x,
          localY: a.obj.position.y,
          localZ: a.obj.position.z,
          yaw: a.obj.rotation.y,
          ...regionAssetScaleFields(a.obj.scale.x || 1, a.obj.scale.y || 1, a.obj.scale.z || 1),
          solidBox: a.solidBox,
        });
        if (!box) continue;
        if (y < box.baseY - 0.2 || y > box.topY + 0.2) continue;
        if (pointInColliderXZ(x, z, { ...box, climbable: false, solid: true }, 0)) return true;
        continue;
      }
      const ov = this.resolveCollisionForAsset(a);
      if (!ov) continue;
      const sx = a.obj.scale.x || 1;
      const sy = a.obj.scale.y || 1;
      const sz = a.obj.scale.z || 1;
      const scaleXZ = Math.max(sx, sz);
      if (hit(a.obj.position.x, a.obj.position.z, a.obj.position.y, ov.radius * scaleXZ, ov.height * sy, ov.climbable)) {
        return true;
      }
    }
    for (const piece of this.houseCollisionAssets) {
      const ov = resolveAssetCollision(piece.model, "building");
      if (!ov) continue;
      const scale = piece.scale ?? 1;
      if (hit(piece.localX, piece.localZ, piece.localY, ov.radius * scale, ov.height * scale, ov.climbable)) {
        return true;
      }
    }
    return false;
  }

  // ============================ color grading ============================

  applyColorGrading(cg: RegionColorGrading): void {
    this.colorGrading = { ...cg };
    const atm = atmosphereFromGrading(cg, 0.5);
    this.scene.background = new THREE.Color(0x02040a);
    this.skyDome.setAtmosphere(atm);
    this.scene.fog = new THREE.FogExp2(
      atm.fogColor.getHex(),
      clampRegionFogDensity(cg.fogDensity),
    );
    this.ambientLight.color = atm.ambientColor.clone();
    this.ambientLight.intensity = atm.ambientIntensity;
    this.sunLight.color = atm.sunColor.clone();
    this.sunLight.intensity = atm.sunIntensity;
    const elevRad = (atm.layers.sunElevation * Math.PI) / 180;
    const dist = 120;
    this.sunLight.position.set(
      Math.cos(0.6) * dist * Math.cos(elevRad),
      Math.max(20, Math.sin(elevRad) * dist),
      Math.sin(0.6) * dist * Math.cos(elevRad) + 40,
    );
    const fillColor = cg.fillColor ?? cg.ambientColor;
    const fillIntensity = cg.fillIntensity ?? 0;
    this.fillLight.color = atm.skyMidColor.clone();
    this.fillLight.groundColor = new THREE.Color(fillColor);
    this.fillLight.intensity = fillIntensity;
    this.renderer.toneMappingExposure = cg.exposure ?? 1;
    // groundTint feeds the terrain shader's tint, not a scene-level property
    // -- re-sync so a color-grading change previews on the ground live.
    this.syncTerrainMeshHeights();
    const waterMat = this.waterMeshField?.mesh.material;
    if (waterMat instanceof THREE.MeshLambertMaterial) {
      applyWaterEnvironment(waterMat, {
        skyColor: atm.skyMidColor,
        fogColor: atm.fogColor,
        groundTint: cg.groundTint,
      });
    }
    this.rebuildHorizon();
    this.triggerChange();
  }

  private rebuildHorizon(): void {
    if (this.horizonGroup) {
      this.scene.remove(this.horizonGroup);
      this.horizonGroup.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          (mesh.material as THREE.Material)?.dispose?.();
        }
      });
      this.horizonGroup = null;
    }
    if (!this.colorGrading.horizonEnabled) return;
    const halfSpan = ((this.gridSize - 1) * this.pitch) / 2;
    const cg = this.colorGrading;
    this.horizonGroup = buildRegionHorizon({
      innerRadius: cg.horizonInnerRadius ?? halfSpan * 0.85,
      outerRadius: cg.horizonOuterRadius ?? halfSpan * 1.35,
      peakScale: cg.horizonPeakScale ?? 1,
      tint: cg.horizonTint ?? "#8d97a8",
      seed: hashString(this.meta.id || this.meta.name),
    });
    this.scene.add(this.horizonGroup);
  }

  private syncBarrierDataFromGroup(entry: BarrierEntry): void {
    // Must use world transform — selected objects are parented under
    // selectionGroup, so local position is near 0 and must not be persisted.
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    entry.group.getWorldPosition(worldPos);
    entry.group.getWorldQuaternion(worldQuat);
    entry.group.getWorldScale(worldScale);
    entry.data.localX = worldPos.x;
    entry.data.localY = worldPos.y;
    entry.data.localZ = worldPos.z;
    entry.data.yaw = yawFromQuaternion(worldQuat);
    entry.data.sizeX = Math.max(0.1, worldScale.x);
    entry.data.sizeY = Math.max(0.1, worldScale.y);
    entry.data.sizeZ = Math.max(0.1, worldScale.z);
  }

  private barrierHandleHitAt(e: MouseEvent): { id: string; handle: BarrierHandleId } | null {
    const pickable: THREE.Object3D[] = [];
    for (const id of this.selectedIds) {
      const b = this.barrierVolumes.get(id);
      if (b) pickable.push(...barrierHandleMeshes(b.group));
    }
    if (pickable.length === 0) return null;
    this.raycaster.setFromCamera(this.ndcFromEvent(e), this.camera);
    const hits = this.raycaster.intersectObjects(pickable, false);
    if (hits.length === 0) return null;
    let obj: THREE.Object3D | null = hits[0]!.object;
    const handle = obj.userData.barrierHandle as BarrierHandleId | undefined;
    while (obj && !obj.userData.editorId) obj = obj.parent;
    if (!obj || !handle) return null;
    return { id: obj.userData.editorId as string, handle };
  }

  private beginBarrierResize(id: string, handle: BarrierHandleId): void {
    const entry = this.barrierVolumes.get(id);
    if (!entry) return;
    // Detach so resize writes world-space coords cleanly.
    for (const obj of [...this.selectionGroup.children]) this.scene.attach(obj);
    this.transform.detach();
    this.syncBarrierDataFromGroup(entry);
    this.orbit.enabled = false;
    this.barrierResizeDrag = {
      id,
      handle,
      planeY: entry.data.localY,
      start: {
        sizeX: entry.data.sizeX,
        sizeY: entry.data.sizeY,
        sizeZ: entry.data.sizeZ,
        localX: entry.data.localX,
        localY: entry.data.localY,
        localZ: entry.data.localZ,
        yaw: entry.data.yaw,
      },
    };
    setBarrierHandleHover(entry.group, handle);
  }

  private updateBarrierResize(e: MouseEvent): void {
    const drag = this.barrierResizeDrag;
    if (!drag) return;
    const entry = this.barrierVolumes.get(drag.id);
    if (!entry) return;
    const hit = this.planeHitAt(e, drag.planeY);
    if (!hit) return;
    const local = worldToBarrierLocalMeters(
      hit.x,
      hit.z,
      drag.start.localX,
      drag.start.localZ,
      drag.start.yaw,
    );
    entry.data = applyBarrierHandleResize(entry.data, drag.handle, local.x, local.z, drag.start);
    entry.data.localY = drag.start.localY;
    entry.data.sizeY = drag.start.sizeY;
    syncBarrierMesh(entry.group, entry.data);
    const helper = this.selectionHelpers.get(drag.id);
    if (helper) helper.update();
    this.emitSelection();
  }

  private endBarrierResize(): void {
    const drag = this.barrierResizeDrag;
    if (!drag) return;
    this.barrierResizeDrag = null;
    this.orbit.enabled = this.navMode === "orbit";
    this.canvas.style.cursor = "";
    const entry = this.barrierVolumes.get(drag.id);
    if (entry) setBarrierHandleHover(entry.group, null);
    this.updateSelectionGroup();
    this.triggerChange();
  }

  private updateBarrierHandleHover(e: MouseEvent): void {
    const hit = this.barrierHandleHitAt(e);
    const prev = this.barrierHoverHandle;
    if (prev && (!hit || prev.id !== hit.id || prev.handle !== hit.handle)) {
      const b = this.barrierVolumes.get(prev.id);
      if (b) setBarrierHandleHover(b.group, null);
      this.barrierHoverHandle = null;
      this.canvas.style.cursor = "";
    }
    if (hit) {
      const b = this.barrierVolumes.get(hit.id);
      if (b) setBarrierHandleHover(b.group, hit.handle);
      this.barrierHoverHandle = hit;
      this.canvas.style.cursor = "nwse-resize";
    }
  }

  private syncCloudDataFromGroup(entry: CloudEntry): void {
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    entry.group.getWorldPosition(worldPos);
    entry.group.getWorldQuaternion(worldQuat);
    entry.group.getWorldScale(worldScale);
    entry.data.localX = worldPos.x;
    entry.data.localY = worldPos.y;
    entry.data.localZ = worldPos.z;
    entry.data.yaw = yawFromQuaternion(worldQuat);
    entry.data.scaleX = Math.max(0.15, worldScale.x);
    entry.data.scaleY = Math.max(0.1, worldScale.y);
    entry.data.scaleZ = Math.max(0.15, worldScale.z);
  }

  private tickEditorClouds(dt: number): void {
    const windRad = ((this.wind.direction ?? 0) * Math.PI) / 180;
    const windStr = this.wind.strength ?? 1;
    for (const entry of this.clouds.values()) {
      const m = entry.group;
      const data = entry.data;
      const speed = (data.driftSpeed ?? 1.2) * (0.65 + 0.35 * windStr);
      const dir = this.wind != null ? windRad : data.yaw;
      m.position.x += Math.cos(dir) * speed * dt;
      m.position.z += Math.sin(dir) * speed * dt;
      const baseX = m.userData.cloudBaseX as number ?? data.localX;
      const baseZ = m.userData.cloudBaseZ as number ?? data.localZ;
      const wrap = 220;
      if (m.position.x - baseX > wrap) m.position.x -= wrap * 2;
      if (m.position.x - baseX < -wrap) m.position.x += wrap * 2;
      if (m.position.z - baseZ > wrap) m.position.z -= wrap * 2;
      if (m.position.z - baseZ < -wrap) m.position.z += wrap * 2;
      const phase = ((m.userData.cloudPhase as number) ?? 0) + dt * 0.35;
      m.userData.cloudPhase = phase;
      const bob = data.bobAmp ?? 0.4;
      const baseY = m.userData.cloudBaseY as number ?? data.localY;
      m.position.y = baseY + Math.sin(phase) * bob;
    }
  }

  getColorGrading(): RegionColorGrading {
    return { ...this.colorGrading };
  }

  // ============================ grass color ============================

  /** Updates Quick Grass root/tip colours (and legacy grassColor for export). */
  applyGrassColor(gc: GrassColor): void {
    this.grassColor = { ...gc };
    this.grassSettings = {
      ...this.grassSettings,
      baseColour: gc.bottom,
      tipColour: gc.top,
    };
    this.grassField?.setSettings({ baseColour: gc.bottom, tipColour: gc.top });
    this.triggerChange();
  }

  getGrassColor(): GrassColor {
    return {
      bottom: this.grassSettings.baseColour,
      top: this.grassSettings.tipColour,
    };
  }

  applyGrassSettings(partial: Partial<QuickGrassSettings>): void {
    this.grassSettings = { ...this.grassSettings, ...partial };
    if (partial.baseColour || partial.tipColour) {
      this.grassColor = {
        bottom: this.grassSettings.baseColour,
        top: this.grassSettings.tipColour,
      };
    }
    if (partial.windStrength !== undefined) this.grassSway = partial.windStrength;
    this.grassField?.setSettings(partial);
    this.triggerChange();
  }

  getGrassSettings(): QuickGrassSettings {
    return { ...this.grassSettings };
  }

  /** Brush setting — baked into each patch's lengthScale at paint time. */
  setGrassLength(length: number): void {
    this.grassLength = Math.max(0.2, length);
  }

  getGrassLength(): number {
    return this.grassLength;
  }

  /** Maps to Quick Grass windStrength for legacy UI. */
  setGrassSway(amount: number): void {
    this.grassSway = Math.max(0, amount);
    this.applyGrassSettings({ windStrength: this.grassSway });
  }

  getGrassSway(): number {
    return this.grassSettings.windStrength;
  }

  /** Region-wide wind for trees/clouds; also nudges grass wind direction. */
  applyWind(w: RegionWind): void {
    this.wind = { ...w };
    // Map degrees → a gentle drift so trees and grass share a breeze feel.
    this.grassField?.setSettings({
      windStrength: this.grassSettings.windStrength * Math.max(0.05, w.strength),
    });
    this.triggerChange();
  }

  getWind(): RegionWind {
    return { ...this.wind };
  }

  // ============================ placement arming ============================

  armPlacement(model: string, category: RegionAssetCategory): void {
    this.armedMarkerKind = null;
    this.armedHouse = false;
    this.armedCastle = false;
    this.armedFantasticBuilding = false;
    this.clearVolumeStamp();
    this.sculptMode = null;
    this.roadPaintArmed = false;
    this.armedModel = { model, category };
    this.orbit.enablePan = false;
    this.transform.detach();
  }

  armMarkerPlacement(kind: EditorMarkerKind): void {
    this.armedModel = null;
    this.armedHouse = false;
    this.armedCastle = false;
    this.armedFantasticBuilding = false;
    this.clearVolumeStamp();
    this.sculptMode = null;
    this.roadPaintArmed = false;
    this.armedMarkerKind = kind;
    this.orbit.enablePan = false;
    this.transform.detach();
  }

  /** Defaults for the next mobSpawn placements (and context-bar while armed). */
  setMobSpawnDefaults(difficulty: number, type: string | null): void {
    this.mobSpawnDifficulty = Math.max(0.25, Math.min(5, difficulty));
    this.mobSpawnType = type && type.length > 0 ? type : null;
  }

  getMobSpawnDefaults(): { difficulty: number; type: string | null } {
    return { difficulty: this.mobSpawnDifficulty, type: this.mobSpawnType };
  }

  setResourceNodeDefaults(type: string): void {
    this.resourceNodeType = isPlaceableRegionNodeType(type) ? type : "rock";
  }

  getResourceNodeDefaults(): { type: string } {
    return { type: this.resourceNodeType };
  }

  setContextMenuHandler(handler: (state: EditorContextMenuState | null) => void): void {
    this.onContextMenuUi = handler;
  }

  dismissContextMenu(): void {
    this.onContextMenuUi?.(null);
  }

  runContextMenuAction(actionId: EditorContextMenuActionId): void {
    this.onContextMenuUi?.(null);
    if (actionId === "assignResource") {
      this.convertSelectedFoliageToResourceNodes();
      return;
    }
    if (actionId === "delete") {
      this.deleteSelected();
    }
  }

  /** Convert selected foliage props into gatherable resource nodes (keeps model). */
  convertSelectedFoliageToResourceNodes(): number {
    const ids = [...this.selectedIds];
    let converted = 0;
    const created: string[] = [];
    for (const id of ids) {
      const a = this.assets.get(id);
      if (!a || a.category !== "foliage") continue;
      const nodeType = foliageModelToResourceType(a.model);
      if (!nodeType || !isPlaceableRegionNodeType(nodeType)) continue;
      const x = a.obj.position.x;
      const y = a.obj.position.y;
      const z = a.obj.position.z;
      const model = a.model;
      // Remove decorative asset first so we don't double-draw.
      this.scene.remove(a.obj);
      this.disposeObject(a.obj);
      this.assets.delete(id);
      const helper = this.selectionHelpers.get(id);
      if (helper) {
        this.scene.remove(helper);
        helper.dispose();
        this.selectionHelpers.delete(id);
      }
      this.resourceNodeType = nodeType;
      const markerId = this.placeMarkerAt("resourceNode", x, y, z);
      const m = this.markers.get(markerId);
      if (m) {
        m.nodeType = nodeType;
        m.nodeModel = model;
        this.rebuildResourceNodeMarkerVisual(m);
        created.push(markerId);
        converted++;
      }
    }
    if (converted > 0) {
      for (const obj of [...this.selectionGroup.children]) this.scene.attach(obj);
      this.selectedIds = new Set(created);
      this.updateSelectionGroup();
      this.emitSelection();
      this.triggerChange();
    }
    return converted;
  }

  /** Arms the procedural-house tool -- the next click on the terrain
   *  generates a full house (random footprint/style/door/window layout from
   *  houseGen.ts, or a fixed type if `type` is given) centered on that point
   *  and places it as ordinary editable building-category assets sharing one
   *  groupId. Stays armed after placing so multiple houses can be dropped in
   *  a row; call `disarm()` (or arm a different tool) to stop. */
  armHousePlacement(type: HouseType = "random"): void {
    this.armedModel = null;
    this.armedMarkerKind = null;
    this.sculptMode = null;
    this.waterBrushMode = null;
    this.texturePaintMode = null;
    this.randomTreeBrushActive = false;
    this.grassBrushActive = false;
    this.grassEraseBrushActive = false;
    this.eraseBrushActive = false;
    this.roadPaintArmed = false;
    this.clearVolumeStamp();
    this.armedCastle = false;
    this.armedFantasticBuilding = false;
    this.armedHouse = true;
    this.armedHouseType = type;
    this.orbit.enablePan = false;
    this.transform.detach();
    this.deselect();
  }

  /** Arms the procedural-castle tool — next terrain click drops a full keep
   *  (curtain walls + corner towers) as grouped building assets. */
  armCastlePlacement(opts?: {
    style?: CastleStyle;
    size?: CastleSize;
    height?: CastleHeight;
  }): void {
    this.armedModel = null;
    this.armedMarkerKind = null;
    this.sculptMode = null;
    this.waterBrushMode = null;
    this.texturePaintMode = null;
    this.randomTreeBrushActive = false;
    this.grassBrushActive = false;
    this.grassEraseBrushActive = false;
    this.eraseBrushActive = false;
    this.roadPaintArmed = false;
    this.clearVolumeStamp();
    this.armedHouse = false;
    this.armedFantasticBuilding = false;
    this.armedCastle = true;
    this.armedCastleStyle = opts?.style ?? "random";
    this.armedCastleSize = opts?.size ?? 2;
    this.armedCastleHeight = opts?.height ?? 2;
    this.orbit.enablePan = false;
    this.transform.detach();
    this.deselect();
  }

  /** Arms the procedural fantasy-village building tool — next terrain click
   *  drops a whole building (see fantasticBuildingGen.ts) as grouped
   *  building-category assets. Single-click only, same reasoning as houses:
   *  a building is a dozen-plus pieces, so a drag shouldn't spam them. */
  armFantasticBuildingPlacement(type: FantasticBuildingType = "random"): void {
    this.armedModel = null;
    this.armedMarkerKind = null;
    this.sculptMode = null;
    this.waterBrushMode = null;
    this.texturePaintMode = null;
    this.randomTreeBrushActive = false;
    this.grassBrushActive = false;
    this.grassEraseBrushActive = false;
    this.eraseBrushActive = false;
    this.roadPaintArmed = false;
    this.clearVolumeStamp();
    this.armedHouse = false;
    this.armedCastle = false;
    this.armedFantasticBuilding = true;
    this.armedFantasticBuildingType = type;
    this.orbit.enablePan = false;
    this.transform.detach();
    this.deselect();
  }

  disarm(): void {
    this.armedModel = null;
    this.armedMarkerKind = null;
    this.armedHouse = false;
    this.armedCastle = false;
    this.armedFantasticBuilding = false;
    this.clearVolumeStamp();
    this.armedLightColor = null;
    this.armedFogColor = null;
    this.armedBarrier = false;
    this.armedCloudShape = null;
    this.sculptMode = null;
    this.waterBrushMode = null;
    this.texturePaintMode = null;
    this.randomTreeBrushActive = false;
    this.grassBrushActive = false;
    this.grassEraseBrushActive = false;
    this.eraseBrushActive = false;
    this.roadPaintArmed = false;
    if (this.paintingRoad) {
      // Discard an in-progress drag rather than silently finalizing it --
      // Escape/tool-switch should cancel, same as it does for sculpt/place.
      this.paintingRoad = null;
      this.syncTerrainMeshHeights();
    }
    this.orbit.enablePan = true;
  }

  get isArmed(): boolean {
    return (
      this.armedModel !== null ||
      this.armedMarkerKind !== null ||
      this.armedLightColor !== null || this.armedFogColor !== null ||
      this.armedBarrier ||
      this.armedCloudShape !== null ||
      this.armedHouse ||
      this.armedCastle ||
      this.volumeStampActive ||
      this.sculptMode !== null ||
      this.waterBrushMode !== null ||
      this.texturePaintMode !== null ||
      this.randomTreeBrushActive ||
      this.grassBrushActive ||
      this.grassEraseBrushActive ||
      this.eraseBrushActive ||
      this.roadPaintArmed
    );
  }

  // ============================ mouse / interaction ============================

  private ndcFromEvent(e: MouseEvent): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  private terrainHitAt(e: MouseEvent): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.ndcFromEvent(e), this.camera);
    const hit = this.raycaster.intersectObject(this.terrainMesh, false)[0];
    return hit ? hit.point : null;
  }

  /** Raycast against the heightmap AND stamped volumes so the volume brush
   *  can stack stamps on top of previously sculpted features. */
  private volumeSurfaceHitAt(e: MouseEvent): THREE.Vector3 | null {
    return this.volumeSurfaceHitDetailAt(e)?.point ?? null;
  }

  /** Surface hit with world normal — used by clay sculpt to grow along the face. */
  private volumeSurfaceHitDetailAt(
    e: MouseEvent,
  ): { point: THREE.Vector3; normal: THREE.Vector3 } | null {
    this.raycaster.setFromCamera(this.ndcFromEvent(e), this.camera);
    const targets: THREE.Object3D[] = [this.terrainMesh, ...[...this.volumes.values()].map((v) => v.obj)];
    const hit = this.raycaster.intersectObjects(targets, false)[0];
    if (!hit) return null;
    const normal = (hit.face?.normal.clone() ?? new THREE.Vector3(0, 1, 0));
    if (hit.object) {
      const nMat = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
      normal.applyMatrix3(nMat).normalize();
    }
    // Prefer outward-facing normal relative to the camera.
    if (normal.dot(this.raycaster.ray.direction) > 0) normal.negate();
    return { point: hit.point.clone(), normal };
  }

  /** Cursor hit on the infinite horizontal plane at `y` -- used by the drag
   *  sculpt brush so the stroke can stretch to any distance while staying on
   *  the elevation where it started (terrain/volume raycasts miss or climb
   *  once the live mesh is under the cursor). */
  private planeHitAt(e: MouseEvent, y: number): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.ndcFromEvent(e), this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, hit) ? hit : null;
  }

  private stampVolumeAt(hit: THREE.Vector3): void {
    if (this.volumeBrushStyle === "sculpt") {
      this.sculptVolumeStroke(hit);
      return;
    }
    if (this.volumeBrushStyle === "clay") {
      this.sculptClayAt(hit, new THREE.Vector3(0, 1, 0));
      return;
    }
    const now = performance.now();
    // Place mode: light drag still works, but throttle so one click ≠ a pile.
    if (now - this.lastPlaceTime < 90) return;
    this.lastPlaceTime = now;
    this.placeOneVolume(hit.x, hit.y, hit.z, this.brushRadius, 0.35);
    this.triggerChange();
  }

  /**
   * Blender-style clay brush in 3D: Add piles boulder/block blobs along the
   * surface normal; Sub punches carve spheres into hit volumes.
   */
  private sculptClayAt(hit: THREE.Vector3, normal: THREE.Vector3): void {
    if (this.volumeSculptOp === "sub") {
      this.carveAt(hit.x, hit.y, hit.z);
      return;
    }
    const spacing = Math.max(0.22, this.brushRadius * 0.32);
    if (this.lastVolumeStrokePos) {
      if (hit.distanceTo(this.lastVolumeStrokePos) < spacing) return;
    }
    this.lastVolumeStrokePos = hit.clone();
    this.placeClayBlob(hit, normal);
    this.triggerChange();
  }

  /** One clay dab centered on the surface, nudged outward along the normal. */
  private placeClayBlob(hit: THREE.Vector3, normal: THREE.Vector3): void {
    const shape: TerrainVolumeShape = this.volumeShape === "block" ? "block" : "boulder";
    const r = Math.max(0.4, this.brushRadius * 0.42 * this.brushStrength);
    const scale = defaultVolumeScale(shape, r);
    const jitter = r * 0.12;
    const jx = (Math.random() - 0.5) * jitter;
    const jy = (Math.random() - 0.5) * jitter;
    const jz = (Math.random() - 0.5) * jitter;
    // Grow outward from the surface (Draw brush), not planted on the ground plane.
    const push = Math.min(scale.scaleX, scale.scaleY, scale.scaleZ) * 0.55;
    const id = `volume_${this.nextId++}`;
    const data: RegionTerrainVolume = {
      id,
      shape,
      material: this.volumeMaterial,
      localX: hit.x + normal.x * push + jx,
      localY: hit.y + normal.y * push + jy,
      localZ: hit.z + normal.z * push + jz,
      yaw: Math.random() * Math.PI * 2,
      scaleX: scale.scaleX * (0.85 + Math.random() * 0.3),
      scaleY: scale.scaleY * (0.85 + Math.random() * 0.3),
      scaleZ: scale.scaleZ * (0.85 + Math.random() * 0.3),
    };
    const mesh = createTerrainVolumeMesh(data);
    this.scene.add(mesh);
    this.volumes.set(id, { id, data, obj: mesh });
  }

  /** Continuous drag-sculpt: grow ONE extruded mesh that follows the mouse
   *  path exactly (XZ), locked to the starting height. */
  private sculptVolumeStroke(hit: THREE.Vector3): void {
    if (!this.activeStroke) {
      this.beginActiveStroke(hit);
      return;
    }
    const y = this.activeStroke.start.y;
    const target = { x: hit.x, y, z: hit.z };
    const last = this.activeStroke.path[this.activeStroke.path.length - 1]!;
    const dist = Math.hypot(target.x - last.x, target.z - last.z);
    // Tight spacing so fast curves still hug the cursor path.
    const spacing = Math.max(0.15, this.brushRadius * 0.12);
    if (dist < spacing) return;

    const steps = Math.max(1, Math.floor(dist / spacing));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.activeStroke.path.push({
        x: last.x + (target.x - last.x) * t,
        y,
        z: last.z + (target.z - last.z) * t,
      });
    }
    this.refreshActiveStrokeMesh();
  }

  private beginActiveStroke(hit: THREE.Vector3): void {
    const size = strokeSizeFromBrush(this.volumeShape, this.brushRadius, this.brushStrength);
    const id = `volume_${this.nextId++}`;
    const start = { x: hit.x, y: hit.y, z: hit.z };
    // Need 2+ path points for stroke mesh construction; the second is a
    // tiny seed that the first real mouse move replaces/extends past.
    const path = [
      { ...start },
      { x: hit.x + 0.02, y: hit.y, z: hit.z },
    ];
    const data: RegionTerrainVolume = {
      id,
      shape: this.volumeShape,
      material: this.volumeMaterial,
      localX: hit.x,
      localY: hit.y,
      localZ: hit.z,
      yaw: 0,
      scaleX: size.halfWidth,
      scaleY: size.height,
      scaleZ: size.halfWidth,
      path,
    };
    const mesh = createTerrainVolumeMesh(data);
    const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
    mat.transparent = true;
    mat.opacity = 0.85;
    mesh.material = mat;
    this.scene.add(mesh);
    this.activeStroke = { id, start, path, mesh, data };
  }

  private refreshActiveStrokeMesh(): void {
    if (!this.activeStroke) return;
    const size = strokeSizeFromBrush(this.volumeShape, this.brushRadius, this.brushStrength);
    const path = this.activeStroke.path;
    const cx = path.reduce((s, p) => s + p.x, 0) / path.length;
    const cy = path.reduce((s, p) => s + p.y, 0) / path.length;
    const cz = path.reduce((s, p) => s + p.z, 0) / path.length;
    this.activeStroke.data.shape = this.volumeShape;
    this.activeStroke.data.material = this.volumeMaterial;
    this.activeStroke.data.scaleX = size.halfWidth;
    this.activeStroke.data.scaleY = size.height;
    this.activeStroke.data.scaleZ = size.halfWidth;
    this.activeStroke.data.path = path;
    this.activeStroke.data.localX = cx;
    this.activeStroke.data.localY = cy;
    this.activeStroke.data.localZ = cz;
    rebuildTerrainStrokeMesh(this.activeStroke.mesh, this.activeStroke.data);
  }

  private cancelActiveStroke(): void {
    if (!this.activeStroke) return;
    this.scene.remove(this.activeStroke.mesh);
    this.activeStroke.mesh.geometry.dispose();
    (this.activeStroke.mesh.material as THREE.Material).dispose();
    this.activeStroke = null;
  }

  /** Finalize the in-progress stroke as one committed volume entry. */
  private commitActiveStroke(): void {
    if (!this.activeStroke) return;
    const stroke = this.activeStroke;
    this.activeStroke = null;

    const path = stroke.path;
    let len = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!;
      const b = path[i]!;
      len += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    }

    // Discard the live preview mesh (unique geo + cloned material).
    this.scene.remove(stroke.mesh);
    stroke.mesh.geometry.dispose();
    (stroke.mesh.material as THREE.Material).dispose();

    // Too short = discrete stamp instead of a degenerate ribbon.
    if (path.length < 3 || len < 0.6) {
      const p = path[0]!;
      this.placeOneVolume(p.x, p.y, p.z, this.brushRadius, 0.1);
      this.triggerChange();
      return;
    }

    const size = strokeSizeFromBrush(this.volumeShape, this.brushRadius, this.brushStrength);
    const cx = path.reduce((s, p) => s + p.x, 0) / path.length;
    const cy = path.reduce((s, p) => s + p.y, 0) / path.length;
    const cz = path.reduce((s, p) => s + p.z, 0) / path.length;
    const data: RegionTerrainVolume = {
      id: stroke.id,
      shape: this.volumeShape,
      material: this.volumeMaterial,
      localX: cx,
      localY: cy,
      localZ: cz,
      yaw: 0,
      scaleX: size.halfWidth,
      scaleY: size.height,
      scaleZ: size.halfWidth,
      path: path.map((p) => ({ ...p })),
    };
    const mesh = createTerrainVolumeMesh(data);
    this.scene.add(mesh);
    this.volumes.set(data.id, { id: data.id, data, obj: mesh });
    this.triggerChange();
  }

  /** Approximate surface Y at (x,z) from heightmap + volume tops (for stacking). */
  private volumeSurfaceYAt(x: number, z: number): number {
    let y = this.heightAt(x, z);
    for (const v of this.volumes.values()) {
      if (isTerrainStroke(v.data) && v.data.path) {
        for (const p of v.data.path) {
          const halfW = strokePointHalfWidth(v.data, p);
          const dx = x - p.x;
          const dz = z - p.z;
          if (dx * dx + dz * dz > halfW * halfW) continue;
          const top = strokePointTopY(v.data, p);
          if (carveBlocksSurface(v.data, p.x, p.z, top)) continue;
          if (top > y) y = top;
        }
        continue;
      }
      const r = terrainVolumeRadius(v.data);
      const dx = x - v.data.localX;
      const dz = z - v.data.localZ;
      if (dx * dx + dz * dz > r * r) continue;
      const top = terrainVolumeTopY(v.data);
      if (carveBlocksSurface(v.data, x, z, top)) continue;
      if (top > y) y = top;
    }
    return y;
  }

  private placeOneVolume(
    x: number,
    surfaceY: number,
    z: number,
    sizeRadius: number,
    jitterFrac: number,
  ): void {
    const scale = defaultVolumeScale(this.volumeShape, sizeRadius);
    const jitterR = sizeRadius * jitterFrac;
    const ang = Math.random() * Math.PI * 2;
    const dist = Math.random() * jitterR;
    const jx = Math.cos(ang) * dist;
    const jz = Math.sin(ang) * dist;
    const lift = 0.45 + Math.random() * 0.3;
    const cy = surfaceY + scale.scaleY * lift;
    const yaw = Math.random() * Math.PI * 2;
    const id = `volume_${this.nextId++}`;
    const data: RegionTerrainVolume = {
      id,
      shape: this.volumeShape,
      material: this.volumeMaterial,
      localX: x + jx,
      localY: cy,
      localZ: z + jz,
      yaw,
      scaleX: scale.scaleX * (0.8 + Math.random() * 0.4),
      scaleY: scale.scaleY * (0.8 + Math.random() * 0.4),
      scaleZ: scale.scaleZ * (0.8 + Math.random() * 0.4),
    };
    const mesh = createTerrainVolumeMesh(data);
    this.scene.add(mesh);
    this.volumes.set(id, { id, data, obj: mesh });
  }

  private updateVolumeGhost(e: MouseEvent): void {
    if (!this.volumeGhost || !this.volumeStampActive) return;
    const detail =
      this.volumeBrushStyle === "sculpt" && this.activeStroke
        ? (() => {
            const p = this.planeHitAt(e, this.activeStroke!.start.y);
            return p ? { point: p, normal: new THREE.Vector3(0, 1, 0) } : null;
          })()
        : this.volumeSurfaceHitDetailAt(e);
    if (!detail) {
      this.volumeGhost.visible = false;
      if (this.volumeBrushRing) this.volumeBrushRing.visible = false;
      return;
    }
    const { point: hit, normal } = detail;
    const ghostR =
      this.volumeBrushStyle === "sculpt" || this.volumeBrushStyle === "clay"
        ? this.brushRadius * 0.45 * (this.volumeBrushStyle === "clay" ? this.brushStrength : 1)
        : this.brushRadius;
    const s = defaultVolumeScale(this.volumeShape, ghostR);
    this.volumeGhost.visible = this.volumeBrushStyle !== "clay" || this.volumeSculptOp === "add";
    if (this.volumeBrushStyle === "clay") {
      const push = Math.min(s.scaleX, s.scaleY, s.scaleZ) * 0.55;
      this.volumeGhost.position.set(
        hit.x + normal.x * push,
        hit.y + normal.y * push,
        hit.z + normal.z * push,
      );
    } else {
      this.volumeGhost.position.set(hit.x, hit.y + s.scaleY * 0.7, hit.z);
    }
    this.volumeGhost.scale.set(s.scaleX, s.scaleY, s.scaleZ);
    if (this.volumeBrushRing) {
      this.volumeBrushRing.visible = true;
      this.volumeBrushRing.position.set(hit.x, hit.y + 0.08, hit.z);
    }
  }

  private onContextMenu = (e: MouseEvent): void => {
    if (this.playtestActive) return;
    e.preventDefault();
    const hit = this.pickEditorIdAt(e);
    if (!hit) {
      this.onContextMenuUi?.(null);
      return;
    }
    this.select(hit.kind, hit.id, false);
    const actions: EditorContextMenuState["actions"] = [];
    const a = this.assets.get(hit.id);
    if (a?.category === "foliage" && foliageModelToResourceType(a.model)) {
      const nodeType = foliageModelToResourceType(a.model)!;
      let typeLabel = nodeType;
      try {
        typeLabel = nodeTypeDef(nodeType).name;
      } catch {
        /* keep id */
      }
      actions.push({
        id: "assignResource",
        label: `Assign as Resource (${typeLabel})`,
      });
    }
    // Also allow assign when selection contains convertible foliage.
    if (actions.length === 0) {
      for (const id of this.selectedIds) {
        const sel = this.assets.get(id);
        if (sel?.category === "foliage" && foliageModelToResourceType(sel.model)) {
          actions.push({ id: "assignResource", label: "Assign as Resource Node" });
          break;
        }
      }
    }
    actions.push({ id: "delete", label: "Delete" });
    const title = a ? a.model.replace(/\.(glb|gltf)$/i, "") : hit.kind;
    this.onContextMenuUi?.({
      x: e.clientX,
      y: e.clientY,
      title,
      actions,
    });
  };

  private onMouseDown = (e: MouseEvent): void => {
    if (this.playtestActive) return;
    if (e.button === 0) this.onContextMenuUi?.(null);
    // Optional RMB look while stationary (movement keys auto-lock instead).
    // Right-click on a selectable entity opens the context menu instead.
    if (this.navMode === "fly" && e.button === 2 && !this.escortPathTracingActive) {
      if (this.pickEditorIdAt(e)) {
        e.preventDefault();
        return;
      }
      this.onContextMenuUi?.(null);
      this.flyLookDragging = true;
      this.orbit.enabled = false;
      if (document.pointerLockElement !== this.canvas) void this.canvas.requestPointerLock();
      e.preventDefault();
      return;
    }
    if (this.transform.dragging) return; // grabbing the gizmo, not placing/sculpting/painting
    if (e.button === 0 && !this.isArmed) {
      const handleHit = this.barrierHandleHitAt(e);
      if (handleHit) {
        this.beginBarrierResize(handleHit.id, handleHit.handle);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
    if (this.escortPathTracingActive && this.activeEscortQuest) {
      if (e.button === 2) {
        const wpHit = this.waypointHitAt(e);
        if (wpHit) {
          this.removeEscortWaypoint(wpHit.index);
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      } else if (e.button === 0) {
        const wpHit = this.waypointHitAt(e);
        if (wpHit) {
          this.selectWaypoint(wpHit.index);
          this.isDraggingWaypoint = true;
          this.orbit.enabled = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const hit = this.terrainHitAt(e);
        if (!hit) return;
        this.addEscortWaypoint(hit.x, hit.z);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
    if (e.button !== 0) return;
    if (this.sculptMode) {
      const hit = this.volumeSurfaceHitAt(e) ?? this.terrainHitAt(e);
      if (!hit) return;
      this.isSculpting = true;
      this.moldTargetHeight = hit.y;
      this.lastCarvePos = null;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.sculptAt(hit.x, hit.y, hit.z, this.sculptMode);
      e.preventDefault();
      e.stopPropagation();
    } else if (this.volumeStampActive) {
      this.isVolumeStamping = true;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.lastPlaceTime = 0;
      this.lastVolumeStrokePos = null;
      this.lastCarvePos = null;
      if (this.volumeBrushStyle === "clay") {
        const detail = this.volumeSurfaceHitDetailAt(e);
        if (!detail) {
          this.isVolumeStamping = false;
          return;
        }
        this.sculptClayAt(detail.point, detail.normal);
      } else if (this.volumeBrushStyle === "sculpt") {
        const hit = this.volumeSurfaceHitAt(e) ?? this.terrainHitAt(e);
        if (!hit) {
          this.isVolumeStamping = false;
          return;
        }
        this.cancelActiveStroke();
        this.sculptVolumeStroke(hit);
      } else {
        const hit = this.volumeSurfaceHitAt(e);
        if (!hit) {
          this.isVolumeStamping = false;
          return;
        }
        this.stampVolumeAt(hit);
      }
      e.preventDefault();
      e.stopPropagation();
    } else if (this.waterBrushMode) {
      const hit = this.terrainHitAt(e);
      if (!hit) return;
      this.isWatering = true;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.dropWaterAt(hit.x, hit.z, this.waterBrushMode);
      e.preventDefault();
      e.stopPropagation();
    } else if (this.randomTreeBrushActive) {
      const hit = this.terrainHitAt(e);
      if (!hit) return;
      this.isTreeBrushing = true;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.lastPlaceTime = 0;
      this.scatterRandomTreesAt(hit.x, hit.z);
      e.preventDefault();
      e.stopPropagation();
    } else if (this.grassBrushActive) {
      const hit = this.terrainHitAt(e);
      if (!hit) return;
      this.isGrassBrushing = true;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.lastGrassStrokePos = null;
      this.grassStrokeDirty = false;
      this.paintGrassPatchAt(hit.x, hit.z);
      this.flushGrassPreviewWhileBrushing();
      e.preventDefault();
      e.stopPropagation();
    } else if (this.grassEraseBrushActive) {
      const hit = this.terrainHitAt(e);
      if (!hit) return;
      this.isErasingGrass = true;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.lastGrassStrokePos = null;
      this.grassStrokeDirty = false;
      this.eraseGrassAt(hit.x, hit.z);
      this.flushGrassPreviewWhileBrushing();
      e.preventDefault();
      e.stopPropagation();
    } else if (this.eraseBrushActive) {
      const hit = this.terrainHitAt(e);
      if (!hit) return;
      this.isErasing = true;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.lastPlaceTime = 0;
      this.eraseAssetsAt(hit.x, hit.z);
      e.preventDefault();
      e.stopPropagation();
    } else if (this.roadPaintArmed) {
      const hit = this.terrainHitAt(e);
      if (!hit) return;
      this.paintingRoad = [{ x: hit.x, z: hit.z }];
      e.preventDefault();
      e.stopPropagation();
    } else if (this.texturePaintMode !== null) {
      const hit = this.terrainHitAt(e);
      if (!hit) return;
      this.isTexturePainting = true;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.paintTextureAt(hit.x, hit.z, this.texturePaintMode);
      e.preventDefault();
      e.stopPropagation();
    } else if (
      this.armedModel ||
      this.armedMarkerKind ||
      this.armedLightColor ||
      this.armedFogColor ||
      this.armedBarrier ||
      this.armedCloudShape
    ) {
      this.isDraggingToPlace = true;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.lastPlaceTime = performance.now();
      this.placeAtEvent(e);
      e.preventDefault();
      e.stopPropagation();
    } else if (this.armedHouse) {
      // Deliberately not wired into isDraggingToPlace/placeAtEvent's
      // click-and-drag painting -- a house is dozens of assets, so each
      // press should drop exactly one, not one per drag tick.
      const hit = this.terrainHitAt(e);
      if (hit) void this.placeHouseAt(hit.x, hit.y, hit.z);
      e.preventDefault();
      e.stopPropagation();
    } else if (this.armedCastle) {
      const hit = this.terrainHitAt(e);
      if (hit) void this.placeCastleAt(hit.x, hit.y, hit.z);
      e.preventDefault();
      e.stopPropagation();
    } else if (this.armedFantasticBuilding) {
      const hit = this.terrainHitAt(e);
      if (hit) void this.placeFantasticBuildingAt(hit.x, hit.y, hit.z);
      e.preventDefault();
      e.stopPropagation();
    } else if (e.shiftKey && document.pointerLockElement !== this.canvas) {
      // Shift+drag marquee multi-select when the cursor is free (not fly-steering).
      this.marqueeStart = { x: e.clientX, y: e.clientY };
      this.orbit.enabled = false;
      e.preventDefault();
      e.stopPropagation();
    }
  };

  private onClick = (e: MouseEvent): void => {
    if (this.playtestActive) return;
    if (performance.now() - this.lastMarqueeEnd < 100) return;
    if (!this.isArmed) this.handleSelectClick(e);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.playtestActive) return;
    if (this.navMode === "fly") this.onFlyLookMove(e);
    if (this.flyLookDragging) {
      e.preventDefault();
      return;
    }
    if (this.barrierResizeDrag) {
      this.updateBarrierResize(e);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (!this.isArmed && !this.transform.dragging) {
      this.updateBarrierHandleHover(e);
    }
    if (this.isDraggingWaypoint && this.selectedWaypointIndex !== null && this.activeEscortQuest) {
      const hit = this.terrainHitAt(e);
      if (hit) {
        const m = this.markers.get(this.activeEscortQuest.markerId);
        if (m && m.npcData?.quests) {
          const q = m.npcData.quests.find((q) => q.id === this.activeEscortQuest!.questId);
          if (q && q.waypoints && q.waypoints[this.selectedWaypointIndex] !== undefined) {
            const wp = q.waypoints[this.selectedWaypointIndex]!;
            wp.x = Math.round(hit.x * 10) / 10;
            wp.z = Math.round(hit.z * 10) / 10;
            this.rebuildEscortPathVisuals();
            this.triggerChange();
            this.emitSelection();
          }
        }
      }
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (this.isSculpting && this.sculptMode) {
      const hit = this.volumeSurfaceHitAt(e) ?? this.terrainHitAt(e);
      if (hit) this.sculptAt(hit.x, hit.y, hit.z, this.sculptMode);
      e.preventDefault();
      e.stopPropagation();
    } else if (this.isVolumeStamping && this.volumeStampActive) {
      if (this.volumeBrushStyle === "clay") {
        const detail = this.volumeSurfaceHitDetailAt(e);
        if (detail) this.sculptClayAt(detail.point, detail.normal);
      } else if (this.volumeBrushStyle === "sculpt" && this.activeStroke) {
        const hit = this.planeHitAt(e, this.activeStroke.start.y);
        if (hit) this.sculptVolumeStroke(hit);
      } else {
        const hit = this.volumeSurfaceHitAt(e);
        if (hit) this.stampVolumeAt(hit);
      }
      e.preventDefault();
      e.stopPropagation();
    } else if (this.isWatering && this.waterBrushMode) {
      const hit = this.terrainHitAt(e);
      if (hit) this.dropWaterAt(hit.x, hit.z, this.waterBrushMode);
      e.preventDefault();
      e.stopPropagation();
    } else if (this.isTexturePainting && this.texturePaintMode !== null) {
      const hit = this.terrainHitAt(e);
      if (hit) this.paintTextureAt(hit.x, hit.z, this.texturePaintMode);
      e.preventDefault();
      e.stopPropagation();
    } else if (this.isTreeBrushing && this.randomTreeBrushActive) {
      const hit = this.terrainHitAt(e);
      if (hit) this.scatterRandomTreesAt(hit.x, hit.z);
      e.preventDefault();
      e.stopPropagation();
    } else if (this.isGrassBrushing && this.grassBrushActive) {
      const hit = this.terrainHitAt(e);
      if (hit) {
        this.paintGrassPatchAt(hit.x, hit.z);
        this.flushGrassPreviewWhileBrushing();
      }
      e.preventDefault();
      e.stopPropagation();
    } else if (this.isErasingGrass && this.grassEraseBrushActive) {
      const hit = this.terrainHitAt(e);
      if (hit) {
        this.eraseGrassAt(hit.x, hit.z);
        this.flushGrassPreviewWhileBrushing();
      }
      e.preventDefault();
      e.stopPropagation();
    } else if (this.isErasing && this.eraseBrushActive) {
      const hit = this.terrainHitAt(e);
      if (hit) this.eraseAssetsAt(hit.x, hit.z);
      e.preventDefault();
      e.stopPropagation();
    } else if (this.paintingRoad) {
      const hit = this.terrainHitAt(e);
      if (hit) {
        const last = this.paintingRoad[this.paintingRoad.length - 1]!;
        if (Math.hypot(hit.x - last.x, hit.z - last.z) > 3) {
          this.paintingRoad.push({ x: hit.x, z: hit.z });
          this.syncTerrainMeshHeights();
        }
      }
      e.preventDefault();
      e.stopPropagation();
    } else if (this.isDraggingToPlace && this.isArmed) {
      const now = performance.now();
      if (now - this.lastPlaceTime >= 350) {
        this.lastPlaceTime = now;
        this.placeAtEvent(e);
      }
      e.preventDefault();
      e.stopPropagation();
    } else if (this.marqueeStart) {
      this.onMarqueeUpdate?.({
        startX: this.marqueeStart.x,
        startY: this.marqueeStart.y,
        endX: e.clientX,
        endY: e.clientY,
      });
      e.preventDefault();
      e.stopPropagation();
    } else if (this.volumeStampActive) {
      this.updateVolumeGhost(e);
    }
  };

  private onMouseUp = (e?: MouseEvent): void => {
    if (this.flyLookDragging) {
      this.flyLookDragging = false;
      this.syncFlyPointerLock();
    }
    if (this.barrierResizeDrag) {
      this.endBarrierResize();
    }
    if (this.isDraggingWaypoint) {
      this.isDraggingWaypoint = false;
      this.orbit.enabled = this.navMode === "orbit";
    }

    if (this.marqueeStart) {
      const start = this.marqueeStart;
      this.marqueeStart = null;
      this.onMarqueeUpdate?.(null);
      this.orbit.enabled = this.navMode === "orbit";

      if (e && e.type === "mouseup") {
        const end = { x: e.clientX, y: e.clientY };
        const dist = Math.hypot(end.x - start.x, end.y - start.y);
        if (dist > 5) {
          this.lastMarqueeEnd = performance.now();
          // Shift starts the marquee (left-drag is orbit pan); Ctrl/Cmd keeps
          // prior selection so a second box can add to it. Plain Shift+drag replaces.
          this.applyMarqueeSelection(start, end, e.ctrlKey || e.metaKey);
        }
      }
    }

    this.isDraggingToPlace = false;
    this.isSculpting = false;
    if (this.isVolumeStamping && this.volumeBrushStyle === "sculpt") {
      this.commitActiveStroke();
    }
    this.isVolumeStamping = false;
    this.lastVolumeStrokePos = null;
    this.lastCarvePos = null;
    this.isWatering = false;
    this.isTexturePainting = false;
    this.isTreeBrushing = false;
    const finishedGrassStroke =
      this.isGrassBrushing || this.isErasingGrass || this.grassStrokeDirty;
    this.isGrassBrushing = false;
    this.isErasingGrass = false;
    this.isErasing = false;
    this.moldTargetHeight = null;
    this.dragStart = null;
    this.lastGrassStrokePos = null;
    if (this.grassPreviewDirty) {
      this.rebuildGrassPreview(true);
    }
    if (finishedGrassStroke && this.grassStrokeDirty) {
      this.grassStrokeDirty = false;
      this.triggerChange();
    }
    if (this.paintingRoad) {
      if (this.paintingRoad.length >= 2) {
        this.roads.push({ points: this.paintingRoad, width: this.roadWidth });
      }
      this.paintingRoad = null;
      this.triggerChange();
    }
  };

  /** Frustum-select every editor object whose mesh falls inside the screen
   *  rectangle from `start`→`end`. House pieces expand to their full groupId
   *  set so a marquee that catches one wall selects the whole house. */
  private applyMarqueeSelection(
    start: { x: number; y: number },
    end: { x: number; y: number },
    additive: boolean,
  ): void {
    const rect = this.canvas.getBoundingClientRect();
    this.selectionBox.startPoint.set(
      ((start.x - rect.left) / rect.width) * 2 - 1,
      -((start.y - rect.top) / rect.height) * 2 + 1,
      0.5,
    );
    this.selectionBox.endPoint.set(
      ((end.x - rect.left) / rect.width) * 2 - 1,
      -((end.y - rect.top) / rect.height) * 2 + 1,
      0.5,
    );

    const selected = this.selectionBox.select();
    const idsToAdd = new Set<string>();
    for (const obj of selected) {
      let curr: THREE.Object3D | null = obj;
      while (curr && !curr.userData.editorId) curr = curr.parent;
      if (!curr?.userData.editorId) continue;
      const id = curr.userData.editorId as string;
      const kind = curr.userData.editorKind as "asset" | "marker" | "light" | "volume" | "fog" | "house" | undefined;
      if (kind === "asset" || kind === "marker" || kind === "light" || kind === "volume" || kind === "fog" || kind === "house") {
        for (const expanded of this.idsForSelection(kind, id)) idsToAdd.add(expanded);
      } else {
        idsToAdd.add(id);
      }
    }

    if (idsToAdd.size === 0) return;
    if (!additive) this.selectedIds.clear();
    for (const id of idsToAdd) this.selectedIds.add(id);
    this.updateSelectionGroup();
  }

  private placeAtEvent(e: MouseEvent): void {
    const hit = this.terrainHitAt(e);
    if (!hit) return;
    const x = hit.x;
    const z = hit.z;

    if (this.armedModel) {
      void this.placeAsset(this.armedModel.model, this.armedModel.category, x, hit.y, z, Math.random() * Math.PI * 2);
    } else if (this.armedMarkerKind) {
      if (this.armedMarkerKind === "entry" && this.entryMarker) {
        this.entryMarker.obj.position.set(x, hit.y + 0.5, z);
        this.triggerChange();
        return;
      }
      const id = this.placeMarkerAt(this.armedMarkerKind, x, hit.y, z);
      this.select("marker", id, false);
    } else if (this.armedLightColor) {
      this.placeLight(x, hit.y, z, this.armedLightColor);
    } else if (this.armedFogColor) {
      this.placeFogVolume(x, hit.y, z, this.armedFogColor, this.armedFogShape);
    } else if (this.armedBarrier) {
      this.placeBarrierVolume(x, hit.y, z);
    } else if (this.armedCloudShape) {
      this.placeCloud(x, hit.y, z, this.armedCloudShape);
    }
  }

  private pickEditorIdAt(
    e: MouseEvent,
  ): {
    kind: "asset" | "marker" | "light" | "volume" | "fog" | "house" | "barrier" | "cloud";
    id: string;
  } | null {
    this.raycaster.setFromCamera(this.ndcFromEvent(e), this.camera);
    const pickable: THREE.Object3D[] = [
      ...[...this.assets.values()].map((a) => a.obj),
      ...[...this.volumes.values()].map((v) => v.obj),
      ...[...this.markers.values()].map((m) => m.obj),
      ...[...this.lights.values()].map((l) => l.obj),
      ...[...this.fogVolumes.values()].map((f) => f.mesh),
      ...[...this.barrierVolumes.values()].map((b) => b.group),
      ...[...this.clouds.values()].map((c) => c.group),
      ...[...this.houses.values()].map((h) => h.group),
    ];
    if (this.entryMarker) pickable.push(this.entryMarker.obj);
    const hits = this.raycaster.intersectObjects(pickable, true);
    if (hits.length === 0) return null;
    let obj: THREE.Object3D | null = hits[0]!.object;
    while (obj && !obj.userData.editorId) obj = obj.parent;
    if (!obj?.userData.editorId) return null;
    const kind = obj.userData.editorKind as
      | "asset"
      | "marker"
      | "light"
      | "volume"
      | "fog"
      | "house"
      | "barrier"
      | "cloud";
    return { kind, id: String(obj.userData.editorId) };
  }

  private handleSelectClick(e: MouseEvent): void {
    const hit = this.pickEditorIdAt(e);
    if (hit) this.select(hit.kind, hit.id, e.shiftKey);
    else if (!e.shiftKey) this.deselect();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.playtestActive) return;
    // Fly nav owns WASD / Space / arrows — don't also fire editor binds.
    // Chorded shortcuts (Cmd/Ctrl+C/V/D) must still reach the handlers below;
    // otherwise Cmd+D is swallowed here and only strafes the fly camera.
    if (this.navMode === "fly" && !e.metaKey && !e.ctrlKey) {
      const code = e.code;
      if (
        code === "KeyW" ||
        code === "KeyA" ||
        code === "KeyS" ||
        code === "KeyD" ||
        code === "Space" ||
        code === "ShiftLeft" ||
        code === "ShiftRight" ||
        code === "ArrowUp" ||
        code === "ArrowDown" ||
        code === "ArrowLeft" ||
        code === "ArrowRight"
      ) {
        return;
      }
    }
    const tag = (document.activeElement?.tagName ?? "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
      if (this.selectedIds.size === 0) return;
      e.preventDefault();
      this.clipboardIds = new Set(this.selectedIds);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") {
      if (this.clipboardIds.size === 0) return;
      e.preventDefault();
      const newIds = this.cloneEntities(Array.from(this.clipboardIds));
      if (newIds.length > 0) {
        this.selectedIds = new Set(newIds);
        this.updateSelectionGroup();
      }
      this.triggerChange();
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      // With a selection: nudge objects (camera-relative). Alt = pan camera instead.
      if (this.selectedIds.size > 0 && !e.altKey) {
        const fine = e.shiftKey;
        const step = fine ? NUDGE_STEP_FINE : NUDGE_STEP;
        switch (e.key) {
          case "ArrowUp": this.nudgeSelection(0, 0, step, fine); break;
          case "ArrowDown": this.nudgeSelection(0, 0, -step, fine); break;
          case "ArrowLeft": this.nudgeSelection(-step, 0, 0, fine); break;
          case "ArrowRight": this.nudgeSelection(step, 0, 0, fine); break;
        }
        return;
      }
      const step = e.shiftKey ? ARROW_PAN_STEP_FAST : ARROW_PAN_STEP;
      switch (e.key) {
        case "ArrowUp": this.panCamera(0, step); break;
        case "ArrowDown": this.panCamera(0, -step); break;
        case "ArrowLeft": this.panCamera(-step, 0); break;
        case "ArrowRight": this.panCamera(step, 0); break;
      }
      return;
    }
    if (e.key === "PageUp" || e.key === "PageDown") {
      if (this.selectedIds.size === 0) return;
      e.preventDefault();
      const fine = e.shiftKey;
      const step = fine ? NUDGE_STEP_FINE : NUDGE_STEP;
      this.nudgeSelection(0, e.key === "PageUp" ? step : -step, 0, fine);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g") {
      e.preventDefault();
      if (e.shiftKey) this.ungroupSelectedAssets();
      else this.groupSelectedAssets();
      return;
    }
    if (e.key.toLowerCase() === "g" && this.selectedIds.size > 0 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      this.dropSelectionToGround();
      return;
    }
    if (e.key.toLowerCase() === "x" && this.selectedIds.size > 0 && !e.metaKey && !e.ctrlKey) {
      // Toggle snap while editing (not Cut — we don't use Ctrl-less X for cut).
      e.preventDefault();
      this.setTransformSnap(!this.snapEnabled);
      return;
    }
    if (this.selectedIds.size === 0) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      this.duplicateSelection();
      return;
    }
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    e.preventDefault();
    this.deleteSelected();
  };

  private duplicateSelection(): void {
    const newIds = this.cloneEntities(Array.from(this.selectedIds));
    if (newIds.length > 0) {
      this.selectedIds = new Set(newIds);
      this.updateSelectionGroup();
    }
    this.triggerChange();
  }

  /** Assign a shared groupId to every currently selected asset (≥2), so a
   *  later click on any piece selects/moves the whole set together. */
  groupSelectedAssets(): void {
    const assets = [...this.selectedIds]
      .map((id) => this.assets.get(id))
      .filter((a): a is AssetEntry => !!a);
    if (assets.length < 2) return;
    const groupId = `group_${this.nextId++}`;
    for (const a of assets) a.groupId = groupId;
    // Expand selection to the full new group (in case only a subset was
    // selected that already belonged to other groups).
    this.selectedIds = new Set(assets.map((a) => a.id));
    this.updateSelectionGroup();
    this.emitSelection();
    this.triggerChange();
  }

  /** Clear groupId on selected assets so they select independently again. */
  ungroupSelectedAssets(): void {
    let changed = false;
    for (const id of this.selectedIds) {
      const a = this.assets.get(id);
      if (a?.groupId) {
        a.groupId = undefined;
        changed = true;
      }
    }
    if (!changed) return;
    this.updateSelectionGroup();
    this.emitSelection();
    this.triggerChange();
  }

  private cloneEntities(ids: string[]): string[] {
    const newIds: string[] = [];
    // Remap groupIds so a duplicated house becomes its own independent group
    // instead of joining the original's selection set.
    const groupRemap = new Map<string, string>();
    for (const id of ids) {
      const asset = this.assets.get(id);
      if (asset) {
        const newId = `asset_${this.nextId++}`;
        const newObj = SkeletonUtils.clone(asset.obj);
        // Drop cloned light nodes — syncAssetPointLight recreates a clean one.
        for (const child of [...newObj.children]) {
          if ((child as THREE.PointLight).isPointLight || child.name === "asset-light-marker") {
            newObj.remove(child);
          }
        }
        newObj.userData.editorKind = "asset";
        newObj.userData.editorId = newId;
        this.scene.add(newObj);
        asset.obj.getWorldPosition(newObj.position);
        asset.obj.getWorldQuaternion(newObj.quaternion);
        asset.obj.getWorldScale(newObj.scale);
        newObj.position.x += 4;
        let newGroupId = asset.groupId;
        if (asset.groupId) {
          if (!groupRemap.has(asset.groupId)) groupRemap.set(asset.groupId, `house_${this.nextId++}`);
          newGroupId = groupRemap.get(asset.groupId);
        }
        const entry: AssetEntry = {
          id: newId,
          model: asset.model,
          category: asset.category,
          obj: newObj,
          groupId: newGroupId,
          light: asset.light ? { ...asset.light } : undefined,
          solid: asset.solid,
          solidBox: asset.solidBox ? { ...asset.solidBox } : undefined,
        };
        this.syncAssetPointLight(entry);
        this.assets.set(newId, entry);
        newIds.push(newId);
      } else {
        const volume = this.volumes.get(id);
        if (volume) {
          this.syncVolumeDataFromMesh(volume);
          const newId = `volume_${this.nextId++}`;
          const data: RegionTerrainVolume = {
            ...volume.data,
            id: newId,
            localX: volume.data.localX + 4,
            path: volume.data.path?.map((p) => ({ x: p.x + 4, y: p.y, z: p.z })),
          };
          const mesh = createTerrainVolumeMesh(data);
          this.scene.add(mesh);
          this.volumes.set(newId, { id: newId, data, obj: mesh });
          newIds.push(newId);
        } else {
        const marker = this.markers.get(id);
        if (marker && marker.kind !== "entry") {
          const newId = `marker_${this.nextId++}`;
          const newObj = marker.obj.clone(true);
          newObj.userData.editorKind = "marker";
          newObj.userData.editorId = newId;
          this.scene.add(newObj);
          marker.obj.getWorldPosition(newObj.position);
          newObj.position.x += 4;
          this.markers.set(newId, {
            id: newId,
            kind: marker.kind,
            obj: newObj,
            name: marker.name,
            radius: marker.radius,
            frequencyMin: marker.frequencyMin,
            difficulty: marker.difficulty,
            lootAmount: marker.lootAmount,
            mobTypes: marker.mobTypes ? [...marker.mobTypes] : undefined,
            mobType: marker.mobType,
            bossType: marker.bossType,
            durationSec: marker.durationSec,
            npcData: marker.npcData ? { ...marker.npcData, id: newId } : undefined,
            targetRegionId: marker.targetRegionId,
          });
          newIds.push(newId);
        } else {
          const light = this.lights.get(id);
          if (light) {
            const t = light.obj.position;
            const newId = this.placeLight(t.x + 4, t.y - 1.5, t.z, light.color, light.intensity, light.distance, light.decay);
            newIds.push(newId);
          } else {
            const fog = this.fogVolumes.get(id);
            if (fog) {
              const d = fog.data;
              const newId = this.placeFogVolume(d.localX + 4, d.localY, d.localZ, d.color, d.shape, d.sizeX);
              const entry = this.fogVolumes.get(newId);
              if (entry) {
                entry.data = {
                  ...d,
                  id: newId,
                  localX: d.localX + 4,
                  localY: d.localY,
                  localZ: d.localZ,
                };
                syncFogVolumeMesh(entry.mesh, entry.data);
              }
              newIds.push(newId);
            } else {
              const barrier = this.barrierVolumes.get(id);
              if (barrier) {
                const d = barrier.data;
                const newId = this.placeBarrierVolume(
                  d.localX + 4,
                  d.localY - d.sizeY,
                  d.localZ,
                  d.sizeX,
                  d.sizeY,
                  d.sizeZ,
                  d.yaw,
                );
                const entry = this.barrierVolumes.get(newId);
                if (entry) {
                  entry.data = { ...d, id: newId, localX: d.localX + 4 };
                  syncBarrierMesh(entry.group, entry.data);
                }
                newIds.push(newId);
              } else {
                const cloud = this.clouds.get(id);
                if (cloud) {
                  const d = cloud.data;
                  const newId = this.placeCloud(d.localX + 4, d.localY - 28, d.localZ, d.shape, d.color);
                  const entry = this.clouds.get(newId);
                  if (entry) {
                    entry.data = { ...d, id: newId, localX: d.localX + 4 };
                    syncRegionCloudMesh(entry.group, entry.data);
                  }
                  newIds.push(newId);
                }
              }
            }
          }
        }
        }
      }
    }
    return newIds;
  }

  // ============================ assets / markers ============================

  private async placeAsset(
    model: string,
    category: RegionAssetCategory,
    x: number,
    y: number,
    z: number,
    yaw: number,
    scaleOverride?: number,
    opts?: { groupId?: string; skipSelect?: boolean; light?: RegionAssetLight },
  ): Promise<string> {
    const id = `asset_${this.nextId++}`;
    const gltf = await load(`/assets/models/${ASSET_DIR[category]}/${model}`);
    const obj = SkeletonUtils.clone(gltf.scene);
    const baseName = model.split("/").pop() ?? model;
    const defaultScale = category === "building" ? (baseName.startsWith("building_") || model.includes("Wall_") || model.includes("Corner_") || model.includes("Door_") || model.includes("Roof_") || model.includes("Tower_") || model.includes("House_") ? 3.8 : 1.5) : 1.0;
    const scale = scaleOverride ?? defaultScale;
    obj.scale.setScalar(scale);
    obj.position.set(x, y, z);
    obj.rotation.y = yaw;
    obj.userData.editorKind = "asset";
    obj.userData.editorId = id;
    this.scene.add(obj);
    const light =
      opts?.light ??
      (isRegionAssetLightModel(model) ? { enabled: true, ...REGION_ASSET_LIGHT_DEFAULTS[model]! } : undefined);
    const entry: AssetEntry = { id, model, category, obj, groupId: opts?.groupId, light };
    this.syncAssetPointLight(entry);
    // Structural pieces (walls/doors/windows/roofs/towers/houses) and rocks
    // block movement by default, measured to their exact mesh shape --
    // matches how regionAssetColliders() treats them (hard block unless the
    // model name marks it a walkable bridge/dock/walkway/platform span).
    if (isRockLikeAssetModel(model) || category === "building") this.applyMeasuredSolid(entry);
    this.assets.set(id, entry);
    if (!opts?.skipSelect) {
      this.select("asset", id, false);
      this.triggerChange();
    }
    return id;
  }

  /** Attach / update / remove the PointLight child for an asset entry. */
  private syncAssetPointLight(entry: AssetEntry): void {
    const resolved = resolveRegionAssetLight({ model: entry.model, light: entry.light });
    if (!resolved) {
      if (entry.pointLight) {
        entry.obj.remove(entry.pointLight);
        entry.pointLight.dispose();
        entry.pointLight = undefined;
      }
      if (entry.lightMarker) {
        entry.obj.remove(entry.lightMarker);
        entry.lightMarker.material.dispose();
        entry.lightMarker = undefined;
      }
      return;
    }
    if (!entry.pointLight) {
      entry.pointLight = new THREE.PointLight(resolved.color, resolved.intensity, resolved.distance, resolved.decay);
      entry.pointLight.name = "asset-point-light";
      entry.obj.add(entry.pointLight);
    }
    if (!entry.lightMarker) {
      entry.lightMarker = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: getGlowTexture(),
          color: new THREE.Color(resolved.color),
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      entry.lightMarker.name = "asset-light-marker";
      entry.lightMarker.scale.setScalar(0.55);
      entry.obj.add(entry.lightMarker);
    }
    entry.pointLight.color.set(resolved.color);
    entry.pointLight.intensity = resolved.intensity;
    entry.pointLight.distance = resolved.distance;
    entry.pointLight.decay = resolved.decay;
    (entry.lightMarker.material as THREE.SpriteMaterial).color.set(resolved.color);
    // Counter asset scale so offsets stay in world meters.
    const sx = entry.obj.scale.x || 1;
    const sy = entry.obj.scale.y || 1;
    const sz = entry.obj.scale.z || 1;
    const lx = resolved.offsetX / sx;
    const ly = resolved.offsetY / sy;
    const lz = resolved.offsetZ / sz;
    entry.pointLight.position.set(lx, ly, lz);
    entry.lightMarker.position.set(lx, ly, lz);
  }

  /** Places one procedural house as a single selectable Group (not N assets). */
  private async placeHouseAt(x: number, y: number, z: number, yaw = 0): Promise<string> {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const type = resolveHouseType(this.armedHouseType, seed);
    const id = `house_${this.nextId++}`;
    const data: RegionHouse = { id, type, seed, localX: x, localY: y, localZ: z, yaw, scale: 1 };
    const group = await this.buildHouseGroup(data);
    this.scene.add(group);
    this.houses.set(id, { id, data, group });
    this.rebuildHouseColliders();
    this.select("house", id, false);
    this.triggerChange();
    return id;
  }

  /** Places a procedural castle as grouped building assets (walls + towers). */
  private async placeCastleAt(x: number, y: number, z: number): Promise<string[]> {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const style = resolveCastleStyle(this.armedCastleStyle, seed);
    const groupId = `castle_${this.nextId++}`;
    const pieces = generateCastleAssets(x, z, y, {
      seed,
      style,
      size: this.armedCastleSize,
      height: this.armedCastleHeight,
      groupId,
    });
    const ids: string[] = [];
    for (const piece of pieces) {
      try {
        const id = await this.placeAsset(
          piece.model,
          piece.category,
          piece.localX,
          piece.localY,
          piece.localZ,
          piece.yaw,
          piece.scale ?? 1,
          { groupId, skipSelect: true },
        );
        ids.push(id);
      } catch (err) {
        console.warn(`[regionEditor] castle piece failed: ${piece.model}`, err);
      }
    }
    if (ids.length > 0) {
      this.selectedIds = new Set(ids);
      this.updateSelectionGroup();
      this.emitSelection();
    }
    this.triggerChange();
    return ids;
  }

  /** Places a procedural fantasy-village building (base + capped body shell +
   *  door/windows/chimney/etc, and a sail or waterwheel for mill types) as
   *  grouped building-category assets, same wiring as placeCastleAt. */
  private async placeFantasticBuildingAt(x: number, y: number, z: number): Promise<string[]> {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const groupId = `fbuilding_${this.nextId++}`;
    const pieces = generateFantasticBuildingAssets(x, z, y, {
      seed,
      type: this.armedFantasticBuildingType,
      groupId,
    });
    const ids: string[] = [];
    for (const piece of pieces) {
      try {
        const id = await this.placeAsset(
          piece.model,
          piece.category,
          piece.localX,
          piece.localY,
          piece.localZ,
          piece.yaw,
          piece.scale ?? 1,
          { groupId, skipSelect: true },
        );
        ids.push(id);
      } catch (err) {
        console.warn(`[regionEditor] fantastic building piece failed: ${piece.model}`, err);
      }
    }
    if (ids.length > 0) {
      this.selectedIds = new Set(ids);
      this.updateSelectionGroup();
      this.emitSelection();
    }
    this.triggerChange();
    return ids;
  }

  private async buildHouseGroup(data: RegionHouse): Promise<THREE.Group> {
    const pieces = generateHouseAssets(0, 0, 0, {
      type: data.type as HouseType,
      seed: data.seed,
      groupId: data.id,
    });
    const group = new THREE.Group();
    group.position.set(data.localX, data.localY, data.localZ);
    group.rotation.y = data.yaw;
    group.scale.setScalar(data.scale ?? 1);
    group.userData.editorKind = "house";
    group.userData.editorId = data.id;
    await Promise.all(
      pieces.map(async (piece) => {
        try {
          const gltf = await load(`/assets/models/${ASSET_DIR[piece.category]}/${piece.model}`);
          const obj = SkeletonUtils.clone(gltf.scene);
          obj.position.set(piece.localX, piece.localY, piece.localZ);
          obj.rotation.y = piece.yaw;
          obj.scale.setScalar(piece.scale ?? 1);
          obj.traverse((o) => {
            if ((o as THREE.Mesh).isMesh) o.castShadow = true;
          });
          group.add(obj);
        } catch (err) {
          console.warn(`[regionEditor] house piece failed: ${piece.model}`, err);
        }
      }),
    );
    return group;
  }

  private rebuildHouseColliders(): void {
    this.houseCollisionAssets = expandHousesToAssets([...this.houses.values()].map((h) => h.data));
  }

  private syncHouseDataFromGroup(h: HouseEntry): void {
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    h.group.getWorldPosition(worldPos);
    h.group.getWorldQuaternion(worldQuat);
    h.group.getWorldScale(worldScale);
    h.data.localX = worldPos.x;
    h.data.localY = worldPos.y;
    h.data.localZ = worldPos.z;
    h.data.yaw = yawFromQuaternion(worldQuat);
    h.data.scale = worldScale.x;
  }

  private buildVillageRing(radius: number, color = MARKER_COLORS.village): THREE.Mesh {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(0.5, radius - 0.4), radius, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    return ring;
  }

  private placeMarkerAt(kind: EditorMarkerKind, x: number, y: number, z: number, skipVillageGen = false): string {
    const geo = kind === "entry" ? new THREE.ConeGeometry(0.8, 1.8, 12) : new THREE.SphereGeometry(0.8, 12, 10);
    const mat = new THREE.MeshBasicMaterial({ color: MARKER_COLORS[kind] });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 0.5, 0);

    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.add(mesh);
    this.scene.add(group);

    if (kind === "entry") {
      group.userData.editorKind = "marker";
      group.userData.editorId = "entry";
      this.entryMarker = { id: "entry", kind, obj: group };
      this.triggerChange();
      return "entry";
    }

    const id = `marker_${this.nextId++}`;
    group.userData.editorKind = "marker";
    group.userData.editorId = id;
    const entry: MarkerEntry = { id, kind, obj: group };
    if (kind === "village") {
      entry.name = `Region Village ${this.nextId}`;
      entry.radius = 24;
      entry.ring = this.buildVillageRing(entry.radius);
      group.add(entry.ring);
      this.markers.set(id, entry);
      if (!skipVillageGen) this.buildVillageAroundMarker(id);
    } else if (kind === "npc") {
      entry.name = `Quest Giver ${this.nextId}`;
      entry.npcData = {
        id,
        name: entry.name,
        model: "Knight",
        localX: x,
        localZ: z,
        yaw: 0,
        title: "<Questgiver>",
        dialogue: "Greetings, adventurer! I need your assistance.",
        quests: [],
        generateProceduralQuests: true,
      };
      this.markers.set(id, entry);
      this.rebuildNPCMarkerVisual(entry);
    } else if (kind === "worldEvent") {
      entry.name = `World Event ${this.nextId}`;
      entry.radius = 40;
      entry.frequencyMin = 15;
      entry.difficulty = 1;
      entry.lootAmount = 1;
      entry.mobTypes = ["wolf", "goblin"];
      entry.bossType = "";
      entry.durationSec = 600;
      entry.ring = this.buildVillageRing(entry.radius, MARKER_COLORS.worldEvent);
      group.add(entry.ring);
      this.markers.set(id, entry);
    } else if (kind === "mobSpawn") {
      entry.difficulty = this.mobSpawnDifficulty;
      entry.mobType = this.mobSpawnType ?? undefined;
      this.markers.set(id, entry);
    } else if (kind === "resourceNode") {
      entry.nodeType = this.resourceNodeType;
      if (entry.nodeType === "tree") {
        const roll = (hashString(id) % 1000) / 1000;
        entry.nodeModel = pickRandomRegionTreeModel(this.meta.biome, roll);
      }
      this.markers.set(id, entry);
      this.rebuildResourceNodeMarkerVisual(entry);
    } else {
      this.markers.set(id, entry);
    }
    this.triggerChange();
    return id;
  }

  /** Swap the placeholder sphere for a real gather-node mesh preview. */
  public rebuildResourceNodeMarkerVisual(entry: MarkerEntry): void {
    if (!entry || entry.kind !== "resourceNode") return;
    for (let i = entry.obj.children.length - 1; i >= 0; i--) {
      entry.obj.remove(entry.obj.children[i]!);
    }
    const type = isPlaceableRegionNodeType(entry.nodeType ?? "") ? entry.nodeType! : "rock";
    entry.nodeType = type;
    const variant = (hashString(entry.id) % 1000) / 1000;
    if (type === "tree" && !entry.nodeModel) {
      entry.nodeModel = pickRandomRegionTreeModel(this.meta.biome, variant);
    }
    if (type !== "tree") entry.nodeModel = undefined;
    const preview = buildGatherNodeMesh(
      type,
      variant,
      regionBiomeToWorldBiome(this.meta.biome),
      entry.nodeModel,
    );
    preview.position.set(0, 0, 0);
    entry.obj.add(preview);
    let label = type;
    try {
      label = nodeTypeDef(type).name;
    } catch {
      /* keep id */
    }
    if (entry.nodeModel) {
      label = `${label} (${entry.nodeModel.replace(/\.(glb|gltf)$/i, "")})`;
    }
    const nameplate = buildNameplate(label, "#66cc44");
    nameplate.position.set(0, 2.4, 0);
    nameplate.scale.set(3.2, 0.9, 1);
    entry.obj.add(nameplate);
  }

  public rebuildNPCMarkerVisual(entry: MarkerEntry): void {
    if (!entry || entry.kind !== "npc") return;

    for (let i = entry.obj.children.length - 1; i >= 0; i--) {
      entry.obj.remove(entry.obj.children[i]!);
    }

    const modelName = entry.npcData?.model ?? "Knight";
    const npcName = entry.npcData?.name ?? entry.name ?? "Quest Giver";
    const npcTitle = entry.npcData?.title ?? "<Questgiver>";

    const markerSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 12, 10),
      new THREE.MeshBasicMaterial({ color: MARKER_COLORS.npc }),
    );
    markerSphere.position.set(0, 0.5, 0);
    entry.obj.add(markerSphere);

    const animModel = new AnimatedModel(PLAYER_ANIMS);
    animModel
      .loadFrom(`/assets/models/${modelName}.glb`)
      .then(() => {
        if (!entry.obj.parent) return;
        markerSphere.visible = false;
        entry.obj.add(animModel.group);
        entry.animModel = animModel;
      })
      .catch(() => {});

    const labelText = npcTitle ? `${npcName}\n${npcTitle}` : npcName;
    const nameplate = buildNameplate(labelText, "#33b5e5");
    nameplate.position.set(0, 2.6, 0);
    nameplate.scale.set(3.4, 0.95, 1);
    entry.obj.add(nameplate);

    if ((entry.npcData?.quests?.length ?? 0) > 0 || entry.npcData?.generateProceduralQuests !== false) {
      const badge = buildNameplate("!", "#ffd700");
      badge.position.set(0, 3.4, 0);
      badge.scale.set(1.4, 1.4, 1);
      entry.obj.add(badge);
    }
  }

  public selectedWaypointIndex: number | null = null;
  private selectedWaypointMesh: THREE.Mesh | null = null;

  public setEscortPathTracing(markerId: string | null, questId: string | null): void {
    if (markerId && questId) {
      this.activeEscortQuest = { markerId, questId };
      this.escortPathTracingActive = true;
      this.selectedWaypointIndex = null;
      this.deselect();
      this.transform.detach();
      this.sculptMode = null;
      this.waterBrushMode = null;
      this.armedModel = null;
      this.armedMarkerKind = null;
      this.armedHouse = false;
      this.clearVolumeStamp();
      this.orbit.enablePan = false;
    } else {
      this.activeEscortQuest = null;
      this.escortPathTracingActive = false;
      this.selectedWaypointIndex = null;
      this.transform.detach();
      this.orbit.enablePan = true;
    }
    this.rebuildEscortPathVisuals();
  }

  public waypointHitAt(e: MouseEvent): { index: number; mesh: THREE.Mesh } | null {
    this.raycaster.setFromCamera(this.ndcFromEvent(e), this.camera);
    const meshes = this.escortPathGroup.children.filter((c) => (c as THREE.Mesh).isMesh && c.userData.waypointIndex !== undefined);
    const hits = this.raycaster.intersectObjects(meshes, false);
    if (hits.length > 0 && hits[0]!.object.userData.waypointIndex !== undefined) {
      return {
        index: hits[0]!.object.userData.waypointIndex as number,
        mesh: hits[0]!.object as THREE.Mesh,
      };
    }
    return null;
  }

  public selectWaypoint(index: number | null): void {
    this.selectedWaypointIndex = index;
    this.transform.detach();
    this.selectedIds.clear();
    this.updateSelectionGroup();
    this.rebuildEscortPathVisuals();
    this.emitSelection();
  }

  public addEscortWaypoint(x: number, z: number): void {
    if (!this.activeEscortQuest) return;
    const m = this.markers.get(this.activeEscortQuest.markerId);
    if (!m || !m.npcData?.quests) return;
    const q = m.npcData.quests.find((q) => q.id === this.activeEscortQuest!.questId);
    if (!q) return;
    if (!q.waypoints) q.waypoints = [];
    const newIdx = q.waypoints.length;
    q.waypoints.push({ x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 });
    this.selectWaypoint(newIdx);
    this.triggerChange();
  }

  public removeEscortWaypoint(index: number): void {
    if (!this.activeEscortQuest) return;
    const m = this.markers.get(this.activeEscortQuest.markerId);
    if (!m || !m.npcData?.quests) return;
    const q = m.npcData.quests.find((q) => q.id === this.activeEscortQuest!.questId);
    if (!q || !q.waypoints) return;
    q.waypoints.splice(index, 1);
    if (this.selectedWaypointIndex === index) {
      this.selectWaypoint(null);
    } else if (this.selectedWaypointIndex !== null && this.selectedWaypointIndex > index) {
      this.selectedWaypointIndex--;
      this.rebuildEscortPathVisuals();
    } else {
      this.rebuildEscortPathVisuals();
    }
    this.triggerChange();
    this.emitSelection();
  }

  public rebuildEscortPathVisuals(): void {
    this.selectedWaypointMesh = null;
    while (this.escortPathGroup.children.length > 0) {
      const child = this.escortPathGroup.children[0]!;
      this.escortPathGroup.remove(child);
    }

    if (!this.activeEscortQuest) return;
    const m = this.markers.get(this.activeEscortQuest.markerId);
    if (!m || !m.npcData?.quests) return;
    const q = m.npcData.quests.find((q) => q.id === this.activeEscortQuest!.questId);
    if (!q || !q.waypoints || q.waypoints.length === 0) return;

    const points: THREE.Vector3[] = [];
    const npcPos = m.obj.position;
    points.push(new THREE.Vector3(npcPos.x, this.heightAt(npcPos.x, npcPos.z) + 0.5, npcPos.z));

    for (let i = 0; i < q.waypoints.length; i++) {
      const wp = q.waypoints[i]!;
      const wy = this.heightAt(wp.x, wp.z) + 0.5;
      const vec = new THREE.Vector3(wp.x, wy, wp.z);
      points.push(vec);

      const isSelected = this.selectedWaypointIndex === i;
      const isLast = i === q.waypoints.length - 1;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(isSelected ? 0.75 : 0.5, 12, 10),
        new THREE.MeshBasicMaterial({
          color: isSelected ? 0xff3366 : isLast ? 0xffd700 : 0x33b5e5,
        }),
      );
      sphere.position.copy(vec);
      sphere.userData.waypointIndex = i;
      this.escortPathGroup.add(sphere);

      if (isSelected) {
        this.selectedWaypointMesh = sphere;
        this.transform.attach(sphere);
      }

      const badge = buildNameplate(isLast ? `🚩 Destination` : `WP #${i + 1}`, isSelected ? "#ff3366" : isLast ? "#ffd700" : "#33b5e5");
      badge.position.set(wp.x, wy + 1.4, wp.z);
      badge.scale.set(2.4, 0.75, 1);
      this.escortPathGroup.add(badge);
    }

    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x33b5e5 });
    const line = new THREE.Line(lineGeo, lineMat);
    this.escortPathGroup.add(line);
  }

  public buildVillageAroundMarker(id: string): void {
    const entry = this.markers.get(id);
    if (!entry || entry.kind !== "village") return;

    const vx = entry.obj.position.x;
    const vz = entry.obj.position.z;
    const radius = entry.radius ?? 24;

    // 1. Level terrain around marker clearing
    const half = ((this.gridSize - 1) * this.pitch) / 2;
    const centerH = this.heightAt(vx, vz);

    for (let gz = 0; gz < this.gridSize; gz++) {
      const wz = gz * this.pitch - half;
      for (let gx = 0; gx < this.gridSize; gx++) {
        const wx = gx * this.pitch - half;
        const d = Math.hypot(wx - vx, wz - vz);
        if (d <= radius) {
          const idx = gz * this.gridSize + gx;
          const falloff = (1 - d / radius) * 0.85;
          this.heights[idx] = this.heights[idx]! * (1 - falloff) + centerH * falloff;
          if (this.waterHeights && this.waterHeights.length > idx) {
            this.waterHeights[idx] = 0;
          }
        }
      }
    }
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
    }
    this.terrainMesh = this.buildTerrainGeometry();
    this.scene.add(this.terrainMesh);
    this.syncWaterMesh();

    // 2. Central landmark plaza (Well / Market) — solid KayKit props, not houses.
    const centerModel = Math.random() > 0.5 ? "building_well.gltf" : "building_market.gltf";
    void this.placeAsset(centerModel, "building", vx, centerH, vz, Math.random() * Math.PI * 2, 2.4);

    // 3. Ring of procedural houses (each one RegionHouse / one Group).
    const clutterModels = [
      "barrel.gltf", "bucket_water.gltf", "crate_A_big.gltf", "crate_A_small.gltf",
      "crate_B_small.gltf", "fence_wood_straight.gltf", "fence_stone_straight.gltf",
    ];
    const villageHouseTypes: HouseType[] = ["cottage", "townhouse", "workshop", "tavern", "storehouse", "villa", "manor"];

    const houseCount = 5 + Math.floor(Math.random() * 4);
    const roadPoints: { x: number; z: number }[] = [{ x: vx, z: vz }];
    const prevArmed = this.armedHouseType;

    for (let b = 0; b < houseCount; b++) {
      const angle = (b / houseCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      const dist = 14 + Math.random() * 10;
      const bx = vx + Math.cos(angle) * dist;
      const bz = vz + Math.sin(angle) * dist;
      const facingYaw = angle + Math.PI + (Math.random() - 0.5) * 0.2;
      const by = this.heightAt(bx, bz);
      this.armedHouseType = villageHouseTypes[Math.floor(Math.random() * villageHouseTypes.length)]!;
      void this.placeHouseAt(bx, by, bz, facingYaw);
      roadPoints.push({ x: bx, z: bz });

      const clutterCount = 1 + Math.floor(Math.random() * 2);
      for (let c = 0; c < clutterCount; c++) {
        const cAngle = facingYaw + (Math.random() - 0.5) * 1.5;
        const cDist = 5 + Math.random() * 3;
        const cx = bx + Math.cos(cAngle) * cDist;
        const cz = bz + Math.sin(cAngle) * cDist;
        const cy = this.heightAt(cx, cz);
        const cModel = clutterModels[Math.floor(Math.random() * clutterModels.length)]!;
        void this.placeAsset(cModel, "building", cx, cy, cz, Math.random() * Math.PI * 2, 1.4 + Math.random() * 0.3);
      }
    }
    this.armedHouseType = prevArmed;

    // 4. Connect road path
    if (roadPoints.length >= 2) {
      this.roads.push({ points: roadPoints, width: 4.5 });
      this.scene.remove(this.terrainMesh);
      this.terrainMesh = this.buildTerrainGeometry();
      this.scene.add(this.terrainMesh);
    }

    this.triggerChange();
  }

  private select(kind: "asset" | "marker" | "light" | "volume" | "fog" | "house" | "barrier" | "cloud", id: string, additive: boolean): void {
    const ids = this.idsForSelection(kind, id);
    if (!additive) this.selectedIds.clear();
    const allSelected = ids.length > 0 && ids.every((i) => this.selectedIds.has(i));
    if (allSelected) {
      for (const i of ids) this.selectedIds.delete(i);
    } else {
      for (const i of ids) this.selectedIds.add(i);
    }
    this.updateSelectionGroup();
  }

  /** Expands a single asset click into its whole house group when the asset
   *  carries a groupId -- so clicking any wall/roof/floor of a generated
   *  house selects (and therefore moves) every piece together. Markers and
   *  lights, and ungrouped hand-placed assets, stay single-id. */
  private idsForSelection(kind: "asset" | "marker" | "light" | "volume" | "fog" | "house" | "barrier" | "cloud", id: string): string[] {
    if (kind === "asset") {
      const asset = this.assets.get(id);
      if (asset?.groupId) {
        return [...this.assets.values()].filter((a) => a.groupId === asset.groupId).map((a) => a.id);
      }
    }
    return [id];
  }

  private deselect(): void {
    this.selectedIds.clear();
    this.updateSelectionGroup();
  }

  private updateSelectionGroup(): void {
    for (const obj of [...this.selectionGroup.children]) this.scene.attach(obj);

    // Clear barrier selection chrome before rebuilding.
    for (const b of this.barrierVolumes.values()) setBarrierSelected(b.group, false);

    if (this.selectedIds.size === 0) {
      this.transform.detach();
      this.barrierHoverHandle = null;
      this.canvas.style.cursor = "";
      this.emitSelection();
      return;
    }

    const center = new THREE.Vector3();
    const objs: THREE.Object3D[] = [];
    for (const id of this.selectedIds) {
      const house = this.houses.get(id);
      if (house) {
        objs.push(house.group);
        center.add(house.group.position);
        continue;
      }
      const fog = this.fogVolumes.get(id);
      if (fog) {
        objs.push(fog.mesh);
        center.add(fog.mesh.position);
        continue;
      }
      const barrier = this.barrierVolumes.get(id);
      if (barrier) {
        objs.push(barrier.group);
        center.add(barrier.group.position);
        continue;
      }
      const cloud = this.clouds.get(id);
      if (cloud) {
        objs.push(cloud.group);
        center.add(cloud.group.position);
        continue;
      }
      const entry =
        this.assets.get(id) ??
        this.volumes.get(id) ??
        this.markers.get(id) ??
        this.lights.get(id) ??
        (id === "entry" ? this.entryMarker : null);
      if (entry) {
        objs.push(entry.obj);
        center.add(entry.obj.position);
      }
    }
    if (objs.length === 0) {
      this.selectedIds.clear();
      this.transform.detach();
      this.emitSelection();
      return;
    }
    center.divideScalar(objs.length);
    if (objs.length === 1) center.copy(objs[0]!.position);

    this.selectionGroup.position.copy(center);
    this.selectionGroup.rotation.set(0, 0, 0);
    this.selectionGroup.scale.set(1, 1, 1);

    for (const [id, helper] of this.selectionHelpers.entries()) {
      if (!this.selectedIds.has(id)) {
        this.scene.remove(helper);
        helper.dispose();
        this.selectionHelpers.delete(id);
      }
    }
    for (const obj of objs) {
      this.selectionGroup.attach(obj);
      const id = obj.userData.editorId as string;
      if (!this.selectionHelpers.has(id)) {
        const isBarrier = this.barrierVolumes.has(id);
        const helper = new THREE.BoxHelper(obj, isBarrier ? 0xffe066 : 0x00ffaa);
        this.scene.add(helper);
        this.selectionHelpers.set(id, helper);
      }
    }
    for (const helper of this.selectionHelpers.values()) helper.update();

    // Barriers: bright outline always; corner/side handles only for single-select.
    const singleBarrier =
      this.selectedIds.size === 1 && this.barrierVolumes.has([...this.selectedIds][0]!);
    for (const id of this.selectedIds) {
      const b = this.barrierVolumes.get(id);
      if (b) setBarrierSelected(b.group, true, singleBarrier);
    }

    // Keep TransformControls for move/rotate; footprint sizing uses handles.
    this.transform.attach(this.selectionGroup);
    if (singleBarrier && this.transform.mode === "scale") {
      this.transform.setMode("translate");
    }
    this.emitSelection();
  }

  /** Detach selection to world, rewrite each object's rotation as yaw-only
   *  (matching what export persists), then re-parent under the gizmo group. */
  private bakeSelectionYaw(): void {
    if (this.selectedIds.size === 0) return;
    const worldQuat = new THREE.Quaternion();
    for (const obj of [...this.selectionGroup.children]) this.scene.attach(obj);
    for (const id of this.selectedIds) {
      const entry =
        this.assets.get(id) ??
        this.volumes.get(id) ??
        this.markers.get(id) ??
        (id === "entry" ? this.entryMarker : null);
      if (!entry) continue;
      entry.obj.getWorldQuaternion(worldQuat);
      entry.obj.rotation.set(0, yawFromQuaternion(worldQuat), 0);
      const v = this.volumes.get(id);
      if (v) this.syncVolumeDataFromMesh(v);
    }
    this.updateSelectionGroup();
  }

  private emitSelection(): void {
    if (this.selectedIds.size === 0) {
      this.onSelectionChange([]);
      return;
    }
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    const worldTransform = (obj: THREE.Object3D) => {
      obj.getWorldPosition(worldPos);
      obj.getWorldQuaternion(worldQuat);
      obj.getWorldScale(worldScale);
      return { x: worldPos.x, y: worldPos.y, z: worldPos.z, yaw: yawFromQuaternion(worldQuat), scale: worldScale.x };
    };

    const selItems: EditorSelection[] = [];
    for (const id of this.selectedIds) {
      const a = this.assets.get(id);
      if (a) {
        const t = worldTransform(a.obj);
        const resolved = resolveRegionAssetLight({ model: a.model, light: a.light });
        const defaults = REGION_ASSET_LIGHT_DEFAULTS[a.model];
        const canLight = !!defaults || a.light !== undefined;
        a.obj.getWorldScale(worldScale);
        selItems.push({
          kind: "asset",
          id,
          model: a.model,
          category: a.category,
          groupId: a.groupId,
          x: t.x,
          y: t.y,
          z: t.z,
          yaw: t.yaw,
          scale: t.scale,
          scaleX: worldScale.x,
          scaleY: worldScale.y,
          scaleZ: worldScale.z,
          solid: !!a.solid,
          ...(a.solidBox
            ? {
                solidBox: { ...a.solidBox },
              }
            : {}),
          ...(canLight
            ? {
                lightEnabled: resolved !== null,
                color: resolved?.color ?? a.light?.color ?? defaults?.color ?? "#ffb060",
                intensity: resolved?.intensity ?? a.light?.intensity ?? defaults?.intensity ?? 6,
                distance: resolved?.distance ?? a.light?.distance ?? defaults?.distance ?? 32,
                decay: resolved?.decay ?? a.light?.decay ?? defaults?.decay ?? 2,
                lightOffsetX: resolved?.offsetX ?? a.light?.offsetX ?? defaults?.offsetX ?? 0,
                lightOffsetY: resolved?.offsetY ?? a.light?.offsetY ?? defaults?.offsetY ?? 2.55,
                lightOffsetZ: resolved?.offsetZ ?? a.light?.offsetZ ?? defaults?.offsetZ ?? 0,
              }
            : {}),
        });
        continue;
      }
      const v = this.volumes.get(id);
      if (v) {
        this.syncVolumeDataFromMesh(v);
        const t = worldTransform(v.obj);
        selItems.push({
          kind: "volume",
          id,
          volumeShape: v.data.shape,
          volumeMaterial: v.data.material,
          x: t.x,
          y: t.y,
          z: t.z,
          yaw: t.yaw,
          scale: t.scale,
        });
        continue;
      }
      const m = id === "entry" ? this.entryMarker : this.markers.get(id);
      if (m) {
        const t = worldTransform(m.obj);
        selItems.push({
          kind: "marker",
          id,
          markerKind: m.kind,
          x: t.x,
          y: t.y,
          z: t.z,
          yaw: t.yaw,
          scale: t.scale,
          name: m.name,
          radius: m.radius,
          targetRegionId: m.targetRegionId,
          targetLocalX: m.targetLocalX,
          targetLocalZ: m.targetLocalZ,
          npcData: m.npcData ? { ...m.npcData } : undefined,
          frequencyMin: m.frequencyMin,
          difficulty: m.difficulty,
          lootAmount: m.lootAmount,
          mobTypes: m.mobTypes ? [...m.mobTypes] : undefined,
          mobType: m.mobType,
          nodeType: m.nodeType,
          nodeModel: m.nodeModel,
          bossType: m.bossType,
          durationSec: m.durationSec,
        });
        continue;
      }
      const l = this.lights.get(id);
      if (l) {
        const t = worldTransform(l.obj);
        selItems.push({ kind: "light", id, color: l.color, intensity: l.intensity, distance: l.distance, decay: l.decay, x: t.x, y: t.y, z: t.z, yaw: 0, scale: 1 });
        continue;
      }
      const f = this.fogVolumes.get(id);
      if (f) {
        const t = worldTransform(f.mesh);
        selItems.push({
          kind: "fog",
          id,
          color: f.data.color,
          fogShape: f.data.shape,
          fogDensity: f.data.density,
          fogOpacity: f.data.opacity,
          fogFeather: f.data.feather,
          sizeX: f.data.sizeX,
          sizeY: f.data.sizeY,
          sizeZ: f.data.sizeZ,
          x: t.x,
          y: t.y,
          z: t.z,
          yaw: 0,
          scale: 1,
        });
        continue;
      }
      const b = this.barrierVolumes.get(id);
      if (b) {
        this.syncBarrierDataFromGroup(b);
        const t = worldTransform(b.group);
        selItems.push({
          kind: "barrier",
          id,
          sizeX: b.data.sizeX,
          sizeY: b.data.sizeY,
          sizeZ: b.data.sizeZ,
          x: t.x,
          y: t.y,
          z: t.z,
          yaw: t.yaw,
          scale: 1,
        });
        continue;
      }
      const c = this.clouds.get(id);
      if (c) {
        this.syncCloudDataFromGroup(c);
        const t = worldTransform(c.group);
        selItems.push({
          kind: "cloud",
          id,
          color: c.data.color,
          cloudShape: c.data.shape,
          cloudOpacity: c.data.opacity,
          scaleX: c.data.scaleX,
          scaleY: c.data.scaleY,
          scaleZ: c.data.scaleZ,
          driftSpeed: c.data.driftSpeed,
          bobAmp: c.data.bobAmp,
          x: t.x,
          y: t.y,
          z: t.z,
          yaw: t.yaw,
          scale: t.scale,
        });
        continue;
      }
      const h = this.houses.get(id);
      if (h) {
        this.syncHouseDataFromGroup(h);
        const t = worldTransform(h.group);
        selItems.push({
          kind: "house",
          id,
          houseType: h.data.type,
          x: t.x,
          y: t.y,
          z: t.z,
          yaw: t.yaw,
          scale: t.scale,
        });
      }
    }
    this.onSelectionChange(selItems);
  }

  private onTransformChange = (): void => {
    if (this.selectedIds.size === 0) return;
    this.selectionGroup.updateMatrixWorld(true);
    for (const helper of this.selectionHelpers.values()) helper.update();
    for (const id of this.selectedIds) {
      const a = this.assets.get(id);
      if (a?.pointLight) this.syncAssetPointLight(a);
      const v = this.volumes.get(id);
      if (v) this.syncVolumeDataFromMesh(v);
      const f = this.fogVolumes.get(id);
      if (f) {
        // World-space only — mesh is under selectionGroup while dragging.
        const worldPos = new THREE.Vector3();
        const worldScale = new THREE.Vector3();
        f.mesh.getWorldPosition(worldPos);
        f.mesh.getWorldScale(worldScale);
        f.data.localX = worldPos.x;
        f.data.localY = worldPos.y;
        f.data.localZ = worldPos.z;
        f.data.sizeX = Math.max(0.5, worldScale.x);
        f.data.sizeY = Math.max(0.5, worldScale.y);
        f.data.sizeZ = Math.max(0.5, worldScale.z);
      }
      const b = this.barrierVolumes.get(id);
      if (b) {
        // Do not syncBarrierMesh here: writing world coords into local
        // position while parented under selectionGroup jumps the mesh.
        this.syncBarrierDataFromGroup(b);
      }
      const c = this.clouds.get(id);
      if (c) {
        this.syncCloudDataFromGroup(c);
      }
      const h = this.houses.get(id);
      if (h) {
        this.syncHouseDataFromGroup(h);
        this.rebuildHouseColliders();
      }
    }
    this.triggerChange();
    this.emitSelection();
  };

  updateSelectedProps(
    patch: Partial<{
      x: number;
      y: number;
      z: number;
      yaw: number;
      scale: number;
      name: string;
      radius: number;
      targetRegionId: string;
      targetLocalX: number;
      targetLocalZ: number;
      npcData: Partial<RegionNPC>;
      color: string;
      intensity: number;
      distance: number;
      decay: number;
      fogShape: RegionFogShape;
      fogDensity: number;
      fogOpacity: number;
      fogFeather: number;
      cloudShape: RegionCloudShape;
      cloudOpacity: number;
      driftSpeed: number;
      bobAmp: number;
      scaleX: number;
      scaleY: number;
      scaleZ: number;
      sizeX: number;
      sizeY: number;
      sizeZ: number;
      frequencyMin: number;
      difficulty: number;
      lootAmount: number;
      mobTypes: string[];
      mobType: string;
      nodeType: string;
      nodeModel: string;
      bossType: string;
      durationSec: number;
      lightEnabled: boolean;
      lightOffsetX: number;
      lightOffsetY: number;
      lightOffsetZ: number;
      solid: boolean;
    }>,
  ): void {
    if (this.selectedIds.size === 0) return;
    for (const obj of [...this.selectionGroup.children]) this.scene.attach(obj);
    for (const id of this.selectedIds) {
      const a = this.assets.get(id);
      if (a) {
        if (patch.x !== undefined) a.obj.position.x = patch.x;
        if (patch.y !== undefined) a.obj.position.y = patch.y;
        if (patch.z !== undefined) a.obj.position.z = patch.z;
        if (patch.yaw !== undefined) a.obj.rotation.y = patch.yaw;
        if (patch.scale !== undefined) {
          a.obj.scale.setScalar(patch.scale);
          this.syncAssetPointLight(a);
          if (a.solid) {
            a.solidBox = measureObjectSolidBox(a.obj) ?? a.solidBox;
          }
        }
        if (patch.scaleX !== undefined || patch.scaleY !== undefined || patch.scaleZ !== undefined) {
          if (patch.scaleX !== undefined) a.obj.scale.x = Math.max(0.05, patch.scaleX);
          if (patch.scaleY !== undefined) a.obj.scale.y = Math.max(0.05, patch.scaleY);
          if (patch.scaleZ !== undefined) a.obj.scale.z = Math.max(0.05, patch.scaleZ);
          this.syncAssetPointLight(a);
          if (a.solid) {
            a.solidBox = measureObjectSolidBox(a.obj) ?? a.solidBox;
          }
        }
        if (patch.solid !== undefined) {
          if (patch.solid) this.applyMeasuredSolid(a);
          else {
            a.solid = undefined;
            a.solidBox = undefined;
          }
        }
        const lightPatch =
          patch.lightEnabled !== undefined ||
          patch.color !== undefined ||
          patch.intensity !== undefined ||
          patch.distance !== undefined ||
          patch.decay !== undefined ||
          patch.lightOffsetX !== undefined ||
          patch.lightOffsetY !== undefined ||
          patch.lightOffsetZ !== undefined;
        if (lightPatch) {
          const defaults = REGION_ASSET_LIGHT_DEFAULTS[a.model];
          const prev = a.light ?? (defaults ? { enabled: true, ...defaults } : { enabled: true });
          a.light = {
            ...prev,
            ...(patch.lightEnabled !== undefined ? { enabled: patch.lightEnabled } : {}),
            ...(patch.color !== undefined ? { color: patch.color } : {}),
            ...(patch.intensity !== undefined ? { intensity: patch.intensity } : {}),
            ...(patch.distance !== undefined ? { distance: patch.distance } : {}),
            ...(patch.decay !== undefined ? { decay: patch.decay } : {}),
            ...(patch.lightOffsetX !== undefined ? { offsetX: patch.lightOffsetX } : {}),
            ...(patch.lightOffsetY !== undefined ? { offsetY: patch.lightOffsetY } : {}),
            ...(patch.lightOffsetZ !== undefined ? { offsetZ: patch.lightOffsetZ } : {}),
          };
          this.syncAssetPointLight(a);
        }
        continue;
      }
      const v = this.volumes.get(id);
      if (v) {
        if (patch.x !== undefined) v.obj.position.x = patch.x;
        if (patch.y !== undefined) v.obj.position.y = patch.y;
        if (patch.z !== undefined) v.obj.position.z = patch.z;
        if (patch.yaw !== undefined) v.obj.rotation.y = patch.yaw;
        if (patch.scale !== undefined) {
          const sx = v.obj.scale.x || 1;
          const ratio = patch.scale / sx;
          v.obj.scale.multiplyScalar(ratio);
        }
        this.syncVolumeDataFromMesh(v);
        continue;
      }
      const m = id === "entry" ? this.entryMarker : this.markers.get(id);
      if (m) {
        if (patch.x !== undefined) m.obj.position.x = patch.x;
        if (patch.y !== undefined) m.obj.position.y = patch.y;
        if (patch.z !== undefined) m.obj.position.z = patch.z;
        if (patch.name !== undefined) m.name = patch.name;
        if (patch.targetRegionId !== undefined) m.targetRegionId = patch.targetRegionId;
        if (patch.targetLocalX !== undefined) m.targetLocalX = patch.targetLocalX;
        if (patch.targetLocalZ !== undefined) m.targetLocalZ = patch.targetLocalZ;
        if (patch.npcData !== undefined && m.kind === "npc") {
          m.npcData = { ...m.npcData, ...patch.npcData } as RegionNPC;
          if (patch.name !== undefined) m.npcData.name = patch.name;
          this.rebuildNPCMarkerVisual(m);
        }
        if (patch.radius !== undefined && (m.kind === "village" || m.kind === "worldEvent")) {
          m.radius = patch.radius;
          if (m.ring) {
            m.obj.remove(m.ring);
            m.ring.geometry.dispose();
          }
          m.ring = this.buildVillageRing(
            patch.radius,
            m.kind === "worldEvent" ? MARKER_COLORS.worldEvent : MARKER_COLORS.village,
          );
          m.obj.add(m.ring);
        }
        if (m.kind === "worldEvent") {
          if (patch.frequencyMin !== undefined) m.frequencyMin = patch.frequencyMin;
          if (patch.difficulty !== undefined) m.difficulty = patch.difficulty;
          if (patch.lootAmount !== undefined) m.lootAmount = patch.lootAmount;
          if (patch.mobTypes !== undefined) m.mobTypes = patch.mobTypes;
          if (patch.bossType !== undefined) m.bossType = patch.bossType;
          if (patch.durationSec !== undefined) m.durationSec = patch.durationSec;
        }
        if (m.kind === "mobSpawn") {
          if (patch.difficulty !== undefined) m.difficulty = patch.difficulty;
          if (patch.mobType !== undefined) {
            m.mobType = patch.mobType || undefined;
          }
        }
        if (m.kind === "resourceNode") {
          let dirty = false;
          if (patch.nodeType !== undefined && isPlaceableRegionNodeType(patch.nodeType)) {
            m.nodeType = patch.nodeType;
            dirty = true;
          }
          if (patch.nodeModel !== undefined) {
            m.nodeModel = patch.nodeModel || undefined;
            dirty = true;
          }
          if (dirty) this.rebuildResourceNodeMarkerVisual(m);
        }
        continue;
      }
      const l = this.lights.get(id);
      if (l) {
        if (patch.x !== undefined) l.obj.position.x = patch.x;
        if (patch.y !== undefined) l.obj.position.y = patch.y;
        if (patch.z !== undefined) l.obj.position.z = patch.z;
        if (patch.color !== undefined) {
          l.color = patch.color;
          l.light.color.set(patch.color);
          (l.bulb.material as THREE.SpriteMaterial).color.set(patch.color);
        }
        if (patch.intensity !== undefined) {
          l.intensity = patch.intensity;
          l.light.intensity = patch.intensity;
        }
        if (patch.distance !== undefined) {
          l.distance = patch.distance;
          l.light.distance = patch.distance;
        }
        if (patch.decay !== undefined) {
          l.decay = patch.decay;
          l.light.decay = patch.decay;
        }
        continue;
      }
      const f = this.fogVolumes.get(id);
      if (f) {
        if (patch.x !== undefined) { f.mesh.position.x = patch.x; f.data.localX = patch.x; }
        if (patch.y !== undefined) { f.mesh.position.y = patch.y; f.data.localY = patch.y; }
        if (patch.z !== undefined) { f.mesh.position.z = patch.z; f.data.localZ = patch.z; }
        if (patch.color !== undefined) f.data.color = patch.color;
        if (patch.fogShape !== undefined) f.data.shape = patch.fogShape;
        if (patch.fogDensity !== undefined) f.data.density = patch.fogDensity;
        if (patch.fogOpacity !== undefined) f.data.opacity = patch.fogOpacity;
        if (patch.fogFeather !== undefined) f.data.feather = patch.fogFeather;
        if (patch.sizeX !== undefined) f.data.sizeX = patch.sizeX;
        if (patch.sizeY !== undefined) f.data.sizeY = patch.sizeY;
        if (patch.sizeZ !== undefined) f.data.sizeZ = patch.sizeZ;
        syncFogVolumeMesh(f.mesh, f.data);
        continue;
      }
      const b = this.barrierVolumes.get(id);
      if (b) {
        if (patch.x !== undefined) { b.group.position.x = patch.x; b.data.localX = patch.x; }
        if (patch.y !== undefined) { b.group.position.y = patch.y; b.data.localY = patch.y; }
        if (patch.z !== undefined) { b.group.position.z = patch.z; b.data.localZ = patch.z; }
        if (patch.yaw !== undefined) { b.group.rotation.y = patch.yaw; b.data.yaw = patch.yaw; }
        if (patch.sizeX !== undefined) { b.data.sizeX = patch.sizeX; b.group.scale.x = patch.sizeX; }
        if (patch.sizeY !== undefined) { b.data.sizeY = patch.sizeY; b.group.scale.y = patch.sizeY; }
        if (patch.sizeZ !== undefined) { b.data.sizeZ = patch.sizeZ; b.group.scale.z = patch.sizeZ; }
        syncBarrierMesh(b.group, b.data);
        continue;
      }
      const c = this.clouds.get(id);
      if (c) {
        if (patch.x !== undefined) { c.group.position.x = patch.x; c.data.localX = patch.x; }
        if (patch.y !== undefined) { c.group.position.y = patch.y; c.data.localY = patch.y; }
        if (patch.z !== undefined) { c.group.position.z = patch.z; c.data.localZ = patch.z; }
        if (patch.yaw !== undefined) { c.group.rotation.y = patch.yaw; c.data.yaw = patch.yaw; }
        if (patch.color !== undefined) c.data.color = patch.color;
        const shapeChanged = patch.cloudShape !== undefined && patch.cloudShape !== c.data.shape;
        if (patch.cloudShape !== undefined) c.data.shape = patch.cloudShape;
        if (patch.cloudOpacity !== undefined) c.data.opacity = patch.cloudOpacity;
        if (patch.driftSpeed !== undefined) c.data.driftSpeed = patch.driftSpeed;
        if (patch.bobAmp !== undefined) c.data.bobAmp = patch.bobAmp;
        if (patch.scaleX !== undefined) { c.data.scaleX = patch.scaleX; c.group.scale.x = patch.scaleX; }
        if (patch.scaleY !== undefined) { c.data.scaleY = patch.scaleY; c.group.scale.y = patch.scaleY; }
        if (patch.scaleZ !== undefined) { c.data.scaleZ = patch.scaleZ; c.group.scale.z = patch.scaleZ; }
        if (patch.scale !== undefined) {
          c.group.scale.setScalar(patch.scale);
          c.data.scaleX = patch.scale;
          c.data.scaleY = patch.scale;
          c.data.scaleZ = patch.scale;
        }
        if (shapeChanged) {
          // Rebuild puff geometry for the new silhouette.
          const parent = c.group.parent;
          const selected = this.selectedIds.has(id);
          this.scene.remove(c.group);
          this.disposeObject(c.group);
          const fresh = createRegionCloudMesh(c.data);
          fresh.userData.editorKind = "cloud";
          fresh.userData.editorId = id;
          parent?.add(fresh) ?? this.scene.add(fresh);
          c.group = fresh;
          if (selected) this.updateSelectionGroup();
        } else {
          syncRegionCloudMesh(c.group, c.data);
        }
        continue;
      }
      const h = this.houses.get(id);
      if (h) {
        if (patch.x !== undefined) h.group.position.x = patch.x;
        if (patch.y !== undefined) h.group.position.y = patch.y;
        if (patch.z !== undefined) h.group.position.z = patch.z;
        if (patch.yaw !== undefined) h.group.rotation.y = patch.yaw;
        if (patch.scale !== undefined) h.group.scale.setScalar(patch.scale);
        this.syncHouseDataFromGroup(h);
        this.rebuildHouseColliders();
      }
    }
    this.updateSelectionGroup();
    this.emitSelection();
    this.triggerChange();
  }

  deleteSelected(): void {
    if (this.selectedWaypointIndex !== null && this.activeEscortQuest) {
      this.removeEscortWaypoint(this.selectedWaypointIndex);
      return;
    }
    if (this.selectedIds.size === 0) return;
    for (const obj of [...this.selectionGroup.children]) this.scene.attach(obj);
    this.transform.detach();
    for (const id of this.selectedIds) {
      const helper = this.selectionHelpers.get(id);
      if (helper) {
        this.scene.remove(helper);
        helper.dispose();
        this.selectionHelpers.delete(id);
      }
      const a = this.assets.get(id);
      if (a) {
        this.scene.remove(a.obj);
        this.disposeObject(a.obj);
        this.assets.delete(id);
        continue;
      }
      if (this.volumes.has(id)) {
        this.removeVolume(id);
        continue;
      }
      const m = id === "entry" ? this.entryMarker : this.markers.get(id);
      if (m) {
        this.scene.remove(m.obj);
        this.disposeObject(m.obj);
        if (id === "entry") this.entryMarker = null;
        else this.markers.delete(id);
        continue;
      }
      const l = this.lights.get(id);
      if (l) {
        this.scene.remove(l.obj);
        l.bulb.material.dispose();
        this.lights.delete(id);
        continue;
      }
      const f = this.fogVolumes.get(id);
      if (f) {
        this.scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        (f.mesh.material as THREE.Material).dispose();
        this.fogVolumes.delete(id);
        continue;
      }
      const b = this.barrierVolumes.get(id);
      if (b) {
        this.scene.remove(b.group);
        b.group.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.geometry?.dispose();
            const mat = mesh.material as THREE.Material;
            if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
            else mat?.dispose?.();
          }
        });
        this.barrierVolumes.delete(id);
        continue;
      }
      const c = this.clouds.get(id);
      if (c) {
        this.scene.remove(c.group);
        c.group.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.geometry?.dispose();
            (mesh.material as THREE.Material)?.dispose?.();
          }
        });
        this.clouds.delete(id);
        continue;
      }
      const h = this.houses.get(id);
      if (h) {
        this.scene.remove(h.group);
        this.disposeObject(h.group);
        this.houses.delete(id);
      }
    }
    this.rebuildHouseColliders();
    this.selectedIds.clear();
    this.triggerChange();
    this.emitSelection();
  }

  private disposeObject(obj: THREE.Object3D): void {
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh;
      // Terrain volumes share cached BufferGeometries -- never dispose those.
      if (mesh.isMesh && !mesh.userData.sharedGeometry) mesh.geometry?.dispose();
    });
  }

  /** Removes a stamped volume. Disposes unique stroke geometry; shared
   *  primitive geometries are left alone. */
  private removeVolume(id: string): void {
    const v = this.volumes.get(id);
    if (!v) return;
    this.scene.remove(v.obj);
    if (!v.obj.userData.sharedGeometry) {
      v.obj.geometry.dispose();
    }
    this.volumes.delete(id);
  }

  /** Writes the live mesh world transform back into the volume record so
   *  export / playtest collision stay accurate after gizmo moves. */
  private syncVolumeDataFromMesh(v: VolumeEntry): void {
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    v.obj.getWorldPosition(worldPos);
    v.obj.getWorldQuaternion(worldQuat);
    v.obj.getWorldScale(worldScale);

    if (isTerrainStroke(v.data) && v.data.path) {
      const dx = worldPos.x - v.data.localX;
      const dy = worldPos.y - v.data.localY;
      const dz = worldPos.z - v.data.localZ;
      if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6 || Math.abs(dz) > 1e-6) {
        for (const p of v.data.path) {
          p.x += dx;
          p.y += dy;
          p.z += dz;
        }
        v.data.localX = worldPos.x;
        v.data.localY = worldPos.y;
        v.data.localZ = worldPos.z;
        // Keep mesh at centroid with local geometry (no accumulated parent offset).
        if (v.obj.parent === this.scene) {
          v.obj.position.set(v.data.localX, v.data.localY, v.data.localZ);
          v.obj.rotation.set(0, 0, 0);
          v.obj.scale.set(1, 1, 1);
          rebuildTerrainStrokeMesh(v.obj, v.data);
        }
      }
      return;
    }

    v.data.localX = worldPos.x;
    v.data.localY = worldPos.y;
    v.data.localZ = worldPos.z;
    v.data.yaw = yawFromQuaternion(worldQuat);
    v.data.scaleX = worldScale.x;
    v.data.scaleY = worldScale.y;
    v.data.scaleZ = worldScale.z;
  }

  // ============================ load / export ============================

  clear(): void {
    this.clearNeighborReferences();
    this.transform.detach();
    for (const helper of this.selectionHelpers.values()) {
      this.scene.remove(helper);
      helper.dispose();
    }
    this.selectionHelpers.clear();
    for (const obj of [...this.selectionGroup.children]) this.scene.attach(obj);
    for (const a of this.assets.values()) {
      this.scene.remove(a.obj);
      this.disposeObject(a.obj);
    }
    for (const id of [...this.volumes.keys()]) this.removeVolume(id);
    for (const m of this.markers.values()) {
      this.scene.remove(m.obj);
      this.disposeObject(m.obj);
    }
    for (const f of this.fogVolumes.values()) {
      this.scene.remove(f.mesh);
      f.mesh.geometry.dispose();
      (f.mesh.material as THREE.Material).dispose();
    }
    this.fogVolumes.clear();
    for (const b of this.barrierVolumes.values()) {
      this.scene.remove(b.group);
      b.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const mat = mesh.material as THREE.Material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose?.();
        }
      });
    }
    this.barrierVolumes.clear();
    for (const c of this.clouds.values()) {
      this.scene.remove(c.group);
      c.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          (mesh.material as THREE.Material)?.dispose?.();
        }
      });
    }
    this.clouds.clear();
    if (this.horizonGroup) {
      this.scene.remove(this.horizonGroup);
      this.horizonGroup.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          (mesh.material as THREE.Material)?.dispose?.();
        }
      });
      this.horizonGroup = null;
    }
    for (const h of this.houses.values()) {
      this.scene.remove(h.group);
      this.disposeObject(h.group);
    }
    this.houses.clear();
    this.houseCollisionAssets = [];
    for (const l of this.lights.values()) {
      this.scene.remove(l.obj);
      l.bulb.material.dispose();
    }
    if (this.entryMarker) {
      this.scene.remove(this.entryMarker.obj);
      this.disposeObject(this.entryMarker.obj);
    }
    this.assets.clear();
    this.volumes.clear();
    this.markers.clear();
    this.lights.clear();
    this.entryMarker = null;
    this.selectedIds.clear();
    this.armedModel = null;
    this.armedMarkerKind = null;
    this.armedHouse = false;
    this.clearVolumeStamp();
    this.armedLightColor = null;
    this.armedFogColor = null;
    this.armedBarrier = false;
    this.armedCloudShape = null;
    this.texturePaintMode = null;
    this.waterBrushMode = null;
    this.customTextures = new Array(this.gridSize * this.gridSize).fill(0);
    this.waterHeights = new Float32Array(0);
    this.waterActiveBounds = null;
    this.waterFlowScratch = null;
    if (this.waterMeshField) {
      this.scene.remove(this.waterMeshField.mesh);
      this.waterMeshField.mesh.geometry.dispose();
      this.waterMeshField = null;
    }
    this.roadPaintArmed = false;
    this.paintingRoad = null;
    this.roads = [];
    if (this.grassField) {
      this.grassField.dispose();
      this.grassField = null;
    }
    this.grassPreviewDirty = false;
    this.lastGrassStrokePos = null;
    this.grassStrokeDirty = false;
    this.grassPatches = [];
    this.grassExclusions = [];
    this.grassColor = { bottom: "#4f7c13", top: "#79a01c" };
    this.grassSettings = { ...DEFAULT_QUICK_GRASS_SETTINGS };
    this.wind = { direction: 0, strength: 1 };
    this.grassSway = 1;
    this.nextId = 1;
    this.onSelectionChange([]);
  }

  async loadBlueprint(bp: RegionBlueprint): Promise<void> {
    this.isRestoring = true;
    try {
      this.clear();
      this.meta = {
        id: bp.id,
        name: bp.name,
        biome: bp.biome,
        portalWorldX: bp.portalWorldX,
        portalWorldZ: bp.portalWorldZ,
        worldOriginX: bp.worldOriginX,
        worldOriginZ: bp.worldOriginZ,
        isStartingRegion: bp.isStartingRegion ?? false,
        musicTrack: bp.musicTrack ?? null,
      };
      this.gridSize = bp.gridSize;
      this.pitch = bp.pitch;
      this.heights = [...bp.heights];
      const totalCells = this.gridSize * this.gridSize;
      this.customTextures = bp.customTextures && bp.customTextures.length === totalCells ? [...bp.customTextures] : new Array(totalCells).fill(0);
      if (bp.waterHeights && bp.waterHeights.length === totalCells) {
        this.waterHeights = new Float32Array(bp.waterHeights);
      } else {
        this.waterHeights = new Float32Array(totalCells);
      }
      this.waterFlowScratch = null;
      this.recomputeWaterBoundsFull();
      this.syncWaterMesh();
      this.roads = (bp.roads ?? []).map((r) => ({ points: r.points.map((p) => ({ ...p })), width: r.width }));
      this.grassPatches = (bp.grassPatches ?? []).map((p) => ({ ...p }));
      this.grassExclusions = (bp.grassExclusions ?? []).map((ex) => ({ ...ex }));
      this.grassColor = bp.grassColor ? { ...bp.grassColor } : { bottom: "#4f7c13", top: "#79a01c" };
      this.wind = bp.wind ? { ...bp.wind } : { direction: 0, strength: 1 };
      this.grassSway = typeof bp.grassSway === "number" ? Math.max(0, bp.grassSway) : 1;
      this.grassSettings = mergeQuickGrassSettings(bp.grassSettings, {
        grassColor: this.grassColor,
        grassSway: this.grassSway,
      });
      this.grassColor = {
        bottom: this.grassSettings.baseColour,
        top: this.grassSettings.tipColour,
      };
      this.rebuildGrassPreview(true);
      this.scene.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      this.terrainMesh = this.buildTerrainGeometry();
      this.scene.add(this.terrainMesh);
      this.applyColorGrading(bp.colorGrading);

      for (const asset of bp.assets) {
        const gltf = await load(`/assets/models/${ASSET_DIR[asset.category]}/${asset.model}`);
        const obj = SkeletonUtils.clone(gltf.scene);
        obj.position.set(asset.localX, asset.localY, asset.localZ);
        obj.rotation.y = asset.yaw;
        const axes = regionAssetScale(asset);
        const baseName = asset.model.split("/").pop() ?? asset.model;
        // Legacy buildings saved at scale 1 before the editor defaulted them to 3.8.
        const needsBuildingDefault =
          axes.x === 1 &&
          axes.y === 1 &&
          axes.z === 1 &&
          asset.scaleX === undefined &&
          asset.scaleY === undefined &&
          asset.scaleZ === undefined &&
          asset.category === "building" &&
          (baseName.startsWith("building_") ||
            asset.model.includes("Wall_") ||
            asset.model.includes("House_") ||
            asset.model.includes("Tower_"));
        if (needsBuildingDefault) obj.scale.setScalar(3.8);
        else obj.scale.set(axes.x, axes.y, axes.z);
        const id = asset.id ?? `asset_${this.nextId++}`;
        obj.userData.editorKind = "asset";
        obj.userData.editorId = id;
        this.scene.add(obj);
        const light =
          asset.light ??
          (isRegionAssetLightModel(asset.model)
            ? { enabled: true, ...REGION_ASSET_LIGHT_DEFAULTS[asset.model]! }
            : undefined);
        const entry: AssetEntry = {
          id,
          model: asset.model,
          category: asset.category,
          obj,
          groupId: asset.groupId,
          light,
          solid: asset.solid || undefined,
          solidBox: asset.solidBox ? { ...asset.solidBox } : undefined,
        };
        this.syncAssetPointLight(entry);
        if (entry.solid && !entry.solidBox) this.applyMeasuredSolid(entry);
        else if (!entry.solid && (isRockLikeAssetModel(asset.model) || asset.category === "building")) {
          this.applyMeasuredSolid(entry);
        }
        this.assets.set(id, entry);
      }

      // Advance nextId past every loaded asset id BEFORE anything below can
      // mint new ids (mob spawn / village markers, and critically the
      // village-restore path below, which places assets of its own) --
      // otherwise freshly-generated ids collide with already-loaded ones,
      // silently overwriting their Map entries while leaving the old meshes
      // orphaned (still rendered, no longer tracked/selectable/exportable).
      for (const id of this.assets.keys()) {
        const match = /^asset_(\d+)$/.exec(id);
        if (match) this.nextId = Math.max(this.nextId, Number(match[1]) + 1);
      }

      for (const vol of bp.terrainVolumes ?? []) {
        const data: RegionTerrainVolume = { ...vol };
        const mesh = createTerrainVolumeMesh(data);
        this.scene.add(mesh);
        this.volumes.set(data.id, { id: data.id, data, obj: mesh });
        const match = /^volume_(\d+)$/.exec(data.id);
        if (match) this.nextId = Math.max(this.nextId, Number(match[1]) + 1);
      }

      for (const spawn of bp.mobSpawns) {
        const id = this.placeMarkerAt(
          "mobSpawn",
          spawn.localX,
          this.heightAt(spawn.localX, spawn.localZ),
          spawn.localZ,
        );
        const m = this.markers.get(id);
        if (m) {
          m.difficulty = spawn.difficulty ?? 1;
          m.mobType = spawn.type;
        }
      }
      for (const node of bp.resourceNodes ?? []) {
        if (!isPlaceableRegionNodeType(node.type)) continue;
        this.resourceNodeType = node.type;
        const id = this.placeMarkerAt(
          "resourceNode",
          node.localX,
          this.heightAt(node.localX, node.localZ),
          node.localZ,
        );
        const m = this.markers.get(id);
        if (m) {
          m.nodeType = node.type;
          m.nodeModel =
            node.model ??
            (node.type === "tree"
              ? pickRandomRegionTreeModel(this.meta.biome, (hashString(id) % 1000) / 1000)
              : undefined);
          if (node.id) {
            // Prefer authored id on export by stashing on the marker.
            m.name = node.id;
          }
          this.rebuildResourceNodeMarkerVisual(m);
        }
      }
      for (const village of bp.villages) {
        // skipVillageGen: this village's buildings are already present in
        // bp.assets (loaded above) -- auto-generating a fresh random village
        // here would duplicate them under colliding ids every single load.
        const id = this.placeMarkerAt("village", village.localX, this.heightAt(village.localX, village.localZ), village.localZ, true);
        const m = this.markers.get(id);
        if (m) {
          m.name = village.name;
          m.radius = village.radius;
          if (m.ring) {
            m.obj.remove(m.ring);
            m.ring.geometry.dispose();
          }
          m.ring = this.buildVillageRing(village.radius);
          m.obj.add(m.ring);
        }
      }
      for (const light of bp.lights ?? []) {
        this.placeLight(light.localX, light.localY - 1.5, light.localZ, light.color, light.intensity, light.distance, light.decay ?? 1);
      }
      for (const fog of bp.fogVolumes ?? []) {
        const id = this.placeFogVolume(fog.localX, fog.localY, fog.localZ, fog.color, fog.shape, fog.sizeX);
        const entry = this.fogVolumes.get(id);
        if (entry) {
          entry.data = { ...fog, id };
          syncFogVolumeMesh(entry.mesh, entry.data);
        }
      }
      for (const barrier of bp.barrierVolumes ?? []) {
        const id = barrier.id ?? `barrier_${this.nextId++}`;
        const data: RegionBarrierVolume = { ...barrier, id };
        const group = createBarrierMesh(data);
        group.userData.editorKind = "barrier";
        group.userData.editorId = id;
        this.scene.add(group);
        this.barrierVolumes.set(id, { id, data, group });
        const match = /^barrier_(\d+)$/.exec(id);
        if (match) this.nextId = Math.max(this.nextId, Number(match[1]) + 1);
      }
      for (const cloud of bp.clouds ?? []) {
        const id = cloud.id ?? `cloud_${this.nextId++}`;
        const data: RegionCloud = { ...cloud, id };
        const group = createRegionCloudMesh(data);
        group.userData.editorKind = "cloud";
        group.userData.editorId = id;
        this.scene.add(group);
        this.clouds.set(id, { id, data, group });
        const match = /^cloud_(\d+)$/.exec(id);
        if (match) this.nextId = Math.max(this.nextId, Number(match[1]) + 1);
      }
      for (const house of bp.houses ?? []) {
        const id = house.id ?? `house_${this.nextId++}`;
        const data: RegionHouse = { ...house, id };
        const group = await this.buildHouseGroup(data);
        this.scene.add(group);
        this.houses.set(id, { id, data, group });
        const match = /^house_(\d+)$/.exec(id);
        if (match) this.nextId = Math.max(this.nextId, Number(match[1]) + 1);
      }
      this.rebuildHouseColliders();
      for (const npc of bp.npcs ?? []) {
        const id = this.placeMarkerAt("npc", npc.localX, this.heightAt(npc.localX, npc.localZ), npc.localZ);
        const m = this.markers.get(id);
        if (m) {
          m.name = npc.name;
          m.npcData = {
            id: npc.id || id,
            name: npc.name,
            model: npc.model,
            localX: npc.localX,
            localZ: npc.localZ,
            yaw: npc.yaw,
            title: npc.title,
            dialogue: npc.dialogue,
            quests: npc.quests ?? [],
            generateProceduralQuests: npc.generateProceduralQuests ?? true,
          };
          this.rebuildNPCMarkerVisual(m);
        }
      }
      for (const ev of bp.worldEvents ?? []) {
        const id = this.placeMarkerAt("worldEvent", ev.localX, this.heightAt(ev.localX, ev.localZ), ev.localZ);
        const m = this.markers.get(id);
        if (m) {
          // Keep authored id so runtime/server can match across reloads.
          if (ev.id && ev.id !== id) {
            this.markers.delete(id);
            m.id = ev.id;
            m.obj.userData.editorId = ev.id;
            this.markers.set(ev.id, m);
            const match = /^marker_(\d+)$/.exec(ev.id);
            if (match) this.nextId = Math.max(this.nextId, Number(match[1]) + 1);
          }
          m.name = ev.name;
          m.radius = ev.radius;
          m.frequencyMin = ev.frequencyMin;
          m.difficulty = ev.difficulty;
          m.lootAmount = ev.lootAmount;
          m.mobTypes = [...ev.mobTypes];
          m.bossType = ev.bossType ?? "";
          m.durationSec = ev.durationSec ?? 600;
          if (m.ring) {
            m.obj.remove(m.ring);
            m.ring.geometry.dispose();
          }
          m.ring = this.buildVillageRing(ev.radius, MARKER_COLORS.worldEvent);
          m.obj.add(m.ring);
        }
      }
      this.placeMarkerAt("entry", bp.entryLocal.x, this.heightAt(bp.entryLocal.x, bp.entryLocal.z), bp.entryLocal.z);
      // Drop the fly camera near the entry so loading a region feels immediate.
      const ex = bp.entryLocal.x;
      const ez = bp.entryLocal.z;
      const ey = this.heightAt(ex, ez) + RegionEditorScene.FLY_EYE_HEIGHT + 4;
      this.flyPos.set(ex, ey, ez);
      this.flyYaw = 0;
      this.flyPitch = -0.35;
      this.flyFlying = true;
      this.orbit.target.set(ex, this.heightAt(ex, ez), ez);
      if (this.navMode === "fly" && !this.playtestActive) this.applyFlyCamera();
      else {
        this.camera.position.set(ex + 40, ey + 30, ez + 40);
        this.orbit.update();
      }
    } finally {
      this.isRestoring = false;
    }
  }

  exportBlueprint(metaOverride?: Partial<{ id: string; name: string; biome: RegionBiome; portalWorldX: number; portalWorldZ: number; musicTrack: string | null }>): RegionBlueprint {
    const meta = { ...this.meta, ...metaOverride };
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    const getTransform = (obj: THREE.Object3D) => {
      obj.getWorldPosition(worldPos);
      obj.getWorldQuaternion(worldQuat);
      obj.getWorldScale(worldScale);
      return {
        x: worldPos.x,
        y: worldPos.y,
        z: worldPos.z,
        yaw: yawFromQuaternion(worldQuat),
        scaleX: worldScale.x,
        scaleY: worldScale.y,
        scaleZ: worldScale.z,
      };
    };

    const assets = [...this.assets.values()].map((a) => {
      const t = getTransform(a.obj);
      // Persist light only when non-default or explicitly disabled on an emitter.
      let lightOut: RegionAssetLight | undefined;
      if (a.light?.enabled === false) {
        lightOut = { enabled: false };
      } else if (a.light) {
        const defaults = REGION_ASSET_LIGHT_DEFAULTS[a.model];
        if (defaults) {
          const color = a.light.color ?? defaults.color;
          const intensity = a.light.intensity ?? defaults.intensity;
          const distance = a.light.distance ?? defaults.distance;
          const decay = a.light.decay ?? defaults.decay;
          const offsetX = a.light.offsetX ?? defaults.offsetX;
          const offsetY = a.light.offsetY ?? defaults.offsetY;
          const offsetZ = a.light.offsetZ ?? defaults.offsetZ;
          if (
            color !== defaults.color ||
            intensity !== defaults.intensity ||
            distance !== defaults.distance ||
            decay !== defaults.decay ||
            offsetX !== defaults.offsetX ||
            offsetY !== defaults.offsetY ||
            offsetZ !== defaults.offsetZ
          ) {
            lightOut = { enabled: true, color, intensity, distance, decay, offsetX, offsetY, offsetZ };
          }
        } else {
          lightOut = { ...a.light };
        }
      }
      return {
        id: a.id,
        model: a.model,
        category: a.category,
        localX: t.x,
        localY: t.y,
        localZ: t.z,
        yaw: t.yaw,
        ...regionAssetScaleFields(t.scaleX, t.scaleY, t.scaleZ),
        ...(a.groupId ? { groupId: a.groupId } : {}),
        ...(lightOut ? { light: lightOut } : {}),
        ...(a.solid ? { solid: true } : {}),
        ...(a.solid && a.solidBox ? { solidBox: { ...a.solidBox } } : {}),
      };
    });
    const mobSpawns = [...this.markers.values()]
      .filter((m) => m.kind === "mobSpawn")
      .map((m) => {
        const t = getTransform(m.obj);
        return {
          localX: t.x,
          localZ: t.z,
          difficulty: m.difficulty ?? 1,
          ...(m.mobType ? { type: m.mobType } : {}),
        };
      });
    const resourceNodes: RegionResourceNode[] = [...this.markers.values()]
      .filter((m) => m.kind === "resourceNode")
      .map((m, i) => {
        const t = getTransform(m.obj);
        const type = isPlaceableRegionNodeType(m.nodeType ?? "") ? m.nodeType! : "rock";
        const id = m.name?.startsWith("region_") || m.name?.startsWith("node_") ? m.name : `node_${m.id}`;
        const variant = (hashString(m.id) % 1000) / 1000;
        const model =
          type === "tree"
            ? m.nodeModel ?? pickRandomRegionTreeModel(this.meta.biome, variant)
            : undefined;
        return {
          id: id || `node_${i}`,
          type,
          localX: t.x,
          localZ: t.z,
          variant,
          ...(model ? { model } : {}),
        };
      });
    const villages = [...this.markers.values()]
      .filter((m) => m.kind === "village")
      .map((m) => {
        const t = getTransform(m.obj);
        return { name: m.name ?? "Village", localX: t.x, localZ: t.z, radius: m.radius ?? 20 };
      });
    const portals = [...this.markers.values()]
      .filter((m) => m.kind === "portal")
      .map((m) => {
        const t = getTransform(m.obj);
        return {
          id: m.id,
          name: m.name ?? "Portal to Region",
          localX: t.x,
          localZ: t.z,
          targetRegionId: m.targetRegionId ?? "",
          targetLocalX: m.targetLocalX,
          targetLocalZ: m.targetLocalZ,
        };
      });
    const npcs = [...this.markers.values()]
      .filter((m) => m.kind === "npc")
      .map((m) => {
        const t = getTransform(m.obj);
        return {
          id: m.id,
          name: m.npcData?.name ?? m.name ?? "Quest Giver",
          model: m.npcData?.model ?? "Knight",
          localX: t.x,
          localZ: t.z,
          yaw: t.yaw,
          title: m.npcData?.title,
          dialogue: m.npcData?.dialogue,
          quests: m.npcData?.quests ?? [],
          generateProceduralQuests: m.npcData?.generateProceduralQuests ?? true,
        };
      });
    const worldEvents: RegionWorldEvent[] = [...this.markers.values()]
      .filter((m) => m.kind === "worldEvent")
      .map((m) => {
        const t = getTransform(m.obj);
        const ev: RegionWorldEvent = {
          id: m.id,
          name: m.name ?? "World Event",
          localX: t.x,
          localZ: t.z,
          radius: m.radius ?? 40,
          frequencyMin: m.frequencyMin ?? 15,
          difficulty: m.difficulty ?? 1,
          lootAmount: m.lootAmount ?? 1,
          mobTypes: m.mobTypes && m.mobTypes.length > 0 ? [...m.mobTypes] : ["wolf"],
          durationSec: m.durationSec ?? 600,
        };
        if (m.bossType) ev.bossType = m.bossType;
        return ev;
      });
    const lights = [...this.lights.values()].map((l) => {
      const t = getTransform(l.obj);
      return { id: l.id, localX: t.x, localY: t.y, localZ: t.z, color: l.color, intensity: l.intensity, distance: l.distance, decay: l.decay };
    });
    const fogVolumes = [...this.fogVolumes.values()].map((f) => {
      const t = getTransform(f.mesh);
      return {
        ...f.data,
        id: f.id,
        localX: t.x,
        localY: t.y,
        localZ: t.z,
        sizeX: f.data.sizeX,
        sizeY: f.data.sizeY,
        sizeZ: f.data.sizeZ,
      };
    });
    const barrierVolumes = [...this.barrierVolumes.values()].map((b) => {
      this.syncBarrierDataFromGroup(b);
      return { ...b.data, id: b.id };
    });
    const clouds = [...this.clouds.values()].map((c) => {
      this.syncCloudDataFromGroup(c);
      return { ...c.data, id: c.id };
    });
    const houses = [...this.houses.values()].map((h) => {
      this.syncHouseDataFromGroup(h);
      return { ...h.data };
    });
    const terrainVolumes = [...this.volumes.values()].map((v) => {
      this.syncVolumeDataFromMesh(v);
      return { ...v.data };
    });
    let entryLocal = { x: 0, z: 0 };
    if (this.entryMarker) {
      const t = getTransform(this.entryMarker.obj);
      entryLocal = { x: t.x, z: t.z };
    }

    return {
      id: meta.id,
      name: meta.name,
      biome: meta.biome,
      gridSize: this.gridSize,
      pitch: this.pitch,
      heights: [...this.heights],
      waterHeights: this.waterHeights.some((w) => w > 0) ? [...this.waterHeights] : undefined,
      customTextures: this.customTextures.some((t) => t > 0) ? [...this.customTextures] : undefined,
      assets,
      houses: houses.length > 0 ? houses : undefined,
      mobSpawns,
      resourceNodes: resourceNodes.length > 0 ? resourceNodes : undefined,
      villages,
      roads: this.roads.length > 0 ? this.roads : undefined,
      grassPatches: this.grassPatches.length > 0 ? this.grassPatches : undefined,
      grassExclusions: this.grassExclusions.length > 0 ? this.grassExclusions : undefined,
      grassColor: {
        bottom: this.grassSettings.baseColour,
        top: this.grassSettings.tipColour,
      },
      grassSway: this.grassSettings.windStrength,
      grassSettings: { ...this.grassSettings },
      wind: { ...this.wind },
      colorGrading: { ...this.colorGrading },
      entryLocal,
      portalWorldX: meta.portalWorldX,
      portalWorldZ: meta.portalWorldZ,
      worldOriginX: meta.worldOriginX,
      worldOriginZ: meta.worldOriginZ,
      isStartingRegion: meta.isStartingRegion ? true : undefined,
      portals: portals.length > 0 ? portals : undefined,
      npcs: npcs.length > 0 ? npcs : undefined,
      worldEvents: worldEvents.length > 0 ? worldEvents : undefined,
      lights: lights.length > 0 ? lights : undefined,
      fogVolumes: fogVolumes.length > 0 ? fogVolumes : undefined,
      barrierVolumes: barrierVolumes.length > 0 ? barrierVolumes : undefined,
      clouds: clouds.length > 0 ? clouds : undefined,
      terrainVolumes: terrainVolumes.length > 0 ? terrainVolumes : undefined,
      musicTrack: meta.musicTrack,
    };
  }

  private frame = (): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrameTime) / 1000);
    this.lastFrameTime = now;
    if (this.playtestActive) {
      this.updatePlaytest(dt);
    } else if (this.navMode === "fly") {
      this.updateFly(dt);
      // Keep orbit target synced so other systems (grass focus, framing) stay coherent.
      this.orbit.target.set(
        this.flyPos.x - Math.sin(this.flyYaw) * 12,
        this.flyPos.y + Math.sin(this.flyPitch) * 12,
        this.flyPos.z - Math.cos(this.flyYaw) * 12,
      );
    } else {
      this.orbit.update();
    }
    for (const m of this.markers.values()) {
      if (m.kind === "npc" && m.animModel) {
        m.animModel.update(dt);
      }
    }
    this.stepWaterPhysics(dt);
    this.updateWaterParticles(dt);
    this.waterMeshField?.update(dt);
    if (this.clouds.size > 0) this.tickEditorClouds(dt);
    // Live grass paint/erase: refresh density texture under the brush.
    if (this.isGrassBrushing || this.isErasingGrass || this.grassPreviewDirty) {
      this.flushGrassPreviewWhileBrushing();
    }
    if (this.grassField) {
      const sunDir = new THREE.Vector3()
        .copy(this.sunLight.position)
        .sub(this.sunLight.target.position)
        .normalize();
      this.grassField.setSunFromLight(sunDir, this.sunLight.color, this.sunLight.intensity);
      if (this.playtestActive) {
        this.grassField.setPlayer(this.playtestPos.x, this.playtestPos.y, this.playtestPos.z);
      } else {
        this.grassField.setPlayer(this.camera.position.x, this.camera.position.y, this.camera.position.z);
      }
      this.grassField.update(this.camera, dt);
    }
    this.skyDome.update(dt, this.camera);
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.running = false;
    if (this.playtestActive) this.exitPlaytest();
    this.suspendFlyNavListeners();
    this.clearNeighborReferences();
    if ((this.canvas as CanvasWithScene).__regionEditorScene === this) {
      (this.canvas as CanvasWithScene).__regionEditorScene = undefined;
    }
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mouseup", this.onMouseUp);
    this.canvas.removeEventListener("mouseleave", this.onMouseUp);
    this.canvas.removeEventListener("click", this.onClick);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKeyDown);
    this.transform.removeEventListener("objectChange", this.onTransformChange);
    this.transform.dispose();
    this.orbit.dispose();
    this.skyDome.dispose();
    this.scene.remove(this.skyDome.group);
    this.renderer.dispose();
  }
}
