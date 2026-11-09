import { describe, expect, it, vi } from 'vitest'
import { geminiSpeak, geminiTranscribe, wavFromPcm16 } from '../src/core/voice/gemini'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const b64 = (bytes: number[]): string => btoa(String.fromCharCode(...bytes))

describe('wavFromPcm16', () => {
  it('agrega una cabecera WAV de 44 bytes con la frecuencia indicada', () => {
    const w = wavFromPcm16(new Uint8Array([1, 2, 3, 4]), 24000)
    expect(w.length).toBe(48)
    expect(new DataView(w.buffer).getUint32(24, true)).toBe(24000)
    expect([...w.slice(44)]).toEqual([1, 2, 3, 4])
  })
})

describe('geminiSpeak', () => {
  it('pide audio con la voz elegida y envuelve el PCM en WAV', async () => {
    const fetchImpl = vi.fn(async () =>
      json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: b64([9, 9]) } }] } }] })
    )
    const wav = await geminiSpeak({ apiKey: 'k', voice: 'Puck', text: 'hola', fetchImpl })
    expect(wav.length).toBe(46)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain(':generateContent')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k')
    expect(JSON.parse(init.body as string).generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Puck')
  })

  it('si ya viene en WAV lo devuelve tal cual', async () => {
    const fetchImpl = async () =>
      json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: b64([82, 73, 70, 70]) } }] } }] })
    expect([...(await geminiSpeak({ apiKey: 'k', voice: 'Puck', text: 'x', fetchImpl }))]).toEqual([82, 73, 70, 70])
  })

  it('si el primer modelo falla prueba el siguiente; si todos fallan, da el error', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ error: { message: 'no existe' } }, 404))
      .mockResolvedValueOnce(json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: b64([1]) } }] } }] }))
    expect((await geminiSpeak({ apiKey: 'k', voice: 'Puck', text: 'x', fetchImpl })).length).toBe(1)
    const bad = async () => json({ error: { message: 'API key not valid' } }, 400)
    await expect(geminiSpeak({ apiKey: 'k', voice: 'Puck', text: 'x', fetchImpl: bad })).rejects.toThrow(/API key/)
  })
})

describe('geminiTranscribe', () => {
  it('manda el audio en base64 y limpia comillas', async () => {
    const fetchImpl = vi.fn(async () => json({ candidates: [{ content: { parts: [{ text: '"Dark, baila."\n' }] } }] }))
    const text = await geminiTranscribe({ apiKey: 'k', model: 'm', wav: new Uint8Array([1, 2, 3]), fetchImpl })
    expect(text).toBe('Dark, baila.')
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
    expect(body.contents[0].parts[1].inlineData).toEqual({ mimeType: 'audio/wav', data: b64([1, 2, 3]) })
  })
})
