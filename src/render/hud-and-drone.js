export function lerpValue(start, end, alpha) {
	return start + (end - start) * alpha;
}

export function lerpRadians(fromAngle, toAngle, alpha) {
	const fullCircle = Math.PI * 2;
	let diff = ((toAngle - fromAngle) % fullCircle) + fullCircle;
	diff %= fullCircle;
	if (diff > Math.PI) {
		diff -= fullCircle;
	}
	return fromAngle + diff * alpha;
}

export function interpolateEntity(entity, alpha) {
	return {
		x: lerpValue(entity.prevPos.x, entity.pos.x, alpha),
		y: lerpValue(entity.prevPos.y, entity.pos.y, alpha),
		angle: lerpRadians(entity.prevAngle, entity.angle, alpha),
	};
}

export function drawArenaGrid(ctx, width, height) {
	ctx.fillStyle = "#070b10";
	ctx.fillRect(0, 0, width, height);

	const cellSize = 80;
	ctx.strokeStyle = "rgba(16, 185, 129, 0.08)";
	ctx.lineWidth = 1;

	ctx.beginPath();
	for (let x = 0; x <= width; x += cellSize) {
		ctx.moveTo(x + 0.5, 0);
		ctx.lineTo(x + 0.5, height);
	}
	for (let y = 0; y <= height; y += cellSize) {
		ctx.moveTo(0, y + 0.5);
		ctx.lineTo(width, y + 0.5);
	}
	ctx.stroke();

	ctx.strokeStyle = "rgba(16, 185, 129, 0.22)";
	ctx.beginPath();
	for (let x = cellSize * 2; x < width; x += cellSize * 2) {
		for (let y = cellSize * 2; y < height; y += cellSize * 2) {
			ctx.moveTo(x - 4, y);
			ctx.lineTo(x + 4, y);
			ctx.moveTo(x, y - 4);
			ctx.lineTo(x, y + 4);
		}
	}
	ctx.stroke();
}

export function drawShip(ctx, drone, alpha) {
	const pose = interpolateEntity(drone, alpha);

	ctx.save();
	ctx.translate(pose.x, pose.y);
	ctx.rotate(pose.angle);

	if (drone.thrust > 0) {
		ctx.fillStyle = "rgba(16, 185, 129, 0.75)";
		ctx.beginPath();
		ctx.moveTo(-12, -4);
		ctx.lineTo(-26, 0);
		ctx.lineTo(-12, 4);
		ctx.closePath();
		ctx.fill();
	}

	ctx.strokeStyle = "#64748b";
	ctx.lineWidth = 3;
	ctx.beginPath();
	ctx.moveTo(-12, -12);
	ctx.lineTo(12, 12);
	ctx.moveTo(12, -12);
	ctx.lineTo(-12, 12);
	ctx.stroke();

	const motorMounts = [
		[-12, -12],
		[12, -12],
		[12, 12],
		[-12, 12],
	];

	const guardColor = drone.homingAmmoTimer > 0 ? "#a855f7" : "#10b981";

	for (const [mx, my] of motorMounts) {
		ctx.save();
		ctx.translate(mx, my);

		ctx.strokeStyle = guardColor;
		ctx.fillStyle = "rgba(16, 185, 129, 0.12)";
		ctx.lineWidth = 1.4;
		ctx.beginPath();
		ctx.arc(0, 0, 7, 0, Math.PI * 2);
		ctx.fill();
		ctx.stroke();

		ctx.rotate(drone.rotorSpin);
		ctx.strokeStyle = "#e2e8f0";
		ctx.lineWidth = 1.6;
		ctx.beginPath();
		ctx.moveTo(-5.5, 0);
		ctx.lineTo(5.5, 0);
		ctx.stroke();

		ctx.restore();
	}

	ctx.fillStyle = "#1e293b";
	ctx.strokeStyle = "#94a3b8";
	ctx.lineWidth = 1.2;
	ctx.beginPath();
	ctx.rect(-8, -5, 16, 10);
	ctx.fill();
	ctx.stroke();

	ctx.fillStyle = drone.overclockTimer > 0 ? "#f59e0b" : "#38bdf8";
	ctx.beginPath();
	ctx.arc(8, 0, 2.5, 0, Math.PI * 2);
	ctx.fill();

	ctx.restore();
}

export function drawBullet(ctx, bullet, alpha) {
	const pose = interpolateEntity(bullet, alpha);
	ctx.save();
	ctx.translate(pose.x, pose.y);
	ctx.rotate(pose.angle);

	ctx.fillStyle = bullet.homing ? "#c084fc" : "#38bdf8";
	ctx.beginPath();
	ctx.arc(0, 0, bullet.radius, 0, Math.PI * 2);
	ctx.fill();

	ctx.strokeStyle = bullet.homing
		? "rgba(192, 132, 252, 0.6)"
		: "rgba(56, 189, 248, 0.5)";
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(-10, 0);
	ctx.lineTo(0, 0);
	ctx.stroke();
	ctx.restore();
}

export function drawAsteroid(ctx, asteroid, alpha) {
	const pose = interpolateEntity(asteroid, alpha);
	ctx.save();
	ctx.translate(pose.x, pose.y);
	ctx.rotate(pose.angle);

	const isHoming = Boolean(asteroid.homing);
	ctx.strokeStyle = isHoming ? "#f43f5e" : "#f59e0b";
	ctx.fillStyle = isHoming
		? "rgba(244, 63, 94, 0.16)"
		: "rgba(245, 158, 11, 0.12)";
	ctx.lineWidth = 2;

	const sides = isHoming ? 6 : 8;
	ctx.beginPath();
	for (let i = 0; i < sides; i += 1) {
		const a = (Math.PI * 2 * i) / sides;
		const r = asteroid.radius * (i % 2 === 0 ? 1 : 0.82);
		const px = Math.cos(a) * r;
		const py = Math.sin(a) * r;
		if (i === 0) ctx.moveTo(px, py);
		else ctx.lineTo(px, py);
	}
	ctx.closePath();
	ctx.fill();
	ctx.stroke();

	if (isHoming) {
		ctx.fillStyle = "#f43f5e";
		ctx.beginPath();
		ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
		ctx.fill();
	}

	ctx.restore();
}

export function drawPickup(ctx, pickup, alpha) {
	const pose = interpolateEntity(pickup, alpha);
	ctx.save();
	ctx.translate(pose.x, pose.y);

	const effectType = pickup.pickupEffect?.type;
	let color = "#22c55e";
	let label = "+HP";
	if (effectType === "rapid_fire") {
		color = "#eab308";
		label = "RPM";
	} else if (effectType === "homing_ammo") {
		color = "#a855f7";
		label = "AIM";
	}

	const r = pickup.radius + Math.sin(pickup.pulse) * 2;
	ctx.strokeStyle = color;
	ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.arc(0, 0, r, 0, Math.PI * 2);
	ctx.fill();
	ctx.stroke();

	ctx.fillStyle = color;
	ctx.font = "bold 10px ui-monospace, monospace";
	ctx.textAlign = "center";
	ctx.textBaseline = "middle";
	ctx.fillText(label, 0, 0);
	ctx.restore();
}

export function drawExplosion(ctx, explosion) {
	const ratio = Math.max(0, explosion.ttl / explosion.maxTtl);
	ctx.save();
	ctx.globalAlpha = ratio;
	ctx.fillStyle = explosion.color;
	for (const p of explosion.particles) {
		ctx.beginPath();
		ctx.arc(p.pos.x, p.pos.y, p.size, 0, Math.PI * 2);
		ctx.fill();
	}
	ctx.restore();
}

export function drawWorld(ctx, world, alpha) {
	drawArenaGrid(ctx, world.width, world.height);

	for (const pickup of world.ofKind("pickup")) {
		drawPickup(ctx, pickup, alpha);
	}
	for (const asteroid of world.ofKind("asteroid")) {
		drawAsteroid(ctx, asteroid, alpha);
	}
	for (const bullet of world.ofKind("bullet")) {
		drawBullet(ctx, bullet, alpha);
	}
	for (const ship of world.ofKind("ship")) {
		if (ship.alive) {
			drawShip(ctx, ship, alpha);
		}
	}
	for (const explosion of world.ofKind("explosion")) {
		drawExplosion(ctx, explosion);
	}
}

export function drawHud(ctx, telemetry, world) {
	const player = world.player;
	const speed = player?.alive ? Math.round(player.vel.length()) : 0;
	const hp = player ? player.hp : 0;

	ctx.save();
	ctx.fillStyle = "rgba(7, 11, 16, 0.85)";
	ctx.strokeStyle = "rgba(16, 185, 129, 0.4)";
	ctx.lineWidth = 1;
	ctx.fillRect(18, 18, 395, 172);
	ctx.strokeRect(18, 18, 395, 172);

	ctx.fillStyle = "#10b981";
	ctx.font = "bold 14px ui-monospace, SFMono-Regular, Consolas, monospace";
	ctx.fillText(
		`FPV OSD // SCORE: ${world.score} // ENTITIES: ${world.size}`,
		30,
		40,
	);

	ctx.fillStyle = "#f1f5f9";
	ctx.font = "13px ui-monospace, SFMono-Regular, Consolas, monospace";
	ctx.fillText(
		`steps/s: ${telemetry.stepsPerSec} | frames/s: ${telemetry.framesPerSec} | ${telemetry.frameDurationMs.toFixed(1)} ms`,
		30,
		64,
	);
	ctx.fillText(`HP: ${hp}/100 | speed: ${speed} px/s`, 30, 86);

	ctx.fillStyle = "#1e293b";
	ctx.fillRect(30, 96, 220, 10);
	ctx.fillStyle = hp > 35 ? "#10b981" : "#f43f5e";
	ctx.fillRect(30, 96, (hp / 100) * 220, 10);

	let statusText = "STATUS: ACTIVE";
	if (player && !player.alive) {
		statusText = `RESPAWN IN: ${world.respawnTimer.toFixed(1)}s`;
	} else if (player && player.homingAmmoTimer > 0) {
		statusText = `HOMING AMMO: ${player.homingAmmoTimer.toFixed(1)}s`;
	} else if (player && player.overclockTimer > 0) {
		statusText = `RAPID FIRE: ${player.overclockTimer.toFixed(1)}s`;
	}

	ctx.fillStyle = "#38bdf8";
	ctx.fillText(statusText, 30, 126);

	ctx.fillStyle = "#94a3b8";
	ctx.font = "12px ui-monospace, SFMono-Regular, Consolas, monospace";
	ctx.fillText("WASD: Fly | Space / Click: Fire | P: Pause", 30, 150);
	ctx.fillText("Pickups: [RPM] Rapid Fire [AIM] Homing [+HP] Repair", 30, 170);
	ctx.restore();
}
