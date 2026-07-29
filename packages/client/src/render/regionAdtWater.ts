import * as THREE from "three";
import {
  ADT_RING,
  adtRingKeysInBounds,
  parseAdtKey,
  type RegionBlueprint,
} from "@rustcraft/shared";
import { buildRegionAdtWaterTile, createRegionWaterMaterial } from "./terrain";

const BUILDS_PER_FRAME = 3;

type WaterBlueprint = Pick<RegionBlueprint, "gridSize" | "pitch" | "heights"> & {
  waterHeights: number[];
};

/**
 * Streams 64 m ADT tiles of painted region water around the player.
 * Dry tiles are skipped (no mesh). Editor preview still uses the full mesh.
 */
export class RegionAdtWaterStreamer {
  readonly group = new THREE.Group();
  private material: THREE.MeshLambertMaterial;
  private tiles = new Map<string, THREE.Mesh>();
  /** Tiles known to have no water — skip rebuild attempts. */
  private dryTiles = new Set<string>();
  private pending: string[] = [];
  private lastAnchorKey = "";
  private readonly bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  private scrollT = 0;

  constructor(
    parent: THREE.Object3D,
    private blueprint: WaterBlueprint,
    private ring = ADT_RING,
  ) {
    this.group.name = "region-adt-water";
    const half = ((blueprint.gridSize - 1) * blueprint.pitch) / 2;
    this.bounds = { minX: -half, maxX: half, minZ: -half, maxZ: half };
    this.material = createRegionWaterMaterial();
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
      if (this.tiles.has(key) || this.dryTiles.has(key) || !desiredSet.has(key)) continue;
      const { ix, iz } = parseAdtKey(key);
      const mesh = buildRegionAdtWaterTile(this.blueprint, ix, iz, this.material);
      if (!mesh) {
        this.dryTiles.add(key);
        continue;
      }
      this.group.add(mesh);
      this.tiles.set(key, mesh);
      built++;
    }
  }

  /** Sync-build the full water ring (loading screen). */
  warm(x: number, z: number): void {
    const keys = this.desiredKeys(x, z);
    for (const key of keys) {
      if (this.tiles.has(key) || this.dryTiles.has(key)) continue;
      const { ix, iz } = parseAdtKey(key);
      const mesh = buildRegionAdtWaterTile(this.blueprint, ix, iz, this.material);
      if (!mesh) {
        this.dryTiles.add(key);
        continue;
      }
      this.group.add(mesh);
      this.tiles.set(key, mesh);
    }
    this.pending = [];
    this.lastAnchorKey = keys[0] ?? "";
  }

  /** Scroll the shared normal map. */
  updateScroll(dt: number): void {
    this.scrollT += dt;
    const normalMap = this.material.userData.waterNormalMap as THREE.Texture | undefined;
    if (!normalMap) return;
    normalMap.offset.set(
      this.scrollT * 0.02 + Math.sin(this.scrollT * 0.04) * 0.02,
      this.scrollT * 0.015,
    );
  }

  dispose(): void {
    for (const mesh of this.tiles.values()) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.tiles.clear();
    this.dryTiles.clear();
    this.pending = [];
    const normalMap = this.material.userData.waterNormalMap as THREE.Texture | undefined;
    normalMap?.dispose();
    this.material.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
    this.group.clear();
  }
}
