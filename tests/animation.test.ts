import { describe, expect, it } from 'vitest'
import { animDurationMs, frameAt, type SpriteSheet } from '../src/core/animation'
import dark from '../assets/character/dark/dark.json'

const sheet: SpriteSheet = {
  frameWidth: 256,
  frameHeight: 256,
  animations: {
    idle: { frames: 4, durationMs: 100, loop: true, row: 0 },
    land: { frames: 3, durationMs: 50, loop: false, row: 2 }
  }
}

describe('frameAt', () => {
  it('avanza un frame cada durationMs', () => {
    expect(frameAt(sheet, 'idle', 0)).toMatchObject({ col: 0, row: 0, finished: false })
    expect(frameAt(sheet, 'idle', 99).col).toBe(0)
    expect(frameAt(sheet, 'idle', 100).col).toBe(1)
    expect(frameAt(sheet, 'idle', 350).col).toBe(3)
  })

  it('las animaciones en loop vuelven al frame 0', () => {
    expect(frameAt(sheet, 'idle', 400).col).toBe(0)
    expect(frameAt(sheet, 'idle', 1050).col).toBe(2)
    expect(frameAt(sheet, 'idle', 10_000).finished).toBe(false)
  })

  it('las animaciones sin loop se quedan en el último frame y avisan que terminaron', () => {
    expect(frameAt(sheet, 'land', 120)).toMatchObject({ col: 2, row: 2, finished: false })
    expect(frameAt(sheet, 'land', 150)).toMatchObject({ col: 2, finished: true })
    expect(frameAt(sheet, 'land', 9_999)).toMatchObject({ col: 2, finished: true })
  })

  it('una animación desconocida usa idle', () => {
    expect(frameAt(sheet, 'nope', 100)).toMatchObject({ row: 0, col: 1 })
  })

  it('un tiempo negativo se trata como 0', () => {
    expect(frameAt(sheet, 'idle', -50).col).toBe(0)
  })
})

describe('animDurationMs', () => {
  it('es frames × durationMs', () => {
    expect(animDurationMs(sheet, 'land')).toBe(150)
    expect(animDurationMs(sheet, 'idle')).toBe(400)
  })
})

describe('dark.json real', () => {
  it('cada animación tiene una fila distinta dentro del atlas de 22 filas', () => {
    const rows = Object.values(dark.animations).map((a) => a.row)
    expect(new Set(rows).size).toBe(22)
    for (const a of Object.values(dark.animations)) {
      expect(a.frames).toBeGreaterThan(0)
      expect(a.frames).toBeLessThanOrEqual(8)
    }
  })
})
