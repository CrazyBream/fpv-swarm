import assert from 'node:assert/strict'
import test from 'node:test'
import {
  decodeInputBinary,
  decodeSnapshotBinary,
  encodeInputBinary,
  encodeSnapshotBinary,
} from '@fpv-swarm/shared/codec/binary.ts'
import {
  type Snapshot,
  asEntityId,
  asSeq,
  asTick,
  parseClientMessage,
} from '@fpv-swarm/shared/protocol.ts'
import { integrateStep } from '@fpv-swarm/shared/sim/kinematics.ts'
import { hashShipState, mulberry32 } from '@fpv-swarm/shared/sim/prng.ts'

test('shared simulation is 100% deterministic over 1,000 steps', () => {
  function runSimulation(seed: number): string {
    const rng = mulberry32(seed)
    const state = { x: 400, y: 300, vx: 0, vy: 0, angle: 0 }
    for (let i = 0; i < 1000; i += 1) {
      const cmd = {
        thrust: rng() > 0.3 ? 1 : 0,
        turn: rng() > 0.5 ? 1 : -1,
      }
      integrateStep(state, cmd, 1 / 60)
    }
    return hashShipState(state)
  }

  const hashA = runSimulation(42)
  const hashB = runSimulation(42)
  assert.equal(hashA, hashB)
})

test('DataView binary codec round-trips input and snapshot within quantization tolerance', () => {
  const inputOrig = { seq: 104, tick: 312, thrust: 1, turn: -1, fire: true }
  const inputBin = encodeInputBinary(inputOrig)
  assert.equal(inputBin.byteLength, 14)
  const inputDecoded = decodeInputBinary(inputBin)
  assert.equal(inputDecoded.seq, inputOrig.seq)
  assert.equal(inputDecoded.thrust, inputOrig.thrust)
  assert.equal(inputDecoded.turn, inputOrig.turn)
  assert.equal(inputDecoded.fire, inputOrig.fire)

  const snapOrig: Snapshot = {
    type: 'snapshot',
    v: 1,
    tick: asTick(500),
    lastProcessedSeq: asSeq(104),
    serverTimeMs: 987654,
    entities: [
      {
        kind: 'ship',
        id: asEntityId(1),
        hp: 85,
        x: 512.25,
        y: 280.5,
        vx: 120.5,
        vy: -44.25,
        angle: 1.234,
        ownerId: asEntityId(1),
      },
    ],
  }
  const snapBin = encodeSnapshotBinary(snapOrig)
  assert.equal(snapBin.byteLength, 40)
  const snapDecoded = decodeSnapshotBinary(snapBin)
  assert.equal(snapDecoded.tick, 500)
  assert.equal(snapDecoded.lastProcessedSeq, 104)
  const firstEntity = snapDecoded.entities[0]
  assert.ok(firstEntity)
  assert.ok(Math.abs(firstEntity.x - 512.25) < 0.001)
  assert.ok(Math.abs(firstEntity.angle - 1.234) < 0.002)
})

test('Zod parseClientMessage accepts valid discriminated union variants and rejects invalid ones', () => {
  const joinRes = parseClientMessage(
    JSON.stringify({ v: 0, type: 'join', room: 'sector-alpha', name: 'GENIY' }),
  )
  assert.equal(joinRes.ok, true)

  const badTurn = parseClientMessage(
    JSON.stringify({ v: 1, type: 'input', seq: 1, tick: 1, thrust: 0, turn: 999, fire: false }),
  )
  assert.equal(badTurn.ok, false)

  const oversize = parseClientMessage('x'.repeat(3000), 1024)
  assert.equal(oversize.ok, false)
  if (!oversize.ok) {
    assert.equal(oversize.code, 1009)
  }
})
