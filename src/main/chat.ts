import { displayText, extractEmotion } from '../core/ai/emotion'
import { AIError, friendlyError } from '../core/ai/errors'
import { buildSystemPrompt, type PersonaInput } from '../core/ai/persona'
import type { AIProvider, ChatMessage } from '../core/ai/types'
import type { Emotion, PetEvent } from '../core/behavior'

export type ChatUpdate =
  | { state: 'thinking'; question: string }
  | { state: 'talking'; text: string }
  | { state: 'done'; text: string; emotion: Emotion }
  | { state: 'error'; text: string }

export interface ChatDeps {
  getProvider: () => AIProvider
  getPersona: () => PersonaInput
  pet: (ev: PetEvent) => void
  ui: (msg: ChatUpdate) => void
  onConfigProblem?: () => void
}

const MAX_HISTORY = 20

/** Conversación con la IA: mantiene el historial y avisa a Dark y a la burbuja. */
export class ChatService {
  private history: ChatMessage[] = []
  private busy = false

  constructor(private deps: ChatDeps) {}

  isBusy(): boolean {
    return this.busy
  }

  reset(): void {
    this.history = []
  }

  async send(text: string): Promise<void> {
    const q = text.trim().slice(0, 4000)
    if (!q || this.busy) return
    this.busy = true
    this.deps.pet({ type: 'aiThinking' })
    this.deps.ui({ state: 'thinking', question: q })

    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(this.deps.getPersona()) },
      ...this.history,
      { role: 'user', content: q }
    ]
    let raw = ''
    let talking = false
    try {
      const provider = this.deps.getProvider()
      raw = await provider.chat(messages, (tok) => {
        raw += tok
        if (!talking) {
          talking = true
          this.deps.pet({ type: 'aiTalking' })
        }
        this.deps.ui({ state: 'talking', text: displayText(raw) })
      })
      const { text: answer, emotion } = extractEmotion(raw)
      this.history.push({ role: 'user', content: q }, { role: 'assistant', content: answer })
      this.history = this.history.slice(-MAX_HISTORY)
      this.deps.pet({ type: 'aiDone', emotion })
      this.deps.ui({ state: 'done', text: answer || '…', emotion })
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
}
