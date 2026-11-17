export function setupViewport(canvasElement, onResizeCallback) {
	const ctx = canvasElement.getContext("2d");
	const bounds = { width: 0, height: 0, dpr: 1 };

	function updateDimensions() {
		const dpr = window.devicePixelRatio || 1;
		bounds.width = window.innerWidth;
		bounds.height = window.innerHeight;
		bounds.dpr = dpr;

		canvasElement.width = Math.floor(bounds.width * dpr);
		canvasElement.height = Math.floor(bounds.height * dpr);
		canvasElement.style.width = `${bounds.width}px`;
		canvasElement.style.height = `${bounds.height}px`;

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		if (onResizeCallback) {
			onResizeCallback(bounds);
		}
	}

	window.addEventListener("resize", updateDimensions);
	updateDimensions();

	return {
		ctx,
		bounds,
		destroy() {
			window.removeEventListener("resize", updateDimensions);
		},
	};
}
