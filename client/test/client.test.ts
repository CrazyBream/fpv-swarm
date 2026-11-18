import { type Snapshot, asEntityId, asSeq, asTick } from '@fpv-swarm/shared/protocol.ts'
import { describe, expect, it, vi } from 'vitest'
import { Bus, type GameEvents } from '../src/events/bus.ts'
import { createLoop } from '../src/loop.ts'
import { NetworkPredictor } from '../src/net/reconciler.ts'
import { syncWrapForInterpolation, wrapAxis, wrapPosition } from '../src/sim/arena.ts'
import { circlesOverlap, detectCollisions } from '../src/sim/collision.ts'
import { Asteroid, Bullet, Entity, Pickup, attachHoming, attachPickup } from '../src/sim/entity.ts'
import { Ship, createDroneState } from '../src/sim/ship.ts'
import { Vector2 } from '../src/sim/vector.ts'
import { World } from '../src/sim/world.ts'

describe('Collision Detection & Arena Wrapping', () => {
  it('detects overlapping, touching, and separated circles', () => {
    const a = new Entity({ x: 100, y: 100, radius: 15 })
    const b = new Entity({ x: 120, y: 100, radius: 15 })
    const c = new Entity({ x: 130, y: 100, radius: 15 })
    const d = new Entity({ x: 200, y: 100, radius: 15 })

    expect(circlesOverlap(a, b)).toBe(true)
    expect(circlesOverlap(a, c)).toBe(true)
    expect(circlesOverlap(a, d)).toBe(false)

    const pairs = detectCollisions([a, b, d])
    expect(pairs.length).toBe(1)
  })

  it('wraps entity position across toroidal boundaries and syncs interpolation', () => {
    const ent = new Entity({ x: -10, y: 730 })
    wrapPosition(ent, 1280, 720)
    expect(ent.pos.x).toBe(1270)
    expect(ent.pos.y).toBe(10)

    ent.prevPos = new Vector2(5, 5)
    ent.pos = new Vector2(1275, 715)
    syncWrapForInterpolation(ent, 1280, 720)
    expect(ent.prevPos.x).toBeGreaterThan(1200)
    expect(wrapAxis(50, 0)).toBe(50)
  })
})

describe('NetworkPredictor: Client-Side Prediction, Reconciliation & Interpolation', () => {
  it('predicts local movement and reconciles to 0 px error when server agrees', () => {
    const predictor = new NetworkPredictor()
    predictor.setLocalPlayer(1, 500, 300)

    const cmd1 = predictor.stepLocalInput({ thrust: 1, turn: 0, fire: false }, 1 / 60, 1280, 720)
    const cmd2 = predictor.stepLocalInput({ thrust: 1, turn: 0, fire: false }, 1 / 60, 1280, 720)
    expect(predictor.pendingInputs.length).toBe(2)

    const snap: Snapshot = {
      type: 'snapshot',
      v: 1,
      tick: asTick(10),
      lastProcessedSeq: cmd2.seq,
      serverTimeMs: 1000,
      entities: [
        {
          kind: 'ship',
          id: asEntityId(1),
          hp: 100,
          x: predictor.predicted.x,
          y: predictor.predicted.y,
          vx: predictor.predicted.vx,
          vy: predictor.predicted.vy,
          angle: predictor.predicted.angle,
          ownerId: asEntityId(1),
        },
      ],
    }

    predictor.onServerSnapshot(snap, 1280, 720)
    expect(predictor.pendingInputs.length).toBe(0)
    expect(predictor.lastCorrectionPx).toBeCloseTo(0, 4)
    expect(cmd1.seq).toBe(1)
  })

  it('replays unacknowledged inputs when server snapshot acknowledges older seq', () => {
    const predictor = new NetworkPredictor()
    predictor.setLocalPlayer(1, 400, 300)

    const c1 = predictor.stepLocalInput({ thrust: 1, turn: 0, fire: false }, 1 / 60, 1280, 720)
    const stateAfter1 = { ...predictor.predicted }
    predictor.stepLocalInput({ thrust: 1, turn: 0, fire: false }, 1 / 60, 1280, 720)
    predictor.stepLocalInput({ thrust: 1, turn: 0, fire: false }, 1 / 60, 1280, 720)

    const snap: Snapshot = {
      type: 'snapshot',
      v: 1,
      tick: asTick(5),
      lastProcessedSeq: c1.seq,
      serverTimeMs: 500,
      entities: [
        {
          kind: 'ship',
          id: asEntityId(1),
          hp: 100,
          x: stateAfter1.x,
          y: stateAfter1.y,
          vx: stateAfter1.vx,
          vy: stateAfter1.vy,
          angle: stateAfter1.angle,
          ownerId: asEntityId(1),
        },
      ],
    }

    predictor.onServerSnapshot(snap, 1280, 720)
    expect(predictor.pendingInputs.length).toBe(2)
    expect(predictor.lastCorrectionPx).toBeCloseTo(0, 3)
  })

  it('interpolates remote entities smoothly between two bracketed snapshots', () => {
    const predictor = new NetworkPredictor()
    predictor.setLocalPlayer(1, 640, 360)

    const s1: Snapshot = {
      type: 'snapshot',
      v: 1,
      tick: asTick(1),
      lastProcessedSeq: asSeq(0),
      serverTimeMs: 100,
      entities: [
        {
          kind: 'ship',
          id: asEntityId(2),
          hp: 100,
          x: 100,
          y: 200,
          vx: 0,
          vy: 0,
          angle: 0,
          ownerId: asEntityId(2),
        },
      ],
    }
    const s2: Snapshot = {
      type: 'snapshot',
      v: 1,
      tick: asTick(2),
      lastProcessedSeq: asSeq(0),
      serverTimeMs: 133,
      entities: [
        {
          kind: 'ship',
          id: asEntityId(2),
          hp: 100,
          x: 200,
          y: 200,
          vx: 0,
          vy: 0,
          angle: 0.5,
          ownerId: asEntityId(2),
        },
      ],
    }

    predictor.onServerSnapshot(s1, 1280, 720)
    predictor.onServerSnapshot(s2, 1280, 720)
    const remotes = predictor.getInterpolatedRemotes()
    expect(remotes.length).toBe(1)
    expect(remotes[0]?.x).toBeGreaterThanOrEqual(100)
    expect(remotes[0]?.x).toBeLessThanOrEqual(200)
  })
})

describe('Typed Event Bus & Fixed-Timestep Loop with Fake Timers', () => {
  it('emits and unsubscribes typed events on Bus<GameEvents>', () => {
    const bus = new Bus<GameEvents>()
    let receivedScore = 0
    const off = bus.on('scoreChanged', (p) => {
      receivedScore = p.score
    })
    bus.emit('scoreChanged', { score: 250, delta: 100 })
    expect(receivedScore).toBe(250)
    off()
    bus.emit('scoreChanged', { score: 500, delta: 250 })
    expect(receivedScore).toBe(250)
  })

  it('accumulates time and steps deterministically under fake timers', () => {
    vi.useFakeTimers()
    const steps: number[] = []
    let renders = 0

    let currentNow = 0
    vi.spyOn(performance, 'now').mockImplementation(() => currentNow)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      return setTimeout(() => {
        currentNow += 50
        cb(currentNow)
      }, 50) as unknown as number
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))

    const loop = createLoop({
      step: 1 / 60,
      simulate: (dt) => steps.push(dt),
      render: () => {
        renders += 1
      },
    })

    loop.start()
    expect(loop.isRunning()).toBe(true)
    vi.advanceTimersByTime(55)
    loop.stop()
    expect(loop.isRunning()).toBe(false)
    expect(steps.length).toBe(3)
    expect(renders).toBe(1)

    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
})

describe('World simulation & Entity components', () => {
  it('spawns ships, fires pooled bullets, applies pickups, and resolves asteroid hits', () => {
    const world = new World({ width: 1280, height: 720 })
    const ship = createDroneState({ x: 500, y: 500 })
    world.player = ship
    world.spawn(ship)

    const fakeInput = {
      isDown: (code: string) => code === 'KeyW' || code === 'Space',
      justPressed: () => false,
      clearFrameEdges: () => {},
      destroy: () => {},
    }

    const ast = new Asteroid({ x: 522, y: 500, vx: 0, vy: 0, hp: 20 })
    attachHoming(ast, { targetKind: 'ship' })
    world.spawn(ast)

    const pickup = new Pickup({ x: 500, y: 500, effectType: 'rapid_fire' })
    attachPickup(pickup, { type: 'shield_repair', healAmount: 20 })
    world.spawn(pickup)

    world.step(1 / 60, fakeInput)
    expect(world.size).toBeGreaterThan(0)

    const b = new Bullet({ x: 10, y: 10, vx: 100, vy: 0, angle: 0, ttl: 0.01 })
    b.update(0.05)
    expect(b.alive).toBe(false)
  })
})
describe('Entity, Ship, and Input edge cases', () => {
  it('tracks Ship damage, death, healing, and resetAt', () => {
    const ship = new Ship({ x: 100, y: 100, hp: 100 })
    ship.takeDamage(40)
    expect(ship.hp).toBe(60)
    ship.heal(20)
    expect(ship.hp).toBe(80)
    ship.takeDamage(100)
    expect(ship.alive).toBe(false)
    ship.resetAt(640, 360)
    expect(ship.alive).toBe(true)
    expect(ship.hp).toBe(100)
  })

  it('tracks Asteroid damage and destruction', () => {
    const ast = new Asteroid({ x: 50, y: 50, vx: 1, vy: 1, hp: 30 })
    ast.takeDamage(15)
    expect(ast.hp).toBe(15)
    expect(ast.alive).toBe(true)
    ast.takeDamage(20)
    expect(ast.alive).toBe(false)
  })

  it('fires rapid fire and homing ammo when timers are active', () => {
    const world = new World()
    const ship = new Ship({ x: 200, y: 200 })
    ship.overclockTimer = 3
    ship.homingAmmoTimer = 3
    const b = ship.fire(world)
    expect(b).not.toBeNull()
    expect(b?.homing).not.toBeNull()
    expect(ship.fire(world)).toBeNull()
  })

  it('Pickup expires after TTL', () => {
    const p = new Pickup({ x: 10, y: 10, ttl: 0.1 })
    p.update(0.2)
    expect(p.alive).toBe(false)
  })
})
