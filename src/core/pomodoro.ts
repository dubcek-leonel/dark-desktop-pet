export type Phase = 'off' | 'focus' | 'break'

export interface Pomodoro {
  phase: Phase
  endsAt: number
  cycle: number
}

export interface PomodoroConfig {
  focusMin: number
  breakMin: number
}

export const OFF: Pomodoro = { phase: 'off', endsAt: 0, cycle: 0 }

const MIN = 60_000

export function startPomodoro(now: number, cfg: PomodoroConfig): Pomodoro {
  return { phase: 'focus', endsAt: now + cfg.focusMin * MIN, cycle: 1 }
}

/** Pasa a la siguiente fase si ya terminó la actual. */
export function advance(
  p: Pomodoro,
  now: number,
  cfg: PomodoroConfig
): { next: Pomodoro; event: null | 'breakStart' | 'focusStart' } {
  if (p.phase === 'off' || now < p.endsAt) return { next: p, event: null }
  if (p.phase === 'focus') {
    return { next: { phase: 'break', endsAt: p.endsAt + cfg.breakMin * MIN, cycle: p.cycle }, event: 'breakStart' }
  }
  return { next: { phase: 'focus', endsAt: p.endsAt + cfg.focusMin * MIN, cycle: p.cycle + 1 }, event: 'focusStart' }
}

export function remaining(p: Pomodoro, now: number): number {
  return p.phase === 'off' ? 0 : Math.max(0, p.endsAt - now)
}

export function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
