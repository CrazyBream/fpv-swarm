export function mulberry32(seed) {
  let state = seed >>> 0
  return function nextRandom() {
    state = (state + 0x6d2b79f5) >>> 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashShipState(state) {
  const qx = Math.round(state.x * 1000)
  const qy = Math.round(state.y * 1000)
  const qvx = Math.round(state.vx * 1000)
  const qvy = Math.round(state.vy * 1000)
  const qa = Math.round(state.angle * 10000)
  let h = 2166136261 >>> 0
  for (const val of [qx, qy, qvx, qvy, qa]) {
    h ^= val & 0xffffffff
    h = Math.imul(h, 16777619) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
