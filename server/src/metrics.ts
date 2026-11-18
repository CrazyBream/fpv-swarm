import { performance } from 'node:perf_hooks'
import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client'
import type { RoomManager } from './rooms.ts'

export const metricsRegistry = new Registry()
collectDefaultMetrics({ register: metricsRegistry, prefix: 'fpv_swarm_' })

export const connectedPlayersGauge = new Gauge({
  name: 'fpv_swarm_connected_players',
  help: 'Current number of connected human WebSocket players',
  registers: [metricsRegistry],
})

export const activeRoomsGauge = new Gauge({
  name: 'fpv_swarm_active_rooms',
  help: 'Current number of active game rooms',
  registers: [metricsRegistry],
})

export const wsMessagesTotal = new Counter({
  name: 'fpv_swarm_ws_messages_total',
  help: 'Total WebSocket messages processed',
  labelNames: ['direction'] as const,
  registers: [metricsRegistry],
})

export const wsBytesTotal = new Counter({
  name: 'fpv_swarm_ws_bytes_total',
  help: 'Total WebSocket bytes transferred',
  labelNames: ['direction'] as const,
  registers: [metricsRegistry],
})

export const wsRejectedTotal = new Counter({
  name: 'fpv_swarm_ws_rejected_total',
  help: 'Total rejected or forcefully closed WebSocket connections by reason',
  labelNames: ['reason'] as const,
  registers: [metricsRegistry],
})

export const tickDurationP99Gauge = new Gauge({
  name: 'fpv_swarm_tick_duration_p99_ms',
  help: 'Server match tick duration p99 in milliseconds',
  labelNames: ['roomId'] as const,
  registers: [metricsRegistry],
})

export const eventLoopUtilizationGauge = new Gauge({
  name: 'fpv_swarm_event_loop_utilization',
  help: 'Node.js event loop utilization ratio (0..1)',
  registers: [metricsRegistry],
})

export const rssMemoryBytesGauge = new Gauge({
  name: 'fpv_swarm_rss_memory_bytes',
  help: 'Process Resident Set Size in bytes',
  registers: [metricsRegistry],
})

let lastElu = performance.eventLoopUtilization()

export function refreshRuntimeMetrics(roomManager: RoomManager): void {
  const summaries = roomManager.listSummaries()
  activeRoomsGauge.set(summaries.length)

  let totalPlayers = 0
  for (const r of summaries) {
    totalPlayers += r.players
    tickDurationP99Gauge.set({ roomId: r.id }, r.tickP99Ms)
  }
  connectedPlayersGauge.set(totalPlayers)

  const currentElu = performance.eventLoopUtilization(lastElu)
  lastElu = performance.eventLoopUtilization()
  eventLoopUtilizationGauge.set(Number(currentElu.utilization.toFixed(4)))
  rssMemoryBytesGauge.set(process.memoryUsage().rss)
}
