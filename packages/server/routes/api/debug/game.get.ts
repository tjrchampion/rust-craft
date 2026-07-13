import { defineEventHandler, createError } from "h3";
import { getGame } from "../../../game/instance";
import { IS_DEV } from "../../../utils/env";

export default defineEventHandler(() => {
  if (!IS_DEV) throw createError({ statusCode: 404 });
  return getGame().debugStatus();
});
