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

export function blendDroneState(prev, curr, alpha) {
    return {
        x: lerpValue(prev.x, curr.x, alpha),
        y: lerpValue(prev.y, curr.y, alpha),
        vx: curr.vx,
        vy: curr.vy,
        angle: lerpRadians(prev.angle, curr.angle, alpha),
        thrust: curr.thrust,
        rotorSpin: curr.rotorSpin,
    }
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

    // Тактичні хрестики на перетинах великих квадратів
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

export function drawShip(ctx, drone) {
    ctx.save()
    ctx.translate(drone.x, drone.y)
    ctx.rotate(drone.angle)

    // Тепловий слід позаду при активній тязі вперед
    if (drone.thrust > 0) {
        ctx.fillStyle = 'rgba(16, 185, 129, 0.75)'
        ctx.beginPath()
        ctx.moveTo(-12, -4)
        ctx.lineTo(-26, 0)
        ctx.lineTo(-12, 4)
        ctx.closePath()
        ctx.fill()
    }

    // Карбонові промені рами (X-frame)
    ctx.strokeStyle = '#64748b'
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(-12, -12)
    ctx.lineTo(12, 12)
    ctx.moveTo(12, -12)
    ctx.lineTo(-12, 12)
    ctx.stroke()

    // 4 моторні бази з обертовими лопатями
    const motorMounts = [
        [-12, -12],
        [12, -12],
        [12, 12],
        [-12, 12],
    ]

    for (const [mx, my] of motorMounts) {
        ctx.save()
        ctx.translate(mx, my)

        // Захисний кожух (prop guard)
        ctx.strokeStyle = '#10b981'
        ctx.fillStyle = 'rgba(16, 185, 129, 0.12)'
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.arc(0, 0, 7, 0, Math.PI * 2)
        ctx.fill()
        ctx.stroke()

        // Лопать ротора
        ctx.rotate(drone.rotorSpin)
        ctx.strokeStyle = '#e2e8f0'
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(-5.5, 0)
        ctx.lineTo(5.5, 0)
        ctx.stroke()

        ctx.restore()
    }

    // Центральна дека (акумулятор та польотний стек)
    ctx.fillStyle = '#1e293b'
    ctx.strokeStyle = '#94a3b8'
    ctx.lineWidth = 1.2
    ctx.beginPath()
    ctx.rect(-8, -5, 16, 10)
    ctx.fill()
    ctx.stroke()

    // Курсова FPV-камера спереду (дивиться вздовж осі +X)
    ctx.fillStyle = '#38bdf8'
    ctx.beginPath()
    ctx.arc(8, 0, 2.5, 0, Math.PI * 2)
    ctx.fill()

    ctx.restore()
}

export function drawHud(ctx, telemetry, drone) {
    const groundSpeed = Math.round(Math.hypot(drone.vx, drone.vy))

    ctx.save()
    ctx.fillStyle = 'rgba(7, 11, 16, 0.82)'
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)'
    ctx.lineWidth = 1
    ctx.fillRect(18, 18, 360, 124)
    ctx.strokeRect(18, 18, 360, 124)

    ctx.fillStyle = '#10b981'
    ctx.font = 'bold 14px ui-monospace, SFMono-Regular, Consolas, monospace'
    ctx.fillText('FPV OSD // TELEMETRY', 30, 40)

    ctx.fillStyle = '#f1f5f9'
    ctx.font = '14px ui-monospace, SFMono-Regular, Consolas, monospace'
    ctx.fillText(`steps/s  : ${telemetry.stepsPerSec}`, 30, 64)
    ctx.fillText(`frames/s : ${telemetry.framesPerSec}`, 30, 84)
    ctx.fillText(
        `frame ms : ${telemetry.frameDurationMs.toFixed(2)} ms | ${groundSpeed} px/s`,
        30,
        104,
    )

    ctx.fillStyle = '#94a3b8'
    ctx.font = '12px ui-monospace, SFMono-Regular, Consolas, monospace'
    ctx.fillText('WASD / Arrows: Fly  |  Space: Pause', 30, 128)
    ctx.restore()
}