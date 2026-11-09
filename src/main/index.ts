import { parseCompanionAction, type CompanionOverview } from '../core/companion'
import { join } from 'node:path'
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, Notification, session, shell, Tray } from 'electron'
import { createOllama } from '../core/ai/ollama'
import { createOpenAICompat } from '../core/ai/openaiCompat'
import { friendlyError } from '../core/ai/errors'
import type { AIProvider } from '../core/ai/types'
import { GEMINI_VOICES, normalizeConfig, PROVIDER_PRESETS, type Config, type ProviderId } from '../core/config'
import { mergeMemories } from '../core/memory'
import { formatRemaining } from '../core/pomodoro'
import { describeRepeat, formatWhen, matches } from '../core/reminders'
import type { Action } from '../core/actions'
import { VOICES, WHISPER_MODELS } from '../core/voice/catalog'
import { Bubble } from './bubble'
import { installVoice, installWhisper, status as voiceStatus } from './voice/assets'
import { VoiceService } from './voice/service'
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
// Solo para desarrollo y pruebas: usar otra carpeta de datos.
if (process.env['DARK_USER_DATA']) app.setPath('userData', process.env['DARK_USER_DATA'])
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

const bubble = new Bubble(loadPage, (on) => controller?.dispatch({ type: 'conversation', on }))

const voice: VoiceService = new VoiceService({
  getConfig: () => config,
  getGeminiKey: () => getApiKey('gemini'),
  pet: (ev) => controller?.dispatch(ev),
  ui: (msg) => bubble.update(msg),
  onLevel: (level) => {
    bubble.level(level)
    settingsWin?.webContents.send('voice:level', level)
  },
  onCommand: (text: string): Promise<void> => chat.send(text),
  chatBusy: () => chat.isBusy(),
  load: loadPage,
  log: (m) => console.log(`[voz] ${m}`)
})

/** Muestra un aviso en la burbuja y, si la voz está activa, lo dice. */
function announce(msg: { text: string; buttons?: { id: string; label: string }[] }, spoken?: string): void {
  bubble.update({ state: 'notice', ...msg })
  void voice.speak(spoken ?? msg.text)
}

const SNOOZE_MIN = 10

const reminders = new ReminderManager((r, late) => {
  const text = late ? `${r.text} (era para ${formatWhen(r.at, Date.now())})` : r.text
  notify(`${config.name} te recuerda`, text)
  controller?.dispatch({ type: 'alert' })
  chat.noteAssistant(`(Le avisé al usuario del recordatorio: "${r.text}")`)
  announce(
    {
      text: `⏰ Oye… ${text}`,
      buttons: [
        { id: `snooze:${SNOOZE_MIN}:${r.text}`, label: `Posponer ${SNOOZE_MIN} min` },
        { id: 'dismiss', label: 'Listo' }
      ]
    },
    `Oye, te recuerdo: ${r.text}`
  )
  settingsChanged()
})

/** Lo que la IA sabe del estado de la app en cada mensaje. */
function appContext(): string[] {
  const now = Date.now()
  const list = reminders.all()
  const lines = [
    list.length
      ? `Recordatorios pendientes: ${list
          .map((r) => `${formatWhen(r.at, now)} "${r.text}"${r.repeat ? ` (${describeRepeat(r.repeat)})` : ''}`)
          .join('; ')}`
      : 'No hay recordatorios pendientes.'
  ]
  const p = pomodoro.state
  if (p.phase === 'off') lines.push('Pomodoro: apagado.')
  else {
    const c = pomodoro.config()
    lines.push(
      `Pomodoro activo (${c.focusMin}/${c.breakMin}), ciclo ${p.cycle}: ${p.phase === 'focus' ? 'foco' : 'descanso'}, faltan ${formatRemaining(pomodoro.remainingMs())}.`
    )
  }
  return lines
}

/** Ejecuta lo que la IA pidió y devuelve una confirmación visible por cada acción. */
function runActions(actions: Action[]): string[] {
  const now = Date.now()
  const notes: string[] = []
  for (const a of actions) {
    switch (a.type) {
      case 'reminder': {
        const [r] = reminders.add([{ at: a.at, text: a.text, repeat: a.repeat }])
        notes.push(`⏰ ${formatWhen(r.at, now)} · ${r.text}${r.repeat ? ` · ${describeRepeat(r.repeat)}` : ''}`)
        break
      }
      case 'cancelReminder': {
        const gone = reminders.cancel(a.query)
        notes.push(
          gone.length
            ? `🗑 Cancelado: ${gone.map((r) => r.text).join(', ')}`
            : `⚠ No encontré un recordatorio de "${a.query}"`
        )
        break
      }
      case 'pomodoroStart': {
        const override = {
          ...(a.focusMin ? { focusMin: a.focusMin } : {}),
          ...(a.breakMin ? { breakMin: a.breakMin } : {})
        }
        pomodoro.start(override)
        const c = pomodoro.config()
        notes.push(`🍅 Pomodoro ${c.focusMin}/${c.breakMin} iniciado`)
        break
      }
      case 'pomodoroStop':
        if (pomodoro.isRunning()) {
          pomodoro.stop()
          notes.push('🍅 Pomodoro detenido')
        } else notes.push('🍅 No había un Pomodoro activo')
        break
      case 'pet':
        controller?.dispatch(
          a.what === 'dance' ? { type: 'dance' } : a.what === 'sleep' ? { type: 'sleep' } : { type: 'alert' }
        )
        break
      case 'remember':
        memories = mergeMemories(memories, [a.fact])
        saveMemories(memories)
        notes.push(`🧠 Anotado: ${a.fact}`)
        break
      case 'forget': {
        const before = memories.length
        memories = memories.filter((m) => !matches(m, a.query))
        saveMemories(memories)
        notes.push(before > memories.length ? `🧠 Olvidado (${before - memories.length})` : `⚠ No recordaba nada de "${a.query}"`)
        break
      }
      case 'invalid':
        notes.push(`⚠ ${a.reason}`)
        break
    }
  }
  settingsChanged()
  return notes
}

const chat: ChatService = new ChatService({
  getProvider: () => makeProvider(config.provider, config.baseUrl, config.model, getApiKey(config.provider)),
  getPersona: () => ({ name: config.name, personality: config.personality }),
  getContext: appContext,
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
  onActions: runActions,
  speak: (t: string): Promise<void> => voice.speak(t, undefined, true),
  stopSpeaking: () => voice.stopSpeaking()
})

const pomodoro = new PomodoroManager(
  () => ({ focusMin: config.pomodoroFocusMin, breakMin: config.pomodoroBreakMin }),
  {
    onFocusStart: (cycle, c) => {
      controller?.dispatch({ type: 'work', on: true })
      const msg =
        cycle === 1
          ? `Bueno, a trabajar ${c.focusMin} minutos. Yo también… más o menos.`
          : `Se acabó el descanso. Otros ${c.focusMin} minutos, ánimo.`
      announce({ text: `🍅 ${msg}` }, msg)
      notify('Pomodoro', `Foco: ${c.focusMin} min`)
      refreshTray()
    },
    onBreakStart: (_cycle, c) => {
      controller?.dispatch({ type: 'work', on: false })
      controller?.dispatch({ type: 'dance' })
      announce({
        text: `🍅 ¡Descanso! ${c.breakMin} minutos. Estírate, toma agua.`,
        buttons: [{ id: 'pomodoro:stop', label: 'Terminar Pomodoro' }]
      })
      notify('Pomodoro', `Descanso: ${c.breakMin} min`)
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
    width: 760,
    minWidth: 560,
    minHeight: 560,
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
    voice.stopListening()
    voice.stopSpeaking()
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
    { label: `Conversar con ${config.name}`, click: () => bubble.open() },
    { label: 'Hablar por voz', accelerator: config.pushToTalkKey, click: () => { bubble.open(); if (!chat.isBusy()) void voice.listenOnce('chat') } },
    pomodoroItem,
    { label: 'Acciones', submenu: [
      { label: 'Saludar', click: () => greetPet() },
      { label: 'Bailar', click: () => controller?.dispatch({ type: 'dance' }) },
      { label: 'Sentarse', click: () => controller?.dispatch({ type: 'sit' }) },
      { label: 'Dormir', click: () => controller?.dispatch({ type: 'sleep' }) }
    ] },
    { label: 'Pasear por el escritorio', type: 'checkbox', checked: config.wanderEnabled, click: (item) => { config.wanderEnabled = item.checked; saveConfig(config); applyConfig() } },
    { label: 'Tamaño', submenu: [0.6, 1, 1.4].map((scale, i) => ({ label: ['Pequeño', 'Mediano', 'Grande'][i], type: 'radio' as const, checked: config.scale === scale, click: () => { config.scale = scale; saveConfig(config); applyConfig() } })) },
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
  controller?.setOptions({ scale: config.scale, sleepAfterMs: config.sleepAfterMinutes * 60_000, wanderEnabled: config.wanderEnabled })
  if (!pomodoro.isRunning()) tray?.setToolTip(config.name)
  refreshTray()
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: config.startWithWindows })
  registerShortcuts()
  void voice.apply()
}

function registerShortcuts(): void {
  globalShortcut.unregisterAll()
  if (!config.listenEnabled) return
  try {
    globalShortcut.register(config.pushToTalkKey, () => {
      pet?.showInactive()
      if (voice.isListening()) voice.stopListening()
      else if (!chat.isBusy()) { bubble.open(); void voice.listenOnce('chat') }
    })
  } catch (e) {
    console.warn('No se pudo registrar el atajo', config.pushToTalkKey, e)
  }
}

// ---------- IPC ----------

ipcMain.on('pet:hit', (_e, overPet: unknown) => {
  pet?.setIgnoreMouseEvents(overPet !== true, { forward: true })
})
function greetPet(): void {
  if (chat.isBusy()) {
    if (voice.isSpeaking()) voice.stopSpeaking()
    return
  }
  const sleeping = controller?.state.state === 'sleep' || controller?.state.state === 'yawn'
  controller?.dispatch({ type: 'click' })
  const greetings = ['Aquí estoy. ¿Qué hacemos?', 'Hola. Me alegra verte por aquí.', '¿Me llamabas? Clic derecho si quieres conversar.']
  const text = pomodoro.isRunning() ? `Seguimos con el Pomodoro. Faltan ${formatRemaining(pomodoro.remainingMs())}.` : sleeping ? 'Ya desperté. ¿Qué necesitas?' : greetings[Math.floor(Math.random() * greetings.length)]
  bubble.update({ state: 'caption', text })
  void voice.speak(text)
}
ipcMain.on('pet:click', greetPet)
ipcMain.on('pet:dblclick', () => { if (!chat.isBusy()) controller?.dispatch({ type: 'play' }) })
ipcMain.on('pet:dragStart', (_e, o: { offsetX?: unknown; offsetY?: unknown }) => {
  controller?.startDrag(Number(o?.offsetX) || 0, Number(o?.offsetY) || 0)
})
ipcMain.on('pet:dragEnd', () => controller?.endDrag())
ipcMain.on('pet:contextmenu', () => {
  if (pet) buildMenu().popup({ window: pet })
})

ipcMain.handle('app:overview', (): CompanionOverview => ({
  name: config.name,
  configured: !!config.model && (config.provider === 'ollama' || hasApiKey(config.provider)),
  voice: voice.canSpeak(),
  listening: voice.canListen(),
  memories: memories.length,
  reminders: reminders.all().length,
  focus: { phase: pomodoro.state.phase, remainingMs: pomodoro.remainingMs(), ...pomodoro.config() }
}))
ipcMain.handle('app:command', (_e, input: unknown) => {
  try {
    const action = parseCompanionAction(input)
    let text = ''
    switch (action.type) {
      case 'chat': bubble.open(); break
      case 'greet': controller?.dispatch({ type: 'alert' }); text = `${config.name} te saluda.`; break
      case 'focusStart':
        if (!pomodoro.isRunning()) pomodoro.start()
        text = 'Pomodoro activo. Vamos paso a paso.'
        break
      case 'focusStop': pomodoro.stop(); text = 'Pomodoro terminado.'; break
      case 'reminder': {
        const [r] = reminders.add([{ text: action.text, at: Date.now() + action.minutes * 60_000 }])
        text = `Te recordaré: ${r.text}, ${formatWhen(r.at, Date.now())}.`
        break
      }
    }
    settingsChanged()
    return { ok: true, text }
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'No pude realizar la acción.' } }
})
ipcMain.on('settings:open', openSettings)
ipcMain.on('settings:getKey', () => { void shell.openExternal('https://aistudio.google.com/apikey').catch((e) => console.warn('No se pudo abrir el navegador', e)) })
ipcMain.on('chat:reset', () => {
  chat.reset()
})
ipcMain.handle('chat:snapshot', () => chat.snapshot())
ipcMain.on('chat:cancel', () => chat.cancel())
ipcMain.on('chat:retry', () => void chat.retry())
ipcMain.on('chat:send', (_e, text: unknown) => {
  if (typeof text === 'string') { voice.stopListening(); if (!chat.isBusy()) voice.stopSpeaking(); void chat.send(text) }
})
ipcMain.on('chat:dismiss', () => { bubble.dismiss(); voice.stopSpeaking() })
ipcMain.on('chat:close', () => {
  voice.stopListening()
  voice.stopSpeaking()
  bubble.hide()
  void chat.flushMemory()
})
ipcMain.on('chat:action', (_e, id: unknown) => {
  if (typeof id !== 'string') return
  if (id.startsWith('snooze:')) {
    const [, min, ...rest] = id.split(':')
    const text = rest.join(':')
    const m = Number(min) || SNOOZE_MIN
    const [r] = reminders.add([{ at: Date.now() + m * 60_000, text }])
    bubble.update({ state: 'notice', text: `Ya, te lo repito ${formatWhen(r.at, Date.now())}. 😴` })
    settingsChanged()
  } else if (id === 'pomodoro:stop') {
    pomodoro.stop()
    bubble.update({ state: 'notice', text: '🍅 Pomodoro terminado. Buen trabajo… supongo.' })
  } else if (id === 'dismiss') {
    bubble.hide()
  }
})
ipcMain.on('chat:mic', () => {
  if (voice.isListening()) voice.stopListening()
  else if (!chat.isBusy()) void voice.listenOnce('chat')
})

ipcMain.handle('voice:micTest', async () => {
  try {
    return { ok: true, text: (await voice.listenOnce('test')) ?? '' }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('voice:status', () => ({
  ...voiceStatus(),
  catalog: VOICES,
  whisperModels: WHISPER_MODELS,
  geminiVoices: GEMINI_VOICES,
  hasGeminiKey: hasApiKey('gemini'),
  sttEngine: voice.sttEngine()
}))

ipcMain.handle('voice:install', async (_e, a: { kind?: unknown; id?: unknown }) => {
  const progress = (label: string, pct: number): void =>
    settingsWin?.webContents.send('voice:progress', { kind: a?.kind, label, pct })
  try {
    if (a?.kind === 'tts' && typeof a.id === 'string') await installVoice(a.id, progress)
    else if (a?.kind === 'stt' && (a.id === 'tiny' || a.id === 'base' || a.id === 'small')) await installWhisper(a.id, progress)
    else throw new Error('Pedido inválido')
    await voice.apply()
    return { ok: true, status: voiceStatus() }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
})

ipcMain.handle('voice:test', async (_e, a: Record<string, unknown>) => {
  const c = normalizeConfig({ ...config, ...a })
  try {
    await voice.speak(`Hola, soy ${config.name}. Qué flojera hablar, pero bueno, así sueno.`, {
      voiceEngine: c.voiceEngine,
      voiceId: c.voiceId,
      geminiVoice: c.geminiVoice,
      voiceSpeed: c.voiceSpeed,
      voicePitch: c.voicePitch
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
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
    const next = normalizeConfig(payload?.config)
    if (typeof payload?.apiKey === 'string' && payload.apiKey.trim()) setApiKey(next.provider, payload.apiKey)
    saveConfig(next)
    config = next
    applyConfig()
    return { ok: true, config, hasKey: keyStatus() }
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
  reminders.all().map((r) => ({
    id: r.id,
    text: r.text,
    when: `${formatWhen(r.at, Date.now())}${r.repeat ? ` · ${describeRepeat(r.repeat)}` : ''}`
  }))
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
  // Solo se permite el micrófono (para escucharte); nada más.
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'media'))
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => perm === 'media')
  config = loadConfig()
  memories = loadMemories()
  pet = createPetWindow(Math.round(256 * config.scale))
  controller = new PetController(pet, { scale: config.scale, sleepAfterMs: config.sleepAfterMinutes * 60_000, wanderEnabled: config.wanderEnabled })
  controller.onMove((r) => bubble.follow(r))
  bubble.follow(pet.getBounds())
  pet.webContents.on('did-finish-load', () => controller?.resend())
  controller.start()
  tray = createTray()
  // Un poco después de saludar, para que los recordatorios atrasados se vean.
  setTimeout(() => reminders.start(), 2500)
  registerShortcuts()
  void voice.apply()
  if (process.env['DARK_SELFTEST']) setTimeout(() => void voice.selfTest().finally(() => app.quit()), 3000)
  if (process.env['DARK_OPEN_SETTINGS']) openSettings()


  // Primera vez sin API key: Dark lo pide y abre los ajustes.
  if (PROVIDER_PRESETS[config.provider].needsKey && !hasApiKey(config.provider)) {
    setTimeout(() => {
      bubble.update({
        state: 'notice',
        text: 'Conecta tu IA en Ajustes → Conexión. Puedes elegir un servicio con clave o usar Ollama en tu PC.'
      })
      openSettings()
    }, 1500)
  }
})

let quitting = false
app.on('before-quit', (e) => {
  // Antes de salir, guarda los recuerdos de la última conversación (máx. 4 s).
  globalShortcut.unregisterAll()
  void voice.shutdown()
  if (quitting || !config?.memoryEnabled) return
  e.preventDefault()
  quitting = true
  const timeout = new Promise((r) => setTimeout(r, 4000))
  void Promise.race([chat.flushMemory(), timeout]).finally(() => app.quit())
})

app.on('window-all-closed', () => app.quit())
