import { fetchJson } from '../assets/loader.js'

export class Lobby extends EventTarget {
  #abortController = null
  #timerId = null
  #rooms = []

  startPolling(intervalMs = 3000) {
    this.stopPolling()
    this.#abortController = new AbortController()
    this.refresh()
    this.#timerId = setInterval(() => {
      this.refresh()
    }, intervalMs)
  }

  stopPolling() {
    if (this.#timerId !== null) {
      clearInterval(this.#timerId)
      this.#timerId = null
    }
    if (this.#abortController) {
      this.#abortController.abort()
      this.#abortController = null
    }
  }

  async refresh() {
    const signal = this.#abortController?.signal
    this.dispatchEvent(new CustomEvent('status', { detail: { loading: true } }))
    try {
      const data = await fetchJson('/api/rooms', { signal, timeoutMs: 2000 })
      this.#rooms = data.rooms
      this.dispatchEvent(
        new CustomEvent('roomsChanged', {
          detail: { rooms: this.#rooms, updatedAt: data.updatedAt },
        }),
      )
    } catch (err) {
      if (err?.name === 'AbortError') return
      this.dispatchEvent(new CustomEvent('error', { detail: { message: err.message } }))
    }
  }

  join(roomId, callsign) {
    const room = this.#rooms.find((r) => r.id === roomId) ?? this.#rooms[0]
    this.stopPolling()
    this.dispatchEvent(
      new CustomEvent('joined', {
        detail: {
          room: room ?? {
            id: 'sector-alpha',
            name: 'Sector Alpha',
            asteroidCount: 7,
          },
          callsign: callsign.trim() || 'GENIY-FPV',
        },
      }),
    )
  }
}
