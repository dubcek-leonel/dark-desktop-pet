import type { FetchLike } from '../ai/types'

export const GEMINI_NATIVE = 'https://generativelanguage.googleapis.com/v1beta'
export const GEMINI_TTS_MODELS = ['gemini-3.8-flash-tts', 'gemini-3.1-flash-tts-preview']

/** Envuelve PCM de 16 bits mono en un WAV. */
export function wavFromPcm16(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length)
  const v = new DataView(out.buffer)
  const str = (o: number, s: string): void => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + pcm.length, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, pcm.length, true)
  out.set(pcm, 44)
  return out
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

interface GenResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> } }>
  error?: { message?: string }
}

async function generate(fetchImpl: FetchLike, apiKey: string, model: string, body: unknown): Promise<GenResponse> {
  const r = await fetchImpl(`${GEMINI_NATIVE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body)
  })
  const j = (await r.json().catch(() => ({}))) as GenResponse
  if (!r.ok) throw new Error(j.error?.message ?? `Gemini respondió ${r.status}`)
  return j
}

/** Voz natural de Gemini. Devuelve un WAV. */
export async function geminiSpeak(o: {
  apiKey: string
  voice: string
  text: string
  languageCode?: string
  fetchImpl?: FetchLike
}): Promise<Uint8Array> {
  const fetchImpl = o.fetchImpl ?? ((u, i) => fetch(u, i))
  let lastErr: unknown
  for (const model of GEMINI_TTS_MODELS) {
    try {
      const j = await generate(fetchImpl, o.apiKey, model, {
        contents: [{ parts: [{ text: o.text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          // Sin el idioma, algunas voces leen el español con acento en inglés.
          speechConfig: { languageCode: o.languageCode ?? 'es-US', voiceConfig: { prebuiltVoiceConfig: { voiceName: o.voice } } }
        }
      })
      const part = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData
      if (!part) throw new Error('Gemini no devolvió audio')
      const bytes = b64ToBytes(part.data)
      if (/wav/i.test(part.mimeType)) return bytes
      const rate = Number(part.mimeType.match(/rate=(\d+)/)?.[1]) || 24000
      return wavFromPcm16(bytes, rate)
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

/** Transcribe un WAV con Gemini. */
export async function geminiTranscribe(o: {
  apiKey: string
  model: string
  wav: Uint8Array
  fetchImpl?: FetchLike
}): Promise<string> {
  const fetchImpl = o.fetchImpl ?? ((u, i) => fetch(u, i))
  const j = await generate(fetchImpl, o.apiKey, o.model, {
    contents: [
      {
        parts: [
          {
            text: 'Transcribe exactamente lo que dice la persona en este audio (español). Responde solo con la transcripción, sin comillas ni comentarios. Si no hay voz entendible, responde con un texto vacío.'
          },
          { inlineData: { mimeType: 'audio/wav', data: bytesToB64(o.wav) } }
        ]
      }
    ],
    generationConfig: { temperature: 0 }
  })
  return (j.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .replace(/^["“'\s]+|["”'\s]+$/g, '')
    .trim()
}
