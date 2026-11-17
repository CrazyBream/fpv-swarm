export const DRONE_SPECS = {
    yawRate: 4.4,        // рад/с — висока кутова швидкість повороту FPV-дрона
    forwardThrust: 640,  // пкс/с² — потужний ривок вперед
    reverseThrust: 300,  // пкс/с² — гальмування/задній хід
    airDrag: 1.55,       // опір повітря для контрольованого входження в повороти
    terminalSpeed: 440,  // пкс/с — максимальна швидкість
}

export function createDrone(x = 0, y = 0, angle = -Math.PI / 2) {
    return {
        x,
        y,
        vx: 0,
        vy: 0,
        angle,
        thrust: 0,
        rotorSpin: 0,
    }
}

export function snapshotDrone(drone) {
    return {
        x: drone.x,
        y: drone.y,
        vx: drone.vx,
        vy: drone.vy,
        angle: drone.angle,
        thrust: drone.thrust,
        rotorSpin: drone.rotorSpin,
    }
}

/**
 * Чиста функція фізичного кроку: приймає стан корабля/дрона, ввід і dt.
 * Не використовує DOM чи Canvas.
 */
export function integrate(ship, input, dt) {
    const turnLeft = input.isDown('KeyA') || input.isDown('ArrowLeft')
    const turnRight = input.isDown('KeyD') || input.isDown('ArrowRight')
    const throttleUp = input.isDown('KeyW') || input.isDown('ArrowUp')
    const throttleBack = input.isDown('KeyS') || input.isDown('ArrowDown')

    const yawInput = (turnRight ? 1 : 0) - (turnLeft ? 1 : 0)
    ship.angle += yawInput * DRONE_SPECS.yawRate * dt

    let accel = 0
    if (throttleUp) {
        accel = DRONE_SPECS.forwardThrust
    } else if (throttleBack) {
        accel = -DRONE_SPECS.reverseThrust
    }
    ship.thrust = accel

    if (accel !== 0) {
        ship.vx += Math.cos(ship.angle) * accel * dt
        ship.vy += Math.sin(ship.angle) * accel * dt
    }

    // Експоненційне загасання швидкості через опір повітря
    const dragFactor = Math.exp(-DRONE_SPECS.airDrag * dt)
    ship.vx *= dragFactor
    ship.vy *= dragFactor

    const currentSpeed = Math.hypot(ship.vx, ship.vy)
    if (currentSpeed > DRONE_SPECS.terminalSpeed) {
        const ratio = DRONE_SPECS.terminalSpeed / currentSpeed
        ship.vx *= ratio
        ship.vy *= ratio
    }

    ship.x += ship.vx * dt
    ship.y += ship.vy * dt

    const spinRate = accel !== 0 ? 42 : 16
    ship.rotorSpin = (ship.rotorSpin + spinRate * dt) % (Math.PI * 2)

    return ship
}