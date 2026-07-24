import { defineEventHandler, getRouterParam, createError } from "h3";
import { loadRegionBlueprint } from "../../../utils/regions";

// GET /api/regions/:id -- always-on, full blueprint. Fetched both by the
// client when a player actually walks through this region's portal (needs
// the full heightmap/assets to render the interior) and by the region
// editor when resuming an existing region for edits.
export default defineEventHandler((event) => {
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "id is required" });
  const blueprint = loadRegionBlueprint(id);
  if (!blueprint) throw createError({ statusCode: 404, statusMessage: "No region found for this id" });
  return { blueprint };
});
