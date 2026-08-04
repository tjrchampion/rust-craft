import { defineEventHandler, getRouterParam, createError } from "h3";
import { ensureRegionWorldOrigins } from "@rustcraft/shared";
import { listRegionBlueprints, loadRegionBlueprint } from "../../../utils/regions";

// GET /api/regions/:id -- always-on, full blueprint. Fetched both by the
// client when a player actually walks through this region's portal (needs
// the full heightmap/assets to render the interior) and by the region
// editor when resuming an existing region for edits.
//
// worldOriginX/Z are only packed onto a blueprint once ensureRegionWorldOrigins
// runs over the *full* catalog (packing is order-dependent), so returning
// loadRegionBlueprint(id) in isolation used to ship an un-packed (undefined,
// treated as (0,0)) origin for any region that hasn't been explicitly
// authored with one -- the client would then mount that region's terrain at
// world (0,0) instead of the position /api/regions (and the server's own
// portal-teleport math) agree it lives at, so the ground under the player
// didn't match whichever region's mesh actually got streamed in. Running the
// same full-catalog pass here keeps this endpoint's answer consistent with
// every other place origins get computed.
export default defineEventHandler((event) => {
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "id is required" });
  const list = listRegionBlueprints();
  ensureRegionWorldOrigins(list);
  const blueprint = list.find((r) => r.id === id) ?? loadRegionBlueprint(id);
  if (!blueprint) throw createError({ statusCode: 404, statusMessage: "No region found for this id" });
  return { blueprint };
});
