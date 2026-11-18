export function circlesOverlap(a, b) {
  const dx = a.pos.x - b.pos.x
  const dy = a.pos.y - b.pos.y
  const rSum = a.radius + b.radius
  return dx * dx + dy * dy <= rSum * rSum
}

export function detectCollisions(world) {
  const pairs = []
  const list = []
  for (const entity of world) {
    if (entity.alive && entity.kind !== 'explosion') {
      list.push(entity)
    }
  }

  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i]
      const b = list[j]
      if (circlesOverlap(a, b)) {
        pairs.push([a, b])
      }
    }
  }
  return pairs
}
