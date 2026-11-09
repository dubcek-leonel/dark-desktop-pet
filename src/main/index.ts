import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } from 'electron'
import { PetController } from './petController'

let pet: BrowserWindow | null = null
let controller: PetController | null = null
let tray: Tray | null = null

export function assetPath(...p: string[]): string {
  return join(app.getAppPath(), 'assets', 'character', 'dark', ...p)
}

export function loadPage(win: BrowserWindow, page: string): void {
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${page}`)
  } else {
    win.loadFile(join(__dirname, '../renderer', page))
  }
}

function createPetWindow(size: number): BrowserWindow {
  const win = new BrowserWindow({
    width: size,
    height: size,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    backgroundColor: '#00000000',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  // Por defecto los clics atraviesan la ventana; el renderer avisa cuando el mouse está sobre Dark.
  win.setIgnoreMouseEvents(true, { forward: true })
  win.once('ready-to-show', () => win.showInactive())
  loadPage(win, 'index.html')
  return win
}

function togglePet(): void {
  if (!pet) return
  if (pet.isVisible()) pet.hide()
  else pet.showInactive()
}

function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: 'Bailar', click: () => controller?.dispatch({ type: 'dance' }) },
    { label: 'Mostrar / ocultar a Dark', click: togglePet },
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() }
  ])
}

function createTray(): Tray {
  const icon = nativeImage.createFromPath(assetPath('tray-32.png')).resize({ width: 16, height: 16 })
  const t = new Tray(icon)
  t.setToolTip('Dark')
  t.setContextMenu(buildMenu())
  t.on('click', togglePet)
  return t
}

ipcMain.on('pet:hit', (_e, overPet: boolean) => {
  pet?.setIgnoreMouseEvents(!overPet, { forward: true })
})
ipcMain.on('pet:click', () => controller?.dispatch({ type: 'click' }))
ipcMain.on('pet:dragStart', (_e, o: { offsetX: number; offsetY: number }) => {
  controller?.startDrag(Number(o?.offsetX) || 0, Number(o?.offsetY) || 0)
})
ipcMain.on('pet:dragEnd', () => controller?.endDrag())
ipcMain.on('pet:contextmenu', () => {
  if (pet) buildMenu().popup({ window: pet })
})

app.whenReady().then(() => {
  const opts = { scale: 1, sleepAfterMs: 5 * 60_000 }
  pet = createPetWindow(Math.round(256 * opts.scale))
  controller = new PetController(pet, opts)
  pet.webContents.on('did-finish-load', () => controller?.resend())
  controller.start()
  tray = createTray()
})

app.on('window-all-closed', () => app.quit())
