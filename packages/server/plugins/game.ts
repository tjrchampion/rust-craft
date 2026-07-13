import { defineNitroPlugin } from "nitropack/runtime";
import { replaceGame, getGame } from "../game/instance";

const GUARD_KEY = "__rustcraft_process_guards__";

/**
 * A dropped client socket surfaces as an unhandled ECONNRESET from the WS
 * stack and would kill the whole world. Keep the server alive; log loudly
 * for anything that isn't a routine socket teardown.
 */
function installProcessGuards(): void {
  const g = globalThis as typeof globalThis & { [GUARD_KEY]?: boolean };
  if (g[GUARD_KEY]) return;
  g[GUARD_KEY] = true;

  const isSocketNoise = (err: unknown) =>
    err instanceof Error &&
    ["ECONNRESET", "EPIPE", "ECONNABORTED"].includes((err as NodeJS.ErrnoException).code ?? "");

  process.on("uncaughtException", (err) => {
    if (isSocketNoise(err)) return;
    console.error("[game] uncaught exception (server kept alive):", err);
  });
  process.on("unhandledRejection", (err) => {
    if (isSocketNoise(err)) return;
    console.error("[game] unhandled rejection (server kept alive):", err);
  });
}

export default defineNitroPlugin((nitro) => {
  installProcessGuards();
  const game = replaceGame();
  void game.start();

  nitro.hooks.hook("close", async () => {
    await getGame().flushAll();
    getGame().stop();
  });
});
