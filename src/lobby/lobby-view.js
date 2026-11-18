export function mountLobbyView(container, lobby, { onSimulateFailure } = {}) {
	let selectedRoomId = "sector-alpha";

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
  `;

	const statusEl = container.querySelector("#lobby-status");
	const listEl = container.querySelector("#room-list");
	const callsignInput = container.querySelector("#pilot-callsign");
	const refreshBtn = container.querySelector("#refresh-rooms-btn");
	const joinBtn = container.querySelector("#join-room-btn");

	function renderRooms(rooms, updatedAt) {
		statusEl.textContent = `ONLINE // Last sync: ${new Date(updatedAt).toLocaleTimeString()}`;
		listEl.innerHTML = "";
		for (const room of rooms) {
			const item = document.createElement("div");
			item.className = `room-item ${room.id === selectedRoomId ? "selected" : ""}`;
			item.innerHTML = `
        <div>
          <strong>${room.name}</strong>
          <div class="room-meta">Targets: ${room.asteroidCount} | Ping: ${room.pingMs} ms</div>
        </div>
        <div class="room-slots">${room.players}/${room.maxPlayers}</div>
      `;
			item.addEventListener("click", () => {
				selectedRoomId = room.id;
				renderRooms(rooms, updatedAt);
			});
			listEl.appendChild(item);
		}
	}

	lobby.addEventListener("roomsChanged", (e) => {
		renderRooms(e.detail.rooms, e.detail.updatedAt);
	});

	lobby.addEventListener("error", (e) => {
		statusEl.textContent = `SYNC ERROR: ${e.detail.message}`;
	});

	refreshBtn.addEventListener("click", () => lobby.refresh());
	joinBtn.addEventListener("click", () => {
		lobby.join(selectedRoomId, callsignInput.value);
	});

	for (const btn of container.querySelectorAll("[data-fail]")) {
		btn.addEventListener("click", () => {
			onSimulateFailure?.(btn.getAttribute("data-fail"));
		});
	}

	return {
		show() {
			container.style.display = "flex";
		},
		hide() {
			container.style.display = "none";
		},
	};
}
