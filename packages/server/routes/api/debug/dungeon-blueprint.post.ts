import { defineEventHandler, readBody, createError } from "h3";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { IS_DEV } from "../../../utils/env";

const BLUEPRINTS_DIR = resolve(process.cwd(), "../shared/src/content/dungeonBlueprints");

// POST /api/debug/dungeon-blueprint { tier: number, blueprint: DungeonBlueprint }
// Writes straight into the shared package's content directory -- this is a
// single-developer local authoring tool (the dungeon editor), not a
// multi-tenant endpoint, so a direct repo fs write from a dev-gated route
// is acceptable here (same posture as every other packages/server/routes/
// api/debug/* route, all IS_DEV-gated).
export default defineEventHandler(async (event) => {
  if (!IS_DEV) throw createError({ statusCode: 404 });
  const body = await readBody(event);
  const tier = Number(body?.tier);
  if (!Number.isInteger(tier) || tier < 0) {
    throw createError({ statusCode: 400, statusMessage: "tier must be a non-negative integer" });
  }
  const blueprint = body?.blueprint;
  if (!blueprint || !Array.isArray(blueprint.assets)) {
    throw createError({ statusCode: 400, statusMessage: "blueprint.assets must be an array" });
  }
  const path = resolve(BLUEPRINTS_DIR, `${tier}.json`);
  writeFileSync(path, JSON.stringify(blueprint, null, 2) + "\n", "utf-8");
  return { ok: true };
});
