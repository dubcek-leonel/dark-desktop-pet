import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, Tray } from 'electron'
import { createOllama } from '../core/ai/ollama'
import { createOpenAICompat } from '../core/ai/openaiCompat'
import { friendlyError } from '../core/ai/errors'
import type { AIProvider } from '../core/ai/types'
import { normalizeConfig, PROVIDER_PRESETS, type Config, type ProviderId } from '../core/config'
import { mergeMemories } from '../core/memory'
import { formatRemaining } from '../core/pomodoro'
import { formatWhen } from '../core/reminders'
import { Bubble } from './bubble'
import { ChatService } from './chat'
import { PetController } from './petController'
import { PomodoroManager } from './pomodoroManager'
import { ReminderManager } from './reminders'
import {
  getApiKey,
  hasApiKey,
  loadConfig,
  loadMemories,
  saveConfig,
  saveMemories,
  setApiKey
} from './store'

app.setName('Dark')
app.setAppUserModelId('com.dubcek.dark')
if (!app.requestSingleInstanceLock()) app.quit()

let config: Config
let memories: string[] = []
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

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) return
  new Notification({ title, body, icon: assetPath('icon-512.png'), silent: false }).show()
}

function settingsChanged(): void {
  settingsWin?.webContents.send('settings:refresh')
}

// ---------- IA, memoria y recordatorios ----------

function makeProvider(provider: ProviderId, baseUrl: string, model: string, apiKey: string): AIProvider {
  if (provider === 'ollama') return createOllama({ baseUrl, model })
  return createOpenAICompat({ baseUrl, model, apiKey })
}

const bubble = new Bubble(loadPage)

const reminders = new ReminderManager((r, late) => {
  const text = late ? `${r.text} (era para ${formatWhen(r.at, Date.now())})` : r.text
  notify(`${config.name} te recuerda`, text)
  controller?.dispatch({ type: 'alert' })
  bubble.update({ state: 'notice', text: `⏰ Oye… ${text}` })
  settingsChanged()
})

const chat = new ChatService({
  getProvider: () => makeProvider(config.provider, config.baseUrl, config.model, getApiKey(config.provider)),
  getPersona: () => ({ name: config.name, personality: config.personality }),
  pet: (ev) => controller?.dispatch(ev),
  ui: (msg) => bubble.update(msg),
  onConfigProblem: () => openSettings(),
  memoryEnabled: () => config.memoryEnabled,
  getMemories: () => memories,
  addMemories: (facts) => {
    memories = mergeMemories(memories, facts)
    saveMemories(memories)
    settingsChanged()
  },
  onReminders: (reqs) => {
    reminders.add(reqs)
    settingsChanged()
  }
})

const pomodoro = new PomodoroManager(
  () => ({ focusMin: config.pomodoroFocusMin, breakMin: config.pomodoroBreakMin }),
  {
    onFocusStart: (cycle) => {
      controller?.dispatch({ type: 'work', on: true })
      const msg =
        cycle === 1
          ? `Bueno, a trabajar ${config.pomodoroFocusMin} minutos. Yo también… más o menos.`
          : `Se acabó el descanso. Otros ${config.pomodoroFocusMin} minutos, ánimo.`
      bubble.update({ state: 'notice', text: msg })
      notify('Pomodoro', `Foco: ${config.pomodoroFocusMin} min`)
      refreshTray()
    },
    onBreakStart: () => {
      controller?.dispatch({ type: 'work', on: false })
      controller?.dispatch({ type: 'dance' })
      bubble.update({ state: 'notice', text: `¡Descanso! ${config.pomodoroBreakMin} minutos. Estírate, toma agua.` })
      notify('Pomodoro', `Descanso: ${config.pomodoroBreakMin} min`)
      refreshTray()
    },
    onStop: () => {
      controller?.dispatch({ type: 'work', on: false })
      tray?.setToolTip(config.name)
      refreshTray()
    },
    onTick: (p, ms) => {
      if (p.phase === 'off') return
      tray?.setToolTip(`${config.name} — ${p.phase === 'focus' ? 'Foco' : 'Descanso'} ${formatRemaining(ms)}`)
    }
  }
)

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
    width: 500,
    height: 760,
    title: `Ajustes de ${config.name}`,
    icon: assetPath('icon-512.png'),
    autoHideMenuBar: true,
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
  const p = pomodoro.state
  const pomodoroItem: Electron.MenuItemConstructorOptions =
    p.phase === 'off'
      ? {
          label: `Empezar Pomodoro (${config.pomodoroFocusMin}/${config.pomodoroBreakMin})`,
          click: () => pomodoro.start()
        }
      : { label: `Detener Pomodoro (${p.phase === 'focus' ? 'foco' : 'descanso'})`, click: () => pomodoro.stop() }
  return Menu.buildFromTemplate([
    { label: `Hablar con ${config.name}`, click: () => bubble.open() },
    pomodoroItem,
    { label: 'Bailar', click: () => controller?.dispatch({ type: 'dance' }) },
    { label: 'Olvidar la conversación', click: () => chat.reset() },
    { type: 'separator' },
    { label: 'Ajustes…', click: openSettings },
    { label: `Mostrar / ocultar a ${config.name}`, click: togglePet },
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() }
  ])
}

function refreshTray(): void {
  tray?.setContextMenu(buildMenu())
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
  if (!pomodoro.isRunning()) tray?.setToolTip(config.name)
  refreshTray()
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
ipcMain.on('chat:close', () => {
  bubble.hide()
  void chat.flushMemory()
})
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

ipcMain.handle('memory:list', () => memories)
ipcMain.handle('memory:delete', (_e, index: unknown) => {
  if (typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < memories.length) {
    memories = memories.filter((_, i) => i !== index)
    saveMemories(memories)
  }
  return memories
})
ipcMain.handle('memory:clear', () => {
  memories = []
  saveMemories(memories)
  return memories
})

ipcMain.handle('reminders:list', () =>
  reminders.all().map((r) => ({ id: r.id, text: r.text, when: formatWhen(r.at, Date.now()) }))
)
ipcMain.handle('reminders:delete', (_e, id: unknown) => {
  if (typeof id === 'string') reminders.remove(id)
  return true
})

// ---------- Arranque ----------

app.on('second-instance', () => {
  pet?.showInactive()
  bubble.open()
})

app.whenReady().then(() => {
  config = loadConfig()
  memories = loadMemories()
  pet = createPetWindow(Math.round(256 * config.scale))
  controller = new PetController(pet, { scale: config.scale, sleepAfterMs: config.sleepAfterMinutes * 60_000 })
  controller.onMove((r) => bubble.follow(r))
  pet.webContents.on('did-finish-load', () => controller?.resend())
  controller.start()
  tray = createTray()
  // Un poco después de saludar, para que los recordatorios atrasados se vean.
  setTimeout(() => reminders.start(), 2500)

  // Primera vez sin API key: Dark lo pide y abre los ajustes.
  if (PROVIDER_PRESETS[config.provider].needsKey && !hasApiKey(config.provider)) {
    setTimeout(() => {
      bubble.update({
        state: 'notice',
        text: 'Ugh, para hablar necesito una API key. Te abrí los Ajustes, pégala ahí.'
      })
      openSettings()
    }, 1500)
  }
})

let quitting = false
app.on('before-quit', (e) => {
  // Antes de salir, guarda los recuerdos de la última conversación (máx. 4 s).
  if (quitting || !config?.memoryEnabled) return
  e.preventDefault()
  quitting = true
  const timeout = new Promise((r) => setTimeout(r, 4000))
  void Promise.race([chat.flushMemory(), timeout]).finally(() => app.quit())
})

app.on('window-all-closed', () => app.quit())
