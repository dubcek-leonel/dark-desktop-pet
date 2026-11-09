/**
 * Prueba en vivo contra Gemini (se salta si no hay key).
 * Ejecutar:  $env:GEMINI_KEY="..."; npx vitest run tests/live.gemini.test.ts
 */
import { describe, expect, it } from 'vitest'
import { extractActions } from '../src/core/actions'
import { buildSystemPrompt } from '../src/core/ai/persona'
import { createOpenAICompat } from '../src/core/ai/openaiCompat'

const KEY = process.env.GEMINI_KEY
const ai = createOpenAICompat({
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  apiKey: KEY ?? '',
  model: process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite'
})

async function ask(q: string, context: string[] = ['No hay recordatorios pendientes.', 'Pomodoro: apagado.']) {
  const now = new Date()
  const sys = buildSystemPrompt({ name: 'Dark', personality: 'sarcástico y algo flojo', now, context })
  const raw = await ai.chat(
    [
      { role: 'system', content: sys },
      { role: 'user', content: q }
    ],
    () => {}
  )
  const r = extractActions(raw, now.getTime())
  console.log(`> ${q}\n  ${raw.replace(/\n/g, ' ')}\n  → ${JSON.stringify(r.actions)}`)
  return r.actions
}

describe.skipIf(!KEY)('Gemini en vivo', () => {
  it('recordatorio en minutos', async () => {
    const a = await ask('recuérdame tomar agua en 20 minutos')
    expect(a).toContainEqual(expect.objectContaining({ type: 'reminder' }))
  })
  it('recordatorio diario', async () => {
    const a = await ask('todos los días a las 9 de la noche recuérdame tomar la pastilla')
    expect(a).toContainEqual(expect.objectContaining({ type: 'reminder', repeat: { kind: 'daily' } }))
  })
  it('sin hora: pregunta en vez de inventar', async () => {
    const a = await ask('recuérdame comprar pan')
    expect(a.filter((x) => x.type === 'reminder')).toHaveLength(0)
  })
  it('pomodoro con minutos', async () => {
    const a = await ask('pon un pomodoro de 45 minutos con 10 de descanso')
    expect(a).toContainEqual({ type: 'pomodoroStart', focusMin: 45, breakMin: 10 })
  })
  it('detener pomodoro', async () => {
    const a = await ask('ya para el pomodoro', ['Pomodoro activo (25/5), ciclo 1: foco, faltan 12:00.'])
    expect(a).toContainEqual({ type: 'pomodoroStop' })
  })
  it('cancelar recordatorio', async () => {
    const a = await ask('cancela el recordatorio del agua', ['Recordatorios pendientes: hoy 22:10 "tomar agua"'])
    expect(a).toContainEqual(expect.objectContaining({ type: 'cancelReminder' }))
  })
  it('bailar', async () => {
    const a = await ask('baila un poco')
    expect(a).toContainEqual({ type: 'pet', what: 'dance' })
  })
  it('anotar dato', async () => {
    const a = await ask('acuérdate que mi cumpleaños es el 5 de mayo')
    expect(a).toContainEqual(expect.objectContaining({ type: 'remember' }))
  })
  it('responde sobre el estado', async () => {
    const a = await ask('¿qué recordatorios tengo?', ['Recordatorios pendientes: hoy 22:10 "tomar agua"'])
    expect(a.filter((x) => x.type !== 'invalid')).toHaveLength(0)
  })
}, 60_000)
