/*
 * FPV SWARM BINARY PROTOCOL v1 SPECIFICATION (Little-Endian everywhere)
 *
 * 1. CLIENT INPUT FRAME (14 bytes fixed):
 *    Byte 0      : Uint8   wireType (1 = INPUT)
 *    Byte 1      : Uint8   version  (1)
 *    Bytes 2..5  : Uint32  seq
 *    Bytes 6..9  : Uint32  tick
 *    Byte 10     : Int8    thrust   (-1, 0, +1)
 *    Byte 11     : Int8    turn     (-1, 0, +1)
 *    Byte 12     : Uint8   fire     (0 or 1)
 *    Byte 13     : Uint8   reserved (0)
 *
 * 2. SERVER SNAPSHOT FRAME (16-byte header + 24 bytes * entityCount):
 *    Byte 0      : Uint8   wireType (2 = SNAPSHOT)
 *    Byte 1      : Uint8   version  (1)
 *    Bytes 2..5  : Uint32  tick
 *    Bytes 6..9  : Uint32  lastProcessedSeq
 *    Bytes 10..13: Uint32  serverTimeMs
 *    Bytes 14..15: Uint16  entityCount
 */

import {
  ENTITY_KIND,
  type EntityKindCode,
  type InputMessage,
  PROTOCOL_VERSION,
  type Snapshot,
  type SnapshotEntity,
  type TurnAxis,
  WIRE_TYPE,
  asEntityId,
  asSeq,
  asTick,
  assertNever,
} from '../protocol.ts'

export interface Codec<T> {
  encode(msg: T): ArrayBuffer
  decode(buf: ArrayBuffer | Uint8Array): T
}

const ANGLE_SCALE = 1000
const TWO_PI = Math.PI * 2

export function quantizeAngle(rad: number): number {
  let norm = ((rad % TWO_PI) + TWO_PI) % TWO_PI
  if (norm > Math.PI) norm -= TWO_PI
  return Math.max(-32767, Math.min(32767, Math.round(norm * ANGLE_SCALE)))
}

export function dequantizeAngle(qInt16: number): number {
  return qInt16 / ANGLE_SCALE
}

function clampTurnAxis(val: number): TurnAxis {
  if (val <= -1) return -1
  if (val >= 1) return 1
  return 0
}

function kindToCode(entity: SnapshotEntity): EntityKindCode {
  switch (entity.kind) {
    case 'ship':
      return ENTITY_KIND.SHIP
    case 'bullet':
      return ENTITY_KIND.BULLET
    case 'asteroid':
      return ENTITY_KIND.ASTEROID
    case 'pickup':
      return ENTITY_KIND.PICKUP
    default: {
      return assertNever(entity)
    }
  }
}

function codeToKind(code: number): SnapshotEntity['kind'] {
  switch (code) {
    case ENTITY_KIND.SHIP:
      return 'ship'
    case ENTITY_KIND.BULLET:
      return 'bullet'
    case ENTITY_KIND.ASTEROID:
      return 'asteroid'
    case ENTITY_KIND.PICKUP:
      return 'pickup'
    default:
      throw new RangeError(`Unknown entity kind code: ${code}`)
  }
}

function toArrayBuffer(bufferOrUint8: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (bufferOrUint8 instanceof ArrayBuffer) {
    return bufferOrUint8
  }
  const copy = new Uint8Array(bufferOrUint8.byteLength)
  copy.set(bufferOrUint8)
  return copy.buffer
}

export function encodeInputBinary(input: {
  readonly seq: number
  readonly tick?: number
  readonly thrust: number
  readonly turn: number
  readonly fire: boolean
}): ArrayBuffer {
  const buf = new ArrayBuffer(14)
  const view = new DataView(buf)
  view.setUint8(0, WIRE_TYPE.INPUT)
  view.setUint8(1, PROTOCOL_VERSION)
  view.setUint32(2, input.seq >>> 0, true)
  view.setUint32(6, (input.tick ?? 0) >>> 0, true)
  view.setInt8(10, clampTurnAxis(Math.round(input.thrust)))
  view.setInt8(11, clampTurnAxis(Math.round(input.turn)))
  view.setUint8(12, input.fire ? 1 : 0)
  view.setUint8(13, 0)
  return buf
}

export function decodeInputBinary(bufferOrUint8: ArrayBuffer | Uint8Array): InputMessage {
  const ab = toArrayBuffer(bufferOrUint8)
  if (ab.byteLength < 14) {
    throw new RangeError('Input binary frame too short')
  }
  const view = new DataView(ab)
  const wireType = view.getUint8(0)
  const version = view.getUint8(1)
  if (wireType !== WIRE_TYPE.INPUT || version !== PROTOCOL_VERSION) {
    throw new Error('Invalid input frame header or version')
  }
  const rawThrust = view.getInt8(10)
  const rawTurn = view.getInt8(11)
  if (Math.abs(rawThrust) > 1 || Math.abs(rawTurn) > 1) {
    throw new RangeError('Input axis out of range [-1..1]')
  }
  return {
    type: 'input',
    v: version,
    seq: view.getUint32(2, true),
    tick: view.getUint32(6, true),
    thrust: clampTurnAxis(rawThrust),
    turn: clampTurnAxis(rawTurn),
    fire: view.getUint8(12) === 1,
  }
}

export function encodeSnapshotBinary(snapshot: Snapshot): ArrayBuffer {
  const entities = snapshot.entities
  const count = entities.length
  const buf = new ArrayBuffer(16 + count * 24)
  const view = new DataView(buf)

  view.setUint8(0, WIRE_TYPE.SNAPSHOT)
  view.setUint8(1, PROTOCOL_VERSION)
  view.setUint32(2, snapshot.tick >>> 0, true)
  view.setUint32(6, snapshot.lastProcessedSeq >>> 0, true)
  view.setUint32(10, snapshot.serverTimeMs >>> 0, true)
  view.setUint16(14, count, true)

  for (let i = 0; i < count; i += 1) {
    const e = entities[i]
    if (!e) continue
    const base = 16 + i * 24
    view.setUint16(base, e.id & 0xffff, true)
    view.setUint8(base + 2, kindToCode(e))
    view.setUint8(base + 3, Math.max(0, Math.min(255, Math.round(e.hp))))
    view.setFloat32(base + 4, e.x, true)
    view.setFloat32(base + 8, e.y, true)
    view.setFloat32(base + 12, e.vx, true)
    view.setFloat32(base + 16, e.vy, true)
    view.setInt16(base + 20, quantizeAngle(e.angle), true)
    view.setUint16(base + 22, e.ownerId & 0xffff, true)
  }

  return buf
}

export function decodeSnapshotBinary(bufferOrUint8: ArrayBuffer | Uint8Array): Snapshot {
  const ab = toArrayBuffer(bufferOrUint8)
  if (ab.byteLength < 16) {
    throw new RangeError('Snapshot binary frame too short')
  }
  const view = new DataView(ab)
  const wireType = view.getUint8(0)
  const version = view.getUint8(1)
  if (wireType !== WIRE_TYPE.SNAPSHOT || version !== PROTOCOL_VERSION) {
    throw new Error('Invalid snapshot frame header or version')
  }

  const tick = asTick(view.getUint32(2, true))
  const lastProcessedSeq = asSeq(view.getUint32(6, true))
  const serverTimeMs = view.getUint32(10, true)
  const count = view.getUint16(14, true)

  if (16 + count * 24 > ab.byteLength) {
    throw new RangeError('Snapshot entity count exceeds buffer byteLength')
  }

  const entities: SnapshotEntity[] = []
  for (let i = 0; i < count; i += 1) {
    const base = 16 + i * 24
    const kind = codeToKind(view.getUint8(base + 2))
    entities.push({
      kind,
      id: asEntityId(view.getUint16(base, true)),
      hp: view.getUint8(base + 3),
      x: view.getFloat32(base + 4, true),
      y: view.getFloat32(base + 8, true),
      vx: view.getFloat32(base + 12, true),
      vy: view.getFloat32(base + 16, true),
      angle: dequantizeAngle(view.getInt16(base + 20, true)),
      ownerId: asEntityId(view.getUint16(base + 22, true)),
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

export const binarySnapshotCodec: Codec<Snapshot> = {
  encode: encodeSnapshotBinary,
  decode: decodeSnapshotBinary,
}

export const jsonSnapshotCodec: Codec<Snapshot> = {
  encode(msg: Snapshot): ArrayBuffer {
    const bytes = new TextEncoder().encode(JSON.stringify(msg))
    return toArrayBuffer(bytes)
  },
  decode(buf: ArrayBuffer | Uint8Array): Snapshot {
    const str = new TextDecoder().decode(buf)
    const raw = JSON.parse(str) as Snapshot
    return raw
  },
}

export function benchmarkCodecs(playerCount = 4) {
  const sampleSnapshot: Snapshot = {
    type: 'snapshot',
    v: PROTOCOL_VERSION,
    tick: asTick(1420),
    lastProcessedSeq: asSeq(850),
    serverTimeMs: 12345678,
    entities: Array.from({ length: playerCount }, (_, idx) => ({
      kind: 'ship',
      id: asEntityId(idx + 1),
      hp: 100,
      x: 240.5 + idx * 112.25,
      y: 310.75 + idx * 45.5,
      vx: 185.4,
      vy: -92.1,
      angle: 1.124,
      ownerId: asEntityId(idx + 1),
    })),
  }

  const jsonStart = performance.now()
  let jsonBytes = 0
  for (let i = 0; i < 1000; i += 1) {
    const encoded = jsonSnapshotCodec.encode(sampleSnapshot)
    jsonBytes = encoded.byteLength
    jsonSnapshotCodec.decode(encoded)
  }
  const jsonUs = ((performance.now() - jsonStart) * 1000) / 1000

  const binStart = performance.now()
  let binBytes = 0
  for (let i = 0; i < 1000; i += 1) {
    const buf = binarySnapshotCodec.encode(sampleSnapshot)
    binBytes = buf.byteLength
    binarySnapshotCodec.decode(buf)
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
