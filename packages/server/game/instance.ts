import { GameServer } from "./GameServer";

// Survive nitro dev-server reloads without double-ticking: the old instance
// is stopped and replaced whenever this module is re-evaluated.
const KEY = "__rustcraft_game__";

type GlobalWithGame = typeof globalThis & { [KEY]?: GameServer };

export function getGame(): GameServer {
  const g = globalThis as GlobalWithGame;
  if (!g[KEY]) {
    g[KEY] = new GameServer();
  }
  return g[KEY];
}

export function replaceGame(): GameServer {
  const g = globalThis as GlobalWithGame;
  if (g[KEY]) g[KEY].stop();
  g[KEY] = new GameServer();
  return g[KEY];
}
