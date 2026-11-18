export interface ViewportBounds {
  width: number
  height: number
  dpr: number
}

export function setupViewport(
  canvas: HTMLCanvasElement,
  onResize?: (bounds: ViewportBounds) => void,
) {
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas 2D context unavailable')
  }

  const bounds: ViewportBounds = {
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: Math.min(window.devicePixelRatio || 1, 2),
  }

  function updateSize(): void {
    bounds.width = window.innerWidth
    bounds.height = window.innerHeight
    bounds.dpr = Math.min(window.devicePixelRatio || 1, 2)

    canvas.width = Math.floor(bounds.width * bounds.dpr)
    canvas.height = Math.floor(bounds.height * bounds.dpr)
    canvas.style.width = `${bounds.width}px`
    canvas.style.height = `${bounds.height}px`

    ctx?.setTransform(bounds.dpr, 0, 0, bounds.dpr, 0, 0)
    onResize?.(bounds)
  }

  updateSize()
  window.addEventListener('resize', updateSize)

  return {
    ctx,
    bounds,
    destroy(): void {
      window.removeEventListener('resize', updateSize)
    },
  }
}
