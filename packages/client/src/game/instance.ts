import type { Game } from "./Game";

/** Module-level handle so Svelte HUD components can reach the running game. */
let current: Game | null = null;

export function setGame(g: Game | null): void {
  current = g;
}

export function getGame(): Game | null {
  return current;
}
