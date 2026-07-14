import { defineEventHandler, readBody, createError } from "h3";
import { eq, and } from "drizzle-orm";
import { db, schema } from "../../../db/client";
import { createSession } from "../../../utils/auth";
import { verifyPassword } from "../../../utils/password";

export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string; password?: string }>(event);
  const email = body?.email?.trim().toLowerCase();
  const password = body?.password ?? "";

  // Deliberately the same error for "no such account" and "wrong password" —
  // don't leak which part was wrong.
  const invalid = () => createError({ statusCode: 401, statusMessage: "Invalid email or password" });
  if (!email || !password) throw invalid();

  const account = await db.query.accounts.findFirst({
    where: and(eq(schema.accounts.provider, "password"), eq(schema.accounts.providerId, email)),
  });
  if (!account?.passwordHash || !(await verifyPassword(password, account.passwordHash))) {
    throw invalid();
  }

  await createSession(event, account.id);
  return { ok: true };
});
