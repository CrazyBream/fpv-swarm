import path from 'node:path'
import { z } from 'zod'

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_DIR: z.string().default('./logs'),
  ALLOWED_ORIGINS: z
    .string()
    .default(
      'http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000',
    ),
  MAX_CONNECTIONS_PER_IP: z.coerce.number().int().min(1).max(1000).default(20),
  MAX_ROOMS: z.coerce.number().int().positive().default(12),
  MAX_PLAYERS_PER_ROOM: z.coerce.number().int().positive().default(160),
  GIT_SHA: z.string().min(1).default('dev-local'),
})

export interface ServerConfig {
  readonly nodeEnv: 'development' | 'test' | 'production'
  readonly port: number
  readonly host: string
  readonly logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent'
  readonly logDir: string
  readonly clientDistDir: string
  readonly allowedOrigins: readonly string[]
  readonly maxConnectionsPerIp: number
  readonly maxRooms: number
  readonly maxPlayersPerRoom: number
  readonly maxPayloadBytes: number
  readonly joinTimeoutMs: number
  readonly heartbeatIntervalMs: number
  readonly rateLimitPerSec: number
  readonly slowClientThresholdBytes: number
  readonly gitSha: string
}

const parsedEnv = EnvSchema.parse(process.env)

const allowedOrigins = parsedEnv.ALLOWED_ORIGINS.split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter((o) => o.length > 0)

export const config = Object.freeze({
  nodeEnv: parsedEnv.NODE_ENV,
  port: parsedEnv.PORT,
  host: parsedEnv.HOST,
  logLevel: parsedEnv.LOG_LEVEL,
  logDir: path.resolve(process.cwd(), parsedEnv.LOG_DIR),
  clientDistDir: path.resolve(import.meta.dirname, '../../client/dist'),
  allowedOrigins,
  maxConnectionsPerIp: parsedEnv.MAX_CONNECTIONS_PER_IP,
  maxRooms: parsedEnv.MAX_ROOMS,
  maxPlayersPerRoom: parsedEnv.MAX_PLAYERS_PER_ROOM,
  maxPayloadBytes: 2048,
  joinTimeoutMs: 5000,
  heartbeatIntervalMs: 15000,
  rateLimitPerSec: 120,
  slowClientThresholdBytes: 65536,
  gitSha: parsedEnv.GIT_SHA,
} satisfies ServerConfig)
