export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} for ${url}`)
    this.name = 'HttpError'
    this.status = status
    this.url = url
  }
}

function sleep(ms, signal) {
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

export async function withRetry(fn, { attempts = 3, baseMs = 180, signal } = {}) {
  let lastError
  for (let i = 0; i < attempts; i += 1) {
    if (signal?.aborted) {
      throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    }
    try {
      return await fn(signal)
    } catch (err) {
      lastError = err
      if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
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

export async function fetchJson(url, { signal, timeoutMs = 2500 } = {}) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

  const response = await fetch(url, { signal: combinedSignal })
  if (!response.ok) {
    throw new HttpError(response.status, url)
  }
  return await response.json()
}

export function loadJson(url, { signal, timeoutMs = 2500 } = {}) {
  return withRetry((sig) => fetchJson(url, { signal: sig, timeoutMs }), {
    signal,
  })
}

export function loadImage(src, { signal } = {}) {
  return withRetry(
    (sig) =>
      new Promise((resolve, reject) => {
        if (sig?.aborted) {
          reject(sig.reason ?? new DOMException('Aborted', 'AbortError'))
          return
        }
        const img = new Image()
        const onAbort = () => {
          img.src = ''
          reject(sig.reason ?? new DOMException('Aborted', 'AbortError'))
        }
        sig?.addEventListener('abort', onAbort, { once: true })

        img.onload = () => {
          sig?.removeEventListener('abort', onAbort)
          resolve(img)
        }
        img.onerror = () => {
          sig?.removeEventListener('abort', onAbort)
          reject(new HttpError(404, src))
        }
        img.src = src
      }),
    { signal },
  )
}

export async function loadAudio(audioContext, url, { signal } = {}) {
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
  manifestUrl,
  audioContext,
  { onProgress, signal, mode = 'concurrent' } = {},
) {
  const startedAt = performance.now()
  const manifest = await loadJson(manifestUrl, { signal })

  const tasks = [
    {
      key: 'sheet',
      kind: 'sprite',
      critical: true,
      run: () => loadImage(manifest.sprites.sheet, { signal }),
    },
    {
      key: 'arena',
      kind: 'config',
      critical: true,
      run: () => loadJson(manifest.arena, { signal }),
    },
    {
      key: 'shoot',
      kind: 'audio',
      critical: false,
      run: () => loadAudio(audioContext, manifest.audio.shoot, { signal }),
    },
    {
      key: 'hit',
      kind: 'audio',
      critical: false,
      run: () => loadAudio(audioContext, manifest.audio.hit, { signal }),
    },
    {
      key: 'explode',
      kind: 'audio',
      critical: false,
      run: () => loadAudio(audioContext, manifest.audio.explode, { signal }),
    },
  ]

  let completed = 0
  const total = tasks.length
  const results = { sprites: {}, audio: {}, arena: null, elapsedMs: 0 }

  const trackTask = async (task) => {
    const val = await task.run()
    completed += 1
    onProgress?.({ completed, total, ratio: completed / total, key: task.key })
    return { task, val }
  }

  if (mode === 'sequential') {
    for (const task of tasks) {
      const { val } = await trackTask(task)
      if (task.kind === 'sprite') results.sprites[task.key] = val
      else if (task.kind === 'audio') results.audio[task.key] = val
      else results.arena = val
    }
  } else {
    const settled = await Promise.allSettled(tasks.map((t) => trackTask(t)))
    for (let i = 0; i < settled.length; i += 1) {
      const outcome = settled[i]
      const task = tasks[i]
      if (outcome.status === 'fulfilled') {
        const { val } = outcome.value
        if (task.kind === 'sprite') results.sprites[task.key] = val
        else if (task.kind === 'audio') results.audio[task.key] = val
        else results.arena = val
      } else if (task.critical) {
        throw outcome.reason
      }
    }
  }

  results.elapsedMs = performance.now() - startedAt
  return results
}
