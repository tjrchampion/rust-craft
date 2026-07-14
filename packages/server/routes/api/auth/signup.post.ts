import { defineEventHandler, readBody, createError } from "h3";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../../../db/client";
import { createSession } from "../../../utils/auth";
import { hashPassword } from "../../../utils/password";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string; password?: string; displayName?: string }>(event);
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password ?? "";
  const displayName = body?.displayName?.trim() || email?.split("@")[0] || null;

  if (!email || !EMAIL_RE.test(email)) {
    throw createError({ statusCode: 400, statusMessage: "Enter a valid email address" });
  }
  if (password.length < 8) {
    throw createError({ statusCode: 400, statusMessage: "Password must be at least 8 characters" });
  }

  const existing = await db.query.accounts.findFirst({
    where: and(eq(schema.accounts.provider, "password"), eq(schema.accounts.providerId, email)),
  });
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: "An account with that email already exists" });
  }

  const passwordHash = await hashPassword(password);
  const [account] = await db
    .insert(schema.accounts)
    .values({ provider: "password", providerId: email, email, displayName, passwordHash })
    .returning();

  await createSession(event, account!.id);
  return { ok: true };
});
