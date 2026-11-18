export const PROTOCOL_VERSION = 1

export const WIRE_TYPE = Object.freeze({
  INPUT: 1,
  SNAPSHOT: 2,
  PING: 3,
  PONG: 4,
})

export const ENTITY_KIND = Object.freeze({
  SHIP: 1,
  BULLET: 2,
  ASTEROID: 3,
  PICKUP: 4,
})
