import { decodeSnapshotBinary, encodeInputBinary } from '@fpv-swarm/shared/codec/binary.ts'
import { ServerMessageSchema, type Snapshot } from '@fpv-swarm/shared/protocol.ts'

export class ServerConnection extends EventTarget {
  #socket: WebSocket | null = null
  #sendQueue: string[] = []
  #shouldReconnect = false
  #reconnectAttempts = 0
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null
  #pingTimer: ReturnType<typeof setInterval> | null = null
  #lastJoinPayload: { room: string; name: string } | null = null
  #url: string

  #bytesInWindow = 0
  #bytesOutWindow = 0
  #lastRateSampleTime = performance.now()
  bytesInPerSec = 0
  bytesOutPerSec = 0
  rttMs = 0
  useBinary = true

  constructor(url?: string) {
    super()
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    this.#url = url ?? `${proto}//${window.location.host}/ws`
  }

  connect(joinPayload: { room: string; name: string }): void {
    this.#lastJoinPayload = joinPayload
    this.#shouldReconnect = true
    this.#openSocket()
  }

  #sampleTraffic(): void {
    const now = performance.now()
    const elapsed = (now - this.#lastRateSampleTime) / 1000
    if (elapsed >= 1.0) {
      this.bytesInPerSec = Math.round(this.#bytesInWindow / elapsed)
      this.bytesOutPerSec = Math.round(this.#bytesOutWindow / elapsed)
      this.#bytesInWindow = 0
      this.#bytesOutWindow = 0
      this.#lastRateSampleTime = now
    }
  }

  #openSocket(): void {
    if (this.#socket) {
      this.#socket.close()
    }

    this.#socket = new WebSocket(this.#url)
    this.#socket.binaryType = 'arraybuffer'

    this.#socket.addEventListener('open', () => {
      this.#reconnectAttempts = 0
      this.dispatchEvent(new CustomEvent('status', { detail: { connected: true } }))

      if (this.#lastJoinPayload) {
        this.#sendRawText(
          JSON.stringify({
            v: 0,
            type: 'join',
            room: this.#lastJoinPayload.room,
            name: this.#lastJoinPayload.name,
          }),
        )
      }

      while (this.#sendQueue.length > 0 && this.#socket?.readyState === WebSocket.OPEN) {
        const queued = this.#sendQueue.shift()
        if (queued) this.#sendRawText(queued)
      }

      if (this.#pingTimer) clearInterval(this.#pingTimer)
      this.#pingTimer = setInterval(() => {
        if (this.#socket?.readyState === WebSocket.OPEN) {
          this.#sendRawText(
            JSON.stringify({ v: 0, type: 'ping_rtt', clientSentAt: performance.now() }),
          )
        }
        this.#sampleTraffic()
      }, 500)
    })

    this.#socket.addEventListener('message', (event: MessageEvent<unknown>) => {
      this.#sampleTraffic()
      if (event.data instanceof ArrayBuffer) {
        this.#bytesInWindow += event.data.byteLength
        try {
          const snap = decodeSnapshotBinary(event.data)
          this.dispatchEvent(new CustomEvent('snapshot', { detail: snap }))
        } catch {}
        return
      }

      if (typeof event.data === 'string') {
        this.#bytesInWindow += event.data.length
        try {
          const rawObj: unknown = JSON.parse(event.data)
          if (
            rawObj &&
            typeof rawObj === 'object' &&
            'type' in rawObj &&
            rawObj.type === 'snapshot'
          ) {
            this.dispatchEvent(new CustomEvent('snapshot', { detail: rawObj as Snapshot }))
            return
          }
          const parsed = ServerMessageSchema.safeParse(rawObj)
          if (!parsed.success) return
          const msg = parsed.data
          if (msg.type === 'pong_rtt') {
            this.rttMs = Math.max(0, performance.now() - msg.clientSentAt)
            return
          }
          this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }))
        } catch {}
      }
    })

    this.#socket.addEventListener('close', () => {
      this.dispatchEvent(new CustomEvent('status', { detail: { connected: false } }))
      if (this.#shouldReconnect) {
        const delayMs = Math.min(8000, 300 * 2 ** this.#reconnectAttempts + Math.random() * 150)
        this.#reconnectAttempts += 1
        this.#reconnectTimer = setTimeout(() => this.#openSocket(), delayMs)
      }
    })

    this.#socket.addEventListener('error', () => {})
  }

  #sendRawText(str: string): void {
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#bytesOutWindow += str.length
      this.#socket.send(str)
    }
  }

  sendInput(inputCmd: {
    seq: number
    tick: number
    thrust: number
    turn: number
    fire: boolean
  }): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) return
    this.#sampleTraffic()
    if (this.useBinary) {
      const buf = encodeInputBinary(inputCmd)
      this.#bytesOutWindow += buf.byteLength
      this.#socket.send(buf)
    } else {
      this.#sendRawText(JSON.stringify({ v: 1, type: 'input', ...inputCmd }))
    }
  }

  configureNetSim({
    delayMs = 0,
    jitterMs = 0,
    dropRate = 0,
    useBinary = true,
  }: {
    delayMs?: number
    jitterMs?: number
    dropRate?: number
    useBinary?: boolean
  }): void {
    this.useBinary = useBinary
    this.#sendRawText(
      JSON.stringify({
        v: 0,
        type: 'netsim',
        delayMs,
        jitterMs,
        dropRate,
        useBinary,
      }),
    )
  }

  sendChat(text: string): void {
    const packet = JSON.stringify({ v: 0, type: 'chat', text })
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#sendRawText(packet)
    } else {
      this.#sendQueue.push(packet)
    }
  }

  disconnect(): void {
    this.#shouldReconnect = false
    if (this.#pingTimer) {
      clearInterval(this.#pingTimer)
      this.#pingTimer = null
    }
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = null
    }
    if (this.#socket) {
      this.#socket.close(1000, 'Client left room')
      this.#socket = null
    }
    this.#sendQueue.length = 0
  }
}
