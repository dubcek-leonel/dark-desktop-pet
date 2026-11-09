import { join } from 'node:path'
import { BrowserWindow, screen, type Rectangle } from 'electron'
import type { ChatUpdate } from './chat'

const WIDTH = 320
const MIN_H = 110
const MAX_H = 360

/** Ventana de la burbuja de diálogo: flota encima de la cabeza de Dark y lo sigue. */
export class Bubble {
  private win: BrowserWindow | null = null
  private height = 150
  private petRect: Rectangle = { x: 0, y: 0, width: 256, height: 256 }
  private ready = false
  private queue: Array<() => void> = []

  constructor(private load: (win: BrowserWindow, page: string) => void) {}

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const win = new BrowserWindow({
      width: WIDTH,
      height: this.height,
      transparent: true,
      frame: false,
      resizable: false,
      hasShadow: false,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    this.ready = false
    win.webContents.once('did-finish-load', () => {
      this.ready = true
      for (const fn of this.queue.splice(0)) fn()
    })
    win.on('closed', () => {
      this.win = null
    })
    this.load(win, 'bubble.html')
    this.win = win
    return win
  }

  private whenReady(fn: () => void): void {
    if (this.ready) fn()
    else this.queue.push(fn)
  }

  isVisible(): boolean {
    return !!this.win && !this.win.isDestroyed() && this.win.isVisible()
  }

  /** Abre la burbuja con el cursor en el campo de texto. */
  open(): void {
    const win = this.ensure()
    this.place()
    this.whenReady(() => {
      win.show()
      win.focus()
      win.webContents.send('chat:focus')
    })
  }

  hide(): void {
    if (this.isVisible()) this.win!.hide()
  }

  update(msg: ChatUpdate): void {
    const win = this.ensure()
    this.whenReady(() => {
      if (!win.isVisible()) {
        this.place()
        win.showInactive()
      }
      win.webContents.send('chat:update', msg)
    })
  }

  /** Nivel del micrófono para el medidor (solo si está visible). */
  level(l: number): void {
    if (this.isVisible() && this.ready) this.win!.webContents.send('chat:level', l)
  }

  setHeight(h: number): void {
    const nh = Math.round(Math.min(MAX_H, Math.max(MIN_H, h)))
    if (nh === this.height) return
    this.height = nh
    this.place()
  }

  follow(petRect: Rectangle): void {
    this.petRect = petRect
    if (this.isVisible()) this.place()
  }

  private place(): void {
    if (!this.win || this.win.isDestroyed()) return
    const p = this.petRect
    const scale = p.width / 256
    const area = screen.getDisplayNearestPoint({ x: p.x + p.width / 2, y: p.y + p.height / 2 }).workArea
    let x = Math.round(p.x + p.width / 2 - WIDTH / 2)
    let y = Math.round(p.y + 22 * scale - this.height)
    // Si no cabe arriba (por ejemplo, colgado del borde), va debajo.
    if (y < area.y) y = Math.round(p.y + p.height - 10 * scale)
    x = Math.min(area.x + area.width - WIDTH, Math.max(area.x, x))
    y = Math.min(area.y + area.height - this.height, Math.max(area.y, y))
    this.win.setBounds({ x, y, width: WIDTH, height: this.height })
  }
}
