export class ObjectPool<T> {
  readonly #free: T[] = []
  readonly #factory: () => T
  readonly #reset: (item: T) => void
  #totalCreated = 0
  #reusedCount = 0

  constructor(factory: () => T, reset: (item: T) => void, initialSize = 0) {
    this.#factory = factory
    this.#reset = reset
    for (let i = 0; i < initialSize; i += 1) {
      this.#totalCreated += 1
      this.#free.push(this.#factory())
    }
  }

  acquire(): T {
    const existing = this.#free.pop()
    if (existing !== undefined) {
      this.#reusedCount += 1
      return existing
    }
    this.#totalCreated += 1
    return this.#factory()
  }

  release(item: T): void {
    this.#reset(item)
    this.#free.push(item)
  }

  get available(): number {
    return this.#free.length
  }

  get totalCreated(): number {
    return this.#totalCreated
  }

  get reusedCount(): number {
    return this.#reusedCount
  }
}
