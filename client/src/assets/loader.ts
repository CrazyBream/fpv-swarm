export class HttpError extends Error {
  readonly status: number
  readonly url: string

  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`)
    this.name = 'HttpError'
    this.status = status
    this.url = url
  }
}

export interface AssetManifest {
  sprites: { sheet: string }
  audio: { shoot: string; hit: string; explode: string }
  arena: string
}

export interface LoadedAssets {
  sprites: Record<string, HTMLImageElement>
  audio: Record<string, AudioBuffer>
  arena: { targetAsteroidCount: number; gridStep: number } | null
  elapsedMs: number
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

export async function withRetry<T>(
  fn: (sig?: AbortSignal) => Promise<T>,
  {
    attempts = 3,
    baseMs = 180,
    signal,
  }: { attempts?: number; baseMs?: number; signal?: AbortSignal } = {},
): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i += 1) {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    }
    try {
      return await fn(signal)
    } catch (err: unknown) {
      lastError = err
      const errName = err instanceof Error ? err.name : ''
      if (errName === 'AbortError' || errName === 'TimeoutError') {
        throw err
      }
      if (err instanceof HttpError && err.status >= 400 && err.status < 500) {
        throw err
      }
      if (i < attempts - 1) {
        const expDelay = baseMs * 2 ** i
        const jitter = Math.random() * baseMs * 0.5
        await sleep(expDelay + jitter, signal)
      }
    }
  }
  throw lastError
}

export async function fetchJson<T>(
  url: string,
  { signal, timeoutMs = 2500 }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

  const response = await fetch(url, { signal: combinedSignal })
  if (!response.ok) {
    throw new HttpError(response.status, url)
  }
  return (await response.json()) as T
}

export function loadJson<T>(
  url: string,
  { signal, timeoutMs = 2500 }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<T> {
  return withRetry((sig) => fetchJson<T>(url, { signal: sig, timeoutMs }), { signal })
}

export function loadImage(
  src: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<HTMLImageElement> {
  return withRetry(
    (sig) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        if (sig?.aborted) {
          reject(sig.reason ?? new DOMException('Aborted', 'AbortError'))
          return
        }
        const img = new Image()
        const onAbort = (): void => {
          img.src = ''
          reject(sig?.reason ?? new DOMException('Aborted', 'AbortError'))
        }
        sig?.addEventListener('abort', onAbort, { once: true })

        img.onload = (): void => {
          sig?.removeEventListener('abort', onAbort)
          resolve(img)
        }
        img.onerror = (): void => {
          sig?.removeEventListener('abort', onAbort)
          reject(new HttpError(404, src))
        }
        img.src = src
      }),
    { signal },
  )
}

export async function loadAudio(
  audioContext: AudioContext,
  url: string,
  { signal }: { signal?: AbortSignal } = {},
): Promise<AudioBuffer> {
  return withRetry(
    async (sig) => {
      const response = await fetch(url, { signal: sig })
      if (!response.ok) {
        throw new HttpError(response.status, url)
      }
      const arrayBuffer = await response.arrayBuffer()
      return await audioContext.decodeAudioData(arrayBuffer)
    },
    { signal },
  )
}

export async function loadAll(
  manifestUrl: string,
  audioContext: AudioContext,
  {
    onProgress,
    signal,
  }: {
    onProgress?: (info: { completed: number; total: number; ratio: number; key: string }) => void
    signal?: AbortSignal
  } = {},
): Promise<LoadedAssets> {
  const startedAt = performance.now()
  const manifest = await loadJson<AssetManifest>(manifestUrl, { signal })

  let completed = 0
  const total = 5
  const bump = (key: string): void => {
    completed += 1
    onProgress?.({ completed, total, ratio: completed / total, key })
  }

  const [sheetRes, arenaRes, shootRes, hitRes, explodeRes] = await Promise.allSettled([
    loadImage(manifest.sprites.sheet, { signal }).then((v) => {
      bump('sheet')
      return v
    }),
    loadJson<{ targetAsteroidCount: number; gridStep: number }>(manifest.arena, { signal }).then(
      (v) => {
        bump('arena')
        return v
      },
    ),
    loadAudio(audioContext, manifest.audio.shoot, { signal }).then((v) => {
      bump('shoot')
      return v
    }),
    loadAudio(audioContext, manifest.audio.hit, { signal }).then((v) => {
      bump('hit')
      return v
    }),
    loadAudio(audioContext, manifest.audio.explode, { signal }).then((v) => {
      bump('explode')
      return v
    }),
  ])

  if (sheetRes.status === 'rejected') throw sheetRes.reason
  if (arenaRes.status === 'rejected') throw arenaRes.reason

  const results: LoadedAssets = {
    sprites: { sheet: sheetRes.value },
    audio: {},
    arena: arenaRes.value,
    elapsedMs: performance.now() - startedAt,
  }

  if (shootRes.status === 'fulfilled') results.audio.shoot = shootRes.value
  if (hitRes.status === 'fulfilled') results.audio.hit = hitRes.value
  if (explodeRes.status === 'fulfilled') results.audio.explode = explodeRes.value

  return results
}
