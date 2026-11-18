import { Bullet, Entity, attachHoming } from './entity.js'
import { Vector2 } from './vector.js'

export const DRONE_SPECS = {
  yawRate: 4.4,
  forwardThrust: 640,
  reverseThrust: 300,
  airDrag: 1.55,
  terminalSpeed: 440,
  muzzleSpeed: 540,
  baseCooldown: 0.22,
}

export class Ship extends Entity {
  #hp = 100
  #maxHp = 100

  constructor({ x = 0, y = 0, angle = -Math.PI / 2 } = {}) {
    super({ x, y, vx: 0, vy: 0, angle, radius: 15, kind: 'ship' })
    this.thrust = 0
    this.rotorSpin = 0
    this.cooldown = 0
    this.overclockTimer = 0
    this.homingAmmoTimer = 0
  }

  get hp() {
    return this.#hp
  }

  get maxHp() {
    return this.#maxHp
  }

  takeDamage(amount) {
    if (!this.alive) return
    this.#hp = Math.max(0, this.#hp - amount)
    if (this.#hp === 0) {
      this.alive = false
    }
  }

  heal(amount) {
    this.#hp = Math.min(this.#maxHp, this.#hp + amount)
  }

  resetAt(x, y) {
    this.pos.x = x
    this.pos.y = y
    this.prevPos.x = x
    this.prevPos.y = y
    this.vel.x = 0
    this.vel.y = 0
    this.angle = -Math.PI / 2
    this.prevAngle = this.angle
    this.#hp = this.#maxHp
    this.alive = true
    this.cooldown = 0
    this.overclockTimer = 0
    this.homingAmmoTimer = 0
  }

  activateOverclock(seconds) {
    this.overclockTimer = Math.max(this.overclockTimer, seconds)
  }

  activateHomingAmmo(seconds) {
    this.homingAmmoTimer = Math.max(this.homingAmmoTimer, seconds)
  }

  fire(world) {
    if (!this.alive || this.cooldown > 0) return null
    const noseOffset = Vector2.fromAngle(this.angle, this.radius + 6)
    const spawnPos = this.pos.add(noseOffset)
    const muzzleVel = Vector2.fromAngle(this.angle, DRONE_SPECS.muzzleSpeed).add(this.vel)

    const bullet = new Bullet({
      x: spawnPos.x,
      y: spawnPos.y,
      vx: muzzleVel.x,
      vy: muzzleVel.y,
      angle: this.angle,
      ownerId: this.id,
    })

    if (this.homingAmmoTimer > 0) {
      attachHoming(bullet, {
        targetKind: 'asteroid',
        turnRate: 5.2,
        speed: DRONE_SPECS.muzzleSpeed,
      })
    }

    this.cooldown =
      this.overclockTimer > 0 ? DRONE_SPECS.baseCooldown * 0.45 : DRONE_SPECS.baseCooldown
    if (world) {
      world.spawn(bullet)
    }
    return bullet
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown = Math.max(0, this.cooldown - dt)
    if (this.overclockTimer > 0) this.overclockTimer = Math.max(0, this.overclockTimer - dt)
    if (this.homingAmmoTimer > 0) this.homingAmmoTimer = Math.max(0, this.homingAmmoTimer - dt)

    const spinRate = this.thrust !== 0 ? 42 : 16
    this.rotorSpin = (this.rotorSpin + spinRate * dt) % (Math.PI * 2)
  }
}

export function integrate(ship, input, dt) {
  const turnLeft = input.isDown('KeyA') || input.isDown('ArrowLeft')
  const turnRight = input.isDown('KeyD') || input.isDown('ArrowRight')
  const throttleUp = input.isDown('KeyW') || input.isDown('ArrowUp')
  const throttleBack = input.isDown('KeyS') || input.isDown('ArrowDown')

  const yawInput = (turnRight ? 1 : 0) - (turnLeft ? 1 : 0)
  ship.angle += yawInput * DRONE_SPECS.yawRate * dt

  let accel = 0
  if (throttleUp) {
    accel = DRONE_SPECS.forwardThrust
  } else if (throttleBack) {
    accel = -DRONE_SPECS.reverseThrust
  }
  ship.thrust = accel

  if (accel !== 0) {
    ship.vel.x += Math.cos(ship.angle) * accel * dt
    ship.vel.y += Math.sin(ship.angle) * accel * dt
  }

  const dragFactor = Math.exp(-DRONE_SPECS.airDrag * dt)
  ship.vel.scaleInPlace(dragFactor)

  const currentSpeed = ship.vel.length()
  if (currentSpeed > DRONE_SPECS.terminalSpeed) {
    ship.vel.scaleInPlace(DRONE_SPECS.terminalSpeed / currentSpeed)
  }

  ship.pos.addInPlace(ship.vel.scale(dt))
  return ship
}
