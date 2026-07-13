import { defineEventHandler, getQuery, createError } from "h3";
import { getGame } from "../../../game/instance";
import { IS_DEV } from "../../../utils/env";

// GET /api/debug/give?char=<id>&item=saddle&qty=1
export default defineEventHandler((event) => {
  if (!IS_DEV) throw createError({ statusCode: 404 });
  const q = getQuery(event);
  const char = String(q.char ?? "");
  const item = String(q.item ?? "");
  const qty = Number(q.qty ?? 1);
  const ok = getGame().debugGive(char, item, qty);
  return { ok };
});
