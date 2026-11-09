export type Repeat = { kind: 'daily' } | { kind: 'weekly' } | { kind: 'every'; ms: number }

export interface ReminderRequest {
  at: number
  text: string
  repeat?: Repeat | null
}

export interface Reminder extends ReminderRequest {
  id: string
  createdAt: number
}

const DAY = 86_400_000
const UNIT_MS: Array<[RegExp, number]> = [
  [/^(h|hr|hrs|hora|horas)$/, 3_600_000],
  [/^(m|min|mins|minuto|minutos)$/, 60_000],
  [/^(s|seg|segs|segundo|segundos)$/, 1000]
]

function unitMs(u: string): number | null {
  for (const [re, ms] of UNIT_MS) if (re.test(u)) return ms
  return null
}

/** Duración tipo "1h30m", "20 min", "45s" → ms. */
function parseDuration(s: string): number | null {
  const parts = [...s.matchAll(/(\d+(?:[.,]\d+)?)\s*([a-z]+)/g)]
  if (parts.length === 0 || parts.map((p) => p[0]).join('').replace(/\s/g, '') !== s.replace(/\s/g, '')) return null
  let total = 0
  for (const p of parts) {
    const ms = unitMs(p[2])
    if (ms === null) return null
    total += Number(p[1].replace(',', '.')) * ms
  }
  return total > 0 ? total : null
}

function atTime(base: number, h: number, m: number): number | null {
  if (h > 23 || m > 59) return null
  const d = new Date(base)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

/**
 * Convierte el "cuándo" de un recordatorio en una fecha (ms):
 * "+20m", "20 min", "+1h30m", "22:30" (hoy o mañana si ya pasó), "mañana 08:00", "2026-11-10 09:15".
 */
export function parseWhen(when: string, now: number): number | null {
  const w = when.trim().toLowerCase()
  const rel = parseDuration(w.replace(/^\+\s*/, '').replace(/^en\s+/, ''))
  if (rel !== null) return now + rel

  let m = w.match(/^(\d{1,2}):(\d{2})$/)
  if (m) {
    const t = atTime(now, Number(m[1]), Number(m[2]))
    if (t === null) return null
    return t <= now ? t + DAY : t
  }
  m = w.match(/^ma[ñn]ana\s+(\d{1,2}):(\d{2})$/)
  if (m) {
    const t = atTime(now + DAY, Number(m[1]), Number(m[2]))
    return t
  }
  m = w.match(/^(\d{4})-(\d{2})-(\d{2})[ t](\d{1,2}):(\d{2})$/)
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0)
    return Number.isNaN(d.getTime()) ? null : d.getTime()
  }
  return null
}

/** "diario", "semanal", "cada 30m", "cada 2 horas" → Repeat. */
export function parseRepeat(s: string | undefined): Repeat | null | undefined {
  if (!s || !s.trim()) return null
  const w = s.trim().toLowerCase()
  if (/^(diario|diaria|cada d[ií]a|todos los d[ií]as)$/.test(w)) return { kind: 'daily' }
  if (/^(semanal|cada semana|todas las semanas)$/.test(w)) return { kind: 'weekly' }
  const m = w.match(/^cada\s+(.+)$/)
  if (m) {
    const ms = parseDuration(m[1])
    if (ms !== null && ms >= 60_000) return { kind: 'every', ms }
  }
  return undefined // no se entendió
}

function stepMs(r: Repeat): number {
  return r.kind === 'daily' ? DAY : r.kind === 'weekly' ? 7 * DAY : r.ms
}

/** Próxima vez que toca un recordatorio que se repite (null si no se repite). */
export function nextOccurrence(r: { at: number; repeat?: Repeat | null }, now: number): number | null {
  if (!r.repeat) return null
  const step = stepMs(r.repeat)
  const n = Math.floor((now - r.at) / step) + 1
  return r.at + Math.max(1, n) * step
}

export function describeRepeat(r: Repeat | null | undefined): string {
  if (!r) return ''
  if (r.kind === 'daily') return 'todos los días'
  if (r.kind === 'weekly') return 'cada semana'
  const min = Math.round(r.ms / 60_000)
  return min % 60 === 0 ? `cada ${min / 60} h` : `cada ${min} min`
}

/** Recordatorios que ya tocan. */
export function dueReminders(list: Reminder[], now: number): Reminder[] {
  return list.filter((r) => r.at <= now)
}

export function formatWhen(at: number, now: number): string {
  const d = new Date(at)
  const hm = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (d.toDateString() === new Date(now).toDateString()) return `hoy ${hm}`
  if (d.toDateString() === tomorrow.toDateString()) return `mañana ${hm}`
  return `${d.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })} ${hm}`
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()

/** ¿El texto coincide con lo que el usuario quiere cancelar u olvidar? */
export function matches(text: string, query: string): boolean {
  const a = norm(text)
  const b = norm(query)
  return b !== '' && (a.includes(b) || b.includes(a))
}
