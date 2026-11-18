export function wrapPosition(entity, arenaWidth, arenaHeight) {
  if (arenaWidth <= 0 || arenaHeight <= 0) return
  entity.pos.x = ((entity.pos.x % arenaWidth) + arenaWidth) % arenaWidth
  entity.pos.y = ((entity.pos.y % arenaHeight) + arenaHeight) % arenaHeight
}

export function syncWrapForInterpolation(entity, arenaWidth, arenaHeight) {
  if (Math.abs(entity.pos.x - entity.prevPos.x) > arenaWidth * 0.5) {
    entity.prevPos.x = entity.pos.x
  }
  if (Math.abs(entity.pos.y - entity.prevPos.y) > arenaHeight * 0.5) {
    entity.prevPos.y = entity.pos.y
  }
}
