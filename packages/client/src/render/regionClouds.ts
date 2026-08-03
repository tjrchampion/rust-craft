import * as THREE from "three";
import { hashString, type RegionCloud, type RegionCloudShape, type RegionWind } from "@rustcraft/shared";

function puffMaterial(color: string, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: Math.max(0.05, Math.min(1, opacity)),
    depthWrite: false,
    fog: true,
  });
}

function buildPuffs(shape: RegionCloudShape, seed: number): THREE.Group {
  const group = new THREE.Group();
  let s = seed >>> 0;
  const rng = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  const count =
    shape === "wispy" ? 3 + Math.floor(rng() * 2) : shape === "flat" ? 2 + Math.floor(rng() * 2) : 4 + Math.floor(rng() * 4);
  for (let i = 0; i < count; i++) {
    const r = shape === "wispy" ? 4 + rng() * 5 : 5 + rng() * 7;
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), new THREE.MeshBasicMaterial());
    if (shape === "wispy") {
      puff.scale.set(1.6 + rng(), 0.22 + rng() * 0.15, 0.7 + rng() * 0.4);
      puff.position.set((rng() - 0.5) * 28, (rng() - 0.5) * 1.2, (rng() - 0.5) * 8);
    } else if (shape === "flat") {
      puff.scale.set(1.4 + rng() * 0.6, 0.18 + rng() * 0.1, 1.2 + rng() * 0.5);
      puff.position.set((rng() - 0.5) * 18, (rng() - 0.5) * 0.8, (rng() - 0.5) * 14);
    } else {
      puff.scale.set(1, 0.42, 1);
      puff.position.set((rng() - 0.5) * 20, (rng() - 0.5) * 2.2, (rng() - 0.5) * 14);
    }
    group.add(puff);
  }
  return group;
}

export function createRegionCloudMesh(cloud: RegionCloud): THREE.Group {
  const seed = hashString(cloud.id ?? `${cloud.localX},${cloud.localZ}`);
  const group = buildPuffs(cloud.shape, seed);
  group.name = `cloud:${cloud.id ?? "anon"}`;
  syncRegionCloudMesh(group, cloud);
  return group;
}

export function syncRegionCloudMesh(group: THREE.Group, cloud: RegionCloud): void {
  group.position.set(cloud.localX, cloud.localY, cloud.localZ);
  group.rotation.set(0, cloud.yaw, 0);
  group.scale.set(
    Math.max(0.15, cloud.scaleX),
    Math.max(0.1, cloud.scaleY),
    Math.max(0.15, cloud.scaleZ),
  );
  const color = new THREE.Color(cloud.color);
  const opacity = Math.max(0.05, Math.min(1, cloud.opacity));
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    if (mat?.isMeshBasicMaterial) {
      mat.color.copy(color);
      mat.opacity = opacity;
      mat.transparent = true;
      mat.depthWrite = false;
      mat.fog = true;
      mat.needsUpdate = true;
    } else {
      mesh.material = puffMaterial(cloud.color, cloud.opacity);
    }
  });
  group.userData.cloudData = { ...cloud };
  group.userData.cloudPhase = group.userData.cloudPhase ?? Math.random() * Math.PI * 2;
  group.userData.cloudBaseY = cloud.localY;
  group.userData.cloudBaseX = cloud.localX;
  group.userData.cloudBaseZ = cloud.localZ;
}

export interface RegionCloudRuntime {
  group: THREE.Group;
  update(dt: number, wind?: RegionWind | null): void;
  dispose(): void;
}

/** Animate authored clouds: drift along yaw-local +X (or wind) + gentle bob. */
export function createRegionCloudRuntime(parent: THREE.Object3D, clouds: RegionCloud[]): RegionCloudRuntime {
  const group = new THREE.Group();
  group.name = "region-clouds";
  parent.add(group);
  const meshes: THREE.Group[] = [];
  for (const c of clouds) {
    const m = createRegionCloudMesh(c);
    meshes.push(m);
    group.add(m);
  }

  let t = 0;
  function update(dt: number, wind?: RegionWind | null): void {
    t += dt;
    const windRad = ((wind?.direction ?? 0) * Math.PI) / 180;
    const windStr = wind?.strength ?? 1;
    for (const m of meshes) {
      const data = m.userData.cloudData as RegionCloud | undefined;
      if (!data) continue;
      const speed = (data.driftSpeed ?? 1.2) * (0.65 + 0.35 * windStr);
      const useWind = wind != null;
      const dir = useWind ? windRad : data.yaw;
      const dx = Math.cos(dir) * speed * dt;
      const dz = Math.sin(dir) * speed * dt;
      m.position.x += dx;
      m.position.z += dz;
      // Soft wrap around a generous play envelope so clouds recirculate.
      const baseX = m.userData.cloudBaseX as number;
      const baseZ = m.userData.cloudBaseZ as number;
      const wrap = 220;
      if (m.position.x - baseX > wrap) m.position.x -= wrap * 2;
      if (m.position.x - baseX < -wrap) m.position.x += wrap * 2;
      if (m.position.z - baseZ > wrap) m.position.z -= wrap * 2;
      if (m.position.z - baseZ < -wrap) m.position.z += wrap * 2;
      const phase = (m.userData.cloudPhase as number) + t * 0.35;
      const bob = data.bobAmp ?? 0.4;
      m.position.y = (m.userData.cloudBaseY as number) + Math.sin(phase) * bob;
    }
  }

  function dispose(): void {
    parent.remove(group);
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        const mat = mesh.material as THREE.Material;
        mat?.dispose?.();
      }
    });
  }

  return { group, update, dispose };
}
