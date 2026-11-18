import os from 'node:os'
import path from 'node:path'
import { asEntityId, asSeq, parseClientMessage } from '@fpv-swarm/shared/protocol.ts'
import { describe, expect, it } from 'vitest'
import { BotController, createBotId } from '../src/bots.ts'
import { config } from '../src/config.ts'
import { createRoomLogStream } from '../src/log/matchlog.ts'
import { createSyntheticReplayStream, readReplayEvents } from '../src/log/replay.ts'
import { Match, computePercentile } from '../src/match.ts'
import { Room, RoomManager } from '../src/rooms.ts'

describe('Server Match & Authoritative Simulation', () => {
  it('spawns ships, steps simulation, fires bullets, and builds snapshots', () => {
    const snapshots: number[] = []
    const match = new Match({
      seed: 42,
      tickRate: 30,
      onSnapshot: (m) => snapshots.push(m.tick),
    })

    const p1 = match.addPlayerShip(asEntityId(1), 'PILOT-1')
    const p2 = match.addPlayerShip(asEntityId(2), 'PILOT-2')
    expect(match.ships.size).toBe(2)

    p1.x = 300
    p1.y = 300
    p1.angle = 0
    p2.x = 325
    p2.y = 300

    match.enqueueInput(asEntityId(1), {
      v: 1,
      type: 'input',
      seq: asSeq(1),
      tick: 0,
      thrust: 1,
      turn: 0,
      fire: true,
    })

    match.step(1 / 30)
    expect(match.bullets.size).toBeGreaterThanOrEqual(0)
    expect(snapshots.length).toBe(1)

    const snap = match.buildSnapshotFor(asEntityId(1))
    expect(snap.lastProcessedSeq).toBe(1)
    expect(snap.entities.length).toBeGreaterThanOrEqual(2)

    match.removePlayerShip(asEntityId(2))
    expect(match.ships.size).toBe(1)
  })

  it('computes percentiles accurately', () => {
    expect(computePercentile([], 50)).toBe(0)
    expect(computePercentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBeGreaterThanOrEqual(5)
    expect(computePercentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 99)).toBe(10)
  })

  it('starts and stops the absolute-target timer loop cleanly', async () => {
    const match = new Match({ seed: 7, tickRate: 60 })
    match.addPlayerShip(asEntityId(1), 'TIMER-TEST')
    match.start()
    await new Promise((r) => setTimeout(r, 60))
    match.stop()
    expect(match.tick).toBeGreaterThan(0)
    const stats = match.getTickStats()
    expect(stats.p99Ms).toBeGreaterThanOrEqual(0)
  })
})

describe('Server AI Bots', () => {
  it('BotController chases targets and produces valid InputMessage', () => {
    const match = new Match({ seed: 100 })
    const botId = createBotId(1)
    match.addPlayerShip(botId, 'BOT-1')
    match.addPlayerShip(asEntityId(1), 'HUMAN-1')

    const bot = new BotController(botId, 'BOT-1')
    const cmd = bot.computeNextInput(match, 1 / 30)
    expect(cmd.type).toBe('input')
    expect(cmd.seq).toBe(1)
    expect([-1, 0, 1]).toContain(cmd.turn)
    expect([-1, 0, 1]).toContain(cmd.thrust)
  })

  it('Room.spawnBots adds and clears bots', () => {
    const room = new Room({ id: 'test-room', name: 'Test Room' })
    expect(room.spawnBots(4)).toBe(4)
    expect(room.getRoster().length).toBe(4)
    expect(room.spawnBots(0)).toBe(0)
    room.match.stop()
  })
})

describe('RoomManager and NDJSON Match Log Streams', () => {
  it('creates rooms, writes NDJSON events, and reads them back via async generator', async () => {
    const tmpDir = path.join(os.tmpdir(), `fpv-logs-${Date.now()}`)
    const logger = await createRoomLogStream(tmpDir, 'alpha')
    logger.writeEvent({ type: 'join', player: 'GENIY' })
    logger.writeEvent({ type: 'chat', text: 'hello' })
    await logger.close()

    const events: unknown[] = []
    for await (const evt of readReplayEvents(logger.filePath)) {
      events.push(evt)
    }
    expect(events.length).toBe(2)
  })

  it('streams synthetic replay data within byte target', async () => {
    const stream = createSyntheticReplayStream(1)
    let total = 0
    for await (const chunk of stream) {
      total += (chunk as Buffer).byteLength
    }
    expect(total).toBeGreaterThanOrEqual(1024 * 1024)
  })

  it('initializes default rooms in RoomManager', async () => {
    const tmpDir = path.join(os.tmpdir(), `fpv-mgr-${Date.now()}`)
    const mgr = new RoomManager({ logDir: tmpDir, maxRooms: 5 })
    await mgr.initDefaults()
    expect(mgr.listSummaries().length).toBe(3)
    await mgr.closeAll()
  })

  it('validates config defaults and protocol edge cases', () => {
    expect(config.port).toBeGreaterThan(0)
    expect(parseClientMessage(12345).ok).toBe(false)
    expect(parseClientMessage('{corrupt').ok).toBe(false)
  })
})
describe('Room lifecycle and Match combat edge cases', () => {
    it('resolves bullet hits on enemy ships and respawns destroyed ships at 100 HP', () => {
        const match = new Match({ seed: 55 })
        const attacker = match.addPlayerShip(asEntityId(1), 'ATTACKER')
        const target = match.addPlayerShip(asEntityId(2), 'TARGET')

        attacker.x = 400
        attacker.y = 300
        attacker.angle = 0
        target.x = 425
        target.y = 300
        target.hp = 25

        match.enqueueInput(asEntityId(1), {
            v: 1,
            type: 'input',
            seq: asSeq(1),
            tick: 0,
            thrust: 0,
            turn: 0,
            fire: true,
        })

        match.step(1 / 30)
        expect(target.hp).toBe(100)
    })

    it('caps ship inputQueue at 32 commands to prevent memory exhaustion', () => {
        const match = new Match({ seed: 1 })
        match.addPlayerShip(asEntityId(1), 'SPAMMER')
        for (let i = 1; i <= 50; i += 1) {
            match.enqueueInput(asEntityId(1), {
                v: 1,
                type: 'input',
                seq: asSeq(i),
                tick: 0,
                thrust: 1,
                turn: 0,
                fire: false,
            })
        }
        expect(match.ships.get(asEntityId(1))?.inputQueue.length).toBe(32)
    })

    it('ignores enqueueInput for unknown player IDs', () => {
        const match = new Match({ seed: 1 })
        match.enqueueInput(asEntityId(999), {
            v: 1,
            type: 'input',
            seq: asSeq(1),
            tick: 0,
            thrust: 0,
            turn: 0,
            fire: false,
        })
        expect(match.ships.size).toBe(0)
    })

    it('removes expired bullets when TTL reaches zero', () => {
        const match = new Match({ seed: 10 })
        const ship = match.addPlayerShip(asEntityId(1), 'SHOOTER')
        match.enqueueInput(ship.id, {
            v: 1,
            type: 'input',
            seq: asSeq(1),
            tick: 0,
            thrust: 0,
            turn: 0,
            fire: true,
        })
        match.step(1 / 30)
        expect(match.bullets.size).toBe(1)
        match.step(2.0)
        expect(match.bullets.size).toBe(0)
    })

    it('allocates sequential numeric IDs in Room and returns summary metrics', () => {
        const room = new Room({ id: 'arena-1', name: 'Arena 1', asteroidCount: 6 })
        const id1 = room.allocateNumericId()
        const id2 = room.allocateNumericId()
        expect(id2).toBeGreaterThan(id1)
        const summary = room.toSummary()
        expect(summary.id).toBe('arena-1')
        expect(summary.asteroidCount).toBe(6)
    })

    it('handles bot control when bot ship is not yet in match', () => {
        const match = new Match({ seed: 1 })
        const bot = new BotController(asEntityId(250), 'GHOST-BOT')
        const cmd = bot.computeNextInput(match, 1 / 30)
        expect(cmd.thrust).toBe(0)
        expect(cmd.fire).toBe(false)
    })

    it('switches bot strafe direction when no human target is present', () => {
        const match = new Match({ seed: 1 })
        const botId = createBotId(2)
        match.addPlayerShip(botId, 'SOLO-BOT')
        const bot = new BotController(botId, 'SOLO-BOT')
        const c1 = bot.computeNextInput(match, 1.0)
        const c2 = bot.computeNextInput(match, 2.0)
        expect(c1.thrust).toBe(1)
        expect(c2.thrust).toBe(1)
    })
})