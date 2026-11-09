export interface ReminderRequest {
  at: number
  text: string
}

export interface Reminder extends ReminderRequest {
  id: string
  createdAt: number
}

export const REMINDER_TAG = /\[recordar:\s*([^|\]]*?)\s*\|\s*([^\]]*?)\s*\]/gi

/** Convierte "+20m", "+2h", "22:30" o "2026-11-10 09:15" en una fecha (ms). */
export function parseWhen(when: string, now: number): number | null {
  const w = when.trim()
  let m = w.match(/^\+\s*(\d+(?:\.\d+)?)\s*(m|min|mins|minutos?|h|hr|horas?)$/i)
  if (m) {
    const n = Number(m[1])
    return now + n * (/^h/i.test(m[2]) ? 3_600_000 : 60_000)
  }
  m = w.match(/^(\d{1,2}):(\d{2})$/)
  if (m) {
    const d = new Date(now)
    d.setHours(Number(m[1]), Number(m[2]), 0, 0)
    if (d.getTime() <= now) d.setDate(d.getDate() + 1)
    return d.getTime()
  }
  m = w.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/)
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0)
    return Number.isNaN(d.getTime()) ? null : d.getTime()
  }
  return null
}

/** Saca las etiquetas [recordar:cuándo|qué] del texto y devuelve los recordatorios válidos. */
export function extractReminders(raw: string, now: number): { text: string; reminders: ReminderRequest[] } {
  const reminders: ReminderRequest[] = []
  for (const m of raw.matchAll(REMINDER_TAG)) {
    const at = parseWhen(m[1], now)
    const text = m[2].trim().slice(0, 300)
    if (at !== null && at > now && text) reminders.push({ at, text })
  }
  const text = raw.replace(REMINDER_TAG, '').replace(/[ \t]{2,}/g, ' ').trim()
  return { text, reminders }
}

/** Recordatorios que ya tocan. */
export function dueReminders(list: Reminder[], now: number): Reminder[] {
  return list.filter((r) => r.at <= now)
}

export function formatWhen(at: number, now: number): string {
  const d = new Date(at)
  const hm = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  const today = new Date(now)
  const sameDay = d.toDateString() === today.toDateString()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (sameDay) return `hoy ${hm}`
  if (d.toDateString() === tomorrow.toDateString()) return `mañana ${hm}`
  return `${d.toLocaleDateString('es', { day: 'numeric', month: 'short' })} ${hm}`
}
