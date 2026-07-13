import { defineEventHandler } from "h3";
import { sql } from "drizzle-orm";
import { db } from "../../db/client";

export default defineEventHandler(async () => {
  await db.execute(sql`select 1`);
  return { ok: true, time: new Date().toISOString() };
});
