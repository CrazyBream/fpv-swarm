import path from 'node:path'

function parsePort(val, fallback) {
  const port = Number.parseInt(val ?? String(fallback), 10)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT: ${val}`)
  }
  return port
}

function parsePositiveInt(val, fallback) {
  const num = Number.parseInt(val ?? String(fallback), 10)
  return Number.isInteger(num) && num > 0 ? num : fallback
}

export const config = Object.freeze({
  port: parsePort(process.env.PORT, 3000),
  host: process.env.HOST || '127.0.0.1',
  logDir: path.resolve(process.cwd(), process.env.LOG_DIR || './logs'),
  clientDistDir: path.resolve(import.meta.dirname, '../../client/dist'),
  maxRooms: parsePositiveInt(process.env.MAX_ROOMS, 12),
  maxPlayersPerRoom: parsePositiveInt(process.env.MAX_PLAYERS_PER_ROOM, 8),
  maxPayloadBytes: 2048,
  joinTimeoutMs: 5000,
  heartbeatIntervalMs: 15000,
  rateLimitPerSec: 12,
  slowClientThresholdBytes: 65536,
})
