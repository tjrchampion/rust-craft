import { defineEventHandler } from "h3";
import { listRegionBlueprints } from "../../utils/regions";

// GET /api/regions -- always-on (not IS_DEV-gated, unlike the debug routes)
// since this is needed in production: the client uses it to render the
// world portal for every saved region, and the region editor uses it to
// populate its region browser/selector.
export default defineEventHandler(() => {
  const regions = listRegionBlueprints().map((r) => ({
    id: r.id,
    name: r.name,
    biome: r.biome,
    portalWorldX: r.portalWorldX,
    portalWorldZ: r.portalWorldZ,
  }));
  return { regions };
});
