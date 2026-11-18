import './style.css'
import type { Snapshot } from '@fpv-swarm/shared/protocol.ts'
import { type LoadedAssets, loadAll } from './assets/loader.ts'
import { createSoundEngine } from './audio/audio.ts'
import { createInput } from './input.ts'
import { mountLobbyView } from './lobby/lobby-view.ts'
import { Lobby, type RoomSummary } from './lobby/lobby.ts'
import { type LoopTelemetry, createLoop } from './loop.ts'
import { ServerConnection } from './net/connection.ts'
import { NetworkPredictor } from './net/reconciler.ts'
import {
  drawHud,
  drawLoadingScreen,
  drawNetgraph,
  drawRemoteEntities,
  drawWorld,
} from './render/hud-and-drone.ts'
import { setupViewport } from './render/viewport.ts'
import { Ship } from './sim/ship.ts'
import { Vector2 } from './sim/vector.ts'
import { World } from './sim/world.ts'

const canvas = document.querySelector<HTMLCanvasElement>('#arena-canvas')
const exitBtn = document.querySelector<HTMLButtonElement>('#exit-btn')
const exitOverlay = document.querySelector<HTMLElement>('#exit-overlay')
const restartBtn = document.querySelector<HTMLButtonElement>('#restart-btn')
const lobbyRoot = document.querySelector<HTMLElement>('#lobby-root')
const errorBanner = document.querySelector<HTMLElement>('#error-Banner')
const errorText = document.querySelector<HTMLElement>('#error-text')
const retryLoadBtn = document.querySelector<HTMLButtonElement>('#retry-load-btn')

const netlabBar = document.querySelector<HTMLElement>('#netlab-bar')
const lagPreset = document.querySelector<HTMLSelectElement>('#lag-preset')
const togglePredBtn = document.querySelector<HTMLButtonElement>('#toggle-pred-btn')
const toggleReconBtn = document.querySelector<HTMLButtonElement>('#toggle-recon-btn')
const toggleCodecBtn = document.querySelector<HTMLButtonElement>('#toggle-codec-btn')
const toggleDriftBtn = document.querySelector<HTMLButtonElement>('#toggle-drift-btn')
const spawnBotsBtn = document.querySelector<HTMLButtonElement>('#spawn-bots-btn')
const currentRoomId = 'sector-alpha'
let botsActive = false

const commsPanel = document.querySelector<HTMLElement>('#comms-panel')
const wsIndicator = document.querySelector<HTMLElement>('#ws-indicator')
const rosterCount = document.querySelector<HTMLElement>('#roster-count')
const rosterList = document.querySelector<HTMLElement>('#roster-list')
const chatLog = document.querySelector<HTMLElement>('#chat-log')
const chatForm = document.querySelector<HTMLFormElement>('#chat-form')
const chatInput = document.querySelector<HTMLInputElement>('#chat-input')

if (!canvas || !lobbyRoot) {
  throw new Error('Required root DOM elements missing')
}

const soundEngine = createSoundEngine()
const world = new World()
soundEngine.bindToWorld(world.events)

const connection = new ServerConnection()
const predictor = new NetworkPredictor()

function syncNetSimConfig(): void {
  if (!lagPreset) return
  const parts = lagPreset.value.split(',').map(Number)
  connection.configureNetSim({
    delayMs: parts[0] ?? 0,
    jitterMs: parts[1] ?? 0,
    dropRate: parts[2] ?? 0,
    useBinary: connection.useBinary,
  })
}

lagPreset?.addEventListener('change', syncNetSimConfig)

togglePredBtn?.addEventListener('click', () => {
  predictor.enablePrediction = !predictor.enablePrediction
  togglePredBtn.textContent = `Prediction: ${predictor.enablePrediction ? 'ON' : 'OFF'}`
})

toggleReconBtn?.addEventListener('click', () => {
  predictor.enableReconciliation = !predictor.enableReconciliation
  toggleReconBtn.textContent = `Reconcile: ${predictor.enableReconciliation ? 'ON' : 'OFF'}`
})

toggleCodecBtn?.addEventListener('click', () => {
  connection.useBinary = !connection.useBinary
  toggleCodecBtn.textContent = `Codec: ${connection.useBinary ? 'BINARY' : 'JSON'}`
  syncNetSimConfig()
})

toggleDriftBtn?.addEventListener('click', () => {
  predictor.breakDeterminism = !predictor.breakDeterminism
  toggleDriftBtn.textContent = `Math.random Bug: ${predictor.breakDeterminism ? 'ON' : 'OFF'}`
})

function appendChatLine(prefix: string, text: string, color = '#e2e8f0'): void {
  if (!chatLog) return
  const row = document.createElement('div')
  row.style.color = color
  const strong = document.createElement('strong')
  strong.textContent = `${prefix}: `
  row.appendChild(strong)
  row.appendChild(document.createTextNode(text))
  chatLog.appendChild(row)
  chatLog.scrollTop = chatLog.scrollHeight
}

connection.addEventListener('status', (e: Event) => {
  const detail = (e as CustomEvent<{ connected: boolean }>).detail
  if (wsIndicator) {
    wsIndicator.textContent = detail.connected ? 'WS: ONLINE' : 'WS: RECONNECTING...'
    wsIndicator.style.color = detail.connected ? '#10b981' : '#f59e0b'
  }
  if (detail.connected) {
    syncNetSimConfig()
  }
})

connection.addEventListener('welcome', (e: Event) => {
  const detail = (e as CustomEvent<{ playerId: number }>).detail
  predictor.setLocalPlayer(detail.playerId, player.pos.x, player.pos.y)
})

connection.addEventListener('snapshot', (e: Event) => {
  const snap = (e as CustomEvent<Snapshot>).detail
  predictor.onServerSnapshot(snap, world.width, world.height)
})

connection.addEventListener('roster', (e: Event) => {
  const detail = (
    e as CustomEvent<{ players: Array<{ id: string; numericId: number; name: string }> }>
  ).detail
  const players = detail.players ?? []
  if (rosterCount) rosterCount.textContent = `PILOTS: ${players.length}`
  if (rosterList) {
    rosterList.textContent = `Active: ${players.map((p) => `${p.name}[#${p.numericId}]`).join(', ')}`
  }
})

connection.addEventListener('chat', (e: Event) => {
  const detail = (e as CustomEvent<{ sender: string; text: string }>).detail
  appendChatLine(detail.sender, detail.text, '#f8fafc')
})

connection.addEventListener('system', (e: Event) => {
  const detail = (e as CustomEvent<{ text: string }>).detail
  appendChatLine('SYSTEM', detail.text, '#34d399')
})

chatForm?.addEventListener('submit', (e: SubmitEvent) => {
  e.preventDefault()
  if (!chatInput) return
  const text = chatInput.value.trim()
  if (!text) return
  connection.sendChat(text)
  chatInput.value = ''
  chatInput.blur()
})

let lastScoreDelta = 0
world.events.on('scoreChanged', (payload) => {
  lastScoreDelta = payload.delta
})

let input = createInput(window)
let loadedAssets: LoadedAssets | null = null
let activeLoadController: AbortController | null = null

let viewport = setupViewport(canvas, ({ width, height }) => {
  world.setBounds(width, height)
})

const player = new Ship({
  x: viewport.bounds.width / 2,
  y: viewport.bounds.height / 2,
})
world.player = player
world.spawn(player)

const lobby = new Lobby()
const lobbyView = mountLobbyView(lobbyRoot, lobby, {
  onSimulateFailure(failMode: string) {
    lobby.stopPolling()
    lobbyView.hide()
    void runAssetPipeline(failMode)
  },
})

async function runAssetPipeline(failMode = 'none'): Promise<void> {
  if (errorBanner) errorBanner.style.display = 'none'
  if (activeLoadController) {
    activeLoadController.abort()
  }
  activeLoadController = new AbortController()

  const query = failMode !== 'none' && failMode !== 'abort' ? `?fail=${failMode}` : ''
  const manifestUrl = `/assets/manifest.json${query}`

  drawLoadingScreen(viewport.ctx, viewport.bounds.width, viewport.bounds.height, {
    ratio: 0,
    currentKey: 'manifest.json',
  })

  if (failMode === 'abort') {
    setTimeout(() => activeLoadController?.abort(), 190)
  }

  try {
    loadedAssets = await loadAll(manifestUrl, soundEngine.ctx, {
      signal: activeLoadController.signal,
      onProgress({ ratio, key }) {
        drawLoadingScreen(viewport.ctx, viewport.bounds.width, viewport.bounds.height, {
          ratio,
          currentKey: key,
        })
      },
    })
    soundEngine.setBuffers(loadedAssets.audio)
    lobbyView.show()
    lobby.startPolling(3000)
  } catch (err: unknown) {
    const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    drawLoadingScreen(viewport.ctx, viewport.bounds.width, viewport.bounds.height, {
      ratio: 0.35,
      error: reason,
    })
    if (errorText) errorText.textContent = `Pipeline stopped (${reason})`
    if (errorBanner) errorBanner.style.display = 'flex'
  }
}

retryLoadBtn?.addEventListener('click', () => {
  void runAssetPipeline('none')
})

const handleMouseDown = (e: MouseEvent): void => {
  if (e.target !== canvas) return
  soundEngine.unlock()
  if (gameLoop.isRunning()) {
    world.triggerPlayerFire()
  }
}
canvas.addEventListener('mousedown', handleMouseDown)

function simulate(dt: number): void {
  const turnLeft = input.isDown('KeyA') || input.isDown('ArrowLeft')
  const turnRight = input.isDown('KeyD') || input.isDown('ArrowRight')
  const throttleUp = input.isDown('KeyW') || input.isDown('ArrowUp')
  const throttleBack = input.isDown('KeyS') || input.isDown('ArrowDown')
  const fire = input.isDown('Space') || input.isDown('KeyJ')

  const rawCmd = {
    turn: (turnRight ? 1 : 0) - (turnLeft ? 1 : 0),
    thrust: (throttleUp ? 1 : 0) - (throttleBack ? 1 : 0),
    fire,
  }

  world.step(dt, input)

  if (predictor.localPlayerId) {
    const netCmd = predictor.stepLocalInput(rawCmd, dt, world.width, world.height)
    connection.sendInput(netCmd)

    const pose = predictor.getVisualLocalPose()
    player.pos = new Vector2(pose.x, pose.y)
    player.prevPos = player.pos
    player.angle = pose.angle
    player.prevAngle = pose.angle
  }

  input.clearFrameEdges()
}

function render(alpha: number, telemetry: LoopTelemetry): void {
  drawWorld(viewport.ctx, world, alpha, loadedAssets)
  const remotes = predictor.getInterpolatedRemotes()
  drawRemoteEntities(viewport.ctx, remotes, loadedAssets?.sprites.sheet)
  drawHud(viewport.ctx, telemetry, world, lastScoreDelta)

  const snapAgeMs =
    predictor.lastSnapshotReceivedAt > 0 ? performance.now() - predictor.lastSnapshotReceivedAt : 0

  drawNetgraph(viewport.ctx, viewport.bounds.width, {
    useBinary: connection.useBinary,
    rttMs: connection.rttMs,
    snapAgeMs,
    bytesIn: connection.bytesInPerSec,
    bytesOut: connection.bytesOutPerSec,
    pendingCount: predictor.pendingInputs.length,
    interpDelayMs: predictor.interpDelayMs,
    correctionPx: predictor.lastCorrectionPx,
    serverTick: predictor.serverTick,
    predOn: predictor.enablePrediction,
    reconOn: predictor.enableReconciliation,
    driftOn: predictor.breakDeterminism,
  })
}

const gameLoop = createLoop({ step: 1 / 60, simulate, render })

function exitGame(): void {
  gameLoop.stop()
  lobby.stopPolling()
  connection.disconnect()
  input.destroy()
  viewport.destroy()
  canvas?.removeEventListener('mousedown', handleMouseDown)
  if (commsPanel) commsPanel.style.display = 'none'
  if (netlabBar) netlabBar.style.display = 'none'
  exitOverlay?.classList.add('visible')
  if (exitBtn) exitBtn.style.display = 'none'
}

function restartGame(): void {
  if (!canvas) return
  exitOverlay?.classList.remove('visible')

  input = createInput(window)
  viewport = setupViewport(canvas, ({ width, height }) => {
    world.setBounds(width, height)
  })
  canvas.addEventListener('mousedown', handleMouseDown)

  lobbyView.show()
  lobby.startPolling(3000)
}

lobby.addEventListener('joined', (e: Event) => {
  soundEngine.unlock()
  const { room, callsign } = (e as CustomEvent<{ room: RoomSummary; callsign: string }>).detail
  world.callsign = callsign
  world.roomName = room.name
  world.targetAsteroidCount = room.asteroidCount

  lobbyView.hide()
  if (exitBtn) exitBtn.style.display = 'block'
  if (commsPanel) commsPanel.style.display = 'flex'
  if (netlabBar) netlabBar.style.display = 'flex'
  if (chatLog) chatLog.innerHTML = ''

  connection.connect({ room: room.id, name: callsign })

  player.resetAt(viewport.bounds.width / 2, viewport.bounds.height / 2)
  world.spawn(player)
  world.populateInitialAsteroids()
  gameLoop.start()
})
spawnBotsBtn?.addEventListener('click', async () => {
  botsActive = !botsActive
  const count = botsActive ? 8 : 0
  spawnBotsBtn.textContent = botsActive ? 'Clear AI Bots (8)' : 'Spawn 8 AI Bots'
  await fetch(`/api/rooms/${currentRoomId}/bots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ count }),
  })
})
exitBtn?.addEventListener('click', exitGame)
restartBtn?.addEventListener('click', restartGame)

window.addEventListener('keydown', () => {
  soundEngine.unlock()
  if (input.justPressed('Escape') && gameLoop.isRunning()) {
    exitGame()
    return
  }
  if (input.justPressed('KeyP') && gameLoop.isRunning()) {
    gameLoop.stop()
  } else if (input.justPressed('KeyP') && !gameLoop.isRunning()) {
    input.clearFrameEdges()
    gameLoop.start()
  }
})

void runAssetPipeline('none')
