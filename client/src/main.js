import './style.css'
import { loadAll } from './assets/loader.js'
import { createSoundEngine } from './audio/audio.js'
import { createInput } from './input.js'
import { mountLobbyView } from './lobby/lobby-view.js'
import { Lobby } from './lobby/lobby.js'
import { createLoop } from './loop.js'
import { ServerConnection } from './net/connection.js'
import { drawHud, drawLoadingScreen, drawWorld } from './render/hud-and-drone.js'
import { setupViewport } from './render/viewport.js'
import { Ship } from './sim/ship.js'
import { World } from './sim/world.js'

const canvas = document.querySelector('#arena-canvas')
const exitBtn = document.querySelector('#exit-btn')
const exitOverlay = document.querySelector('#exit-overlay')
const restartBtn = document.querySelector('#restart-btn')
const lobbyRoot = document.querySelector('#lobby-root')
const errorBanner = document.querySelector('#error-Banner')
const errorText = document.querySelector('#error-text')
const retryLoadBtn = document.querySelector('#retry-load-btn')

const commsPanel = document.querySelector('#comms-panel')
const wsIndicator = document.querySelector('#ws-indicator')
const rosterCount = document.querySelector('#roster-count')
const rosterList = document.querySelector('#roster-list')
const chatLog = document.querySelector('#chat-log')
const chatForm = document.querySelector('#chat-form')
const chatInput = document.querySelector('#chat-input')

const soundEngine = createSoundEngine()
const world = new World()
soundEngine.bindToWorld(world)

const connection = new ServerConnection()

function appendChatLine(prefix, text, color = '#e2e8f0') {
  const row = document.createElement('div')
  row.style.color = color
  const strong = document.createElement('strong')
  strong.textContent = `${prefix}: `
  row.appendChild(strong)
  row.appendChild(document.createTextNode(text))
  chatLog.appendChild(row)
  chatLog.scrollTop = chatLog.scrollHeight
}

connection.addEventListener('status', (e) => {
  wsIndicator.textContent = e.detail.connected ? 'WS: ONLINE' : 'WS: RECONNECTING...'
  wsIndicator.style.color = e.detail.connected ? '#10b981' : '#f59e0b'
})

connection.addEventListener('roster', (e) => {
  const players = e.detail.players || []
  rosterCount.textContent = `PILOTS: ${players.length}`
  rosterList.textContent = `Active: ${players.map((p) => p.name).join(', ')}`
})

connection.addEventListener('chat', (e) => {
  appendChatLine(e.detail.sender, e.detail.text, '#f8fafc')
})

connection.addEventListener('system', (e) => {
  appendChatLine('SYSTEM', e.detail.text, '#34d399')
})

chatForm.addEventListener('submit', (e) => {
  e.preventDefault()
  const text = chatInput.value.trim()
  if (!text) return
  connection.sendChat(text)
  chatInput.value = ''
  chatInput.blur()
})

let lastScoreDelta = 0
world.addEventListener('scoreChanged', (e) => {
  lastScoreDelta = e.detail.delta
})

let input = createInput(window)
let loadedAssets = null
let activeLoadController = null

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
  onSimulateFailure(failMode) {
    lobby.stopPolling()
    lobbyView.hide()
    runAssetPipeline(failMode)
  },
})

async function runAssetPipeline(failMode = 'none') {
  errorBanner.style.display = 'none'
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
    setTimeout(() => activeLoadController.abort(), 190)
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
  } catch (err) {
    const reason = `${err.name}: ${err.message}`
    drawLoadingScreen(viewport.ctx, viewport.bounds.width, viewport.bounds.height, {
      ratio: 0.35,
      error: reason,
    })
    errorText.textContent = `Pipeline stopped (${reason})`
    errorBanner.style.display = 'flex'
  }
}

retryLoadBtn.addEventListener('click', () => {
  runAssetPipeline('none')
})

const handleMouseDown = (e) => {
  if (e.target !== canvas) return
  soundEngine.unlock()
  if (gameLoop.isRunning()) {
    world.triggerPlayerFire()
  }
}
canvas.addEventListener('mousedown', handleMouseDown)

function simulate(dt) {
  world.step(dt, input)
  input.clearFrameEdges()
}

function render(alpha, telemetry) {
  drawWorld(viewport.ctx, world, alpha, loadedAssets)
  drawHud(viewport.ctx, telemetry, world, lastScoreDelta)
}

const gameLoop = createLoop({ step: 1 / 60, simulate, render })

function exitGame() {
  gameLoop.stop()
  lobby.stopPolling()
  connection.disconnect()
  input.destroy()
  viewport.destroy()
  canvas.removeEventListener('mousedown', handleMouseDown)
  commsPanel.style.display = 'none'
  exitOverlay.classList.add('visible')
  exitBtn.style.display = 'none'
}

function restartGame() {
  exitOverlay.classList.remove('visible')

  input = createInput(window)
  viewport = setupViewport(canvas, ({ width, height }) => {
    world.setBounds(width, height)
  })
  canvas.addEventListener('mousedown', handleMouseDown)

  lobbyView.show()
  lobby.startPolling(3000)
}

lobby.addEventListener('joined', (e) => {
  soundEngine.unlock()
  const { room, callsign } = e.detail
  world.callsign = callsign
  world.roomName = room.name
  world.targetAsteroidCount = room.asteroidCount

  lobbyView.hide()
  exitBtn.style.display = 'block'
  commsPanel.style.display = 'flex'
  chatLog.innerHTML = ''

  connection.connect({ room: room.id, name: callsign })

  player.resetAt(viewport.bounds.width / 2, viewport.bounds.height / 2)
  world.spawn(player)
  world.populateInitialAsteroids()
  gameLoop.start()
})

exitBtn.addEventListener('click', exitGame)
restartBtn.addEventListener('click', restartGame)

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

runAssetPipeline('none')
