import {
  type EntityId,
  type InputMessage,
  type TurnAxis,
  asEntityId,
  asSeq,
} from '@fpv-swarm/shared/protocol.ts'
import type { Match, ServerShip } from './match.ts'

export class BotController {
  readonly id: EntityId
  readonly name: string
  #seq = 0
  #strafeTimer = 0
  #preferredTurn: TurnAxis = 1

  constructor(id: EntityId, name: string) {
    this.id = id
    this.name = name
  }

  computeNextInput(match: Match, dt: number): InputMessage {
    this.#seq += 1
    this.#strafeTimer -= dt
    if (this.#strafeTimer <= 0) {
      this.#strafeTimer = 1.2 + (this.id % 3) * 0.4
      this.#preferredTurn = this.#preferredTurn === 1 ? -1 : 1
    }

    const self = match.ships.get(this.id)
    if (!self) {
      return {
        v: 1,
        type: 'input',
        seq: asSeq(this.#seq),
        tick: match.tick,
        thrust: 0,
        turn: 0,
        fire: false,
      }
    }

    let closestTarget: ServerShip | null = null
    let minDist = Number.POSITIVE_INFINITY

    for (const candidate of match.ships.values()) {
      if (candidate.id === this.id) continue
      const d = Math.hypot(candidate.x - self.x, candidate.y - self.y)
      if (d < minDist) {
        minDist = d
        closestTarget = candidate
      }
    }

    if (!closestTarget) {
      return {
        v: 1,
        type: 'input',
        seq: asSeq(this.#seq),
        tick: match.tick,
        thrust: 1,
        turn: this.#preferredTurn,
        fire: this.#seq % 15 === 0,
      }
    }

    const desiredAngle = Math.atan2(closestTarget.y - self.y, closestTarget.x - self.x)
    let angleDiff = desiredAngle - self.angle
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2

    let turn: TurnAxis = 0
    if (angleDiff > 0.12) turn = 1
    else if (angleDiff < -0.12) turn = -1

    const thrust: TurnAxis = minDist < 95 ? -1 : 1
    const fire = Math.abs(angleDiff) < 0.35 && minDist < 520

    return {
      v: 1,
      type: 'input',
      seq: asSeq(this.#seq),
      tick: match.tick,
      thrust,
      turn,
      fire,
    }
  }
}

export function createBotId(index: number): EntityId {
  return asEntityId(200 + index)
}
