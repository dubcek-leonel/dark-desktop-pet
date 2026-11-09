export interface VadOptions {
  /** Silencio que marca el fin de una frase. */
  silenceMs?: number
  /** Voz mínima para que cuente (si no, era un ruido). */
  minSpeechMs?: number
  /** Duración máxima de una frase. */
  maxMs?: number
  /** Cuántas veces sobre el ruido de fondo debe estar la voz. */
  ratio?: number
  /** Nivel mínimo absoluto para considerar voz. */
  minLevel?: number
}

export type VadEvent = 'start' | 'end' | 'cancel' | null

/**
 * Detector de voz por energía: recibe el nivel (RMS) de cada trozo de audio
 * y avisa cuándo empieza y termina una frase. Se adapta al ruido de fondo.
 */
export class Vad {
  private o: Required<VadOptions>
  private floor: number | null = null
  private speaking = false
  private speechMs = 0
  private silenceMs = 0
  private totalMs = 0
  private needQuiet = false

  constructor(opts: VadOptions = {}) {
    this.o = { silenceMs: 700, minSpeechMs: 120, maxMs: 15_000, ratio: 3, minLevel: 0.012, ...opts }
  }

  get isSpeaking(): boolean {
    return this.speaking
  }

  reset(): void {
    this.speaking = false
    this.speechMs = this.silenceMs = this.totalMs = 0
  }

  private threshold(): number {
    return Math.max(this.o.minLevel, (this.floor ?? 0) * this.o.ratio)
  }

  push(level: number, dtMs: number): VadEvent {
    if (this.floor === null) this.floor = Math.min(level, 0.004)
    const th = this.threshold()

    if (!this.speaking) {
      this.floor = this.floor * 0.95 + level * 0.05
      if (level < th) this.needQuiet = false
      if (level >= th && !this.needQuiet) {
        this.speaking = true
        this.speechMs = dtMs
        this.silenceMs = 0
        this.totalMs = dtMs
        return 'start'
      }
      return null
    }

    this.totalMs += dtMs
    if (level >= th * 0.6) {
      this.speechMs += dtMs
      this.silenceMs = 0
    } else {
      this.silenceMs += dtMs
    }
    if (this.totalMs >= this.o.maxMs) {
      this.reset()
      this.needQuiet = true
      return 'end'
    }
    if (this.silenceMs >= this.o.silenceMs) {
      const enough = this.speechMs >= this.o.minSpeechMs
      this.reset()
      return enough ? 'end' : 'cancel'
    }
    return null
  }
}
