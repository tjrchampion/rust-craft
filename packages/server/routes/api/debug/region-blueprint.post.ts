import { defineEventHandler, readBody, createError } from "h3";
import { slugifyRegionName, type RegionBlueprint } from "@rustcraft/shared";
import { listRegionBlueprints, saveRegionBlueprint } from "../../../utils/regions";
import { IS_DEV } from "../../../utils/env";

// POST /api/debug/region-blueprint { blueprint: RegionBlueprint }
// IS_DEV-gated editor Save button, same posture as dungeon-blueprint.post.ts
// -- but unlike dungeon tiers (a fixed, small, hand-curated set), regions
// are freely created from the editor, so a blueprint with no id yet gets
// one assigned here (slugified from its name, de-duplicated against
// existing region ids) rather than the caller having to pick one.
export default defineEventHandler(async (event) => {
  if (!IS_DEV) throw createError({ statusCode: 404 });
  const body = await readBody(event);
  const blueprint = body?.blueprint as RegionBlueprint | undefined;
  if (!blueprint || !Array.isArray(blueprint.assets) || !Array.isArray(blueprint.heights)) {
    throw createError({ statusCode: 400, statusMessage: "blueprint.assets/heights must be arrays" });
  }
  let id = blueprint.id || "";
  if (!id) {
    const existingIds = new Set(listRegionBlueprints().map((r) => r.id));
    const base = slugifyRegionName(blueprint.name || "region");
    id = base;
    let n = 2;
    while (existingIds.has(id)) {
      id = `${base}_${n}`;
      n++;
    }
  }
  const toSave: RegionBlueprint = { ...blueprint, id };
  saveRegionBlueprint(id, toSave);
  return { ok: true, id };
});
