import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { SelectionBox } from "three/examples/jsm/interactive/SelectionBox.js";
import { SkeletonUtils } from "three/examples/jsm/Addons.js";
import { load } from "./gltf";
import {
  type DungeonAsset,
  type DungeonBlueprint,
  dungeonCellCenter,
  dungeonSnapToTile,
  DUNGEON_PITCH,
  DUNGEON_HALF,
  DUNGEON_GRID_SIZE,
} from "@rustcraft/shared";
import { STAIRS_RISE_DEFAULTS, DEFAULT_STAIRS_RISE } from "./dungeonPropPalette";

export type EditorTransformMode = "translate" | "rotate" | "scale";
export type EditorMarkerKind = "mobSpawn" | "chest" | "entry";

type CanvasWithScene = HTMLCanvasElement & { __dungeonEditorScene?: DungeonEditorScene };

export interface EditorSelection {
  kind: "asset" | "marker";
  id: string;
  model?: string;
  markerKind?: EditorMarkerKind;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  rise?: number;
  rarity?: "common" | "rare";
}

interface AssetEntry {
  id: string;
  model: string;
  obj: THREE.Object3D;
  rise?: number;
}

interface MarkerEntry {
  id: string;
  kind: EditorMarkerKind;
  obj: THREE.Object3D;
  rarity?: "common" | "rare";
}

const MARKER_COLORS: Record<EditorMarkerKind, number> = {
  mobSpawn: 0xff5533,
  chest: 0xffd23f,
  entry: 0x44dd66,
};

const isFloorOrStairs = (model: string) => model.startsWith("floor_") || model.startsWith("stairs_");

const ARROW_PAN_STEP = DUNGEON_HALF;
const ARROW_PAN_STEP_FAST = DUNGEON_PITCH * 2;

/** Standalone THREE.js scene for the hand-built dungeon editor -- an
 *  OrbitControls-driven top-down/orbit viewport where the author places
 *  KayKit prop instances (walls/floors/stairs/decor) and simple gameplay
 *  markers (mob spawn / chest / entry point), then exports the result as a
 *  DungeonBlueprint. Modeled on ClassPreviewScene.ts's shell (own renderer/
 *  camera/resize/frame-loop/dispose) with OrbitControls + TransformControls
 *  + a Raycaster added for editing. */
export class DungeonEditorScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private orbit: OrbitControls;
  private transform: TransformControls;
  private raycaster = new THREE.Raycaster();
  private groundPlane: THREE.Mesh;
  private running = true;
  private lastFrame = performance.now();

  private assets = new Map<string, AssetEntry>();
  private markers = new Map<string, MarkerEntry>();
  private entryMarker: MarkerEntry | null = null;

  private armedModel: string | null = null;
  private armedMarkerKind: EditorMarkerKind | null = null;
  private selectedIds = new Set<string>();
  private selectionGroup = new THREE.Group();
  private selectionHelpers = new Map<string, THREE.BoxHelper>();
  private snapEnabled = true;
  private nextId = 1;

  private isDraggingToPaint = false;
  private paintDragStart: { x: number; y: number } | null = null;
  private placingCells = new Set<string>();
  private isRestoring = false;
  private dragStartPos = new THREE.Vector3();
  private dragStartRot = new THREE.Euler();
  
  private shiftDown = false;
  private cmdDown = false;

  private lastMarqueeEnd = 0;
  private lastDragEnd = 0;
  
  private history: string[] = [];
  private historyIndex = -1;

  private selectionBox: SelectionBox;
  private marqueeStart: { x: number; y: number } | null = null;
  private onMarqueeUpdate?: (box: { startX: number; startY: number; endX: number; endY: number } | null) => void;

  constructor(
    private canvas: HTMLCanvasElement,
    private onSelectionChange: (sel: EditorSelection[]) => void,
    private onChange?: () => void,
    onMarquee?: (box: { startX: number; startY: number; endX: number; endY: number } | null) => void
  ) {
    // Guard against two live instances ever listening on the same canvas at
    // once (e.g. a leftover instance from a Vite HMR reload that never got
    // disposed) -- each independently-owned `assets` map would then have no
    // way to see the other's placements, so painting a tile via one instance
    // wouldn't block the other from placing a duplicate on top of it.
    const stale = (canvas as CanvasWithScene).__dungeonEditorScene;
    if (stale) stale.dispose();
    (canvas as CanvasWithScene).__dungeonEditorScene = this;

    this.onMarqueeUpdate = onMarquee;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
    this.camera.position.set(30, 40, 30);

    this.scene.background = new THREE.Color(0x1a1d24);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.3));
    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(40, 60, 20);
    this.scene.add(sun);

    const span = DUNGEON_PITCH * DUNGEON_GRID_SIZE;
    const grid = new THREE.GridHelper(span, DUNGEON_GRID_SIZE, 0x5a6172, 0x33384a);
    this.scene.add(grid);
    
    this.selectionBox = new SelectionBox(this.camera, this.scene);

    this.groundPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.scene.add(this.groundPlane);
    this.scene.add(this.selectionGroup);

    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.target.set(0, 0, 0);
    this.orbit.mouseButtons = {
      LEFT: THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE
    };
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
        this.lastDragEnd = performance.now();
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
    canvas.addEventListener("dblclick", this.onDoubleClick);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("pointerdown", this.trackModifiers, { capture: true });
    window.addEventListener("pointermove", this.trackModifiers, { capture: true });
    window.addEventListener("blur", this.clearModifiers);

    this.resize();
    requestAnimationFrame(this.frame);
  }

  initHistory(): void {
    this.history = [];
    this.historyIndex = -1;
    this.pushHistory();
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
      const snap = JSON.parse(this.history[this.historyIndex]!) as DungeonBlueprint;
      void this.loadBlueprint(snap).then(() => {
        this.onChange?.();
      });
    }
  }

  redo(): void {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      const snap = JSON.parse(this.history[this.historyIndex]!) as DungeonBlueprint;
      void this.loadBlueprint(snap).then(() => {
        this.onChange?.();
      });
    }
  }

  private triggerChange(): void {
    if (!this.isRestoring) {
      this.pushHistory();
      this.onChange?.();
    }
  }

  resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Pans camera + orbit target together across the ground plane -- dx moves
   *  left/right along the camera's own right axis, dz moves forward/back
   *  along the camera's view direction flattened onto the XZ plane (Y
   *  component dropped) so up/back arrows walk across the floor instead of
   *  climbing/diving with the camera's pitch. Camera height stays fixed. */
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

  setSnapEnabled(v: boolean): void {
    this.snapEnabled = v;
  }

  armPlacement(model: string): void {
    this.armedMarkerKind = null;
    this.armedModel = model;
    this.orbit.enablePan = false;
    this.transform.detach();
  }

  armMarkerPlacement(kind: EditorMarkerKind): void {
    this.armedModel = null;
    this.armedMarkerKind = kind;
    this.orbit.enablePan = false;
    this.transform.detach();
  }

  disarm(): void {
    this.armedModel = null;
    this.armedMarkerKind = null;
    this.orbit.enablePan = true;
  }

  get isArmed(): boolean {
    return this.armedModel !== null || this.armedMarkerKind !== null;
  }

  private ndcFromEvent(e: MouseEvent): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return; // left click only
    if (this.transform.dragging) return; // grabbing the gizmo handle, not painting
    if (this.isArmed) {
      // Engage continuous drag-painting regardless of Shift -- paintAtEvent
      // itself branches per-event on the *live* shift state (place vs.
      // erase), so holding Shift down through the whole drag erases a line
      // of tiles and releasing it mid-drag switches back to placing. This
      // used to only engage when Shift was already held at mousedown, which
      // meant a plain drag (no Shift) placed nothing until mouseup and could
      // never paint more than one tile per gesture.
      this.isDraggingToPaint = true;
      this.paintDragStart = { x: e.clientX, y: e.clientY };
      this.paintAtEvent(e);
      e.preventDefault();
      e.stopPropagation();
    } else if (this.cmdDown) {
      this.marqueeStart = { x: e.clientX, y: e.clientY };
      this.orbit.enabled = false;
    }
  };

  private onClick = (e: MouseEvent): void => {
    if (performance.now() - this.lastMarqueeEnd < 100) return;
    if (performance.now() - this.lastDragEnd < 100) return;
    if (!this.isArmed) {
      this.handleSelectClick(e);
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (this.isDraggingToPaint && this.isArmed) {
      // Only re-paint once the cursor has actually left the mousedown
      // position by a real distance -- without this, a genuine stationary
      // click (which still often dispatches a sub-pixel-jiggle mousemove
      // between mousedown and mouseup) would call paintAtEvent a second
      // time and, if that jiggle happened to nudge the raycast hit across a
      // half-tile grid boundary, place a second, distinct-but-adjacent copy
      // right next to the first for what the user experienced as one click.
      const dragged = this.paintDragStart
        ? Math.hypot(e.clientX - this.paintDragStart.x, e.clientY - this.paintDragStart.y) > 4
        : true;
      if (dragged) this.paintAtEvent(e);
      e.preventDefault();
      e.stopPropagation();
    } else if (this.marqueeStart) {
      this.onMarqueeUpdate?.({
        startX: this.marqueeStart.x,
        startY: this.marqueeStart.y,
        endX: e.clientX,
        endY: e.clientY,
      });
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    this.isDraggingToPaint = false;
    this.paintDragStart = null;

    if (this.marqueeStart) {
      const start = this.marqueeStart;
      const end = { x: e.clientX, y: e.clientY };
      this.marqueeStart = null;
      this.onMarqueeUpdate?.(null);
      this.orbit.enabled = true;

      const dist = Math.hypot(end.x - start.x, end.y - start.y);
      if (dist > 5) {
        this.lastMarqueeEnd = performance.now();
        const rect = this.canvas.getBoundingClientRect();
        this.selectionBox.startPoint.set(
          ((start.x - rect.left) / rect.width) * 2 - 1,
          -((start.y - rect.top) / rect.height) * 2 + 1,
          0.5
        );
        this.selectionBox.endPoint.set(
          ((end.x - rect.left) / rect.width) * 2 - 1,
          -((end.y - rect.top) / rect.height) * 2 + 1,
          0.5
        );

        const selected = this.selectionBox.select();
        const idsToAdd = new Set<string>();
        for (let obj of selected) {
          let curr: THREE.Object3D | null = obj;
          while (curr && !curr.userData.editorId) curr = curr.parent;
          if (curr && curr.userData.editorId) {
            idsToAdd.add(curr.userData.editorId);
          }
        }

        if (idsToAdd.size > 0) {
          if (!e.shiftKey && !e.ctrlKey && !e.metaKey) this.selectedIds.clear();
          for (const id of idsToAdd) {
            this.selectedIds.add(id);
          }
          this.updateSelectionGroup();
        }
      }
    }
  };

  private onDoubleClick = (e: MouseEvent): void => {
    this.raycaster.setFromCamera(this.ndcFromEvent(e), this.camera);
    const pickable: THREE.Object3D[] = [
      this.groundPlane,
      ...[...this.assets.values()].map((a) => a.obj),
      ...[...this.markers.values()].map((m) => m.obj),
    ];
    if (this.entryMarker) pickable.push(this.entryMarker.obj);

    const hits = this.raycaster.intersectObjects(pickable, true);
    if (hits.length > 0) {
      const hitPoint = hits[0]!.point;
      this.orbit.target.copy(hitPoint);
      this.orbit.update();
    }
  };

  private paintAtEvent(e: MouseEvent): void {
    this.raycaster.setFromCamera(this.ndcFromEvent(e), this.camera);

    if (e.shiftKey) {
      const pickable: THREE.Object3D[] = [
        ...[...this.assets.values()].map((a) => a.obj),
        ...[...this.markers.values()].map((m) => m.obj),
      ];
      if (this.entryMarker) pickable.push(this.entryMarker.obj);

      const hits = this.raycaster.intersectObjects(pickable, true);
      if (hits.length > 0) {
        let obj: THREE.Object3D | null = hits[0]!.object;
        while (obj && !obj.userData.editorId) obj = obj.parent;
        if (obj) {
          this.select(obj.userData.editorKind, obj.userData.editorId, false);
          this.deleteSelected();
        }
      }
      return;
    }

    const hit = this.raycaster.intersectObject(this.groundPlane, false)[0];
    if (!hit) return;

    const x = hit.point.x;
    const z = hit.point.z;
    const y = 0;

    const tx = dungeonSnapToTile(x);
    const tz = dungeonSnapToTile(z);
    const cellKey = `${tx}_${tz}`;

    if (this.armedModel) {
      // Snap to the exact position placeAsset will use *before* checking
      // for a duplicate, and compare against existing assets' exact
      // positions -- not a re-derived tile index. Floor/stairs pieces snap
      // to the 4-unit tile-center grid, but decorative props snap to the
      // finer 2-unit half-tile grid; comparing both against the coarser
      // tile index collapsed several distinct valid half-tile positions
      // (e.g. x=4, x=6, x=8) into "the same cell", so an existing prop at
      // one of those spots didn't block placing another prop at a
      // different half-tile spot that happened to snap to the identical
      // final position -- two placements landing exactly on top of each
      // other, invisibly, since the coarse check said "different cell".
      const snapped = this.snapPositionFor(this.armedModel, x, z);
      const uniqueKey = `${this.armedModel}_${snapped.x}_${snapped.z}`;
      if (this.placingCells.has(uniqueKey)) return;

      const exists = [...this.assets.values()].some((a) => {
        if (a.model !== this.armedModel) return false;
        const p = this.worldXZ(a.obj);
        return p.x === snapped.x && p.z === snapped.z;
      });
      if (!exists) {
        this.placingCells.add(uniqueKey);
        this.placeAsset(this.armedModel, snapped.x, y, snapped.z).finally(() => {
          this.placingCells.delete(uniqueKey);
        });
      }
    } else if (this.armedMarkerKind) {
      const uniqueKey = `${this.armedMarkerKind}_${cellKey}`;
      if (this.placingCells.has(uniqueKey)) return;

      const exists = [...this.markers.values()].some((m) => {
        if (m.kind !== this.armedMarkerKind) return false;
        const p = this.worldXZ(m.obj);
        return dungeonSnapToTile(p.x) === tx && dungeonSnapToTile(p.z) === tz;
      });
      if (!exists && this.armedMarkerKind !== "entry") {
        this.placingCells.add(uniqueKey);
        const id = this.placeMarkerAt(this.armedMarkerKind, x, y, z);
        this.select("marker", id, false);
        this.placingCells.delete(uniqueKey);
      } else if (this.armedMarkerKind === "entry") {
        this.placingCells.add(uniqueKey);
        const id = this.placeMarkerAt(this.armedMarkerKind, x, y, z);
        this.select("marker", id, false);
        this.placingCells.delete(uniqueKey);
      }
    }
  }

  private handleSelectClick(e: MouseEvent): void {
    this.raycaster.setFromCamera(this.ndcFromEvent(e), this.camera);
    const pickable: THREE.Object3D[] = [
      ...[...this.assets.values()].map((a) => a.obj),
      ...[...this.markers.values()].map((m) => m.obj),
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

  private trackModifiers = (e: PointerEvent | MouseEvent): void => {
    this.shiftDown = e.shiftKey;
    this.cmdDown = e.metaKey || e.ctrlKey;
  };

  private clearModifiers = (): void => {
    this.shiftDown = false;
    this.cmdDown = false;
  };

  private clipboardIds: Set<string> = new Set();

  private onKeyDown = (e: KeyboardEvent): void => {
    this.shiftDown = e.shiftKey;
    this.cmdDown = e.metaKey || e.ctrlKey;

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
      // Paste from the clipboard snapshot, not the live selection -- unlike
      // Cmd/Ctrl+D this must keep working after the selection changes (or is
      // cleared entirely) between copy and paste.
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
      // Explicit duplicate shortcut (matches Blender/Unity convention). This
      // replaces the old "duplicate if Shift+Cmd happen to be held when you
      // grab the gizmo" behavior, which fired on the very first pointerdown
      // of a drag regardless of whether the drag actually moved anything --
      // a plain click (or a marquee-select that left Shift+Cmd still down)
      // silently produced an exact duplicate stacked on the original.
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

  /** Clones each given asset/marker (skipping the singleton entry marker,
   *  which can never have more than one instance), offset one tile over so
   *  the copy isn't hidden directly under the original. Shared by the
   *  Cmd/Ctrl+D duplicate shortcut and Cmd/Ctrl+V paste -- paste differs only
   *  in that its id list comes from a persisted clipboard snapshot rather
   *  than the current live selection. */
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
        newObj.position.x += DUNGEON_PITCH;
        this.assets.set(newId, {
          id: newId,
          model: asset.model,
          obj: newObj,
          rise: asset.rise,
        });
        newIds.push(newId);
      } else {
        const marker = this.markers.get(id) || (id === "entry" ? this.entryMarker : null);
        if (marker && marker.kind !== "entry") {
           const newId = `marker_${this.nextId++}`;
           const newObj = marker.obj.clone();
           newObj.userData.editorKind = "marker";
           newObj.userData.editorId = newId;
           this.scene.add(newObj);
           marker.obj.getWorldPosition(newObj.position);
           marker.obj.getWorldQuaternion(newObj.quaternion);
           marker.obj.getWorldScale(newObj.scale);
           newObj.position.x += DUNGEON_PITCH;
           this.markers.set(newId, {
             id: newId,
             kind: marker.kind,
             obj: newObj,
             rarity: marker.rarity,
           });
           newIds.push(newId);
        }
      }
    }
    return newIds;
  }

  /** Canonical snap for a model at a raw world (x,z) -- floor/stairs pieces
   *  always land on a true DUNGEON_PITCH tile center; other props snap to
   *  the finer DUNGEON_HALF grid when snapping is enabled. Callers that need
   *  to check "is there already something here" MUST snap first and compare
   *  against this exact result -- comparing against a coarser re-derived
   *  tile index let two different valid snap points collapse onto the same
   *  final position without the dedup check ever noticing. */
  private scratchWorldPos = new THREE.Vector3();

  /**
   * World-space x/z of an object -- NOT the same as obj.position.x/z once an
   * object has been selected: select() reparents it into selectionGroup for
   * the transform gizmo, which turns .position into a LOCAL offset from the
   * group. Placing a tile auto-selects it, so the very next paint event
   * (e.g. the next mousemove sample of the same drag, often still inside
   * the same grid cell) would compare a stale local-space value against a
   * freshly-snapped world-space one, never match, and place a duplicate
   * directly on top of the tile that's still selected.
   */
  private worldXZ(obj: THREE.Object3D): { x: number; z: number } {
    obj.getWorldPosition(this.scratchWorldPos);
    return { x: this.scratchWorldPos.x, z: this.scratchWorldPos.z };
  }

  private snapPositionFor(model: string, x: number, z: number): { x: number; z: number } {
    if (isFloorOrStairs(model)) {
      return { x: dungeonCellCenter(dungeonSnapToTile(x)), z: dungeonCellCenter(dungeonSnapToTile(z)) };
    }
    if (this.snapEnabled) {
      return { x: Math.round(x / DUNGEON_HALF) * DUNGEON_HALF, z: Math.round(z / DUNGEON_HALF) * DUNGEON_HALF };
    }
    return { x, z };
  }

  /** x/z must already be snapped (see snapPositionFor) -- placed as-is. */
  private async placeAsset(model: string, x: number, y: number, z: number): Promise<void> {
    const id = `asset_${this.nextId++}`;
    const gltf = await load(`/assets/models/props/${model}`);
    const obj = SkeletonUtils.clone(gltf.scene);
    obj.position.set(x, y, z);
    obj.userData.editorKind = "asset";
    obj.userData.editorId = id;
    this.scene.add(obj);
    const rise = model.startsWith("stairs_") ? (STAIRS_RISE_DEFAULTS[model] ?? DEFAULT_STAIRS_RISE) : undefined;
    this.assets.set(id, { id, model, obj, rise });
    this.select("asset", id, false);
    this.triggerChange();
  }

  private placeMarkerAt(kind: EditorMarkerKind, x: number, y: number, z: number, rarity: "common" | "rare" = "common"): string {
    if (kind === "chest") {
      const id = `marker_${this.nextId++}`;
      const group = new THREE.Group();
      group.userData.editorKind = "marker";
      group.userData.editorId = id;
      group.position.set(x, y + 0.5, z);
      this.scene.add(group);
      
      const modelFile = rarity === "rare" ? "chest_gold.gltf" : "chest.gltf";
      load(`/assets/models/props/${modelFile}`).then((gltf) => {
        const clone = SkeletonUtils.clone(gltf.scene);
        clone.scale.set(1.2, 1.2, 1.2);
        clone.position.set(0, -0.5, 0);
        group.add(clone);
      });
      
      this.markers.set(id, { id, kind, obj: group, rarity });
      this.triggerChange();
      return id;
    }

    const geo = kind === "entry" ? new THREE.ConeGeometry(0.6, 1.4, 12) : new THREE.SphereGeometry(0.5, 12, 10);
    const mat = new THREE.MeshBasicMaterial({ color: MARKER_COLORS[kind] });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + 0.5, z);

    if (kind === "entry") {
      if (this.entryMarker) {
        this.scene.remove(this.entryMarker.obj);
        this.disposeObject(this.entryMarker.obj);
      }
      mesh.userData.editorKind = "marker";
      mesh.userData.editorId = "entry";
      this.scene.add(mesh);
      this.entryMarker = { id: "entry", kind, obj: mesh };
      this.triggerChange();
      return "entry";
    }

    const id = `marker_${this.nextId++}`;
    mesh.userData.editorKind = "marker";
    mesh.userData.editorId = id;
    this.scene.add(mesh);
    this.markers.set(id, { id, kind, obj: mesh, rarity: undefined });
    this.triggerChange();
    return id;
  }

  private select(kind: "asset" | "marker", id: string, additive: boolean): void {
    if (!additive) {
      this.selectedIds.clear();
    }
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
    this.updateSelectionGroup();
  }

  private deselect(): void {
    this.selectedIds.clear();
    this.updateSelectionGroup();
  }

  private updateSelectionGroup(): void {
    // Return all children to scene with absolute world positions
    for (const obj of [...this.selectionGroup.children]) {
      this.scene.attach(obj);
      // Look up the real model from the assets map -- obj.userData only ever
      // carries editorKind/editorId, never a model string, so checking
      // userData directly here always missed and silently fell through to
      // the coarser half-tile snap below for every floor/stairs piece.
      const assetModel = this.assets.get(obj.userData.editorId)?.model ?? "";
      if (isFloorOrStairs(assetModel) && this.snapEnabled) {
         obj.position.x = dungeonCellCenter(dungeonSnapToTile(obj.position.x));
         obj.position.z = dungeonCellCenter(dungeonSnapToTile(obj.position.z));
         const quarter = Math.round(obj.rotation.y / (Math.PI / 2));
         obj.rotation.y = quarter * (Math.PI / 2);
      } else if (this.snapEnabled) {
         obj.position.x = Math.round(obj.position.x / DUNGEON_HALF) * DUNGEON_HALF;
         obj.position.z = Math.round(obj.position.z / DUNGEON_HALF) * DUNGEON_HALF;
         const quarter = Math.round(obj.rotation.y / (Math.PI / 2));
         obj.rotation.y = quarter * (Math.PI / 2);
      }
    }

    if (this.selectedIds.size === 0) {
      this.transform.detach();
      this.emitSelection();
      return;
    }

    const center = new THREE.Vector3();
    const objs: THREE.Object3D[] = [];
    for (const id of this.selectedIds) {
      const entry = this.assets.get(id) ?? this.markers.get(id) ?? (id === "entry" ? this.entryMarker : null);
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

    // Let TransformControls manage translationSnap seamlessly instead of manual jumping
    if (objs.length === 1) {
      center.copy(objs[0]!.position);
    }

    this.selectionGroup.position.copy(center);
    this.selectionGroup.rotation.set(0, 0, 0);
    this.selectionGroup.scale.set(1, 1, 1);

    // Sync helpers
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

    // Ensure all helpers update to current positions
    for (const helper of this.selectionHelpers.values()) {
      helper.update();
    }

    this.transform.attach(this.selectionGroup);
    this.emitSelection();
  }

  private emitSelection(): void {
    if (this.selectedIds.size === 0) {
      this.onSelectionChange([]);
      return;
    }
    // Selected objects are parented under selectionGroup while selected (so
    // the transform gizmo can move/rotate/scale them together), which means
    // obj.position/.rotation/.scale are LOCAL to that group, not world
    // space -- reading them directly here used to show (0,0,0) for a single
    // selection (the group is re-centered on the object, so its local
    // offset from the group is exactly zero) and a nonsense offset for
    // multi-selections. Read world transforms instead, same as
    // exportBlueprint() already does correctly.
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
          kind: "asset", id, model: a.model, x: t.x, y: t.y, z: t.z,
          yaw: t.yaw, scale: t.scale, rise: a.model.startsWith("stairs_") ? (a.rise ?? DEFAULT_STAIRS_RISE) : undefined
        });
      } else {
        const m = id === "entry" ? this.entryMarker : this.markers.get(id);
        if (m) {
          const t = worldTransform(m.obj);
          selItems.push({
            kind: "marker", id, markerKind: m.kind, x: t.x, y: t.y, z: t.z,
            yaw: 0, scale: 1, rarity: m.rarity
          });
        }
      }
    }
    this.onSelectionChange(selItems);
  }

  /** True if any currently-selected asset is a floor/stairs piece, which
   *  must land on a true DUNGEON_PITCH tile center (not the finer half-tile
   *  grid decorative props use) -- used to pick the right snap step below. */
  private selectionHasFloorOrStairs(): boolean {
    for (const id of this.selectedIds) {
      const a = this.assets.get(id);
      if (a && isFloorOrStairs(a.model)) return true;
    }
    return false;
  }

  private onTransformChange = (): void => {
    if (this.selectedIds.size === 0) return;

    if (this.snapEnabled) {
      // Snap the DRAG DELTA (not the absolute position) to a whole grid
      // step -- this preserves whatever alignment the selection already had
      // at drag-start regardless of where that start position sat, which
      // matters for multi-selections whose group pivot is an *average* of
      // several objects' positions and is not itself a meaningful grid
      // point. The step must be a full DUNGEON_PITCH tile (4 units) for any
      // floor/stairs piece -- snapping by the half-tile step (2 units) used
      // here previously had a 50% chance of landing a tile on the boundary
      // between two cells instead of a true tile center.
      const step = this.selectionHasFloorOrStairs() ? DUNGEON_PITCH : DUNGEON_HALF;
      const dx = this.selectionGroup.position.x - this.dragStartPos.x;
      const dz = this.selectionGroup.position.z - this.dragStartPos.z;

      const snappedDx = Math.round(dx / step) * step;
      const snappedDz = Math.round(dz / step) * step;

      this.selectionGroup.position.x = this.dragStartPos.x + snappedDx;
      this.selectionGroup.position.z = this.dragStartPos.z + snappedDz;

      const dyaw = this.selectionGroup.rotation.y - this.dragStartRot.y;
      const snappedDyaw = Math.round(dyaw / (Math.PI / 2)) * (Math.PI / 2);
      this.selectionGroup.rotation.y = this.dragStartRot.y + snappedDyaw;
    }

    // Guard against wildly-oversized drags -- the translate gizmo's
    // screen-to-world ratio grows with camera distance, so a small mouse
    // movement while the (now free-flying) camera is far from the selection
    // can otherwise fling an object dozens of units up. Dungeon interiors
    // never need more height than a handful of stacked floors.
    this.selectionGroup.position.y = THREE.MathUtils.clamp(this.selectionGroup.position.y, -4, 40);

    this.selectionGroup.updateMatrixWorld(true);

    // Update all helpers
    for (const helper of this.selectionHelpers.values()) {
      helper.update();
    }

    this.triggerChange();
    this.emitSelection();
  };

  updateSelectedProps(patch: Partial<{ x: number; y: number; z: number; yaw: number; scale: number; rise: number; rarity: "common" | "rare" }>): void {
    if (this.selectedIds.size === 0) return;
    for (const obj of [...this.selectionGroup.children]) {
      this.scene.attach(obj);
    }
    for (const id of this.selectedIds) {
      const a = this.assets.get(id);
      if (a) {
        if (patch.x !== undefined) a.obj.position.x = patch.x;
        if (patch.y !== undefined) a.obj.position.y = patch.y;
        if (patch.z !== undefined) a.obj.position.z = patch.z;
        if (patch.yaw !== undefined) a.obj.rotation.y = patch.yaw;
        if (patch.scale !== undefined) a.obj.scale.setScalar(patch.scale);
        if (patch.rise !== undefined) a.rise = patch.rise;
      } else {
        const m = id === "entry" ? this.entryMarker : this.markers.get(id);
        if (m) {
          if (patch.x !== undefined) m.obj.position.x = patch.x;
          if (patch.y !== undefined) m.obj.position.y = patch.y;
          if (patch.z !== undefined) m.obj.position.z = patch.z;
          if (patch.rarity !== undefined && m.kind === "chest" && m.rarity !== patch.rarity) {
            m.rarity = patch.rarity;
            while (m.obj.children.length > 0) {
              m.obj.remove(m.obj.children[0]!);
            }
            const modelFile = patch.rarity === "rare" ? "chest_gold.gltf" : "chest.gltf";
            load(`/assets/models/props/${modelFile}`).then((gltf) => {
              const clone = SkeletonUtils.clone(gltf.scene);
              clone.scale.set(1.2, 1.2, 1.2);
              clone.position.set(0, -0.5, 0);
              m.obj.add(clone);
            });
          }
        }
      }
    }
    this.updateSelectionGroup();
    this.triggerChange();
  }

  deleteSelected(): void {
    if (this.selectedIds.size === 0) return;
    
    // Reparent them to scene so they don't break selectionGroup mid-loop
    for (const obj of [...this.selectionGroup.children]) {
      this.scene.attach(obj);
    }
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
      } else if (id === "entry") {
        if (this.entryMarker) {
          this.scene.remove(this.entryMarker.obj);
          this.disposeObject(this.entryMarker.obj);
          this.entryMarker = null;
        }
      } else {
        const m = this.markers.get(id);
        if (m) {
          this.scene.remove(m.obj);
          this.disposeObject(m.obj);
          this.markers.delete(id);
        }
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

  clear(): void {
    this.transform.detach();
    for (const helper of this.selectionHelpers.values()) {
      this.scene.remove(helper);
      helper.dispose();
    }
    this.selectionHelpers.clear();

    for (const obj of [...this.selectionGroup.children]) {
      this.scene.attach(obj);
    }
    for (const a of this.assets.values()) {
      this.scene.remove(a.obj);
      this.disposeObject(a.obj);
    }
    for (const m of this.markers.values()) {
      this.scene.remove(m.obj);
      this.disposeObject(m.obj);
    }
    if (this.entryMarker) {
      this.scene.remove(this.entryMarker.obj);
      this.disposeObject(this.entryMarker.obj);
    }
    this.assets.clear();
    this.markers.clear();
    this.entryMarker = null;
    this.selectedIds.clear();
    this.armedModel = null;
    this.armedMarkerKind = null;
    this.nextId = 1;
    this.onSelectionChange([]);
  }

  async loadBlueprint(bp: DungeonBlueprint): Promise<void> {
    this.isRestoring = true;
    try {
      this.clear();
      for (const asset of bp.assets) {
        const gltf = await load(`/assets/models/props/${asset.model}`);
        const obj = SkeletonUtils.clone(gltf.scene);
        obj.position.set(asset.localX, asset.localY, asset.localZ);
        obj.rotation.y = asset.yaw;
        obj.scale.setScalar(asset.scale ?? 1);
        const id = asset.id ?? `asset_${this.nextId++}`;
        obj.userData.editorKind = "asset";
        obj.userData.editorId = id;
        this.scene.add(obj);
        this.assets.set(id, { id, model: asset.model, obj, rise: asset.rise });
      }
      for (const spawn of bp.mobSpawns) {
        this.placeMarkerAt("mobSpawn", spawn.localX, 0, spawn.localZ);
      }
      for (const chestEntry of bp.chests) {
        this.placeMarkerAt("chest", chestEntry.localX, chestEntry.localY, chestEntry.localZ, chestEntry.rarity);
      }
      this.placeMarkerAt("entry", bp.entryLocal.x, 0, bp.entryLocal.z);

      // Advance nextId past every asset id just loaded (whether freshly
      // assigned above or reused verbatim from the saved file) -- otherwise
      // the next new asset placed in this session could reuse an id that's
      // already taken. That doesn't fail loudly: assets.set() on a
      // colliding id just overwrites the map entry, but the original
      // object is still a live child of the scene with no id pointing to
      // it anymore -- a ghost that can never be selected, deleted, or
      // exported again (though it never makes it into the saved file
      // either, since export only reads the current map).
      for (const id of this.assets.keys()) {
        const match = /^asset_(\d+)$/.exec(id);
        if (match) this.nextId = Math.max(this.nextId, Number(match[1]) + 1);
      }
    } finally {
      this.isRestoring = false;
    }
  }

  exportBlueprint(): DungeonBlueprint {
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

    const assets: DungeonAsset[] = [...this.assets.values()].map((a) => {
      const t = getTransform(a.obj);
      return {
        id: a.id,
        model: a.model,
        localX: t.x,
        localY: t.y,
        localZ: t.z,
        yaw: t.yaw,
        scale: t.scale,
        rise: a.model.startsWith("stairs_") ? (a.rise ?? DEFAULT_STAIRS_RISE) : undefined,
      };
    });
    const mobSpawns = [...this.markers.values()]
      .filter((m) => m.kind === "mobSpawn")
      .map((m) => {
        const t = getTransform(m.obj);
        return { localX: t.x, localZ: t.z };
      });
    const chests = [...this.markers.values()]
      .filter((m) => m.kind === "chest")
      .map((m) => {
        const t = getTransform(m.obj);
        return {
          localX: t.x,
          localY: t.y,
          localZ: t.z,
          rarity: m.rarity ?? ("common" as const),
        };
      });
    let entryLocal = { x: 0, z: 0 };
    if (this.entryMarker) {
      const t = getTransform(this.entryMarker.obj);
      entryLocal = { x: t.x, z: t.z };
    }
    return { assets, mobSpawns, chests, entryLocal };
  }

  private frame = (): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.running = false;
    if ((this.canvas as CanvasWithScene).__dungeonEditorScene === this) {
      (this.canvas as CanvasWithScene).__dungeonEditorScene = undefined;
    }
    this.canvas.removeEventListener("mousedown", this.onMouseDown);
    this.canvas.removeEventListener("mousemove", this.onMouseMove);
    this.canvas.removeEventListener("mouseup", this.onMouseUp);
    this.canvas.removeEventListener("mouseleave", this.onMouseUp);
    this.canvas.removeEventListener("click", this.onClick);
    this.canvas.removeEventListener("dblclick", this.onDoubleClick);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("pointerdown", this.trackModifiers, { capture: true });
    window.removeEventListener("pointermove", this.trackModifiers, { capture: true });
    window.removeEventListener("blur", this.clearModifiers);
    this.transform.removeEventListener("objectChange", this.onTransformChange);
    this.transform.dispose();
    this.orbit.dispose();
    this.renderer.dispose();
  }
}
