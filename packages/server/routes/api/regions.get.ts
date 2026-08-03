import { defineEventHandler } from "h3";
import { listRegionBlueprints } from "../../utils/regions";
import { ensureRegionWorldOrigins } from "@rustcraft/shared";

// GET /api/regions -- always-on (not IS_DEV-gated, unlike the debug routes)
// since this is needed in production: the client uses it to render the
// world portal for every saved region, and the region editor uses it to
// populate its region browser/selector. Also returns layout fields so the
// client can stream neighboring continent regions without a full blueprint.
export default defineEventHandler(() => {
  const list = listRegionBlueprints();
  ensureRegionWorldOrigins(list);
  const regions = list.map((r) => ({
    id: r.id,
    name: r.name,
    biome: r.biome,
    portalWorldX: r.portalWorldX,
    portalWorldZ: r.portalWorldZ,
    gridSize: r.gridSize,
    pitch: r.pitch,
    worldOriginX: r.worldOriginX ?? 0,
    worldOriginZ: r.worldOriginZ ?? 0,
    // Lightweight atmosphere so the client can cross-fade hues at seams
    // before the full heightmap / mesh is mounted.
    colorGrading: r.colorGrading,
  }));
  return { regions };
});
