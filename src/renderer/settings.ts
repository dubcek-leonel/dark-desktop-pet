import iconUrl from '../../assets/character/dark/icon-512.png'
import type { Config, ProviderId } from '../core/config'

interface Preset {
  label: string
  baseUrl: string
  model: string
  needsKey: boolean
}
interface GetResult {
  config: Config
  hasKey: Record<ProviderId, boolean>
  presets: Record<ProviderId, Preset>
}
interface VoiceStatus {
  piper: boolean
  whisper: boolean
  voices: Record<string, boolean>
  models: Record<string, boolean>
  catalog: Array<{ id: string; label: string; sizeMB: number }>
  whisperModels: Array<{ id: string; label: string; sizeMB: number }>
  geminiVoices: Array<{ id: string; label: string }>
  hasGeminiKey: boolean
  sttEngine: 'whisper' | 'gemini' | null
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T
$<HTMLImageElement>('avatar').src = iconUrl

let state: GetResult
let vs: VoiceStatus
let cfg: Config

// ---------- Pestañas ----------
document.querySelectorAll<HTMLButtonElement>('nav button').forEach((b) => {
  b.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('active', x === b))
    document
      .querySelectorAll<HTMLElement>('section[data-tab]')
      .forEach((s) => s.classList.toggle('active', s.dataset.tab === b.dataset.tab))
  })
})

// ---------- Utilidades ----------
type Kind = 'ok' | 'err' | 'warn' | ''
function status(id: string, text: string, kind: Kind = '', pct?: number): void {
  const el = $(id)
  el.className = `status ${text ? 'show' : ''} ${kind}`
  el.querySelector('span')!.textContent = text
  const bar = el.querySelector<HTMLDivElement>('.progress')
  if (bar) {
    bar.style.display = pct === undefined ? 'none' : ''
    bar.querySelector('div')!.style.width = `${pct ?? 0}%`
  }
}

let savedTimer: ReturnType<typeof setTimeout> | null = null
function flashSaved(): void {
  $('saved').classList.add('show')
  if (savedTimer) clearTimeout(savedTimer)
  savedTimer = setTimeout(() => $('saved').classList.remove('show'), 1500)
}

// ---------- Leer el formulario ----------
const provider = $<HTMLSelectElement>('provider')
const apiKey = $<HTMLInputElement>('apiKey')
const voicePick = $<HTMLSelectElement>('voicePick')

function listenMode(): 'button' | 'wake' {
  return document.querySelector<HTMLInputElement>('input[name="listenMode"]:checked')?.value === 'wake'
    ? 'wake'
    : 'button'
}

function readForm(): Config {
  const [engine, voice] = voicePick.value.split(':')
  const listenOn = $<HTMLInputElement>('listenOn').checked
  return {
    ...cfg,
    provider: provider.value as ProviderId,
    model: $<HTMLInputElement>('model').value,
    baseUrl: $<HTMLInputElement>('baseUrl').value,
    name: $<HTMLInputElement>('name').value,
    personality: $<HTMLTextAreaElement>('personality').value,
    scale: Number($<HTMLInputElement>('scale').value),
    sleepAfterMinutes: Number($<HTMLInputElement>('sleep').value),
    startWithWindows: $<HTMLInputElement>('startup').checked,
    memoryEnabled: $<HTMLInputElement>('memoryEnabled').checked,
    pomodoroFocusMin: Number($<HTMLInputElement>('focusMin').value),
    pomodoroBreakMin: Number($<HTMLInputElement>('breakMin').value),
    voiceEnabled: $<HTMLInputElement>('voiceEnabled').checked,
    voiceEngine: engine === 'gemini' ? 'gemini' : 'piper',
    voiceId: engine === 'piper' ? voice : cfg.voiceId,
    geminiVoice: engine === 'gemini' ? voice : cfg.geminiVoice,
    voiceSpeed: Number($<HTMLInputElement>('voiceSpeed').value),
    voicePitch: Number($<HTMLInputElement>('voicePitch').value),
    listenEnabled: listenOn,
    wakeWordEnabled: listenOn && listenMode() === 'wake',
    conversationMode: $<HTMLInputElement>('conversationMode').checked,
    pushToTalkKey: $<HTMLInputElement>('pushToTalkKey').value,
    sttEngine: $<HTMLSelectElement>('sttEngine').value as Config['sttEngine'],
    whisperModel: $<HTMLSelectElement>('whisperModel').value as Config['whisperModel']
  }
}

// ---------- Guardado automático ----------
let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave(delay = 350): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void save(), delay)
}

async function save(): Promise<void> {
  const config = readForm()
  const key = apiKey.value.trim()
  const r = await window.api.invoke<{ ok: boolean; hasKey?: Record<ProviderId, boolean>; error?: string }>(
    'config:save',
    { config, apiKey: key }
  )
  if (!r.ok) return status('probe', r.error ?? 'No se pudo guardar', 'err')
  cfg = config
  if (r.hasKey) state.hasKey = r.hasKey
  if (key) apiKey.value = ''
  refreshKeyUi()
  flashSaved()
  await refreshVoice()
}

document.querySelectorAll<HTMLElement>('main input, main select, main textarea').forEach((el) => {
  if (el.id === 'apiKey') return el.addEventListener('change', () => scheduleSave(0))
  const isText = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type === 'text')
  el.addEventListener(isText ? 'input' : 'change', () => scheduleSave(isText ? 700 : 150))
})

// ---------- IA ----------
function refreshKeyUi(): void {
  const p = provider.value as ProviderId
  $('keyBlock').style.display = state.presets[p].needsKey ? '' : 'none'
  apiKey.placeholder = state.hasKey[p] ? '•••••••• guardada (escribe otra para cambiarla)' : 'Pega aquí tu API key'
  $('keyHint').textContent =
    p === 'gemini'
      ? 'Gratis en aistudio.google.com → "Get API key". Se guarda cifrada en tu PC. También sirve para la voz.'
      : 'Se guarda cifrada en tu PC.'
}

provider.addEventListener('change', () => {
  const preset = state.presets[provider.value as ProviderId]
  $<HTMLInputElement>('baseUrl').value = preset.baseUrl
  $<HTMLInputElement>('model').value = preset.model
  refreshKeyUi()
})

const probeArgs = (): Record<string, string> => ({
  provider: provider.value,
  baseUrl: $<HTMLInputElement>('baseUrl').value,
  model: $<HTMLInputElement>('model').value,
  apiKey: apiKey.value
})

$('loadModels').addEventListener('click', async () => {
  status('probe', 'Buscando modelos…')
  const r = await window.api.invoke<{ ok: boolean; models?: string[]; error?: string }>('ai:listModels', probeArgs())
  if (!r.ok) return status('probe', r.error ?? 'Error', 'err')
  const list = (r.models ?? []).filter((m) => !/embedding|tts|image|transcribe|robotics|computer-use|audio/i.test(m))
  $('models').replaceChildren(...list.map((m) => Object.assign(document.createElement('option'), { value: m })))
  status('probe', `${list.length} modelos. Haz clic en "Modelo" para elegir.`, 'ok')
})

$('test').addEventListener('click', async () => {
  status('probe', 'Probando…')
  const r = await window.api.invoke<{ ok: boolean; text?: string; error?: string }>('ai:test', probeArgs())
  status('probe', r.ok ? `✓ Responde: ${r.text}` : (r.error ?? 'Error'), r.ok ? 'ok' : 'err')
})

// ---------- Voz: hablar ----------
function fillVoicePick(): void {
  const keep = voicePick.value || (cfg.voiceEngine === 'gemini' ? `gemini:${cfg.geminiVoice}` : `piper:${cfg.voiceId}`)
  const l = document.createElement('optgroup')
  l.label = '⚡ Locales (sin internet · instantáneas)'
  for (const v of vs.catalog) {
    const ready = vs.piper && vs.voices[v.id]
    l.appendChild(
      Object.assign(document.createElement('option'), {
        value: `piper:${v.id}`,
        textContent: `${v.label}${ready ? '' : ` — ⬇ ${v.sizeMB} MB`}`
      })
    )
  }
  const g = document.createElement('optgroup')
  g.label = vs.hasGeminiKey
    ? '✨ Naturales (Gemini · internet · tardan unos segundos)'
    : '✨ Naturales (necesitan tu API key de Gemini)'
  for (const v of vs.geminiVoices) {
    g.appendChild(Object.assign(document.createElement('option'), { value: `gemini:${v.id}`, textContent: v.label }))
  }
  voicePick.replaceChildren(l, g)
  voicePick.value = keep
}

let downloading = false

async function install(kind: 'tts' | 'stt', id: string, statusId: string): Promise<boolean> {
  if (downloading) return false
  downloading = true
  status(statusId, 'Descargando…', '', 0)
  const r = await window.api.invoke<{ ok: boolean; error?: string }>('voice:install', { kind, id })
  downloading = false
  if (!r.ok) {
    status(statusId, `No se pudo descargar: ${r.error}`, 'err')
    return false
  }
  return true
}

window.api.on('voice:progress', (p: { kind: string; label: string; pct: number }) => {
  status(p.kind === 'tts' ? 'voiceStatus' : 'listenStatus', `⬇ ${p.label}… ${p.pct}%`, '', p.pct)
})

async function ensureSpeakReady(): Promise<void> {
  const c = readForm()
  if (!c.voiceEnabled) return status('voiceStatus', '')
  if (c.voiceEngine === 'gemini') {
    if (!vs.hasGeminiKey) return status('voiceStatus', 'Esta voz necesita tu API key de Gemini (pestaña 🤖 IA).', 'warn')
    return status('voiceStatus', '✓ Lista. Suena natural; tarda unos segundos en empezar a hablar.', 'ok')
  }
  if (!(vs.piper && vs.voices[c.voiceId])) {
    // Se descarga sola al elegirla: sin pasos extra.
    if (await install('tts', c.voiceId, 'voiceStatus')) {
      await refreshVoice()
      status('voiceStatus', '✓ Voz descargada y lista. Toca ▶ Probar.', 'ok')
    }
    return
  }
  status('voiceStatus', '✓ Lista. Responde al instante y funciona sin internet.', 'ok')
}

$('voiceEnabled').addEventListener('change', () => void ensureSpeakReady())
voicePick.addEventListener('change', () => void ensureSpeakReady())

$('voiceTest').addEventListener('click', async () => {
  const c = readForm()
  status('voiceStatus', '🔊 Hablando…')
  const r = await window.api.invoke<{ ok: boolean; error?: string }>('voice:test', {
    voiceEngine: c.voiceEngine,
    voiceId: c.voiceId,
    geminiVoice: c.geminiVoice,
    voiceSpeed: c.voiceSpeed,
    voicePitch: c.voicePitch
  })
  if (r.ok) void ensureSpeakReady()
  else status('voiceStatus', r.error ?? 'Error', 'err')
})

function showSliders(): void {
  $<HTMLOutputElement>('voiceSpeedOut').value = `${Number($<HTMLInputElement>('voiceSpeed').value).toFixed(2)}×`
  $<HTMLOutputElement>('voicePitchOut').value = `${Number($<HTMLInputElement>('voicePitch').value).toFixed(2)}×`
  $('speedNote').textContent = voicePick.value.startsWith('gemini') ? '(no aplica a voces naturales)' : ''
}
$('voiceSpeed').addEventListener('input', showSliders)
$('voicePitch').addEventListener('input', showSliders)
voicePick.addEventListener('change', showSliders)

// ---------- Voz: escuchar ----------
function refreshListenUi(): void {
  const c = readForm()
  const on = $<HTMLInputElement>('listenOn').checked
  $('listenCard').classList.toggle('off', !on)
  $('speakCard').classList.toggle('off', !c.voiceEnabled)
  $('kbdShow').textContent = c.pushToTalkKey
  const sttReady = vs.whisper && vs.models[c.whisperModel]
  $<HTMLButtonElement>('sttDownload').style.display = sttReady ? 'none' : ''
  if (!on) return status('listenStatus', '')
  if (vs.sttEngine === 'gemini') status('listenStatus', '✓ Listo. Te entiende con Gemini (usa internet).', 'ok')
  else if (vs.sttEngine === 'whisper') status('listenStatus', '✓ Listo. Te entiende en tu PC, sin internet.', 'ok')
  else if (c.sttEngine === 'whisper')
    status('listenStatus', 'Falta descargar el reconocimiento local: abre "Más opciones" → ⬇ Descargar.', 'warn')
  else status('listenStatus', 'Para entenderte necesito tu API key de Gemini (pestaña 🤖 IA) o el reconocimiento local.', 'warn')
}

$('sttDownload').addEventListener('click', async () => {
  if (await install('stt', $<HTMLSelectElement>('whisperModel').value, 'listenStatus')) {
    await refreshVoice()
    status('listenStatus', '✓ Reconocimiento local instalado.', 'ok')
  }
})

window.api.on('voice:level', (l: number) => {
  $('micMeter').style.width = `${Math.round(l * 100)}%`
})

$('micTest').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('micTest')
  btn.disabled = true
  $('micHint').textContent = '🎙 Habla ahora…'
  const r = await window.api.invoke<{ ok: boolean; text?: string; error?: string }>('voice:micTest')
  btn.disabled = false
  $('micMeter').style.width = '0'
  $('micHint').textContent = 'Di algo después de tocar el botón.'
  if (!r.ok) status('listenStatus', r.error ?? 'Error', 'err')
  else if (r.text) status('listenStatus', `✓ Te escuché: "${r.text}"`, 'ok')
  else status('listenStatus', 'No escuché nada. ¿El micrófono está conectado y permitido en Windows?', 'warn')
})

document
  .querySelectorAll('#listenCard input, #speakCard input, #listenCard select')
  .forEach((el) => el.addEventListener('change', refreshListenUi))

async function refreshVoice(): Promise<void> {
  vs = await window.api.invoke<VoiceStatus>('voice:status')
  fillVoicePick()
  const wm = $<HTMLSelectElement>('whisperModel')
  const keep = wm.value || cfg.whisperModel
  wm.replaceChildren(
    ...vs.whisperModels.map((m) =>
      Object.assign(document.createElement('option'), {
        value: m.id,
        textContent: `${m.label}${vs.whisper && vs.models[m.id] ? ' ✓' : ` — ⬇ ${m.sizeMB} MB`}`
      })
    )
  )
  wm.value = keep
  showSliders()
  refreshListenUi()
}

// ---------- Memoria y recordatorios ----------
function li(text: string, onDelete: () => void, extra?: string): HTMLLIElement {
  const el = document.createElement('li')
  el.appendChild(Object.assign(document.createElement('span'), { textContent: text }))
  if (extra) el.appendChild(Object.assign(document.createElement('small'), { textContent: extra }))
  const b = Object.assign(document.createElement('button'), { type: 'button', textContent: '✕', title: 'Borrar' })
  b.addEventListener('click', onDelete)
  el.appendChild(b)
  return el
}
const empty = (t: string): HTMLLIElement =>
  Object.assign(document.createElement('li'), { className: 'empty', textContent: t })

function renderMemories(list: string[]): void {
  $('memList').replaceChildren(
    ...(list.length
      ? list.map((m, i) => li(m, async () => renderMemories(await window.api.invoke<string[]>('memory:delete', i))))
      : [empty('Todavía no recuerda nada de ti.')])
  )
}
function renderReminders(list: Array<{ id: string; text: string; when: string }>): void {
  $('remList').replaceChildren(
    ...(list.length
      ? list.map((r) =>
          li(
            r.text,
            async () => {
              await window.api.invoke('reminders:delete', r.id)
              void loadLists()
            },
            r.when
          )
        )
      : [empty('No hay recordatorios pendientes.')])
  )
}
async function loadLists(): Promise<void> {
  renderMemories(await window.api.invoke<string[]>('memory:list'))
  renderReminders(await window.api.invoke('reminders:list'))
}
$('memClear').addEventListener('click', async () => {
  if (!confirm('¿Borrar todo lo que Dark recuerda de ti? No se puede deshacer.')) return
  renderMemories(await window.api.invoke<string[]>('memory:clear'))
})
window.api.on('settings:refresh', () => void loadLists())

// ---------- Inicio ----------
$('scale').addEventListener('input', () => {
  $<HTMLOutputElement>('scaleOut').value = `${Math.round(Number($<HTMLInputElement>('scale').value) * 100)}%`
})

async function init(): Promise<void> {
  state = await window.api.invoke<GetResult>('config:get')
  cfg = state.config
  const c = cfg
  for (const [id, p] of Object.entries(state.presets)) {
    provider.appendChild(Object.assign(document.createElement('option'), { value: id, textContent: p.label }))
  }
  provider.value = c.provider
  $<HTMLInputElement>('model').value = c.model
  $<HTMLInputElement>('baseUrl').value = c.baseUrl
  $<HTMLInputElement>('name').value = c.name
  $<HTMLTextAreaElement>('personality').value = c.personality
  $<HTMLInputElement>('scale').value = String(c.scale)
  $<HTMLOutputElement>('scaleOut').value = `${Math.round(c.scale * 100)}%`
  $<HTMLInputElement>('sleep').value = String(c.sleepAfterMinutes)
  $<HTMLInputElement>('startup').checked = c.startWithWindows
  $<HTMLInputElement>('focusMin').value = String(c.pomodoroFocusMin)
  $<HTMLInputElement>('breakMin').value = String(c.pomodoroBreakMin)
  $<HTMLInputElement>('memoryEnabled').checked = c.memoryEnabled
  $<HTMLInputElement>('voiceEnabled').checked = c.voiceEnabled
  $<HTMLInputElement>('voiceSpeed').value = String(c.voiceSpeed)
  $<HTMLInputElement>('voicePitch').value = String(c.voicePitch)
  $<HTMLInputElement>('listenOn').checked = c.listenEnabled || c.wakeWordEnabled
  document.querySelector<HTMLInputElement>(
    `input[name="listenMode"][value="${c.wakeWordEnabled ? 'wake' : 'button'}"]`
  )!.checked = true
  $<HTMLInputElement>('conversationMode').checked = c.conversationMode
  $<HTMLInputElement>('pushToTalkKey').value = c.pushToTalkKey
  $<HTMLSelectElement>('sttEngine').value = c.sttEngine
  $('wakeTitle').textContent = `Siempre, cuando digo "${c.name}"`
  document.title = `Ajustes de ${c.name}`
  $('title').textContent = `Ajustes de ${c.name}`
  refreshKeyUi()
  await refreshVoice()
  void ensureSpeakReady()
  void loadLists()
}

void init()
