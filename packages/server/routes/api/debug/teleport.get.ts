import { defineEventHandler, getQuery, createError } from "h3";
import { getGame } from "../../../game/instance";
import { IS_DEV } from "../../../utils/env";

// GET /api/debug/teleport?char=<id>&x=0&z=0
export default defineEventHandler((event) => {
  if (!IS_DEV) throw createError({ statusCode: 404 });
  const q = getQuery(event);
  const ok = getGame().debugTeleport(String(q.char ?? ""), Number(q.x ?? 0), Number(q.z ?? 0));
  return { ok };
});
