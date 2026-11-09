import { advance, OFF, remaining, startPomodoro, type Pomodoro, type PomodoroConfig } from '../core/pomodoro'

export interface PomodoroHooks {
  onFocusStart: (cycle: number) => void
  onBreakStart: (cycle: number) => void
  onStop: () => void
  /** Cada segundo, con el estado actual (para la bandeja). */
  onTick: (p: Pomodoro, remainingMs: number) => void
}

export class PomodoroManager {
  private p: Pomodoro = OFF
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private getConfig: () => PomodoroConfig,
    private hooks: PomodoroHooks
  ) {}

  get state(): Pomodoro {
    return this.p
  }

  isRunning(): boolean {
    return this.p.phase !== 'off'
  }

  start(): void {
    this.p = startPomodoro(Date.now(), this.getConfig())
    this.hooks.onFocusStart(this.p.cycle)
    if (!this.timer) this.timer = setInterval(() => this.tick(), 1000)
    this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.p = OFF
    this.hooks.onStop()
  }

  private tick(): void {
    const now = Date.now()
    const { next, event } = advance(this.p, now, this.getConfig())
    this.p = next
    if (event === 'breakStart') this.hooks.onBreakStart(next.cycle)
    if (event === 'focusStart') this.hooks.onFocusStart(next.cycle)
    this.hooks.onTick(this.p, remaining(this.p, now))
  }
}
