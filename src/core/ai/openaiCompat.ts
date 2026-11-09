import { AIError, errorFromResponse, fetchWithTimeout } from './errors'
import type { AIProvider, ChatMessage, FetchLike } from './types'

export interface OpenAICompatOptions {
  baseUrl: string
  apiKey: string
  model: string
  fetchImpl?: FetchLike
  timeoutMs?: number
}

/** Cliente para APIs compatibles con OpenAI: Gemini (AI Studio), OpenAI, Groq, etc. */
export function createOpenAICompat(o: OpenAICompatOptions): AIProvider {
  const base = o.baseUrl.replace(/\/+$/, '')
  const fetchImpl: FetchLike = o.fetchImpl ?? ((u, i) => fetch(u, i))
  const timeoutMs = o.timeoutMs ?? 45_000
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${o.apiKey}`
  }

  return {
    async chat(messages: ChatMessage[], onToken, signal) {
      if (!o.apiKey) throw new AIError('config', 'Falta la API key. Agrégala en Ajustes.')
      if (!o.model) throw new AIError('config', 'Falta elegir un modelo en Ajustes.')
      const { res, done } = await fetchWithTimeout(
        fetchImpl,
        `${base}/chat/completions`,
        { method: 'POST', headers, body: JSON.stringify({ model: o.model, messages, stream: true }) },
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
        const handleLine = (line: string): boolean => {
          const l = line.trim()
          if (!l.startsWith('data:')) return false
          const data = l.slice(5).trim()
          if (data === '[DONE]') return true
          try {
            const j = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }
            const t = j.choices?.[0]?.delta?.content
            if (t) {
              full += t
              onToken(t)
            }
          } catch {
            /* línea incompleta o no JSON: se ignora */
          }
          return false
        }
        for (;;) {
          const { value, done: end } = await reader.read()
          if (end) break
          buf += dec.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          if (lines.some(handleLine)) {
            await reader.cancel().catch(() => {})
            return full
          }
        }
        if (buf) handleLine(buf)
        return full
      } finally {
        done()
      }
    },

    async listModels() {
      const { res, done } = await fetchWithTimeout(fetchImpl, `${base}/models`, { headers }, 15_000)
      done()
      if (!res.ok) throw await errorFromResponse(res)
      const j = (await res.json()) as { data?: Array<{ id: string }> }
      return (j.data ?? []).map((m) => m.id.replace(/^models\//, ''))
    }
  }
}
