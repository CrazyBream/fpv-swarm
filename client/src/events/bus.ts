import type { EntityId } from '@fpv-swarm/shared/protocol.ts'

export type GameEvents = {
  fired: { readonly bulletId: EntityId }
  hit: { readonly x: number; readonly y: number }
  exploded: { readonly x: number; readonly y: number }
  scoreChanged: { readonly score: number; readonly delta: number }
}

export class Bus<E extends Record<string, unknown>> {
  #listeners = new Map<keyof E, Set<(payload: never) => void>>()

  on<K extends keyof E>(name: K, fn: (payload: E[K]) => void): () => void {
    let set = this.#listeners.get(name)
    if (!set) {
      set = new Set()
      this.#listeners.set(name, set)
    }
    set.add(fn as (payload: never) => void)
    return () => {
      set?.delete(fn as (payload: never) => void)
    }
  }

  emit<K extends keyof E>(name: K, payload: E[K]): void {
    const set = this.#listeners.get(name)
    if (!set) return
    for (const fn of set) {
      ;(fn as (arg: E[K]) => void)(payload)
    }
  }
}
