export type AIErrorKind = 'auth' | 'model' | 'rate' | 'network' | 'timeout' | 'http' | 'config'

export class AIError extends Error {
  constructor(
    public kind: AIErrorKind,
    message: string
  ) {
    super(message)
    this.name = 'AIError'
  }
}

/** Convierte la respuesta HTTP de error en un AIError con su tipo. */
export async function errorFromResponse(res: Response): Promise<AIError> {
  let detail = ''
  try {
    const body = (await res.json()) as { error?: { message?: string } | string }
    detail = typeof body.error === 'string' ? body.error : (body.error?.message ?? '')
  } catch {
    /* cuerpo vacío o no JSON */
  }
  const msg = detail || `HTTP ${res.status}`
  if (res.status === 401 || res.status === 403 || /api.?key/i.test(detail)) return new AIError('auth', msg)
  if (res.status === 404) return new AIError('model', msg)
  if (res.status === 429) return new AIError('rate', msg)
  return new AIError('http', msg)
}

/** Ejecuta fetch con timeout y traduce fallos de red. */
export async function fetchWithTimeout(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  outer?: AbortSignal
): Promise<{ res: Response; done: () => void }> {
  const ctrl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, timeoutMs)
  const onOuter = (): void => ctrl.abort()
  outer?.addEventListener('abort', onOuter)
  const done = (): void => {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onOuter)
  }
  try {
    const res = await fetchImpl(url, { ...init, signal: ctrl.signal })
    return { res, done }
  } catch (e) {
    done()
    if (timedOut) throw new AIError('timeout', 'La IA tardó demasiado en responder')
    if (outer?.aborted) throw new AIError('http', 'Cancelado')
    throw new AIError('network', e instanceof Error ? e.message : String(e))
  }
}

export function friendlyError(e: unknown): string {
  if (e instanceof AIError) {
    switch (e.kind) {
      case 'auth':
        return 'Mi API key no funciona. Revísala en Ajustes.'
      case 'model':
        return 'Ese modelo no existe o no está disponible. Elige otro en Ajustes.'
      case 'rate':
        return 'Me pidieron demasiadas cosas seguidas. Espera un poco.'
      case 'network':
        return 'No me puedo conectar a la IA. ¿Hay internet? (Si usas Ollama, ¿está abierto?)'
      case 'timeout':
        return 'La IA tardó demasiado. Intenta otra vez.'
      case 'config':
        return e.message
      default:
        return `Algo falló: ${e.message}`
    }
  }
  return `Algo falló: ${e instanceof Error ? e.message : String(e)}`
}
