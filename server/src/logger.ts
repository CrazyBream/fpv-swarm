import pino from 'pino'
import { config } from './config.ts'

export const logger = pino({
  level: config.logLevel,
  base: {
    service: 'fpv-swarm-server',
    version: config.gitSha,
  },
  redact: {
    paths: ['password', 'token', 'secret', 'authorization', '*.password', '*.token', '*.secret'],
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
})
