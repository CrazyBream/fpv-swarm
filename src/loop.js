const MAX_DELTA_SEC = 0.25

export function createLoop({ step = 1 / 60, simulate, render } = {}) {
    let frameHandle = 0
    let active = false
    let prevTimestamp = 0
    let accumulator = 0

    let stepCount = 0
    let frameCount = 0
    let lastReportTime = 0

    const telemetry = {
        stepsPerSec: 60,
        framesPerSec: 60,
        frameDurationMs: 16.67,
    }

    function onAnimationFrame(timestamp) {
        if (!active) return

        const elapsedSec = prevTimestamp === 0 ? 0 : (timestamp - prevTimestamp) / 1000
        prevTimestamp = timestamp
        telemetry.frameDurationMs = elapsedSec * 1000

        // Clamp запобігає зависанню ("spiral of death") після повернення з неактивної вкладки
        accumulator += Math.min(elapsedSec, MAX_DELTA_SEC)

        while (accumulator >= step) {
            simulate(step)
            accumulator -= step
            stepCount += 1
        }

        const alpha = accumulator / step
        render(alpha, telemetry)
        frameCount += 1

        if (timestamp - lastReportTime >= 1000) {
            telemetry.stepsPerSec = stepCount
            telemetry.framesPerSec = frameCount
            stepCount = 0
            frameCount = 0
            lastReportTime = timestamp
        }

        frameHandle = requestAnimationFrame(onAnimationFrame)
    }

    return {
        start() {
            if (active) return
            active = true
            prevTimestamp = 0
            accumulator = 0
            lastReportTime = performance.now()
            frameHandle = requestAnimationFrame(onAnimationFrame)
        },
        stop() {
            active = false
            cancelAnimationFrame(frameHandle)
        },
        isRunning() {
            return active
        },
    }
}