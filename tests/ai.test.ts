import { describe, expect, it, vi } from 'vitest'
import { displayText, extractEmotion } from '../src/core/ai/emotion'
import { AIError, friendlyError } from '../src/core/ai/errors'
import { createOllama } from '../src/core/ai/ollama'
import { createOpenAICompat } from '../src/core/ai/openaiCompat'
import { buildSystemPrompt } from '../src/core/ai/persona'

function streamResponse(chunks: string[], status = 200): Response {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch))
      c.close()
    }
  })
  return new Response(body, { status })
}

function sse(...contents: string[]): string[] {
  return [
    ...contents.map(
      (t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t }, index: 0 }] })}\n\n`
    ),
    'data: [DONE]\n\n'
  ]
}

describe('emociones', () => {
  it('extrae la etiqueta y limpia el texto', () => {
    expect(extractEmotion('Qué flojera. [emo:sad]')).toEqual({ text: 'Qué flojera.', emotion: 'sad' })
    expect(extractEmotion('Hola [EMO:Happy] ')).toEqual({ text: 'Hola', emotion: 'happy' })
  })
  it('sin etiqueta o con una desconocida es neutral', () => {
    expect(extractEmotion('Hola')).toEqual({ text: 'Hola', emotion: 'neutral' })
    expect(extractEmotion('Hola [emo:feliz]').emotion).toBe('neutral')
  })
  it('mientras llega el stream oculta etiquetas a medio escribir', () => {
    expect(displayText('Hola [em')).toBe('Hola')
    expect(displayText('Hola [emo:ang')).toBe('Hola')
    expect(displayText('Hola [emo:angry]')).toBe('Hola')
    expect(displayText('Uso [corchetes] normales')).toBe('Uso [corchetes] normales')
  })
})

describe('persona', () => {
  it('incluye nombre, personalidad, recuerdos y la regla de emociones', () => {
    const p = buildSystemPrompt({ name: 'Dark', personality: 'sarcástico y algo flojo', memories: ['Se llama Leo'] })
    expect(p).toContain('Dark')
    expect(p).toContain('sarcástico y algo flojo')
    expect(p).toContain('Se llama Leo')
    expect(p).toContain('[emo:')
  })
  it('explica los recordatorios e incluye la fecha y hora si se le pasa', () => {
    const p = buildSystemPrompt({ name: 'Dark', personality: 'x', now: new Date(2026, 10, 8, 21, 5) })
    expect(p).toContain('[recordar:')
    expect(p).toContain('2026-11-08 21:05')
  })
})

describe('cliente compatible con OpenAI (Gemini)', () => {
  it('envía la key y el modelo, y junta el stream token por token', async () => {
    const fetchImpl = vi.fn(async () => streamResponse(sse('Ho', 'la ', '[emo:happy]')))
    const ai = createOpenAICompat({ baseUrl: 'https://x.test/v1/', apiKey: 'k123', model: 'm1', fetchImpl })
    const tokens: string[] = []
    const out = await ai.chat([{ role: 'user', content: 'hola' }], (t) => tokens.push(t))
    expect(out).toBe('Hola [emo:happy]')
    expect(tokens).toEqual(['Ho', 'la ', '[emo:happy]'])
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://x.test/v1/chat/completions')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer k123')
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'm1', stream: true })
  })

  it('arma líneas SSE partidas entre trozos', async () => {
    const all = sse('uno ', 'dos').join('')
    const parts = [all.slice(0, 17), all.slice(17, 60), all.slice(60)]
    const ai = createOpenAICompat({ baseUrl: 'https://x.test', apiKey: 'k', model: 'm', fetchImpl: async () => streamResponse(parts) })
    expect(await ai.chat([], () => {})).toBe('uno dos')
  })

  it('key inválida → error de autenticación', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 })
    const ai = createOpenAICompat({ baseUrl: 'https://x.test', apiKey: 'bad', model: 'm', fetchImpl })
    await expect(ai.chat([], () => {})).rejects.toMatchObject({ kind: 'auth' })
  })

  it('modelo inexistente → error de modelo', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: { message: 'not found' } }), { status: 404 })
    const ai = createOpenAICompat({ baseUrl: 'https://x.test', apiKey: 'k', model: 'nope', fetchImpl })
    await expect(ai.chat([], () => {})).rejects.toMatchObject({ kind: 'model' })
  })

  it('sin respuesta a tiempo → timeout', async () => {
    const fetchImpl = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_r, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    const ai = createOpenAICompat({ baseUrl: 'https://x.test', apiKey: 'k', model: 'm', fetchImpl, timeoutMs: 20 })
    await expect(ai.chat([], () => {})).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('sin internet → error de red', async () => {
    const fetchImpl = async () => {
      throw new TypeError('fetch failed')
    }
    const ai = createOpenAICompat({ baseUrl: 'https://x.test', apiKey: 'k', model: 'm', fetchImpl })
    await expect(ai.chat([], () => {})).rejects.toMatchObject({ kind: 'network' })
  })

  it('lista modelos quitando el prefijo models/', async () => {
    const fetchImpl = async () =>
      new Response(JSON.stringify({ data: [{ id: 'models/gemini-a' }, { id: 'gpt-b' }] }), { status: 200 })
    const ai = createOpenAICompat({ baseUrl: 'https://x.test', apiKey: 'k', model: 'm', fetchImpl })
    expect(await ai.listModels()).toEqual(['gemini-a', 'gpt-b'])
  })
})

describe('cliente de Ollama', () => {
  it('junta el stream NDJSON', async () => {
    const lines = [
      JSON.stringify({ message: { content: 'Ho' }, done: false }) + '\n',
      JSON.stringify({ message: { content: 'la' }, done: false }) + '\n' + JSON.stringify({ done: true }) + '\n'
    ]
    const fetchImpl = vi.fn(async () => streamResponse(lines))
    const ai = createOllama({ baseUrl: 'http://127.0.0.1:11434', model: 'qwen3:4b', fetchImpl })
    expect(await ai.chat([{ role: 'user', content: 'hola' }], () => {})).toBe('Hola')
    const [url] = fetchImpl.mock.calls[0] as unknown as [string]
    expect(url).toBe('http://127.0.0.1:11434/api/chat')
  })

  it('Ollama apagado → error de red', async () => {
    const ai = createOllama({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'x',
      fetchImpl: async () => {
        throw new TypeError('fetch failed')
      }
    })
    await expect(ai.chat([], () => {})).rejects.toMatchObject({ kind: 'network' })
  })
})

describe('mensajes de error para el usuario', () => {
  it('traduce cada tipo a español', () => {
    expect(friendlyError(new AIError('auth', 'x'))).toMatch(/API key/)
    expect(friendlyError(new AIError('network', 'x'))).toMatch(/conexión|conectar/i)
    expect(friendlyError(new Error('raro'))).toMatch(/raro/)
  })
})
