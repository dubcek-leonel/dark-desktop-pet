import { randomUUID } from 'node:crypto'
import { dueReminders, matches, nextOccurrence, type Reminder, type ReminderRequest } from '../core/reminders'
import { loadReminders, saveReminders } from './store'

const CHECK_MS = 5_000

/** Guarda los recordatorios en disco y avisa cuando toca alguno (también los atrasados al abrir). */
export class ReminderManager {
  private list: Reminder[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private started = false

  constructor(private onFire: (r: Reminder, late: boolean) => void) {
    this.list = loadReminders()
  }

  start(): void {
    this.started = true
    this.check(true)
    this.timer = setInterval(() => this.check(false), CHECK_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  all(): Reminder[] {
    return [...this.list].sort((a, b) => a.at - b.at)
  }

  add(reqs: ReminderRequest[]): Reminder[] {
    const created = reqs.map((r) => ({ ...r, repeat: r.repeat ?? null, id: randomUUID(), createdAt: Date.now() }))
    this.list.push(...created)
    saveReminders(this.list)
    return created
  }

  remove(id: string): void {
    this.list = this.list.filter((r) => r.id !== id)
    saveReminders(this.list)
  }

  /** Cancela los que coinciden con el texto ("todos" = todos). Devuelve los cancelados. */
  cancel(query: string): Reminder[] {
    const all = /^(todos|todo|all)$/i.test(query.trim())
    const gone = this.list.filter((r) => all || matches(r.text, query))
    if (gone.length) {
      const ids = new Set(gone.map((r) => r.id))
      this.list = this.list.filter((r) => !ids.has(r.id))
      saveReminders(this.list)
    }
    return gone
  }

  private check(atStartup: boolean): void {
    if (!this.started) return
    const now = Date.now()
    const due = dueReminders(this.list, now)
    if (!due.length) return
    const fired = due.map((r) => ({ ...r })) // copia con la hora original
    for (const r of due) {
      const next = nextOccurrence(r, now)
      if (next === null) this.list = this.list.filter((x) => x.id !== r.id)
      else r.at = next // los repetidos se reprograman
    }
    saveReminders(this.list)
    // Los que vencieron con la app cerrada se avisan al abrir, marcados como atrasados.
    for (const r of fired) this.onFire(r, atStartup && now - r.at > 60_000)
  }
}
