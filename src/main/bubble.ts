import { join } from 'node:path'
import { BrowserWindow, screen, type Rectangle } from 'electron'
import type { ChatUpdate } from './chat'

const WIDTH = 380
const COMPOSER_H = 54
const MIN_H = 90
const MAX_H = 430

/** Answers sit above the pet; the focused writing bar is a separate window below it. */
export class Bubble {
  private win: BrowserWindow | null = null
  private composer: BrowserWindow | null = null
  private composerReady = false
  private composerWanted = false
  private height = 150
  private petRect: Rectangle = { x: 0, y: 0, width: 256, height: 256 }
  private ready = false
  private queue: Array<() => void> = []
  private latest: ChatUpdate | null = null

  constructor(private load: (win: BrowserWindow, page: string) => void, private onConversation: (on: boolean) => void = () => {}) {}

  private createWindow(height: number): BrowserWindow {
    const win = new BrowserWindow({
      width: WIDTH, height, transparent: true, frame: false, resizable: false,
      hasShadow: false, skipTaskbar: true, show: false, backgroundColor: '#00000000',
      webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    return win
  }
  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const win = this.createWindow(this.height)
    this.win = win
    this.ready = false
    win.webContents.once('did-finish-load', () => {
      if (win.isDestroyed()) return
      this.ready = true
      for (const fn of this.queue.splice(0)) fn()
    })
    win.on('closed', () => { if (this.win === win) { this.win = null; this.ready = false; this.queue = [] } })
    this.load(win, 'bubble.html')
    return win
  }
  private ensureComposer(): BrowserWindow {
    if (this.composer && !this.composer.isDestroyed()) return this.composer
    const win = this.createWindow(COMPOSER_H)
    this.composer = win
    this.composerReady = false
    win.webContents.once('did-finish-load', () => {
      if (win.isDestroyed()) return
      this.composerReady = true
      if (this.latest) win.webContents.send('chat:update', this.latest)
      if (this.composerWanted) { this.place(); win.show(); win.focus(); win.webContents.send('chat:focus') }
    })
    win.on('closed', () => {
      this.composer = null
      this.composerReady = false
      if (this.composerWanted) { this.composerWanted = false; this.onConversation(false) }
    })
    this.load(win, 'composer.html')
    return win
  }
  private whenReady(fn: () => void): void {
    if (this.ready) fn()
    else this.queue.push(fn)
  }
  isVisible(): boolean { return !!this.win && !this.win.isDestroyed() && this.win.isVisible() }
  open(): void {
    if (!this.composerWanted) { this.composerWanted = true; this.onConversation(true) }
    const response = this.ensure()
    const composer = this.ensureComposer()
    this.place()
    this.whenReady(() => { if (this.composerWanted && !response.isDestroyed()) response.showInactive() })
    if (this.composerReady) { composer.show(); composer.focus(); composer.webContents.send('chat:focus') }
  }
  /** Dismissing an answer leaves the writing bar available. */
  dismiss(): void { if (this.isVisible()) this.win!.hide() }
  hide(): void {
    this.dismiss()
    if (this.composer && !this.composer.isDestroyed()) this.composer.hide()
    if (this.composerWanted) { this.composerWanted = false; this.onConversation(false) }
  }
  update(msg: ChatUpdate): void {
    if (msg.state !== 'notice') this.latest = msg
    if (this.composerReady && this.composer && !this.composer.isDestroyed()) this.composer.webContents.send('chat:update', msg)
    const win = this.ensure()
    this.whenReady(() => {
      if (win.isDestroyed()) return
      this.place()
      if (!win.isVisible()) win.showInactive()
      win.webContents.send('chat:update', msg)
    })
  }
  level(l: number): void { if (this.isVisible() && this.ready) this.win!.webContents.send('chat:level', l) }
  setHeight(h: number): void {
    const next = Math.round(Math.min(MAX_H, Math.max(MIN_H, h)))
    if (next !== this.height) { this.height = next; this.place() }
  }
  follow(petRect: Rectangle): void { this.petRect = petRect; this.place() }
  private place(): void {
    const p = this.petRect
    const scale = p.width / 256
    const area = screen.getDisplayNearestPoint({ x: p.x + p.width / 2, y: p.y + p.height / 2 }).workArea
    const width = Math.min(WIDTH, area.width)
    const clampX = (x: number): number => Math.round(Math.max(area.x, Math.min(area.x + area.width - width, x)))
    const x = clampX(p.x + p.width / 2 - width / 2)
    if (this.composer && !this.composer.isDestroyed()) {
      const y = Math.round(Math.max(area.y, Math.min(area.y + area.height - COMPOSER_H, p.y + p.height + 4)))
      this.composer.setBounds({ x, y, width, height: COMPOSER_H })
    }
    if (!this.win || this.win.isDestroyed()) return
    const height = Math.min(this.height, area.height)
    let responseX = x
    let y = Math.round(p.y + 22 * scale - height)
    if (y < area.y) {
      // At the top edge, place the answer beside the pet instead of over the composer.
      responseX = clampX(p.x + p.width + 8 + width <= area.x + area.width ? p.x + p.width + 8 : p.x - width - 8)
      y = Math.round(p.y + 25 * scale)
    }
    y = Math.max(area.y, Math.min(area.y + area.height - height, y))
    this.win.setBounds({ x: responseX, y, width, height })
  }
}
