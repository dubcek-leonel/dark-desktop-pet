import { AIError, errorFromResponse, fetchWithTimeout } from './errors'
import type { AIProvider, ChatMessage, FetchLike } from './types'

export interface OllamaOptions {
  baseUrl: string
  model: string
  fetchImpl?: FetchLike
  timeoutMs?: number
}

/** Cliente para Ollama local (stream NDJSON de /api/chat). */
export function createOllama(o: OllamaOptions): AIProvider {
  const base = o.baseUrl.replace(/\/+$/, '')
  const fetchImpl: FetchLike = o.fetchImpl ?? ((u, i) => fetch(u, i))
  const timeoutMs = o.timeoutMs ?? 120_000

  return {
    async chat(messages: ChatMessage[], onToken, signal) {
      if (!o.model) throw new AIError('config', 'Falta elegir un modelo de Ollama en Ajustes.')
      const { res, done } = await fetchWithTimeout(
        fetchImpl,
        `${base}/api/chat`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: o.model, messages, stream: true })
        },
        timeoutMs,
        signal
      )
      try {
        if (!res.ok) throw await errorFromResponse(res)
        if (!res.body) throw new AIError('http', 'Respuesta vacía')
        let full = ''
        let buf = ''
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        const handleLine = (line: string): void => {
          if (!line.trim()) return
          try {
            const j = JSON.parse(line) as { message?: { content?: string }; error?: string }
            if (j.error) throw new AIError('http', j.error)
            const t = j.message?.content
            if (t) {
              full += t
              onToken(t)
            }
          } catch (e) {
            if (e instanceof AIError) throw e
          }
        }
        for (;;) {
          const { value, done: end } = await reader.read()
          if (end) break
          buf += dec.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          lines.forEach(handleLine)
        }
        handleLine(buf)
        return full
      } finally {
        done()
      }
    },

    async listModels() {
      const { res, done } = await fetchWithTimeout(fetchImpl, `${base}/api/tags`, {}, 10_000)
      done()
      if (!res.ok) throw await errorFromResponse(res)
      const j = (await res.json()) as { models?: Array<{ name: string }> }
      return (j.models ?? []).map((m) => m.name)
    }
  }
}
