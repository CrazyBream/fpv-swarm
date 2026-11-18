import path from 'node:path'
import { z } from 'zod'

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  LOG_DIR: z.string().default('./logs'),
  MAX_ROOMS: z.coerce.number().int().positive().default(12),
  MAX_PLAYERS_PER_ROOM: z.coerce.number().int().positive().default(160),
})

export interface ServerConfig {
  readonly port: number
  readonly host: string
  readonly logDir: string
  readonly clientDistDir: string
  readonly maxRooms: number
  readonly maxPlayersPerRoom: number
  readonly maxPayloadBytes: number
  readonly joinTimeoutMs: number
  readonly heartbeatIntervalMs: number
  readonly rateLimitPerSec: number
  readonly slowClientThresholdBytes: number
}

const parsedEnv = EnvSchema.parse(process.env)

export const config = Object.freeze({
  port: parsedEnv.PORT,
  host: parsedEnv.HOST,
  logDir: path.resolve(process.cwd(), parsedEnv.LOG_DIR),
  clientDistDir: path.resolve(import.meta.dirname, '../../client/dist'),
  maxRooms: parsedEnv.MAX_ROOMS,
  maxPlayersPerRoom: parsedEnv.MAX_PLAYERS_PER_ROOM,
  maxPayloadBytes: 2048,
  joinTimeoutMs: 5000,
  heartbeatIntervalMs: 15000,
  rateLimitPerSec: 120,
  slowClientThresholdBytes: 65536,
} satisfies ServerConfig)
