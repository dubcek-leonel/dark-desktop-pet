import { describe, expect, it } from 'vitest'
import { dialoguePages } from '../src/core/dialogue'
describe('readable answer pages', () => {
  it('keeps short answers intact', () => expect(dialoguePages('Hola.')).toEqual(['Hola.']))
  it('preserves the words of long answers while allowing each page to be read', () => {
    const text = 'Primero una frase. Luego otra explicación con más detalles. '.repeat(30).trim()
    const pages = dialoguePages(text, 100)
    expect(pages.length).toBeGreaterThan(1)
    expect(pages.every((page) => Array.from(page).length <= 100)).toBe(true)
    expect(pages.join(' ')).toBe(text)
  })
  it('does not split emoji surrogate pairs in long uninterrupted text', () => {
    const text = '🌟'.repeat(300)
    expect(dialoguePages(text, 80).join('')).toBe(text)
    expect(dialoguePages(text, 80).every((page) => Array.from(page).length <= 80)).toBe(true)
  })
})
