import { defineEventHandler, getQuery, createError } from "h3";
import { getGame } from "../../../game/instance";
import { IS_DEV } from "../../../utils/env";

// GET /api/debug/spawnmob?char=<id>&type=skeleton_warrior
export default defineEventHandler((event) => {
  if (!IS_DEV) throw createError({ statusCode: 404 });
  const q = getQuery(event);
  const ok = getGame().debugSpawnMob(String(q.char ?? ""), String(q.type ?? "wolf"));
  return { ok };
});
