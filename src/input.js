const TRACKED_CODES = new Set([
	"KeyW",
	"KeyA",
	"KeyS",
	"KeyD",
	"KeyJ",
	"KeyP",
	"ArrowUp",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
	"Space",
	"Escape",
]);

export function createInput(target = window) {
	const heldKeys = new Set();
	const edgeKeys = new Set();

	function handleKeyDown(event) {
		if (TRACKED_CODES.has(event.code)) {
			event.preventDefault();
		}
		if (event.repeat) return;

		if (!heldKeys.has(event.code)) {
			edgeKeys.add(event.code);
		}
		heldKeys.add(event.code);
	}

	function handleKeyUp(event) {
		if (TRACKED_CODES.has(event.code)) {
			event.preventDefault();
		}
		heldKeys.delete(event.code);
		edgeKeys.delete(event.code);
	}

	function handleWindowBlur() {
		heldKeys.clear();
		edgeKeys.clear();
	}

	target.addEventListener("keydown", handleKeyDown);
	target.addEventListener("keyup", handleKeyUp);
	target.addEventListener("blur", handleWindowBlur);

	return {
		isDown(code) {
			return heldKeys.has(code);
		},
		justPressed(code) {
			return edgeKeys.has(code);
		},
		clearFrameEdges() {
			edgeKeys.clear();
		},
		destroy() {
			target.removeEventListener("keydown", handleKeyDown);
			target.removeEventListener("keyup", handleKeyUp);
			target.removeEventListener("blur", handleWindowBlur);
			heldKeys.clear();
			edgeKeys.clear();
		},
	};
}
