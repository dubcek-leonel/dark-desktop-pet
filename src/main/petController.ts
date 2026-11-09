import { BrowserWindow, screen } from 'electron'
import dark from '../../assets/character/dark/dark.json'
import { animDurationMs, type SpriteSheet } from '../core/animation'
import { createPet, handle, step, type Env, type Pet, type PetEvent } from '../core/behavior'

const sheet = dark as SpriteSheet
const TICK_MS = 33

export interface PetOptions {
  scale: number
  sleepAfterMs: number
}

/** Une el cerebro (behavior.ts) con la ventana real: la mueve y le dice qué animar. */
export class PetController {
  private pet: Pet
  private last = Date.now()
  private timer: ReturnType<typeof setInterval> | null = null
  private dragOffset: { x: number; y: number } | null = null
  private moveListeners: Array<(r: Electron.Rectangle) => void> = []

  constructor(
    private win: BrowserWindow,
    private opts: PetOptions
  ) {
    const area = screen.getPrimaryDisplay().workArea
    this.pet = createPet(this.env(), area.x + area.width - this.size() - 80)
    this.apply(null)
  }

  get state(): Pet {
    return this.pet
  }

  size(): number {
    return Math.round(256 * this.opts.scale)
  }

  setOptions(opts: Partial<PetOptions>): void {
    this.opts = { ...this.opts, ...opts }
    const s = this.size()
    this.win.setBounds({ x: Math.round(this.pet.x), y: Math.round(this.pet.y), width: s, height: s })
  }

  onMove(cb: (r: Electron.Rectangle) => void): void {
    this.moveListeners.push(cb)
  }

  start(): void {
    this.last = Date.now()
    this.timer = setInterval(() => this.tick(), TICK_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  dispatch(ev: PetEvent): void {
    const prev = this.pet
    this.pet = handle(this.pet, ev, this.env())
    this.apply(prev)
  }

  startDrag(offsetX: number, offsetY: number): void {
    this.dragOffset = { x: offsetX, y: offsetY }
    this.dispatch({ type: 'dragStart' })
  }

  endDrag(): void {
    this.dragOffset = null
    this.dispatch({ type: 'dragEnd' })
  }

  private env(): Env {
    const s = this.size()
    const center = this.pet
      ? { x: Math.round(this.pet.x + s / 2), y: Math.round(this.pet.y + s / 2) }
      : screen.getCursorScreenPoint()
    return {
      bounds: screen.getDisplayNearestPoint(center).workArea,
      scale: this.opts.scale,
      rand: Math.random,
      durationOf: (a) => animDurationMs(sheet, a),
      sleepAfterMs: this.opts.sleepAfterMs
    }
  }

  private tick(): void {
    if (this.win.isDestroyed()) return this.stop()
    const now = Date.now()
    const dt = Math.min(100, now - this.last)
    this.last = now
    const prev = this.pet
    if (this.dragOffset && this.pet.state === 'drag') {
      const c = screen.getCursorScreenPoint()
      this.pet = handle(
        this.pet,
        { type: 'dragMove', x: c.x - this.dragOffset.x, y: c.y - this.dragOffset.y },
        this.env()
      )
    }
    this.pet = step(this.pet, dt, this.env())
    this.apply(prev)
  }

  private apply(prev: Pet | null): void {
    const p = this.pet
    const s = this.size()
    const x = Math.round(p.x)
    const y = Math.round(p.y)
    if (!prev || x !== Math.round(prev.x) || y !== Math.round(prev.y)) {
      // setBounds (y no setPosition) evita que Windows cambie el tamaño con monitores de distinta escala.
      const r = { x, y, width: s, height: s }
      this.win.setBounds(r)
      for (const cb of this.moveListeners) cb(r)
    }
    const restarted = prev !== null && p.t < prev.t
    if (!prev || restarted || p.anim !== prev.anim || p.facing !== prev.facing) {
      this.send({ anim: p.anim, facing: p.facing, restart: restarted })
    }
  }

  private send(msg: { anim: string; facing: 1 | -1; restart: boolean }): void {
    if (!this.win.webContents.isLoading()) this.win.webContents.send('pet:anim', msg)
  }

  /** Reenvía la animación actual (cuando la página termina de cargar). */
  resend(): void {
    const p = this.pet
    this.win.webContents.send('pet:anim', { anim: p.anim, facing: p.facing, restart: true })
  }
}
