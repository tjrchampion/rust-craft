import { defineEventHandler, getQuery, getCookie, deleteCookie, sendRedirect, createError } from "h3";
import { getGoogle, findOrCreateAccount, createSession } from "../../../../utils/auth";

export default defineEventHandler(async (event) => {
  const google = getGoogle();
  if (!google) {
    throw createError({ statusCode: 501, statusMessage: "Google OAuth not configured" });
  }
  const query = getQuery(event);
  const code = query.code?.toString();
  const state = query.state?.toString();
  const storedState = getCookie(event, "rc_oauth_state");
  const codeVerifier = getCookie(event, "rc_oauth_verifier");
  deleteCookie(event, "rc_oauth_state", { path: "/" });
  deleteCookie(event, "rc_oauth_verifier", { path: "/" });
  if (!code || !state || state !== storedState || !codeVerifier) {
    throw createError({ statusCode: 400, statusMessage: "Invalid OAuth state" });
  }

  const tokens = await google.validateAuthorizationCode(code, codeVerifier);
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokens.accessToken()}` },
  });
  if (!res.ok) throw createError({ statusCode: 502, statusMessage: "Google user fetch failed" });
  const user = (await res.json()) as { sub: string; name?: string; email?: string };

  const account = await findOrCreateAccount("google", user.sub, user.email ?? null, user.name ?? null);
  await createSession(event, account.id);
  return sendRedirect(event, "/");
});
