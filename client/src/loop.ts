export interface LoopTelemetry {
  readonly stepsPerSec: number
  readonly framesPerSec: number
  readonly frameDurationMs: number
}

export interface GameLoop {
  start(): void
  stop(): void
  isRunning(): boolean
}

export function createLoop({
  step = 1 / 60,
  maxDelta = 0.25,
  simulate,
  render,
}: {
  step?: number
  maxDelta?: number
  simulate: (dt: number) => void
  render: (alpha: number, telemetry: LoopTelemetry) => void
}): GameLoop {
  let running = false
  let rafId = 0
  let lastTimestamp = 0
  let accumulator = 0

  let stepCounter = 0
  let frameCounter = 0
  let stepsPerSec = 0
  let framesPerSec = 0
  let frameDurationMs = 0
  let lastMeterUpdate = 0

  function frame(now: number): void {
    if (!running) return

    const rawDeltaMs = now - lastTimestamp
    lastTimestamp = now
    frameDurationMs = rawDeltaMs

    const elapsedSec = Math.min(Math.max(rawDeltaMs / 1000, 0), maxDelta)
    accumulator += elapsedSec

    while (accumulator >= step) {
      simulate(step)
      accumulator -= step
      stepCounter += 1
    }

    frameCounter += 1

    if (now - lastMeterUpdate >= 1000) {
      stepsPerSec = stepCounter
      framesPerSec = frameCounter
      stepCounter = 0
      frameCounter = 0
      lastMeterUpdate = now
    }

    const alpha = accumulator / step
    render(alpha, { stepsPerSec, framesPerSec, frameDurationMs })

    rafId = requestAnimationFrame(frame)
  }

  return {
    start(): void {
      if (running) return
      running = true
      const now = performance.now()
      lastTimestamp = now
      lastMeterUpdate = now
      accumulator = 0
      rafId = requestAnimationFrame(frame)
    },
    stop(): void {
      running = false
      cancelAnimationFrame(rafId)
    },
    isRunning(): boolean {
      return running
    },
  }
}
