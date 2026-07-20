import { defineEventHandler, getQuery, createError } from "h3";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { IS_DEV } from "../../../utils/env";

const BLUEPRINTS_DIR = resolve(process.cwd(), "../shared/src/content/dungeonBlueprints");

// GET /api/debug/dungeon-blueprint?tier=0 -- reads the currently-saved
// blueprint straight off disk (not the bundled import) so the dungeon
// editor always resumes editing the latest save, even before a dev-server
// restart would pick up the file change.
export default defineEventHandler((event) => {
  if (!IS_DEV) throw createError({ statusCode: 404 });
  const q = getQuery(event);
  const tier = Number(q.tier ?? 0);
  const path = resolve(BLUEPRINTS_DIR, `${tier}.json`);
  if (!existsSync(path)) throw createError({ statusCode: 404, statusMessage: "No blueprint saved for this tier" });
  const blueprint = JSON.parse(readFileSync(path, "utf-8"));
  return { blueprint };
});
