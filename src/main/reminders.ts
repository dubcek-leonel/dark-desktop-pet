import { randomUUID } from 'node:crypto'
import { dueReminders, type Reminder, type ReminderRequest } from '../core/reminders'
import { loadReminders, saveReminders } from './store'

const CHECK_MS = 10_000

/** Guarda los recordatorios en disco y avisa cuando toca alguno (también los atrasados al abrir). */
export class ReminderManager {
  private list: Reminder[] = []
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private onFire: (r: Reminder, late: boolean) => void) {}

  start(): void {
    this.list = loadReminders()
    // Los que vencieron con la app cerrada se avisan al abrir, marcados como atrasados.
    const now = Date.now()
    for (const r of dueReminders(this.list, now)) this.fire(r, now - r.at > 60_000)
    this.timer = setInterval(() => this.check(), CHECK_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  all(): Reminder[] {
    return [...this.list].sort((a, b) => a.at - b.at)
  }

  add(reqs: ReminderRequest[]): Reminder[] {
    const created = reqs.map((r) => ({ ...r, id: randomUUID(), createdAt: Date.now() }))
    this.list.push(...created)
    saveReminders(this.list)
    return created
  }

  remove(id: string): void {
    this.list = this.list.filter((r) => r.id !== id)
    saveReminders(this.list)
  }

  private check(): void {
    for (const r of dueReminders(this.list, Date.now())) this.fire(r, false)
  }

  private fire(r: Reminder, late: boolean): void {
    this.remove(r.id)
    this.onFire(r, late)
  }
}
