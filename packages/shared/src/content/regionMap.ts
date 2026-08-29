import type { RegionBiome, RegionColorGrading } from "./regions";

/** Lightweight region summary for the in-game world map (not a full blueprint). */
export interface RegionMapVillage {
  name: string;
  localX: number;
  localZ: number;
  radius: number;
}

export interface RegionMapPortal {
  id: string;
  name: string;
  localX: number;
  localZ: number;
  targetRegionId: string;
}

export interface RegionMapEvent {
  id: string;
  name: string;
  localX: number;
  localZ: number;
  radius: number;
}

export interface RegionMapNpc {
  id: string;
  name: string;
  localX: number;
  localZ: number;
  title?: string;
  /** True when the NPC has authored or procedural quests. */
  hasQuests: boolean;
  vendorId?: string;
}

export interface RegionMapPoi {
  id: string;
  name: string;
  localX: number;
  localZ: number;
  revealShape: { x: number; z: number }[];
}

export interface RegionMapMobSpawn {
  id: string;
  mobTypeId?: string;
  localX: number;
  localZ: number;
  level?: number;
  radius?: number;
}

export interface RegionMapEntry {
  id: string;
  name: string;
  biome: RegionBiome;
  gridSize: number;
  pitch: number;
  worldOriginX: number;
  worldOriginZ: number;
  portalWorldX: number;
  portalWorldZ: number;
  isStartingRegion?: boolean;
  minLevel?: number;
  maxLevel?: number;
  entryLocal: { x: number; z: number };
  colorGrading?: RegionColorGrading;
  villages: RegionMapVillage[];
  portals: RegionMapPortal[];
  worldEvents: RegionMapEvent[];
  npcs: RegionMapNpc[];
  mobSpawns?: RegionMapMobSpawn[];
  pois?: RegionMapPoi[];
}
