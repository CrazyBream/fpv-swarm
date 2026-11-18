export class Vector2 {
  readonly x: number
  readonly y: number

  constructor(x = 0, y = 0) {
    this.x = x
    this.y = y
  }

  static fromAngle(radians: number, length = 1): Vector2 {
    return new Vector2(Math.cos(radians) * length, Math.sin(radians) * length)
  }

  clone(): Vector2 {
    return new Vector2(this.x, this.y)
  }

  add(other: Readonly<{ x: number; y: number }>): Vector2 {
    return new Vector2(this.x + other.x, this.y + other.y)
  }

  sub(other: Readonly<{ x: number; y: number }>): Vector2 {
    return new Vector2(this.x - other.x, this.y - other.y)
  }

  scale(scalar: number): Vector2 {
    return new Vector2(this.x * scalar, this.y * scalar)
  }

  dot(other: Readonly<{ x: number; y: number }>): number {
    return this.x * other.x + this.y * other.y
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y
  }

  length(): number {
    return Math.hypot(this.x, this.y)
  }

  distanceTo(other: Readonly<{ x: number; y: number }>): number {
    return Math.hypot(this.x - other.x, this.y - other.y)
  }

  normalize(): Vector2 {
    const len = this.length()
    if (len < 1e-8) {
      return new Vector2(0, 0)
    }
    return new Vector2(this.x / len, this.y / len)
  }

  rotate(radians: number): Vector2 {
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    return new Vector2(this.x * cos - this.y * sin, this.x * sin + this.y * cos)
  }
}
