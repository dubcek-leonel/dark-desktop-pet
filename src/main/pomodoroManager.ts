import { advance, OFF, remaining, startPomodoro, type Pomodoro, type PomodoroConfig } from '../core/pomodoro'

export interface PomodoroHooks {
  onFocusStart: (cycle: number, cfg: PomodoroConfig) => void
  onBreakStart: (cycle: number, cfg: PomodoroConfig) => void
  onStop: () => void
  /** Cada segundo, con el estado actual (para la bandeja). */
  onTick: (p: Pomodoro, remainingMs: number) => void
}

export class PomodoroManager {
  private p: Pomodoro = OFF
  private timer: ReturnType<typeof setInterval> | null = null
  /** Minutos pedidos por chat para esta sesión (si no, los de ajustes). */
  private override: Partial<PomodoroConfig> = {}

  constructor(
    private getConfig: () => PomodoroConfig,
    private hooks: PomodoroHooks
  ) {}

  get state(): Pomodoro {
    return this.p
  }

  config(): PomodoroConfig {
    return { ...this.getConfig(), ...this.override }
  }

  isRunning(): boolean {
    return this.p.phase !== 'off'
  }

  remainingMs(): number {
    return remaining(this.p, Date.now())
  }

  start(override: Partial<PomodoroConfig> = {}): void {
    this.override = override
    this.p = startPomodoro(Date.now(), this.config())
    this.hooks.onFocusStart(this.p.cycle, this.config())
    if (!this.timer) this.timer = setInterval(() => this.tick(), 1000)
    this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.p = OFF
    this.override = {}
    this.hooks.onStop()
  }

  private tick(): void {
    const now = Date.now()
    const { next, event } = advance(this.p, now, this.config())
    this.p = next
    if (event === 'breakStart') this.hooks.onBreakStart(next.cycle, this.config())
    if (event === 'focusStart') this.hooks.onFocusStart(next.cycle, this.config())
    this.hooks.onTick(this.p, remaining(this.p, now))
  }
}
