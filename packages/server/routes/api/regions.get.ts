import { defineEventHandler } from "h3";
import { listRegionBlueprints } from "../../utils/regions";
import { ensureRegionWorldOrigins, type RegionMapEntry } from "@rustcraft/shared";

// GET /api/regions -- always-on (not IS_DEV-gated, unlike the debug routes)
// since this is needed in production: the client uses it to render the
// world portal for every saved region, and the region editor uses it to
// populate its region browser/selector. Also returns layout fields so the
// client can stream neighboring continent regions without a full blueprint,
// plus lightweight map overlays (villages / portals / events / quest NPCs)
// for the in-game world map.
export default defineEventHandler(() => {
  const list = listRegionBlueprints();
  ensureRegionWorldOrigins(list);
  const regions: RegionMapEntry[] = list.map((r) => ({
    id: r.id,
    name: r.name,
    biome: r.biome,
    portalWorldX: r.portalWorldX,
    portalWorldZ: r.portalWorldZ,
    gridSize: r.gridSize,
    pitch: r.pitch,
    worldOriginX: r.worldOriginX ?? 0,
    worldOriginZ: r.worldOriginZ ?? 0,
    isStartingRegion: r.isStartingRegion,
    entryLocal: r.entryLocal ?? { x: 0, z: 0 },
    // Lightweight atmosphere so the client can cross-fade hues at seams
    // before the full heightmap / mesh is mounted.
    colorGrading: r.colorGrading,
    villages: (r.villages ?? []).map((v) => ({
      name: v.name,
      localX: v.localX,
      localZ: v.localZ,
      radius: v.radius,
    })),
    portals: (r.portals ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      localX: p.localX,
      localZ: p.localZ,
      targetRegionId: p.targetRegionId,
    })),
    worldEvents: (r.worldEvents ?? []).map((e) => ({
      id: e.id,
      name: e.name,
      localX: e.localX,
      localZ: e.localZ,
      radius: e.radius,
    })),
    npcs: (r.npcs ?? []).map((n) => ({
      id: n.id,
      name: n.name,
      localX: n.localX,
      localZ: n.localZ,
      title: n.title,
      hasQuests:
        Boolean(n.quests?.length) ||
        (n.generateProceduralQuests !== false && !n.vendorId),
      vendorId: n.vendorId,
    })),
  }));
  return { regions };
});
