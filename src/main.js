import { createInput } from './input.js'
import { createLoop } from './loop.js'
import { blendDroneState, drawArenaGrid, drawHud, drawShip } from './render/hud-and-drone.js'
import { setupViewport } from './render/viewport.js'
import { syncWrapForInterpolation, wrapPosition } from './sim/arena.js'
import { createDrone, integrate, snapshotDrone } from './sim/ship.js'

const canvas = document.querySelector('#arena-canvas')
const exitBtn = document.querySelector('#exit-btn')
const exitOverlay = document.querySelector('#exit-overlay')
const restartBtn = document.querySelector('#restart-btn')

let input = createInput(window)
const drone = createDrone()
let prevDrone = snapshotDrone(drone)

let viewport = setupViewport(canvas, ({ width, height }) => {
    wrapPosition(drone, width, height)
})

drone.x = viewport.bounds.width / 2
drone.y = viewport.bounds.height / 2
prevDrone = snapshotDrone(drone)

function simulate(dt) {
    prevDrone = snapshotDrone(drone)
    integrate(drone, input, dt)
    wrapPosition(drone, viewport.bounds.width, viewport.bounds.height)
    syncWrapForInterpolation(prevDrone, drone, viewport.bounds.width, viewport.bounds.height)
    input.clearFrameEdges()
}

function render(alpha, telemetry) {
    drawArenaGrid(viewport.ctx, viewport.bounds.width, viewport.bounds.height)
    const interpolated = blendDroneState(prevDrone, drone, alpha)
    drawShip(viewport.ctx, interpolated)
    drawHud(viewport.ctx, telemetry, drone)
}

const gameLoop = createLoop({ step: 1 / 60, simulate, render })
gameLoop.start()

function exitGame() {
    gameLoop.stop()
    input.destroy()
    viewport.destroy()
    exitOverlay.classList.add('visible')
    exitBtn.style.display = 'none'
}

function restartGame() {
    exitOverlay.classList.remove('visible')
    exitBtn.style.display = 'block'

    input = createInput(window)
    viewport = setupViewport(canvas, ({ width, height }) => {
        wrapPosition(drone, width, height)
    })

    drone.x = viewport.bounds.width / 2
    drone.y = viewport.bounds.height / 2
    drone.vx = 0
    drone.vy = 0
    drone.angle = -Math.PI / 2
    prevDrone = snapshotDrone(drone)

    gameLoop.start()
}

exitBtn.addEventListener('click', exitGame)
restartBtn.addEventListener('click', restartGame)

window.addEventListener('keydown', () => {
    if (input.justPressed('Escape')) {
        exitGame()
        return
    }
    if (input.justPressed('Space')) {
        if (gameLoop.isRunning()) {
            gameLoop.stop()
        } else {
            input.clearFrameEdges()
            gameLoop.start()
        }
    }
})