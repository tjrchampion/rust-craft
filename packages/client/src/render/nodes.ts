import * as THREE from "three";
import {
  generateNodes,
  dist2D,
  TREE_VISIBLE_RADIUS,
  type WorldNode,
  type Biome,
} from "@rustcraft/shared";
import { buildRock, buildOreRock, buildBerryBush, buildBiomeTree, enableFogOnObject } from "./models";
import { buildGltfTree, type TreeKey } from "./natureAssets";
import { load } from "./gltf";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

function foliageFileToTreeKey(model: string | undefined): TreeKey | null {
  if (!model) return null;
  const key = model.replace(/\.(glb|gltf)$/i, "") as TreeKey;
  return key || null;
}

/** Match terrain ADT ring — trees/rocks beyond this are culled, not fog-hidden. */
const VISIBLE_RADIUS = TREE_VISIBLE_RADIUS;

/** Tint (+ optional glow accent for the precious tiers) per ore node type. */
const ORE_TINTS: Record<string, { tint: number; glow?: number }> = {
  copper_vein: { tint: 0xb87333 },
  tin_vein: { tint: 0xa8a8a0 },
  iron_deposit: { tint: 0x6b6660 },
  mithril_deposit: { tint: 0x7a9cb8, glow: 0x9fc9e0 },
  thorium_vein: { tint: 0x5a8f5a, glow: 0x7fffa0 },
};

/** Gather-particle spark color per node type, falling back to berry-red. */
const GATHER_PARTICLE_COLOR: Record<string, number> = {
  tree: 0x8a5a2f,
  rock: 0x9a9690,
  dungeon_chest_common: 0xd4af37,
  dungeon_chest_rare: 0xffd700,
  ...Object.fromEntries(Object.entries(ORE_TINTS).map(([id, { tint }]) => [id, tint])),
};

interface NodeEntry {
  node: WorldNode;
  mesh: THREE.Group | null;
  inScene: boolean;
  depleted: boolean;
  shakeUntil: number;
  baseX: number;
  baseZ: number;
}

interface Chip {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  born: number;
}

/** Build a gather-node mesh for gameplay or the region editor preview. */
export function buildGatherNodeMesh(
  type: string,
  variant = 0,
  biome: Biome = "forest",
  model?: string,
): THREE.Group {
  let mesh: THREE.Group;
  const ore = ORE_TINTS[type];
  if (type === "dungeon_chest_common" || type === "dungeon_chest_rare") {
    mesh = new THREE.Group();
    const chestModel = type === "dungeon_chest_rare" ? "chest_gold.gltf" : "chest.gltf";
    load(`/assets/models/props/${chestModel}`).then((gltf) => {
      const clone = SkeletonUtils.clone(gltf.scene);
      clone.scale.set(1.2, 1.2, 1.2);
      clone.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      enableFogOnObject(clone);
      mesh.add(clone);
    });
  } else if (type === "tree") {
    const key = foliageFileToTreeKey(model);
    mesh = (key ? buildGltfTree(key, variant) : null) ?? buildBiomeTree(biome, variant);
    enableFogOnObject(mesh);
  } else if (ore) {
    mesh = buildOreRock(variant, ore.tint, ore.glow);
    enableFogOnObject(mesh);
  } else if (type === "rock") {
    mesh = buildRock(variant);
    enableFogOnObject(mesh);
  } else {
    mesh = buildBerryBush(variant);
    enableFogOnObject(mesh);
  }
  return mesh;
}

export class NodeManager {
  readonly nodes = new Map<string, NodeEntry>();
  private scene: THREE.Scene;
  private lastWindowUpdate = 0;
  private chips: Chip[] = [];

  constructor(scene: THREE.Scene, depletedIds: string[], nodes: WorldNode[] = generateNodes()) {
    this.scene = scene;
    const depleted = new Set(depletedIds);
    for (const node of nodes) {
      this.nodes.set(node.id, {
        node,
        mesh: null,
        inScene: false,
        depleted: depleted.has(node.id),
        shakeUntil: 0,
        baseX: node.x,
        baseZ: node.z,
      });
    }
  }

  addDynamicNodes(nodesList: WorldNode[]): void {
    for (const node of nodesList) {
      if (!this.nodes.has(node.id)) {
        this.nodes.set(node.id, {
          node,
          mesh: null,
          inScene: false,
          depleted: false,
          shakeUntil: 0,
          baseX: node.x,
          baseZ: node.z,
        });
      }
    }
  }

  /** Drop nodes whose ids start with `prefix` (e.g. `region_`). */
  removeByIdPrefix(prefix: string): void {
    for (const [id, entry] of [...this.nodes.entries()]) {
      if (!id.startsWith(prefix)) continue;
      if (entry.inScene && entry.mesh) this.scene.remove(entry.mesh);
      this.nodes.delete(id);
    }
  }

  /** Drop authored region gather nodes (`region_*_node_*`). */
  removeRegionResourceNodes(): void {
    for (const [id, entry] of [...this.nodes.entries()]) {
      if (!id.startsWith("region_") || !id.includes("_node")) continue;
      if (entry.inScene && entry.mesh) this.scene.remove(entry.mesh);
      this.nodes.delete(id);
    }
  }

  /** Replace all nodes (keeps depleted flags for ids that persist). */
  replaceAll(nodesList: WorldNode[], depletedIds: Iterable<string> = []): void {
    const depleted = new Set(depletedIds);
    const keepDepleted = new Map<string, boolean>();
    for (const [id, entry] of this.nodes) keepDepleted.set(id, entry.depleted);
    this.clearScene();
    this.nodes.clear();
    for (const node of nodesList) {
      this.nodes.set(node.id, {
        node,
        mesh: null,
        inScene: false,
        depleted: depleted.has(node.id) || keepDepleted.get(node.id) === true,
        shakeUntil: 0,
        baseX: node.x,
        baseZ: node.z,
      });
    }
  }

  hitNode(nodeId: string): void {
    const entry = this.nodes.get(nodeId);
    if (!entry) return;
    entry.shakeUntil = performance.now() + 220;

    const color = GATHER_PARTICLE_COLOR[entry.node.type] ?? 0xc23b4e;
    const count = 7;
    for (let i = 0; i < count; i++) {
      const chip = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.09, 0.09),
        new THREE.MeshLambertMaterial({ color }),
      );
      chip.position.set(entry.node.x, entry.node.y + 1.0 + Math.random() * 0.6, entry.node.z);
      this.scene.add(chip);
      const ang = Math.random() * Math.PI * 2;
      const spd = 1.5 + Math.random() * 2;
      this.chips.push({
        mesh: chip,
        vx: Math.cos(ang) * spd,
        vy: 2 + Math.random() * 2,
        vz: Math.sin(ang) * spd,
        born: performance.now(),
      });
    }
  }

  setDepleted(nodeId: string, depleted: boolean): void {
    const entry = this.nodes.get(nodeId);
    if (!entry) return;
    entry.depleted = depleted;
    if (entry.mesh) entry.mesh.visible = !depleted;
  }

  /** Remove all currently active node meshes from the scene (e.g. when entering a region or dungeon). */
  clearScene(): void {
    for (const entry of this.nodes.values()) {
      if (entry.inScene && entry.mesh) {
        this.scene.remove(entry.mesh);
        entry.inScene = false;
      }
    }
  }

  /** Drop mesh GPU objects while keeping node metadata (depleted flags, positions). */
  disposeVisuals(): void {
    for (const entry of this.nodes.values()) {
      if (entry.mesh) {
        this.scene.remove(entry.mesh);
        entry.mesh.traverse((o) => {
          const im = o as THREE.InstancedMesh;
          if (im.isInstancedMesh) im.dispose();
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh || mesh.userData.fromGltf) return;
          mesh.geometry?.dispose();
        });
        entry.mesh = null;
        entry.inScene = false;
      }
    }
    for (const c of this.chips) this.scene.remove(c.mesh);
    this.chips.length = 0;
  }

  /** Spatial windowing (throttled) + per-frame shake/particle animation. */
  update(px: number, pz: number, timeMs: number, dt = 0.016): void {
    // Windowing: only re-evaluate which nodes are in-scene a few times a second.
    if (timeMs - this.lastWindowUpdate >= 800) {
      this.lastWindowUpdate = timeMs;
      for (const entry of this.nodes.values()) {
        const near = dist2D(px, pz, entry.node.x, entry.node.z) < VISIBLE_RADIUS;
        if (near && !entry.inScene) {
          if (!entry.mesh) entry.mesh = this.buildMesh(entry.node);
          entry.mesh.visible = !entry.depleted;
          this.scene.add(entry.mesh);
          entry.inScene = true;
        } else if (!near && entry.inScene && entry.mesh) {
          this.scene.remove(entry.mesh);
          entry.inScene = false;
        }
      }
    }

    // Node shake (wobble the mesh briefly after a gather hit).
    for (const entry of this.nodes.values()) {
      if (!entry.mesh || !entry.inScene) continue;
      if (entry.shakeUntil > timeMs) {
        const s = (entry.shakeUntil - timeMs) / 220;
        entry.mesh.position.x = entry.baseX + Math.sin(timeMs / 18) * 0.08 * s;
        entry.mesh.position.z = entry.baseZ + Math.cos(timeMs / 15) * 0.08 * s;
        entry.mesh.rotation.z = Math.sin(timeMs / 20) * 0.04 * s;
      } else if (entry.mesh.position.x !== entry.baseX) {
        entry.mesh.position.x = entry.baseX;
        entry.mesh.position.z = entry.baseZ;
        entry.mesh.rotation.z = 0;
      }
    }

    // Chip particles: simple ballistic + fade, removed after ~0.8s.
    for (let i = this.chips.length - 1; i >= 0; i--) {
      const c = this.chips[i]!;
      const age = (timeMs - c.born) / 800;
      if (age >= 1) {
        this.scene.remove(c.mesh);
        this.chips.splice(i, 1);
        continue;
      }
      c.vy -= 9.8 * dt;
      c.mesh.position.x += c.vx * dt;
      c.mesh.position.y += c.vy * dt;
      c.mesh.position.z += c.vz * dt;
      c.mesh.rotation.x += dt * 6;
      c.mesh.rotation.y += dt * 5;
      (c.mesh.material as THREE.MeshLambertMaterial).opacity = 1 - age;
      (c.mesh.material as THREE.MeshLambertMaterial).transparent = true;
    }
  }

  private buildMesh(node: WorldNode): THREE.Group {
    const mesh = buildGatherNodeMesh(node.type, node.variant, node.biome, node.model);
    mesh.position.set(node.x, node.y, node.z);
    return mesh;
  }

  /** Best gatherable node near a position facing a direction, or null. */
  findTarget(px: number, py: number, pz: number, yaw: number, range: number): WorldNode | null {
    let best: WorldNode | null = null;
    let bestScore = Infinity;
    for (const entry of this.nodes.values()) {
      if (entry.depleted) continue;
      const { node } = entry;
      const d = dist2D(px, pz, node.x, node.z);
      if (d > range) continue;
      if (Math.abs(node.y - py) > 6) continue;
      const angleTo = Math.atan2(node.x - px, node.z - pz);
      let da = angleTo - yaw;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      if (Math.abs(da) > 1.2 && d > 1.5) continue;
      const score = d + Math.abs(da) * 1.5;
      if (score < bestScore) {
        bestScore = score;
        best = node;
      }
    }
    return best;
  }
}
