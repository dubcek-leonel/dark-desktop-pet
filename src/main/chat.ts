import { displayText, extractEmotion } from '../core/ai/emotion'
import { AIError, friendlyError } from '../core/ai/errors'
import { buildSystemPrompt, type PersonaInput } from '../core/ai/persona'
import type { AIProvider, ChatMessage } from '../core/ai/types'
import type { Emotion, PetEvent } from '../core/behavior'
import { buildExtractionMessages, parseMemoryList } from '../core/memory'
import { extractReminders, type ReminderRequest } from '../core/reminders'

export type ChatUpdate =
  | { state: 'thinking'; question: string }
  | { state: 'talking'; text: string }
  | { state: 'done'; text: string; emotion: Emotion }
  | { state: 'error'; text: string }
  | { state: 'notice'; text: string }

export interface ChatDeps {
  getProvider: () => AIProvider
  getPersona: () => PersonaInput
  pet: (ev: PetEvent) => void
  ui: (msg: ChatUpdate) => void
  onConfigProblem?: () => void
  memoryEnabled: () => boolean
  getMemories: () => string[]
  addMemories: (facts: string[]) => void
  onReminders: (reminders: ReminderRequest[]) => void
}

const MAX_HISTORY = 20
const EXTRACT_EVERY = 3

/** Conversación con la IA: historial, recuerdos y recordatorios. Avisa a Dark y a la burbuja. */
export class ChatService {
  private history: ChatMessage[] = []
  private busy = false
  /** Intercambios (pregunta + respuesta) que aún no pasaron por la extracción de recuerdos. */
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

  async send(text: string): Promise<void> {
    const q = text.trim().slice(0, 4000)
    if (!q || this.busy) return
    this.busy = true
    this.deps.pet({ type: 'aiThinking' })
    this.deps.ui({ state: 'thinking', question: q })

    const persona: PersonaInput = {
      ...this.deps.getPersona(),
      memories: this.deps.memoryEnabled() ? this.deps.getMemories() : [],
      now: new Date()
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
      const r = extractReminders(raw, Date.now())
      if (r.reminders.length) this.deps.onReminders(r.reminders)
      const { text: answer, emotion } = extractEmotion(r.text)

      const turn: ChatMessage[] = [
        { role: 'user', content: q },
        { role: 'assistant', content: answer }
      ]
      this.history = [...this.history, ...turn].slice(-MAX_HISTORY)
      this.deps.pet({ type: 'aiDone', emotion })
      this.deps.ui({ state: 'done', text: answer || '…', emotion })

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
    // Las extracciones van en cola, una detrás de otra.
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
