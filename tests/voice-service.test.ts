import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG } from '../src/core/config'
import { VoiceService, type VoiceDeps } from '../src/main/voice/service'
import type { ChatUpdate } from '../src/main/chat'
const listeners = vi.hoisted(() => new Map<string, (...args: any[]) => void>())
vi.mock('electron', () => ({ ipcMain: { on: (name: string, fn: (...args: any[]) => void) => listeners.set(name, fn) }, BrowserWindow: class {} }))
vi.mock('../src/main/voice/assets', () => ({ paths: { outDir: () => '.' } }))
vi.mock('../src/main/voice/tts', () => ({ PiperTTS: class { stop() {} } }))
vi.mock('../src/main/voice/stt', () => ({ WhisperServer: class { isRunning() { return false } } }))
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((yes) => { resolve = yes }); return { promise, resolve } }
function setup(onCommand = vi.fn(async (_text: string) => {})) {
  const updates: ChatUpdate[] = []
  const deps: VoiceDeps = { getConfig: () => ({ ...DEFAULT_CONFIG, listenEnabled: true, conversationMode: true }), getGeminiKey: () => 'test', pet: () => {}, ui: (m) => updates.push(m), onCommand, load: () => {} }
  const service = new VoiceService(deps)
  const internals = service as unknown as { send: () => Promise<void>; sendMode: () => Promise<void>; transcribe: () => Promise<string> }
  vi.spyOn(internals, 'send').mockResolvedValue()
  vi.spyOn(internals, 'sendMode').mockResolvedValue()
  vi.spyOn(service, 'sttEngine').mockReturnValue('gemini')
  return { service, internals, updates, onCommand }
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
describe('desktop microphone cancellation', () => {
  it('ignores speech recognized after the user stops listening', async () => {
    const s = setup()
    const transcription = deferred<string>()
    vi.spyOn(s.internals, 'transcribe').mockReturnValue(transcription.promise)
    const listening = s.service.listenOnce('chat')
    await flush()
    listeners.get('voice:utterance')!({}, { mode: 'command', wav: new Uint8Array(10) })
    await flush()
    s.service.stopListening()
    transcription.resolve('late command')
    await listening
    await flush()
    expect(s.onCommand).not.toHaveBeenCalled()
    expect(s.service.isListening()).toBe(false)
    expect(s.updates.at(-1)).toEqual({ state: 'ready' })
  })
  it('does not reopen follow-up listening after the conversation is closed', async () => {
    const response = deferred<void>()
    const command = vi.fn(() => response.promise)
    const s = setup(command)
    vi.spyOn(s.internals, 'transcribe').mockResolvedValue('hello')
    const listen = vi.spyOn(s.service, 'listenOnce')
    const listening = s.service.listenOnce('chat')
    await flush()
    listeners.get('voice:utterance')!({}, { mode: 'command', wav: new Uint8Array(10) })
    await flush()
    expect(command).toHaveBeenCalledWith('hello')
    s.service.stopListening()
    response.resolve()
    await listening
    await flush()
    expect(listen).toHaveBeenCalledTimes(1)
  })
  it('does not start the microphone after a canceled local-engine startup', async () => {
    const s = setup()
    vi.mocked(s.service.sttEngine).mockReturnValue('whisper')
    const starting = deferred<void>()
    vi.spyOn(s.service, 'apply').mockReturnValue(starting.promise)
    const listening = s.service.listenOnce('chat')
    s.service.stopListening()
    starting.resolve()
    await listening
    expect(s.service.isListening()).toBe(false)
    expect(s.updates.at(-1)).toEqual({ state: 'ready' })
  })
})
