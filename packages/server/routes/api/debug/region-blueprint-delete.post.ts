import { defineEventHandler, readBody, createError } from "h3";
import {
  deleteRegionBlueprint,
  listRegionBlueprints,
  loadRegionBlueprint,
  scrubPortalLinksToRegion,
} from "../../../utils/regions";
import { IS_DEV } from "../../../utils/env";
import { getGame } from "../../../game/instance";

// POST /api/debug/region-blueprint-delete { id: string }
// Permanently removes a region JSON, scrubs portal links targeting it from
// other regions, and unregisters live server state (mobs/NPCs/nodes/players).
export default defineEventHandler(async (event) => {
  if (!IS_DEV) throw createError({ statusCode: 404 });
  const body = await readBody(event);
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) throw createError({ statusCode: 400, statusMessage: "id required" });

  const existing = loadRegionBlueprint(id);
  if (!existing) throw createError({ statusCode: 404, statusMessage: "Region not found" });

  const remaining = listRegionBlueprints().filter((r) => r.id !== id);
  if (remaining.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Cannot delete the last remaining region",
    });
  }

  // Scrub portal links while the deleted file still exists in the list scan
  // (scrub skips deletedId itself; delete file after).
  const cleanedPortalRefs = scrubPortalLinksToRegion(id);
  const removed = deleteRegionBlueprint(id);
  if (!removed) throw createError({ statusCode: 404, statusMessage: "Region file missing" });

  // Reload scrubbed blueprints into the live game so portals stay consistent.
  const game = getGame();
  for (const cleanedId of cleanedPortalRefs) {
    const bp = loadRegionBlueprint(cleanedId);
    if (bp) game.registerRegionBlueprint(bp);
  }
  game.unregisterRegionBlueprint(id);

  return {
    ok: true,
    id,
    name: existing.name,
    cleanedPortalRefs,
    wasStartingRegion: !!existing.isStartingRegion,
  };
});
