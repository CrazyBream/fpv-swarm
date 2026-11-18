import { type EntityId, asEntityId } from '@fpv-swarm/shared/protocol.ts'
import { Vector2 } from './vector.ts'

export type LocalEntityKind = 'entity' | 'ship' | 'bullet' | 'asteroid' | 'pickup' | 'explosion'

export interface SimWorldView {
  ofKind(kind: LocalEntityKind): IterableIterator<Entity>
}

export interface HomingComponent {
  readonly targetKind: LocalEntityKind
  readonly turnRate: number
  readonly speed: number
  steer(self: Entity, dt: number, world: SimWorldView): void
}

export type PickupEffectType = 'rapid_fire' | 'homing_ammo' | 'shield_repair'

export interface ShipTarget {
  overclockTimer: number
  homingAmmoTimer: number
  heal(amount: number): void
}

export interface PickupEffectComponent {
  readonly type: PickupEffectType
  apply(ship: ShipTarget): void
}

export class Entity {
  static #nextId = 1

  #id: EntityId
  kind: LocalEntityKind
  pos: Vector2
  prevPos: Vector2
  vel: Vector2
  angle: number
  prevAngle: number
  radius: number
  alive = true
  homing: HomingComponent | null = null
  pickupEffect: PickupEffectComponent | null = null

  constructor({
    x = 0,
    y = 0,
    vx = 0,
    vy = 0,
    angle = 0,
    radius = 12,
    kind = 'entity',
  }: {
    x?: number
    y?: number
    vx?: number
    vy?: number
    angle?: number
    radius?: number
    kind?: LocalEntityKind
  } = {}) {
    this.#id = asEntityId(Entity.#nextId++)
    this.kind = kind
    this.pos = new Vector2(x, y)
    this.prevPos = new Vector2(x, y)
    this.vel = new Vector2(vx, vy)
    this.angle = angle
    this.prevAngle = angle
    this.radius = radius
  }

  get id(): EntityId {
    return this.#id
  }

  savePrevious(): void {
    this.prevPos = this.pos.clone()
    this.prevAngle = this.angle
  }

  update(dt: number, world?: SimWorldView): void {
    if (this.homing && world) {
      this.homing.steer(this, dt, world)
    }
    this.pos = this.pos.add(this.vel.scale(dt))
  }
}

export class Bullet extends Entity {
  ownerId: EntityId | null
  ttl: number
  damage: number

  constructor({
    x,
    y,
    vx,
    vy,
    angle,
    ownerId = null,
    ttl = 1.35,
    damage = 25,
  }: {
    x: number
    y: number
    vx: number
    vy: number
    angle: number
    ownerId?: EntityId | null
    ttl?: number
    damage?: number
  }) {
    super({ x, y, vx, vy, angle, radius: 4, kind: 'bullet' })
    this.ownerId = ownerId
    this.ttl = ttl
    this.damage = damage
  }

  override update(dt: number, world?: SimWorldView): void {
    super.update(dt, world)
    this.ttl -= dt
    if (this.ttl <= 0) {
      this.alive = false
    }
  }
}

export class Asteroid extends Entity {
  #hp: number
  maxHp: number
  spinRate: number

  constructor({
    x,
    y,
    vx,
    vy,
    radius = 24,
    hp = 50,
    spinRate = 1.2,
  }: {
    x: number
    y: number
    vx: number
    vy: number
    radius?: number
    hp?: number
    spinRate?: number
  }) {
    super({ x, y, vx, vy, angle: Math.random() * Math.PI * 2, radius, kind: 'asteroid' })
    this.#hp = hp
    this.maxHp = hp
    this.spinRate = spinRate
  }

  get hp(): number {
    return this.#hp
  }

  takeDamage(amount: number): void {
    this.#hp = Math.max(0, this.#hp - amount)
    if (this.#hp === 0) {
      this.alive = false
    }
  }

  override update(dt: number, world?: SimWorldView): void {
    super.update(dt, world)
    this.angle += this.spinRate * dt
  }
}

export class Pickup extends Entity {
  ttl: number
  pulse = 0

  constructor({
    x,
    y,
    effectType = 'rapid_fire',
    ttl = 12,
  }: {
    x: number
    y: number
    effectType?: PickupEffectType
    ttl?: number
  }) {
    super({ x, y, vx: 0, vy: 0, angle: 0, radius: 14, kind: 'pickup' })
    this.ttl = ttl
    attachPickup(this, { type: effectType })
  }

  override update(dt: number): void {
    this.pulse += dt * 5
    this.angle += dt * 1.5
    this.ttl -= dt
    if (this.ttl <= 0) {
      this.alive = false
    }
  }
}

export class Explosion extends Entity {
  ttl: number
  maxTtl: number
  color: string
  particles: Array<{ pos: Vector2; vel: Vector2; size: number }>

  constructor({
    x,
    y,
    color = '#f59e0b',
    count = 14,
  }: {
    x: number
    y: number
    color?: string
    count?: number
  }) {
    super({ x, y, radius: 2, kind: 'explosion' })
    this.ttl = 0.45
    this.maxTtl = 0.45
    this.color = color
    this.particles = Array.from({ length: count }, (_, i) => {
      const a = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4
      const speed = 40 + Math.random() * 140
      return {
        pos: new Vector2(x, y),
        vel: Vector2.fromAngle(a, speed),
        size: 1.5 + Math.random() * 2.5,
      }
    })
  }

  override update(dt: number): void {
    this.ttl -= dt
    if (this.ttl <= 0) {
      this.alive = false
      return
    }
    for (const p of this.particles) {
      p.pos = p.pos.add(p.vel.scale(dt))
      p.vel = p.vel.scale(Math.exp(-3 * dt))
    }
  }
}

export function attachHoming(
  entity: Entity,
  {
    targetKind = 'asteroid',
    turnRate = 3.2,
    speed = 220,
  }: { targetKind?: LocalEntityKind; turnRate?: number; speed?: number } = {},
): Entity {
  entity.homing = {
    targetKind,
    turnRate,
    speed,
    steer(self: Entity, dt: number, world: SimWorldView): void {
      let closest: Entity | null = null
      let minDist = Number.POSITIVE_INFINITY
      for (const candidate of world.ofKind(targetKind)) {
        if (!candidate.alive || candidate.id === self.id) continue
        const d = self.pos.distanceTo(candidate.pos)
        if (d < minDist) {
          minDist = d
          closest = candidate
        }
      }
      if (!closest) return

      const desiredDir = closest.pos.sub(self.pos).normalize()
      const currentSpeed = Math.max(self.vel.length(), speed)
      const currentDir =
        self.vel.length() > 1e-4 ? self.vel.normalize() : Vector2.fromAngle(self.angle)
      const blended = currentDir.add(desiredDir.scale(turnRate * dt)).normalize()
      self.vel = blended.scale(currentSpeed)
      self.angle = Math.atan2(blended.y, blended.x)
    },
  }
  return entity
}

export function attachPickup(
  entity: Entity,
  {
    type = 'rapid_fire',
    duration = 6,
    healAmount = 35,
  }: { type?: PickupEffectType; duration?: number; healAmount?: number } = {},
): Entity {
  entity.pickupEffect = {
    type,
    apply(ship: ShipTarget): void {
      if (type === 'rapid_fire') {
        ship.overclockTimer = duration
      } else if (type === 'homing_ammo') {
        ship.homingAmmoTimer = duration
      } else if (type === 'shield_repair') {
        ship.heal(healAmount)
      }
    },
  }
  return entity
}
