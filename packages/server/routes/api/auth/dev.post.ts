import { defineEventHandler, readBody, createError } from "h3";
import { findOrCreateAccount, createSession } from "../../../utils/auth";
import { IS_DEV } from "../../../utils/env";

// Development-only login: pick a name, get an account. No credentials.
export default defineEventHandler(async (event) => {
  if (!IS_DEV) throw createError({ statusCode: 404, statusMessage: "Not found" });
  const body = await readBody<{ name?: string }>(event);
  const name = body?.name?.trim();
  if (!name || !/^[a-zA-Z0-9_]{2,24}$/.test(name)) {
    throw createError({ statusCode: 400, statusMessage: "Name must be 2-24 chars (letters, numbers, _)" });
  }
  const account = await findOrCreateAccount("dev", name.toLowerCase(), null, name);
  await createSession(event, account.id);
  return { ok: true };
});
