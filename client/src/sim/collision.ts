import type { Entity } from './entity.ts'

export function circlesOverlap(a: Entity, b: Entity): boolean {
  const sumRadii = a.radius + b.radius
  const dx = a.pos.x - b.pos.x
  const dy = a.pos.y - b.pos.y
  return dx * dx + dy * dy <= sumRadii * sumRadii
}

export function detectCollisions(entities: Iterable<Entity>): Array<[Entity, Entity]> {
  const active: Entity[] = []
  for (const entity of entities) {
    if (entity.alive && entity.kind !== 'explosion') {
      active.push(entity)
    }
  }

  const pairs: Array<[Entity, Entity]> = []
  const count = active.length

  for (let i = 0; i < count; i += 1) {
    const a = active[i]
    if (!a) continue
    for (let j = i + 1; j < count; j += 1) {
      const b = active[j]
      if (!b) continue
      if (circlesOverlap(a, b)) {
        pairs.push([a, b])
      }
    }
  }

  return pairs
}
