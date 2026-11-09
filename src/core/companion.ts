export interface CompanionOverview {
  name: string
  configured: boolean
  voice: boolean
  listening: boolean
  memories: number
  reminders: number
  focus: { phase: 'off' | 'focus' | 'break'; remainingMs: number; focusMin: number; breakMin: number }
}

export type CompanionAction =
  | { type: 'chat' | 'greet' | 'focusStart' | 'focusStop' }
  | { type: 'reminder'; text: string; minutes: number }

export function parseCompanionAction(value: unknown): CompanionAction {
  if (!value || typeof value !== 'object') throw new Error('Elige una acción válida.')
  const a = value as Record<string, unknown>
  if (a.type === 'chat' || a.type === 'greet' || a.type === 'focusStart' || a.type === 'focusStop') return { type: a.type }
  if (a.type === 'reminder') {
    const text = typeof a.text === 'string' ? a.text.trim() : ''
    if (!text || text.length > 200) throw new Error('Escribe un recordatorio de hasta 200 caracteres.')
    if (typeof a.minutes !== 'number' || !Number.isInteger(a.minutes) || a.minutes < 1 || a.minutes > 10080)
      throw new Error('Elige entre 1 y 10080 minutos.')
    return { type: 'reminder', text, minutes: a.minutes }
  }
  throw new Error('Esta acción no está disponible.')
}
