import WebSocket from 'ws'

const BASE_URL = process.env.TARGET_URL ?? 'http://127.0.0.1:3000'
const WS_URL = `${BASE_URL.replace(/^http/, 'ws')}/ws`

async function testForeignOrigin(): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL, { headers: { Origin: 'https://evil-attacker.example' } })
    ws.on('unexpected-response', (_req, res) => {
      resolve(res.statusCode === 403)
    })
    ws.on('open', () => {
      ws.close()
      resolve(false)
    })
    ws.on('error', () => resolve(true))
  })
}

async function testGarbageFloodAndIsolation(): Promise<{
  floodClosedCode: number
  otherRoomTickP99Ms: number
  rejectedMetricLine: string
}> {
  const innocent = new WebSocket(WS_URL, { headers: { Origin: BASE_URL } })
  await new Promise<void>((r) => innocent.on('open', () => r()))
  innocent.send(JSON.stringify({ v: 0, type: 'join', room: 'sector-alpha', name: 'INNOCENT' }))

  const attacker = new WebSocket(WS_URL, { headers: { Origin: BASE_URL } })
  let floodClosedCode = 0
  await new Promise<void>((r) => attacker.on('open', () => r()))
  const closedPromise = new Promise<void>((resolve) => {
    attacker.on('close', (code) => {
      floodClosedCode = code
      resolve()
    })
  })

  const garbage = Buffer.from([255, 255, 0, 1, 2, 3])
  for (let i = 0; i < 1000; i += 1) {
    if (attacker.readyState !== WebSocket.OPEN) break
    attacker.send(garbage)
  }

  await closedPromise
  await new Promise((r) => setTimeout(r, 400))

  const statsRes = await fetch(`${BASE_URL}/api/stats`)
  const stats = (await statsRes.json()) as {
    rooms: Array<{ id: string; tickP99Ms: number }>
  }
  const alpha = stats.rooms.find((r) => r.id === 'sector-alpha')

  const metricsRes = await fetch(`${BASE_URL}/metrics`)
  const metricsText = await metricsRes.text()
  const rejectedLines = metricsText
    .split('\n')
    .filter((l) => l.startsWith('fpv_swarm_ws_rejected_total'))
    .join(' | ')

  innocent.terminate()

  return {
    floodClosedCode,
    otherRoomTickP99Ms: alpha?.tickP99Ms ?? 0,
    rejectedMetricLine: rejectedLines,
  }
}

async function main(): Promise<void> {
  const originBlocked = await testForeignOrigin()
  const floodResult = await testGarbageFloodAndIsolation()

  console.log('=== CHAOS TEST REPORT ===')
  console.log('1. Foreign Origin blocked (HTTP 403):', originBlocked)
  console.log('2. Garbage flood (1000 frames) closed with WS code:', floodResult.floodClosedCode)
  console.log('3. Innocent room (sector-alpha) tick p99 ms:', floodResult.otherRoomTickP99Ms)
  console.log('4. Prometheus rejection counters:', floodResult.rejectedMetricLine)
}

void main()
