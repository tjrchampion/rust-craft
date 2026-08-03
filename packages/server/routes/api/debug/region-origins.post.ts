import { defineEventHandler, readBody, createError } from "h3";
import { loadRegionBlueprint, saveRegionBlueprint } from "../../../utils/regions";
import { IS_DEV } from "../../../utils/env";
import { getGame } from "../../../game/instance";

interface OriginPatch {
  id: string;
  worldOriginX: number;
  worldOriginZ: number;
}

/**
 * POST /api/debug/region-origins
 * { origins: { id, worldOriginX, worldOriginZ }[] }
 *
 * Lightweight continent-layout save — patches world origins without rewriting
 * the full blueprint payload from the 3D editor.
 */
export default defineEventHandler(async (event) => {
  if (!IS_DEV) throw createError({ statusCode: 404 });
  const body = await readBody(event);
  const origins = body?.origins as OriginPatch[] | undefined;
  if (!Array.isArray(origins) || origins.length === 0) {
    throw createError({ statusCode: 400, statusMessage: "origins[] required" });
  }

  const saved: string[] = [];
  for (const patch of origins) {
    if (!patch?.id || typeof patch.worldOriginX !== "number" || typeof patch.worldOriginZ !== "number") {
      continue;
    }
    const bp = loadRegionBlueprint(patch.id);
    if (!bp) continue;
    const next = {
      ...bp,
      worldOriginX: patch.worldOriginX,
      worldOriginZ: patch.worldOriginZ,
    };
    saveRegionBlueprint(patch.id, next);
    getGame().updateRegionWorldOrigin(patch.id, patch.worldOriginX, patch.worldOriginZ);
    saved.push(patch.id);
  }

  return { ok: true, saved };
});
