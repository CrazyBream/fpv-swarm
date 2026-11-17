import { createInput } from "./input.js";
import { createLoop } from "./loop.js";
import { drawHud, drawWorld } from "./render/hud-and-drone.js";
import { setupViewport } from "./render/viewport.js";
import { Ship } from "./sim/ship.js";
import { World } from "./sim/world.js";

const canvas = document.querySelector("#arena-canvas");
const exitBtn = document.querySelector("#exit-btn");
const exitOverlay = document.querySelector("#exit-overlay");
const restartBtn = document.querySelector("#restart-btn");

let input = createInput(window);
const world = new World();

let viewport = setupViewport(canvas, ({ width, height }) => {
	world.setBounds(width, height);
});

const player = new Ship({
	x: viewport.bounds.width / 2,
	y: viewport.bounds.height / 2,
});
world.player = player;
world.spawn(player);
world.populateInitialAsteroids();

const handleMouseDown = () => {
	player.fire(world);
};
canvas.addEventListener("mousedown", handleMouseDown);

function simulate(dt) {
	world.step(dt, input);
	input.clearFrameEdges();
}

function render(alpha, telemetry) {
	drawWorld(viewport.ctx, world, alpha);
	drawHud(viewport.ctx, telemetry, world);
}

const gameLoop = createLoop({ step: 1 / 60, simulate, render });
gameLoop.start();

function exitGame() {
	gameLoop.stop();
	input.destroy();
	viewport.destroy();
	canvas.removeEventListener("mousedown", handleMouseDown);
	exitOverlay.classList.add("visible");
	exitBtn.style.display = "none";
}

function restartGame() {
	exitOverlay.classList.remove("visible");
	exitBtn.style.display = "block";

	input = createInput(window);
	viewport = setupViewport(canvas, ({ width, height }) => {
		world.setBounds(width, height);
	});
	canvas.addEventListener("mousedown", handleMouseDown);

	player.resetAt(viewport.bounds.width / 2, viewport.bounds.height / 2);
	world.spawn(player);
	gameLoop.start();
}

exitBtn.addEventListener("click", exitGame);
restartBtn.addEventListener("click", restartGame);

window.addEventListener("keydown", () => {
	if (input.justPressed("Escape")) {
		exitGame();
		return;
	}
	if (input.justPressed("KeyP")) {
		if (gameLoop.isRunning()) {
			gameLoop.stop();
		} else {
			input.clearFrameEdges();
			gameLoop.start();
		}
	}
});
