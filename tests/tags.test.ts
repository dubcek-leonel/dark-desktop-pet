import { describe, expect, it } from 'vitest'
import { displayText } from '../src/core/ai/emotion'
import { extractReminders } from '../src/core/reminders'

// 8 nov 2026, 21:00 hora local
const NOW = new Date(2026, 10, 8, 21, 0, 0).getTime()

describe('extractReminders', () => {
  it('relativo en minutos y horas', () => {
    const r = extractReminders('Ya voy. [recordar:+20m|tomar agua] [emo:sad]', NOW)
    expect(r.reminders).toEqual([{ at: NOW + 20 * 60_000, text: 'tomar agua' }])
    expect(r.text).toBe('Ya voy. [emo:sad]')
    expect(extractReminders('[recordar:+2h|dormir]', NOW).reminders[0].at).toBe(NOW + 2 * 3_600_000)
  })

  it('hora absoluta de hoy, o de mañana si ya pasó', () => {
    const today = extractReminders('[recordar:22:30|llamar a mamá]', NOW).reminders[0]
    expect(new Date(today.at).getHours()).toBe(22)
    expect(new Date(today.at).getDate()).toBe(8)
    const tomorrow = extractReminders('[recordar:08:00|gym]', NOW).reminders[0]
    expect(new Date(tomorrow.at).getDate()).toBe(9)
  })

  it('fecha y hora completas', () => {
    const r = extractReminders('[recordar:2026-11-10 09:15|examen]', NOW).reminders[0]
    expect(r.at).toBe(new Date(2026, 10, 10, 9, 15).getTime())
  })

  it('ignora etiquetas inválidas o en el pasado, pero las quita del texto', () => {
    const r = extractReminders('Ok [recordar:ayer|x] [recordar:2020-01-01 10:00|viejo]', NOW)
    expect(r.reminders).toEqual([])
    expect(r.text).toBe('Ok')
  })
})

describe('displayText con recordatorios', () => {
  it('oculta etiquetas de recordatorio completas y a medias', () => {
    expect(displayText('Listo [recordar:+5m|agua]')).toBe('Listo')
    expect(displayText('Listo [recor')).toBe('Listo')
    expect(displayText('Listo [recordar:+5m|ag')).toBe('Listo')
  })
})
