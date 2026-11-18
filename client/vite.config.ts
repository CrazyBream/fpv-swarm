import { Buffer } from 'node:buffer'
import { defineConfig } from 'vite'

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

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

export default defineConfig({
    server: {
        proxy: {
            '/api': 'http://127.0.0.1:3000',
            '/health': 'http://127.0.0.1:3000',
            '/ws': {
                target: 'ws://127.0.0.1:3000',
                ws: true,
            },
        },
    },
    plugins: [
        {
            name: 'fpv-swarm-asset-generator',
            configureServer(server) {
                const sounds: Record<string, Buffer> = {
                    '/assets/shoot.wav': createWavBuffer(880, 240, 0.11),
                    '/assets/hit.wav': createWavBuffer(420, 110, 0.16),
                    '/assets/explode.wav': createWavBuffer(190, 45, 0.38),
                }

                server.middlewares.use(async (req, res, next) => {
                    const urlObj = new URL(req.url ?? '/', 'http://localhost')
                    const pathname = urlObj.pathname
                    const failMode = urlObj.searchParams.get('fail')

                    if (pathname === '/assets/manifest.json') {
                        await delay(80)
                        if (failMode === 'corrupt') {
                            res.statusCode = 200
                            res.setHeader('Content-Type', 'application/json')
                            res.end('{ "corruptJson": true, broken_syntax ')
                            return
                        }
                        if (failMode === 'timeout') {
                            await delay(6000)
                        }
                        res.setHeader('Content-Type', 'application/json')
                        res.end(
                            JSON.stringify({
                                sprites: {
                                    sheet: failMode === '404' ? '/assets/missing-404.svg' : '/assets/sprites.svg',
                                },
                                audio: {
                                    shoot: '/assets/shoot.wav',
                                    hit: '/assets/hit.wav',
                                    explode: '/assets/explode.wav',
                                },
                                arena: '/assets/arena.json',
                            }),
                        )
                        return
                    }

                    if (pathname === '/assets/arena.json') {
                        res.setHeader('Content-Type', 'application/json')
                        res.end(JSON.stringify({ targetAsteroidCount: 7, gridStep: 80 }))
                        return
                    }

                    if (pathname === '/assets/sprites.svg') {
                        res.setHeader('Content-Type', 'image/svg+xml')
                        res.end(SPRITE_SHEET_SVG)
                        return
                    }

                    if (pathname === '/assets/missing-404.svg') {
                        res.statusCode = 404
                        res.end('Not Found')
                        return
                    }

                    const soundBuf = sounds[pathname]
                    if (soundBuf) {
                        res.setHeader('Content-Type', 'audio/wav')
                        res.end(soundBuf)
                        return
                    }

                    next()
                })
            },
        },
    ],
})