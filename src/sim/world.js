import { syncWrapForInterpolation, wrapPosition } from "./arena.js";
import { detectCollisions } from "./collision.js";
import { Asteroid, attachHoming, Explosion, Pickup } from "./entity.js";
import { integrate } from "./ship.js";

const PICKUP_TYPES = ["rapid_fire", "homing_ammo", "shield_repair"];

export class World extends EventTarget {
	#entities = new Map();
	#pendingRemoval = new Set();

	constructor({ width = 1280, height = 720 } = {}) {
		super();
		this.width = width;
		this.height = height;
		this.score = 0;
		this.callsign = "GENIY-FPV";
		this.roomName = "Sector Alpha";
		this.player = null;
		this.respawnTimer = 0;
		this.pickupTimer = 5;
		this.targetAsteroidCount = 7;
	}

	get size() {
		return this.#entities.size;
	}

	spawn(entity) {
		this.#entities.set(entity.id, entity);
		return entity;
	}

	despawn(id) {
		const entity = this.#entities.get(id);
		if (entity) {
			entity.alive = false;
		}
		this.#pendingRemoval.add(id);
	}

	get(id) {
		return this.#entities.get(id);
	}

	*[Symbol.iterator]() {
		yield* this.#entities.values();
	}

	*ofKind(kind) {
		for (const entity of this.#entities.values()) {
			if (entity.kind === kind) {
				yield entity;
			}
		}
	}

	setBounds(width, height) {
		this.width = width;
		this.height = height;
	}

	populateInitialAsteroids() {
		let current = 0;
		for (const _ of this.ofKind("asteroid")) {
			current += 1;
		}
		while (current < this.targetAsteroidCount) {
			this.spawnRandomAsteroid();
			current += 1;
		}
	}

	spawnRandomAsteroid() {
		let x = Math.random() * this.width;
		let y = Math.random() * this.height;
		if (this.player?.alive) {
			const dist = Math.hypot(x - this.player.pos.x, y - this.player.pos.y);
			if (dist < 180) {
				x = (this.player.pos.x + this.width * 0.5) % this.width;
				y = (this.player.pos.y + this.height * 0.5) % this.height;
			}
		}

		const angle = Math.random() * Math.PI * 2;
		const speed = 45 + Math.random() * 85;
		const isHoming = Math.random() < 0.28;
		const radius = isHoming ? 20 : 26;

		const asteroid = new Asteroid({
			x,
			y,
			vx: Math.cos(angle) * speed,
			vy: Math.sin(angle) * speed,
			radius,
			hp: isHoming ? 35 : 50,
		});

		if (isHoming) {
			attachHoming(asteroid, {
				targetKind: "ship",
				turnRate: 1.35,
				speed: 105,
			});
		}

		return this.spawn(asteroid);
	}

	spawnRandomPickup() {
		const effectType =
			PICKUP_TYPES[Math.floor(Math.random() * PICKUP_TYPES.length)];
		const margin = 80;
		const x = margin + Math.random() * Math.max(100, this.width - margin * 2);
		const y = margin + Math.random() * Math.max(100, this.height - margin * 2);
		return this.spawn(new Pickup({ x, y, effectType }));
	}

	findSafeSpot() {
		for (let attempt = 0; attempt < 20; attempt += 1) {
			const x = this.width * 0.2 + Math.random() * this.width * 0.6;
			const y = this.height * 0.2 + Math.random() * this.height * 0.6;
			let safe = true;
			for (const ast of this.ofKind("asteroid")) {
				if (Math.hypot(ast.pos.x - x, ast.pos.y - y) < ast.radius + 110) {
					safe = false;
					break;
				}
			}
			if (safe) return { x, y };
		}
		return { x: this.width * 0.5, y: this.height * 0.5 };
	}

	triggerPlayerFire() {
		if (!this.player?.alive) return;
		const bullet = this.player.fire(this);
		if (bullet) {
			this.dispatchEvent(
				new CustomEvent("fired", { detail: { bulletId: bullet.id } }),
			);
		}
	}

	step(dt, input) {
		for (const entity of this.#entities.values()) {
			entity.savePrevious();
		}

		if (this.player?.alive) {
			integrate(this.player, input, dt);
			if (input.isDown("Space") || input.isDown("KeyJ")) {
				this.triggerPlayerFire();
			}
		} else if (this.player && !this.player.alive) {
			this.respawnTimer -= dt;
			if (this.respawnTimer <= 0) {
				const spot = this.findSafeSpot();
				this.player.resetAt(spot.x, spot.y);
				this.spawn(this.player);
			}
		}

		for (const entity of this.#entities.values()) {
			if (!entity.alive) continue;
			entity.update(dt, this);
			if (entity.kind !== "explosion") {
				wrapPosition(entity, this.width, this.height);
				syncWrapForInterpolation(entity, this.width, this.height);
			}
		}

		const pairs = detectCollisions(this);
		for (const [a, b] of pairs) {
			if (!a.alive || !b.alive) continue;
			this.#resolvePair(a, b);
		}

		this.sweep();
		this.populateInitialAsteroids();

		this.pickupTimer -= dt;
		if (this.pickupTimer <= 0) {
			let pickupCount = 0;
			for (const _ of this.ofKind("pickup")) pickupCount += 1;
			if (pickupCount < 2) {
				this.spawnRandomPickup();
			}
			this.pickupTimer = 7;
		}
	}

	#addScore(points) {
		this.score += points;
		this.dispatchEvent(
			new CustomEvent("scoreChanged", {
				detail: { score: this.score, delta: points },
			}),
		);
	}

	#resolvePair(a, b) {
		const pair = [a, b];
		const bullet = pair.find((e) => e.kind === "bullet");
		const asteroid = pair.find((e) => e.kind === "asteroid");
		const ship = pair.find((e) => e.kind === "ship");
		const pickup = pair.find((e) => e.kind === "pickup");

		if (bullet && asteroid) {
			bullet.alive = false;
			asteroid.takeDamage(bullet.damage);
			this.spawn(
				new Explosion({
					x: bullet.pos.x,
					y: bullet.pos.y,
					color: "#38bdf8",
					count: 8,
				}),
			);
			this.dispatchEvent(
				new CustomEvent("hit", {
					detail: { x: bullet.pos.x, y: bullet.pos.y },
				}),
			);

			if (!asteroid.alive) {
				this.#addScore(asteroid.homing ? 150 : 100);
				this.spawn(
					new Explosion({
						x: asteroid.pos.x,
						y: asteroid.pos.y,
						color: "#f59e0b",
						count: 22,
					}),
				);
				this.dispatchEvent(
					new CustomEvent("exploded", {
						detail: { x: asteroid.pos.x, y: asteroid.pos.y },
					}),
				);
			}
			return;
		}

		if (ship && asteroid) {
			asteroid.alive = false;
			ship.takeDamage(35);
			this.spawn(
				new Explosion({
					x: asteroid.pos.x,
					y: asteroid.pos.y,
					color: "#f43f5e",
					count: 20,
				}),
			);
			this.dispatchEvent(
				new CustomEvent("hit", { detail: { x: ship.pos.x, y: ship.pos.y } }),
			);

			if (!ship.alive) {
				this.spawn(
					new Explosion({
						x: ship.pos.x,
						y: ship.pos.y,
						color: "#10b981",
						count: 32,
					}),
				);
				this.dispatchEvent(
					new CustomEvent("exploded", {
						detail: { x: ship.pos.x, y: ship.pos.y },
					}),
				);
				this.respawnTimer = 2.0;
			}
			return;
		}

		if (ship && pickup) {
			if (pickup.pickupEffect) {
				pickup.pickupEffect.apply(ship);
			}
			pickup.alive = false;
			this.#addScore(50);
			this.spawn(
				new Explosion({
					x: pickup.pos.x,
					y: pickup.pos.y,
					color: "#a855f7",
					count: 12,
				}),
			);
			this.dispatchEvent(
				new CustomEvent("hit", {
					detail: { x: pickup.pos.x, y: pickup.pos.y },
				}),
			);
			return;
		}

		if (a.kind === "asteroid" && b.kind === "asteroid") {
			const normal = b.pos.sub(a.pos).normalize();
			const relVel = a.vel.sub(b.vel);
			const sepSpeed = relVel.dot(normal);
			if (sepSpeed > 0) {
				const impulse = normal.scale(sepSpeed);
				a.vel = a.vel.sub(impulse);
				b.vel = b.vel.add(impulse);
			}
		}
	}

	sweep() {
		for (const [id, entity] of this.#entities) {
			if (!entity.alive) {
				this.#pendingRemoval.add(id);
			}
		}
		for (const id of this.#pendingRemoval) {
			this.#entities.delete(id);
		}
		this.#pendingRemoval.clear();
	}
}
