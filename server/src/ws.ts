import { Buffer } from 'node:buffer'
import crypto from 'node:crypto'
import type http from 'node:http'
import { decodeInputBinary, encodeSnapshotBinary } from '@fpv-swarm/shared/codec/binary.ts'
import {
  type ClientMessage,
  assertNever,
  encodeServerMessage,
  parseClientMessage,
} from '@fpv-swarm/shared/protocol.ts'
import { type RawData, type WebSocket, WebSocketServer } from 'ws'
import type { ServerConfig } from './config.ts'
import type { Room, RoomManager, RoomPlayer, SocketClientState } from './rooms.ts'

class TokenBucket {
  readonly capacity: number
  tokens: number
  lastRefill: number

  constructor(ratePerSec: number) {
    this.capacity = ratePerSec
    this.tokens = ratePerSec
    this.lastRefill = performance.now()
  }

  consume(): boolean {
    const now = performance.now()
    const elapsedSec = (now - this.lastRefill) / 1000
    this.lastRefill = now
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.capacity)
    if (this.tokens < 1) {
      return false
    }
    this.tokens -= 1
    return true
  }
}

function rawDataToUint8(raw: RawData): Uint8Array {
  if (raw instanceof ArrayBuffer) {
    return new Uint8Array(raw)
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw)
  }
  return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
}

export function attachWebSocketGateway(
  httpServer: http.Server,
  roomManager: RoomManager,
  config: ServerConfig,
) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: config.maxPayloadBytes,
  })

  const boundRooms = new Set<string>()
  const clientStates = new WeakMap<WebSocket, SocketClientState>()

  function sendWithNetSim(
    state: SocketClientState,
    payload: string | Buffer,
    { critical = false, droppable = false } = {},
  ): void {
    const { socket } = state
    if (socket.readyState !== 1) return

    if (socket.bufferedAmount > config.slowClientThresholdBytes) {
      if (!critical) return
      socket.close(1008, 'Slow client buffer overflow')
      return
    }

    if (droppable && state.dropRate > 0 && Math.random() < state.dropRate) {
      return
    }

    const totalDelay =
      state.delayMs > 0
        ? Math.max(0, state.delayMs * 0.5 + (Math.random() * 2 - 1) * state.jitterMs * 0.5)
        : 0

    if (totalDelay <= 0) {
      socket.send(payload)
    } else {
      setTimeout(() => {
        if (socket.readyState === 1) {
          socket.send(payload)
        }
      }, totalDelay)
    }
  }

  function broadcastRoom(room: Room, payloadStr: string, { critical = false } = {}): void {
    for (const member of room.players.values()) {
      sendWithNetSim(member.state, payloadStr, { critical, droppable: false })
    }
  }

  function ensureRoomSnapshotHook(room: Room): void {
    if (boundRooms.has(room.id)) return
    boundRooms.add(room.id)

    room.on('snapshotTick', (match) => {
      for (const member of room.players.values()) {
        const snap = match.buildSnapshotFor(member.numericId)
        if (member.state.useBinary) {
          const binBuf = encodeSnapshotBinary(snap)
          sendWithNetSim(member.state, Buffer.from(binBuf), { critical: false, droppable: true })
        } else {
          sendWithNetSim(member.state, JSON.stringify(snap), { critical: false, droppable: true })
        }
      }
    })
  }

  wss.on('connection', (socket: WebSocket) => {
    const bucket = new TokenBucket(config.rateLimitPerSec)
    const state: SocketClientState = {
      id: crypto.randomUUID().slice(0, 8),
      socket,
      player: null,
      room: null,
      missedPongs: 0,
      delayMs: 0,
      jitterMs: 0,
      dropRate: 0,
      useBinary: true,
    }
    clientStates.set(socket, state)

    socket.on('error', (err: Error) => {
      console.error(`Socket [${state.id}] error:`, err.message)
    })

    socket.on('pong', () => {
      state.missedPongs = 0
    })

    const joinTimer = setTimeout(() => {
      if (!state.room) {
        socket.close(4001, 'Join timeout exceeded (5s)')
      }
    }, config.joinTimeoutMs)

    async function dispatchClientMessage(msg: ClientMessage): Promise<void> {
      switch (msg.type) {
        case 'join': {
          if (state.room) {
            state.room.leave(state.id)
          }
          clearTimeout(joinTimer)

          try {
            let room = roomManager.get(msg.room)
            if (!room) {
              room = await roomManager.createRoom({
                id: msg.room,
                name: `Sector ${msg.room}`,
                asteroidCount: 7,
              })
            }
            ensureRoomSnapshotHook(room)

            const numericId = room.allocateNumericId()
            const player: RoomPlayer = {
              id: state.id,
              numericId,
              name: msg.name,
              socket,
              state,
            }
            room.join(player)
            state.player = player
            state.room = room

            socket.send(
              encodeServerMessage({
                type: 'welcome',
                playerId: numericId,
                seed: room.match.seed,
                room: room.id,
              }),
            )

            const rosterMsg = encodeServerMessage({
              type: 'roster',
              room: room.id,
              players: room.getRoster(),
            })
            broadcastRoom(room, rosterMsg, { critical: true })

            const sysMsg = encodeServerMessage({
              type: 'system',
              text: `${player.name} [#${numericId}] joined ${room.name}`,
            })
            broadcastRoom(room, sysMsg, { critical: false })
          } catch (err: unknown) {
            const reason = err instanceof Error ? err.message : 'Join failed'
            socket.close(1008, reason)
          }
          return
        }

        case 'input': {
          if (!state.room || !state.player) return
          if (state.dropRate > 0 && Math.random() < state.dropRate) return

          const inDelay =
            state.delayMs > 0
              ? Math.max(0, state.delayMs * 0.5 + (Math.random() * 2 - 1) * state.jitterMs * 0.5)
              : 0

          if (inDelay <= 0) {
            state.room.match.enqueueInput(state.player.numericId, msg)
          } else {
            const roomRef = state.room
            const numId = state.player.numericId
            setTimeout(() => {
              roomRef.match.enqueueInput(numId, msg)
            }, inDelay)
          }
          return
        }

        case 'netsim': {
          state.delayMs = msg.delayMs
          state.jitterMs = msg.jitterMs
          state.dropRate = msg.dropRate
          state.useBinary = msg.useBinary
          return
        }

        case 'ping_rtt': {
          const pongStr = encodeServerMessage({
            type: 'pong_rtt',
            clientSentAt: msg.clientSentAt,
          })
          sendWithNetSim(state, pongStr, { critical: false, droppable: false })
          return
        }

        case 'chat': {
          if (!state.room || !state.player) {
            socket.close(1008, 'Must join a room before chatting')
            return
          }
          state.room.postChat(state.player, msg.text)
          const chatPacket = encodeServerMessage({
            type: 'chat',
            sender: state.player.name,
            text: msg.text,
          })
          broadcastRoom(state.room, chatPacket, { critical: false })
          return
        }

        default:
          return assertNever(msg)
      }
    }

    socket.on('message', async (rawBuffer: RawData, isBinary: boolean) => {
      if (!bucket.consume()) {
        socket.close(1008, 'Rate limit exceeded')
        return
      }

      if (isBinary) {
        try {
          const decodedInput = decodeInputBinary(rawDataToUint8(rawBuffer))
          await dispatchClientMessage(decodedInput)
        } catch {
          socket.close(1003, 'Invalid binary frame')
        }
        return
      }

      const rawText = rawDataToUint8(rawBuffer)
      const parsed = parseClientMessage(new TextDecoder().decode(rawText), config.maxPayloadBytes)
      if (!parsed.ok) {
        socket.close(parsed.code, parsed.reason)
        return
      }

      await dispatchClientMessage(parsed.data)
    })

    socket.on('close', () => {
      clearTimeout(joinTimer)
      if (state.room && state.player) {
        const room = state.room
        const name = state.player.name
        room.leave(state.id)
        state.room = null

        const rosterMsg = encodeServerMessage({
          type: 'roster',
          room: room.id,
          players: room.getRoster(),
        })
        broadcastRoom(room, rosterMsg, { critical: true })

        const sysMsg = encodeServerMessage({
          type: 'system',
          text: `${name} left the sector`,
        })
        broadcastRoom(room, sysMsg, { critical: false })
      }
    })
  })

  const heartbeatTimer = setInterval(() => {
    for (const socket of wss.clients) {
      const st = clientStates.get(socket)
      if (!st) continue
      st.missedPongs += 1
      if (st.missedPongs > 2) {
        socket.terminate()
        continue
      }
      socket.ping()
    }
  }, config.heartbeatIntervalMs)

  return {
    wss,
    close(): Promise<void> {
      clearInterval(heartbeatTimer)
      for (const client of wss.clients) {
        client.close(1001, 'Server shutting down')
      }
      return new Promise((resolve) => wss.close(() => resolve()))
    },
  }
}
