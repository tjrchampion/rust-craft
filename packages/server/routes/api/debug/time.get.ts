import { defineEventHandler, getQuery, createError } from "h3";
import { getGame } from "../../../game/instance";
import { IS_DEV } from "../../../utils/env";

// GET /api/debug/time?set=0.3  (0.3 ≈ midday, 0.8 ≈ midnight)
export default defineEventHandler((event) => {
  if (!IS_DEV) throw createError({ statusCode: 404 });
  const set = getQuery(event).set;
  if (set !== undefined) {
    getGame().setTimeOfDay(Number(set));
  }
  return { ok: true };
});
