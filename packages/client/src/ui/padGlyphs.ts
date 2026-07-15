import { game } from "./gameState.svelte";

/** Show a gamepad button glyph in place of a keyboard label when the last
 *  input device the player used was a gamepad. */
export function promptLabel(gamepadGlyph: string, kbmLabel: string): string {
  return game.lastDevice === "gamepad" ? gamepadGlyph : kbmLabel;
}
