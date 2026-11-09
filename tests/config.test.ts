import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, normalizeConfig, PROVIDER_PRESETS } from '../src/core/config'

describe('config', () => {
  it('sin archivo usa los valores por defecto (Gemini, Dark sarcástico y flojo)', () => {
    const c = normalizeConfig(undefined)
    expect(c).toEqual(DEFAULT_CONFIG)
    expect(c.provider).toBe('gemini')
    expect(c.model).toBe('gemini-3.5-flash-lite')
    expect(c.baseUrl).toBe(PROVIDER_PRESETS.gemini.baseUrl)
    expect(c.name).toBe('Dark')
    expect(c.personality).toBe('sarcástico y algo flojo')
  })

  it('mantiene los valores válidos y descarta los inválidos', () => {
    const c = normalizeConfig({
      provider: 'ollama',
      model: 'qwen3:4b',
      baseUrl: 'http://127.0.0.1:11434',
      name: '  Nova ',
      scale: 9,
      sleepAfterMinutes: -3,
      startWithWindows: 'si',
      basura: 1
    })
    expect(c.provider).toBe('ollama')
    expect(c.model).toBe('qwen3:4b')
    expect(c.name).toBe('Nova')
    expect(c.scale).toBe(2)
    expect(c.sleepAfterMinutes).toBe(1)
    expect(c.startWithWindows).toBe(false)
    expect(c).not.toHaveProperty('basura')
  })

  it('memoria activada y Pomodoro 25/5 por defecto, con límites', () => {
    expect(normalizeConfig({})).toMatchObject({ memoryEnabled: true, pomodoroFocusMin: 25, pomodoroBreakMin: 5 })
    expect(normalizeConfig({ memoryEnabled: false, pomodoroFocusMin: 500, pomodoroBreakMin: 0 })).toMatchObject({
      memoryEnabled: false,
      pomodoroFocusMin: 90,
      pomodoroBreakMin: 1
    })
  })

  it('un proveedor desconocido vuelve al de por defecto', () => {
    expect(normalizeConfig({ provider: 'skynet' }).provider).toBe('gemini')
  })

  it('nombre o personalidad vacíos usan los de por defecto', () => {
    const c = normalizeConfig({ name: '   ', personality: '' })
    expect(c.name).toBe('Dark')
    expect(c.personality).toBe('sarcástico y algo flojo')
  })

  it('nunca guarda una API key dentro de la config', () => {
    expect(normalizeConfig({ apiKey: 'secreta' })).not.toHaveProperty('apiKey')
  })
})
