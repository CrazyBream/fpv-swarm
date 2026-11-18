import { encodeInputBinary } from '@fpv-swarm/shared/codec/binary.ts'
import WebSocket from 'ws'

interface TierResult {
  clients: number
  tickP50Ms: number
  tickP99Ms: number
  eluPercent: number
  rssMb: number
  totalKbpsDown: number
}

async function runLoadTier(
  baseUrl: string,
  wsUrl: string,
  clientCount: number,
  durationMs = 2500,
): Promise<TierResult> {
  const sockets: WebSocket[] = []
  let bytesReceived = 0

  await Promise.all(
    Array.from({ length: clientCount }, (_, idx) => {
      return new Promise<void>((resolve) => {
        const ws = new WebSocket(wsUrl)
        ws.on('open', () => {
          ws.send(
            JSON.stringify({
              v: 0,
              type: 'join',
              room: 'kyiv-poly',
              name: `LOAD-${idx + 1}`,
            }),
          )
          resolve()
        })
        ws.on('message', (data: Buffer) => {
          bytesReceived += data.byteLength
        })
        ws.on('error', () => resolve())
        sockets.push(ws)
      })
    }),
  )

  let seq = 0
  const inputInterval = setInterval(() => {
    seq += 1
    const frame = Buffer.from(
      encodeInputBinary({
        seq,
        tick: seq,
        thrust: 1,
        turn: seq % 2 === 0 ? 1 : -1,
        fire: seq % 12 === 0,
      }),
    )
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(frame)
      }
    }
  }, 33)

  await new Promise((r) => setTimeout(r, durationMs))
  clearInterval(inputInterval)

  const statsRes = await fetch(`${baseUrl}/api/stats`)
  const stats = (await statsRes.json()) as {
    rssMb: number
    eventLoopUtilization: number
    rooms: Array<{ id: string; tickP50Ms: number; tickP99Ms: number }>
  }

  for (const ws of sockets) {
    ws.close()
  }
  await new Promise((r) => setTimeout(r, 250))

  const roomStats = stats.rooms.find((r) => r.id === 'kyiv-poly')
  return {
    clients: clientCount,
    tickP50Ms: roomStats?.tickP50Ms ?? 0,
    tickP99Ms: roomStats?.tickP99Ms ?? 0,
    eluPercent: stats.eventLoopUtilization,
    rssMb: stats.rssMb,
    totalKbpsDown: Number((bytesReceived / (durationMs / 1000) / 1024).toFixed(1)),
  }
}

async function main(): Promise<void> {
  const baseUrl = 'http://127.0.0.1:3000'
  const wsUrl = 'ws://127.0.0.1:3000/ws'
  const tiers = [8, 32, 64, 128]
  const results: TierResult[] = []

  console.log('Running FPV Swarm Server Load Test (N = 8, 32, 64, 128)...')
  for (const n of tiers) {
    const res = await runLoadTier(baseUrl, wsUrl, n, 2500)
    results.push(res)
  }
  console.table(results)
}

void main()
