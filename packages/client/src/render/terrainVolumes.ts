import * as THREE from "three";
import {
  isTerrainStroke,
  type RegionTerrainVolume,
  type TerrainVolumeCarve,
  type TerrainVolumeMaterial,
  type TerrainVolumePathPoint,
  type TerrainVolumeShape,
} from "@rustcraft/shared";

/** Photo-sourced ground textures (same set the heightmap terrain blends). */
const TEX: Record<TerrainVolumeMaterial, THREE.Texture> = (() => {
  const loader = new THREE.TextureLoader();
  const load = (file: string) => {
    const t = loader.load(`/assets/textures/terrain/${file}`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.repeat.set(2, 2);
    return t;
  };
  return {
    rock: load("rock.jpg"),
    dirt: load("dirt.jpg"),
    grass: load("grass.jpg"),
    sand: load("sand.jpg"),
    cobble: load("cobble.jpg"),
  };
})();

const MAT_CACHE = new Map<TerrainVolumeMaterial, THREE.MeshStandardMaterial>();
const STROKE_MAT_CACHE = new Map<TerrainVolumeMaterial, THREE.MeshStandardMaterial>();

function materialFor(mat: TerrainVolumeMaterial): THREE.MeshStandardMaterial {
  let m = MAT_CACHE.get(mat);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    map: TEX[mat],
    roughness: mat === "rock" || mat === "cobble" ? 0.92 : 0.85,
    metalness: 0,
    flatShading: mat === "rock" || mat === "cobble",
  });
  MAT_CACHE.set(mat, m);
  return m;
}

/** Stroke ridges always use flat shading so organic displacement reads as
 *  rocky/earthy facets rather than a smooth extruded tube. */
function strokeMaterialFor(mat: TerrainVolumeMaterial): THREE.MeshStandardMaterial {
  let m = STROKE_MAT_CACHE.get(mat);
  if (m) return m;
  m = materialFor(mat).clone();
  m.flatShading = true;
  m.roughness = Math.min(1, m.roughness + 0.05);
  STROKE_MAT_CACHE.set(mat, m);
  return m;
}

/** Shared geometries (unit-sized); scaled per-instance via mesh.scale. */
const GEOM: Record<TerrainVolumeShape, THREE.BufferGeometry> = {
  boulder: new THREE.IcosahedronGeometry(1, 1),
  block: new THREE.BoxGeometry(2, 2, 2),
  pillar: new THREE.CylinderGeometry(1, 1, 2, 10),
  spike: new THREE.ConeGeometry(1, 2, 8),
  ramp: (() => {
    const g = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      -1, -1, -1, 1, -1, -1, 1, -1, 1,
      -1, -1, -1, 1, -1, 1, -1, -1, 1,
      -1, -1, -1, 1, -1, -1, 1, 1, 1,
      -1, -1, -1, 1, 1, 1, -1, 1, 1,
      -1, -1, 1, 1, -1, 1, 1, 1, 1,
      -1, -1, 1, 1, 1, 1, -1, 1, 1,
      -1, -1, -1, -1, -1, 1, -1, 1, 1,
      1, -1, -1, 1, 1, 1, 1, -1, 1,
    ]);
    g.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    g.computeVertexNormals();
    return g;
  })(),
};

export const TERRAIN_VOLUME_SHAPES: readonly { id: TerrainVolumeShape; label: string }[] = [
  { id: "boulder", label: "🪨 Boulder" },
  { id: "block", label: "🧱 Block / Cliff" },
  { id: "pillar", label: "🗼 Pillar" },
  { id: "spike", label: "🔺 Spike" },
  { id: "ramp", label: "📐 Ramp" },
];

/** Shapes supported by the experimental Blender-style clay sculpt brush. */
export const CLAY_SCULPT_SHAPES: readonly { id: TerrainVolumeShape; label: string }[] = [
  { id: "boulder", label: "🪨 Boulder" },
  { id: "block", label: "🧱 Block / Cliff" },
];

export const TERRAIN_VOLUME_MATERIALS: readonly { id: TerrainVolumeMaterial; label: string }[] = [
  { id: "rock", label: "Rock" },
  { id: "dirt", label: "Dirt" },
  { id: "grass", label: "Grass" },
  { id: "sand", label: "Sand" },
  { id: "cobble", label: "Cobble" },
];

/** Deterministic value noise for organic stroke sculpting -- seeded per volume
 *  id so live rebuilds stay stable while the stroke is being dragged. */
function hash01(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash01(i + seed) * (1 - u) + hash01(i + 1 + seed) * u;
}

function fbm1(x: number, seed: number, octaves = 3): number {
  let v = 0;
  let a = 0.5;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    v += a * noise1(x * f, seed + o * 19);
    a *= 0.5;
    f *= 2.05;
  }
  return v;
}

function seedFromId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 10000;
}

/**
 * Terrain-like cross-section: CLOSED organic loop (upper silhouette + rounded
 * noisy belly), CCW when looking along +tangent. No flat underside plane.
 */
function terrainProfile(
  shape: TerrainVolumeShape,
  halfW: number,
  height: number,
  wMul: number,
  hMul: number,
  along: number,
  seed: number,
  upperN = 14,
  bellyN = 8,
): Array<{ x: number; y: number }> {
  const hw = Math.max(0.08, halfW * wMul);
  const hh = Math.max(0.1, height * hMul);
  const skirt = hw * 1.15;
  const upper: Array<{ x: number; y: number }> = [];

  const pushUpper = (t: number, x: number, y: number) => {
    const crest = Math.max(0, y / hh);
    const j = fbm1(along * 3.1 + t * 5.7, seed + 40) - 0.5;
    upper.push({
      x: x + j * hw * 0.1 * (0.35 + crest),
      y: Math.max(0, y + j * hh * 0.14 * crest),
    });
  };

  for (let i = 0; i <= upperN; i++) {
    const t = i / upperN;
    switch (shape) {
      case "boulder": {
        const ang = Math.PI * (1 - t);
        const bulge = 1 + (fbm1(along * 2.2 + t, seed) - 0.5) * 0.28;
        pushUpper(t, Math.cos(ang) * skirt * bulge, Math.pow(Math.sin(ang), 0.85) * hh * (0.9 + 0.15 * Math.sin(ang)));
        break;
      }
      case "block": {
        let x: number;
        let y: number;
        if (t < 0.1) {
          const u = t / 0.1;
          x = -skirt + u * (skirt - hw);
          y = 0;
        } else if (t < 0.36) {
          const u = (t - 0.1) / 0.26;
          x = -hw * (0.92 + 0.1 * Math.sin(along * 4));
          y = u * u * hh;
        } else if (t < 0.64) {
          const u = (t - 0.36) / 0.28;
          const topJ = (fbm1(along * 4 + u * 2, seed + 7) - 0.5) * hh * 0.22;
          x = -hw + u * 2 * hw;
          y = hh + topJ;
        } else if (t < 0.9) {
          const u = (t - 0.64) / 0.26;
          x = hw * (0.92 + 0.1 * Math.cos(along * 3));
          y = (1 - u * u) * hh;
        } else {
          const u = (t - 0.9) / 0.1;
          x = hw + u * (skirt - hw);
          y = 0;
        }
        pushUpper(t, x, y);
        break;
      }
      case "pillar": {
        const ang = Math.PI * (1 - t);
        const thin = 0.38 + 0.12 * Math.sin(along * 5);
        pushUpper(
          t,
          Math.cos(ang) * hw * thin * (1 + (fbm1(along + t, seed) - 0.5) * 0.22),
          Math.pow(Math.sin(ang), 0.65) * hh * 1.3,
        );
        break;
      }
      case "spike": {
        const ang = Math.PI * (1 - t);
        const serration = 1 + 0.4 * Math.sin(along * 9 + t * Math.PI);
        pushUpper(
          t,
          Math.cos(ang) * skirt * (0.65 + 0.35 * Math.sin(ang)),
          Math.pow(Math.sin(ang), 1.45) * hh * 1.4 * serration,
        );
        break;
      }
      case "ramp": {
        let x: number;
        let y: number;
        if (t < 0.12) {
          x = -skirt + (t / 0.12) * (skirt * 0.35);
          y = 0;
        } else if (t < 0.72) {
          const u = (t - 0.12) / 0.6;
          x = -skirt * 0.65 + u * (hw + skirt * 0.65);
          y = Math.pow(u, 1.1) * hh * (0.88 + 0.18 * fbm1(along * 3, seed));
        } else {
          const u = (t - 0.72) / 0.28;
          x = hw + u * (skirt - hw) * 0.55;
          y = hh * (1 - u) * (0.8 + 0.15 * fbm1(along, seed + 3));
        }
        pushUpper(t, x, y);
        break;
      }
    }
  }

  // Rounded, uneven belly from right toe → left toe (replaces the flat cut).
  // Depth scales with the mound so it reads as buried earth, not a slab.
  const left = upper[0]!;
  const right = upper[upper.length - 1]!;
  const bellyDepth = Math.max(0.12, hh * 0.28);
  const belly: Array<{ x: number; y: number }> = [];
  for (let i = 1; i <= bellyN; i++) {
    const t = i / (bellyN + 1); // 0→1 from right toward left (exclusive of toes)
    const x = right.x + (left.x - right.x) * t;
    // Half-ellipse dip + noise so the keel isn't planar.
    const arch = Math.sin(t * Math.PI);
    const rumple = (fbm1(along * 2.4 + t * 6.1, seed + 77) - 0.5) * bellyDepth * 0.55;
    const y = -arch * bellyDepth + rumple;
    const xJ = (fbm1(along * 1.7 + t * 4.2, seed + 91) - 0.5) * hw * 0.12 * arch;
    belly.push({ x: x + xJ, y });
  }
  return [...upper, ...belly];
}

/** Resample a polyline to roughly even spacing (keeps endpoints). */
function resamplePath(
  path: TerrainVolumePathPoint[],
  spacing: number,
): TerrainVolumePathPoint[] {
  if (path.length < 2) return path.map((p) => ({ ...p }));
  const out: TerrainVolumePathPoint[] = [{ ...path[0]! }];
  let carry = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const segLen = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    if (segLen < 1e-8) continue;
    let d = spacing - carry;
    while (d <= segLen) {
      const t = d / segLen;
      const wa = a.w ?? 1;
      const wb = b.w ?? 1;
      const ha = a.h ?? 1;
      const hb = b.h ?? 1;
      out.push({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
        w: wa + (wb - wa) * t,
        h: ha + (hb - ha) * t,
      });
      d += spacing;
    }
    carry = segLen - (d - spacing);
  }
  const last = path[path.length - 1]!;
  const prev = out[out.length - 1]!;
  if (Math.hypot(last.x - prev.x, last.y - prev.y, last.z - prev.z) > spacing * 0.25) {
    out.push({ ...last });
  } else {
    out[out.length - 1] = { ...last };
  }
  return out;
}

/** Builds a sealed solid stroke mesh (closed profile, outward winds, end caps). */
export function buildTerrainStrokeGeometry(v: RegionTerrainVolume): THREE.BufferGeometry {
  const raw = v.path ?? [];
  const halfW = Math.max(0.05, v.scaleX);
  const height = Math.max(0.08, v.scaleY);
  const path = resamplePath(raw, Math.max(0.2, halfW * 0.26));
  const nS = path.length;
  const seed = seedFromId(v.id);

  if (nS < 2) {
    return new THREE.BoxGeometry(0.01, 0.01, 0.01);
  }

  const cx = v.localX;
  const cy = v.localY;
  const cz = v.localZ;

  const profiles: Array<Array<{ x: number; y: number }>> = [];
  for (let i = 0; i < nS; i++) {
    const along = i * 0.37;
    const t = i / Math.max(1, nS - 1);
    const endTaper = Math.sin(Math.min(1, Math.min(t, 1 - t) / 0.2) * Math.PI * 0.5);
    const taper = 0.15 + 0.85 * endTaper;
    const wNoise = 0.72 + 0.55 * fbm1(along, seed);
    const hNoise = 0.65 + 0.6 * fbm1(along * 1.3, seed + 11);
    const localW = path[i]!.w ?? 1;
    const localH = path[i]!.h ?? 1;
    const meander = (fbm1(along * 0.85, seed + 23) - 0.5) * halfW * 0.08 * localW;
    const profile = terrainProfile(
      v.shape,
      halfW,
      height,
      wNoise * taper * localW,
      hNoise * taper * localH,
      along,
      seed,
    );
    for (const p of profile) p.x += meander;
    profiles.push(profile);
  }
  const nP = profiles[0]!.length;

  const up = new THREE.Vector3(0, 1, 0);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  let distAlong = 0;
  for (let i = 0; i < nS; i++) {
    const p = path[i]!;
    if (i > 0) {
      const prevP = path[i - 1]!;
      distAlong += Math.hypot(p.x - prevP.x, p.y - prevP.y, p.z - prevP.z);
    }
    const prev = path[Math.max(0, i - 1)]!;
    const next = path[Math.min(nS - 1, i + 1)]!;
    const tangent = new THREE.Vector3(next.x - prev.x, next.y - prev.y, next.z - prev.z);
    if (tangent.lengthSq() < 1e-10) tangent.set(1, 0, 0);
    else tangent.normalize();

    let right = new THREE.Vector3().crossVectors(up, tangent);
    if (right.lengthSq() < 1e-8) right = new THREE.Vector3(1, 0, 0);
    else right.normalize();
    const frameUp = new THREE.Vector3().crossVectors(tangent, right).normalize();

    const profile = profiles[i]!;
    for (let j = 0; j < nP; j++) {
      const pr = profile[j]!;
      // Light displacement on the whole hull (including the belly) so no face
      // stays as a clean plane.
      const nAmt = fbm1(distAlong * 0.55 + j * 0.31, seed + 50) - 0.5;
      const elevWeight = 0.35 + Math.abs(pr.y) / Math.max(0.01, height);
      const disp = nAmt * Math.min(halfW, height) * 0.14 * elevWeight;
      const wx = p.x + right.x * pr.x + frameUp.x * (pr.y + disp);
      const wy = p.y + right.y * pr.x + frameUp.y * (pr.y + disp);
      const wz = p.z + right.z * pr.x + frameUp.z * (pr.y + disp);
      positions.push(wx - cx, wy - cy, wz - cz);
      uvs.push(wx * 0.11, wz * 0.11 + wy * 0.07);
    }
  }

  // Outward-facing side quads for a CCW profile (looking along +tangent).
  // Previous winding faced inward → backface cull made the mesh look hollow.
  for (let i = 0; i < nS - 1; i++) {
    for (let j = 0; j < nP; j++) {
      const j2 = (j + 1) % nP;
      const a = i * nP + j;
      const b = i * nP + j2;
      const c = (i + 1) * nP + j2;
      const d = (i + 1) * nP + j;
      indices.push(a, d, c, a, c, b);
    }
  }

  const capFan = (ring: number, outward: boolean) => {
    const base = ring * nP;
    const centerIdx = positions.length / 3;
    const p = path[ring]!;
    positions.push(p.x - cx, p.y - cy - 0.04, p.z - cz);
    uvs.push(p.x * 0.11, p.z * 0.11);
    for (let j = 0; j < nP; j++) {
      const j2 = (j + 1) % nP;
      if (outward) indices.push(centerIdx, base + j, base + j2);
      else indices.push(centerIdx, base + j2, base + j);
    }
  };
  capFan(0, false);
  capFan(nS - 1, true);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return applyVolumeCarves(geo, v);
}

/**
 * Punch spherical holes through a volume mesh. Triangles whose centroid lies
 * inside any carve sphere (local to the mesh) are removed, opening a see-
 * through tunnel when the carve reaches both sides. Carves are authored in
 * world space; `v.local*` is the mesh origin.
 */
export function applyVolumeCarves(
  geo: THREE.BufferGeometry,
  v: RegionTerrainVolume,
): THREE.BufferGeometry {
  const carves = v.carves;
  if (!carves || carves.length === 0) return geo;

  const localCarves: TerrainVolumeCarve[] = carves.map((c) => ({
    x: c.x - v.localX,
    y: c.y - v.localY,
    z: c.z - v.localZ,
    radius: c.radius,
  }));

  // Discrete stamps keep unit geometry + mesh.scale -- convert carves into
  // unit-local space so shared-shape clones punch correctly before scale bake.
  const scaled = !isTerrainStroke(v);
  if (scaled) {
    const sx = Math.max(1e-4, v.scaleX);
    const sy = Math.max(1e-4, v.scaleY);
    const sz = Math.max(1e-4, v.scaleZ);
    const cos = Math.cos(-v.yaw);
    const sin = Math.sin(-v.yaw);
    for (const c of localCarves) {
      const rx = c.x * cos - c.z * sin;
      const rz = c.x * sin + c.z * cos;
      c.x = rx / sx;
      c.y = c.y / sy;
      c.z = rz / sz;
      // Ellipsoid approx: use average scale so brush radius feels consistent.
      c.radius = c.radius / ((sx + sy + sz) / 3);
    }
  }

  return punchCarveSpheres(geo, localCarves);
}

/** Removes triangles whose centroid (or all three verts) lie inside any carve
 *  sphere. Geometry and carves must share the same coordinate space. */
export function punchCarveSpheres(
  geo: THREE.BufferGeometry,
  carves: TerrainVolumeCarve[],
): THREE.BufferGeometry {
  if (carves.length === 0) return geo;

  const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;
  const uvAttr = geo.getAttribute("uv") as THREE.BufferAttribute | undefined;
  const index = geo.getIndex();
  const triCount = index ? index.count / 3 : posAttr.count / 3;
  const keepPositions: number[] = [];
  const keepUvs: number[] = [];
  const keepIndices: number[] = [];
  const vertMap = new Map<number, number>();

  const getVert = (i: number) => {
    if (index) return index.getX(i);
    return i;
  };

  const inside = (vx: number, vy: number, vz: number, c: TerrainVolumeCarve) => {
    const dx = vx - c.x;
    const dy = vy - c.y;
    const dz = vz - c.z;
    return dx * dx + dy * dy + dz * dz < c.radius * c.radius;
  };

  for (let t = 0; t < triCount; t++) {
    const i0 = getVert(t * 3);
    const i1 = getVert(t * 3 + 1);
    const i2 = getVert(t * 3 + 2);
    const ax = posAttr.getX(i0);
    const ay = posAttr.getY(i0);
    const az = posAttr.getZ(i0);
    const bx = posAttr.getX(i1);
    const by = posAttr.getY(i1);
    const bz = posAttr.getZ(i1);
    const cx = posAttr.getX(i2);
    const cy = posAttr.getY(i2);
    const cz = posAttr.getZ(i2);
    const mx = (ax + bx + cx) / 3;
    const my = (ay + by + cy) / 3;
    const mz = (az + bz + cz) / 3;

    let culled = false;
    for (const carve of carves) {
      if (
        inside(mx, my, mz, carve) ||
        (inside(ax, ay, az, carve) && inside(bx, by, bz, carve) && inside(cx, cy, cz, carve))
      ) {
        culled = true;
        break;
      }
    }
    if (culled) continue;

    const mapVert = (src: number) => {
      const existing = vertMap.get(src);
      if (existing !== undefined) return existing;
      const dst = keepPositions.length / 3;
      keepPositions.push(posAttr.getX(src), posAttr.getY(src), posAttr.getZ(src));
      if (uvAttr) keepUvs.push(uvAttr.getX(src), uvAttr.getY(src));
      vertMap.set(src, dst);
      return dst;
    };
    keepIndices.push(mapVert(i0), mapVert(i1), mapVert(i2));
  }

  if (keepIndices.length < 3) {
    geo.dispose();
    return new THREE.BoxGeometry(0.01, 0.01, 0.01);
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(keepPositions, 3));
  if (uvAttr && keepUvs.length > 0) {
    out.setAttribute("uv", new THREE.Float32BufferAttribute(keepUvs, 2));
  }
  out.setIndex(keepIndices);
  out.computeVertexNormals();
  out.computeBoundingSphere();
  geo.dispose();
  return out;
}

/** Stroke half-width / height from brush radius + strength. */
export function strokeSizeFromBrush(
  shape: TerrainVolumeShape,
  brushRadius: number,
  brushStrength: number,
): { halfWidth: number; height: number } {
  const r = Math.max(0.5, brushRadius);
  const s = Math.max(0.2, brushStrength);
  switch (shape) {
    case "boulder":
      return { halfWidth: r, height: r * (0.55 + s * 0.25) };
    case "block":
      return { halfWidth: r, height: r * (0.5 + s * 0.35) };
    case "pillar":
      return { halfWidth: r * 0.55, height: r * (1.0 + s * 0.5) };
    case "spike":
      return { halfWidth: r * 0.75, height: r * (1.1 + s * 0.45) };
    case "ramp":
      return { halfWidth: r, height: r * (0.4 + s * 0.3) };
  }
}

/** Builds a renderable mesh for a terrain volume (discrete stamp or stroke). */
export function createTerrainVolumeMesh(v: RegionTerrainVolume): THREE.Mesh {
  if (isTerrainStroke(v)) {
    const mesh = new THREE.Mesh(buildTerrainStrokeGeometry(v), strokeMaterialFor(v.material));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(v.localX, v.localY, v.localZ);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    mesh.userData.editorKind = "volume";
    mesh.userData.editorId = v.id;
    mesh.userData.volumeShape = v.shape;
    mesh.userData.volumeMaterial = v.material;
    mesh.userData.sharedGeometry = false;
    mesh.userData.isStroke = true;
    return mesh;
  }

  const hasCarves = (v.carves?.length ?? 0) > 0;
  let geo: THREE.BufferGeometry = GEOM[v.shape];
  let shared = true;
  if (hasCarves) {
    geo = applyVolumeCarves(GEOM[v.shape].clone(), v);
    shared = false;
  }
  const mesh = new THREE.Mesh(geo, materialFor(v.material));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.position.set(v.localX, v.localY, v.localZ);
  mesh.rotation.y = v.yaw;
  mesh.scale.set(v.scaleX, v.scaleY, v.scaleZ);
  mesh.userData.editorKind = "volume";
  mesh.userData.editorId = v.id;
  mesh.userData.volumeShape = v.shape;
  mesh.userData.volumeMaterial = v.material;
  mesh.userData.sharedGeometry = shared;
  mesh.userData.isStroke = false;
  return mesh;
}

/** Rebuilds a volume mesh in place after path / size / carve edits. */
export function rebuildTerrainVolumeMesh(mesh: THREE.Mesh, v: RegionTerrainVolume): void {
  if (isTerrainStroke(v)) {
    const old = mesh.geometry;
    mesh.geometry = buildTerrainStrokeGeometry(v);
    if (!mesh.userData.sharedGeometry) old.dispose();
    mesh.position.set(v.localX, v.localY, v.localZ);
    mesh.rotation.set(0, 0, 0);
    mesh.scale.set(1, 1, 1);
    mesh.userData.sharedGeometry = false;
    mesh.userData.isStroke = true;
    return;
  }

  const old = mesh.geometry;
  const wasShared = !!mesh.userData.sharedGeometry;
  const hasCarves = (v.carves?.length ?? 0) > 0;
  if (hasCarves) {
    mesh.geometry = applyVolumeCarves(GEOM[v.shape].clone(), v);
    mesh.userData.sharedGeometry = false;
  } else {
    mesh.geometry = GEOM[v.shape];
    mesh.userData.sharedGeometry = true;
  }
  if (!wasShared) old.dispose();
  mesh.position.set(v.localX, v.localY, v.localZ);
  mesh.rotation.y = v.yaw;
  mesh.scale.set(v.scaleX, v.scaleY, v.scaleZ);
  mesh.userData.isStroke = false;
}

/** @deprecated Prefer rebuildTerrainVolumeMesh -- kept for stroke-only call sites. */
export function rebuildTerrainStrokeMesh(mesh: THREE.Mesh, v: RegionTerrainVolume): void {
  rebuildTerrainVolumeMesh(mesh, v);
}

/** Ghost preview mesh (transparent) for the volume brush cursor. */
export function createTerrainVolumeGhost(shape: TerrainVolumeShape, material: TerrainVolumeMaterial): THREE.Mesh {
  const mat = materialFor(material).clone();
  mat.transparent = true;
  mat.opacity = 0.45;
  mat.depthWrite = false;
  const mesh = new THREE.Mesh(GEOM[shape], mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.userData.sharedGeometry = true;
  return mesh;
}

/** Default half-extents for a stamp given brush radius (world units). */
export function defaultVolumeScale(shape: TerrainVolumeShape, brushRadius: number): { scaleX: number; scaleY: number; scaleZ: number } {
  const r = Math.max(0.5, brushRadius);
  switch (shape) {
    case "boulder":
      return { scaleX: r, scaleY: r * 0.85, scaleZ: r };
    case "block":
      return { scaleX: r, scaleY: r * 0.7, scaleZ: r };
    case "pillar":
      return { scaleX: r * 0.55, scaleY: r * 1.4, scaleZ: r * 0.55 };
    case "spike":
      return { scaleX: r * 0.7, scaleY: r * 1.6, scaleZ: r * 0.7 };
    case "ramp":
      return { scaleX: r, scaleY: r * 0.55, scaleZ: r * 1.3 };
  }
}
