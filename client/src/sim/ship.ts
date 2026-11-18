import { ObjectPool } from '@fpv-swarm/shared/sim/pool.ts'
import type { InputController } from '../input.ts'
import { Bullet, Entity, type ShipTarget, attachHoming } from './entity.ts'
import { Vector2 } from './vector.ts'

export const DRONE_SPECS = Object.freeze({
  yawRate: 4.4,
  forwardThrust: 640,
  reverseThrust: 300,
  airDrag: 1.55,
  terminalSpeed: 440,
  baseCooldown: 0.18,
  muzzleSpeed: 560,
})

export interface BulletSpawnerWorld {
  spawn<T extends Entity>(entity: T): T
}

export const bulletPool = new ObjectPool<Bullet>(
  () => new Bullet({ x: 0, y: 0, vx: 0, vy: 0, angle: 0 }),
  (b) => {
    b.alive = false
    b.homing = null
  },
  64,
)

export class Ship extends Entity implements ShipTarget {
  #hp: number
  maxHp = 100
  thrust = 0
  rotorSpin = 0
  cooldown = 0
  overclockTimer = 0
  homingAmmoTimer = 0

  constructor({
    x = 640,
    y = 360,
    angle = -Math.PI / 2,
    hp = 100,
  }: {
    x?: number
    y?: number
    angle?: number
    hp?: number
  } = {}) {
    super({ x, y, vx: 0, vy: 0, angle, radius: 15, kind: 'ship' })
    this.#hp = hp
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

  heal(amount: number): void {
    this.#hp = Math.min(this.maxHp, this.#hp + amount)
  }

  resetAt(x: number, y: number): void {
    this.pos = new Vector2(x, y)
    this.prevPos = new Vector2(x, y)
    this.vel = new Vector2(0, 0)
    this.angle = -Math.PI / 2
    this.prevAngle = -Math.PI / 2
    this.#hp = this.maxHp
    this.alive = true
    this.cooldown = 0
    this.overclockTimer = 0
    this.homingAmmoTimer = 0
  }

  override update(dt: number): void {
    this.pos = this.pos.add(this.vel.scale(dt))
    if (this.cooldown > 0) {
      this.cooldown = Math.max(0, this.cooldown - dt)
    }
    if (this.overclockTimer > 0) {
      this.overclockTimer = Math.max(0, this.overclockTimer - dt)
    }
    if (this.homingAmmoTimer > 0) {
      this.homingAmmoTimer = Math.max(0, this.homingAmmoTimer - dt)
    }
  }

  fire(world: BulletSpawnerWorld): Bullet | null {
    if (!this.alive || this.cooldown > 0) {
      return null
    }

    const activeCooldown =
      this.overclockTimer > 0 ? DRONE_SPECS.baseCooldown * 0.42 : DRONE_SPECS.baseCooldown
    this.cooldown = activeCooldown

    const forward = Vector2.fromAngle(this.angle)
    const nosePos = this.pos.add(forward.scale(this.radius + 6))
    const bulletVel = forward.scale(DRONE_SPECS.muzzleSpeed).add(this.vel)

    const bullet = bulletPool.acquire().reset({
      x: nosePos.x,
      y: nosePos.y,
      vx: bulletVel.x,
      vy: bulletVel.y,
      angle: this.angle,
      ownerId: this.id,
    })

    if (this.homingAmmoTimer > 0) {
      attachHoming(bullet, {
        targetKind: 'asteroid',
        turnRate: 6.5,
        speed: DRONE_SPECS.muzzleSpeed,
      })
    }

    return world.spawn(bullet)
  }
}

export function createDroneState({ x = 640, y = 360 }: { x?: number; y?: number } = {}): Ship {
  return new Ship({ x, y })
}

export function integrate(drone: Ship, input: InputController, dt: number): void {
  const turnLeft = input.isDown('KeyA') || input.isDown('ArrowLeft')
  const turnRight = input.isDown('KeyD') || input.isDown('ArrowRight')
  const throttleUp = input.isDown('KeyW') || input.isDown('ArrowUp')
  const throttleBack = input.isDown('KeyS') || input.isDown('ArrowDown')

  const yawInput = (turnRight ? 1 : 0) - (turnLeft ? 1 : 0)
  drone.angle += yawInput * DRONE_SPECS.yawRate * dt

  let accel = 0
  if (throttleUp) {
    accel += DRONE_SPECS.forwardThrust
  }
  if (throttleBack) {
    accel -= DRONE_SPECS.reverseThrust
  }

  drone.thrust = accel > 0 ? 1 : accel < 0 ? -0.5 : 0

  if (accel !== 0) {
    const force = Vector2.fromAngle(drone.angle, accel * dt)
    drone.vel = drone.vel.add(force)
  }

  const dragFactor = Math.exp(-DRONE_SPECS.airDrag * dt)
  drone.vel = drone.vel.scale(dragFactor)

  const speed = drone.vel.length()
  if (speed > DRONE_SPECS.terminalSpeed) {
    drone.vel = drone.vel.scale(DRONE_SPECS.terminalSpeed / speed)
  }

  const spinSpeed = drone.thrust > 0 ? 34 : 14
  drone.rotorSpin = (drone.rotorSpin + spinSpeed * dt) % (Math.PI * 2)
}
