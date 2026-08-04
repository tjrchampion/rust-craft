import { mount } from "svelte";
import "./ui/theme.css";
import App from "./ui/App.svelte";
import { Game } from "./game/Game";
import { setGame, getGame } from "./game/instance";
import { game as gameUi } from "./ui/gameState.svelte";

mount(App, { target: document.getElementById("ui-root")! });

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;

// Title / character screens use a static background image (no 3D TitleScene
// backdrop for now), so nothing renders to #game-canvas until you enter world.
window.addEventListener("rc:enterWorld", (e) => {
  const { characterId, name, wsUrl } = (
    e as CustomEvent<{ characterId: string; name: string; wsUrl: string }>
  ).detail;
  getGame()?.dispose();
  gameUi.reset();
  setGame(new Game(canvas, characterId, name, wsUrl));
});

window.addEventListener("rc:leaveWorld", () => {
  getGame()?.dispose();
  setGame(null);
  gameUi.reset();
});
