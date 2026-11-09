import { describe, expect, it } from 'vitest'
import { advance, formatRemaining, OFF, remaining, startPomodoro } from '../src/core/pomodoro'
import { createPet, handle, step, type Env, type Pet } from '../src/core/behavior'

const MIN = 60_000
const cfg = { focusMin: 25, breakMin: 5 }

describe('pomodoro', () => {
  it('empieza en foco y cambia a descanso al terminar', () => {
    let p = startPomodoro(0, cfg)
    expect(p).toMatchObject({ phase: 'focus', endsAt: 25 * MIN, cycle: 1 })
    let r = advance(p, 24 * MIN, cfg)
    expect(r.event).toBeNull()
    r = advance(p, 25 * MIN, cfg)
    expect(r.event).toBe('breakStart')
    p = r.next
    expect(p).toMatchObject({ phase: 'break', endsAt: 30 * MIN })
    r = advance(p, 30 * MIN, cfg)
    expect(r.event).toBe('focusStart')
    expect(r.next).toMatchObject({ phase: 'focus', cycle: 2, endsAt: 55 * MIN })
  })

  it('apagado no hace nada', () => {
    expect(advance(OFF, 999 * MIN, cfg)).toEqual({ next: OFF, event: null })
  })

  it('tiempo restante en mm:ss', () => {
    const p = startPomodoro(0, cfg)
    expect(remaining(p, 60_000)).toBe(24 * MIN)
    expect(formatRemaining(24 * MIN + 5_000)).toBe('24:05')
    expect(formatRemaining(-5)).toBe('00:00')
  })
})

const env: Env = {
  bounds: { x: 0, y: 0, width: 1920, height: 1040 },
  scale: 1,
  rand: () => 0.99,
  durationOf: (a) => ({ wave: 660, click: 400 })[a] ?? 0,
  sleepAfterMs: 5_000
}
function run(p: Pet, ms: number): Pet {
  for (let t = 0; t < ms; t += 33) p = step(p, 33, env)
  return p
}

describe('Dark trabajando', () => {
  it('durante el foco trabaja, no se duerme, y vuelve a trabajar después de un clic', () => {
    let p = run(createPet(env, 500), 700)
    p = handle(p, { type: 'work', on: true }, env)
    expect(p.state).toBe('work')
    p = run(p, 60_000)
    expect(p.state).toBe('work')
    p = handle(p, { type: 'click' }, env)
    expect(p.state).toBe('click')
    p = run(p, 500)
    expect(p.state).toBe('work')
  })

  it('al terminar el foco vuelve a la normalidad', () => {
    let p = handle(run(createPet(env, 500), 700), { type: 'work', on: true }, env)
    p = handle(p, { type: 'work', on: false }, env)
    expect(p.state).toBe('idle')
  })

  it('un aviso (recordatorio) lo hace saludar, o despertar si dormía', () => {
    let p = run(createPet(env, 500), 700)
    expect(handle(p, { type: 'alert' }, env).state).toBe('wave')
    p = run(p, 7_000)
    expect(p.state).toBe('sleep')
    expect(handle(p, { type: 'alert' }, env).state).toBe('wake_up')
  })

  it('se duerme por orden', () => {
    const p = run(createPet(env, 500), 700)
    expect(handle(p, { type: 'sleep' }, env).state).toBe('yawn')
    expect(run(handle(p, { type: 'sleep' }, env), 100).state).toBe('sleep')
  })

  it('la IA tiene prioridad: piensa y luego vuelve a trabajar', () => {
    let p = handle(run(createPet(env, 500), 700), { type: 'work', on: true }, env)
    p = handle(p, { type: 'aiThinking' }, env)
    expect(p.state).toBe('think')
    p = handle(p, { type: 'aiDone', emotion: 'neutral' }, env)
    expect(p.state).toBe('work')
  })
})
