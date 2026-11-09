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
  | { state: 'error'; text: string; retryable?: boolean }
  | { state: 'speaking'; text: string; notes: string[] }
  | { state: 'notice'; text: string; buttons?: BubbleButton[] }
  | { state: 'caption'; text: string }
  | { state: 'ready' }
  | { state: 'reset' }
  | { state: 'transcribing' }
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
  stopSpeaking?: () => void
}

const MAX_HISTORY = 20
const EXTRACT_EVERY = 3

/** Conversación con la IA: historial, recuerdos y acciones. Avisa a Dark y a la burbuja. */
export class ChatService {
  private history: ChatMessage[] = []
  private busy = false
  private controller: AbortController | null = null
  private turns: Promise<void> = Promise.resolve()
  private generation = 0
  private failed: string | null = null
  private current: ChatUpdate | null = null
  private question = ''

  snapshot(): { history: ChatMessage[]; current: ChatUpdate | null; question: string } {
    return { history: this.history.map((m) => ({ ...m })), current: this.current, question: this.question }
  }

  private update(msg: ChatUpdate): void {
    this.current = msg
    if (msg.state === 'thinking') this.question = msg.question
    this.deps.ui(msg)
  }

  cancel(): void {
    this.controller?.abort()
    if (!this.controller) this.deps.stopSpeaking?.()
  }

  retry(): Promise<void> {
    const text = this.failed
    if (!text || this.busy) return Promise.resolve()
    this.failed = null
    return this.send(text)
  }
  /** Intercambios que aún no pasaron por la extracción de recuerdos. */
  private pending: ChatMessage[] = []
  private queue: Promise<void> = Promise.resolve()

  constructor(private deps: ChatDeps) {}

  isBusy(): boolean {
    return this.busy
  }

  reset(): void {
    this.generation++
    this.cancel()
    this.failed = null
    void this.flushMemory()
    this.history = []
    this.current = null
    this.question = ''
    this.update({ state: 'reset' })
  }

  /** Espera a que termine cualquier extracción de recuerdos en curso. */
  idle(): Promise<void> {
    return this.queue
  }

  /** Agrega al historial algo que Dark dijo por su cuenta (por ejemplo, un aviso), para que tenga contexto. */
  noteAssistant(text: string): void {
    this.history = [...this.history, { role: 'assistant' as const, content: text }].slice(-MAX_HISTORY)
  }

  send(text: string): Promise<void> {
    const q = text.trim()
    if (!q) return Promise.resolve()
    if (q.length > 4000) {
      this.update({ state: 'notice', text: 'El mensaje es demasiado largo. Usa hasta 4000 caracteres; no lo he enviado.' })
      return Promise.resolve()
    }
    const generation = this.generation
    const job = this.turns.then(() => generation === this.generation ? this.run(q) : undefined)
    this.turns = job.catch(() => {})
    return job
  }

  private async run(q: string): Promise<void> {
    this.busy = true
    this.failed = null
    const controller = new AbortController()
    this.controller = controller
    const signal = controller.signal
    const generation = this.generation
    // Cancellation also releases the turn if a provider ignores AbortSignal.
    const aborted = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => {
        this.deps.stopSpeaking?.()
        reject(new Error('Cancelado'))
      }, { once: true })
    })
    const timer = setTimeout(() => controller.abort(new Error('timeout')), 180_000)
    let committed = false
    this.deps.pet({ type: 'aiThinking' })
    this.update({ state: 'thinking', question: q })
    try {
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
      raw = await Promise.race([this.deps.getProvider().chat(messages, (tok) => {
        if (signal.aborted) return
        raw += tok
        if (!talking) {
          talking = true
          this.deps.pet({ type: 'aiTalking' })
        }
        this.update({ state: 'talking', text: displayText(raw) })
      }, signal), aborted])
      signal.throwIfAborted()
      const { text: rest, actions } = extractActions(raw, Date.now())
      const { text: answer, emotion } = extractEmotion(rest)

      const turn: ChatMessage[] = [
        { role: 'user', content: q },
        { role: 'assistant', content: answer }
      ]
      // Las animaciones pedidas (bailar, dormir…) van al final, después de hablar y de la emoción.
      const petActions = actions.filter((a) => a.type === 'pet')
      const other = actions.filter((a) => a.type !== 'pet')
      if (!answer.trim() && !actions.length) throw new AIError('http', 'La IA devolvió una respuesta vacía. Intenta otra vez.')
      // Once actions start, retrying the request could duplicate a reminder or timer.
      committed = true
      const notes: string[] = []
      for (const action of other) {
        try {
          notes.push(...this.deps.onActions([action]))
        } catch {
          notes.push('⚠ No pude confirmar una acción. Revisa su estado antes de volver a pedirla.')
        }
      }
      const visible = notes.some((note) => note.startsWith('⚠'))
        ? 'No pude completar todo lo solicitado. Revisa los resultados:'
        : answer || 'Estas son las acciones solicitadas:'
      turn[1].content = [visible, ...notes].join('\n')
      this.history = [...this.history, ...turn].slice(-MAX_HISTORY)
      if (this.deps.speak && !signal.aborted) {
        this.update({ state: 'speaking', text: visible, notes })
        if (!talking) this.deps.pet({ type: 'aiTalking' })
        try {
          await Promise.race([this.deps.speak([visible, ...notes].join(' ')), aborted])
        } catch {
          if (!signal.aborted) notes.push('⚠ No pude reproducir la voz. Puedes leer la respuesta aquí.')
        }
      }
      if (generation !== this.generation) return
      this.deps.pet({ type: 'aiDone', emotion })
      if (!signal.aborted) {
        for (const action of petActions) {
          try { notes.push(...this.deps.onActions([action])) }
          catch { notes.push('⚠ No pude realizar la animación solicitada.') }
        }
      }
      this.update({ state: 'done', text: visible, emotion, notes })

      if (this.deps.memoryEnabled()) {
        this.pending.push(...turn)
        if (this.pending.length >= EXTRACT_EVERY * 2) void this.flushMemory()
      }
    } catch (e) {
      this.deps.pet({ type: 'aiDone', emotion: 'sad' })
      if (generation !== this.generation) return
      this.failed = committed ? null : q
      const text = signal.aborted
        ? (signal.reason?.message === 'timeout' ? 'La respuesta tardó demasiado. Puedes reintentar.' : 'Respuesta detenida. No ejecuté acciones; puedes reintentar.')
        : friendlyError(e)
      this.update({ state: 'error', text, retryable: !committed })
      if (e instanceof AIError && (e.kind === 'config' || e.kind === 'auth' || e.kind === 'model')) {
        this.deps.onConfigProblem?.()
      }
    } finally {
      clearTimeout(timer)
      this.controller = null
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
        // Preserve facts for the next extraction attempt.
        this.pending = [...convo, ...this.pending].slice(-MAX_HISTORY)
      }
    })
    return this.queue
  }
}
