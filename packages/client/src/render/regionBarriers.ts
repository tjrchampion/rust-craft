import * as THREE from "three";
import type { RegionBarrierVolume } from "@rustcraft/shared";

const BARRIER_MAT = new THREE.MeshBasicMaterial({
  color: 0x44e0a0,
  transparent: true,
  opacity: 0.22,
  depthWrite: false,
  side: THREE.DoubleSide,
  wireframe: false,
});

const BARRIER_EDGE_MAT = new THREE.LineBasicMaterial({
  color: 0x88ffcc,
  transparent: true,
  opacity: 0.75,
});

const BARRIER_SELECTED_EDGE_MAT = new THREE.LineBasicMaterial({
  color: 0xffe066,
  transparent: true,
  opacity: 1,
  depthTest: false,
});

const BARRIER_SELECTED_FILL_MAT = new THREE.MeshBasicMaterial({
  color: 0xffe066,
  transparent: true,
  opacity: 0.18,
  depthWrite: false,
  side: THREE.DoubleSide,
});

const HANDLE_MAT = new THREE.MeshBasicMaterial({
  color: 0xfff2a8,
  depthTest: false,
  transparent: true,
  opacity: 0.95,
});

const HANDLE_HOVER_MAT = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  depthTest: false,
  transparent: true,
  opacity: 1,
});

/** Footprint resize handles: 4 corners + 4 edge midpoints (XZ). */
export type BarrierHandleId =
  | "px"
  | "nx"
  | "pz"
  | "nz"
  | "pxpz"
  | "pxnz"
  | "nxpz"
  | "nxnz";

const HANDLE_LOCAL: Record<BarrierHandleId, { x: number; z: number }> = {
  px: { x: 1, z: 0 },
  nx: { x: -1, z: 0 },
  pz: { x: 0, z: 1 },
  nz: { x: 0, z: -1 },
  pxpz: { x: 1, z: 1 },
  pxnz: { x: 1, z: -1 },
  nxpz: { x: -1, z: 1 },
  nxnz: { x: -1, z: -1 },
};

const HANDLE_IDS = Object.keys(HANDLE_LOCAL) as BarrierHandleId[];

/** Translucent editor ghost for an invisible player barrier. */
export function createBarrierMesh(data: RegionBarrierVolume): THREE.Group {
  const group = new THREE.Group();
  group.name = `barrier:${data.id ?? "anon"}`;
  const geo = new THREE.BoxGeometry(2, 2, 2);
  const mesh = new THREE.Mesh(geo, BARRIER_MAT.clone());
  mesh.name = "barrier-body";
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), BARRIER_EDGE_MAT.clone());
  edges.name = "barrier-edges";
  edges.renderOrder = 2;
  group.add(mesh);
  group.add(edges);

  // Selection outline (hidden until selected) — slightly inflated, always on top.
  const selGeo = new THREE.BoxGeometry(2.06, 2.06, 2.06);
  const selFill = new THREE.Mesh(selGeo, BARRIER_SELECTED_FILL_MAT.clone());
  selFill.name = "barrier-selected-fill";
  selFill.visible = false;
  selFill.renderOrder = 3;
  const selEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(selGeo),
    BARRIER_SELECTED_EDGE_MAT.clone(),
  );
  selEdges.name = "barrier-selected-edges";
  selEdges.visible = false;
  selEdges.renderOrder = 4;
  group.add(selFill);
  group.add(selEdges);

  const handles = new THREE.Group();
  handles.name = "barrier-handles";
  handles.visible = false;
  const handleGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const id of HANDLE_IDS) {
    const h = new THREE.Mesh(handleGeo, HANDLE_MAT.clone());
    h.name = `barrier-handle:${id}`;
    h.userData.barrierHandle = id;
    h.userData.editorKind = "barrierHandle";
    h.renderOrder = 5;
    const loc = HANDLE_LOCAL[id];
    h.position.set(loc.x, 0, loc.z);
    handles.add(h);
  }
  group.add(handles);

  syncBarrierMesh(group, data);
  setBarrierSelected(group, false);
  return group;
}

export function syncBarrierMesh(group: THREE.Group, data: RegionBarrierVolume): void {
  group.position.set(data.localX, data.localY, data.localZ);
  group.rotation.set(0, data.yaw, 0);
  group.scale.set(
    Math.max(0.1, data.sizeX),
    Math.max(0.1, data.sizeY),
    Math.max(0.1, data.sizeZ),
  );
  group.userData.barrierData = data;
  syncBarrierHandleScales(group);
}

/** Keep handle widgets roughly constant world size despite barrier scale. */
function syncBarrierHandleScales(group: THREE.Group): void {
  const handles = group.getObjectByName("barrier-handles");
  if (!handles) return;
  const sx = Math.max(0.1, group.scale.x);
  const sy = Math.max(0.1, group.scale.y);
  const sz = Math.max(0.1, group.scale.z);
  const world = 0.55;
  for (const child of handles.children) {
    child.scale.set(world / sx, world / sy, world / sz);
  }
}

/** Bright outline while selected; footprint handles when `showHandles` (single-select). */
export function setBarrierSelected(
  group: THREE.Group,
  selected: boolean,
  showHandles = selected,
): void {
  const body = group.getObjectByName("barrier-body") as THREE.Mesh | undefined;
  const edges = group.getObjectByName("barrier-edges") as THREE.LineSegments | undefined;
  const selFill = group.getObjectByName("barrier-selected-fill");
  const selEdges = group.getObjectByName("barrier-selected-edges");
  const handles = group.getObjectByName("barrier-handles");
  if (body?.material instanceof THREE.MeshBasicMaterial) {
    body.material.opacity = selected ? 0.32 : 0.22;
    body.material.color.setHex(selected ? 0x66ffc2 : 0x44e0a0);
  }
  if (edges?.material instanceof THREE.LineBasicMaterial) {
    edges.material.color.setHex(selected ? 0xffe066 : 0x88ffcc);
    edges.material.opacity = selected ? 1 : 0.75;
    edges.material.depthTest = !selected;
  }
  if (selFill) selFill.visible = selected;
  if (selEdges) selEdges.visible = selected;
  if (handles) handles.visible = showHandles;
  syncBarrierHandleScales(group);
}

export function barrierHandleMeshes(group: THREE.Group): THREE.Object3D[] {
  const handles = group.getObjectByName("barrier-handles");
  return handles ? [...handles.children] : [];
}

export function setBarrierHandleHover(group: THREE.Group, handleId: BarrierHandleId | null): void {
  const handles = group.getObjectByName("barrier-handles");
  if (!handles) return;
  for (const child of handles.children) {
    if (!(child instanceof THREE.Mesh)) continue;
    const id = child.userData.barrierHandle as BarrierHandleId;
    child.material = id === handleId ? HANDLE_HOVER_MAT : HANDLE_MAT;
  }
}

/**
 * Photoshop-style footprint resize: the grabbed edge/corner follows the
 * cursor; the opposite edge(s) stay fixed in place.
 *
 * `cursorLocalX/Z` are meters in the barrier's local XZ (same space as the
 * handle positions), relative to the drag-start center.
 */
export function applyBarrierHandleResize(
  data: RegionBarrierVolume,
  handle: BarrierHandleId,
  cursorLocalX: number,
  cursorLocalZ: number,
  start: {
    sizeX: number;
    sizeZ: number;
    localX: number;
    localZ: number;
    yaw: number;
  },
): RegionBarrierVolume {
  const minHalf = 0.25;
  // Face positions in start-center local space (±half-extents).
  let minX = -start.sizeX;
  let maxX = start.sizeX;
  let minZ = -start.sizeZ;
  let maxZ = start.sizeZ;

  const movePX = handle === "px" || handle === "pxpz" || handle === "pxnz";
  const moveNX = handle === "nx" || handle === "nxpz" || handle === "nxnz";
  const movePZ = handle === "pz" || handle === "pxpz" || handle === "nxpz";
  const moveNZ = handle === "nz" || handle === "pxnz" || handle === "nxnz";

  // Only the grabbed side(s) track the cursor — never the opposite side.
  if (movePX) maxX = Math.max(minX + minHalf * 2, cursorLocalX);
  if (moveNX) minX = Math.min(maxX - minHalf * 2, cursorLocalX);
  if (movePZ) maxZ = Math.max(minZ + minHalf * 2, cursorLocalZ);
  if (moveNZ) minZ = Math.min(maxZ - minHalf * 2, cursorLocalZ);

  const sizeX = Math.max(minHalf, (maxX - minX) / 2);
  const sizeZ = Math.max(minHalf, (maxZ - minZ) / 2);
  const midX = (minX + maxX) / 2;
  const midZ = (minZ + maxZ) / 2;
  const center = barrierLocalOffsetToWorld(midX, midZ, start.localX, start.localZ, start.yaw);

  return {
    ...data,
    sizeX,
    sizeZ,
    localX: center.x,
    localZ: center.z,
    yaw: start.yaw,
  };
}

/**
 * World XZ → barrier local XZ (Three.js `rotation.y` / makeRotationY).
 * Local +X handle sits on the +X face; local +Z on the +Z face.
 */
export function worldToBarrierLocalMeters(
  worldX: number,
  worldZ: number,
  centerX: number,
  centerZ: number,
  yaw: number,
): { x: number; z: number } {
  const dx = worldX - centerX;
  const dz = worldZ - centerZ;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  // Dot with local axes: +X=(cos, -sin), +Z=(sin, cos)
  return {
    x: dx * cos - dz * sin,
    z: dx * sin + dz * cos,
  };
}

/** Barrier-local offset → world XZ (matches Three.js Object3D.localToWorld). */
export function barrierLocalOffsetToWorld(
  localX: number,
  localZ: number,
  centerX: number,
  centerZ: number,
  yaw: number,
): { x: number; z: number } {
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  return {
    x: centerX + localX * cos + localZ * sin,
    z: centerZ - localX * sin + localZ * cos,
  };
}
