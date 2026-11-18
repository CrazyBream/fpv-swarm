export interface KinematicState {
  x: number
  y: number
  vx: number
  vy: number
  angle: number
}

export interface StepInputCommand {
  readonly thrust?: number
  readonly turn?: number
  readonly fire?: boolean
}

export const SHARED_DRONE_SPECS = {
  yawRate: 4.4,
  forwardThrust: 640,
  reverseThrust: 300,
  airDrag: 1.55,
  terminalSpeed: 440,
  muzzleSpeed: 540,
  baseCooldown: 0.22,
  arenaWidth: 1280,
  arenaHeight: 720,
} as const

export function clampAxisWrap(coord: number, maxBound: number): number {
  if (maxBound <= 0) return coord
  return ((coord % maxBound) + maxBound) % maxBound
}

export function integrateStep<T extends KinematicState>(
  state: T,
  inputCmd: StepInputCommand,
  dt: number,
  arenaWidth: number = SHARED_DRONE_SPECS.arenaWidth,
  arenaHeight: number = SHARED_DRONE_SPECS.arenaHeight,
  breakDeterminism = false,
): T {
  const turn = Math.max(-1, Math.min(1, Number(inputCmd.turn) || 0))
  const thrust = Math.max(-1, Math.min(1, Number(inputCmd.thrust) || 0))

  state.angle += turn * SHARED_DRONE_SPECS.yawRate * dt
  if (breakDeterminism) {
    state.angle += (Math.random() - 0.5) * 0.28
  }

  let accel = 0
  if (thrust > 0) {
    accel = SHARED_DRONE_SPECS.forwardThrust * thrust
  } else if (thrust < 0) {
    accel = SHARED_DRONE_SPECS.reverseThrust * thrust
  }

  if (accel !== 0) {
    state.vx += Math.cos(state.angle) * accel * dt
    state.vy += Math.sin(state.angle) * accel * dt
  }

  const dragFactor = Math.exp(-SHARED_DRONE_SPECS.airDrag * dt)
  state.vx *= dragFactor
  state.vy *= dragFactor

  const speed = Math.hypot(state.vx, state.vy)
  if (speed > SHARED_DRONE_SPECS.terminalSpeed) {
    const ratio = SHARED_DRONE_SPECS.terminalSpeed / speed
    state.vx *= ratio
    state.vy *= ratio
  }

  state.x = clampAxisWrap(state.x + state.vx * dt, arenaWidth)
  state.y = clampAxisWrap(state.y + state.vy * dt, arenaHeight)
  return state
}
