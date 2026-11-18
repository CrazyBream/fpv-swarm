export interface LoopTelemetry {
  readonly stepsPerSec: number
  readonly framesPerSec: number
  readonly frameDurationMs: number
  readonly p50Ms: number
  readonly p95Ms: number
  readonly p99Ms: number
}

export interface GameLoop {
  start(): void
  stop(): void
  isRunning(): boolean
}

function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0
  const sorted = [...samples].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)))
  return sorted[idx] ?? 0
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

  const frameSamples: number[] = []
  let p50Ms = 0
  let p95Ms = 0
  let p99Ms = 0

  function frame(now: number): void {
    if (!running) return

    const rawDeltaMs = now - lastTimestamp
    lastTimestamp = now
    frameDurationMs = rawDeltaMs

    if (rawDeltaMs > 0 && rawDeltaMs < 250) {
      frameSamples.push(rawDeltaMs)
      if (frameSamples.length > 240) {
        frameSamples.shift()
      }
    }

    const elapsedSec = Math.min(Math.max(rawDeltaMs / 1000, 0), maxDelta)
    accumulator += elapsedSec

    performance.mark('simulate:start')
    while (accumulator >= step) {
      simulate(step)
      accumulator -= step
      stepCounter += 1
    }
    performance.mark('simulate:end')
    performance.measure('simulate', 'simulate:start', 'simulate:end')

    frameCounter += 1

    if (now - lastMeterUpdate >= 1000) {
      stepsPerSec = stepCounter
      framesPerSec = frameCounter
      stepCounter = 0
      frameCounter = 0
      lastMeterUpdate = now
      p50Ms = percentile(frameSamples, 50)
      p95Ms = percentile(frameSamples, 95)
      p99Ms = percentile(frameSamples, 99)
    }

    const alpha = accumulator / step
    performance.mark('render:start')
    render(alpha, { stepsPerSec, framesPerSec, frameDurationMs, p50Ms, p95Ms, p99Ms })
    performance.mark('render:end')
    performance.measure('render', 'render:start', 'render:end')

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
