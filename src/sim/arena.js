export function wrapPosition(body, arenaWidth, arenaHeight) {
    if (arenaWidth <= 0 || arenaHeight <= 0) return
    body.x = ((body.x % arenaWidth) + arenaWidth) % arenaWidth
    body.y = ((body.y % arenaHeight) + arenaHeight) % arenaHeight
}

export function syncWrapForInterpolation(prevState, currState, arenaWidth, arenaHeight) {
    if (Math.abs(currState.x - prevState.x) > arenaWidth * 0.5) {
        prevState.x = currState.x
    }
    if (Math.abs(currState.y - prevState.y) > arenaHeight * 0.5) {
        prevState.y = currState.y
    }
}