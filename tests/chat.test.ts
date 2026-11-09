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
      expect.objectContaining({ type: 'reminder', text: 'estirarse' }),
      { type: 'pomodoroStart' }
    ])
    expect(s.updates.at(-1)).toMatchObject({ state: 'done', text: 'Te aviso.', notes: ['ok'] })
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
