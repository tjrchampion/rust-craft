import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { SelectionBox } from "three/examples/jsm/interactive/SelectionBox.js";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import { load, AnimatedModel, PLAYER_ANIMS, logicalFromState } from "./gltf";
import { GENDER_MODEL_URLS, CLASS_GENDER } from "./classModels";
import { buildNameplate } from "./models";
import {
  type RegionBlueprint,
  type RegionAssetCategory,
  type RegionBiome,
  type RegionColorGrading,
  type RegionRoad,
  type RegionPointLight,
  type RegionNPC,
  type RegionQuest,
  type RegionWorldEvent,
  type ClassId,
  type GrassPatch,
  type GrassExclusion,
  type GrassColor,
  type RegionWind,
  type RegionTerrainVolume,
  type TerrainVolumeShape,
  type TerrainVolumeMaterial,
  sampleRegionWaterDepth,
  REGION_COLOR_PRESETS,
  REGION_FOLIAGE,
  REGION_ASSET_COLLISION_RADIUS,
  REGION_ASSET_COLLISION_HEIGHT,
  REGION_ASSET_CLIMBABLE,
  ASSET_COLLISION_OVERRIDES,
  CLASS_IDS,
  WALK_SPEED,
  SPRINT_SPEED,
  JUMP_VELOCITY,
  GRAVITY,
  regionMusicTrackUrl,
  hashString,
  terrainVolumeRadius,
  terrainVolumeTopY,
  isTerrainStroke,
  strokePointHalfWidth,
  strokePointTopY,
  carveBlocksSurface,
  type TerrainVolumeCarve,
} from "@rustcraft/shared";
import { applyGroundBlendShader, regionGroundWeights, regionRoadBlendAt, buildRegionWaterMesh, type RegionWaterMeshField } from "./terrain";
import { buildGrassInstances, type GrassField } from "./grassField";
import { applyRegionWind } from "./windSway";
import { generateHouseAssets, type HouseType } from "./houseGen";
import {
  createTerrainVolumeMesh,
  createTerrainVolumeGhost,
  defaultVolumeScale,
  rebuildTerrainStrokeMesh,
  rebuildTerrainVolumeMesh,
  strokeSizeFromBrush,
} from "./terrainVolumes";

/** Matches grassField.ts's own BASE_GRASS_WIND_STRENGTH -- kept local since
 *  it's only needed here for the editor's live-preview uniform update. */
const BASE_GRASS_WIND_STRENGTH = 0.3;
import { music } from "../game/music";

export type EditorTransformMode = "translate" | "rotate" | "scale";
export type EditorMarkerKind = "mobSpawn" | "village" | "entry" | "portal" | "npc" | "worldEvent";
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
  village: 0xffd23f,
  entry: 0x44dd66,
  portal: 0x9944ff,
  npc: 0x33b5e5,
  worldEvent: 0xff8800,
};

const ARROW_PAN_STEP = 4;
const ARROW_PAN_STEP_FAST = 16;

export interface EditorSelection {
  kind: "asset" | "marker" | "light" | "volume";
  id: string;
  model?: string;
  category?: RegionAssetCategory;
  markerKind?: EditorMarkerKind;
  name?: string;
  radius?: number;
  targetRegionId?: string;
  targetLocalX?: number;
  targetLocalZ?: number;
  npcData?: RegionNPC;
  color?: string;
  intensity?: number;
  distance?: number;
  /** Present when this asset is part of a generated house (or similar). */
  groupId?: string;
  volumeShape?: TerrainVolumeShape;
  volumeMaterial?: TerrainVolumeMaterial;
  frequencyMin?: number;
  difficulty?: number;
  lootAmount?: number;
  mobTypes?: string[];
  bossType?: string;
  durationSec?: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
}

interface AssetEntry {
  id: string;
  model: string;
  category: RegionAssetCategory;
  obj: THREE.Object3D;
  /** Shared across every piece of a generated house -- see RegionAsset.groupId. */
  groupId?: string;
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
  bossType?: string;
  durationSec?: number;
}

interface LightEntry {
  id: string;
  color: string;
  intensity: number;
  distance: number;
  obj: THREE.Group;
  light: THREE.PointLight;
  bulb: THREE.Sprite;
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
  private sunLight = new THREE.DirectionalLight(0xffffff, 1.0);
  private colorGrading: RegionColorGrading = { ...REGION_COLOR_PRESETS.grassland };
  private meta = { id: "", name: "New Region", biome: "grassland" as RegionBiome, portalWorldX: 0, portalWorldZ: 0, isStartingRegion: false, musicTrack: null as string | null };

  private gridSize = DEFAULT_GRID_SIZE;
  private pitch = DEFAULT_PITCH;
  private heights: number[] = new Array(DEFAULT_GRID_SIZE * DEFAULT_GRID_SIZE).fill(0);
  private customTextures: number[] = new Array(DEFAULT_GRID_SIZE * DEFAULT_GRID_SIZE).fill(0);
  private terrainMesh: THREE.Mesh;

  private assets = new Map<string, AssetEntry>();
  private volumes = new Map<string, VolumeEntry>();
  private markers = new Map<string, MarkerEntry>();
  private lights = new Map<string, LightEntry>();
  private entryMarker: MarkerEntry | null = null;

  private armedModel: { model: string; category: RegionAssetCategory } | null = null;
  private armedMarkerKind: EditorMarkerKind | null = null;
  private armedLightColor: string | null = null;
  /** House-placement tool armed -- next click generates a procedural house
   *  (see houseGen.ts's generateHouseAssets) centered on the clicked ground
   *  point, placed as ordinary building-category assets. Single-click only
   *  (unlike armedModel's click-and-drag painting): a house is dozens of
   *  pieces, so dragging would spam-generate overlapping houses. */
  private armedHouse = false;
  private armedHouseType: HouseType = "random";
  /** Volume-sculpt brush -- stamps real 3D primitives into the world instead
   *  of deforming the heightmap. `place` drops one shape at a time; `sculpt`
   *  is a continuous drag brush that sprays overlapping stamps along the stroke. */
  private volumeStampActive = false;
  private volumeBrushStyle: "place" | "sculpt" = "place";
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
  /** Live preview of grassPatches -- rebuilt (not incrementally updated) on
   *  mouseup after a grass-brush stroke, or on blueprint load. Null when
   *  there are no patches. */
  private grassField: GrassField | null = null;
  private grassPreviewDirty = false;

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
  private lastFrameTime = performance.now();
  private static readonly PLAYTEST_AVATAR_HEIGHT = 1.75;
  private static readonly PLAYTEST_CAMERA_DISTANCE = 6.5;
  private static readonly PLAYTEST_CAMERA_HEIGHT = 2.2;
  private static readonly PLAYTEST_MOUSE_SENSITIVITY = 0.0024;

  constructor(
    private canvas: HTMLCanvasElement,
    private onSelectionChange: (sel: EditorSelection[]) => void,
    private onChange?: () => void,
    private onPlaytestChange?: (active: boolean) => void,
    onMarquee?: (box: { startX: number; startY: number; endX: number; endY: number } | null) => void,
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

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 800);
    this.camera.position.set(60, 60, 60);

    this.scene.add(this.ambientLight);
    this.sunLight.position.set(80, 100, 40);
    this.scene.add(this.sunLight);
    this.scene.fog = new THREE.FogExp2(0xbcd9f0, 0.006);

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
    this.scene.add(this.transform.getHelper());
    this.transform.addEventListener("dragging-changed", (e) => {
      const isDragging = (e as unknown as { value: boolean }).value;
      this.orbit.enabled = !isDragging;
      if (isDragging) {
        this.dragStartPos.copy(this.selectionGroup.position);
        this.dragStartRot.copy(this.selectionGroup.rotation);
      } else {
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
    window.addEventListener("keydown", this.onKeyDown);

    this.resize();
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
  private syncTerrainMeshHeights(mesh: THREE.Mesh = this.terrainMesh): void {
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
  }

  private heightAt(x: number, z: number): number {
    const half = ((this.gridSize - 1) * this.pitch) / 2;
    const tx = Math.min(this.gridSize - 1, Math.max(0, Math.round((x + half) / this.pitch)));
    const tz = Math.min(this.gridSize - 1, Math.max(0, Math.round((z + half) / this.pitch)));
    return this.heights[tz * this.gridSize + tx] ?? 0;
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
      for (let tz = 0; tz < this.gridSize; tz++) {
        const wz = tz * this.pitch - half;
        for (let tx = 0; tx < this.gridSize; tx++) {
          const wx = tx * this.pitch - half;
          const d = Math.hypot(wx - hitX, wz - hitZ);
          if (d > this.brushRadius) continue;
          const falloff = 1 - d / this.brushRadius;
          this.heights[tz * this.gridSize + tx]! += sign * this.brushStrength * falloff * 0.4;
        }
      }
    } else if (mode === "mold") {
      if (this.moldTargetHeight === null) {
        this.moldTargetHeight = this.heightAt(hitX, hitZ);
      }
      const targetH = this.moldTargetHeight;
      for (let tz = 0; tz < this.gridSize; tz++) {
        const wz = tz * this.pitch - half;
        for (let tx = 0; tx < this.gridSize; tx++) {
          const wx = tx * this.pitch - half;
          const d = Math.hypot(wx - hitX, wz - hitZ);
          if (d > this.brushRadius) continue;
          const falloff = 1 - d / this.brushRadius;
          const idx = tz * this.gridSize + tx;
          const currentH = this.heights[idx]!;
          const factor = Math.min(0.8, this.brushStrength * falloff * 0.25);
          this.heights[idx] = currentH + (targetH - currentH) * factor;
        }
      }
    } else if (mode === "smooth") {
      const gSize = this.gridSize;
      const copyHeights = new Float32Array(this.heights);
      for (let tz = 0; tz < gSize; tz++) {
        const wz = tz * this.pitch - half;
        for (let tx = 0; tx < gSize; tx++) {
          const wx = tx * this.pitch - half;
          const d = Math.hypot(wx - hitX, wz - hitZ);
          if (d > this.brushRadius) continue;
          const falloff = 1 - d / this.brushRadius;
          const idx = tz * gSize + tx;

          let sum = copyHeights[idx]!;
          let count = 1;
          if (tx > 0) { sum += copyHeights[idx - 1]!; count++; }
          if (tx < gSize - 1) { sum += copyHeights[idx + 1]!; count++; }
          if (tz > 0) { sum += copyHeights[idx - gSize]!; count++; }
          if (tz < gSize - 1) { sum += copyHeights[idx + gSize]!; count++; }
          const avg = sum / count;

          const factor = Math.min(0.8, this.brushStrength * falloff * 0.3);
          this.heights[idx] = copyHeights[idx]! + (avg - copyHeights[idx]!) * factor;
        }
      }
    }

    this.syncTerrainMeshHeights();
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

    for (let tz = 0; tz < this.gridSize; tz++) {
      const wz = tz * this.pitch - half;
      for (let tx = 0; tx < this.gridSize; tx++) {
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
      this.syncTerrainMeshHeights();
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
   *  light drag). `sculpt` = continuous drag brush that sprays a cluster of
   *  overlapping stamps along the stroke path (distance-spaced). */
  armVolumeStamp(
    shape: TerrainVolumeShape,
    material: TerrainVolumeMaterial = this.volumeMaterial,
    style: "place" | "sculpt" = "place",
  ): void {
    this.armedModel = null;
    this.armedMarkerKind = null;
    this.armedHouse = false;
    this.armedLightColor = null;
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
    this.volumeShape = shape;
    this.volumeMaterial = material;
    this.lastVolumeStrokePos = null;
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
    this.volumeShape = shape;
    if (this.volumeStampActive) this.rebuildVolumeGhost();
  }

  get volumeBrushStyleActive(): "place" | "sculpt" | null {
    return this.volumeStampActive ? this.volumeBrushStyle : null;
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
    const s = defaultVolumeScale(
      this.volumeShape,
      this.volumeBrushStyle === "sculpt" ? this.brushRadius * 0.45 : this.brushRadius,
    );
    this.volumeGhost.scale.set(s.scaleX, s.scaleY, s.scaleZ);
    this.volumeGhost.visible = false;
    this.scene.add(this.volumeGhost);

    if (this.volumeBrushStyle === "sculpt") {
      const ringGeo = new THREE.RingGeometry(this.brushRadius * 0.92, this.brushRadius, 48);
      ringGeo.rotateX(-Math.PI / 2);
      this.volumeBrushRing = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: 0x7dd3a0,
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

  public placeLight(x: number, y: number, z: number, color = "#ff9933", intensity = 2.5, distance = 25.0): string {
    const id = `light_${this.nextId++}`;
    const group = new THREE.Group();
    group.position.set(x, y + 1.5, z);

    const pointLight = new THREE.PointLight(color, intensity, distance, 1.5);
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

    const entry: LightEntry = { id, color, intensity, distance, obj: group, light: pointLight, bulb };
    this.lights.set(id, entry);
    this.select("light", id, false);
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
    if (this.grassPatches.length !== before) this.rebuildGrassPreview();

    this.emitSelection();
    this.triggerChange();
  }

  private scatterRandomTreesAt(hitX: number, hitZ: number): void {
    const now = performance.now();
    if (now - this.lastPlaceTime < 240) return;
    this.lastPlaceTime = now;

    const foliageList = REGION_FOLIAGE[this.meta.biome] ?? REGION_FOLIAGE.grassland;
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

  /** Appends one compact GrassPatch record per brush tick (same throttle
   *  shape as the tree-scatter brush it replaces) instead of scattering
   *  discrete assets -- see GrassPatch's doc comment. The live preview mesh
   *  is NOT rebuilt here (potentially hundreds of blade transforms per
   *  patch, and a long drag would re-walk every prior patch each tick) --
   *  it's rebuilt once on mouseup, see the pointerup handler. */
  private paintGrassPatchAt(hitX: number, hitZ: number): void {
    const now = performance.now();
    if (now - this.lastPlaceTime < 240) return;
    this.lastPlaceTime = now;

    const waterDepth = this.sampleWaterDepth(hitX, hitZ);
    if (waterDepth > 0.05) return;

    const id = `grass_${this.nextId++}`;
    this.grassPatches.push({
      id,
      localX: hitX,
      localZ: hitZ,
      radius: this.brushRadius,
      density: Math.min(1, Math.max(0.1, this.brushStrength / 3)),
      seed: hashString(id),
      lengthScale: this.grassLength,
    });
    this.grassPreviewDirty = true;
  }

  /** Fine-grained grass removal: carves a small exclusion circle out of the
   *  blade field at the brush position instead of deleting whole GrassPatch
   *  records (see eraseAssetsAt) -- lets a large painted patch be thinned out
   *  in one spot without losing the rest of it. */
  private eraseGrassAt(hitX: number, hitZ: number): void {
    const now = performance.now();
    if (now - this.lastPlaceTime < 240) return;
    this.lastPlaceTime = now;

    const id = `grasserase_${this.nextId++}`;
    this.grassExclusions.push({
      localX: hitX,
      localZ: hitZ,
      radius: this.brushRadius,
      strength: Math.min(1, Math.max(0.05, this.brushStrength / 3)),
      seed: hashString(id),
    });
    this.grassPreviewDirty = true;
  }

  /** Rebuilds the grass preview InstancedMeshes from this.grassPatches --
   *  called on mouseup after a paint/erase stroke, and after loading a
   *  blueprint. Not incremental: regenerates every patch's blades from
   *  scratch, same buildGrassInstances the runtime renderer uses, so the
   *  editor preview and the saved region always agree. */
  private rebuildGrassPreview(): void {
    if (this.grassField) {
      for (const mesh of this.grassField.meshes) this.scene.remove(mesh);
      this.grassField.dispose();
    }
    this.grassField =
      this.grassPatches.length > 0
        ? buildGrassInstances(
            this.grassPatches,
            this.grassExclusions,
            { gridSize: this.gridSize, pitch: this.pitch, heights: this.heights },
            { color: this.grassColor, wind: this.wind },
          )
        : null;
    if (this.grassField) {
      for (const mesh of this.grassField.meshes) this.scene.add(mesh);
    }
    this.grassPreviewDirty = false;
  }

  clearWater(): void {
    this.waterHeights.fill(0);
    this.syncWaterMesh();
    this.triggerChange();
  }

  private syncWaterMesh(): void {
    if (this.waterHeights.length !== this.gridSize * this.gridSize) {
      this.waterHeights = new Float32Array(this.gridSize * this.gridSize);
    }
    if (!this.waterMeshField) {
      this.waterMeshField = buildRegionWaterMesh(this.gridSize, this.pitch, this.heights, this.waterHeights);
      this.scene.add(this.waterMeshField.mesh);
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

    for (let tz = 0; tz < this.gridSize; tz++) {
      const wz = tz * this.pitch - half;
      for (let tx = 0; tx < this.gridSize; tx++) {
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

  private stepWaterPhysics(dt: number): void {
    if (!this.waterPhysicsSimulating || this.waterHeights.length === 0) return;
    let hasWater = false;
    for (let i = 0; i < this.waterHeights.length; i++) {
      if (this.waterHeights[i]! > 0.002) { hasWater = true; break; }
    }
    if (!hasWater) return;

    const gSize = this.gridSize;
    // Run 3 fast sub-iterations per frame for smooth self-leveling pool surfaces
    const iterations = 3;
    const subDt = Math.min(0.033, dt) / iterations;
    const flowCoeff = subDt * 14.0;
    let totalChanged = false;

    for (let iter = 0; iter < iterations; iter++) {
      const nextWater = new Float32Array(this.waterHeights);
      let changed = false;

      for (let tz = 0; tz < gSize; tz++) {
        for (let tx = 0; tx < gSize; tx++) {
          const idx = tz * gSize + tx;
          const wCurr = this.waterHeights[idx]!;
          if (wCurr <= 0.001) continue;
          const hCurr = this.heights[idx]!;
          const sCurr = hCurr + wCurr;

          const nbrs: number[] = [];
          if (tx > 0) nbrs.push(tz * gSize + (tx - 1));
          if (tx < gSize - 1) nbrs.push(tz * gSize + (tx + 1));
          if (tz > 0) nbrs.push((tz - 1) * gSize + tx);
          if (tz < gSize - 1) nbrs.push((tz + 1) * gSize + tx);

          for (const nIdx of nbrs) {
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
        this.waterHeights.set(nextWater);
        totalChanged = true;
      } else {
        break;
      }
    }

    // Clean up ultra-thin residual film (< 0.003) so dry terrain stays clean
    for (let i = 0; i < this.waterHeights.length; i++) {
      if (this.waterHeights[i]! > 0 && this.waterHeights[i]! < 0.003) {
        this.waterHeights[i] = 0;
        totalChanged = true;
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

  setMeta(patch: Partial<{ id: string; name: string; biome: RegionBiome; portalWorldX: number; portalWorldZ: number; isStartingRegion: boolean; musicTrack: string | null }>): void {
    this.meta = { ...this.meta, ...patch };
    if (patch.musicTrack !== undefined && this.playtestActive) {
      music.play(regionMusicTrackUrl(this.meta.musicTrack), 3000);
    }
  }

  getMeta(): { id: string; name: string; biome: RegionBiome; portalWorldX: number; portalWorldZ: number; isStartingRegion: boolean; musicTrack: string | null } {
    return { ...this.meta };
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

  setTransformMode(mode: EditorTransformMode): void {
    this.transform.setMode(mode);
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

  private setMarkersVisible(visible: boolean): void {
    for (const m of this.markers.values()) m.obj.visible = visible;
    if (this.entryMarker) this.entryMarker.obj.visible = visible;
  }

  private enterPlaytest(): void {
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
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    this.canvas.requestPointerLock();

    this.playtestActive = true;
    this.onPlaytestChange?.(true);
    music.play(regionMusicTrackUrl(this.meta.musicTrack), 3000);
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
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();

    if (this.playtestAvatar) {
      this.scene.remove(this.playtestAvatar.group);
      this.playtestAvatar = null;
    }

    this.setMarkersVisible(true);
    this.camera.rotation.set(0, 0, 0);
    this.camera.position.copy(this.playtestSavedCameraPos);
    this.orbit.target.copy(this.playtestSavedTarget);
    this.orbit.enabled = true;
    this.orbit.update();
    this.onPlaytestChange?.(false);
    music.stop();
  }

  private onPointerLockChange = (): void => {
    // The browser exits pointer lock on its own (native Escape, tab switch,
    // etc.) without going through togglePlaytest -- follow suit so the UI
    // toggle button doesn't stay stuck "active" with the mouse un-captured.
    if (this.playtestActive && document.pointerLockElement !== this.canvas) {
      this.exitPlaytest();
    }
  };

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
    const speed = sprint ? SPRINT_SPEED : WALK_SPEED;
    const oldGroundHeight = this.groundHeightAt(this.playtestPos.x, this.playtestPos.z);
    const nextX = this.playtestPos.x + moveX * speed * dt;
    const nextZ = this.playtestPos.z + moveZ * speed * dt;
    // Same per-step slope block shared stepMovement() applies for regions --
    // a step that would change ground height by more than 2.5 units is
    // rejected outright, which is what makes the boundary mountain ring (and
    // any other steep terrain) an actual wall instead of just a tall prop.
    // a step that would change ground height by more than 2.5 units is
    // rejected outright, which is what makes the boundary mountain ring (and
    // any other steep terrain) an actual wall instead of just a tall prop.
    const slopeBlocked = Math.abs(this.groundHeightAt(nextX, nextZ) - oldGroundHeight) > 2.5;
    // Same collision-circle check shared stepMovement() applies against
    // regionAssets -- placed trees/rocks/buildings block walking through
    // them here too, matching real gameplay, except climbable ones (rocks)
    // once the player is already up at/above their own top surface.
    const collided = !slopeBlocked && this.collidesWithAsset(nextX, nextZ, this.playtestPos.x, this.playtestPos.z, this.playtestPos.y);
    if (!slopeBlocked && !collided) {
      this.playtestPos.x = nextX;
      this.playtestPos.z = nextZ;
    }

    // Gravity/jump, identical shape to shared stepMovement()'s grounded branch.
    this.playtestVelocityY -= GRAVITY * dt;
    this.playtestPos.y += this.playtestVelocityY * dt;
    const ground = this.groundHeightAt(this.playtestPos.x, this.playtestPos.z);
    if (this.playtestPos.y <= ground) {
      this.playtestPos.y = ground;
      this.playtestVelocityY = 0;
      this.playtestGrounded = true;
    } else {
      this.playtestGrounded = false;
    }

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
      const logical = logicalFromState(this.playtestGrounded ? "idle" : "jump", animSpeed, 3.5, moveXInput, moveYInput);
      this.playtestAvatar.play(logical);
      this.playtestAvatar.update(dt);
    }

    this.updatePlaytestCamera();
  }

  /** Returns resolved collision data for a placed asset entry, mirroring the
   *  shared resolveCollisionOverride() logic so playtest matches the game.
   *  Returns null if the model explicitly has no collision. */
  private resolveCollisionForAsset(a: AssetEntry): {
    radius: number; height: number; climbable: boolean;
    stairHalfLength?: number;
  } | null {
    const category = a.category;
    if (a.model in ASSET_COLLISION_OVERRIDES) {
      const ov = ASSET_COLLISION_OVERRIDES[a.model];
      return ov ?? null;
    }
    return {
      radius: REGION_ASSET_COLLISION_RADIUS[category],
      height: REGION_ASSET_COLLISION_HEIGHT[category],
      climbable: REGION_ASSET_CLIMBABLE[category],
    };
  }

  /** Circle-collides (x,z) against every currently-placed asset, using the
   *  per-model override table (with per-category fallback) that
   *  regionAssetColliders() bakes into the real game's stepMovement() --
   *  reads straight off the live THREE objects rather than exporting a
   *  blueprint every frame. Only blocks entering a collider from outside it,
   *  same "allow escape" rule as stepMovement's own regionAssets check.
   *  Stair ramp assets are never blocked so you can walk up them. */
  private collidesWithAsset(x: number, z: number, oldX: number, oldZ: number, playerY: number): boolean {
    for (const a of this.assets.values()) {
      const ov = this.resolveCollisionForAsset(a);
      if (!ov || ov.radius === 0) continue; // null = no collision; radius=0 = floor tile
      if (ov.stairHalfLength !== undefined) continue; // ramps never hard-block
      const scale = a.obj.scale.x || 1;
      if (ov.climbable && playerY >= a.obj.position.y + ov.height * scale - 0.3) {
        continue;
      }
      const radius = ov.radius * scale;
      const dx = x - a.obj.position.x;
      const dz = z - a.obj.position.z;
      if (dx * dx + dz * dz < radius * radius) {
        const oldDx = oldX - a.obj.position.x;
        const oldDz = oldZ - a.obj.position.z;
        const alreadyInside = oldDx * oldDx + oldDz * oldDz < radius * radius;
        if (!alreadyInside) return true;
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
    return false;
  }

  /** Terrain height at (x,z), raised to any climbable asset's own top
   *  surface (or interpolated along stair ramps) if the point falls within
   *  its footprint -- mirrors shared stepMovement()'s ground computation
   *  so a player who's jumped onto a rock rests on top of it, and stairs
   *  are smoothly walkable rather than solid walls. */
  private groundHeightAt(x: number, z: number): number {
    let ground = this.heightAt(x, z);
    for (const a of this.assets.values()) {
      const ov = this.resolveCollisionForAsset(a);
      if (!ov || ov.radius === 0) continue;
      const scale = a.obj.scale.x || 1;
      const radius = ov.radius * scale;
      const dx = x - a.obj.position.x;
      const dz = z - a.obj.position.z;
      if (dx * dx + dz * dz >= radius * radius) continue;

      if (ov.stairHalfLength !== undefined) {
        // Compute ramp world direction from the asset's current yaw
        const yaw = a.obj.rotation.y;
        const sin = Math.sin(yaw);
        const cos = Math.cos(yaw);
        const rdx = -sin;
        const rdz = -cos;
        const halfLength = ov.stairHalfLength * scale;
        const rise = ov.height * scale;
        const proj = (dx * rdx + dz * rdz) / halfLength;
        const t = Math.max(0, Math.min(1, (proj + 1) / 2));
        const topY = a.obj.position.y + rise;
        const rampY = topY - rise + t * rise;
        if (rampY > ground) ground = rampY;
      } else if (ov.climbable) {
        const topY = a.obj.position.y + ov.height * scale;
        if (topY > ground) ground = topY;
      }
    }
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
    const distance = RegionEditorScene.PLAYTEST_CAMERA_DISTANCE;

    const targetX = px - Math.sin(cy) * (distance * Math.cos(cp));
    const targetZ = pz - Math.cos(cy) * (distance * Math.cos(cp));
    let targetY = py + RegionEditorScene.PLAYTEST_CAMERA_HEIGHT - distance * Math.sin(cp);
    targetY = Math.max(targetY, this.heightAt(targetX, targetZ) + 0.6);

    this.camera.position.set(targetX, targetY, targetZ);
    this.camera.lookAt(px, py + 1.5, pz);
  }

  // ============================ color grading ============================

  applyColorGrading(cg: RegionColorGrading): void {
    this.colorGrading = { ...cg };
    const sky = new THREE.Color(cg.skyColor);
    this.scene.background = sky;
    this.scene.fog = new THREE.FogExp2(new THREE.Color(cg.fogColor).getHex(), cg.fogDensity);
    this.ambientLight.color = new THREE.Color(cg.ambientColor);
    this.ambientLight.intensity = cg.ambientIntensity;
    this.sunLight.color = new THREE.Color(cg.sunColor);
    this.sunLight.intensity = cg.sunIntensity;
    // groundTint feeds the terrain shader's tint, not a scene-level property
    // -- re-sync so a color-grading change previews on the ground live.
    this.syncTerrainMeshHeights();
    this.triggerChange();
  }

  getColorGrading(): RegionColorGrading {
    return { ...this.colorGrading };
  }

  // ============================ grass color ============================

  /** Updates the grass blade bottom/tip gradient colors -- mutates the
   *  already-built preview's shader uniforms directly (they're shared
   *  THREE.Color uniforms, not per-instance data) so the change previews
   *  instantly without rebuilding any blade InstancedMeshes. */
  applyGrassColor(gc: GrassColor): void {
    this.grassColor = { ...gc };
    if (this.grassField) {
      this.grassField.uniforms.uGrassBottom.value.set(gc.bottom);
      this.grassField.uniforms.uGrassTop.value.set(gc.top);
    }
    this.triggerChange();
  }

  getGrassColor(): GrassColor {
    return { ...this.grassColor };
  }

  /** Brush setting, same shape as setBrushRadius/setBrushStrength -- baked
   *  into each patch's own lengthScale at paint time (see
   *  paintGrassPatchAt), not a region-wide value, so different brush strokes
   *  can paint different grass lengths side by side. */
  setGrassLength(length: number): void {
    this.grassLength = Math.max(0.2, length);
  }

  getGrassLength(): number {
    return this.grassLength;
  }

  /** Region-wide wind, affecting grass sway here and tree sway at runtime
   *  (see RegionInteriorRenderer -- the editor places foliage as individual,
   *  non-instanced objects, so trees don't sway in this preview, only grass
   *  does). Live-updates the already-built grass uniforms directly, same as
   *  applyGrassColor, no rebuild needed. */
  applyWind(w: RegionWind): void {
    this.wind = { ...w };
    if (this.grassField) {
      applyRegionWind(this.grassField.uniforms, this.wind, BASE_GRASS_WIND_STRENGTH);
    }
    this.triggerChange();
  }

  getWind(): RegionWind {
    return { ...this.wind };
  }

  // ============================ placement arming ============================

  armPlacement(model: string, category: RegionAssetCategory): void {
    this.armedMarkerKind = null;
    this.armedHouse = false;
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
    this.clearVolumeStamp();
    this.sculptMode = null;
    this.roadPaintArmed = false;
    this.armedMarkerKind = kind;
    this.orbit.enablePan = false;
    this.transform.detach();
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
    this.armedHouse = true;
    this.armedHouseType = type;
    this.orbit.enablePan = false;
    this.transform.detach();
    this.deselect();
  }

  disarm(): void {
    this.armedModel = null;
    this.armedMarkerKind = null;
    this.armedHouse = false;
    this.clearVolumeStamp();
    this.armedLightColor = null;
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
      this.armedLightColor !== null ||
      this.armedHouse ||
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
    this.raycaster.setFromCamera(this.ndcFromEvent(e), this.camera);
    const targets: THREE.Object3D[] = [this.terrainMesh, ...[...this.volumes.values()].map((v) => v.obj)];
    const hits = this.raycaster.intersectObjects(targets, false);
    return hits[0]?.point ?? null;
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
    const now = performance.now();
    // Place mode: light drag still works, but throttle so one click ≠ a pile.
    if (now - this.lastPlaceTime < 90) return;
    this.lastPlaceTime = now;
    this.placeOneVolume(hit.x, hit.y, hit.z, this.brushRadius, 0.35);
    this.triggerChange();
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
    const hit =
      this.volumeBrushStyle === "sculpt" && this.activeStroke
        ? this.planeHitAt(e, this.activeStroke.start.y)
        : this.volumeSurfaceHitAt(e) ?? this.terrainHitAt(e);
    if (!hit) {
      this.volumeGhost.visible = false;
      if (this.volumeBrushRing) this.volumeBrushRing.visible = false;
      return;
    }
    const ghostR = this.volumeBrushStyle === "sculpt" ? this.brushRadius * 0.45 : this.brushRadius;
    const s = defaultVolumeScale(this.volumeShape, ghostR);
    this.volumeGhost.visible = true;
    this.volumeGhost.position.set(hit.x, hit.y + s.scaleY * 0.7, hit.z);
    this.volumeGhost.scale.set(s.scaleX, s.scaleY, s.scaleZ);
    if (this.volumeBrushRing) {
      this.volumeBrushRing.visible = true;
      this.volumeBrushRing.position.set(hit.x, hit.y + 0.08, hit.z);
    }
  }

  private onMouseDown = (e: MouseEvent): void => {
    if (this.playtestActive) return;
    if (this.transform.dragging) return; // grabbing the gizmo, not placing/sculpting/painting
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
      const hit =
        this.volumeBrushStyle === "sculpt"
          ? this.volumeSurfaceHitAt(e) ?? this.terrainHitAt(e)
          : this.volumeSurfaceHitAt(e);
      if (!hit) return;
      this.isVolumeStamping = true;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.lastPlaceTime = 0;
      this.lastVolumeStrokePos = null;
      if (this.volumeBrushStyle === "sculpt") {
        this.cancelActiveStroke();
        this.sculptVolumeStroke(hit);
      } else {
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
      this.lastPlaceTime = 0;
      this.paintGrassPatchAt(hit.x, hit.z);
      e.preventDefault();
      e.stopPropagation();
    } else if (this.grassEraseBrushActive) {
      const hit = this.terrainHitAt(e);
      if (!hit) return;
      this.isErasingGrass = true;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.lastPlaceTime = 0;
      this.eraseGrassAt(hit.x, hit.z);
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
    } else if (this.armedModel || this.armedMarkerKind || this.armedLightColor) {
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
    } else if (e.shiftKey) {
      // Shift+drag marquee multi-select (disabled while any paint/place tool is armed).
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
      if (this.volumeBrushStyle === "sculpt" && this.activeStroke) {
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
      if (hit) this.paintGrassPatchAt(hit.x, hit.z);
      e.preventDefault();
      e.stopPropagation();
    } else if (this.isErasingGrass && this.grassEraseBrushActive) {
      const hit = this.terrainHitAt(e);
      if (hit) this.eraseGrassAt(hit.x, hit.z);
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
    if (this.isDraggingWaypoint) {
      this.isDraggingWaypoint = false;
      this.orbit.enabled = true;
    }

    if (this.marqueeStart) {
      const start = this.marqueeStart;
      this.marqueeStart = null;
      this.onMarqueeUpdate?.(null);
      this.orbit.enabled = true;

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
    this.isGrassBrushing = false;
    this.isErasingGrass = false;
    this.isErasing = false;
    this.moldTargetHeight = null;
    this.dragStart = null;
    if (this.grassPreviewDirty) this.rebuildGrassPreview();
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
      const kind = curr.userData.editorKind as "asset" | "marker" | "light" | "volume" | undefined;
      if (kind === "asset" || kind === "marker" || kind === "light" || kind === "volume") {
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
    }
  }

  private handleSelectClick(e: MouseEvent): void {
    this.raycaster.setFromCamera(this.ndcFromEvent(e), this.camera);
    const pickable: THREE.Object3D[] = [
      ...[...this.assets.values()].map((a) => a.obj),
      ...[...this.volumes.values()].map((v) => v.obj),
      ...[...this.markers.values()].map((m) => m.obj),
      ...[...this.lights.values()].map((l) => l.obj),
    ];
    if (this.entryMarker) pickable.push(this.entryMarker.obj);
    const hits = this.raycaster.intersectObjects(pickable, true);
    if (hits.length > 0) {
      let obj: THREE.Object3D | null = hits[0]!.object;
      while (obj && !obj.userData.editorId) obj = obj.parent;
      if (obj) this.select(obj.userData.editorKind, obj.userData.editorId, e.shiftKey);
    } else if (!e.shiftKey) {
      this.deselect();
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.playtestActive) return;
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
      const step = e.shiftKey ? ARROW_PAN_STEP_FAST : ARROW_PAN_STEP;
      switch (e.key) {
        case "ArrowUp": this.panCamera(0, step); break;
        case "ArrowDown": this.panCamera(0, -step); break;
        case "ArrowLeft": this.panCamera(-step, 0); break;
        case "ArrowRight": this.panCamera(step, 0); break;
      }
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
        this.assets.set(newId, { id: newId, model: asset.model, category: asset.category, obj: newObj, groupId: newGroupId });
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
            bossType: marker.bossType,
            durationSec: marker.durationSec,
            npcData: marker.npcData ? { ...marker.npcData, id: newId } : undefined,
            targetRegionId: marker.targetRegionId,
          });
          newIds.push(newId);
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
    opts?: { groupId?: string; skipSelect?: boolean },
  ): Promise<string> {
    const id = `asset_${this.nextId++}`;
    const gltf = await load(`/assets/models/${ASSET_DIR[category]}/${model}`);
    const obj = SkeletonUtils.clone(gltf.scene);
    const defaultScale = category === "building" ? (model.startsWith("building_") || model.includes("Wall_") || model.includes("Corner_") || model.includes("Door_") || model.includes("Roof_") || model.includes("Tower_") || model.includes("House_") ? 3.8 : 1.5) : 1.0;
    const scale = scaleOverride ?? defaultScale;
    obj.scale.setScalar(scale);
    obj.position.set(x, y, z);
    obj.rotation.y = yaw;
    obj.userData.editorKind = "asset";
    obj.userData.editorId = id;
    this.scene.add(obj);
    this.assets.set(id, { id, model, category, obj, groupId: opts?.groupId });
    if (!opts?.skipSelect) {
      this.select("asset", id, false);
      this.triggerChange();
    }
    return id;
  }

  /** Generates one procedural house (see houseGen.ts) centered on the given
   *  ground point and places every returned piece as an ordinary building
   *  asset via placeAsset -- so a generated house is just a pile of normal,
   *  individually selectable/movable/erasable assets afterward, same as
   *  anything hand-placed from the palette. All pieces share one groupId so
   *  clicking any one of them selects (and therefore moves) the whole house.
   *  Each piece's `scale` is passed through as placeAsset's scaleOverride so
   *  the "building"-category default-scale heuristic never kicks in on the
   *  modular MV Wall_/Corner_/Door_/Roof_ pieces. */
  private async placeHouseAt(x: number, y: number, z: number): Promise<void> {
    const groupId = `house_${this.nextId++}`;
    const pieces = generateHouseAssets(x, z, y, { type: this.armedHouseType, groupId });
    const ids: string[] = [];
    for (const piece of pieces) {
      const id = await this.placeAsset(
        piece.model,
        piece.category,
        piece.localX,
        piece.localY,
        piece.localZ,
        piece.yaw,
        piece.scale,
        { groupId, skipSelect: true },
      );
      ids.push(id);
    }
    this.selectedIds = new Set(ids);
    this.updateSelectionGroup();
    this.triggerChange();
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
    } else {
      this.markers.set(id, entry);
    }
    this.triggerChange();
    return id;
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

    // 2. Central landmark plaza (Well / Market)
    const centerModel = Math.random() > 0.5 ? "building_well.gltf" : "building_market.gltf";
    void this.placeAsset(centerModel, "building", vx, centerH, vz, Math.random() * Math.PI * 2, 2.4);

    // 3. Ring of 5-8 Medieval Houses facing central plaza (scaled up to full imposing house size)
    const buildingModels = [
      "building_home_A.gltf", "building_home_B.gltf", "building_tavern.gltf",
      "building_blacksmith.gltf", "building_church.gltf", "building_windmill.gltf",
      "building_lumbermill.gltf", "building_tower_A.gltf", "building_grain.gltf",
    ];
    const clutterModels = [
      "barrel.gltf", "bucket_water.gltf", "crate_A_big.gltf", "crate_A_small.gltf",
      "crate_B_small.gltf", "fence_wood_straight.gltf", "fence_stone_straight.gltf",
    ];

    const houseCount = 5 + Math.floor(Math.random() * 4);
    const roadPoints: { x: number; z: number }[] = [{ x: vx, z: vz }];

    for (let b = 0; b < houseCount; b++) {
      const angle = (b / houseCount) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      const dist = 12 + Math.random() * 8;
      const bx = vx + Math.cos(angle) * dist;
      const bz = vz + Math.sin(angle) * dist;
      const model = buildingModels[Math.floor(Math.random() * buildingModels.length)]!;
      const facingYaw = angle + Math.PI + (Math.random() - 0.5) * 0.2;
      const by = this.heightAt(bx, bz);

      void this.placeAsset(model, "building", bx, by, bz, facingYaw, 3.8 + Math.random() * 0.6);
      roadPoints.push({ x: bx, z: bz });

      // Clutter & props around house
      const clutterCount = 2 + Math.floor(Math.random() * 3);
      for (let c = 0; c < clutterCount; c++) {
        const cAngle = facingYaw + (Math.random() - 0.5) * 1.5;
        const cDist = 3.5 + Math.random() * 3;
        const cx = bx + Math.cos(cAngle) * cDist;
        const cz = bz + Math.sin(cAngle) * cDist;
        const cy = this.heightAt(cx, cz);
        const cModel = clutterModels[Math.floor(Math.random() * clutterModels.length)]!;
        void this.placeAsset(cModel, "building", cx, cy, cz, Math.random() * Math.PI * 2, 1.4 + Math.random() * 0.3);
      }
    }

    // 4. Connect road path
    if (roadPoints.length >= 2) {
      this.roads.push({ points: roadPoints, width: 4.5 });
      this.scene.remove(this.terrainMesh);
      this.terrainMesh = this.buildTerrainGeometry();
      this.scene.add(this.terrainMesh);
    }

    this.triggerChange();
  }

  private select(kind: "asset" | "marker" | "light" | "volume", id: string, additive: boolean): void {
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
  private idsForSelection(kind: "asset" | "marker" | "light" | "volume", id: string): string[] {
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

    if (this.selectedIds.size === 0) {
      this.transform.detach();
      this.emitSelection();
      return;
    }

    const center = new THREE.Vector3();
    const objs: THREE.Object3D[] = [];
    for (const id of this.selectedIds) {
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
      if (!this.selectionHelpers.has(obj.userData.editorId)) {
        const helper = new THREE.BoxHelper(obj, 0x00ffaa);
        this.scene.add(helper);
        this.selectionHelpers.set(obj.userData.editorId, helper);
      }
    }
    for (const helper of this.selectionHelpers.values()) helper.update();

    this.transform.attach(this.selectionGroup);
    this.emitSelection();
  }

  private emitSelection(): void {
    if (this.selectedIds.size === 0) {
      this.onSelectionChange([]);
      return;
    }
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    const euler = new THREE.Euler();
    const worldTransform = (obj: THREE.Object3D) => {
      obj.getWorldPosition(worldPos);
      obj.getWorldQuaternion(worldQuat);
      obj.getWorldScale(worldScale);
      euler.setFromQuaternion(worldQuat);
      return { x: worldPos.x, y: worldPos.y, z: worldPos.z, yaw: euler.y, scale: worldScale.x };
    };

    const selItems: EditorSelection[] = [];
    for (const id of this.selectedIds) {
      const a = this.assets.get(id);
      if (a) {
        const t = worldTransform(a.obj);
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
          bossType: m.bossType,
          durationSec: m.durationSec,
        });
        continue;
      }
      const l = this.lights.get(id);
      if (l) {
        const t = worldTransform(l.obj);
        selItems.push({ kind: "light", id, color: l.color, intensity: l.intensity, distance: l.distance, x: t.x, y: t.y, z: t.z, yaw: 0, scale: 1 });
      }
    }
    this.onSelectionChange(selItems);
  }

  private onTransformChange = (): void => {
    if (this.selectedIds.size === 0) return;
    this.selectionGroup.updateMatrixWorld(true);
    for (const helper of this.selectionHelpers.values()) helper.update();
    for (const id of this.selectedIds) {
      const v = this.volumes.get(id);
      if (v) this.syncVolumeDataFromMesh(v);
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
      frequencyMin: number;
      difficulty: number;
      lootAmount: number;
      mobTypes: string[];
      bossType: string;
      durationSec: number;
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
        if (patch.scale !== undefined) a.obj.scale.setScalar(patch.scale);
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
      }
    }
    this.updateSelectionGroup();
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
      }
    }
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

    const euler = new THREE.Euler().setFromQuaternion(worldQuat);
    v.data.localX = worldPos.x;
    v.data.localY = worldPos.y;
    v.data.localZ = worldPos.z;
    v.data.yaw = euler.y;
    v.data.scaleX = worldScale.x;
    v.data.scaleY = worldScale.y;
    v.data.scaleZ = worldScale.z;
  }

  // ============================ load / export ============================

  clear(): void {
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
    this.texturePaintMode = null;
    this.waterBrushMode = null;
    this.customTextures = new Array(this.gridSize * this.gridSize).fill(0);
    this.waterHeights = new Float32Array(0);
    if (this.waterMeshField) {
      this.scene.remove(this.waterMeshField.mesh);
      this.waterMeshField.mesh.geometry.dispose();
      this.waterMeshField = null;
    }
    this.roadPaintArmed = false;
    this.paintingRoad = null;
    this.roads = [];
    if (this.grassField) {
      for (const mesh of this.grassField.meshes) this.scene.remove(mesh);
      this.grassField.dispose();
      this.grassField = null;
    }
    this.grassPatches = [];
    this.grassExclusions = [];
    this.grassColor = { bottom: "#4f7c13", top: "#79a01c" };
    this.wind = { direction: 0, strength: 1 };
    this.nextId = 1;
    this.onSelectionChange([]);
  }

  async loadBlueprint(bp: RegionBlueprint): Promise<void> {
    this.isRestoring = true;
    try {
      this.clear();
      this.meta = { id: bp.id, name: bp.name, biome: bp.biome, portalWorldX: bp.portalWorldX, portalWorldZ: bp.portalWorldZ, isStartingRegion: bp.isStartingRegion ?? false, musicTrack: bp.musicTrack ?? null };
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
      this.syncWaterMesh();
      this.roads = (bp.roads ?? []).map((r) => ({ points: r.points.map((p) => ({ ...p })), width: r.width }));
      this.grassPatches = (bp.grassPatches ?? []).map((p) => ({ ...p }));
      this.grassExclusions = (bp.grassExclusions ?? []).map((ex) => ({ ...ex }));
      this.grassColor = bp.grassColor ? { ...bp.grassColor } : { bottom: "#4f7c13", top: "#79a01c" };
      this.wind = bp.wind ? { ...bp.wind } : { direction: 0, strength: 1 };
      this.rebuildGrassPreview();
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
        const rawScale = asset.scale ?? 1;
        const scale = (rawScale === 1 && asset.category === "building" && (asset.model.startsWith("building_") || asset.model.includes("Wall_") || asset.model.includes("House_") || asset.model.includes("Tower_"))) ? 3.8 : rawScale;
        obj.scale.setScalar(scale);
        const id = asset.id ?? `asset_${this.nextId++}`;
        obj.userData.editorKind = "asset";
        obj.userData.editorId = id;
        this.scene.add(obj);
        this.assets.set(id, { id, model: asset.model, category: asset.category, obj, groupId: asset.groupId });
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
        this.placeMarkerAt("mobSpawn", spawn.localX, this.heightAt(spawn.localX, spawn.localZ), spawn.localZ);
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
        this.placeLight(light.localX, light.localY - 1.5, light.localZ, light.color, light.intensity, light.distance);
      }
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
    } finally {
      this.isRestoring = false;
    }
  }

  exportBlueprint(metaOverride?: Partial<{ id: string; name: string; biome: RegionBiome; portalWorldX: number; portalWorldZ: number; musicTrack: string | null }>): RegionBlueprint {
    const meta = { ...this.meta, ...metaOverride };
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    const euler = new THREE.Euler();
    const getTransform = (obj: THREE.Object3D) => {
      obj.getWorldPosition(worldPos);
      obj.getWorldQuaternion(worldQuat);
      obj.getWorldScale(worldScale);
      euler.setFromQuaternion(worldQuat);
      return { x: worldPos.x, y: worldPos.y, z: worldPos.z, yaw: euler.y, scale: worldScale.x };
    };

    const assets = [...this.assets.values()].map((a) => {
      const t = getTransform(a.obj);
      return {
        id: a.id,
        model: a.model,
        category: a.category,
        localX: t.x,
        localY: t.y,
        localZ: t.z,
        yaw: t.yaw,
        scale: t.scale,
        ...(a.groupId ? { groupId: a.groupId } : {}),
      };
    });
    const mobSpawns = [...this.markers.values()]
      .filter((m) => m.kind === "mobSpawn")
      .map((m) => {
        const t = getTransform(m.obj);
        return { localX: t.x, localZ: t.z };
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
          targetRegionId: m.targetRegionId ?? "overworld",
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
      return { id: l.id, localX: t.x, localY: t.y, localZ: t.z, color: l.color, intensity: l.intensity, distance: l.distance };
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
      mobSpawns,
      villages,
      roads: this.roads.length > 0 ? this.roads : undefined,
      grassPatches: this.grassPatches.length > 0 ? this.grassPatches : undefined,
      grassExclusions: this.grassExclusions.length > 0 ? this.grassExclusions : undefined,
      grassColor: { ...this.grassColor },
      wind: { ...this.wind },
      colorGrading: { ...this.colorGrading },
      entryLocal,
      portalWorldX: meta.portalWorldX,
      portalWorldZ: meta.portalWorldZ,
      isStartingRegion: meta.isStartingRegion ? true : undefined,
      portals: portals.length > 0 ? portals : undefined,
      npcs: npcs.length > 0 ? npcs : undefined,
      worldEvents: worldEvents.length > 0 ? worldEvents : undefined,
      lights: lights.length > 0 ? lights : undefined,
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
    if (this.grassField) {
      this.grassField.uniforms.uTime.value += dt;
      this.grassField.uniforms.uSunDir.value.copy(this.sunLight.position).sub(this.sunLight.target.position).normalize();
      this.grassField.uniforms.uSunColor.value.copy(this.sunLight.color).multiplyScalar(this.sunLight.intensity);
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.running = false;
    if (this.playtestActive) this.exitPlaytest();
    if ((this.canvas as CanvasWithScene).__regionEditorScene === this) {
      (this.canvas as CanvasWithScene).__regionEditorScene = undefined;
    }
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mouseup", this.onMouseUp);
    this.canvas.removeEventListener("mouseleave", this.onMouseUp);
    this.canvas.removeEventListener("click", this.onClick);
    window.removeEventListener("keydown", this.onKeyDown);
    this.transform.removeEventListener("objectChange", this.onTransformChange);
    this.transform.dispose();
    this.orbit.dispose();
    this.renderer.dispose();
  }
}
