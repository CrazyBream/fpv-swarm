import type { Lobby, RoomSummary } from './lobby.ts'

export function mountLobbyView(
  container: HTMLElement,
  lobby: Lobby,
  { onSimulateFailure }: { onSimulateFailure?: (mode: string) => void } = {},
) {
  let selectedRoomId = 'sector-alpha'

  container.innerHTML = `
    <div class="lobby-card">
      <h2>// FPV SWARM — TACTICAL LOBBY //</h2>
      <div class="lobby-row">
        <label for="pilot-callsign">CALLSIGN:</label>
        <input id="pilot-callsign" type="text" value="GENIY-FPV" maxlength="16" />
        <button id="refresh-rooms-btn" type="button">REFRESH</button>
      </div>
      <div id="lobby-status" class="lobby-status">Connecting to command server...</div>
      <div id="room-list" class="room-list"></div>
      <div class="lobby-actions">
        <button id="join-room-btn" type="button" class="primary-btn">LAUNCH DRONE (JOIN)</button>
      </div>
      <div class="failure-lab-bar">
        <span>M4 Failure Gallery:</span>
        <button data-fail="none" type="button">Normal Load</button>
        <button data-fail="404" type="button">Simulate 404 Sprite</button>
        <button data-fail="timeout" type="button">Simulate Timeout</button>
        <button data-fail="abort" type="button">Simulate Abort</button>
        <button data-fail="corrupt" type="button">Simulate Corrupt JSON</button>
      </div>
    </div>
  `

  const statusEl = container.querySelector<HTMLElement>('#lobby-status')
  const listEl = container.querySelector<HTMLElement>('#room-list')
  const callsignInput = container.querySelector<HTMLInputElement>('#pilot-callsign')
  const refreshBtn = container.querySelector<HTMLButtonElement>('#refresh-rooms-btn')
  const joinBtn = container.querySelector<HTMLButtonElement>('#join-room-btn')

  function renderRooms(rooms: RoomSummary[], updatedAt: string): void {
    if (statusEl) {
      statusEl.textContent = `ONLINE // Last sync: ${new Date(updatedAt).toLocaleTimeString()}`
    }
    if (!listEl) return
    listEl.innerHTML = ''
    for (const room of rooms) {
      const item = document.createElement('div')
      item.className = `room-item ${room.id === selectedRoomId ? 'selected' : ''}`
      item.innerHTML = `
        <div>
          <strong>${room.name}</strong>
          <div class="room-meta">Targets: ${room.asteroidCount} | Ping: ${room.pingMs} ms</div>
        </div>
        <div class="room-slots">${room.players}/${room.maxPlayers}</div>
      `
      item.addEventListener('click', () => {
        selectedRoomId = room.id
        renderRooms(rooms, updatedAt)
      })
      listEl.appendChild(item)
    }
  }

  lobby.addEventListener('roomsChanged', (e: Event) => {
    const custom = e as CustomEvent<{ rooms: RoomSummary[]; updatedAt: string }> // Standard DOM CustomEvent narrowing
    renderRooms(custom.detail.rooms, custom.detail.updatedAt)
  })

  lobby.addEventListener('error', (e: Event) => {
    const custom = e as CustomEvent<{ message: string }> // Standard DOM CustomEvent narrowing
    if (statusEl) {
      statusEl.textContent = `SYNC ERROR: ${custom.detail.message}`
    }
  })

  refreshBtn?.addEventListener('click', () => {
    void lobby.refresh()
  })
  joinBtn?.addEventListener('click', () => {
    lobby.join(selectedRoomId, callsignInput?.value ?? 'GENIY-FPV')
  })

  for (const btn of container.querySelectorAll<HTMLButtonElement>('[data-fail]')) {
    btn.addEventListener('click', () => {
      const failAttr = btn.getAttribute('data-fail')
      if (failAttr) onSimulateFailure?.(failAttr)
    })
  }

  return {
    show(): void {
      container.style.display = 'flex'
    },
    hide(): void {
      container.style.display = 'none'
    },
  }
}
