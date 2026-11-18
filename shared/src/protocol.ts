import { z } from 'zod'

export type EntityId = number & { readonly __brand: 'EntityId' }
export type Tick = number & { readonly __brand: 'Tick' }
export type Seq = number & { readonly __brand: 'Seq' }

export function asEntityId(n: number): EntityId {
  return (n >>> 0) as EntityId
}

export function asTick(n: number): Tick {
  return (n >>> 0) as Tick
}

export function asSeq(n: number): Seq {
  return (n >>> 0) as Seq
}

export const PROTOCOL_VERSION = 1 as const

export const WIRE_TYPE = {
  INPUT: 1,
  SNAPSHOT: 2,
  PING: 3,
  PONG: 4,
} as const

export type WireTypeCode = (typeof WIRE_TYPE)[keyof typeof WIRE_TYPE]

export const ENTITY_KIND = {
  SHIP: 1,
  BULLET: 2,
  ASTEROID: 3,
  PICKUP: 4,
} as const

export type EntityKindCode = (typeof ENTITY_KIND)[keyof typeof ENTITY_KIND]

export type SnapshotEntity =
  | {
      readonly kind: 'ship'
      readonly id: EntityId
      readonly hp: number
      readonly x: number
      readonly y: number
      readonly vx: number
      readonly vy: number
      readonly angle: number
      readonly ownerId: EntityId
    }
  | {
      readonly kind: 'bullet'
      readonly id: EntityId
      readonly hp: number
      readonly x: number
      readonly y: number
      readonly vx: number
      readonly vy: number
      readonly angle: number
      readonly ownerId: EntityId
    }
  | {
      readonly kind: 'asteroid'
      readonly id: EntityId
      readonly hp: number
      readonly x: number
      readonly y: number
      readonly vx: number
      readonly vy: number
      readonly angle: number
      readonly ownerId: EntityId
    }
  | {
      readonly kind: 'pickup'
      readonly id: EntityId
      readonly hp: number
      readonly x: number
      readonly y: number
      readonly vx: number
      readonly vy: number
      readonly angle: number
      readonly ownerId: EntityId
    }

export interface Snapshot {
  readonly type: 'snapshot'
  readonly v: number
  readonly tick: Tick
  readonly lastProcessedSeq: Seq
  readonly serverTimeMs: number
  readonly entities: readonly SnapshotEntity[]
}

export const TurnSchema = z.union([z.literal(-1), z.literal(0), z.literal(1)])
export type TurnAxis = z.infer<typeof TurnSchema>

export const JoinMessageSchema = z.object({
  v: z.number().int().optional().default(0),
  type: z.literal('join'),
  room: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().trim().min(1).max(18),
})

export const ChatMessageSchema = z.object({
  v: z.number().int().optional().default(0),
  type: z.literal('chat'),
  text: z.string().trim().min(1).max(240),
})

export const InputMessageSchema = z.object({
  v: z.number().int().optional().default(1),
  type: z.literal('input'),
  seq: z.number().int().nonnegative(),
  tick: z.number().int().nonnegative().default(0),
  thrust: TurnSchema,
  turn: TurnSchema,
  fire: z.boolean(),
})

export const NetSimMessageSchema = z.object({
  v: z.number().int().optional().default(0),
  type: z.literal('netsim'),
  delayMs: z.number().min(0).max(400),
  jitterMs: z.number().min(0).max(150),
  dropRate: z.number().min(0).max(0.5),
  useBinary: z.boolean(),
})

export const PingRttMessageSchema = z.object({
  v: z.number().int().optional().default(0),
  type: z.literal('ping_rtt'),
  clientSentAt: z.number(),
})

export const ClientMessageSchema = z.discriminatedUnion('type', [
  JoinMessageSchema,
  ChatMessageSchema,
  InputMessageSchema,
  NetSimMessageSchema,
  PingRttMessageSchema,
])

export type ClientMessage = z.infer<typeof ClientMessageSchema>
export type InputMessage = z.infer<typeof InputMessageSchema>

export const RosterEntrySchema = z.object({
  id: z.string(),
  numericId: z.number().int(),
  name: z.string(),
})

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    v: z.number().int(),
    t: z.number(),
    type: z.literal('welcome'),
    playerId: z.number().int(),
    seed: z.number().int(),
    room: z.string(),
  }),
  z.object({
    v: z.number().int(),
    t: z.number(),
    type: z.literal('roster'),
    room: z.string(),
    players: z.array(RosterEntrySchema),
  }),
  z.object({
    v: z.number().int(),
    t: z.number(),
    type: z.literal('chat'),
    sender: z.string(),
    text: z.string(),
  }),
  z.object({
    v: z.number().int(),
    t: z.number(),
    type: z.literal('system'),
    text: z.string(),
  }),
  z.object({
    v: z.number().int(),
    t: z.number(),
    type: z.literal('pong_rtt'),
    clientSentAt: z.number(),
  }),
  z.object({
    v: z.number().int(),
    t: z.number(),
    type: z.literal('shutdown'),
    reason: z.string(),
  }),
])

export type ServerMessage = z.infer<typeof ServerMessageSchema>

export type ParseResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly code: number; readonly reason: string }

export function parseClientMessage(raw: unknown, maxBytes = 2048): ParseResult<ClientMessage> {
  let obj: unknown = raw
  if (typeof raw === 'string') {
    if (new TextEncoder().encode(raw).byteLength > maxBytes) {
      return { ok: false, code: 1009, reason: 'Payload exceeds maxPayload limit' }
    }
    try {
      obj = JSON.parse(raw) as unknown
    } catch {
      return { ok: false, code: 1007, reason: 'Malformed JSON' }
    }
  }

  const parsed = ClientMessageSchema.safeParse(obj)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      code: 1008,
      reason: issue ? `${issue.path.join('.')}: ${issue.message}` : 'Invalid message schema',
    }
  }

  return { ok: true, data: parsed.data }
}

export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type ServerMessagePayload = DistributiveOmit<ServerMessage, 'v' | 't'>

export function assertNever(value: never): never {
  throw new Error(`Unhandled discriminated union member: ${JSON.stringify(value)}`)
}

export function encodeServerMessage(msg: ServerMessagePayload): string {
  return JSON.stringify({
    v: 0,
    t: Date.now(),
    ...msg,
  })
}
