import { Vector2 } from './vector.ts'

export interface WrappableEntity {
  pos: Vector2
  prevPos: Vector2
}

export function wrapAxis(coord: number, maxBound: number): number {
  if (maxBound <= 0) return coord
  return ((coord % maxBound) + maxBound) % maxBound
}

export function wrapPosition(entity: WrappableEntity, width: number, height: number): void {
  const nx = wrapAxis(entity.pos.x, width)
  const ny = wrapAxis(entity.pos.y, height)
  if (nx !== entity.pos.x || ny !== entity.pos.y) {
    entity.pos = new Vector2(nx, ny)
  }
}

export function syncWrapForInterpolation(
  entity: WrappableEntity,
  width: number,
  height: number,
): void {
  let px = entity.prevPos.x
  let py = entity.prevPos.y
  if (Math.abs(entity.pos.x - px) > width * 0.5) {
    px += entity.pos.x > px ? width : -width
  }
  if (Math.abs(entity.pos.y - py) > height * 0.5) {
    py += entity.pos.y > py ? height : -height
  }
  if (px !== entity.prevPos.x || py !== entity.prevPos.y) {
    entity.prevPos = new Vector2(px, py)
  }
}
