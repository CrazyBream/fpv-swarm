export function createSoundEngine() {
	const AudioCtx = window.AudioContext || window.webkitAudioContext;
	const ctx = new AudioCtx();
	const buffers = new Map();

	function unlock() {
		if (ctx.state === "suspended") {
			ctx.resume();
		}
	}

	function setBuffers(loadedAudioMap) {
		for (const [name, buf] of Object.entries(loadedAudioMap)) {
			if (buf) buffers.set(name, buf);
		}
	}

	function play(name, { gain = 0.25, playbackRate = 1.0 } = {}) {
		if (ctx.state !== "running") return;
		const buffer = buffers.get(name);
		if (!buffer) return;

		const source = ctx.createBufferSource();
		source.buffer = buffer;
		source.playbackRate.value = playbackRate;

		const gainNode = ctx.createGain();
		gainNode.gain.value = gain;

		source.connect(gainNode);
		gainNode.connect(ctx.destination);
		source.start(0);
	}

	function bindToWorld(eventBus) {
		eventBus.addEventListener("fired", () => {
			play("shoot", { gain: 0.18, playbackRate: 0.95 + Math.random() * 0.12 });
		});
		eventBus.addEventListener("hit", () => {
			play("hit", { gain: 0.24, playbackRate: 0.9 + Math.random() * 0.2 });
		});
		eventBus.addEventListener("exploded", () => {
			play("explode", { gain: 0.35, playbackRate: 0.85 + Math.random() * 0.2 });
		});
	}

	return {
		ctx,
		unlock,
		setBuffers,
		play,
		bindToWorld,
	};
}
