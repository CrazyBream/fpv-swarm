import crypto from 'node:crypto'
import { decodeInputBinary, encodeSnapshotBinary } from '@fpv-swarm/shared/codec/binary.js'
import { WebSocketServer } from 'ws'
import { MSG_TYPES, encodeServerMessage, validateClientMessage } from './protocol.js'

class TokenBucket {
  constructor(ratePerSec) {
    this.capacity = ratePerSec
    this.tokens = ratePerSec
    this.lastRefill = performance.now()
  }

  consume() {
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

export function attachWebSocketGateway(httpServer, roomManager, config) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/ws',
    maxPayload: config.maxPayloadBytes,
  })

  const boundRooms = new Set()

  function sendWithNetSim(state, payload, { critical = false, droppable = false } = {}) {
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

  function broadcastRoom(room, payloadStr, { critical = false } = {}) {
    for (const member of room.players.values()) {
      sendWithNetSim(member.state, payloadStr, { critical, droppable: false })
    }
  }

  function ensureRoomSnapshotHook(room) {
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

  wss.on('connection', (socket) => {
    const state = {
      id: crypto.randomUUID().slice(0, 8),
      socket,
      player: null,
      room: null,
      missedPongs: 0,
      delayMs: 0,
      jitterMs: 0,
      dropRate: 0,
      useBinary: true,
      bucket: new TokenBucket(config.rateLimitPerSec),
    }

    socket.on('error', (err) => {
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

    function processIncomingCommand(msg) {
      if (msg.type === MSG_TYPES.INPUT) {
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

      if (msg.type === MSG_TYPES.NETSIM) {
        state.delayMs = msg.delayMs
        state.jitterMs = msg.jitterMs
        state.dropRate = msg.dropRate
        state.useBinary = msg.useBinary
        return
      }

      if (msg.type === MSG_TYPES.PING_RTT) {
        const pongStr = encodeServerMessage(MSG_TYPES.PONG_RTT, {
          clientSentAt: msg.clientSentAt,
        })
        sendWithNetSim(state, pongStr, { critical: false, droppable: false })
        return
      }

      if (msg.type === MSG_TYPES.CHAT) {
        if (!state.room || !state.player) {
          socket.close(1008, 'Must join a room before chatting')
          return
        }
        state.room.postChat(state.player, msg.text)
        const chatPacket = encodeServerMessage(MSG_TYPES.CHAT, {
          sender: state.player.name,
          text: msg.text,
        })
        broadcastRoom(state.room, chatPacket, { critical: false })
      }
    }

    socket.on('message', async (rawBuffer, isBinary) => {
      if (!state.bucket.consume()) {
        socket.close(1008, 'Rate limit exceeded')
        return
      }

      if (isBinary) {
        try {
          const decodedInput = decodeInputBinary(rawBuffer)
          processIncomingCommand(decodedInput)
        } catch {
          socket.close(1003, 'Invalid binary frame')
        }
        return
      }

      const validation = validateClientMessage(rawBuffer.toString('utf8'), config.maxPayloadBytes)
      if (!validation.ok) {
        socket.close(validation.code, validation.reason)
        return
      }

      const msg = validation.value

      if (msg.type === MSG_TYPES.JOIN) {
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
          const player = { id: state.id, numericId, name: msg.name, socket, state }
          room.join(player)
          state.player = player
          state.room = room

          socket.send(
            encodeServerMessage(MSG_TYPES.WELCOME, {
              playerId: numericId,
              seed: room.match.seed,
              room: room.id,
            }),
          )

          const rosterMsg = encodeServerMessage(MSG_TYPES.ROSTER, {
            room: room.id,
            players: room.getRoster(),
          })
          broadcastRoom(room, rosterMsg, { critical: true })

          const sysMsg = encodeServerMessage(MSG_TYPES.SYSTEM, {
            text: `${player.name} [#${numericId}] joined ${room.name}`,
          })
          broadcastRoom(room, sysMsg, { critical: false })
        } catch (err) {
          socket.close(1008, err.message)
        }
        return
      }

      processIncomingCommand(msg)
    })

    socket.on('close', () => {
      clearTimeout(joinTimer)
      if (state.room && state.player) {
        const room = state.room
        const name = state.player.name
        room.leave(state.id)
        state.room = null

        const rosterMsg = encodeServerMessage(MSG_TYPES.ROSTER, {
          room: room.id,
          players: room.getRoster(),
        })
        broadcastRoom(room, rosterMsg, { critical: true })

        const sysMsg = encodeServerMessage(MSG_TYPES.SYSTEM, {
          text: `${name} left the sector`,
        })
        broadcastRoom(room, sysMsg, { critical: false })
      }
    })
  })

  const heartbeatTimer = setInterval(() => {
    for (const socket of wss.clients) {
      socket.missedPongs = (socket.missedPongs ?? 0) + 1
      if (socket.missedPongs > 2) {
        socket.terminate()
        continue
      }
      socket.ping()
    }
  }, config.heartbeatIntervalMs)

  return {
    wss,
    close() {
      clearInterval(heartbeatTimer)
      for (const client of wss.clients) {
        client.close(1001, 'Server shutting down')
      }
      return new Promise((resolve) => wss.close(resolve))
    },
  }
}
