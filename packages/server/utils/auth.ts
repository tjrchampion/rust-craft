import { randomBytes } from "node:crypto";
import type { H3Event } from "h3";
import { getCookie, setCookie, deleteCookie, createError } from "h3";
import { eq, and } from "drizzle-orm";
import { Discord, Google } from "arctic";
import { db, schema } from "../db/client";
import { env, PUBLIC_ORIGIN, IS_DEV } from "./env";

const SESSION_COOKIE = "rc_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function getDiscord(): Discord | null {
  const id = env("DISCORD_CLIENT_ID");
  const secret = env("DISCORD_CLIENT_SECRET");
  if (!id || !secret) return null;
  return new Discord(id, secret, `${PUBLIC_ORIGIN}/api/auth/discord/callback`);
}

export function getGoogle(): Google | null {
  const id = env("GOOGLE_CLIENT_ID");
  const secret = env("GOOGLE_CLIENT_SECRET");
  if (!id || !secret) return null;
  return new Google(id, secret, `${PUBLIC_ORIGIN}/api/auth/google/callback`);
}

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function findOrCreateAccount(
  provider: string,
  providerId: string,
  email: string | null,
  displayName: string | null,
) {
  const existing = await db.query.accounts.findFirst({
    where: and(eq(schema.accounts.provider, provider), eq(schema.accounts.providerId, providerId)),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(schema.accounts)
    .values({ provider, providerId, email, displayName })
    .returning();
  return created!;
}

export async function createSession(event: H3Event, accountId: string): Promise<void> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(schema.sessions).values({ token, accountId, expiresAt });
  setCookie(event, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: !IS_DEV,
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroySession(event: H3Event): Promise<void> {
  const token = getCookie(event, SESSION_COOKIE);
  if (token) {
    await db.delete(schema.sessions).where(eq(schema.sessions.token, token));
  }
  deleteCookie(event, SESSION_COOKIE, { path: "/" });
}

export async function getAccountForToken(token: string) {
  const session = await db.query.sessions.findFirst({
    where: eq(schema.sessions.token, token),
  });
  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  const account = await db.query.accounts.findFirst({
    where: eq(schema.accounts.id, session.accountId),
  });
  return account ?? null;
}

export async function getAccount(event: H3Event) {
  const token = getCookie(event, SESSION_COOKIE);
  if (!token) return null;
  return getAccountForToken(token);
}

export async function requireAccount(event: H3Event) {
  const account = await getAccount(event);
  if (!account) throw createError({ statusCode: 401, statusMessage: "Not signed in" });
  return account;
}

export function getSessionToken(event: H3Event): string | undefined {
  return getCookie(event, SESSION_COOKIE);
}
