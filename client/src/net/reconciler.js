import { ENTITY_KIND } from '@fpv-swarm/shared/protocol/messages.js'
import { integrateStep } from '@fpv-swarm/shared/sim/kinematics.js'

export class NetworkPredictor {
  constructor() {
    this.localPlayerId = null
    this.enablePrediction = true
    this.enableReconciliation = true
    this.enableInterpolation = true
    this.breakDeterminism = false
    this.interpDelayMs = 66

    this.seq = 0
    this.pendingInputs = []
    this.snapshots = []

    this.predicted = { x: 640, y: 360, vx: 0, vy: 0, angle: -Math.PI / 2, hp: 100 }
    this.smoothOffset = { x: 0, y: 0 }

    this.lastCorrectionPx = 0
    this.lastSnapshotReceivedAt = 0
    this.serverTick = 0
  }

  setLocalPlayer(id, x, y) {
    this.localPlayerId = id
    this.predicted.x = x
    this.predicted.y = y
    this.predicted.vx = 0
    this.predicted.vy = 0
    this.predicted.angle = -Math.PI / 2
    this.pendingInputs.length = 0
  }

  stepLocalInput(rawInput, dt, arenaWidth, arenaHeight) {
    this.seq += 1
    const cmd = {
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

  onServerSnapshot(snapshot, arenaWidth, arenaHeight) {
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
    const authSelf = snapshot.entities.find(
      (e) => e.kind === ENTITY_KIND.SHIP && e.id === this.localPlayerId,
    )
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

    const ack = snapshot.lastProcessedSeq ?? 0
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

  getVisualLocalPose() {
    return {
      x: this.predicted.x + this.smoothOffset.x,
      y: this.predicted.y + this.smoothOffset.y,
      angle: this.predicted.angle,
      hp: this.predicted.hp,
    }
  }

  getInterpolatedRemotes() {
    if (this.snapshots.length === 0) return []
    const latest = this.snapshots[this.snapshots.length - 1]

    if (!this.enableInterpolation || this.snapshots.length < 2) {
      return latest.entities.filter(
        (e) => !(e.kind === ENTITY_KIND.SHIP && e.id === this.localPlayerId),
      )
    }

    const renderTime = performance.now() - this.interpDelayMs
    let older = this.snapshots[0]
    let newer = latest

    for (let i = this.snapshots.length - 1; i >= 1; i -= 1) {
      if (this.snapshots[i - 1].receivedAt <= renderTime) {
        older = this.snapshots[i - 1]
        newer = this.snapshots[i]
        break
      }
    }

    const span = Math.max(1, newer.receivedAt - older.receivedAt)
    const t = Math.max(0, Math.min(1, (renderTime - older.receivedAt) / span))

    const results = []
    for (const target of newer.entities) {
      if (target.kind === ENTITY_KIND.SHIP && target.id === this.localPlayerId) {
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
