import { EventEmitter } from 'node:events'
import { createRoomLogStream } from './log/matchlog.js'

export class Room extends EventEmitter {
  constructor({ id, name, asteroidCount = 7, maxPlayers = 8, isDefault = false }) {
    super()
    this.id = id
    this.name = name
    this.asteroidCount = asteroidCount
    this.maxPlayers = maxPlayers
    this.isDefault = isDefault
    this.players = new Map()
    this.logger = null
  }

  join(player) {
    if (this.players.size >= this.maxPlayers) {
      throw new Error('Room is full')
    }
    this.players.set(player.id, player)
    const evt = { type: 'join', roomId: this.id, playerId: player.id, name: player.name }
    this.logger?.writeEvent(evt)
    this.emit('event', evt)
    this.emit('join', player)
  }

  leave(playerId) {
    const player = this.players.get(playerId)
    if (!player) return
    this.players.delete(playerId)
    const evt = { type: 'leave', roomId: this.id, playerId: player.id, name: player.name }
    this.logger?.writeEvent(evt)
    this.emit('event', evt)
    this.emit('leave', player)

    if (this.players.size === 0) {
      this.emit('empty', this.id)
    }
  }

  postChat(player, text) {
    const msg = {
      type: 'chat',
      roomId: this.id,
      playerId: player.id,
      sender: player.name,
      text,
    }
    this.logger?.writeEvent(msg)
    this.emit('event', msg)
    this.emit('chat', msg)
  }

  getRoster() {
    return Array.from(this.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
    }))
  }

  toSummary() {
    return {
      id: this.id,
      name: this.name,
      players: this.players.size,
      maxPlayers: this.maxPlayers,
      pingMs: 12,
      asteroidCount: this.asteroidCount,
      logFile: this.logger?.fileName ?? null,
    }
  }
}

export class RoomManager {
  #rooms = new Map()
  #logDir
  #maxRooms
  #maxPlayersPerRoom

  constructor({ logDir, maxRooms = 12, maxPlayersPerRoom = 8 }) {
    this.#logDir = logDir
    this.#maxRooms = maxRooms
    this.#maxPlayersPerRoom = maxPlayersPerRoom
  }

  async initDefaults() {
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

  async createRoom({ id, name, asteroidCount = 7, isDefault = false }) {
    if (this.#rooms.has(id)) {
      return this.#rooms.get(id)
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

  get(id) {
    return this.#rooms.get(id)
  }

  listSummaries() {
    return Array.from(this.#rooms.values()).map((r) => r.toSummary())
  }

  async closeAll() {
    const closers = []
    for (const room of this.#rooms.values()) {
      if (room.logger) {
        closers.push(room.logger.close())
      }
    }
    await Promise.allSettled(closers)
  }
}
