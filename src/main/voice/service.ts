import { join } from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import type { PetEvent } from '../../core/behavior'
import type { Config } from '../../core/config'
import { speechParams, splitSentences } from '../../core/voice/catalog'
import { detectWake } from '../../core/voice/wake'
import type { ChatUpdate } from '../chat'
import { paths } from './assets'
import { WhisperServer } from './stt'
import { PiperTTS } from './tts'

export interface VoiceDeps {
  getConfig: () => Config
  pet: (ev: PetEvent) => void
  ui: (msg: ChatUpdate) => void
  /** Lo que el usuario dijo, para mandarlo al chat. */
  onCommand: (text: string) => void
  load: (win: BrowserWindow, page: string) => void
  log?: (msg: string) => void
}

/** Limpia el texto antes de leerlo en voz alta (emojis, símbolos, URLs). */
export function speakable(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, 'un enlace')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[*_#`~<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * La voz de Dark: habla con Piper, escucha con whisper.cpp y una ventana oculta
 * que usa el micrófono y reproduce el audio.
 */
export class VoiceService {
  private win: BrowserWindow | null = null
  private ready: Promise<void> | null = null
  private tts = new PiperTTS(paths.outDir())
  private stt = new WhisperServer()
  private playSeq = 0
  private plays = new Map<number, () => void>()
  private listening = false
  private speakingNow = false
  private speakQueue: Promise<void> = Promise.resolve()

  constructor(private deps: VoiceDeps) {
    ipcMain.on('voice:played', (_e, id: unknown) => {
      if (typeof id === 'number') {
        this.plays.get(id)?.()
        this.plays.delete(id)
      }
    })
    ipcMain.on('voice:utterance', (_e, msg: { mode?: unknown; wav?: unknown }) => {
      if (msg?.wav instanceof Uint8Array && (msg.mode === 'wake' || msg.mode === 'command')) {
        void this.onUtterance(msg.wav, msg.mode)
      }
    })
    ipcMain.on('voice:timeout', () => {
      if (!this.listening) return
      this.setListening(false)
      this.deps.ui({ state: 'notice', text: 'No escuché nada… 🦗' })
    })
    ipcMain.on('voice:error', (_e, msg: unknown) => {
      this.deps.log?.(`micrófono: ${String(msg)}`)
      this.setListening(false)
      this.deps.ui({ state: 'notice', text: `🎤 Problema con el micrófono: ${String(msg)}` })
    })
  }

  // ---------- Ventana oculta de audio ----------

  private ensureWindow(): Promise<void> {
    if (this.win && !this.win.isDestroyed() && this.ready) return this.ready
    const win = new BrowserWindow({
      show: false,
      width: 200,
      height: 100,
      skipTaskbar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    })
    this.win = win
    this.ready = new Promise((resolve) => win.webContents.once('did-finish-load', () => resolve()))
    win.on('closed', () => {
      this.win = null
      this.ready = null
    })
    this.deps.load(win, 'voice.html')
    return this.ready
  }

  private async send(channel: string, payload: unknown): Promise<void> {
    await this.ensureWindow()
    this.win?.webContents.send(channel, payload)
  }

  // ---------- Estado ----------

  canSpeak(): boolean {
    const c = this.deps.getConfig()
    return c.voiceEnabled && !!paths.piperExe() && !!paths.voiceModel(c.voiceId)
  }

  canListen(): boolean {
    const c = this.deps.getConfig()
    return (c.listenEnabled || c.wakeWordEnabled) && !!paths.whisperServer() && !!paths.whisperModel(c.whisperModel)
  }

  private wakeActive(): boolean {
    return this.deps.getConfig().wakeWordEnabled && this.canListen()
  }

  /** Aplica la configuración: arranca o detiene Whisper y la escucha continua. */
  async apply(): Promise<void> {
    const c = this.deps.getConfig()
    if (!c.voiceEnabled) this.tts.stop()
    if (this.canListen()) {
      try {
        await this.stt.start(paths.whisperServer()!, paths.whisperModel(c.whisperModel)!, c.name)
      } catch (e) {
        this.deps.log?.(`whisper: ${String(e)}`)
      }
    } else {
      this.stt.stop()
    }
    if (this.win || this.wakeActive()) await this.sendMode()
  }

  private async sendMode(): Promise<void> {
    await this.send('voice:mode', {
      wake: this.wakeActive(),
      command: this.listening,
      muted: this.speakingNow
    })
  }

  private setListening(on: boolean): void {
    this.listening = on
    this.deps.pet({ type: 'listening', on })
    void this.sendMode()
  }

  // ---------- Hablar ----------

  private play(wav: Uint8Array, rate: number): Promise<void> {
    const id = ++this.playSeq
    const seconds = (wav.length - 44) / (22050 * 2) / rate
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.plays.delete(id)
        resolve()
      }, (seconds + 5) * 1000)
      this.plays.set(id, () => {
        clearTimeout(timer)
        resolve()
      })
      void this.send('voice:play', { id, wav, rate })
    })
  }

  /** Dice un texto en voz alta. Las frases se generan mientras suena la anterior. */
  speak(text: string, override?: { voiceId: string; speed: number; pitch: number }): Promise<void> {
    const job = this.speakQueue.then(() => this.doSpeak(text, override)).catch((e) => {
      this.deps.log?.(`tts: ${String(e)}`)
    })
    this.speakQueue = job
    return job
  }

  private async doSpeak(text: string, o?: { voiceId: string; speed: number; pitch: number }): Promise<void> {
    const c = this.deps.getConfig()
    const voiceId = o?.voiceId ?? c.voiceId
    const exe = paths.piperExe()
    const model = paths.voiceModel(voiceId)
    if (!exe || !model || (!o && !c.voiceEnabled)) return
    const sentences = splitSentences(speakable(text))
    if (!sentences.length) return
    const { lengthScale, playbackRate } = speechParams(o?.speed ?? c.voiceSpeed, o?.pitch ?? c.voicePitch)

    this.speakingNow = true
    void this.sendMode() // silencia el micrófono mientras habla (para no escucharse a sí mismo)
    try {
      let next = this.tts.synth(sentences[0], exe, model, lengthScale)
      for (let i = 0; i < sentences.length; i++) {
        const wav = await next
        if (i + 1 < sentences.length) next = this.tts.synth(sentences[i + 1], exe, model, lengthScale)
        await this.play(wav, playbackRate)
      }
    } finally {
      this.speakingNow = false
      void this.sendMode()
    }
  }

  stopSpeaking(): void {
    void this.send('voice:stopPlayback', null)
  }

  // ---------- Escuchar ----------

  /** Escucha una sola frase (botón de micrófono o atajo de teclado). */
  async listenOnce(): Promise<void> {
    if (!this.canListen()) {
      this.deps.ui({
        state: 'notice',
        text: '🎤 Para hablarme activa "Escuchar" en Ajustes y descarga el reconocimiento de voz.'
      })
      return
    }
    this.stopSpeaking()
    if (!this.stt.isRunning()) await this.apply()
    this.deps.ui({ state: 'listening' })
    this.setListening(true)
  }

  private async onUtterance(wav: Uint8Array, mode: 'wake' | 'command'): Promise<void> {
    if (mode === 'command') this.setListening(false)
    let text = ''
    try {
      text = await this.stt.transcribe(wav)
    } catch (e) {
      if (mode === 'command') this.deps.ui({ state: 'error', text: `No pude entenderte: ${String(e)}` })
      return
    }
    this.deps.log?.(`oído (${mode}): ${text}`)

    if (mode === 'command') {
      if (text.length < 2) this.deps.ui({ state: 'notice', text: 'No te escuché bien, ¿lo repites?' })
      else this.deps.onCommand(text)
      return
    }

    const w = detectWake(text, this.deps.getConfig().name)
    if (!w.woke) return
    if (w.rest.length >= 2) {
      this.deps.onCommand(w.rest)
    } else {
      await this.speak('¿Mmm?')
      await this.listenOnce()
    }
  }

  /** Prueba de punta a punta (DARK_SELFTEST): generar voz, reproducirla y transcribirla. */
  async selfTest(): Promise<void> {
    const log = (m: string): void => console.log(`[selftest] ${m}`)
    const c = this.deps.getConfig()
    log(`puede hablar=${this.canSpeak()} puede escuchar=${this.canListen()}`)
    let t = Date.now()
    await this.speak('Hola, soy Dark. Qué flojera, pero aquí estoy. ¿Me escuchas bien?')
    log(`speak terminó en ${Date.now() - t} ms`)
    const exe = paths.piperExe()
    const model = paths.voiceModel(c.voiceId)
    if (!exe || !model || !this.canListen()) return log('faltan archivos para la prueba de escucha')
    const wav = await this.tts.synth('Dark, recuérdame tomar agua en veinte minutos.', exe, model, 1)
    await this.apply()
    t = Date.now()
    const text = await this.stt.transcribe(wav)
    log(`transcripción en ${Date.now() - t} ms: "${text}"`)
    log(`palabra de activación: ${JSON.stringify(detectWake(text, c.name))}`)
  }

  async shutdown(): Promise<void> {
    this.tts.stop()
    this.stt.stop()
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
  }
}
