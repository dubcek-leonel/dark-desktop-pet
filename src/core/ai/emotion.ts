import type { Emotion } from '../behavior'

const VALID: ReadonlySet<string> = new Set(['happy', 'sad', 'angry', 'surprised', 'neutral'])
const TAG = /\[emo:\s*([a-z]*)\s*\]/gi
const PARTIAL_AT_END = /\s*\[(?:e(?:m(?:o(?::\s*[a-z]*)?)?)?)?$/i

/** Separa la etiqueta [emo:x] del texto final. */
export function extractEmotion(raw: string): { text: string; emotion: Emotion } {
  let emotion: Emotion = 'neutral'
  for (const m of raw.matchAll(TAG)) {
    const e = m[1].toLowerCase()
    emotion = VALID.has(e) ? (e as Emotion) : 'neutral'
  }
  return { text: raw.replace(TAG, '').replace(/\s+$/, '').replace(/\s{2,}/g, ' ').trim(), emotion }
}

/** Texto para mostrar mientras llega el stream (sin etiquetas, ni completas ni a medias). */
export function displayText(partial: string): string {
  return partial.replace(TAG, '').replace(PARTIAL_AT_END, '').trimEnd()
}
