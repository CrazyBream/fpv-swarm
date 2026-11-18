const TRACKED_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'KeyJ',
  'KeyP',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'Escape',
])

export interface InputController {
  isDown(code: string): boolean
  justPressed(code: string): boolean
  clearFrameEdges(): void
  destroy(): void
}

export function createInput(target: Window = window): InputController {
  const heldKeys = new Set<string>()
  const pressedThisFrame = new Set<string>()

  function handleKeyDown(event: KeyboardEvent): void {
    const el = event.target as HTMLElement | null // Safe DOM EventTarget narrowing to check input elements
    if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA') {
      return
    }
    if (TRACKED_CODES.has(event.code)) {
      event.preventDefault()
    }
    if (!heldKeys.has(event.code)) {
      pressedThisFrame.add(event.code)
    }
    heldKeys.add(event.code)
  }

  function handleKeyUp(event: KeyboardEvent): void {
    heldKeys.delete(event.code)
  }

  function handleBlur(): void {
    heldKeys.clear()
    pressedThisFrame.clear()
  }

  target.addEventListener('keydown', handleKeyDown)
  target.addEventListener('keyup', handleKeyUp)
  target.addEventListener('blur', handleBlur)

  return {
    isDown(code: string): boolean {
      return heldKeys.has(code)
    },
    justPressed(code: string): boolean {
      return pressedThisFrame.has(code)
    },
    clearFrameEdges(): void {
      pressedThisFrame.clear()
    },
    destroy(): void {
      target.removeEventListener('keydown', handleKeyDown)
      target.removeEventListener('keyup', handleKeyUp)
      target.removeEventListener('blur', handleBlur)
      heldKeys.clear()
      pressedThisFrame.clear()
    },
  }
}
