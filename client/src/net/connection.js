export class ServerConnection extends EventTarget {
  #socket = null
  #sendQueue = []
  #shouldReconnect = false
  #reconnectAttempts = 0
  #reconnectTimer = null
  #lastJoinPayload = null
  #url

  constructor(url) {
    super()
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    this.#url = url || `${proto}//${window.location.host}/ws`
  }

  connect(joinPayload) {
    this.#lastJoinPayload = joinPayload
    this.#shouldReconnect = true
    this.#openSocket()
  }

  #openSocket() {
    if (this.#socket) {
      this.#socket.close()
    }

    this.#socket = new WebSocket(this.#url)

    this.#socket.addEventListener('open', () => {
      this.#reconnectAttempts = 0
      this.dispatchEvent(new CustomEvent('status', { detail: { connected: true } }))

      if (this.#lastJoinPayload) {
        this.#socket.send(
          JSON.stringify({
            v: 0,
            type: 'join',
            room: this.#lastJoinPayload.room,
            name: this.#lastJoinPayload.name,
          }),
        )
      }

      while (this.#sendQueue.length > 0 && this.#socket.readyState === WebSocket.OPEN) {
        this.#socket.send(this.#sendQueue.shift())
      }
    })

    this.#socket.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data)
        this.dispatchEvent(new CustomEvent(msg.type, { detail: msg }))
      } catch {}
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

  sendChat(text) {
    const packet = JSON.stringify({ v: 0, type: 'chat', text })
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(packet)
    } else {
      this.#sendQueue.push(packet)
    }
  }

  disconnect() {
    this.#shouldReconnect = false
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
