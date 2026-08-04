import { defineEventHandler, getQuery, createError } from "h3";
import { getGame } from "../../../game/instance";
import { IS_DEV } from "../../../utils/env";

// GET /api/debug/xp?char=<id>&amount=100
export default defineEventHandler((event) => {
  if (!IS_DEV) throw createError({ statusCode: 404 });
  const q = getQuery(event);
  const char = String(q.char ?? "");
  const amount = Number(q.amount ?? 0);
  const ok = getGame().debugGrantXp(char, amount);
  return { ok };
});
