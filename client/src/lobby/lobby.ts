import { fetchJson } from '../assets/loader.ts'

export interface RoomSummary {
  id: string
  name: string
  players: number
  maxPlayers: number
  pingMs: number
  asteroidCount: number
}

export class Lobby extends EventTarget {
  #abortController: AbortController | null = null
  #timerId: ReturnType<typeof setInterval> | null = null
  #rooms: RoomSummary[] = []

  startPolling(intervalMs = 3000): void {
    this.stopPolling()
    this.#abortController = new AbortController()
    void this.refresh()
    this.#timerId = setInterval(() => {
      void this.refresh()
    }, intervalMs)
  }

  stopPolling(): void {
    if (this.#timerId !== null) {
      clearInterval(this.#timerId)
      this.#timerId = null
    }
    if (this.#abortController) {
      this.#abortController.abort()
      this.#abortController = null
    }
  }

  async refresh(): Promise<void> {
    const signal = this.#abortController?.signal
    this.dispatchEvent(new CustomEvent('status', { detail: { loading: true } }))
    try {
      const data = await fetchJson<{ updatedAt: string; rooms: RoomSummary[] }>('/api/rooms', {
        signal,
        timeoutMs: 2000,
      })
      this.#rooms = data.rooms
      this.dispatchEvent(
        new CustomEvent('roomsChanged', {
          detail: { rooms: this.#rooms, updatedAt: data.updatedAt },
        }),
      )
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      const message = err instanceof Error ? err.message : 'Unknown lobby error'
      this.dispatchEvent(new CustomEvent('error', { detail: { message } }))
    }
  }

  join(roomId: string, callsign: string): void {
    const room = this.#rooms.find((r) => r.id === roomId) ?? this.#rooms[0]
    this.stopPolling()
    this.dispatchEvent(
      new CustomEvent('joined', {
        detail: {
          room: room ?? {
            id: 'sector-alpha',
            name: 'Sector Alpha',
            players: 1,
            maxPlayers: 8,
            pingMs: 12,
            asteroidCount: 7,
          },
          callsign: callsign.trim() || 'GENIY-FPV',
        },
      }),
    )
  }
}
