import { describe, expect, it } from 'vitest'
import { displayText } from '../src/core/ai/emotion'
import { extractActions } from '../src/core/actions'
import { nextOccurrence, parseWhen } from '../src/core/reminders'

// domingo 8 nov 2026, 21:00 hora local
const NOW = new Date(2026, 10, 8, 21, 0, 0).getTime()
const MIN = 60_000

describe('parseWhen', () => {
  it('relativo: +20m, 20m, +2h, +1h30m, "+20 min"', () => {
    expect(parseWhen('+20m', NOW)).toBe(NOW + 20 * MIN)
    expect(parseWhen('20m', NOW)).toBe(NOW + 20 * MIN)
    expect(parseWhen('+20 min', NOW)).toBe(NOW + 20 * MIN)
    expect(parseWhen('+2h', NOW)).toBe(NOW + 120 * MIN)
    expect(parseWhen('+1h30m', NOW)).toBe(NOW + 90 * MIN)
    expect(parseWhen('+30s', NOW)).toBe(NOW + 30_000)
  })
  it('hora de hoy, o de mañana si ya pasó; "mañana HH:MM"', () => {
    expect(new Date(parseWhen('22:30', NOW)!).getDate()).toBe(8)
    expect(new Date(parseWhen('08:00', NOW)!).getDate()).toBe(9)
    const m = new Date(parseWhen('mañana 22:30', NOW)!)
    expect([m.getDate(), m.getHours(), m.getMinutes()]).toEqual([9, 22, 30])
  })
  it('fecha completa e inválidos', () => {
    expect(parseWhen('2026-11-10 09:15', NOW)).toBe(new Date(2026, 10, 10, 9, 15).getTime())
    expect(parseWhen('ayer', NOW)).toBeNull()
  })
})

describe('nextOccurrence', () => {
  it('diario, semanal y cada N minutos saltan al siguiente futuro', () => {
    expect(nextOccurrence({ at: NOW - 1, repeat: { kind: 'daily' } }, NOW)).toBe(NOW - 1 + 86_400_000)
    expect(nextOccurrence({ at: NOW - 1, repeat: { kind: 'weekly' } }, NOW)).toBe(NOW - 1 + 7 * 86_400_000)
    expect(nextOccurrence({ at: NOW - 45 * MIN, repeat: { kind: 'every', ms: 30 * MIN } }, NOW)).toBe(NOW + 15 * MIN)
    expect(nextOccurrence({ at: NOW, repeat: null }, NOW)).toBeNull()
  })
})

describe('extractActions', () => {
  it('recordatorio simple y repetido', () => {
    const r = extractActions('Ya voy. [recordar:+20m|tomar agua] [emo:sad]', NOW)
    expect(r.actions).toEqual([{ type: 'reminder', at: NOW + 20 * MIN, text: 'tomar agua', repeat: null }])
    expect(r.text).toBe('Ya voy. [emo:sad]')
    const d = extractActions('[recordar:08:00|tomar pastilla|diario]', NOW).actions[0]
    expect(d).toMatchObject({ type: 'reminder', text: 'tomar pastilla', repeat: { kind: 'daily' } })
    const e = extractActions('[recordar:+1h|estirarse|cada 1h]', NOW).actions[0]
    expect(e).toMatchObject({ repeat: { kind: 'every', ms: 60 * MIN } })
  })

  it('recordatorio con hora inválida o pasada → acción inválida con motivo', () => {
    const r = extractActions('Ok [recordar:cuando sea|x] [recordar:2020-01-01 10:00|viejo]', NOW)
    expect(r.actions.map((a) => a.type)).toEqual(['invalid', 'invalid'])
    expect(r.text).toBe('Ok')
  })

  it('cancelar, pomodoro, animaciones, anotar y olvidar', () => {
    const r = extractActions(
      'Listo [cancelar:agua] [pomodoro:iniciar|50|10] [pomodoro:detener] [accion:bailar] [anotar:Su cumpleaños es el 5 de mayo] [olvidar:café]',
      NOW
    )
    expect(r.actions).toEqual([
      { type: 'cancelReminder', query: 'agua' },
      { type: 'pomodoroStart', focusMin: 50, breakMin: 10 },
      { type: 'pomodoroStop' },
      { type: 'pet', what: 'dance' },
      { type: 'remember', fact: 'Su cumpleaños es el 5 de mayo' },
      { type: 'forget', query: 'café' }
    ])
    expect(r.text).toBe('Listo')
  })

  it('pomodoro sin minutos usa los de ajustes; acciones desconocidas son inválidas', () => {
    expect(extractActions('[pomodoro:iniciar]', NOW).actions[0]).toEqual({ type: 'pomodoroStart' })
    expect(extractActions('[accion:volar]', NOW).actions[0].type).toBe('invalid')
  })

  it('no toca corchetes normales ni la emoción', () => {
    expect(extractActions('Uso [corchetes] [emo:happy]', NOW)).toEqual({
      text: 'Uso [corchetes] [emo:happy]',
      actions: []
    })
  })
})

describe('displayText', () => {
  it('oculta etiquetas de acciones completas y a medias', () => {
    expect(displayText('Listo [recordar:+5m|agua]')).toBe('Listo')
    expect(displayText('Listo [pomodoro:inic')).toBe('Listo')
    expect(displayText('Listo [acc')).toBe('Listo')
    expect(displayText('Listo [accion:bailar] y ya')).toBe('Listo y ya')
  })
})
