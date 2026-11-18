/*
 * FPV SWARM BINARY PROTOCOL v1 SPECIFICATION (Little-Endian everywhere)
 *
 * 1. CLIENT INPUT FRAME (14 bytes fixed):
 *    Byte 0      : Uint8   wireType (1 = INPUT)
 *    Byte 1      : Uint8   version  (1)
 *    Bytes 2..5  : Uint32  seq      (input sequence number)
 *    Bytes 6..9  : Uint32  tick     (client tick estimate)
 *    Byte 10     : Int8    thrust   (-1, 0, +1)
 *    Byte 11     : Int8    turn     (-1, 0, +1)
 *    Byte 12     : Uint8   fire     (0 or 1)
 *    Byte 13     : Uint8   reserved (0)
 *
 * 2. SERVER SNAPSHOT FRAME (16-byte header + 24 bytes * entityCount):
 *    Byte 0      : Uint8   wireType (2 = SNAPSHOT)
 *    Byte 1      : Uint8   version  (1)
 *    Bytes 2..5  : Uint32  tick     (authoritative server tick)
 *    Bytes 6..9  : Uint32  lastProcessedSeq (ack for recipient client)
 *    Bytes 10..13: Uint32  serverTimeMs (lower 32 bits of timestamp)
 *    Bytes 14..15: Uint16  entityCount
 *    Per Entity (24 bytes):
 *      +0..1  : Uint16  id
 *      +2     : Uint8   kind (1=ship, 2=bullet, 3=asteroid, 4=pickup)
 *      +3     : Uint8   hp
 *      +4..7  : Float32 x
 *      +8..11 : Float32 y
 *      +12..15: Float32 vx
 *      +16..19: Float32 vy
 *      +20..21: Int16   angleQuantized (radians * 1000)
 *      +22..23: Uint16  ownerOrFlags
 */

import { ENTITY_KIND, PROTOCOL_VERSION, WIRE_TYPE } from '../protocol/messages.js'

const ANGLE_SCALE = 1000
const TWO_PI = Math.PI * 2

export function quantizeAngle(rad) {
  let norm = ((rad % TWO_PI) + TWO_PI) % TWO_PI
  if (norm > Math.PI) norm -= TWO_PI
  return Math.max(-32767, Math.min(32767, Math.round(norm * ANGLE_SCALE)))
}

export function dequantizeAngle(qInt16) {
  return qInt16 / ANGLE_SCALE
}

export function encodeInputBinary(input) {
  const buf = new ArrayBuffer(14)
  const view = new DataView(buf)
  view.setUint8(0, WIRE_TYPE.INPUT)
  view.setUint8(1, PROTOCOL_VERSION)
  view.setUint32(2, input.seq >>> 0, true)
  view.setUint32(6, (input.tick ?? 0) >>> 0, true)
  view.setInt8(10, Math.max(-1, Math.min(1, Math.round(input.thrust || 0))))
  view.setInt8(11, Math.max(-1, Math.min(1, Math.round(input.turn || 0))))
  view.setUint8(12, input.fire ? 1 : 0)
  view.setUint8(13, 0)
  return buf
}

export function decodeInputBinary(bufferOrUint8) {
  const ab =
    bufferOrUint8 instanceof ArrayBuffer
      ? bufferOrUint8
      : bufferOrUint8.buffer.slice(
          bufferOrUint8.byteOffset,
          bufferOrUint8.byteOffset + bufferOrUint8.byteLength,
        )
  if (ab.byteLength < 14) {
    throw new Error('Input binary frame too short')
  }
  const view = new DataView(ab)
  const wireType = view.getUint8(0)
  const version = view.getUint8(1)
  if (wireType !== WIRE_TYPE.INPUT || version !== PROTOCOL_VERSION) {
    throw new Error('Invalid input frame header')
  }
  return {
    type: 'input',
    v: version,
    seq: view.getUint32(2, true),
    tick: view.getUint32(6, true),
    thrust: view.getInt8(10),
    turn: view.getInt8(11),
    fire: view.getUint8(12) === 1,
  }
}

export function encodeSnapshotBinary(snapshot) {
  const entities = snapshot.entities || []
  const count = entities.length
  const buf = new ArrayBuffer(16 + count * 24)
  const view = new DataView(buf)

  view.setUint8(0, WIRE_TYPE.SNAPSHOT)
  view.setUint8(1, PROTOCOL_VERSION)
  view.setUint32(2, snapshot.tick >>> 0, true)
  view.setUint32(6, (snapshot.lastProcessedSeq ?? 0) >>> 0, true)
  view.setUint32(10, (snapshot.serverTimeMs ?? 0) >>> 0, true)
  view.setUint16(14, count, true)

  for (let i = 0; i < count; i += 1) {
    const e = entities[i]
    const base = 16 + i * 24
    view.setUint16(base, e.id & 0xffff, true)
    view.setUint8(base + 2, e.kind || ENTITY_KIND.SHIP)
    view.setUint8(base + 3, Math.max(0, Math.min(255, Math.round(e.hp ?? 100))))
    view.setFloat32(base + 4, e.x, true)
    view.setFloat32(base + 8, e.y, true)
    view.setFloat32(base + 12, e.vx ?? 0, true)
    view.setFloat32(base + 16, e.vy ?? 0, true)
    view.setInt16(base + 20, quantizeAngle(e.angle ?? 0), true)
    view.setUint16(base + 22, (e.ownerId ?? 0) & 0xffff, true)
  }

  return buf
}

export function decodeSnapshotBinary(bufferOrUint8) {
  const ab =
    bufferOrUint8 instanceof ArrayBuffer
      ? bufferOrUint8
      : bufferOrUint8.buffer.slice(
          bufferOrUint8.byteOffset,
          bufferOrUint8.byteOffset + bufferOrUint8.byteLength,
        )
  if (ab.byteLength < 16) {
    throw new Error('Snapshot binary frame too short')
  }
  const view = new DataView(ab)
  const wireType = view.getUint8(0)
  const version = view.getUint8(1)
  if (wireType !== WIRE_TYPE.SNAPSHOT || version !== PROTOCOL_VERSION) {
    throw new Error('Invalid snapshot frame header')
  }

  const tick = view.getUint32(2, true)
  const lastProcessedSeq = view.getUint32(6, true)
  const serverTimeMs = view.getUint32(10, true)
  const count = view.getUint16(14, true)

  const entities = []
  for (let i = 0; i < count; i += 1) {
    const base = 16 + i * 24
    if (base + 24 > ab.byteLength) break
    entities.push({
      id: view.getUint16(base, true),
      kind: view.getUint8(base + 2),
      hp: view.getUint8(base + 3),
      x: view.getFloat32(base + 4, true),
      y: view.getFloat32(base + 8, true),
      vx: view.getFloat32(base + 12, true),
      vy: view.getFloat32(base + 16, true),
      angle: dequantizeAngle(view.getInt16(base + 20, true)),
      ownerId: view.getUint16(base + 22, true),
    })
  }

  return {
    type: 'snapshot',
    v: version,
    tick,
    lastProcessedSeq,
    serverTimeMs,
    entities,
  }
}

export function benchmarkCodecs(playerCount = 4) {
  const sampleSnapshot = {
    type: 'snapshot',
    v: PROTOCOL_VERSION,
    tick: 1420,
    lastProcessedSeq: 850,
    serverTimeMs: 12345678,
    entities: Array.from({ length: playerCount }, (_, idx) => ({
      id: idx + 1,
      kind: ENTITY_KIND.SHIP,
      hp: 100,
      x: 240.5 + idx * 112.25,
      y: 310.75 + idx * 45.5,
      vx: 185.4,
      vy: -92.1,
      angle: 1.124,
      ownerId: idx + 1,
    })),
  }

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  const jsonStart = performance.now()
  let jsonBytes = 0
  for (let i = 0; i < 1000; i += 1) {
    const encoded = encoder.encode(JSON.stringify(sampleSnapshot))
    jsonBytes = encoded.byteLength
    JSON.parse(decoder.decode(encoded))
  }
  const jsonUs = ((performance.now() - jsonStart) * 1000) / 1000

  const binStart = performance.now()
  let binBytes = 0
  for (let i = 0; i < 1000; i += 1) {
    const buf = encodeSnapshotBinary(sampleSnapshot)
    binBytes = buf.byteLength
    decodeSnapshotBinary(buf)
  }
  const binUs = ((performance.now() - binStart) * 1000) / 1000

  return {
    json: {
      bytesPerSnapshot: jsonBytes,
      downKbps: Number(((jsonBytes * 30) / 1024).toFixed(2)),
      upKbps: Number(((72 * 60) / 1024).toFixed(2)),
      encodeDecodeUs: Number(jsonUs.toFixed(2)),
    },
    binary: {
      bytesPerSnapshot: binBytes,
      downKbps: Number(((binBytes * 30) / 1024).toFixed(2)),
      upKbps: Number(((14 * 60) / 1024).toFixed(2)),
      encodeDecodeUs: Number(binUs.toFixed(2)),
    },
  }
}
