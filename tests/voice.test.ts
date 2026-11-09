import { describe, expect, it } from 'vitest'
import { encodeWav, resample } from '../src/core/voice/wav'
import { Vad } from '../src/core/voice/vad'
import { detectWake } from '../src/core/voice/wake'
import { speechParams, splitSentences, VOICES, WHISPER_MODELS } from '../src/core/voice/catalog'
import { createPet, handle, step, type Env, type Pet } from '../src/core/behavior'

describe('WAV', () => {
  it('codifica PCM 16 bits mono con cabecera RIFF correcta', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5]), 16000)
    const v = new DataView(wav.buffer)
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE')
    expect(v.getUint16(22, true)).toBe(1) // mono
    expect(v.getUint32(24, true)).toBe(16000)
    expect(v.getUint32(40, true)).toBe(8) // 4 muestras × 2 bytes
    expect(wav.length).toBe(44 + 8)
    expect(v.getInt16(46, true)).toBe(32767)
    expect(v.getInt16(48, true)).toBe(-32768)
  })

  it('remuestrea de 48 kHz a 16 kHz (un tercio de muestras)', () => {
    const src = new Float32Array(48000).map((_, i) => Math.sin(i / 10))
    const out = resample(src, 48000, 16000)
    expect(out.length).toBe(16000)
    expect(out[100]).toBeCloseTo(src[300], 1)
  })
})

describe('VAD (detección de voz)', () => {
  function feed(vad: Vad, levels: number[], dt = 50) {
    return levels.map((l) => vad.push(l, dt)).filter(Boolean)
  }

  it('detecta inicio con voz fuerte y fin tras un silencio', () => {
    const vad = new Vad({ silenceMs: 300 })
    const ev = feed(vad, [0.002, 0.002, 0.002, 0.05, 0.06, 0.05, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002])
    expect(ev).toEqual(['start', 'end'])
  })

  it('ignora ruidos muy cortos', () => {
    const vad = new Vad({ silenceMs: 300, minSpeechMs: 250 })
    const ev = feed(vad, [0.002, 0.002, 0.08, 0.002, 0.002, 0.002, 0.002, 0.002, 0.002])
    expect(ev).toEqual(['start', 'cancel'])
  })

  it('corta frases demasiado largas', () => {
    const vad = new Vad({ maxMs: 500 })
    const ev = feed(vad, Array(20).fill(0.05))
    expect(ev).toEqual(['start', 'end'])
  })

  it('se adapta al ruido de fondo', () => {
    const vad = new Vad()
    // Mucho ruido constante: no debería contarse como voz.
    const ev = feed(vad, Array(60).fill(0.03))
    expect(ev.filter((e) => e === 'start').length).toBeLessThanOrEqual(1)
    expect(feed(vad, Array(20).fill(0.03))).toEqual([])
  })
})

describe('palabra de activación', () => {
  it('reconoce "Dark" y variantes al inicio, y devuelve el resto como orden', () => {
    expect(detectWake('Dark, ¿qué hora es?', 'Dark')).toEqual({ woke: true, rest: '¿qué hora es?' })
    expect(detectWake(' Oye dark pon un pomodoro.', 'Dark')).toEqual({ woke: true, rest: 'pon un pomodoro.' })
    expect(detectWake('Darc recuérdame algo', 'Dark').woke).toBe(true)
    expect(detectWake('Dar, baila', 'Dark').woke).toBe(true)
    expect(detectWake('Dark.', 'Dark')).toEqual({ woke: true, rest: '' })
  })
  it('no se activa con frases normales', () => {
    expect(detectWake('hoy está oscuro', 'Dark').woke).toBe(false)
    expect(detectWake('me gusta el dark mode', 'Dark').woke).toBe(false)
    expect(detectWake('', 'Dark').woke).toBe(false)
  })
  it('funciona con otros nombres', () => {
    expect(detectWake('Nova, hola', 'Nova')).toEqual({ woke: true, rest: 'hola' })
  })
})

describe('catálogo y parámetros de voz', () => {
  it('hay voces en español con URLs de Piper y modelos de whisper', () => {
    expect(VOICES.length).toBeGreaterThanOrEqual(4)
    for (const v of VOICES) {
      expect(v.onnx).toMatch(/^https:\/\/huggingface\.co\/rhasspy\/piper-voices\/.+\.onnx$/)
      expect(v.id).toMatch(/^es_/)
    }
    expect(WHISPER_MODELS.map((m) => m.id)).toContain('base')
  })

  it('el tono cambia la velocidad de reproducción y Piper compensa la duración', () => {
    expect(speechParams(1, 1)).toEqual({ lengthScale: 1, playbackRate: 1 })
    const p = speechParams(1, 1.2)
    expect(p.playbackRate).toBe(1.2)
    expect(p.lengthScale).toBeCloseTo(1.2)
    // Hablar más rápido = menor length_scale
    expect(speechParams(1.25, 1).lengthScale).toBeCloseTo(0.8)
  })

  it('divide en frases para empezar a hablar antes', () => {
    expect(splitSentences('Hola. ¿Qué tal? Bien!  Ok')).toEqual(['Hola.', '¿Qué tal?', 'Bien!', 'Ok'])
    expect(splitSentences('   ')).toEqual([])
  })
})

const env: Env = {
  bounds: { x: 0, y: 0, width: 1920, height: 1040 },
  scale: 1,
  rand: () => 0.99,
  durationOf: (a) => ({ wave: 660 })[a] ?? 0,
  sleepAfterMs: 60_000
}
function run(p: Pet, ms: number): Pet {
  for (let t = 0; t < ms; t += 33) p = step(p, 33, env)
  return p
}

describe('Dark escuchando', () => {
  it('pone cara de escuchar y luego vuelve; la IA lo saca de escuchar', () => {
    let p = run(createPet(env, 500), 700)
    p = handle(p, { type: 'listening', on: true }, env)
    expect(p.state).toBe('listen')
    p = run(p, 10_000)
    expect(p.state).toBe('listen')
    p = handle(p, { type: 'listening', on: false }, env)
    expect(p.state).toBe('idle')
    p = handle(handle(p, { type: 'listening', on: true }, env), { type: 'aiThinking' }, env)
    expect(p.state).toBe('think')
  })
})
