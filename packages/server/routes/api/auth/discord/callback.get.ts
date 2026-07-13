import { defineEventHandler, getQuery, getCookie, deleteCookie, sendRedirect, createError } from "h3";
import { getDiscord, findOrCreateAccount, createSession } from "../../../../utils/auth";

export default defineEventHandler(async (event) => {
  const discord = getDiscord();
  if (!discord) {
    throw createError({ statusCode: 501, statusMessage: "Discord OAuth not configured" });
  }
  const query = getQuery(event);
  const code = query.code?.toString();
  const state = query.state?.toString();
  const storedState = getCookie(event, "rc_oauth_state");
  deleteCookie(event, "rc_oauth_state", { path: "/" });
  if (!code || !state || state !== storedState) {
    throw createError({ statusCode: 400, statusMessage: "Invalid OAuth state" });
  }

  const tokens = await discord.validateAuthorizationCode(code, null);
  const res = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${tokens.accessToken()}` },
  });
  if (!res.ok) throw createError({ statusCode: 502, statusMessage: "Discord user fetch failed" });
  const user = (await res.json()) as {
    id: string;
    username: string;
    global_name: string | null;
    email: string | null;
  };

  const account = await findOrCreateAccount(
    "discord",
    user.id,
    user.email,
    user.global_name ?? user.username,
  );
  await createSession(event, account.id);
  return sendRedirect(event, "/");
});
