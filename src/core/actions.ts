import { parseRepeat, parseWhen, type Repeat } from './reminders'

/** Cosas que Dark puede hacer cuando se lo pides por chat. */
export type Action =
  | { type: 'reminder'; at: number; text: string; repeat: Repeat | null }
  | { type: 'cancelReminder'; query: string }
  | { type: 'pomodoroStart'; focusMin?: number; breakMin?: number }
  | { type: 'pomodoroStop' }
  | { type: 'pet'; what: 'dance' | 'sleep' | 'wave' }
  | { type: 'remember'; fact: string }
  | { type: 'forget'; query: string }
  | { type: 'invalid'; reason: string }

const NAMES = ['recordar', 'cancelar', 'pomodoro', 'accion', 'anotar', 'olvidar']
/** Etiquetas de acción: [nombre:arg1|arg2|…] */
export const ACTION_TAG = new RegExp(`\\[(${NAMES.join('|')}):([^\\]]*)\\]`, 'gi')

const PET: Record<string, 'dance' | 'sleep' | 'wave'> = {
  bailar: 'dance',
  baila: 'dance',
  dormir: 'sleep',
  duerme: 'sleep',
  saludar: 'wave',
  saluda: 'wave'
}

function minutes(s: string | undefined, min: number, max: number): number | undefined {
  if (!s) return undefined
  const n = Number(s.replace(/[^\d.]/g, ''))
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : undefined
}

function parseOne(name: string, argStr: string, now: number): Action {
  const args = argStr.split('|').map((a) => a.trim())
  switch (name) {
    case 'recordar': {
      const [when, text, rep] = args
      if (!text) return { type: 'invalid', reason: 'Faltó qué recordarte.' }
      const at = parseWhen(when ?? '', now)
      if (at === null) return { type: 'invalid', reason: `No entendí la hora "${when}" del recordatorio.` }
      const repeat = parseRepeat(rep)
      if (repeat === undefined) return { type: 'invalid', reason: `No entendí cada cuánto repetir "${rep}".` }
      if (at <= now && !repeat) return { type: 'invalid', reason: 'Esa hora ya pasó.' }
      return { type: 'reminder', at, text: text.slice(0, 300), repeat }
    }
    case 'cancelar':
      return args[0] ? { type: 'cancelReminder', query: args[0] } : { type: 'invalid', reason: 'Faltó qué cancelar.' }
    case 'pomodoro': {
      const cmd = (args[0] ?? '').toLowerCase()
      if (/^(iniciar|empezar|start|comenzar)$/.test(cmd)) {
        const a: Action = { type: 'pomodoroStart' }
        const f = minutes(args[1], 1, 180)
        const b = minutes(args[2], 1, 60)
        if (f) a.focusMin = f
        if (b) a.breakMin = b
        return a
      }
      if (/^(detener|parar|stop|terminar|cancelar)$/.test(cmd)) return { type: 'pomodoroStop' }
      return { type: 'invalid', reason: `No conozco el comando de Pomodoro "${cmd}".` }
    }
    case 'accion': {
      const what = PET[(args[0] ?? '').toLowerCase()]
      return what ? { type: 'pet', what } : { type: 'invalid', reason: `No sé hacer "${args[0]}".` }
    }
    case 'anotar':
      return args[0] ? { type: 'remember', fact: args.join(' ').slice(0, 200) } : { type: 'invalid', reason: 'Nada que anotar.' }
    case 'olvidar':
      return args[0] ? { type: 'forget', query: args[0] } : { type: 'invalid', reason: 'Faltó qué olvidar.' }
  }
  return { type: 'invalid', reason: `Acción desconocida: ${name}` }
}

/** Saca las etiquetas de acción del texto y las convierte en acciones. */
export function extractActions(raw: string, now: number): { text: string; actions: Action[] } {
  const actions: Action[] = []
  for (const m of raw.matchAll(ACTION_TAG)) actions.push(parseOne(m[1].toLowerCase(), m[2], now))
  const text = raw.replace(ACTION_TAG, '').replace(/[ \t]{2,}/g, ' ').trim()
  return { text, actions }
}
