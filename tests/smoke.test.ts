import { describe, expect, it } from 'vitest'
import dark from '../assets/character/dark/dark.json'

describe('assets de Dark', () => {
  it('trae las 22 animaciones con frames de 256x256', () => {
    expect(Object.keys(dark.animations)).toHaveLength(22)
    expect(dark.frameWidth).toBe(256)
    expect(dark.frameHeight).toBe(256)
  })
})
