import { describe, expect, it } from 'vitest'
import { buildExtractionMessages, mergeMemories, parseMemoryList } from '../src/core/memory'

describe('parseMemoryList', () => {
  it('lee un arreglo JSON de textos', () => {
    expect(parseMemoryList('["Se llama Leo", "Estudia ingeniería"]')).toEqual(['Se llama Leo', 'Estudia ingeniería'])
  })
  it('acepta el JSON dentro de un bloque ```json', () => {
    expect(parseMemoryList('Claro:\n```json\n["Le gusta el café"]\n```')).toEqual(['Le gusta el café'])
  })
  it('ignora basura, vacíos y no-textos', () => {
    expect(parseMemoryList('no sé')).toEqual([])
    expect(parseMemoryList('[1, "", "  ok  ", null]')).toEqual(['ok'])
  })
})

describe('mergeMemories', () => {
  it('agrega sin duplicar (sin importar mayúsculas ni el punto final)', () => {
    expect(mergeMemories(['Se llama Leo.'], ['se llama leo', 'Tiene un gato'])).toEqual([
      'Se llama Leo.',
      'Tiene un gato'
    ])
  })
  it('respeta el máximo quitando los más viejos', () => {
    expect(mergeMemories(['a1', 'b2', 'c3'], ['d4'], 3)).toEqual(['b2', 'c3', 'd4'])
  })
  it('recorta textos muy largos', () => {
    expect(mergeMemories([], ['x'.repeat(500)])[0].length).toBe(200)
  })
})

describe('buildExtractionMessages', () => {
  it('incluye lo que ya sabe y la conversación, y pide solo JSON', () => {
    const msgs = buildExtractionMessages(
      [
        { role: 'user', content: 'me llamo Leo' },
        { role: 'assistant', content: 'Qué emoción.' }
      ],
      ['Le gusta el café']
    )
    const all = msgs.map((m) => m.content).join('\n')
    expect(all).toContain('me llamo Leo')
    expect(all).toContain('Le gusta el café')
    expect(all).toMatch(/JSON/)
  })
})
