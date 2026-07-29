import * as THREE from "three";
import {
  ADT_RING,
  adtRingKeysInBounds,
  parseAdtKey,
  type RegionBlueprint,
} from "@rustcraft/shared";
import { buildRegionAdtTile, createAdtTerrainMaterial } from "./terrain";

const BUILDS_PER_FRAME = 3;

/**
 * Streams 64 m ADT tiles of an editor region's heightmap around the player.
 * Editor preview keeps the full mesh; runtime interiors use this.
 */
export class RegionAdtTerrainStreamer {
  readonly group = new THREE.Group();
  private material: THREE.MeshLambertMaterial;
  private tiles = new Map<string, THREE.Mesh>();
  private pending: string[] = [];
  private lastAnchorKey = "";
  private readonly half: number;
  private readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };

  constructor(
    parent: THREE.Object3D,
    private blueprint: Pick<
      RegionBlueprint,
      "gridSize" | "pitch" | "heights" | "biome" | "roads" | "colorGrading" | "customTextures"
    >,
    private ring = ADT_RING,
  ) {
    this.group.name = "region-adt-terrain";
    this.half = ((blueprint.gridSize - 1) * blueprint.pitch) / 2;
    this.bounds = {
      minX: -this.half,
      maxX: this.half,
      minZ: -this.half,
      maxZ: this.half,
    };
    this.material = createAdtTerrainMaterial();
    parent.add(this.group);
  }

  private desiredKeys(x: number, z: number): string[] {
    return adtRingKeysInBounds(x, z, this.ring, this.bounds);
  }

  update(x: number, z: number): void {
    const desired = this.desiredKeys(x, z);
    const desiredSet = new Set(desired);
    const anchor = desired[0] ?? "";

    if (anchor !== this.lastAnchorKey) {
      this.lastAnchorKey = anchor;
      this.pending = desired.filter((k) => !this.tiles.has(k));
    } else {
      for (const k of desired) {
        if (!this.tiles.has(k) && !this.pending.includes(k)) this.pending.push(k);
      }
    }

    for (const [key, mesh] of this.tiles) {
      if (desiredSet.has(key)) continue;
      this.group.remove(mesh);
      mesh.geometry.dispose();
      this.tiles.delete(key);
    }

    let built = 0;
    while (built < BUILDS_PER_FRAME && this.pending.length > 0) {
      const key = this.pending.shift()!;
      if (this.tiles.has(key) || !desiredSet.has(key)) continue;
      const { ix, iz } = parseAdtKey(key);
      const mesh = buildRegionAdtTile(this.blueprint, ix, iz, this.material);
      if (!mesh) continue;
      this.group.add(mesh);
      this.tiles.set(key, mesh);
      built++;
    }
  }

  /** Sync-build the full stream ring around (x,z) before the loading screen drops. */
  warm(x: number, z: number): void {
    const keys = this.desiredKeys(x, z);
    for (const key of keys) {
      if (this.tiles.has(key)) continue;
      const { ix, iz } = parseAdtKey(key);
      const mesh = buildRegionAdtTile(this.blueprint, ix, iz, this.material);
      if (!mesh) continue;
      this.group.add(mesh);
      this.tiles.set(key, mesh);
    }
    this.pending = [];
    this.lastAnchorKey = keys[0] ?? "";
  }

  get tileCount(): number {
    return this.tiles.size;
  }

  dispose(): void {
    for (const mesh of this.tiles.values()) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.tiles.clear();
    this.pending = [];
    this.material.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
    this.group.clear();
  }
}
