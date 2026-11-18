import { Vector2 } from './vector.js'

export class Entity {
  static #nextId = 1
  #id

  constructor({ x = 0, y = 0, vx = 0, vy = 0, angle = 0, radius = 10, kind = 'entity' } = {}) {
    this.#id = Entity.#nextId++
    this.pos = new Vector2(x, y)
    this.prevPos = new Vector2(x, y)
    this.vel = new Vector2(vx, vy)
    this.angle = angle
    this.prevAngle = angle
    this.radius = radius
    this.alive = true
    this.kind = kind
    this.homing = null
    this.pickupEffect = null
  }

  get id() {
    return this.#id
  }

  savePrevious() {
    this.prevPos.x = this.pos.x
    this.prevPos.y = this.pos.y
    this.prevAngle = this.angle
  }

  update(dt, world) {
    if (this.homing) {
      this.homing.steer(this, dt, world)
    }
    this.pos.addInPlace(this.vel.scale(dt))
  }
}

export function attachHoming(
  entity,
  { targetKind = 'asteroid', turnRate = 3.5, speed = 320 } = {},
) {
  entity.homing = {
    targetKind,
    turnRate,
    speed,
    steer(self, dt, world) {
      if (!world) return
      let nearest = null
      let bestDist = Number.POSITIVE_INFINITY
      for (const candidate of world.ofKind(this.targetKind)) {
        if (!candidate.alive || candidate.id === self.id) continue
        const d = self.pos.sub(candidate.pos).length()
        if (d < bestDist) {
          bestDist = d
          nearest = candidate
        }
      }
      if (!nearest) return

      const desired = nearest.pos.sub(self.pos)
      const desiredAngle = Math.atan2(desired.y, desired.x)
      const tau = Math.PI * 2
      let diff = ((desiredAngle - self.angle) % tau) + tau
      diff %= tau
      if (diff > Math.PI) diff -= tau

      const maxStep = this.turnRate * dt
      self.angle += Math.max(-maxStep, Math.min(maxStep, diff))
      self.vel = Vector2.fromAngle(self.angle, this.speed)
    },
  }
  return entity
}

export function attachPickup(entity, { type = 'rapid_fire', duration = 6, healAmount = 40 } = {}) {
  entity.pickupEffect = {
    type,
    duration,
    healAmount,
    apply(ship) {
      if (this.type === 'shield_repair') {
        ship.heal(this.healAmount)
      } else if (this.type === 'rapid_fire') {
        ship.activateOverclock(this.duration)
      } else if (this.type === 'homing_ammo') {
        ship.activateHomingAmmo(this.duration)
      }
    },
  }
  return entity
}

export class Bullet extends Entity {
  constructor({ x, y, vx, vy, angle, ownerId, damage = 25, ttl = 1.6 }) {
    super({ x, y, vx, vy, angle, radius: 4, kind: 'bullet' })
    this.ownerId = ownerId
    this.damage = damage
    this.ttl = ttl
  }

  update(dt, world) {
    super.update(dt, world)
    this.ttl -= dt
    if (this.ttl <= 0) {
      this.alive = false
    }
  }
}

export class Asteroid extends Entity {
  #hp

  constructor({ x, y, vx, vy, radius = 26, hp = 50 }) {
    super({
      x,
      y,
      vx,
      vy,
      angle: Math.random() * Math.PI * 2,
      radius,
      kind: 'asteroid',
    })
    this.#hp = hp
    this.maxHp = hp
    this.spin = (Math.random() - 0.5) * 2.2
  }

  get hp() {
    return this.#hp
  }

  takeDamage(amount) {
    this.#hp = Math.max(0, this.#hp - amount)
    if (this.#hp === 0) {
      this.alive = false
    }
  }

  update(dt, world) {
    super.update(dt, world)
    this.angle += this.spin * dt
  }
}

export class Pickup extends Entity {
  constructor({ x, y, effectType = 'rapid_fire', ttl = 14 }) {
    super({ x, y, vx: 0, vy: 0, angle: 0, radius: 14, kind: 'pickup' })
    this.ttl = ttl
    this.pulse = 0
    attachPickup(this, { type: effectType })
  }

  update(dt) {
    this.pulse += dt * 4
    this.angle += dt * 1.5
    this.ttl -= dt
    if (this.ttl <= 0) {
      this.alive = false
    }
  }
}

export class Explosion extends Entity {
  constructor({ x, y, color = '#10b981', count = 18 }) {
    super({ x, y, vx: 0, vy: 0, angle: 0, radius: 2, kind: 'explosion' })
    this.ttl = 0.55
    this.maxTtl = 0.55
    this.color = color
    this.particles = []
    for (let i = 0; i < count; i += 1) {
      const a = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4
      const speed = 50 + Math.random() * 160
      this.particles.push({
        pos: new Vector2(x, y),
        vel: Vector2.fromAngle(a, speed),
        size: 1.5 + Math.random() * 2.5,
      })
    }
  }

  update(dt) {
    this.ttl -= dt
    for (const p of this.particles) {
      p.pos.addInPlace(p.vel.scale(dt))
      p.vel.scaleInPlace(Math.exp(-3 * dt))
    }
    if (this.ttl <= 0) {
      this.alive = false
    }
  }
}
