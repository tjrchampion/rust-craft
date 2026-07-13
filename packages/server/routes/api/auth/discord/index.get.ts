import { defineEventHandler, setCookie, sendRedirect, createError } from "h3";
import { generateState } from "arctic";
import { getDiscord } from "../../../../utils/auth";
import { IS_DEV } from "../../../../utils/env";

export default defineEventHandler(async (event) => {
  const discord = getDiscord();
  if (!discord) {
    throw createError({ statusCode: 501, statusMessage: "Discord OAuth not configured" });
  }
  const state = generateState();
  const url = discord.createAuthorizationURL(state, null, ["identify", "email"]);
  setCookie(event, "rc_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: !IS_DEV,
    path: "/",
    maxAge: 600,
  });
  return sendRedirect(event, url.toString());
});
