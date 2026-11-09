import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Tray } from 'electron'
import { createOllama } from '../core/ai/ollama'
import { createOpenAICompat } from '../core/ai/openaiCompat'
import { friendlyError } from '../core/ai/errors'
import type { AIProvider } from '../core/ai/types'
import { normalizeConfig, PROVIDER_PRESETS, type Config, type ProviderId } from '../core/config'
import { Bubble } from './bubble'
import { ChatService } from './chat'
import { PetController } from './petController'
import { getApiKey, hasApiKey, loadConfig, saveConfig, setApiKey } from './store'

app.setName('Dark')
if (!app.requestSingleInstanceLock()) app.quit()

let config: Config
let pet: BrowserWindow | null = null
let controller: PetController | null = null
let settingsWin: BrowserWindow | null = null
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

const secureWeb = {
  preload: join(__dirname, '../preload/index.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true
}

// ---------- IA ----------

function makeProvider(provider: ProviderId, baseUrl: string, model: string, apiKey: string): AIProvider {
  if (provider === 'ollama') return createOllama({ baseUrl, model })
  return createOpenAICompat({ baseUrl, model, apiKey })
}

const bubble = new Bubble(loadPage)
const chat = new ChatService({
  getProvider: () => makeProvider(config.provider, config.baseUrl, config.model, getApiKey(config.provider)),
  getPersona: () => ({ name: config.name, personality: config.personality }),
  pet: (ev) => controller?.dispatch(ev),
  ui: (msg) => bubble.update(msg),
  onConfigProblem: () => openSettings()
})

// ---------- Ventanas ----------

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
    webPreferences: secureWeb
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  // Por defecto los clics atraviesan la ventana; el renderer avisa cuando el mouse está sobre Dark.
  win.setIgnoreMouseEvents(true, { forward: true })
  win.once('ready-to-show', () => win.showInactive())
  loadPage(win, 'index.html')
  return win
}

function openSettings(): void {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show()
    settingsWin.focus()
    return
  }
  settingsWin = new BrowserWindow({
    width: 480,
    height: 720,
    title: `Ajustes de ${config.name}`,
    icon: assetPath('icon-512.png'),
    autoHideMenuBar: true,
    resizable: true,
    show: false,
    backgroundColor: '#14141c',
    webPreferences: secureWeb
  })
  settingsWin.setMenu(null)
  settingsWin.once('ready-to-show', () => settingsWin?.show())
  settingsWin.on('closed', () => (settingsWin = null))
  loadPage(settingsWin, 'settings.html')
}

function togglePet(): void {
  if (!pet) return
  if (pet.isVisible()) {
    pet.hide()
    bubble.hide()
  } else pet.showInactive()
}

function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: `Hablar con ${config.name}`, click: () => bubble.open() },
    { label: 'Bailar', click: () => controller?.dispatch({ type: 'dance' }) },
    { label: 'Olvidar la conversación', click: () => chat.reset() },
    { type: 'separator' },
    { label: 'Ajustes…', click: openSettings },
    { label: `Mostrar / ocultar a ${config.name}`, click: togglePet },
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() }
  ])
}

function createTray(): Tray {
  const icon = nativeImage.createFromPath(assetPath('tray-32.png')).resize({ width: 16, height: 16 })
  const t = new Tray(icon)
  t.setToolTip(config.name)
  t.setContextMenu(buildMenu())
  t.on('click', togglePet)
  return t
}

function applyConfig(): void {
  controller?.setOptions({ scale: config.scale, sleepAfterMs: config.sleepAfterMinutes * 60_000 })
  tray?.setToolTip(config.name)
  tray?.setContextMenu(buildMenu())
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: config.startWithWindows })
}

// ---------- IPC ----------

ipcMain.on('pet:hit', (_e, overPet: unknown) => {
  pet?.setIgnoreMouseEvents(overPet !== true, { forward: true })
})
ipcMain.on('pet:click', () => controller?.dispatch({ type: 'click' }))
ipcMain.on('pet:dblclick', () => bubble.open())
ipcMain.on('pet:dragStart', (_e, o: { offsetX?: unknown; offsetY?: unknown }) => {
  controller?.startDrag(Number(o?.offsetX) || 0, Number(o?.offsetY) || 0)
})
ipcMain.on('pet:dragEnd', () => controller?.endDrag())
ipcMain.on('pet:contextmenu', () => {
  if (pet) buildMenu().popup({ window: pet })
})

ipcMain.on('chat:send', (_e, text: unknown) => {
  if (typeof text === 'string') void chat.send(text)
})
ipcMain.on('chat:close', () => bubble.hide())
ipcMain.on('chat:resize', (_e, h: unknown) => {
  if (typeof h === 'number' && Number.isFinite(h)) bubble.setHeight(h)
})

function keyStatus(): Record<ProviderId, boolean> {
  return { gemini: hasApiKey('gemini'), openai: hasApiKey('openai'), ollama: true }
}

ipcMain.handle('config:get', () => ({ config, hasKey: keyStatus(), presets: PROVIDER_PRESETS }))

ipcMain.handle('config:save', (_e, payload: { config?: unknown; apiKey?: unknown }) => {
  try {
    config = normalizeConfig(payload?.config)
    saveConfig(config)
    if (typeof payload?.apiKey === 'string' && payload.apiKey.trim()) setApiKey(config.provider, payload.apiKey)
    applyConfig()
    return { ok: true, hasKey: keyStatus() }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

interface ProbeArgs {
  provider?: unknown
  baseUrl?: unknown
  model?: unknown
  apiKey?: unknown
}
function probeProvider(a: ProbeArgs): AIProvider {
  const c = normalizeConfig({ provider: a?.provider, baseUrl: a?.baseUrl, model: a?.model })
  const key = typeof a?.apiKey === 'string' && a.apiKey.trim() ? a.apiKey.trim() : getApiKey(c.provider)
  return makeProvider(c.provider, c.baseUrl, c.model, key)
}

ipcMain.handle('ai:listModels', async (_e, a: ProbeArgs) => {
  try {
    return { ok: true, models: await probeProvider(a).listModels() }
  } catch (e) {
    return { ok: false, error: friendlyError(e) }
  }
})

ipcMain.handle('ai:test', async (_e, a: ProbeArgs) => {
  try {
    const text = await probeProvider(a).chat([{ role: 'user', content: 'Responde solo: "¡Funciono!"' }], () => {})
    return { ok: true, text: text.trim() }
  } catch (e) {
    return { ok: false, error: friendlyError(e) }
  }
})

// ---------- Arranque ----------

app.on('second-instance', () => {
  pet?.showInactive()
  bubble.open()
})

app.whenReady().then(() => {
  config = loadConfig()
  pet = createPetWindow(Math.round(256 * config.scale))
  controller = new PetController(pet, { scale: config.scale, sleepAfterMs: config.sleepAfterMinutes * 60_000 })
  controller.onMove((r) => bubble.follow(r))
  pet.webContents.on('did-finish-load', () => controller?.resend())
  controller.start()
  tray = createTray()

  // Primera vez sin API key: Dark lo pide y abre los ajustes.
  if (PROVIDER_PRESETS[config.provider].needsKey && !hasApiKey(config.provider)) {
    setTimeout(() => {
      bubble.update({
        state: 'error',
        text: 'Ugh, para hablar necesito una API key. Te abrí los Ajustes, pégala ahí.'
      })
      openSettings()
    }, 1500)
  }
})

app.on('window-all-closed', () => app.quit())
