import { extractActions, type Action } from '../core/actions'
import { displayText, extractEmotion } from '../core/ai/emotion'
import { AIError, friendlyError } from '../core/ai/errors'
import { buildSystemPrompt, type PersonaInput } from '../core/ai/persona'
import type { AIProvider, ChatMessage } from '../core/ai/types'
import type { Emotion, PetEvent } from '../core/behavior'
import { buildExtractionMessages, parseMemoryList } from '../core/memory'

export interface BubbleButton {
  id: string
  label: string
}

export type ChatUpdate =
  | { state: 'thinking'; question: string }
  | { state: 'talking'; text: string }
  | { state: 'done'; text: string; emotion: Emotion; notes?: string[] }
  | { state: 'error'; text: string }
  | { state: 'notice'; text: string; buttons?: BubbleButton[] }
  | { state: 'listening' }

export interface ChatDeps {
  getProvider: () => AIProvider
  getPersona: () => PersonaInput
  /** Estado actual de la app para que la IA lo sepa (recordatorios, Pomodoro…). */
  getContext?: () => string[]
  pet: (ev: PetEvent) => void
  ui: (msg: ChatUpdate) => void
  onConfigProblem?: () => void
  memoryEnabled: () => boolean
  getMemories: () => string[]
  addMemories: (facts: string[]) => void
  /** Ejecuta las acciones pedidas; devuelve una confirmación por cada una. */
  onActions: (actions: Action[]) => string[]
  /** Si está, Dark dice la respuesta en voz alta (y sigue en "hablando" hasta terminar). */
  speak?: (text: string) => Promise<void>
}

const MAX_HISTORY = 20
const EXTRACT_EVERY = 3

/** Conversación con la IA: historial, recuerdos y acciones. Avisa a Dark y a la burbuja. */
export class ChatService {
  private history: ChatMessage[] = []
  private busy = false
  /** Intercambios que aún no pasaron por la extracción de recuerdos. */
  private pending: ChatMessage[] = []
  private queue: Promise<void> = Promise.resolve()

  constructor(private deps: ChatDeps) {}

  isBusy(): boolean {
    return this.busy
  }

  reset(): void {
    void this.flushMemory()
    this.history = []
  }

  /** Espera a que termine cualquier extracción de recuerdos en curso. */
  idle(): Promise<void> {
    return this.queue
  }

  /** Agrega al historial algo que Dark dijo por su cuenta (por ejemplo, un aviso), para que tenga contexto. */
  noteAssistant(text: string): void {
    this.history = [...this.history, { role: 'assistant' as const, content: text }].slice(-MAX_HISTORY)
  }

  async send(text: string): Promise<void> {
    const q = text.trim().slice(0, 4000)
    if (!q || this.busy) return
    this.busy = true
    this.deps.pet({ type: 'aiThinking' })
    this.deps.ui({ state: 'thinking', question: q })

    const persona: PersonaInput = {
      ...this.deps.getPersona(),
      memories: this.deps.memoryEnabled() ? this.deps.getMemories() : [],
      now: new Date(),
      context: this.deps.getContext?.() ?? []
    }
    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(persona) },
      ...this.history,
      { role: 'user', content: q }
    ]
    let raw = ''
    let talking = false
    try {
      raw = await this.deps.getProvider().chat(messages, (tok) => {
        raw += tok
        if (!talking) {
          talking = true
          this.deps.pet({ type: 'aiTalking' })
        }
        this.deps.ui({ state: 'talking', text: displayText(raw) })
      })
      const { text: rest, actions } = extractActions(raw, Date.now())
      const { text: answer, emotion } = extractEmotion(rest)

      const turn: ChatMessage[] = [
        { role: 'user', content: q },
        { role: 'assistant', content: answer }
      ]
      this.history = [...this.history, ...turn].slice(-MAX_HISTORY)
      // Las animaciones pedidas (bailar, dormir…) van al final, después de hablar y de la emoción.
      const petActions = actions.filter((a) => a.type === 'pet')
      const other = actions.filter((a) => a.type !== 'pet')
      const notes = other.length ? this.deps.onActions(other) : []
      this.deps.ui({ state: 'done', text: answer || '…', emotion, notes })
      if (this.deps.speak && answer) {
        if (!talking) this.deps.pet({ type: 'aiTalking' })
        await this.deps.speak(answer).catch(() => {})
      }
      this.deps.pet({ type: 'aiDone', emotion })
      if (petActions.length) this.deps.onActions(petActions)

      if (this.deps.memoryEnabled()) {
        this.pending.push(...turn)
        if (this.pending.length >= EXTRACT_EVERY * 2) void this.flushMemory()
      }
    } catch (e) {
      this.deps.pet({ type: 'aiDone', emotion: 'sad' })
      this.deps.ui({ state: 'error', text: friendlyError(e) })
      if (e instanceof AIError && (e.kind === 'config' || e.kind === 'auth' || e.kind === 'model')) {
        this.deps.onConfigProblem?.()
      }
    } finally {
      this.busy = false
    }
  }

  /** Extrae recuerdos de lo conversado desde la última vez (en segundo plano, sin mostrar nada). */
  flushMemory(): Promise<void> {
    const convo = this.pending
    this.pending = []
    if (!this.deps.memoryEnabled() || convo.length === 0) return this.idle()
    this.queue = this.queue.then(async () => {
      try {
        const raw = await this.deps
          .getProvider()
          .chat(buildExtractionMessages(convo, this.deps.getMemories()), () => {})
        const facts = parseMemoryList(raw)
        if (facts.length) this.deps.addMemories(facts)
      } catch {
        // Si falla, no pasa nada: se intentará con la próxima conversación.
      }
    })
    return this.queue
  }
}
