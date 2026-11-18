import type { Bus, GameEvents } from '../events/bus.ts'

export function createSoundEngine() {
  const ctx = new window.AudioContext()
  const buffers = new Map<string, AudioBuffer>()

  function unlock(): void {
    if (ctx.state === 'suspended') {
      void ctx.resume()
    }
  }

  function setBuffers(loadedAudioMap: Record<string, AudioBuffer>): void {
    for (const [name, buf] of Object.entries(loadedAudioMap)) {
      if (buf) buffers.set(name, buf)
    }
  }

  function play(name: string, { gain = 0.25, playbackRate = 1.0 } = {}): void {
    if (ctx.state !== 'running') return
    const buffer = buffers.get(name)
    if (!buffer) return

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = playbackRate

    const gainNode = ctx.createGain()
    gainNode.gain.value = gain

    source.connect(gainNode)
    gainNode.connect(ctx.destination)
    source.start(0)
  }

  function bindToWorld(eventBus: Bus<GameEvents>): void {
    eventBus.on('fired', () => {
      play('shoot', { gain: 0.18, playbackRate: 0.95 + Math.random() * 0.12 })
    })
    eventBus.on('hit', () => {
      play('hit', { gain: 0.24, playbackRate: 0.9 + Math.random() * 0.2 })
    })
    eventBus.on('exploded', () => {
      play('explode', { gain: 0.35, playbackRate: 0.85 + Math.random() * 0.2 })
    })
  }

  return {
    ctx,
    unlock,
    setBuffers,
    play,
    bindToWorld,
  }
}
