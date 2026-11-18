import crypto from 'node:crypto'
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

  function sendSafe(socket, payloadStr, { critical = false } = {}) {
    if (socket.readyState !== 1) return
    if (socket.bufferedAmount > config.slowClientThresholdBytes) {
      if (!critical) {
        return
      }
      socket.close(1008, 'Slow client buffer overflow')
      return
    }
    socket.send(payloadStr)
  }

  function broadcastRoom(room, payloadStr, { critical = false } = {}) {
    for (const member of room.players.values()) {
      sendSafe(member.socket, payloadStr, { critical })
    }
  }

  wss.on('connection', (socket) => {
    const state = {
      id: crypto.randomUUID().slice(0, 8),
      player: null,
      room: null,
      missedPongs: 0,
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

    socket.on('message', async (rawBuffer, isBinary) => {
      if (isBinary) {
        socket.close(1003, 'Binary frames not supported in v0')
        return
      }

      if (!state.bucket.consume()) {
        socket.close(1008, 'Rate limit exceeded')
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

          const player = { id: state.id, name: msg.name, socket }
          room.join(player)
          state.player = player
          state.room = room

          const rosterMsg = encodeServerMessage(MSG_TYPES.ROSTER, {
            room: room.id,
            players: room.getRoster(),
          })
          broadcastRoom(room, rosterMsg, { critical: true })

          const sysMsg = encodeServerMessage(MSG_TYPES.SYSTEM, {
            text: `${player.name} joined ${room.name}`,
          })
          broadcastRoom(room, sysMsg, { critical: false })
        } catch (err) {
          socket.close(1008, err.message)
        }
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
