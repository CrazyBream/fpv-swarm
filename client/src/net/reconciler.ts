import {
  type EntityId,
  type Seq,
  type Snapshot,
  type SnapshotEntity,
  type Tick,
  asEntityId,
  asSeq,
  asTick,
} from '@fpv-swarm/shared/protocol.ts'
import { integrateStep } from '@fpv-swarm/shared/sim/kinematics.ts'

export interface BufferedInput {
  readonly seq: Seq
  readonly tick: Tick
  readonly thrust: number
  readonly turn: number
  readonly fire: boolean
  readonly dt: number
}

export class NetworkPredictor {
  localPlayerId: EntityId | null = null
  enablePrediction = true
  enableReconciliation = true
  enableInterpolation = true
  breakDeterminism = false
  interpDelayMs = 66

  seq: Seq = asSeq(0)
  pendingInputs: BufferedInput[] = []
  snapshots: Array<{ receivedAt: number; tick: Tick; entities: readonly SnapshotEntity[] }> = []

  predicted = { x: 640, y: 360, vx: 0, vy: 0, angle: -Math.PI / 2, hp: 100 }
  smoothOffset = { x: 0, y: 0 }

  lastCorrectionPx = 0
  lastSnapshotReceivedAt = 0
  serverTick: Tick = asTick(0)

  setLocalPlayer(id: number, x: number, y: number): void {
    this.localPlayerId = asEntityId(id)
    this.predicted.x = x
    this.predicted.y = y
    this.predicted.vx = 0
    this.predicted.vy = 0
    this.predicted.angle = -Math.PI / 2
    this.pendingInputs.length = 0
  }

  stepLocalInput(
    rawInput: { thrust: number; turn: number; fire: boolean },
    dt: number,
    arenaWidth: number,
    arenaHeight: number,
  ): BufferedInput {
    this.seq = asSeq(this.seq + 1)
    const cmd: BufferedInput = {
      seq: this.seq,
      tick: this.serverTick,
      thrust: rawInput.thrust,
      turn: rawInput.turn,
      fire: rawInput.fire,
      dt,
    }

    if (this.enablePrediction) {
      this.pendingInputs.push(cmd)
      if (this.pendingInputs.length > 120) {
        this.pendingInputs.shift()
      }
      integrateStep(this.predicted, cmd, dt, arenaWidth, arenaHeight, this.breakDeterminism)
    }

    this.smoothOffset.x *= Math.exp(-16 * dt)
    this.smoothOffset.y *= Math.exp(-16 * dt)

    return cmd
  }

  onServerSnapshot(snapshot: Snapshot, arenaWidth: number, arenaHeight: number): void {
    const now = performance.now()
    this.lastSnapshotReceivedAt = now
    this.serverTick = snapshot.tick

    this.snapshots.push({
      receivedAt: now,
      tick: snapshot.tick,
      entities: snapshot.entities,
    })
    if (this.snapshots.length > 30) {
      this.snapshots.shift()
    }

    if (!this.localPlayerId) return
    const authSelf = snapshot.entities.find((e) => e.kind === 'ship' && e.id === this.localPlayerId)
    if (!authSelf) return

    this.predicted.hp = authSelf.hp

    if (!this.enablePrediction) {
      this.predicted.x = authSelf.x
      this.predicted.y = authSelf.y
      this.predicted.vx = authSelf.vx
      this.predicted.vy = authSelf.vy
      this.predicted.angle = authSelf.angle
      this.pendingInputs.length = 0
      this.lastCorrectionPx = 0
      return
    }

    const beforeX = this.predicted.x + this.smoothOffset.x
    const beforeY = this.predicted.y + this.smoothOffset.y

    this.predicted.x = authSelf.x
    this.predicted.y = authSelf.y
    this.predicted.vx = authSelf.vx
    this.predicted.vy = authSelf.vy
    this.predicted.angle = authSelf.angle

    const ack = snapshot.lastProcessedSeq
    this.pendingInputs = this.pendingInputs.filter((inp) => inp.seq > ack)

    if (this.enableReconciliation) {
      for (const inp of this.pendingInputs) {
        integrateStep(this.predicted, inp, inp.dt, arenaWidth, arenaHeight, false)
      }
    } else {
      this.pendingInputs.length = 0
    }

    const errX = beforeX - this.predicted.x
    const errY = beforeY - this.predicted.y
    const dist = Math.hypot(errX, errY)
    this.lastCorrectionPx = dist

    if (dist > 0.5 && dist < 180) {
      this.smoothOffset.x = errX
      this.smoothOffset.y = errY
    } else {
      this.smoothOffset.x = 0
      this.smoothOffset.y = 0
    }
  }

  getVisualLocalPose(): { x: number; y: number; angle: number; hp: number } {
    return {
      x: this.predicted.x + this.smoothOffset.x,
      y: this.predicted.y + this.smoothOffset.y,
      angle: this.predicted.angle,
      hp: this.predicted.hp,
    }
  }

  getInterpolatedRemotes(): SnapshotEntity[] {
    const latest = this.snapshots[this.snapshots.length - 1]
    if (!latest) return []

    if (!this.enableInterpolation || this.snapshots.length < 2) {
      return latest.entities.filter((e) => !(e.kind === 'ship' && e.id === this.localPlayerId))
    }

    const renderTime = performance.now() - this.interpDelayMs
    let older = this.snapshots[0] ?? latest
    let newer = latest

    for (let i = this.snapshots.length - 1; i >= 1; i -= 1) {
      const candidateOlder = this.snapshots[i - 1]
      const candidateNewer = this.snapshots[i]
      if (candidateOlder && candidateNewer && candidateOlder.receivedAt <= renderTime) {
        older = candidateOlder
        newer = candidateNewer
        break
      }
    }

    const span = Math.max(1, newer.receivedAt - older.receivedAt)
    const t = Math.max(0, Math.min(1, (renderTime - older.receivedAt) / span))

    const results: SnapshotEntity[] = []
    for (const target of newer.entities) {
      if (target.kind === 'ship' && target.id === this.localPlayerId) {
        continue
      }
      const prev = older.entities.find((e) => e.id === target.id && e.kind === target.kind)
      if (!prev || Math.hypot(target.x - prev.x, target.y - prev.y) > 300) {
        results.push(target)
        continue
      }

      let da = target.angle - prev.angle
      if (da > Math.PI) da -= Math.PI * 2
      if (da < -Math.PI) da += Math.PI * 2

      results.push({
        ...target,
        x: prev.x + (target.x - prev.x) * t,
        y: prev.y + (target.y - prev.y) * t,
        angle: prev.angle + da * t,
      })
    }
    return results
  }
}
