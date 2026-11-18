import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { PassThrough, Transform, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export interface MatchLogEvent {
  readonly type: string
  readonly [key: string]: unknown
}

export class JsonLinesTransform extends Transform {
  constructor() {
    super({ writableObjectMode: true, readableObjectMode: false })
  }

  override _transform(
    eventObj: MatchLogEvent,
    _encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    try {
      const line = `${JSON.stringify(eventObj)}\n`
      callback(null, line)
    } catch (err: unknown) {
      callback(err instanceof Error ? err : new Error(String(err)))
    }
  }
}

export interface RoomLogger {
  readonly fileName: string
  readonly filePath: string
  writeEvent(event: MatchLogEvent): void
  close(): Promise<void>
}

export async function createRoomLogStream(logDir: string, roomId: string): Promise<RoomLogger> {
  await mkdir(logDir, { recursive: true })
  const safeId = roomId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const fileName = `${safeId}-${Date.now()}.ndjson`
  const filePath = path.join(logDir, fileName)

  const input = new PassThrough({ objectMode: true })
  const transform = new JsonLinesTransform()
  const fileStream = createWriteStream(filePath, { flags: 'a' })

  const done = pipeline(input, transform, fileStream).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('MatchLog pipeline error:', msg)
  })

  return {
    fileName,
    filePath,
    writeEvent(event: MatchLogEvent): void {
      if (!input.destroyed && !input.writableEnded) {
        input.write({ t: Date.now(), ...event })
      }
    },
    async close(): Promise<void> {
      if (!input.writableEnded) {
        input.end()
      }
      await done
    },
  }
}
