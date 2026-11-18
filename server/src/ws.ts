// noinspection SpellCheckingInspection
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
import { logger } from './logger.ts'
import { wsBytesTotal, wsMessagesTotal, wsRejectedTotal } from './metrics.ts'
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

function getClientIp(req: http.IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() || 'unknown'
  }
  return req.socket.remoteAddress ?? 'unknown'
}

export function isOriginAllowed(
  originHeader: string | undefined,
  reqHost: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (!originHeader) {
    return true
  }
  const normalized = originHeader.trim().replace(/\/$/, '')
  if (allowedOrigins.includes('*') || allowedOrigins.includes(normalized)) {
    return true
  }
  if (reqHost) {
    if (normalized === `https://${reqHost}` || normalized === `http://${reqHost}`) {
      return true
    }
  }
  return false
}

export function attachWebSocketGateway(
  httpServer: http.Server,
  roomManager: RoomManager,
  config: ServerConfig,
) {
  const connectionsByIp = new Map<string, number>()

  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: config.maxPayloadBytes,
    verifyClient: (info, done) => {
      const origin = info.origin || info.req.headers.origin
      if (!isOriginAllowed(origin, info.req.headers.host, config.allowedOrigins)) {
        wsRejectedTotal.inc({ reason: 'origin' })
        logger.warn({ event: 'ws.rejected', reason: 'origin', origin }, 'Rejected foreign origin')
        done(false, 403, 'Forbidden Origin')
        return
      }

      const ip = getClientIp(info.req)
      const currentCount = connectionsByIp.get(ip) ?? 0
      if (currentCount >= config.maxConnectionsPerIp) {
        wsRejectedTotal.inc({ reason: 'ip_cap' })
        logger.warn({ event: 'ws.rejected', reason: 'ip_cap', ip }, 'Per-IP connection cap reached')
        done(false, 429, 'Too Many Connections From IP')
        return
      }

      done(true)
    },
  })

  const boundRooms = new Set<string>()
  const clientStates = new WeakMap<WebSocket, SocketClientState>()

  function recordOutgoing(payload: string | Buffer): void {
    wsMessagesTotal.inc({ direction: 'out' })
    wsBytesTotal.inc(
      { direction: 'out' },
      typeof payload === 'string' ? Buffer.byteLength(payload, 'utf8') : payload.byteLength,
    )
  }

  function sendWithNetSim(
    state: SocketClientState,
    payload: string | Buffer,
    { critical = false, droppable = false } = {},
  ): void {
    const { socket } = state
    if (socket.readyState !== 1) return

    if (socket.bufferedAmount > config.slowClientThresholdBytes) {
      if (!critical) return
      wsRejectedTotal.inc({ reason: 'slow_client' })
      logger.warn(
        { event: 'ws.rejected', reason: 'slow_client', playerId: state.id, roomId: state.room?.id },
        'Slow client buffer overflow',
      )
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
      recordOutgoing(payload)
      socket.send(payload)
    } else {
      setTimeout(() => {
        if (socket.readyState === 1) {
          recordOutgoing(payload)
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

  wss.on('connection', (socket: WebSocket, req: http.IncomingMessage) => {
    const ip = getClientIp(req)
    connectionsByIp.set(ip, (connectionsByIp.get(ip) ?? 0) + 1)

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
      logger.warn(
        { event: 'ws.error', playerId: state.id, roomId: state.room?.id, err: err.message },
        'WebSocket error',
      )
    })

    socket.on('pong', () => {
      state.missedPongs = 0
    })

    const joinTimer = setTimeout(() => {
      if (!state.room) {
        wsRejectedTotal.inc({ reason: 'join_timeout' })
        logger.warn(
          { event: 'ws.rejected', reason: 'join_timeout', playerId: state.id },
          'Join timeout',
        )
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
              logger.info({ event: 'room.created', roomId: room.id }, 'Room created')
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

            logger.info(
              { event: 'player.joined', roomId: room.id, playerId: state.id, numericId },
              'Player joined room',
            )

            const welcomePayload = encodeServerMessage({
              type: 'welcome',
              playerId: numericId,
              seed: room.match.seed,
              room: room.id,
            })
            recordOutgoing(welcomePayload)
            socket.send(welcomePayload)

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
            wsRejectedTotal.inc({ reason: 'join_error' })
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
            wsRejectedTotal.inc({ reason: 'not_joined' })
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
      const bytes = rawDataToUint8(rawBuffer)
      wsMessagesTotal.inc({ direction: 'in' })
      wsBytesTotal.inc({ direction: 'in' }, bytes.byteLength)

      if (!bucket.consume()) {
        wsRejectedTotal.inc({ reason: 'rate_limit' })
        logger.warn(
          {
            event: 'ws.rejected',
            reason: 'rate_limit',
            playerId: state.id,
            roomId: state.room?.id,
          },
          'Rate limit exceeded',
        )
        socket.close(1008, 'Rate limit exceeded')
        return
      }

      if (isBinary) {
        try {
          const decodedInput = decodeInputBinary(bytes)
          await dispatchClientMessage(decodedInput)
        } catch {
          wsRejectedTotal.inc({ reason: 'invalid_binary' })
          logger.warn(
            {
              event: 'ws.rejected',
              reason: 'invalid_binary',
              playerId: state.id,
              roomId: state.room?.id,
            },
            'Invalid binary frame',
          )
          socket.close(1003, 'Invalid binary frame')
        }
        return
      }

      const parsed = parseClientMessage(new TextDecoder().decode(bytes), config.maxPayloadBytes)
      if (!parsed.ok) {
        wsRejectedTotal.inc({ reason: 'invalid_json' })
        logger.warn(
          {
            event: 'ws.rejected',
            reason: 'invalid_json',
            playerId: state.id,
            roomId: state.room?.id,
            detail: parsed.reason,
          },
          'Invalid JSON frame',
        )
        socket.close(parsed.code, parsed.reason)
        return
      }

      await dispatchClientMessage(parsed.data)
    })

    socket.on('close', () => {
      clearTimeout(joinTimer)
      const prev = connectionsByIp.get(ip) ?? 1
      if (prev <= 1) {
        connectionsByIp.delete(ip)
      } else {
        connectionsByIp.set(ip, prev - 1)
      }

      if (state.room && state.player) {
        const room = state.room
        const name = state.player.name
        room.leave(state.id)
        state.room = null

        logger.info(
          { event: 'player.left', roomId: room.id, playerId: state.id },
          'Player left room',
        )

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
        wsRejectedTotal.inc({ reason: 'heartbeat_timeout' })
        socket.terminate()
        continue
      }
      socket.ping()
    }
  }, config.heartbeatIntervalMs)

  return {
    wss,
    async close(reason = 'Server shutting down for maintenance'): Promise<void> {
      clearInterval(heartbeatTimer)
      const shutdownFrame = encodeServerMessage({ type: 'shutdown', reason })
      for (const client of wss.clients) {
        if (client.readyState === 1) {
          try {
            client.send(shutdownFrame)
          } catch {}
          client.close(1001, reason)
        }
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()))
    },
  }
}
