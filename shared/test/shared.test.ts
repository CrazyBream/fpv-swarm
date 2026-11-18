import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
    benchmarkCodecs,
    binarySnapshotCodec,
    decodeInputBinary,
    decodeSnapshotBinary,
    dequantizeAngle,
    encodeInputBinary,
    encodeSnapshotBinary,
    jsonSnapshotCodec,
    quantizeAngle,
} from '../src/codec/binary.ts'
import {
    asEntityId,
    asSeq,
    assertNever,
    asTick,
    ENTITY_KIND,
    encodeServerMessage,
    parseClientMessage,
    type Snapshot,
    WIRE_TYPE,
} from '../src/protocol.ts'
import { clampAxisWrap, integrateStep, SHARED_DRONE_SPECS } from '../src/sim/kinematics.ts'
import { ObjectPool } from '../src/sim/pool.ts'
import { hashShipState, mulberry32 } from '../src/sim/prng.ts'
import { Vector2 } from '../src/sim/vector.ts'

describe('Vector2 pure operations', () => {
    it('constructs with default (0,0) and custom coordinates', () => {
        const v0 = new Vector2()
        expect(v0.x).toBe(0)
        expect(v0.y).toBe(0)
        const v1 = new Vector2(3, 4)
        expect(v1.length()).toBe(5)
        expect(v1.lengthSq()).toBe(25)
    })

    it('creates unit vector from angle', () => {
        const v = Vector2.fromAngle(0, 10)
        expect(v.x).toBeCloseTo(10, 5)
        expect(v.y).toBeCloseTo(0, 5)
    })

    it('creates vertical vector from PI/2 angle', () => {
        const v = Vector2.fromAngle(Math.PI / 2, 4)
        expect(v.x).toBeCloseTo(0, 5)
        expect(v.y).toBeCloseTo(4, 5)
    })

    it('clones without mutating original', () => {
        const a = new Vector2(7, 8)
        const b = a.clone()
        expect(b).toEqual(a)
        expect(b).not.toBe(a)
    })

    it('adds, subtracts, scales, and computes dot product', () => {
        const a = new Vector2(2, 3)
        const b = new Vector2(4, -1)
        expect(a.add(b)).toEqual(new Vector2(6, 2))
        expect(a.sub(b)).toEqual(new Vector2(-2, 4))
        expect(a.scale(3)).toEqual(new Vector2(6, 9))
        expect(a.dot(b)).toBe(5)
    })

    it('computes orthogonal dot product as 0', () => {
        const a = new Vector2(1, 0)
        const b = new Vector2(0, 1)
        expect(a.dot(b)).toBe(0)
    })

    it('computes distance between two points', () => {
        const a = new Vector2(1, 1)
        const b = new Vector2(4, 5)
        expect(a.distanceTo(b)).toBe(5)
    })

    it('computes zero distance to self', () => {
        const a = new Vector2(-12, 34)
        expect(a.distanceTo(a)).toBe(0)
    })

    it('normalizes non-zero and zero vectors safely', () => {
        const zero = new Vector2(0, 0).normalize()
        expect(zero).toEqual(new Vector2(0, 0))
        const unit = new Vector2(0, 10).normalize()
        expect(unit.x).toBeCloseTo(0, 5)
        expect(unit.y).toBeCloseTo(1, 5)
    })

    it('rotates vector by 90 and 180 degrees', () => {
        const v90 = new Vector2(1, 0).rotate(Math.PI / 2)
        expect(v90.x).toBeCloseTo(0, 5)
        expect(v90.y).toBeCloseTo(1, 5)

        const v180 = new Vector2(2, 0).rotate(Math.PI)
        expect(v180.x).toBeCloseTo(-2, 5)
        expect(v180.y).toBeCloseTo(0, 5)
    })
})

describe('ObjectPool lifecycle', () => {
    it('preallocates, reuses released objects, and tracks metrics', () => {
        const pool = new ObjectPool(
            () => ({ active: true, value: 1 }),
            (obj) => {
                obj.active = false
                obj.value = 0
            },
            2,
        )
        expect(pool.available).toBe(2)
        expect(pool.totalCreated).toBe(2)

        const a = pool.acquire()
        const b = pool.acquire()
        const c = pool.acquire()
        expect(pool.totalCreated).toBe(3)
        expect(pool.reusedCount).toBe(2)

        pool.release(a)
        expect(a.active).toBe(false)
        expect(pool.available).toBe(1)
        const d = pool.acquire()
        expect(d).toBe(a)
        expect(b).toBeDefined()
        expect(c).toBeDefined()
    })

    it('works with zero initial size', () => {
        const pool = new ObjectPool(
            () => ({ count: 0 }),
            (item) => {
                item.count = 0
            },
            0,
        )
        expect(pool.available).toBe(0)
        const first = pool.acquire()
        first.count = 99
        pool.release(first)
        expect(first.count).toBe(0)
        expect(pool.available).toBe(1)
    })
})

describe('PRNG and kinematics', () => {
    it('produces identical sequence for identical seed', () => {
        const r1 = mulberry32(999)
        const r2 = mulberry32(999)
        for (let i = 0; i < 25; i += 1) {
            expect(r1()).toBe(r2())
        }
    })

    it('produces distinct sequences for different seeds', () => {
        const r1 = mulberry32(1)
        const r2 = mulberry32(2)
        expect(r1()).not.toBe(r2())
    })

    it('generates numbers strictly within [0, 1)', () => {
        const rng = mulberry32(12345)
        for (let i = 0; i < 100; i += 1) {
            const v = rng()
            expect(v).toBeGreaterThanOrEqual(0)
            expect(v).toBeLessThan(1)
        }
    })

    it('wraps coordinates across arena boundaries', () => {
        expect(clampAxisWrap(-5, 1280)).toBe(1275)
        expect(clampAxisWrap(1285, 1280)).toBe(5)
        expect(clampAxisWrap(50, 0)).toBe(50)
    })

    it('accelerates forward, reverses, and caps terminal velocity', () => {
        const state = { x: 100, y: 100, vx: 0, vy: 0, angle: 0 }
        for (let i = 0; i < 120; i += 1) {
            integrateStep(state, { thrust: 1, turn: 0 }, 1 / 60)
        }
        const speed = Math.hypot(state.vx, state.vy)
        expect(speed).toBeLessThanOrEqual(SHARED_DRONE_SPECS.terminalSpeed + 1e-5)

        const rev = { x: 100, y: 100, vx: 0, vy: 0, angle: 0 }
        integrateStep(rev, { thrust: -1, turn: 1 }, 1 / 60)
        expect(rev.vx).toBeLessThan(0)
        expect(rev.angle).toBeGreaterThan(0)
    })

    it('applies air drag when thrust is zero', () => {
        const state = { x: 200, y: 200, vx: 100, vy: 0, angle: 0 }
        integrateStep(state, { thrust: 0, turn: 0 }, 1 / 60)
        expect(state.vx).toBeLessThan(100)
        expect(state.vx).toBeGreaterThan(0)
    })

    it('supports breakDeterminism flag for drift experiments', () => {
        const state = { x: 200, y: 200, vx: 0, vy: 0, angle: 0 }
        integrateStep(state, { thrust: 0, turn: 0 }, 1 / 60, 1280, 720, true)
        expect(typeof state.angle).toBe('number')
    })

    it('hashes identical ship states to identical hex strings', () => {
        const s1 = { x: 10, y: 20, vx: 3, vy: 4, angle: 0.5 }
        const s2 = { x: 10, y: 20, vx: 3, vy: 4, angle: 0.5 }
        expect(hashShipState(s1)).toBe(hashShipState(s2))
    })

    it('hashes different ship states to different hex strings', () => {
        const s1 = { x: 10, y: 20, vx: 3, vy: 4, angle: 0.5 }
        const s2 = { x: 11, y: 20, vx: 3, vy: 4, angle: 0.5 }
        expect(hashShipState(s1)).not.toBe(hashShipState(s2))
    })
})

describe('Protocol codecs, Zod validation, and helpers', () => {
    it('exposes wire and entity kind constants', () => {
        expect(WIRE_TYPE.INPUT).toBe(1)
        expect(WIRE_TYPE.SNAPSHOT).toBe(2)
        expect(ENTITY_KIND.SHIP).toBe(1)
        expect(ENTITY_KIND.PICKUP).toBe(4)
    })

    it('encodes server welcome, roster, chat, system, and pong_rtt messages', () => {
        const sys = JSON.parse(encodeServerMessage({ type: 'system', text: 'ready' })) as {
            type: string
        }
        expect(sys.type).toBe('system')

        const welcome = JSON.parse(
            encodeServerMessage({ type: 'welcome', playerId: 1, seed: 42, room: 'alpha' }),
        ) as { playerId: number }
        expect(welcome.playerId).toBe(1)

        const pong = JSON.parse(encodeServerMessage({ type: 'pong_rtt', clientSentAt: 123 })) as {
            clientSentAt: number
        }
        expect(pong.clientSentAt).toBe(123)
    })

    it('validates chat, netsim, and ping_rtt client messages via Zod', () => {
        expect(parseClientMessage({ type: 'chat', text: 'GG' }).ok).toBe(true)
        expect(parseClientMessage({ type: ' chat ', text: '' }).ok).toBe(false)
        expect(
            parseClientMessage({
                type: 'netsim',
                delayMs: 100,
                jitterMs: 20,
                dropRate: 0.05,
                useBinary: true,
            }).ok,
        ).toBe(true)
        expect(parseClientMessage({ type: 'ping_rtt', clientSentAt: 500 }).ok).toBe(true)
    })

    it('rejects oversize and malformed JSON payloads in parseClientMessage', () => {
        const huge = parseClientMessage('a'.repeat(3000), 1024)
        expect(huge.ok).toBe(false)
        const badJson = parseClientMessage('{unclosed_json')
        expect(badJson.ok).toBe(false)
    })

    it('rejects truncated and wrong-version binary frames', () => {
        expect(() => decodeInputBinary(new ArrayBuffer(4))).toThrow()
        expect(() => decodeSnapshotBinary(new ArrayBuffer(6))).toThrow()

        const badVer = new ArrayBuffer(14)
        new DataView(badVer).setUint8(0, 99)
        expect(() => decodeInputBinary(badVer)).toThrow()
    })

    it('supports JSON snapshot codec and benchmark helper', () => {
        const snap: Snapshot = {
            type: 'snapshot',
            v: 1,
            tick: asTick(12),
            lastProcessedSeq: asSeq(4),
            serverTimeMs: 1000,
            entities: [
                {
                    kind: 'asteroid',
                    id: asEntityId(7),
                    hp: 50,
                    x: 100,
                    y: 200,
                    vx: 1,
                    vy: 2,
                    angle: 0.5,
                    ownerId: asEntityId(0),
                },
                {
                    kind: 'pickup',
                    id: asEntityId(8),
                    hp: 1,
                    x: 300,
                    y: 400,
                    vx: 0,
                    vy: 0,
                    angle: 0,
                    ownerId: asEntityId(0),
                },
            ],
        }
        const bin = binarySnapshotCodec.encode(snap)
        const decBin = binarySnapshotCodec.decode(bin)
        expect(decBin.entities.length).toBe(2)

        const jsBuf = jsonSnapshotCodec.encode(snap)
        const decJs = jsonSnapshotCodec.decode(jsBuf)
        expect(decJs.tick).toBe(12)

        const bench = benchmarkCodecs(2)
        expect(bench.binary.bytesPerSnapshot).toBeLessThan(bench.json.bytesPerSnapshot)
    })

    it('assertNever throws on unexpected runtime values', () => {
        expect(() => assertNever('unexpected' as never)).toThrow()
    })
})

describe('Property-Based Tests (fast-check)', () => {
    it('Property 1: Binary input codec round-trips any valid input command', () => {
        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 1_000_000 }),
                fc.integer({ min: 0, max: 1_000_000 }),
                fc.constantFrom(-1, 0, 1),
                fc.constantFrom(-1, 0, 1),
                fc.boolean(),
                (seq, tick, thrust, turn, fire) => {
                    const encoded = encodeInputBinary({ seq, tick, thrust, turn, fire })
                    expect(encoded.byteLength).toBe(14)
                    const decoded = decodeInputBinary(encoded)
                    expect(decoded.seq).toBe(seq)
                    expect(decoded.tick).toBe(tick)
                    expect(decoded.thrust).toBe(thrust)
                    expect(decoded.turn).toBe(turn)
                    expect(decoded.fire).toBe(fire)
                },
            ),
        )
    })

    it('Property 2: Binary snapshot codec round-trips within quantization tolerance and matches spec byteLength', () => {
        const entityArb = fc.record({
            kind: fc.constantFrom('ship', 'bullet', 'asteroid', 'pickup') as fc.Arbitrary<
                'ship' | 'bullet' | 'asteroid' | 'pickup'
            >,
            id: fc.integer({ min: 1, max: 60000 }).map(asEntityId),
            hp: fc.integer({ min: 0, max: 100 }),
            x: fc.float({ min: Math.fround(0), max: Math.fround(1280), noNaN: true }),
            y: fc.float({ min: Math.fround(0), max: Math.fround(720), noNaN: true }),
            vx: fc.float({ min: Math.fround(-440), max: Math.fround(440), noNaN: true }),
            vy: fc.float({ min: Math.fround(-440), max: Math.fround(440), noNaN: true }),
            angle: fc.float({ min: Math.fround(-3.14), max: Math.fround(3.14), noNaN: true }),
            ownerId: fc.integer({ min: 0, max: 60000 }).map(asEntityId),
        })

        fc.assert(
            fc.property(
                fc.integer({ min: 0, max: 500000 }).map(asTick),
                fc.integer({ min: 0, max: 500000 }).map(asSeq),
                fc.array(entityArb, { minLength: 0, maxLength: 12 }),
                (tick, lastProcessedSeq, entities) => {
                    const snap: Snapshot = {
                        type: 'snapshot',
                        v: 1,
                        tick,
                        lastProcessedSeq,
                        serverTimeMs: 12345,
                        entities,
                    }
                    const buf = encodeSnapshotBinary(snap)
                    expect(buf.byteLength).toBe(16 + entities.length * 24)
                    const dec = decodeSnapshotBinary(buf)
                    expect(dec.tick).toBe(tick)
                    expect(dec.lastProcessedSeq).toBe(lastProcessedSeq)
                    expect(dec.entities.length).toBe(entities.length)
                    for (let i = 0; i < entities.length; i += 1) {
                        const orig = entities[i]
                        const got = dec.entities[i]
                        if (!orig || !got) continue
                        expect(got.kind).toBe(orig.kind)
                        expect(Math.abs(got.x - orig.x)).toBeLessThan(1e-2)
                        expect(Math.abs(got.angle - orig.angle)).toBeLessThan(0.002)
                    }
                },
            ),
        )
    })

    it('Property 3: Malformed/garbage binary buffers throw typed Error and never crash process', () => {
        fc.assert(
            fc.property(fc.uint8Array({ minLength: 0, maxLength: 64 }), (bytes) => {
                try {
                    decodeSnapshotBinary(bytes)
                } catch (err) {
                    expect(err).toBeInstanceOf(Error)
                }
                try {
                    decodeInputBinary(bytes)
                } catch (err) {
                    expect(err).toBeInstanceOf(Error)
                }
            }),
        )
    })

    it('Property 4: Ships never leave the arena bounds over random input sequences', () => {
        fc.assert(
            fc.property(
                fc.array(
                    fc.record({
                        thrust: fc.constantFrom(-1, 0, 1),
                        turn: fc.constantFrom(-1, 0, 1),
                    }),
                    { minLength: 10, maxLength: 120 },
                ),
                (commands) => {
                    const state = { x: 640, y: 360, vx: 0, vy: 0, angle: 0 }
                    for (const cmd of commands) {
                        integrateStep(state, cmd, 1 / 60, 1280, 720)
                        expect(state.x).toBeGreaterThanOrEqual(0)
                        expect(state.x).toBeLessThan(1280)
                        expect(state.y).toBeGreaterThanOrEqual(0)
                        expect(state.y).toBeLessThan(720)
                        expect(Math.hypot(state.vx, state.vy)).toBeLessThanOrEqual(
                            SHARED_DRONE_SPECS.terminalSpeed + 1e-4,
                        )
                    }
                },
            ),
        )
    })

    it('Property 5: parseClientMessage accepts all valid generated messages and rejects invalid mutations', () => {
        const validJoinArb = fc.record({
            v: fc.constant(0),
            type: fc.constant('join' as const),
            room: fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/),
            name: fc.stringMatching(/^[a-zA-Z0-9_-]{1,12}$/),
        })

        fc.assert(
            fc.property(validJoinArb, (msg) => {
                const res = parseClientMessage(JSON.stringify(msg))
                expect(res.ok).toBe(true)

                const mutated = { ...msg, type: 'invalid_type' }
                const badRes = parseClientMessage(JSON.stringify(mutated))
                expect(badRes.ok).toBe(false)
            }),
        )
    })

    it('Property 6: Angle quantization error never exceeds 0.001 radians', () => {
        fc.assert(
            fc.property(
                fc.float({ min: Math.fround(-3.1415), max: Math.fround(3.1415), noNaN: true }),
                (angle) => {
                    const q = quantizeAngle(angle)
                    const restored = dequantizeAngle(q)
                    expect(Math.abs(restored - angle)).toBeLessThanOrEqual(0.0011)
                },
            ),
        )
    })
})