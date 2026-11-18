import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'

export async function* readReplayEvents(filePath) {
  const stream = createReadStream(filePath, { encoding: 'utf8', highWaterMark: 16384 })
  let leftover = ''

  for await (const chunk of stream) {
    leftover += chunk
    const lines = leftover.split('\n')
    leftover = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed) {
        yield JSON.parse(trimmed)
      }
    }
  }

  if (leftover.trim()) {
    yield JSON.parse(leftover.trim())
  }
}

export function createSyntheticReplayStream(totalMegabytes = 32) {
  const targetBytes = totalMegabytes * 1024 * 1024
  let produced = 0
  let seq = 0

  return Readable.from(
    (async function* () {
      while (produced < targetBytes) {
        seq += 1
        const line = `${JSON.stringify({
          t: Date.now(),
          seq,
          type: 'telemetry_tick',
          drone: 'GENIY-FPV',
          x: 640.25,
          y: 360.75,
          vx: 410.5,
          vy: -12.3,
        })}\n`
        const buf = Buffer.from(line, 'utf8')
        produced += buf.byteLength
        yield buf
      }
    })(),
  )
}
