import { Buffer } from 'node:buffer'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { pipeline } from 'node:stream/promises'
import { benchmarkCodecs } from '@fpv-swarm/shared/codec/binary.ts'
import { z } from 'zod'
import { config } from './config.ts'
import { createSyntheticReplayStream } from './log/replay.ts'
import { RoomManager } from './rooms.ts'
import { attachWebSocketGateway } from './ws.ts'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wav': 'audio/wav',
}

const CreateRoomBodySchema = z.object({
  id: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(40),
  asteroidCount: z.number().int().min(3).max(20).optional().default(7),
})

function createWavBuffer(freqStart: number, freqEnd: number, durationSec: number): Buffer {
  const sampleRate = 22050
  const numSamples = Math.floor(sampleRate * durationSec)
  const buffer = Buffer.alloc(44 + numSamples * 2)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + numSamples * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(numSamples * 2, 40)

  let phase = 0
  for (let i = 0; i < numSamples; i += 1) {
    const t = i / numSamples
    const freq = freqStart + (freqEnd - freqStart) * t
    phase += (2 * Math.PI * freq) / sampleRate
    const envelope = (1 - t) ** 1.6
    const noise = freqEnd < 120 ? (Math.random() * 2 - 1) * 0.45 : 0
    const sample = Math.max(-1, Math.min(1, (Math.sin(phase) * 0.7 + noise) * envelope))
    buffer.writeInt16LE(Math.floor(sample * 32767), 44 + i * 2)
  }
  return buffer
}

const SPRITE_SHEET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="192" height="64" viewBox="0 0 192 64">
  <g transform="translate(0,0)">
    <line x1="14" y1="14" x2="50" y2="50" stroke="#64748b" stroke-width="4"/>
    <line x1="50" y1="14" x2="14" y2="50" stroke="#64748b" stroke-width="4"/>
    <circle cx="14" cy="14" r="9" fill="rgba(16,185,129,0.2)" stroke="#10b981" stroke-width="2"/>
    <circle cx="50" cy="14" r="9" fill="rgba(16,185,129,0.2)" stroke="#10b981" stroke-width="2"/>
    <circle cx="50" cy="50" r="9" fill="rgba(16,185,129,0.2)" stroke="#10b981" stroke-width="2"/>
    <circle cx="14" cy="50" r="9" fill="rgba(16,185,129,0.2)" stroke="#10b981" stroke-width="2"/>
    <rect x="22" y="25" width="20" height="14" rx="3" fill="#1e293b" stroke="#e2e8f0" stroke-width="1.5"/>
    <circle cx="42" cy="32" r="3" fill="#38bdf8"/>
  </g>
  <g transform="translate(64,0)">
    <polygon points="32,6 54,16 58,38 44,56 18,54 8,34 14,14" fill="rgba(245,158,11,0.22)" stroke="#f59e0b" stroke-width="2.5"/>
    <circle cx="26" cy="26" r="5" fill="rgba(245,158,11,0.35)"/>
    <circle cx="40" cy="38" r="4" fill="rgba(245,158,11,0.35)"/>
  </g>
  <g transform="translate(128,0)">
    <rect x="16" y="28" width="28" height="8" rx="4" fill="#38bdf8"/>
    <circle cx="42" cy="32" r="5" fill="#e0f2fe"/>
  </g>
</svg>`

const SOUNDS: Record<string, Buffer> = {
  '/assets/shoot.wav': createWavBuffer(880, 240, 0.11),
  '/assets/hit.wav': createWavBuffer(420, 110, 0.16),
  '/assets/explode.wav': createWavBuffer(190, 45, 0.38),
}

const roomManager = new RoomManager({
  logDir: config.logDir,
  maxRooms: config.maxRooms,
  maxPlayersPerRoom: config.maxPlayersPerRoom,
})
await roomManager.initDefaults()

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data)
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readJsonBody(req: http.IncomingMessage, maxBytes = 4096): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    total += buf.byteLength
    if (total > maxBytes) {
      throw new Error('Request body too large')
    }
    chunks.push(buf)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

async function serveStaticFile(res: http.ServerResponse, urlPath: string): Promise<void> {
  const relPath = urlPath === '/' ? '/index.html' : urlPath
  const safePath = path.resolve(config.clientDistDir, `.${relPath}`)
  if (!safePath.startsWith(config.clientDistDir)) {
    sendJson(res, 403, { error: 'Forbidden path traversal attempt' })
    return
  }

  try {
    const info = await stat(safePath)
    if (!info.isFile()) {
      sendJson(res, 404, { error: 'Not found' })
      return
    }
    const ext = path.extname(safePath)
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=60',
    })
    await pipeline(createReadStream(safePath), res)
  } catch {
    sendJson(res, 404, { error: 'Static asset not found' })
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const { pathname } = url

  if (req.method === 'GET' && pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      uptimeSec: Math.round(process.uptime()),
      rssMb: Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2)),
    })
    return
  }

  if (req.method === 'GET' && pathname === '/api/stats') {
    const elu = performance.eventLoopUtilization()
    sendJson(res, 200, {
      rssMb: Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(2)),
      heapUsedMb: Number((process.memoryUsage().heapUsed / (1024 * 1024)).toFixed(2)),
      eventLoopUtilization: Number((elu.utilization * 100).toFixed(2)),
      rooms: roomManager.listSummaries(),
      codecBenchmark4Players: benchmarkCodecs(4),
    })
    return
  }

  if (req.method === 'POST' && pathname.startsWith('/api/rooms/') && pathname.endsWith('/bots')) {
    const parts = pathname.split('/')
    const roomId = parts[3] ?? 'sector-alpha'
    const room = roomManager.get(roomId)
    if (!room) {
      sendJson(res, 404, { error: 'Room not found' })
      return
    }
    try {
      const rawBody = (await readJsonBody(req, 1024)) as { count?: number }
      const count = Number(rawBody?.count ?? 8)
      const activeBots = room.spawnBots(count)
      sendJson(res, 200, { roomId: room.id, bots: activeBots, roster: room.getRoster() })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid bot request'
      sendJson(res, 400, { error: msg })
    }
    return
  }

  if (req.method === 'GET' && pathname === '/api/slow') {
    const blockMs = Math.min(1000, Number(url.searchParams.get('ms') ?? 300))
    const start = performance.now()
    while (performance.now() - start < blockMs) {}
    sendJson(res, 200, { blockedMs: blockMs })
    return
  }

  if (req.method === 'GET' && pathname === '/api/rooms') {
    sendJson(res, 200, {
      updatedAt: new Date().toISOString(),
      rooms: roomManager.listSummaries(),
    })
    return
  }

  if (req.method === 'POST' && pathname === '/api/rooms') {
    try {
      const rawBody = await readJsonBody(req, 2048)
      const parsed = CreateRoomBodySchema.safeParse(rawBody)
      if (!parsed.success) {
        sendJson(res, 400, { error: 'Invalid room payload schema' })
        return
      }
      const cleanId = parsed.data.id.toLowerCase().replace(/[^a-z0-9-_]/g, '-')
      const room = await roomManager.createRoom({
        id: cleanId,
        name: parsed.data.name,
        asteroidCount: parsed.data.asteroidCount,
      })
      sendJson(res, 201, { room: room.toSummary() })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Bad request'
      sendJson(res, 400, { error: message })
    }
    return
  }

  if (req.method === 'GET' && pathname.startsWith('/api/replays/')) {
    const replayId = path.basename(pathname.slice('/api/replays/'.length))

    if (replayId === 'synthetic') {
      const mb = Math.min(200, Math.max(1, Number(url.searchParams.get('mb') ?? 32)))
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'X-RSS-Start-MB': (process.memoryUsage().rss / (1024 * 1024)).toFixed(2),
      })
      try {
        await pipeline(createSyntheticReplayStream(mb), res)
      } catch {}
      return
    }

    try {
      const files = await readdir(config.logDir)
      const match = files.find((f) => f === replayId || f.startsWith(`${replayId}-`))
      if (!match) {
        sendJson(res, 404, { error: 'Replay file not found' })
        return
      }
      const fullPath = path.join(config.logDir, match)
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8' })
      await pipeline(createReadStream(fullPath), res)
    } catch {
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'Failed to stream replay' })
      }
    }
    return
  }

  if (pathname === '/assets/manifest.json') {
    const failMode = url.searchParams.get('fail')
    if (failMode === 'corrupt') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{ "corruptJson": true, broken_syntax ')
      return
    }
    if (failMode === 'timeout') {
      await new Promise((r) => setTimeout(r, 6000))
    }
    sendJson(res, 200, {
      sprites: {
        sheet: failMode === '404' ? '/assets/missing-404.svg' : '/assets/sprites.svg',
      },
      audio: {
        shoot: '/assets/shoot.wav',
        hit: '/assets/hit.wav',
        explode: '/assets/explode.wav',
      },
      arena: '/assets/arena.json',
    })
    return
  }

  if (pathname === '/assets/arena.json') {
    sendJson(res, 200, { targetAsteroidCount: 7, gridStep: 80 })
    return
  }

  if (pathname === '/assets/sprites.svg') {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
    res.end(SPRITE_SHEET_SVG)
    return
  }

  const soundBuf = SOUNDS[pathname]
  if (soundBuf) {
    res.writeHead(200, { 'Content-Type': 'audio/wav' })
    res.end(soundBuf)
    return
  }

  await serveStaticFile(res, pathname)
})

const wsGateway = attachWebSocketGateway(server, roomManager, config)

server.listen(config.port, config.host, () => {
  console.log(`FPV Swarm Server listening on http://${config.host}:${config.port}`)
})

let shuttingDown = false
async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`\nReceived ${signal}: closing server and flushing match logs...`)
  server.close()
  await wsGateway.close()
  await roomManager.closeAll()
  process.exit(0)
}

process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT')
})
process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM')
})
