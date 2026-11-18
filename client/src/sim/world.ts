import type { EntityId } from '@fpv-swarm/shared/protocol.ts'
import { Bus, type GameEvents } from '../events/bus.ts'
import type { InputController } from '../input.ts'
import { syncWrapForInterpolation, wrapPosition } from './arena.ts'
import { detectCollisions } from './collision.ts'
import {
  Asteroid,
  type Bullet,
  type Entity,
  Explosion,
  type LocalEntityKind,
  Pickup,
  type PickupEffectType,
  type SimWorldView,
  attachHoming,
} from './entity.ts'
import { type Ship, integrate } from './ship.ts'

const PICKUP_TYPES: readonly PickupEffectType[] = ['rapid_fire', 'homing_ammo', 'shield_repair']

export class World implements SimWorldView {
  #entities = new Map<EntityId, Entity>()
  #pendingRemoval = new Set<EntityId>()
  readonly events = new Bus<GameEvents>()

  width: number
  height: number
  score = 0
  callsign = 'GENIY-FPV'
  roomName = 'Sector Alpha'
  player: Ship | null = null
  respawnTimer = 0
  pickupTimer = 5
  targetAsteroidCount = 7

  constructor({ width = 1280, height = 720 }: { width?: number; height?: number } = {}) {
    this.width = width
    this.height = height
  }

  get size(): number {
    return this.#entities.size
  }

  spawn<T extends Entity>(entity: T): T {
    this.#entities.set(entity.id, entity)
    return entity
  }

  despawn(id: EntityId): void {
    const entity = this.#entities.get(id)
    if (entity) {
      entity.alive = false
    }
    this.#pendingRemoval.add(id)
  }

  get(id: EntityId): Entity | undefined {
    return this.#entities.get(id)
  }

  *[Symbol.iterator](): IterableIterator<Entity> {
    yield* this.#entities.values()
  }

  *ofKind(kind: LocalEntityKind): IterableIterator<Entity> {
    for (const entity of this.#entities.values()) {
      if (entity.kind === kind) {
        yield entity
      }
    }
  }

  setBounds(width: number, height: number): void {
    this.width = width
    this.height = height
  }

  populateInitialAsteroids(): void {
    let current = 0
    for (const _ of this.ofKind('asteroid')) {
      current += 1
    }
    while (current < this.targetAsteroidCount) {
      this.spawnRandomAsteroid()
      current += 1
    }
  }

  spawnRandomAsteroid(): Asteroid {
    let x = Math.random() * this.width
    let y = Math.random() * this.height
    if (this.player?.alive) {
      const dist = Math.hypot(x - this.player.pos.x, y - this.player.pos.y)
      if (dist < 180) {
        x = (this.player.pos.x + this.width * 0.5) % this.width
        y = (this.player.pos.y + this.height * 0.5) % this.height
      }
    }

    const angle = Math.random() * Math.PI * 2
    const speed = 45 + Math.random() * 85
    const isHoming = Math.random() < 0.28
    const radius = isHoming ? 20 : 26

    const asteroid = new Asteroid({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius,
      hp: isHoming ? 35 : 50,
    })

    if (isHoming) {
      attachHoming(asteroid, {
        targetKind: 'ship',
        turnRate: 1.35,
        speed: 105,
      })
    }

    return this.spawn(asteroid)
  }

  spawnRandomPickup(): Pickup {
    const effectType = PICKUP_TYPES[Math.floor(Math.random() * PICKUP_TYPES.length)] ?? 'rapid_fire'
    const margin = 80
    const x = margin + Math.random() * Math.max(100, this.width - margin * 2)
    const y = margin + Math.random() * Math.max(100, this.height - margin * 2)
    return this.spawn(new Pickup({ x, y, effectType }))
  }

  findSafeSpot(): { x: number; y: number } {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const x = this.width * 0.2 + Math.random() * this.width * 0.6
      const y = this.height * 0.2 + Math.random() * this.height * 0.6
      let safe = true
      for (const ast of this.ofKind('asteroid')) {
        if (Math.hypot(ast.pos.x - x, ast.pos.y - y) < ast.radius + 110) {
          safe = false
          break
        }
      }
      if (safe) return { x, y }
    }
    return { x: this.width * 0.5, y: this.height * 0.5 }
  }

  triggerPlayerFire(): void {
    if (!this.player?.alive) return
    const bullet = this.player.fire(this)
    if (bullet) {
      this.events.emit('fired', { bulletId: bullet.id })
    }
  }

  step(dt: number, input: InputController): void {
    for (const entity of this.#entities.values()) {
      entity.savePrevious()
    }

    if (this.player?.alive) {
      integrate(this.player, input, dt)
      if (input.isDown('Space') || input.isDown('KeyJ')) {
        this.triggerPlayerFire()
      }
    } else if (this.player && !this.player.alive) {
      this.respawnTimer -= dt
      if (this.respawnTimer <= 0) {
        const spot = this.findSafeSpot()
        this.player.resetAt(spot.x, spot.y)
        this.spawn(this.player)
      }
    }

    for (const entity of this.#entities.values()) {
      if (!entity.alive) continue
      entity.update(dt, this)
      if (entity.kind !== 'explosion') {
        wrapPosition(entity, this.width, this.height)
        syncWrapForInterpolation(entity, this.width, this.height)
      }
    }

    const pairs = detectCollisions(this)
    for (const [a, b] of pairs) {
      if (!a.alive || !b.alive) continue
      this.#resolvePair(a, b)
    }

    this.sweep()
    this.populateInitialAsteroids()

    this.pickupTimer -= dt
    if (this.pickupTimer <= 0) {
      let pickupCount = 0
      for (const _ of this.ofKind('pickup')) pickupCount += 1
      if (pickupCount < 2) {
        this.spawnRandomPickup()
      }
      this.pickupTimer = 7
    }
  }

  #addScore(points: number): void {
    this.score += points
    this.events.emit('scoreChanged', { score: this.score, delta: points })
  }

  #resolvePair(a: Entity, b: Entity): void {
    const pair = [a, b]
    const bullet = pair.find((e): e is Bullet => e.kind === 'bullet')
    const asteroid = pair.find((e): e is Asteroid => e.kind === 'asteroid')
    const ship = pair.find((e): e is Ship => e.kind === 'ship')
    const pickup = pair.find((e): e is Pickup => e.kind === 'pickup')

    if (bullet && asteroid) {
      bullet.alive = false
      asteroid.takeDamage(bullet.damage)
      this.spawn(new Explosion({ x: bullet.pos.x, y: bullet.pos.y, color: '#38bdf8', count: 8 }))
      this.events.emit('hit', { x: bullet.pos.x, y: bullet.pos.y })

      if (!asteroid.alive) {
        this.#addScore(asteroid.homing ? 150 : 100)
        this.spawn(
          new Explosion({ x: asteroid.pos.x, y: asteroid.pos.y, color: '#f59e0b', count: 22 }),
        )
        this.events.emit('exploded', { x: asteroid.pos.x, y: asteroid.pos.y })
      }
      return
    }

    if (ship && asteroid) {
      asteroid.alive = false
      ship.takeDamage(35)
      this.spawn(
        new Explosion({ x: asteroid.pos.x, y: asteroid.pos.y, color: '#f43f5e', count: 20 }),
      )
      this.events.emit('hit', { x: ship.pos.x, y: ship.pos.y })

      if (!ship.alive) {
        this.spawn(new Explosion({ x: ship.pos.x, y: ship.pos.y, color: '#10b981', count: 32 }))
        this.events.emit('exploded', { x: ship.pos.x, y: ship.pos.y })
        this.respawnTimer = 2.0
      }
      return
    }

    if (ship && pickup) {
      if (pickup.pickupEffect) {
        pickup.pickupEffect.apply(ship)
      }
      pickup.alive = false
      this.#addScore(50)
      this.spawn(new Explosion({ x: pickup.pos.x, y: pickup.pos.y, color: '#a855f7', count: 12 }))
      this.events.emit('hit', { x: pickup.pos.x, y: pickup.pos.y })
      return
    }

    if (a.kind === 'asteroid' && b.kind === 'asteroid') {
      const normal = b.pos.sub(a.pos).normalize()
      const relVel = a.vel.sub(b.vel)
      const sepSpeed = relVel.dot(normal)
      if (sepSpeed > 0) {
        const impulse = normal.scale(sepSpeed)
        a.vel = a.vel.sub(impulse)
        b.vel = b.vel.add(impulse)
      }
    }
  }

  sweep(): void {
    for (const [id, entity] of this.#entities) {
      if (!entity.alive) {
        this.#pendingRemoval.add(id)
      }
    }
    for (const id of this.#pendingRemoval) {
      this.#entities.delete(id)
    }
    this.#pendingRemoval.clear()
  }
}
