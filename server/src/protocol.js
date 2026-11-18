export const PROTOCOL_VERSION = 0

export const MSG_TYPES = Object.freeze({
  JOIN: 'join',
  CHAT: 'chat',
  ROSTER: 'roster',
  SYSTEM: 'system',
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

  if (parsed.v !== PROTOCOL_VERSION) {
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
    return { ok: true, value: { v: PROTOCOL_VERSION, type: MSG_TYPES.JOIN, room, name } }
  }

  if (parsed.type === MSG_TYPES.CHAT) {
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : ''
    if (!text || text.length > 240) {
      return { ok: false, code: 1008, reason: 'Chat text must be 1..240 chars' }
    }
    return { ok: true, value: { v: PROTOCOL_VERSION, type: MSG_TYPES.CHAT, text } }
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
