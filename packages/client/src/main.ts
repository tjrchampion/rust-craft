import { mount } from "svelte";
import "./ui/theme.css";
import App from "./ui/App.svelte";
import { Game } from "./game/Game";
import { setGame, getGame } from "./game/instance";
import { game as gameUi } from "./ui/gameState.svelte";
import { TitleScene } from "./render/TitleScene";

mount(App, { target: document.getElementById("ui-root")! });

const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
let titleScene: TitleScene | null = new TitleScene(canvas);

window.addEventListener("rc:enterWorld", (e) => {
  const { characterId, name, wsUrl } = (
    e as CustomEvent<{ characterId: string; name: string; wsUrl: string }>
  ).detail;
  titleScene?.dispose();
  titleScene = null;
  getGame()?.dispose();
  gameUi.reset();
  setGame(new Game(canvas, characterId, name, wsUrl));
});

window.addEventListener("rc:leaveWorld", () => {
  getGame()?.dispose();
  setGame(null);
  gameUi.reset();
  if (!titleScene) titleScene = new TitleScene(canvas);
});
