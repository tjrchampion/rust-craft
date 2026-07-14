import * as THREE from "three";
import { generateNodes, dist2D, type WorldNode } from "@rustcraft/shared";
import { buildRock, buildBerryBush, buildBiomeTree } from "./models";

const VISIBLE_RADIUS = 220; // only keep nearby node meshes in the scene

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

  /** Gather feedback: shake the node and spew a burst of chip particles. */
  hitNode(nodeId: string): void {
    const entry = this.nodes.get(nodeId);
    if (!entry) return;
    entry.shakeUntil = performance.now() + 220;

    const color =
      entry.node.type === "tree" ? 0x8a5a2f : entry.node.type === "rock" ? 0x9a9690 : 0xc23b4e;
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
    let mesh: THREE.Group;
    if (node.type === "tree") {
      mesh = buildBiomeTree(node.biome, node.variant);
    } else if (node.type === "rock") {
      mesh = buildRock(node.variant);
    } else {
      mesh = buildBerryBush(node.variant);
    }
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
