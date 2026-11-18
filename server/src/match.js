import { ENTITY_KIND } from '@fpv-swarm/shared/protocol/messages.js'
import {
  SHARED_DRONE_SPECS,
  clampAxisWrap,
  integrateStep,
} from '@fpv-swarm/shared/sim/kinematics.js'
import { mulberry32 } from '@fpv-swarm/shared/sim/prng.js'

export class Match {
  #rng
  #running = false
  #timer = null
  #nextTickAt = 0
  #nextEntityId = 500

  constructor({ seed = 1337, tickRate = 30, onSnapshot } = {}) {
    this.seed = seed
    this.tickRate = tickRate
    this.stepSec = 1 / tickRate
    this.stepMs = 1000 / tickRate
    this.tick = 0
    this.#rng = mulberry32(seed)
    this.onSnapshot = onSnapshot

    this.ships = new Map()
    this.bullets = new Map()
    this.lastTickDurationMs = 0
    this.maxTickJitterMs = 0
  }

  addPlayerShip(numericId, name) {
    const x = 200 + this.#rng() * (SHARED_DRONE_SPECS.arenaWidth - 400)
    const y = 160 + this.#rng() * (SHARED_DRONE_SPECS.arenaHeight - 320)
    const ship = {
      id: numericId,
      name,
      kind: ENTITY_KIND.SHIP,
      x,
      y,
      vx: 0,
      vy: 0,
      angle: -Math.PI / 2,
      hp: 100,
      cooldown: 0,
      lastProcessedSeq: 0,
      inputQueue: [],
    }
    this.ships.set(numericId, ship)
    return ship
  }

  removePlayerShip(numericId) {
    this.ships.delete(numericId)
  }

  enqueueInput(numericId, inputMsg) {
    const ship = this.ships.get(numericId)
    if (!ship) return
    if (ship.inputQueue.length < 32) {
      ship.inputQueue.push(inputMsg)
    }
  }

  start() {
    if (this.#running) return
    this.#running = true
    this.#nextTickAt = performance.now() + this.stepMs
    const loop = () => {
      if (!this.#running) return
      const now = performance.now()
      const jitter = Math.abs(now - this.#nextTickAt)
      if (jitter > this.maxTickJitterMs) {
        this.maxTickJitterMs = jitter
      }

      const t0 = performance.now()
      this.step(this.stepSec)
      this.lastTickDurationMs = performance.now() - t0

      this.#nextTickAt += this.stepMs
      const delay = Math.max(0, this.#nextTickAt - performance.now())
      this.#timer = setTimeout(loop, delay)
    }
    this.#timer = setTimeout(loop, this.stepMs)
  }

  stop() {
    this.#running = false
    if (this.#timer) {
      clearTimeout(this.#timer)
      this.#timer = null
    }
  }

  step(dt) {
    this.tick += 1

    for (const ship of this.ships.values()) {
      if (ship.cooldown > 0) {
        ship.cooldown = Math.max(0, ship.cooldown - dt)
      }

      if (ship.inputQueue.length === 0) {
        integrateStep(ship, { thrust: 0, turn: 0, fire: false }, dt)
      } else {
        while (ship.inputQueue.length > 0) {
          const cmd = ship.inputQueue.shift()
            integrateStep(ship, cmd, 1 / 60)
          if (cmd.seq > ship.lastProcessedSeq) {
            ship.lastProcessedSeq = cmd.seq
          }
          if (cmd.fire && ship.cooldown <= 0) {
            ship.cooldown = SHARED_DRONE_SPECS.baseCooldown
            this.#spawnBullet(ship)
          }
        }
      }
    }

    for (const [bid, b] of this.bullets) {
      b.x = clampAxisWrap(b.x + b.vx * dt, SHARED_DRONE_SPECS.arenaWidth)
      b.y = clampAxisWrap(b.y + b.vy * dt, SHARED_DRONE_SPECS.arenaHeight)
      b.ttl -= dt

      for (const ship of this.ships.values()) {
        if (ship.id === b.ownerId) continue
        const dist = Math.hypot(ship.x - b.x, ship.y - b.y)
        if (dist <= 19) {
          b.ttl = 0
          ship.hp = Math.max(0, ship.hp - 25)
          if (ship.hp === 0) {
            ship.hp = 100
            ship.x = 200 + this.#rng() * (SHARED_DRONE_SPECS.arenaWidth - 400)
            ship.y = 160 + this.#rng() * (SHARED_DRONE_SPECS.arenaHeight - 320)
            ship.vx = 0
            ship.vy = 0
          }
          break
        }
      }

      if (b.ttl <= 0) {
        this.bullets.delete(bid)
      }
    }

    this.onSnapshot?.(this)
  }

  #spawnBullet(ship) {
    const id = this.#nextEntityId++
    if (this.#nextEntityId > 60000) this.#nextEntityId = 500
    const noseX = ship.x + Math.cos(ship.angle) * 20
    const noseY = ship.y + Math.sin(ship.angle) * 20
    const vx = Math.cos(ship.angle) * SHARED_DRONE_SPECS.muzzleSpeed + ship.vx
    const vy = Math.sin(ship.angle) * SHARED_DRONE_SPECS.muzzleSpeed + ship.vy

    this.bullets.set(id, {
      id,
      kind: ENTITY_KIND.BULLET,
      ownerId: ship.id,
      x: noseX,
      y: noseY,
      vx,
      vy,
      angle: ship.angle,
      hp: 1,
      ttl: 1.4,
    })
  }

  buildSnapshotFor(numericPlayerId) {
    const recipient = this.ships.get(numericPlayerId)
    const entities = []
    for (const s of this.ships.values()) {
      entities.push({
        id: s.id,
        kind: ENTITY_KIND.SHIP,
        hp: s.hp,
        x: s.x,
        y: s.y,
        vx: s.vx,
        vy: s.vy,
        angle: s.angle,
        ownerId: s.id,
      })
    }
    for (const b of this.bullets.values()) {
      entities.push({
        id: b.id,
        kind: ENTITY_KIND.BULLET,
        hp: 1,
        x: b.x,
        y: b.y,
        vx: b.vx,
        vy: b.vy,
        angle: b.angle,
        ownerId: b.ownerId,
      })
    }
    return {
      type: 'snapshot',
      v: 1,
      tick: this.tick,
      lastProcessedSeq: recipient ? recipient.lastProcessedSeq : 0,
      serverTimeMs: Math.floor(performance.now()) >>> 0,
      entities,
    }
  }
}
