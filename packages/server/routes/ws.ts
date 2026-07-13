import { defineWebSocketHandler } from "h3";
import { getGame } from "../game/instance";
import { getAccountForToken } from "../utils/auth";

const SESSION_COOKIE = "rc_session";

function cookieFromPeer(peer: { request?: { headers?: Headers | Record<string, string> } }): string | null {
  const headers = peer.request?.headers;
  if (!headers) return null;
  const raw =
    typeof (headers as Headers).get === "function"
      ? (headers as Headers).get("cookie")
      : ((headers as Record<string, string>)["cookie"] ?? null);
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export default defineWebSocketHandler({
  open() {
    // Auth happens on the explicit join message (cookie -> session -> account).
  },

  async message(peer, message) {
    const text = message.text();

    // First message must be a join; everything else goes to the game loop.
    if (text.startsWith('{"t":"join"')) {
      let characterId: string | undefined;
      try {
        const parsed = JSON.parse(text) as { t: string; characterId?: string };
        characterId = parsed.characterId;
      } catch {
        peer.close(4000, "bad join");
        return;
      }
      const token = cookieFromPeer(peer);
      const account = token ? await getAccountForToken(token) : null;
      if (!account || !characterId) {
        peer.send(JSON.stringify({ t: "error", message: "Not signed in" }));
        peer.close(4001, "unauthorized");
        return;
      }
      await getGame().join(peer, characterId, account.id);
      return;
    }

    getGame().handleMessage(peer, text);
  },

  async close(peer) {
    await getGame().leave(peer);
  },
});
