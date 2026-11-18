import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { PassThrough, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export class JsonLinesTransform extends Transform {
  constructor() {
    super({ writableObjectMode: true, readableObjectMode: false })
  }

  _transform(eventObj, _encoding, callback) {
    try {
      const line = `${JSON.stringify(eventObj)}\n`
      callback(null, line)
    } catch (err) {
      callback(err)
    }
  }
}

export async function createRoomLogStream(logDir, roomId) {
  await mkdir(logDir, { recursive: true })
  const safeId = roomId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const fileName = `${safeId}-${Date.now()}.ndjson`
  const filePath = path.join(logDir, fileName)

  const input = new PassThrough({ objectMode: true })
  const transform = new JsonLinesTransform()
  const fileStream = createWriteStream(filePath, { flags: 'a' })

  const done = pipeline(input, transform, fileStream).catch((err) => {
    console.error('MatchLog pipeline error:', err.message)
  })

  return {
    fileName,
    filePath,
    writeEvent(event) {
      if (!input.destroyed && !input.writableEnded) {
        input.write({ t: Date.now(), ...event })
      }
    },
    async close() {
      if (!input.writableEnded) {
        input.end()
      }
      await done
    },
  }
}
