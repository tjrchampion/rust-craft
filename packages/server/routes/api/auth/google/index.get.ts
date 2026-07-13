import { defineEventHandler, setCookie, sendRedirect, createError } from "h3";
import { generateState, generateCodeVerifier } from "arctic";
import { getGoogle } from "../../../../utils/auth";
import { IS_DEV } from "../../../../utils/env";

export default defineEventHandler(async (event) => {
  const google = getGoogle();
  if (!google) {
    throw createError({ statusCode: 501, statusMessage: "Google OAuth not configured" });
  }
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = google.createAuthorizationURL(state, codeVerifier, ["openid", "profile", "email"]);
  const cookieOpts = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: !IS_DEV,
    path: "/",
    maxAge: 600,
  };
  setCookie(event, "rc_oauth_state", state, cookieOpts);
  setCookie(event, "rc_oauth_verifier", codeVerifier, cookieOpts);
  return sendRedirect(event, url.toString());
});
