export const PROTOCOL_VERSION = 0

export const MSG_TYPES = Object.freeze({
  JOIN: 'join',
  WELCOME: 'welcome',
  CHAT: 'chat',
  ROSTER: 'roster',
  SYSTEM: 'system',
  INPUT: 'input',
  SNAPSHOT: 'snapshot',
  NETSIM: 'netsim',
  PING_RTT: 'ping_rtt',
  PONG_RTT: 'pong_rtt',
  ERROR: 'error',
})

export function validateClientMessage(rawString, maxBytes = 2048) {
  if (typeof rawString !== 'string') {
    return { ok: false, code: 1003, reason: 'Payload must be UTF-8 text' }
  }
  if (Buffer.byteLength(rawString, 'utf8') > maxBytes) {
    return { ok: false, code: 1009, reason: 'Payload exceeds maxPayload limit' }
  }

  let parsed
  try {
    parsed = JSON.parse(rawString)
  } catch {
    return { ok: false, code: 1007, reason: 'Malformed JSON' }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, code: 1007, reason: 'Message root must be an object' }
  }

  if (parsed.v !== 0 && parsed.v !== 1) {
    return { ok: false, code: 1002, reason: `Unsupported protocol version: ${parsed.v}` }
  }

  if (parsed.type === MSG_TYPES.JOIN) {
    const room = typeof parsed.room === 'string' ? parsed.room.trim() : ''
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
    if (!room || room.length > 32 || !/^[a-zA-Z0-9_-]+$/.test(room)) {
      return { ok: false, code: 1008, reason: 'Invalid room id' }
    }
    if (!name || name.length > 18) {
      return { ok: false, code: 1008, reason: 'Invalid callsign length' }
    }
    return { ok: true, value: { v: 0, type: MSG_TYPES.JOIN, room, name } }
  }

  if (parsed.type === MSG_TYPES.CHAT) {
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : ''
    if (!text || text.length > 240) {
      return { ok: false, code: 1008, reason: 'Chat text must be 1..240 chars' }
    }
    return { ok: true, value: { v: 0, type: MSG_TYPES.CHAT, text } }
  }

  if (parsed.type === MSG_TYPES.INPUT) {
    const seq = Number(parsed.seq)
    const thrust = Number(parsed.thrust ?? 0)
    const turn = Number(parsed.turn ?? 0)
    if (!Number.isInteger(seq) || seq < 0 || Math.abs(thrust) > 1 || Math.abs(turn) > 1) {
      return { ok: false, code: 1008, reason: 'Invalid input command values' }
    }
    return {
      ok: true,
      value: {
        v: 1,
        type: MSG_TYPES.INPUT,
        seq,
        tick: Number(parsed.tick ?? 0),
        thrust,
        turn,
        fire: Boolean(parsed.fire),
      },
    }
  }

  if (parsed.type === MSG_TYPES.NETSIM) {
    return {
      ok: true,
      value: {
        v: 0,
        type: MSG_TYPES.NETSIM,
        delayMs: Math.max(0, Math.min(400, Number(parsed.delayMs) || 0)),
        jitterMs: Math.max(0, Math.min(150, Number(parsed.jitterMs) || 0)),
        dropRate: Math.max(0, Math.min(0.5, Number(parsed.dropRate) || 0)),
        useBinary: Boolean(parsed.useBinary),
      },
    }
  }

  if (parsed.type === MSG_TYPES.PING_RTT) {
    return {
      ok: true,
      value: { v: 0, type: MSG_TYPES.PING_RTT, clientSentAt: Number(parsed.clientSentAt) || 0 },
    }
  }

  return { ok: false, code: 1008, reason: `Unknown message type: ${String(parsed.type)}` }
}

export function encodeServerMessage(type, payload) {
  return JSON.stringify({
    v: PROTOCOL_VERSION,
    type,
    t: Date.now(),
    ...payload,
  })
}
