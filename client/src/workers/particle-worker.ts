export interface ParticleStepRequest {
  readonly dt: number
  readonly drag: number
  readonly buffer: ArrayBuffer
}

self.addEventListener('message', (event: MessageEvent<ParticleStepRequest>) => {
  const { dt, drag, buffer } = event.data
  const data = new Float32Array(buffer)
  const damp = Math.exp(-drag * dt)

  for (let i = 0; i < data.length; i += 4) {
    const vx = (data[i + 2] ?? 0) * damp
    const vy = (data[i + 3] ?? 0) * damp
    data[i] = (data[i] ?? 0) + vx * dt
    data[i + 1] = (data[i + 1] ?? 0) + vy * dt
    data[i + 2] = vx
    data[i + 3] = vy
  }
  ;(self as unknown as Worker).postMessage({ buffer }, [buffer])
})
