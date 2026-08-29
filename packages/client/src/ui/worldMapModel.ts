import {
  regionHalfSpan,
  regionLocalToWorld,
  regionWorldBounds,
  REGION_BIOME_LABELS,
  type RegionBiome,
  type RegionMapEntry,
} from "@rustcraft/shared";

export type MapViewMode = "world" | "region";

export interface MapFilters {
  villages: boolean;
  quests: boolean;
  events: boolean;
  portals: boolean;
  npcs: boolean;
  mobs: boolean;
  pois: boolean;
}

export const DEFAULT_MAP_FILTERS: MapFilters = {
  villages: true,
  quests: true,
  events: true,
  portals: true,
  npcs: true,
  mobs: true,
  pois: true,
};

export const BIOME_FILL: Record<RegionBiome, string> = {
  grassland: "#3d6b32",
  forest: "#2a5234",
  jungle: "#1a5a32",
  desert: "#b8944a",
  arctic: "#6a8fa8",
  swamp: "#2f5644",
  volcanic: "#7a3228",
  alien: "#5a3a78",
  underground: "#3a3640",
  cosmic: "#2e3a72",
};

export function biomeLabel(biome: RegionBiome): string {
  return REGION_BIOME_LABELS[biome] ?? biome;
}

export interface RegionZoneMeta {
  title: string;
  levelRange: string;
  minLevel: number;
  maxLevel: number;
  description: string;
}

export const REGION_ZONE_META: Record<string, RegionZoneMeta> = {
  new_region: {
    title: "The Emerald Valleys",
    levelRange: "Levels 1 to 10",
    minLevel: 1,
    maxLevel: 10,
    description: "A lush starting valley surrounded by rolling green hills, ancient shrines, and tranquil river streams.",
  },
  region_two: {
    title: "The Frostpeak Reach",
    levelRange: "Levels 10 to 20",
    minLevel: 10,
    maxLevel: 20,
    description: "Rugged highland plateaus filled with iron veins, wild beasts, and treacherous icy mountain passes.",
  },
};

function strHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function getRegionZoneMeta(region: RegionMapEntry): RegionZoneMeta {
  const meta = REGION_ZONE_META[region.id];
  const hasAuthoredLevel = typeof region.minLevel === "number" || typeof region.maxLevel === "number";
  const minLvl = region.minLevel ?? meta?.minLevel ?? ((strHash(region.id) % 6) * 3 + 1);
  const maxLvl = region.maxLevel ?? meta?.maxLevel ?? (region.minLevel ? region.minLevel + 3 : minLvl + 4);
  const levelRange = minLvl === maxLvl ? `Level ${minLvl}` : `Levels ${minLvl} to ${maxLvl}`;
  return {
    title: region.name || meta?.title || "Uncharted Domain",
    levelRange,
    minLevel: minLvl,
    maxLevel: maxLvl,
    description: meta?.description ?? (hasAuthoredLevel
      ? `A level ${minLvl}–${maxLvl} region filled with dangerous wildlife, ancient ruins, and valuable resources.`
      : "An uncharted fantasy region filled with dangerous wildlife, ancient ruins, and valuable resources."),
  };
}

export function continentBounds(regions: RegionMapEntry[]): {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
} {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const r of regions) {
    const b = regionWorldBounds(r);
    minX = Math.min(minX, b.minX);
    maxX = Math.max(maxX, b.maxX);
    minZ = Math.min(minZ, b.minZ);
    maxZ = Math.max(maxZ, b.maxZ);
  }
  if (!Number.isFinite(minX)) {
    return { minX: -100, maxX: 100, minZ: -100, maxZ: 100 };
  }
  return { minX, maxX, minZ, maxZ };
}

/** Camera that maps world (x,z) → screen (sx,sy) in the editor's authored
 * world-space layout. */
export class MapCamera {
  scale = 0.4;
  /** Screen-space offset applied after projecting around focus. */
  panX = 0;
  panY = 0;
  focusX = 0;
  focusZ = 0;
  width = 800;
  height = 600;

  resize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
  }

  worldToScreen(wx: number, wz: number): { x: number; y: number } {
    return {
      x: (wx - this.focusX) * this.scale + this.width / 2 + this.panX,
      y: (wz - this.focusZ) * this.scale + this.height / 2 + this.panY,
    };
  }

  screenToWorld(sx: number, sy: number): { x: number; z: number } {
    return {
      x: (sx - this.width / 2 - this.panX) / this.scale + this.focusX,
      z: (sy - this.height / 2 - this.panY) / this.scale + this.focusZ,
    };
  }

  metersToPixels(m: number): number {
    return m * this.scale;
  }

  /** Fit axis-aligned world bounds into the viewport with padding (px). */
  fitBounds(
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    padding = 60,
  ): void {
    const spanX = Math.max(1, maxX - minX);
    const spanZ = Math.max(1, maxZ - minZ);
    const availW = Math.max(1, this.width - padding * 2);
    const availH = Math.max(1, this.height - padding * 2);
    this.scale = Math.min(availW / spanX, availH / spanZ);
    this.focusX = (minX + maxX) / 2;
    this.focusZ = (minZ + maxZ) / 2;
    this.panX = 0;
    this.panY = 0;
  }

  pan(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
  }

  fitContinent(regions: RegionMapEntry[], padPx = 64): void {
    const b = continentBounds(regions);
    this.fitBounds(b.minX, b.maxX, b.minZ, b.maxZ, padPx);
  }

  fitRegion(region: RegionMapEntry, padPx = 48): void {
    const b = regionWorldBounds(region);
    this.fitBounds(b.minX, b.maxX, b.minZ, b.maxZ, padPx);
  }

  zoomAt(sx: number, sy: number, factor: number, min = 0.05, max = 8): void {
    const before = this.screenToWorld(sx, sy);
    this.scale = Math.min(max, Math.max(min, this.scale * factor));
    const after = this.screenToWorld(sx, sy);
    this.panX += (after.x - before.x) * this.scale;
    this.panY += (after.z - before.z) * this.scale;
  }
}

export function regionTilePath(cam: MapCamera, region: RegionMapEntry): string {
  const b = regionWorldBounds(region);
  const tl = cam.worldToScreen(b.minX, b.maxZ);
  const tr = cam.worldToScreen(b.maxX, b.maxZ);
  const br = cam.worldToScreen(b.maxX, b.minZ);
  const bl = cam.worldToScreen(b.minX, b.minZ);
  return `M ${tl.x} ${tl.y} L ${tr.x} ${tr.y} L ${br.x} ${br.y} L ${bl.x} ${bl.y} Z`;
}

export function hitTestRegion(
  regions: RegionMapEntry[],
  wx: number,
  wz: number,
): RegionMapEntry | null {
  let best: RegionMapEntry | null = null;
  let bestArea = Infinity;
  for (const r of regions) {
    const half = regionHalfSpan(r);
    const ox = r.worldOriginX;
    const oz = r.worldOriginZ;
    if (wx < ox - half || wx > ox + half || wz < oz - half || wz > oz + half) continue;
    const area = half * half * 4;
    if (area < bestArea) {
      best = r;
      bestArea = area;
    }
  }
  return best;
}

export interface MapMarker {
  id: string;
  kind: "village" | "quest" | "questNpc" | "event" | "portal" | "npc" | "entry" | "player" | "party" | "mobSpawn" | "poi";
  x: number;
  z: number;
  label: string;
  sub?: string;
  /** Quest marker style when kind is quest. */
  questMarker?: "available" | "complete" | "active" | "escort" | "kill";
  eventPhase?: "cooldown" | "active" | "success" | "failed";
  radius?: number;
  regionId?: string;
}

export function buildStaticMarkers(
  regions: RegionMapEntry[],
  filters: MapFilters,
  focusRegionId: string | null,
  discoveredPoiIds?: ReadonlySet<string>,
): MapMarker[] {
  const out: MapMarker[] = [];
  for (const r of regions) {
    if (focusRegionId && r.id !== focusRegionId) continue;

    if (filters.pois) {
      for (const p of r.pois ?? []) {
        if (discoveredPoiIds && !discoveredPoiIds.has(p.id)) continue;
        const w = regionLocalToWorld(r, p.localX, p.localZ);
        out.push({
          id: `poi:${r.id}:${p.id}`,
          kind: "poi",
          x: w.x,
          z: w.z,
          label: p.name,
          sub: "Landmark",
          regionId: r.id,
        });
      }
    }

    if (filters.villages) {
      for (const v of r.villages ?? []) {
        const w = regionLocalToWorld(r, v.localX, v.localZ);
        out.push({
          id: `vil:${r.id}:${v.name}:${v.localX},${v.localZ}`,
          kind: "village",
          x: w.x,
          z: w.z,
          label: v.name,
          radius: v.radius,
          regionId: r.id,
        });
      }
    }

    if (filters.mobs) {
      for (const m of r.mobSpawns ?? []) {
        const w = regionLocalToWorld(r, m.localX, m.localZ);
        const name = m.mobTypeId ? m.mobTypeId.replace(/_/g, " ") : "Mob Spawn";
        out.push({
          id: `mob:${r.id}:${m.id}`,
          kind: "mobSpawn",
          x: w.x,
          z: w.z,
          label: name,
          sub: m.level ? `Lvl ${m.level}` : undefined,
          regionId: r.id,
          radius: m.radius,
        });
      }
    }

    if (filters.portals) {
      for (const p of r.portals ?? []) {
        const w = regionLocalToWorld(r, p.localX, p.localZ);
        out.push({
          id: `por:${r.id}:${p.id}`,
          kind: "portal",
          x: w.x,
          z: w.z,
          label: p.name || "Portal",
          sub: p.targetRegionId,
          regionId: r.id,
        });
      }
      // Legacy overworld portal anchor (if placed).
      if (r.portalWorldX !== 0 || r.portalWorldZ !== 0) {
        out.push({
          id: `por-world:${r.id}`,
          kind: "portal",
          x: r.portalWorldX,
          z: r.portalWorldZ,
          label: `${r.name} Gate`,
          regionId: r.id,
        });
      }
    }

    if (filters.events) {
      for (const e of r.worldEvents ?? []) {
        const w = regionLocalToWorld(r, e.localX, e.localZ);
        out.push({
          id: `evt:${r.id}:${e.id}`,
          kind: "event",
          x: w.x,
          z: w.z,
          label: e.name,
          radius: e.radius,
          regionId: r.id,
          eventPhase: "cooldown",
        });
      }
    }

    if (filters.npcs || filters.quests) {
      for (const n of r.npcs ?? []) {
        const w = regionLocalToWorld(r, n.localX, n.localZ);
        if (filters.quests && n.hasQuests) {
          out.push({
            id: `qnpc:${r.id}:${n.id}`,
            kind: "questNpc",
            x: w.x,
            z: w.z,
            label: n.name,
            sub: n.title,
            regionId: r.id,
          });
        } else if (filters.npcs) {
          out.push({
            id: `npc:${r.id}:${n.id}`,
            kind: "npc",
            x: w.x,
            z: w.z,
            label: n.name,
            sub: n.title ?? (n.vendorId ? "Vendor" : undefined),
            regionId: r.id,
          });
        }
      }
    }

    // Spawn / entry point marker in region view.
    if (focusRegionId === r.id) {
      const entry = r.entryLocal ?? { x: 0, z: 0 };
      const w = regionLocalToWorld(r, entry.x, entry.z);
      out.push({
        id: `entry:${r.id}`,
        kind: "entry",
        x: w.x,
        z: w.z,
        label: "Entry",
        regionId: r.id,
      });
    }
  }
  return out;
}
