import type { RegionBiome, RegionMapPoi } from "@rustcraft/shared";

/** Tile on the continent layout map (one authored region). */
export interface LayoutTile {
  id: string;
  name: string;
  biome: RegionBiome;
  gridSize: number;
  gridSizeX?: number;
  gridSizeZ?: number;
  pitch: number;
  worldOriginX: number;
  worldOriginZ: number;
  minLevel?: number;
  maxLevel?: number;
  /** True when this tile's origin differs from what was last loaded/saved. */
  dirty?: boolean;
  /** POI markers authored in this region -- lets the layout map show/edit
   *  fog-of-war reveal boundaries across every region at once. */
  pois?: RegionMapPoi[];
}
