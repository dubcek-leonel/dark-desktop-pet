import { describe, expect, it, vi } from 'vitest'
import type { AIProvider, ChatMessage } from '../src/core/ai/types'
import { ChatService, type ChatDeps, type ChatUpdate } from '../src/main/chat'

function fakeProvider(answers: string[]): AIProvider & { calls: ChatMessage[][] } {
  const calls: ChatMessage[][] = []
  return {
    calls,
    async chat(messages, onToken) {
      calls.push(messages)
      const a = answers.shift() ?? '[]'
      onToken(a)
      return a
    },
    async listModels() {
      return []
    }
  }
}

function setup(answers: string[], over: Partial<ChatDeps> = {}) {
  const provider = fakeProvider(answers)
  const updates: ChatUpdate[] = []
  const events: string[] = []
  let memories: string[] = []
  const deps: ChatDeps = {
    getProvider: () => provider,
    getPersona: () => ({ name: 'Dark', personality: 'flojo', memories }),
    pet: (ev) => events.push(ev.type === 'aiDone' ? `aiDone:${ev.emotion}` : ev.type),
    ui: (u) => updates.push(u),
    memoryEnabled: () => true,
    addMemories: (m) => (memories = [...memories, ...m]),
    getMemories: () => memories,
    onActions: vi.fn(() => ['ok']),
    getContext: () => ['Pomodoro: apagado'],
    ...over
  }
  return { chat: new ChatService(deps), provider, updates, events, deps, mem: () => memories }
}

describe('ChatService', () => {
  it('piensa → habla → emoción, y muestra el texto sin etiquetas', async () => {
    const s = setup(['Qué flojera. [emo:sad]'])
    await s.chat.send('hola')
    expect(s.events).toEqual(['aiThinking', 'aiTalking', 'aiDone:sad'])
    expect(s.updates.at(-1)).toEqual({ state: 'done', text: 'Qué flojera.', emotion: 'sad', notes: [] })
  })

  it('ejecuta las acciones de la respuesta y muestra sus confirmaciones', async () => {
    const s = setup(['Te aviso. [recordar:+10m|estirarse] [pomodoro:iniciar] [emo:happy]'])
    await s.chat.send('recuérdame estirarme en 10 minutos y pon un pomodoro')
    expect(s.deps.onActions).toHaveBeenCalledWith([
      expect.objectContaining({ type: 'reminder', text: 'estirarse' })
    ])
    expect(s.deps.onActions).toHaveBeenCalledWith([{ type: 'pomodoroStart' }])
    expect(s.updates.at(-1)).toMatchObject({ state: 'done', text: 'Te aviso.', notes: ['ok', 'ok'] })
  })

  it('con voz: sigue hablando hasta terminar la frase y después muestra la emoción', async () => {
    const order: string[] = []
    const s = setup(['Hola. [emo:happy]'], {
      speak: async (t) => {
        order.push(`speak:${t}`)
      },
      pet: (ev) => order.push(ev.type)
    })
    await s.chat.send('hola')
    expect(order).toEqual(['aiThinking', 'aiTalking', 'speak:Hola.', 'aiDone'])
  })

  it('las animaciones pedidas se hacen al final', async () => {
    const calls: string[][] = []
    const s = setup(['Ok. [accion:bailar] [recordar:+5m|agua] [emo:happy]'], {
      onActions: (a) => {
        calls.push(a.map((x) => x.type))
        return []
      }
    })
    await s.chat.send('baila y recuérdame el agua')
    expect(calls).toEqual([['reminder'], ['pet']])
  })

  it('sin acciones no llama a onActions', async () => {
    const s = setup(['Hola. [emo:neutral]'])
    await s.chat.send('hola')
    expect(s.deps.onActions).not.toHaveBeenCalled()
  })

  it('el estado de la app va en el prompt de sistema', async () => {
    const s = setup(['ok [emo:neutral]'])
    await s.chat.send('hola')
    expect(s.provider.calls[0][0].content).toContain('Pomodoro: apagado')
  })

  it('cada 3 intercambios extrae recuerdos en segundo plano', async () => {
    const s = setup(['a [emo:neutral]', 'b [emo:neutral]', 'c [emo:neutral]', '["Se llama Leo"]'])
    await s.chat.send('me llamo Leo')
    await s.chat.send('dos')
    await s.chat.send('tres')
    await s.chat.idle()
    expect(s.mem()).toEqual(['Se llama Leo'])
    expect(s.provider.calls).toHaveLength(4)
  })

  it('flushMemory extrae aunque no se llegue a 3, y no hace nada si la memoria está apagada', async () => {
    const s = setup(['a [emo:neutral]', '["Le gusta el café"]'])
    await s.chat.send('me gusta el café')
    await s.chat.flushMemory()
    expect(s.mem()).toEqual(['Le gusta el café'])

    const off = setup(['a [emo:neutral]'], { memoryEnabled: () => false })
    await off.chat.send('hola')
    await off.chat.flushMemory()
    expect(off.provider.calls).toHaveLength(1)
  })

  it('los recuerdos van en el prompt de sistema', async () => {
    const s = setup(['ok [emo:neutral]'])
    s.deps.addMemories(['Tiene un gato'])
    await s.chat.send('hola')
    expect(s.provider.calls[0][0].content).toContain('Tiene un gato')
  })
})


function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

describe('chat reliability', () => {
  it('queues concurrent messages and includes the previous completed turn', async () => {
    const first = deferred<string>()
    const provider = fakeProvider(['second'])
    const call = vi.spyOn(provider, 'chat').mockImplementationOnce(() => first.promise)
    const s = setup([], { getProvider: () => provider, memoryEnabled: () => false })
    const a = s.chat.send('one')
    const b = s.chat.send('two')
    await Promise.resolve()
    expect(call).toHaveBeenCalledTimes(1)
    first.resolve('first')
    await Promise.all([a, b])
    expect(call).toHaveBeenCalledTimes(2)
    expect(provider.calls[0]).toContainEqual({ role: 'assistant', content: 'first' })
  })

  it('stays busy until speech finishes', async () => {
    const speech = deferred<void>()
    const s = setup(['hello'], { speak: () => speech.promise })
    const job = s.chat.send('hello')
    await vi.waitFor(() => expect(s.updates.at(-1)?.state).toBe('speaking'))
    expect(s.chat.isBusy()).toBe(true)
    speech.resolve()
    await job
    expect(s.chat.isBusy()).toBe(false)
    expect(s.updates.at(-1)?.state).toBe('done')
  })

  it('cancels even an uncooperative provider and ignores its late tokens and actions', async () => {
    const pending = deferred<string>()
    let token!: (text: string) => void
    const provider = fakeProvider(['ok'])
    vi.spyOn(provider, 'chat').mockImplementationOnce((_m, cb) => { token = cb; return pending.promise })
    const stopSpeaking = vi.fn()
    const s = setup([], { getProvider: () => provider, stopSpeaking })
    const job = s.chat.send('remind me')
    await Promise.resolve()
    s.chat.cancel()
    await job
    const count = s.updates.length
    token('late')
    pending.resolve('[recordar:+5m|agua]')
    await Promise.resolve()
    expect(s.updates).toHaveLength(count)
    expect(s.deps.onActions).not.toHaveBeenCalled()
    expect(stopSpeaking).toHaveBeenCalledTimes(1)
    await s.chat.retry()
    expect(s.updates.at(-1)?.state).toBe('done')
  })

  it('retries a failed request once without keeping a failed turn in history', async () => {
    const provider = fakeProvider(['recovered'])
    const call = vi.spyOn(provider, 'chat').mockRejectedValueOnce(new Error('offline'))
    const s = setup([], { getProvider: () => provider })
    await s.chat.send('my question')
    expect(s.updates.at(-1)).toMatchObject({ state: 'error', retryable: true })
    await Promise.all([s.chat.retry(), s.chat.retry()])
    expect(call).toHaveBeenCalledTimes(2)
    expect(provider.calls[0].filter(m => m.role === 'user')).toHaveLength(1)
  })

  it('keeps completed actions when speech is interrupted and does not retry them', async () => {
    const s = setup(['Done [recordar:+5m|agua]'], { speak: () => new Promise(() => {}) })
    const job = s.chat.send('water')
    await vi.waitFor(() => expect(s.updates.at(-1)?.state).toBe('speaking'))
    s.chat.cancel()
    await job
    expect(s.updates.at(-1)).toMatchObject({ state: 'done', notes: ['ok'] })
    await s.chat.retry()
    expect(s.deps.onActions).toHaveBeenCalledTimes(1)
  })

  it('reports a failed action and still executes independent remaining actions', async () => {
    const onActions = vi.fn().mockImplementationOnce(() => { throw new Error('disk full') }).mockReturnValue(['timer started'])
    const s = setup(['Done [recordar:+5m|agua] [pomodoro:iniciar]'], { onActions })
    await s.chat.send('do both')
    expect(onActions).toHaveBeenCalledTimes(2)
    expect(s.updates.at(-1)).toMatchObject({ state: 'done', notes: [expect.stringContaining('Revisa'), 'timer started'] })
    await s.chat.retry()
    expect(onActions).toHaveBeenCalledTimes(2)
  })

  it('recovers from persona errors and empty responses', async () => {
    const persona = vi.fn().mockImplementationOnce(() => { throw new Error('bad config') }).mockReturnValue({ name: 'Dark', personality: 'x' })
    const s = setup(['', 'valid'], { getPersona: persona })
    await s.chat.send('hello')
    expect(s.chat.isBusy()).toBe(false)
    await s.chat.retry()
    expect(s.updates.at(-1)).toMatchObject({ state: 'error', retryable: true })
    await s.chat.retry()
    expect(s.updates.at(-1)?.state).toBe('done')
  })

  it('reset cancels active and queued turns without restoring old history', async () => {
    const provider = fakeProvider(['fresh'])
    vi.spyOn(provider, 'chat').mockImplementationOnce(() => new Promise(() => {}))
    const s = setup([], { getProvider: () => provider })
    const active = s.chat.send('old')
    const queued = s.chat.send('queued')
    await Promise.resolve()
    s.chat.reset()
    await Promise.all([active, queued])
    await s.chat.send('new')
    expect(provider.calls[0].filter(m => m.role === 'user')).toEqual([{ role: 'user', content: 'new' }])
  })

  it('releases a hung turn on deadline', async () => {
    vi.useFakeTimers()
    try {
      const provider = fakeProvider([])
      vi.spyOn(provider, 'chat').mockImplementation(() => new Promise(() => {}))
      const s = setup([], { getProvider: () => provider })
      const job = s.chat.send('hello')
      await vi.advanceTimersByTimeAsync(180_000)
      await job
      expect(s.chat.isBusy()).toBe(false)
      expect(s.updates.at(-1)).toMatchObject({ state: 'error', retryable: true })
    } finally { vi.useRealTimers() }
  })

  it('keeps the text available after a voice failure', async () => {
    const s = setup(['hello'], { speak: async () => { throw new Error('audio') } })
    await s.chat.send('hi')
    expect(s.updates.at(-1)).toMatchObject({ state: 'done', text: 'hello', notes: [expect.stringContaining('voz')] })
  })
})


describe('chat recovery boundaries', () => {
  it('retains pending memories after an extraction failure', async () => {
    const provider = fakeProvider(['["Likes coffee"]'])
    vi.spyOn(provider, 'chat').mockImplementationOnce(async (_m, cb) => { cb('answer'); return 'answer' }).mockRejectedValueOnce(new Error('offline'))
    const s = setup([], { getProvider: () => provider })
    await s.chat.send('I like coffee')
    await s.chat.flushMemory()
    expect(s.mem()).toEqual([])
    await s.chat.flushMemory()
    expect(s.mem()).toEqual(['Likes coffee'])
    // The retried extraction still includes the original user statement.
    expect(provider.calls.at(-1)?.some(m => m.content.includes('I like coffee'))).toBe(true)
  })
  it('rejects oversized messages without silently truncating them', async () => {
    const s = setup([])
    await s.chat.send('x'.repeat(4001))
    expect(s.provider.calls).toHaveLength(0)
    expect(s.updates.at(-1)?.state).toBe('notice')
  })
})


describe('conversation snapshot', () => {
  it('restores the recent conversation without exposing mutable history', async () => {
    const s = setup(['hello'])
    await s.chat.send('hi')
    const snapshot = s.chat.snapshot()
    expect(snapshot.question).toBe('hi')
    expect(snapshot.current?.state).toBe('done')
    snapshot.history[0].content = 'changed outside'
    expect(s.chat.snapshot().history[0].content).toBe('hi')
    s.chat.reset()
    expect(s.chat.snapshot()).toMatchObject({ history: [], question: '', current: {state:'reset'} })
  })
})
