import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import { load, AnimatedModel, PLAYER_ANIMS, logicalFromState } from "./gltf";
import { CLASS_MODEL_URLS } from "./classModels";
import {
  type RegionBlueprint,
  type RegionAssetCategory,
  type RegionBiome,
  type RegionColorGrading,
  type RegionRoad,
  type RegionPointLight,
  type ClassId,
  sampleRegionWaterDepth,
  REGION_COLOR_PRESETS,
  REGION_FOLIAGE,
  REGION_GRASS_COVER,
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
} from "@rustcraft/shared";
import { applyGroundBlendShader, regionGroundWeights, regionRoadBlendAt, buildRegionWaterMesh, type RegionWaterMeshField } from "./terrain";
import { music } from "../game/music";

export type EditorTransformMode = "translate" | "rotate" | "scale";
export type EditorMarkerKind = "mobSpawn" | "village" | "entry";
export type SculptMode = "raise" | "lower" | "mold" | "smooth" | null;
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
};

const ARROW_PAN_STEP = 4;
const ARROW_PAN_STEP_FAST = 16;

export interface EditorSelection {
  kind: "asset" | "marker" | "light";
  id: string;
  model?: string;
  category?: RegionAssetCategory;
  markerKind?: EditorMarkerKind;
  name?: string;
  radius?: number;
  color?: string;
  intensity?: number;
  distance?: number;
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
}

interface MarkerEntry {
  id: string;
  kind: EditorMarkerKind;
  obj: THREE.Object3D;
  name?: string;
  radius?: number;
  ring?: THREE.Mesh;
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

const DEFAULT_GRID_SIZE = 48;
const DEFAULT_PITCH = 6;

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
  private meta = { id: "", name: "New Region", biome: "grassland" as RegionBiome, portalWorldX: 0, portalWorldZ: 0, musicTrack: null as string | null };

  private gridSize = DEFAULT_GRID_SIZE;
  private pitch = DEFAULT_PITCH;
  private heights: number[] = new Array(DEFAULT_GRID_SIZE * DEFAULT_GRID_SIZE).fill(0);
  private customTextures: number[] = new Array(DEFAULT_GRID_SIZE * DEFAULT_GRID_SIZE).fill(0);
  private terrainMesh: THREE.Mesh;

  private assets = new Map<string, AssetEntry>();
  private markers = new Map<string, MarkerEntry>();
  private lights = new Map<string, LightEntry>();
  private entryMarker: MarkerEntry | null = null;

  private armedModel: { model: string; category: RegionAssetCategory } | null = null;
  private armedMarkerKind: EditorMarkerKind | null = null;
  private armedLightColor: string | null = null;
  private sculptMode: SculptMode = null;
  private texturePaintMode: number | null = null;
  private moldTargetHeight: number | null = null;
  private waterBrushMode: WaterBrushMode = null;
  private waterPhysicsSimulating = true;
  private waterHeights: Float32Array = new Float32Array(0);
  private waterMeshField: RegionWaterMeshField | null = null;
  private waterParticlesGroup = new THREE.Group();
  private waterParticles: { obj: THREE.Mesh; vel: THREE.Vector3; life: number; maxLife: number }[] = [];
  private brushRadius = 8;
  private brushStrength = 1;

  private roads: RegionRoad[] = [];
  private roadPaintArmed = false;
  private roadWidth = 4;
  /** Points collected for the road currently being dragged out; folded into
   *  this.roads on mouseup. Also factored into the live texture preview
   *  (see roadBlendAt) so the dirt strip appears while still dragging. */
  private paintingRoad: { x: number; z: number }[] | null = null;

  private selectedIds = new Set<string>();
  private selectionGroup = new THREE.Group();
  private selectionHelpers = new Map<string, THREE.BoxHelper>();
  private nextId = 1;

  private isDraggingToPlace = false;
  private isSculpting = false;
  private isWatering = false;
  private isTexturePainting = false;
  private isTreeBrushing = false;
  private randomTreeBrushActive = false;
  private isGrassBrushing = false;
  private grassBrushActive = false;
  private grassBrushModel: string | null = null;
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
  ) {
    // Guard against two live instances ever listening on the same canvas at
    // once (e.g. a leftover instance from a Vite HMR reload that never got
    // disposed) -- see DungeonEditorScene's identical guard for the exact
    // failure mode this prevents.
    const stale = (canvas as CanvasWithScene).__regionEditorScene;
    if (stale) stale.dispose();
    (canvas as CanvasWithScene).__regionEditorScene = this;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 800);
    this.camera.position.set(60, 60, 60);

    this.scene.add(this.ambientLight);
    this.sunLight.position.set(80, 100, 40);
    this.scene.add(this.sunLight);
    this.scene.fog = new THREE.FogExp2(0xbcd9f0, 0.006);

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

  private sculptAt(hitX: number, hitZ: number, mode: SculptMode): void {
    if (!mode) return;
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
    this.triggerChange();
  }

  setTexturePaintMode(mode: number | null): void {
    this.texturePaintMode = mode;
    if (mode !== null) {
      this.armedModel = null;
      this.armedMarkerKind = null;
      this.armedLightColor = null;
      this.sculptMode = null;
      this.waterBrushMode = null;
      this.randomTreeBrushActive = false;
      this.grassBrushActive = false;
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
      this.armedLightColor = null;
      this.texturePaintMode = null;
      this.waterBrushMode = null;
      this.randomTreeBrushActive = false;
      this.grassBrushActive = false;
      this.eraseBrushActive = false;
      this.roadPaintArmed = false;
      this.transform.detach();
      this.deselect();
    }
    this.orbit.enablePan = !mode;
  }

  armLightPlacement(color = "#ff9933"): void {
    this.armedModel = null;
    this.armedMarkerKind = null;
    this.armedLightColor = color;
    this.sculptMode = null;
    this.texturePaintMode = null;
    this.waterBrushMode = null;
    this.randomTreeBrushActive = false;
    this.grassBrushActive = false;
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
  }

  setBrushStrength(s: number): void {
    this.brushStrength = Math.max(0.1, s);
  }

  // ============================ road painting ============================

  armRoadPainting(): void {
    this.armedModel = null;
    this.armedMarkerKind = null;
    this.sculptMode = null;
    this.waterBrushMode = null;
    this.randomTreeBrushActive = false;
    this.grassBrushActive = false;
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
      this.sculptMode = null;
      this.randomTreeBrushActive = false;
      this.grassBrushActive = false;
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
      this.sculptMode = null;
      this.waterBrushMode = null;
      this.roadPaintArmed = false;
      this.grassBrushActive = false;
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
      this.sculptMode = null;
      this.waterBrushMode = null;
      this.roadPaintArmed = false;
      this.randomTreeBrushActive = false;
      this.eraseBrushActive = false;
      this.transform.detach();
      this.deselect();
    }
    this.orbit.enablePan = !active;
  }

  setGrassBrushModel(model: string | null): void {
    this.grassBrushModel = model;
  }

  setEraseBrush(active: boolean): void {
    this.eraseBrushActive = active;
    if (active) {
      this.armedModel = null;
      this.armedMarkerKind = null;
      this.armedLightColor = null;
      this.sculptMode = null;
      this.waterBrushMode = null;
      this.texturePaintMode = null;
      this.roadPaintArmed = false;
      this.randomTreeBrushActive = false;
      this.grassBrushActive = false;
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

  private scatterGrassAt(hitX: number, hitZ: number): void {
    const now = performance.now();
    if (now - this.lastPlaceTime < 240) return;
    this.lastPlaceTime = now;

    const grassList = REGION_GRASS_COVER[this.meta.biome] ?? REGION_GRASS_COVER.grassland;
    const grassCount = Math.max(1, Math.floor(this.brushStrength * 6));

    for (let i = 0; i < grassCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * this.brushRadius;
      const gx = hitX + Math.cos(angle) * dist;
      const gz = hitZ + Math.sin(angle) * dist;

      const waterDepth = this.sampleWaterDepth(gx, gz);
      if (waterDepth > 0.05) continue;

      const gy = this.heightAt(gx, gz);
      const grassModel = this.grassBrushModel ?? grassList[Math.floor(Math.random() * grassList.length)]!;
      const yaw = Math.random() * Math.PI * 2;
      const scale = 0.7 + Math.random() * 0.5;

      void this.placeAsset(grassModel, "foliage", gx, gy, gz, yaw, scale);
    }
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

  setMeta(patch: Partial<{ id: string; name: string; biome: RegionBiome; portalWorldX: number; portalWorldZ: number; musicTrack: string | null }>): void {
    this.meta = { ...this.meta, ...patch };
    if (patch.musicTrack !== undefined && this.playtestActive) {
      music.play(regionMusicTrackUrl(this.meta.musicTrack), 3000);
    }
  }

  getMeta(): { id: string; name: string; biome: RegionBiome; portalWorldX: number; portalWorldZ: number; musicTrack: string | null } {
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
    model.group.visible = false;
    this.scene.add(model.group);
    await model.loadFrom(CLASS_MODEL_URLS[classId], RegionEditorScene.PLAYTEST_AVATAR_HEIGHT);
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

  // ============================ placement arming ============================

  armPlacement(model: string, category: RegionAssetCategory): void {
    this.armedMarkerKind = null;
    this.sculptMode = null;
    this.roadPaintArmed = false;
    this.armedModel = { model, category };
    this.orbit.enablePan = false;
    this.transform.detach();
  }

  armMarkerPlacement(kind: EditorMarkerKind): void {
    this.armedModel = null;
    this.sculptMode = null;
    this.roadPaintArmed = false;
    this.armedMarkerKind = kind;
    this.orbit.enablePan = false;
    this.transform.detach();
  }

  disarm(): void {
    this.armedModel = null;
    this.armedMarkerKind = null;
    this.armedLightColor = null;
    this.sculptMode = null;
    this.waterBrushMode = null;
    this.texturePaintMode = null;
    this.randomTreeBrushActive = false;
    this.grassBrushActive = false;
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
      this.sculptMode !== null ||
      this.waterBrushMode !== null ||
      this.texturePaintMode !== null ||
      this.randomTreeBrushActive ||
      this.grassBrushActive ||
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

  private onMouseDown = (e: MouseEvent): void => {
    if (this.playtestActive) return;
    if (e.button !== 0) return;
    if (this.transform.dragging) return; // grabbing the gizmo, not placing/sculpting/painting
    if (this.sculptMode) {
      const hit = this.terrainHitAt(e);
      if (!hit) return;
      this.isSculpting = true;
      this.moldTargetHeight = hit.y;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.sculptAt(hit.x, hit.z, this.sculptMode);
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
      this.scatterGrassAt(hit.x, hit.z);
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
    }
  };

  private onClick = (e: MouseEvent): void => {
    if (this.playtestActive) return;
    if (!this.isArmed) this.handleSelectClick(e);
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.playtestActive) return;
    if (this.isSculpting && this.sculptMode) {
      const hit = this.terrainHitAt(e);
      if (hit) this.sculptAt(hit.x, hit.z, this.sculptMode);
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
      if (hit) this.scatterGrassAt(hit.x, hit.z);
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
    }
  };

  private onMouseUp = (): void => {
    this.isDraggingToPlace = false;
    this.isSculpting = false;
    this.isWatering = false;
    this.isTexturePainting = false;
    this.isTreeBrushing = false;
    this.isGrassBrushing = false;
    this.isErasing = false;
    this.moldTargetHeight = null;
    this.dragStart = null;
    if (this.paintingRoad) {
      if (this.paintingRoad.length >= 2) {
        this.roads.push({ points: this.paintingRoad, width: this.roadWidth });
      }
      this.paintingRoad = null;
      this.triggerChange();
    }
  };

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
        this.assets.set(newId, { id: newId, model: asset.model, category: asset.category, obj: newObj });
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
          this.markers.set(newId, { id: newId, kind: marker.kind, obj: newObj, name: marker.name, radius: marker.radius });
          newIds.push(newId);
        }
      }
    }
    return newIds;
  }

  // ============================ assets / markers ============================

  private async placeAsset(model: string, category: RegionAssetCategory, x: number, y: number, z: number, yaw: number, scaleOverride?: number): Promise<void> {
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
    this.assets.set(id, { id, model, category, obj });
    this.select("asset", id, false);
    this.triggerChange();
  }

  private buildVillageRing(radius: number): THREE.Mesh {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(0.5, radius - 0.4), radius, 32),
      new THREE.MeshBasicMaterial({ color: MARKER_COLORS.village, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
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
    } else {
      this.markers.set(id, entry);
    }
    this.triggerChange();
    return id;
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

  private select(kind: "asset" | "marker" | "light", id: string, additive: boolean): void {
    if (!additive) this.selectedIds.clear();
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
    this.updateSelectionGroup();
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
      const entry = this.assets.get(id) ?? this.markers.get(id) ?? this.lights.get(id) ?? (id === "entry" ? this.entryMarker : null);
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
        selItems.push({ kind: "asset", id, model: a.model, category: a.category, x: t.x, y: t.y, z: t.z, yaw: t.yaw, scale: t.scale });
        continue;
      }
      const m = id === "entry" ? this.entryMarker : this.markers.get(id);
      if (m) {
        const t = worldTransform(m.obj);
        selItems.push({ kind: "marker", id, markerKind: m.kind, x: t.x, y: t.y, z: t.z, yaw: t.yaw, scale: t.scale, name: m.name, radius: m.radius });
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
    this.triggerChange();
    this.emitSelection();
  };

  updateSelectedProps(patch: Partial<{ x: number; y: number; z: number; yaw: number; scale: number; name: string; radius: number; color: string; intensity: number; distance: number }>): void {
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
      const m = id === "entry" ? this.entryMarker : this.markers.get(id);
      if (m) {
        if (patch.x !== undefined) m.obj.position.x = patch.x;
        if (patch.y !== undefined) m.obj.position.y = patch.y;
        if (patch.z !== undefined) m.obj.position.z = patch.z;
        if (patch.name !== undefined) m.name = patch.name;
        if (patch.radius !== undefined && m.kind === "village") {
          m.radius = patch.radius;
          if (m.ring) {
            m.obj.remove(m.ring);
            m.ring.geometry.dispose();
          }
          m.ring = this.buildVillageRing(patch.radius);
          m.obj.add(m.ring);
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
      if (mesh.isMesh) mesh.geometry?.dispose();
    });
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
    this.markers.clear();
    this.lights.clear();
    this.entryMarker = null;
    this.selectedIds.clear();
    this.armedModel = null;
    this.armedMarkerKind = null;
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
    this.nextId = 1;
    this.onSelectionChange([]);
  }

  async loadBlueprint(bp: RegionBlueprint): Promise<void> {
    this.isRestoring = true;
    try {
      this.clear();
      this.meta = { id: bp.id, name: bp.name, biome: bp.biome, portalWorldX: bp.portalWorldX, portalWorldZ: bp.portalWorldZ, musicTrack: bp.musicTrack ?? null };
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
        this.assets.set(id, { id, model: asset.model, category: asset.category, obj });
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
      return { id: a.id, model: a.model, category: a.category, localX: t.x, localY: t.y, localZ: t.z, yaw: t.yaw, scale: t.scale };
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
    const lights = [...this.lights.values()].map((l) => {
      const t = getTransform(l.obj);
      return { id: l.id, localX: t.x, localY: t.y, localZ: t.z, color: l.color, intensity: l.intensity, distance: l.distance };
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
      waterHeights: Array.from(this.waterHeights),
      customTextures: [...this.customTextures],
      assets,
      mobSpawns,
      villages,
      lights,
      roads: [...this.roads],
      colorGrading: { ...this.colorGrading },
      entryLocal,
      portalWorldX: meta.portalWorldX,
      portalWorldZ: meta.portalWorldZ,
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
    this.stepWaterPhysics(dt);
    this.updateWaterParticles(dt);
    this.waterMeshField?.update(dt);
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
