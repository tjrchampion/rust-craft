import type { RegionBiome } from "@rustcraft/shared";

/** Tile on the continent layout map (one authored region). */
export interface LayoutTile {
  id: string;
  name: string;
  biome: RegionBiome;
  gridSize: number;
  pitch: number;
  worldOriginX: number;
  worldOriginZ: number;
  /** True when this tile's origin differs from what was last loaded/saved. */
  dirty?: boolean;
}
