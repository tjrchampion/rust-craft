import { defineEventHandler, createError } from "h3";
import { generateNodes } from "@rustcraft/shared";
import { IS_DEV } from "../../../utils/env";

export default defineEventHandler(() => {
  if (!IS_DEV) throw createError({ statusCode: 404 });
  return generateNodes();
});
