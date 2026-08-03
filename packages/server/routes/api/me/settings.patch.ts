import { defineEventHandler, readBody, createError } from "h3";
import { eq } from "drizzle-orm";
import {
  clampGraphicsSettings,
  parseAccountSettings,
  type AccountSettings,
  type GraphicsSettings,
} from "@rustcraft/shared";
import { requireAccount } from "../../../utils/auth";
import { db, schema } from "../../../db/client";

interface PatchBody {
  graphics?: Partial<GraphicsSettings>;
}

export default defineEventHandler(async (event) => {
  const account = await requireAccount(event);
  const body = await readBody<PatchBody>(event);
  if (!body || typeof body !== "object") {
    throw createError({ statusCode: 400, statusMessage: "Expected JSON body" });
  }

  const current = parseAccountSettings(account.settings ?? {});
  const next: AccountSettings = { ...current };

  if (body.graphics !== undefined) {
    if (!body.graphics || typeof body.graphics !== "object" || Array.isArray(body.graphics)) {
      throw createError({ statusCode: 400, statusMessage: "Invalid graphics settings" });
    }
    next.graphics = clampGraphicsSettings({
      ...current.graphics,
      ...body.graphics,
    });
  }

  const [updated] = await db
    .update(schema.accounts)
    .set({ settings: next as Record<string, unknown> })
    .where(eq(schema.accounts.id, account.id))
    .returning({ settings: schema.accounts.settings });

  return { settings: parseAccountSettings(updated?.settings ?? next) };
});
