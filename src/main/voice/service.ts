import { join } from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import type { PetEvent } from '../../core/behavior'
import type { Config } from '../../core/config'
import { speechParams, splitSentences } from '../../core/voice/catalog'
import { geminiSpeak, geminiTranscribe } from '../../core/voice/gemini'
import { detectWake } from '../../core/voice/wake'
import type { ChatUpdate } from '../chat'
import { paths } from './assets'
import { WhisperServer } from './stt'
import { PiperTTS } from './tts'

export interface VoiceDeps {
  getConfig: () => Config
  /** API key de Gemini (si hay), para la voz natural y la transcripción en la nube. */
  getGeminiKey: () => string
  pet: (ev: PetEvent) => void
  ui: (msg: ChatUpdate) => void
  /** Nivel del micrófono (0..1) mientras escucha, para el medidor. */
  onLevel?: (level: number) => void
  /** Lo que el usuario dijo, para mandarlo al chat. Termina cuando Dark acabó de responder. */
  onCommand: (text: string) => Promise<void>
  chatBusy?: () => boolean
  load: (win: BrowserWindow, page: string) => void
  log?: (msg: string) => void
}

type ListenPurpose = 'chat' | 'followup' | 'test'

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
 * La voz de Dark. Habla con Piper (local) o Gemini (natural), escucha con
 * Whisper (local) o Gemini, y usa una ventana oculta para el micrófono y el audio.
 */
export class VoiceService {
  private win: BrowserWindow | null = null
  private ready: Promise<void> | null = null
  private tts = new PiperTTS(paths.outDir())
  private stt = new WhisperServer()
  private playSeq = 0
  private plays = new Map<number, () => void>()
  private conversationGen = 0
  private listenGen = 0
  private listenPurpose: ListenPurpose | null = null
  private listenResolve: ((text: string | null) => void) | null = null
  private speakingNow = false
  private speakGen = 0
  private interruptSpeech: (() => void) | null = null
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
    ipcMain.on('voice:level', (_e, level: unknown) => {
      if (typeof level === 'number' && this.listenPurpose) this.deps.onLevel?.(level)
    })
    ipcMain.on('voice:timeout', () => {
      const purpose = this.listenPurpose
      if (!purpose) return
      this.endListening(null)
      if (purpose === 'chat') this.deps.ui({ state: 'notice', text: 'No escuché nada… 🦗 Toca 🎤 para intentar de nuevo.' })
    })
    ipcMain.on('voice:error', (_e, msg: unknown) => {
      this.deps.log?.(`micrófono: ${String(msg)}`)
      this.endListening(null)
      this.deps.ui({
        state: 'error',
        text: `🎤 No pude usar el micrófono (${String(msg)}). Revisa en Windows: Configuración → Privacidad → Micrófono.`
      })
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

  // ---------- ¿Qué motores hay? ----------

  private hasGemini(): boolean {
    return this.deps.getGeminiKey() !== ''
  }

  private whisperReady(): boolean {
    return !!paths.whisperServer() && !!paths.whisperModel(this.deps.getConfig().whisperModel)
  }

  /** Motor de transcripción a usar ahora mismo (o null si no hay ninguno). */
  sttEngine(): 'whisper' | 'gemini' | null {
    const e = this.deps.getConfig().sttEngine
    if (e === 'whisper') return this.whisperReady() ? 'whisper' : null
    if (e === 'gemini') return this.hasGemini() ? 'gemini' : null
    return this.whisperReady() ? 'whisper' : this.hasGemini() ? 'gemini' : null
  }

  /** ¿Puede hablar con esta configuración? (engine: piper necesita la voz descargada; gemini, la key). */
  speakReady(c: Pick<Config, 'voiceEngine' | 'voiceId'> = this.deps.getConfig()): boolean {
    if (c.voiceEngine === 'gemini') return this.hasGemini()
    return !!paths.piperExe() && !!paths.voiceModel(c.voiceId)
  }

  canSpeak(): boolean {
    return this.deps.getConfig().voiceEnabled && this.speakReady()
  }

  canListen(): boolean {
    const c = this.deps.getConfig()
    return (c.listenEnabled || c.wakeWordEnabled) && this.sttEngine() !== null
  }

  isSpeaking(): boolean {
    return this.speakingNow
  }

  private wakeActive(): boolean {
    return this.deps.getConfig().wakeWordEnabled && this.canListen()
  }

  /** Aplica la configuración: arranca o detiene Whisper y la escucha continua. */
  async apply(): Promise<void> {
    const c = this.deps.getConfig()
    if (!c.voiceEnabled || c.voiceEngine !== 'piper') this.tts.stop()
    if (this.canListen() && this.sttEngine() === 'whisper') {
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
      command: this.listenPurpose !== null,
      commandTimeoutMs: this.listenPurpose === 'followup' ? 6000 : 9000,
      muted: this.speakingNow
    })
  }

  // ---------- Hablar ----------

  private play(wav: Uint8Array, rate: number): Promise<void> {
    const id = ++this.playSeq
    const rateHz = new DataView(wav.buffer, wav.byteOffset, wav.byteLength).getUint32(24, true) || 22050
    const seconds = (wav.length - 44) / (rateHz * 2) / rate
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

  private synth(
    sentence: string,
    o: { engine: 'piper' | 'gemini'; voiceId: string; geminiVoice: string; lengthScale: number }
  ): Promise<Uint8Array> {
    if (o.engine === 'gemini') {
      return geminiSpeak({ apiKey: this.deps.getGeminiKey(), voice: o.geminiVoice, text: sentence })
    }
    return this.tts.synth(sentence, paths.piperExe()!, paths.voiceModel(o.voiceId)!, o.lengthScale)
  }

  /** Dice un texto en voz alta. Las frases se generan mientras suena la anterior. */
  speak(text: string, override?: Partial<Pick<Config, 'voiceEngine' | 'voiceId' | 'geminiVoice' | 'voiceSpeed' | 'voicePitch'>>, reportErrors = false): Promise<void> {
    const gen = this.speakGen
    const job = this.speakQueue
      .then(() => (gen === this.speakGen ? this.doSpeak(text, override) : undefined))
      .catch((e) => {
        this.deps.log?.(`voz: ${String(e)}`)
        if (override || reportErrors) throw e
      })
    this.speakQueue = job.catch(() => {})
    return job
  }

  private async doSpeak(
    text: string,
    override?: Partial<Pick<Config, 'voiceEngine' | 'voiceId' | 'geminiVoice' | 'voiceSpeed' | 'voicePitch'>>
  ): Promise<void> {
    const c = { ...this.deps.getConfig(), ...override }
    if (!override && !c.voiceEnabled) return
    if (!this.speakReady(c)) {
      if (override) throw new Error(c.voiceEngine === 'gemini' ? 'Falta la API key de Gemini' : 'Falta descargar esta voz')
      return
    }
    // Gemini tarda más por llamada: mejor frases más largas (menos llamadas).
    const sentences = c.voiceEngine === 'gemini' ? [speakable(text)].filter(Boolean) : splitSentences(speakable(text))
    if (!sentences.length) return
    const { lengthScale, playbackRate } = speechParams(c.voiceSpeed, c.voicePitch)
    const opts = { engine: c.voiceEngine, voiceId: c.voiceId, geminiVoice: c.geminiVoice, lengthScale }
    // Gemini no permite elegir velocidad: se ajusta solo el tono.
    const rate = c.voiceEngine === 'gemini' ? c.voicePitch : playbackRate

    const gen = this.speakGen
    this.speakingNow = true
    void this.sendMode() // silencia el micrófono mientras habla (para no escucharse a sí mismo)
    const interrupted = new Promise<null>((resolve) => { this.interruptSpeech = () => resolve(null) })
    try {
      let next = this.synth(sentences[0], opts)
      for (let i = 0; i < sentences.length; i++) {
        const wav = await Promise.race([next, interrupted])
        if (!wav) return
        if (gen !== this.speakGen) return // lo interrumpieron
        if (i + 1 < sentences.length) {
          next = this.synth(sentences[i + 1], opts)
          void next.catch(() => {})
        }
        await this.play(wav, rate)
      }
    } finally {
      this.interruptSpeech = null
      this.speakingNow = false
      void this.sendMode()
    }
  }

  /** Corta lo que esté diciendo (por ejemplo, si le haces clic). */
  stopSpeaking(): void {
    this.speakGen++
    this.interruptSpeech?.()
    for (const resolve of this.plays.values()) resolve()
    this.plays.clear()
    void this.send('voice:stopPlayback', null)
  }

  // ---------- Escuchar ----------

  private endListening(text: string | null): void {
    const was = this.listenPurpose
    this.listenPurpose = null
    this.listenGen++
    if (was && was !== 'test') this.deps.pet({ type: 'listening', on: false })
    this.deps.onLevel?.(0)
    void this.sendMode()
    const r = this.listenResolve
    this.listenResolve = null
    r?.(text)
  }

  /**
   * Escucha una frase. 'chat': botón 🎤 o atajo; 'followup': sigue la conversación
   * (si no dices nada, se calla); 'test': prueba del micrófono en Ajustes.
   * Devuelve lo que entendió (o null).
   */
  isListening(): boolean { return this.listenPurpose !== null }

  stopListening(): void {
    this.conversationGen++
    const active = this.listenPurpose !== null
    if (active) this.endListening(null)
    if (active) this.deps.ui({ state: 'ready' })
  }

  async listenOnce(purpose: ListenPurpose = 'chat'): Promise<string | null> {
    if (purpose !== 'test' && this.deps.chatBusy?.()) return null
    if (this.sttEngine() === null) {
      if (purpose !== 'followup') {
        this.deps.ui({
          state: 'notice',
          text: '🎤 Para escucharte necesito Gemini (tu API key) o el reconocimiento local. Actívalo en Ajustes → Voz.'
        })
      }
      return null
    }
    if (this.listenPurpose) this.endListening(null)
    this.stopSpeaking()
    const generation = ++this.listenGen
    this.listenPurpose = purpose
    const result = new Promise<string | null>((resolve) => (this.listenResolve = resolve))
    if (purpose !== 'test') {
      this.deps.ui({ state: 'listening' })
      this.deps.pet({ type: 'listening', on: true })
    }
    try {
      if (this.sttEngine() === 'whisper' && !this.stt.isRunning()) await this.apply()
      if (generation !== this.listenGen) return result
      await this.sendMode()
    } catch (e) {
      if (generation === this.listenGen) {
        this.endListening(null)
        this.deps.ui({ state: 'error', text: `No pude iniciar el micrófono: ${e instanceof Error ? e.message : String(e)}` })
      }
    }
    return result
  }

  private async transcribe(wav: Uint8Array): Promise<string> {
    const engine = this.sttEngine()
    if (engine === 'whisper') return this.stt.transcribe(wav)
    if (engine === 'gemini') {
      return geminiTranscribe({ apiKey: this.deps.getGeminiKey(), model: this.deps.getConfig().model, wav })
    }
    throw new Error('No hay reconocimiento de voz disponible')
  }

  private async onUtterance(wav: Uint8Array, mode: 'wake' | 'command'): Promise<void> {
    const purpose = this.listenPurpose
    const generation = this.listenGen
    if (mode === 'command' && purpose) {
      if (purpose !== 'test') this.deps.ui({ state: 'transcribing' })
    }
    let text = ''
    try {
      text = await this.transcribe(wav)
    } catch (e) {
      if (mode === 'command' && generation !== this.listenGen) return
      if (mode === 'command') {
        this.endListening(null)
        this.deps.ui({ state: 'error', text: `No pude entenderte: ${String(e instanceof Error ? e.message : e)}` })
      }
      return
    }
    if (mode === 'command' && (!purpose || generation !== this.listenGen || purpose !== this.listenPurpose)) return
    this.deps.log?.(`oído (${mode}/${purpose ?? '-'}): ${text}`)

    if (mode === 'command') {
      this.endListening(text)
      if (purpose === 'test') return
      if (text.length < 2) {
        if (purpose === 'chat') this.deps.ui({ state: 'notice', text: 'No te entendí bien, ¿lo repites? Toca 🎤.' })
        return
      }
      await this.converse(text)
      return
    }

    // Escucha continua: solo reacciona si lo llamas por su nombre.
    if (this.listenPurpose) return
    const w = detectWake(text, this.deps.getConfig().name)
    if (!w.woke) return
    if (w.rest.length >= 2) {
      await this.converse(w.rest)
    } else {
      this.deps.pet({ type: 'alert' })
      await this.speak('¿Mmm?')
      const t = await this.listenOnce('chat')
      if (t === null) return
    }
  }

  /** Manda lo dicho al chat y, si está activado, sigue escuchando para continuar la charla. */
  private async converse(text: string): Promise<void> {
    const generation = this.conversationGen
    await this.deps.onCommand(text)
    if (generation === this.conversationGen && this.deps.getConfig().conversationMode && this.canListen()) {
      await this.listenOnce('followup')
    }
  }

  /** Prueba de punta a punta (DARK_SELFTEST): generar voz, reproducirla y transcribirla. */
  async selfTest(): Promise<void> {
    const log = (m: string): void => console.log(`[selftest] ${m}`)
    const c = this.deps.getConfig()
    log(`hablar=${this.canSpeak()} (${c.voiceEngine}) escuchar=${this.canListen()} (${this.sttEngine()})`)
    let t = Date.now()
    await this.speak('Hola, soy Dark. Qué flojera, pero aquí estoy.')
    log(`speak terminó en ${Date.now() - t} ms`)
    if (!this.speakReady() || !this.sttEngine()) return log('faltan motores para la prueba de escucha')
    const wav = await this.synth('Dark, recuérdame tomar agua en veinte minutos.', {
      engine: c.voiceEngine,
      voiceId: c.voiceId,
      geminiVoice: c.geminiVoice,
      lengthScale: 1
    })
    await this.apply()
    t = Date.now()
    const text = await this.transcribe(wav)
    log(`transcripción (${this.sttEngine()}) en ${Date.now() - t} ms: "${text}"`)
    log(`palabra de activación: ${JSON.stringify(detectWake(text, c.name))}`)
  }

  async shutdown(): Promise<void> {
    this.tts.stop()
    this.stt.stop()
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
  }
}
