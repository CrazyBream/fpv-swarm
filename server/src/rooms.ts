import { EventEmitter } from 'node:events'
import { type EntityId, asEntityId } from '@fpv-swarm/shared/protocol.ts'
import type { WebSocket } from 'ws'
import { BotController, createBotId } from './bots.ts'
import { type MatchLogEvent, type RoomLogger, createRoomLogStream } from './log/matchlog.ts'
import { Match } from './match.ts'

export interface SocketClientState {
  id: string
  socket: WebSocket
  player: RoomPlayer | null
  room: Room | null
  missedPongs: number
  delayMs: number
  jitterMs: number
  dropRate: number
  useBinary: boolean
}

export interface RoomPlayer {
  readonly id: string
  readonly numericId: EntityId
  readonly name: string
  readonly socket: WebSocket
  readonly state: SocketClientState
}

export interface RoomEventsMap {
  event: [MatchLogEvent]
  join: [RoomPlayer]
  leave: [RoomPlayer]
  chat: [{ type: 'chat'; roomId: string; playerId: string; sender: string; text: string }]
  empty: [string]
  snapshotTick: [Match]
  error: [Error]
}

export class Room extends EventEmitter<RoomEventsMap> {
  static #nextPlayerNumericId = 1

  readonly id: string
  readonly name: string
  readonly asteroidCount: number
  readonly maxPlayers: number
  readonly isDefault: boolean
  readonly players = new Map<string, RoomPlayer>()
  readonly bots = new Map<EntityId, BotController>()
  logger: RoomLogger | null = null
  readonly match: Match

  constructor({
    id,
    name,
    asteroidCount = 7,
    maxPlayers = 160,
    isDefault = false,
  }: {
    id: string
    name: string
    asteroidCount?: number
    maxPlayers?: number
    isDefault?: boolean
  }) {
    super()
    this.id = id
    this.name = name
    this.asteroidCount = asteroidCount
    this.maxPlayers = maxPlayers
    this.isDefault = isDefault
    this.match = new Match({
      seed: 1000 + Room.#nextPlayerNumericId,
      tickRate: 30,
      onBeforeStep: (matchInstance, dt) => {
        for (const bot of this.bots.values()) {
          const cmd = bot.computeNextInput(matchInstance, dt)
          matchInstance.enqueueInput(bot.id, cmd)
        }
      },
      onSnapshot: (matchInstance) => this.emit('snapshotTick', matchInstance),
    })
  }

  allocateNumericId(): EntityId {
    const id = Room.#nextPlayerNumericId
    Room.#nextPlayerNumericId = (Room.#nextPlayerNumericId % 180) + 1
    return asEntityId(id)
  }

  spawnBots(count: number): number {
    const clamped = Math.max(0, Math.min(32, count))
    for (const botId of this.bots.keys()) {
      this.match.removePlayerShip(botId)
    }
    this.bots.clear()

    for (let i = 1; i <= clamped; i += 1) {
      const botId = createBotId(i)
      const botName = `BOT-${i}`
      const bot = new BotController(botId, botName)
      this.bots.set(botId, bot)
      this.match.addPlayerShip(botId, botName)
    }

    if (clamped > 0 || this.players.size > 0) {
      this.match.start()
    }
    return this.bots.size
  }

  join(player: RoomPlayer): void {
    if (this.players.size >= this.maxPlayers) {
      throw new Error('Room is full')
    }
    this.players.set(player.id, player)
    this.match.addPlayerShip(player.numericId, player.name)
    this.match.start()

    const evt: MatchLogEvent = {
      type: 'join',
      roomId: this.id,
      playerId: player.id,
      numericId: player.numericId,
      name: player.name,
    }
    this.logger?.writeEvent(evt)
    this.emit('event', evt)
    this.emit('join', player)
  }

  leave(playerId: string): void {
    const player = this.players.get(playerId)
    if (!player) return
    this.players.delete(playerId)
    this.match.removePlayerShip(player.numericId)

    const evt: MatchLogEvent = {
      type: 'leave',
      roomId: this.id,
      playerId: player.id,
      name: player.name,
    }
    this.logger?.writeEvent(evt)
    this.emit('event', evt)
    this.emit('leave', player)

    if (this.players.size === 0 && this.bots.size === 0) {
      this.match.stop()
      this.emit('empty', this.id)
    }
  }

  postChat(player: RoomPlayer, text: string): void {
    const msg = {
      type: 'chat' as const,
      roomId: this.id,
      playerId: player.id,
      sender: player.name,
      text,
    }
    this.logger?.writeEvent(msg)
    this.emit('event', msg)
    this.emit('chat', msg)
  }

  getRoster(): Array<{ id: string; numericId: number; name: string }> {
    const humans = Array.from(this.players.values()).map((p) => ({
      id: p.id,
      numericId: p.numericId,
      name: p.name,
    }))
    const botEntries = Array.from(this.bots.values()).map((b) => ({
      id: `bot-${b.id}`,
      numericId: b.id,
      name: b.name,
    }))
    return [...humans, ...botEntries]
  }

  toSummary() {
    const tickStats = this.match.getTickStats()
    return {
      id: this.id,
      name: this.name,
      players: this.players.size,
      bots: this.bots.size,
      maxPlayers: this.maxPlayers,
      pingMs: 12,
      asteroidCount: this.asteroidCount,
      logFile: this.logger?.fileName ?? null,
      tick: this.match.tick,
      lastTickMs: Number(this.match.lastTickDurationMs.toFixed(3)),
      tickP50Ms: tickStats.p50Ms,
      tickP95Ms: tickStats.p95Ms,
      tickP99Ms: tickStats.p99Ms,
      maxJitterMs: Number(this.match.maxTickJitterMs.toFixed(2)),
    }
  }
}

export class RoomManager {
  #rooms = new Map<string, Room>()
  #logDir: string
  #maxRooms: number
  #maxPlayersPerRoom: number

  constructor({
    logDir,
    maxRooms = 12,
    maxPlayersPerRoom = 160,
  }: {
    logDir: string
    maxRooms?: number
    maxPlayersPerRoom?: number
  }) {
    this.#logDir = logDir
    this.#maxRooms = maxRooms
    this.#maxPlayersPerRoom = maxPlayersPerRoom
  }

  async initDefaults(): Promise<void> {
    const presets = [
      {
        id: 'sector-alpha',
        name: 'Sector Alpha // Low Density',
        asteroidCount: 5,
        isDefault: true,
      },
      {
        id: 'donbas-industrial',
        name: 'Donbas Industrial // Heavy Swarm',
        asteroidCount: 10,
        isDefault: true,
      },
      {
        id: 'kyiv-poly',
        name: 'Kyiv Proving Ground // Standard',
        asteroidCount: 7,
        isDefault: true,
      },
    ]
    for (const preset of presets) {
      await this.createRoom(preset)
    }
  }

  async createRoom({
    id,
    name,
    asteroidCount = 7,
    isDefault = false,
  }: {
    id: string
    name: string
    asteroidCount?: number
    isDefault?: boolean
  }): Promise<Room> {
    const existing = this.#rooms.get(id)
    if (existing) {
      return existing
    }
    if (this.#rooms.size >= this.#maxRooms) {
      throw new Error('Server room cap reached')
    }

    const room = new Room({
      id,
      name,
      asteroidCount,
      maxPlayers: this.#maxPlayersPerRoom,
      isDefault,
    })

    room.on('error', (err) => {
      console.error(`Room [${id}] error:`, err.message)
    })

    room.logger = await createRoomLogStream(this.#logDir, id)

    room.on('empty', async () => {
      if (!room.isDefault) {
        this.#rooms.delete(id)
        await room.logger?.close()
      }
    })

    this.#rooms.set(id, room)
    return room
  }

  get(id: string): Room | undefined {
    return this.#rooms.get(id)
  }

  listSummaries() {
    return Array.from(this.#rooms.values()).map((r) => r.toSummary())
  }

  async closeAll(): Promise<void> {
    const closers: Array<Promise<void>> = []
    for (const room of this.#rooms.values()) {
      room.match.stop()
      if (room.logger) {
        closers.push(room.logger.close())
      }
    }
    await Promise.allSettled(closers)
  }
}
