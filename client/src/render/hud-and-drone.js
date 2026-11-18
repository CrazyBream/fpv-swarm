export function lerpValue(start, end, alpha) {
  return start + (end - start) * alpha
}

export function lerpRadians(fromAngle, toAngle, alpha) {
  const fullCircle = Math.PI * 2
  let diff = ((toAngle - fromAngle) % fullCircle) + fullCircle
  diff %= fullCircle
  if (diff > Math.PI) {
    diff -= fullCircle
  }
  return fromAngle + diff * alpha
}

export function interpolateEntity(entity, alpha) {
  return {
    x: lerpValue(entity.prevPos.x, entity.pos.x, alpha),
    y: lerpValue(entity.prevPos.y, entity.pos.y, alpha),
    angle: lerpRadians(entity.prevAngle, entity.angle, alpha),
  }
}

export function drawLoadingScreen(
  ctx,
  width,
  height,
  { ratio = 0, currentKey = '', error = null } = {},
) {
  ctx.fillStyle = '#070b10'
  ctx.fillRect(0, 0, width, height)

  const barWidth = Math.min(460, width * 0.75)
  const barHeight = 18
  const bx = (width - barWidth) * 0.5
  const by = height * 0.5

  ctx.fillStyle = '#10b981'
  ctx.font = 'bold 18px ui-monospace, SFMono-Regular, Consolas, monospace'
  ctx.textAlign = 'center'
  ctx.fillText('// INITIALIZING FPV SWARM ASSETS //', width * 0.5, by - 32)

  ctx.strokeStyle = error ? '#f43f5e' : '#10b981'
  ctx.lineWidth = 2
  ctx.strokeRect(bx, by, barWidth, barHeight)

  ctx.fillStyle = error ? '#f43f5e' : '#10b981'
  ctx.fillRect(bx + 3, by + 3, Math.max(0, (barWidth - 6) * ratio), barHeight - 6)

  ctx.fillStyle = '#cbd5e1'
  ctx.font = '14px ui-monospace, SFMono-Regular, Consolas, monospace'
  if (error) {
    ctx.fillStyle = '#fb7185'
    ctx.fillText(`LOAD FAILED: ${error}`, width * 0.5, by + 44)
  } else {
    ctx.fillText(
      `Loaded ${Math.round(ratio * 100)}% ${currentKey ? `[${currentKey}]` : ''}`,
      width * 0.5,
      by + 42,
    )
  }
  ctx.textAlign = 'left'
}

export function drawArenaGrid(ctx, width, height) {
  ctx.fillStyle = '#070b10'
  ctx.fillRect(0, 0, width, height)

  const cellSize = 80
  ctx.strokeStyle = 'rgba(16, 185, 129, 0.08)'
  ctx.lineWidth = 1

  ctx.beginPath()
  for (let x = 0; x <= width; x += cellSize) {
    ctx.moveTo(x + 0.5, 0)
    ctx.lineTo(x + 0.5, height)
  }
  for (let y = 0; y <= height; y += cellSize) {
    ctx.moveTo(0, y + 0.5)
    ctx.lineTo(width, y + 0.5)
  }
  ctx.stroke()

  ctx.strokeStyle = 'rgba(16, 185, 129, 0.22)'
  ctx.beginPath()
  for (let x = cellSize * 2; x < width; x += cellSize * 2) {
    for (let y = cellSize * 2; y < height; y += cellSize * 2) {
      ctx.moveTo(x - 4, y)
      ctx.lineTo(x + 4, y)
      ctx.moveTo(x, y - 4)
      ctx.lineTo(x, y + 4)
    }
  }
  ctx.stroke()
}

export function drawShip(ctx, drone, alpha, spriteSheet) {
  const pose = interpolateEntity(drone, alpha)

  ctx.save()
  ctx.translate(pose.x, pose.y)
  ctx.rotate(pose.angle)

  if (drone.thrust > 0) {
    ctx.fillStyle = 'rgba(16, 185, 129, 0.75)'
    ctx.beginPath()
    ctx.moveTo(-12, -4)
    ctx.lineTo(-26, 0)
    ctx.lineTo(-12, 4)
    ctx.closePath()
    ctx.fill()
  }

  if (spriteSheet) {
    ctx.drawImage(spriteSheet, 0, 0, 64, 64, -18, -18, 36, 36)
  }

  const motorMounts = [
    [-12, -12],
    [12, -12],
    [12, 12],
    [-12, 12],
  ]

  for (const [mx, my] of motorMounts) {
    ctx.save()
    ctx.translate(mx, my)
    ctx.rotate(drone.rotorSpin)
    ctx.strokeStyle = '#e2e8f0'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    ctx.moveTo(-5.5, 0)
    ctx.lineTo(5.5, 0)
    ctx.stroke()
    ctx.restore()
  }

  ctx.restore()
}

export function drawBullet(ctx, bullet, alpha, spriteSheet) {
  const pose = interpolateEntity(bullet, alpha)
  ctx.save()
  ctx.translate(pose.x, pose.y)
  ctx.rotate(pose.angle)

  if (spriteSheet && !bullet.homing) {
    ctx.drawImage(spriteSheet, 128, 0, 64, 64, -12, -12, 24, 24)
  } else {
    ctx.fillStyle = bullet.homing ? '#c084fc' : '#38bdf8'
    ctx.beginPath()
    ctx.arc(0, 0, bullet.radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export function drawAsteroid(ctx, asteroid, alpha, spriteSheet) {
  const pose = interpolateEntity(asteroid, alpha)
  ctx.save()
  ctx.translate(pose.x, pose.y)
  ctx.rotate(pose.angle)

  const isHoming = Boolean(asteroid.homing)
  if (spriteSheet && !isHoming) {
    const size = asteroid.radius * 2.2
    ctx.drawImage(spriteSheet, 64, 0, 64, 64, -size * 0.5, -size * 0.5, size, size)
  } else {
    ctx.strokeStyle = isHoming ? '#f43f5e' : '#f59e0b'
    ctx.fillStyle = isHoming ? 'rgba(244, 63, 94, 0.16)' : 'rgba(245, 158, 11, 0.12)'
    ctx.lineWidth = 2

    const sides = isHoming ? 6 : 8
    ctx.beginPath()
    for (let i = 0; i < sides; i += 1) {
      const a = (Math.PI * 2 * i) / sides
      const r = asteroid.radius * (i % 2 === 0 ? 1 : 0.82)
      const px = Math.cos(a) * r
      const py = Math.sin(a) * r
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }

  ctx.restore()
}

export function drawPickup(ctx, pickup, alpha) {
  const pose = interpolateEntity(pickup, alpha)
  ctx.save()
  ctx.translate(pose.x, pose.y)

  const effectType = pickup.pickupEffect?.type
  let color = '#22c55e'
  let label = '+HP'
  if (effectType === 'rapid_fire') {
    color = '#eab308'
    label = 'RPM'
  } else if (effectType === 'homing_ammo') {
    color = '#a855f7'
    label = 'AIM'
  }

  const r = pickup.radius + Math.sin(pickup.pulse) * 2
  ctx.strokeStyle = color
  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = color
  ctx.font = 'bold 10px ui-monospace, monospace'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, 0, 0)
  ctx.restore()
}

export function drawExplosion(ctx, explosion) {
  const ratio = Math.max(0, explosion.ttl / explosion.maxTtl)
  ctx.save()
  ctx.globalAlpha = ratio
  ctx.fillStyle = explosion.color
  for (const p of explosion.particles) {
    ctx.beginPath()
    ctx.arc(p.pos.x, p.pos.y, p.size, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

export function drawWorld(ctx, world, alpha, assets) {
  const sheet = assets?.sprites?.sheet
  drawArenaGrid(ctx, world.width, world.height)

  for (const pickup of world.ofKind('pickup')) {
    drawPickup(ctx, pickup, alpha)
  }
  for (const asteroid of world.ofKind('asteroid')) {
    drawAsteroid(ctx, asteroid, alpha, sheet)
  }
  for (const bullet of world.ofKind('bullet')) {
    drawBullet(ctx, bullet, alpha, sheet)
  }
  for (const ship of world.ofKind('ship')) {
    if (ship.alive) {
      drawShip(ctx, ship, alpha, sheet)
    }
  }
  for (const explosion of world.ofKind('explosion')) {
    drawExplosion(ctx, explosion)
  }
}

export function drawHud(ctx, telemetry, world, lastScoreDelta = 0) {
  const player = world.player
  const speed = player?.alive ? Math.round(player.vel.length()) : 0
  const hp = player ? player.hp : 0

  ctx.save()
  ctx.fillStyle = 'rgba(7, 11, 16, 0.85)'
  ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)'
  ctx.lineWidth = 1
  ctx.fillRect(18, 18, 420, 178)
  ctx.strokeRect(18, 18, 420, 178)

  ctx.fillStyle = '#10b981'
  ctx.font = 'bold 14px ui-monospace, SFMono-Regular, Consolas, monospace'
  const bonusTag = lastScoreDelta > 0 ? ` (+${lastScoreDelta})` : ''
  ctx.fillText(`${world.callsign} // ${world.roomName} // SCORE: ${world.score}${bonusTag}`, 30, 40)

  ctx.fillStyle = '#f1f5f9'
  ctx.font = '13px ui-monospace, SFMono-Regular, Consolas, monospace'
  ctx.fillText(
    `steps/s: ${telemetry.stepsPerSec} | frames/s: ${telemetry.framesPerSec} | ${telemetry.frameDurationMs.toFixed(1)} ms`,
    30,
    64,
  )
  ctx.fillText(`HP: ${hp}/100 | speed: ${speed} px/s | entities: ${world.size}`, 30, 86)

  ctx.fillStyle = '#1e293b'
  ctx.fillRect(30, 96, 220, 10)
  ctx.fillStyle = hp > 35 ? '#10b981' : '#f43f5e'
  ctx.fillRect(30, 96, (hp / 100) * 220, 10)

  let statusText = 'STATUS: ACTIVE (WEB AUDIO ONLINE)'
  if (player && !player.alive) {
    statusText = `RESPAWN IN: ${world.respawnTimer.toFixed(1)}s`
  } else if (player && player.homingAmmoTimer > 0) {
    statusText = `HOMING AMMO: ${player.homingAmmoTimer.toFixed(1)}s`
  } else if (player && player.overclockTimer > 0) {
    statusText = `RAPID FIRE: ${player.overclockTimer.toFixed(1)}s`
  }

  ctx.fillStyle = '#38bdf8'
  ctx.fillText(statusText, 30, 126)

  ctx.fillStyle = '#94a3b8'
  ctx.font = '12px ui-monospace, SFMono-Regular, Consolas, monospace'
  ctx.fillText('WASD: Fly | Space / Click: Fire | P: Pause | Esc: Exit', 30, 152)
  ctx.fillText('Pickups: [RPM] Rapid Fire [AIM] Homing [+HP] Repair', 30, 174)
  ctx.restore()
}
