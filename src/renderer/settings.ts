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

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const form = $<HTMLFormElement>('form')
const provider = $<HTMLSelectElement>('provider')
const apiKey = $<HTMLInputElement>('apiKey')
const keyBlock = $<HTMLDivElement>('keyBlock')
const keyHint = $<HTMLDivElement>('keyHint')
const model = $<HTMLInputElement>('model')
const models = $<HTMLDataListElement>('models')
const baseUrl = $<HTMLInputElement>('baseUrl')
const name = $<HTMLInputElement>('name')
const personality = $<HTMLTextAreaElement>('personality')
const scale = $<HTMLInputElement>('scale')
const scaleOut = $<HTMLOutputElement>('scaleOut')
const sleep = $<HTMLInputElement>('sleep')
const startup = $<HTMLInputElement>('startup')
const status = $<HTMLDivElement>('status')
const probe = $<HTMLDivElement>('probe')
const focusMin = $<HTMLInputElement>('focusMin')
const breakMin = $<HTMLInputElement>('breakMin')
const memoryEnabled = $<HTMLInputElement>('memoryEnabled')
const memList = $<HTMLUListElement>('memList')
const remList = $<HTMLUListElement>('remList')

$<HTMLImageElement>('avatar').src = iconUrl

function li(text: string, onDelete: () => void, extra?: string): HTMLLIElement {
  const el = document.createElement('li')
  const span = document.createElement('span')
  span.textContent = text
  el.appendChild(span)
  if (extra) {
    const small = document.createElement('small')
    small.textContent = extra
    el.appendChild(small)
  }
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = '✕'
  btn.title = 'Borrar'
  btn.addEventListener('click', onDelete)
  el.appendChild(btn)
  return el
}

function empty(text: string): HTMLLIElement {
  const el = document.createElement('li')
  el.className = 'empty'
  el.textContent = text
  return el
}

function renderMemories(list: string[]): void {
  memList.replaceChildren(
    ...(list.length
      ? list.map((m, i) =>
          li(m, async () => renderMemories(await window.api.invoke<string[]>('memory:delete', i)))
        )
      : [empty('Todavía no recuerda nada de ti.')])
  )
}

interface ReminderRow {
  id: string
  text: string
  when: string
}
function renderReminders(list: ReminderRow[]): void {
  remList.replaceChildren(
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
  renderReminders(await window.api.invoke<ReminderRow[]>('reminders:list'))
}

$<HTMLButtonElement>('memClear').addEventListener('click', async () => {
  if (!confirm('¿Borrar todo lo que Dark recuerda de ti? No se puede deshacer.')) return
  renderMemories(await window.api.invoke<string[]>('memory:clear'))
})

window.api.on('settings:refresh', () => void loadLists())

let state: GetResult

function say(el: HTMLElement, text: string, kind: 'ok' | 'err' | '' = ''): void {
  el.textContent = text
  el.className = kind
}

function refreshKeyUi(): void {
  const p = provider.value as ProviderId
  const preset = state.presets[p]
  keyBlock.style.display = preset.needsKey ? '' : 'none'
  const saved = state.hasKey[p]
  apiKey.value = ''
  apiKey.placeholder = saved ? '•••••••• (guardada, escribe otra para cambiarla)' : 'Pega aquí tu API key'
  keyHint.textContent =
    p === 'gemini'
      ? 'Se consigue gratis en aistudio.google.com → "Get API key". Se guarda cifrada en tu PC.'
      : 'Se guarda cifrada en tu PC y solo se usa para hablar con la IA.'
}

function onProviderChange(): void {
  const preset = state.presets[provider.value as ProviderId]
  baseUrl.value = preset.baseUrl
  model.value = preset.model
  models.innerHTML = ''
  say(probe, '')
  refreshKeyUi()
}

function probeArgs(): Record<string, string> {
  return { provider: provider.value, baseUrl: baseUrl.value, model: model.value, apiKey: apiKey.value }
}

async function init(): Promise<void> {
  state = await window.api.invoke<GetResult>('config:get')
  const c = state.config
  for (const [id, p] of Object.entries(state.presets)) {
    const opt = document.createElement('option')
    opt.value = id
    opt.textContent = p.label
    provider.appendChild(opt)
  }
  provider.value = c.provider
  model.value = c.model
  baseUrl.value = c.baseUrl
  name.value = c.name
  personality.value = c.personality
  scale.value = String(c.scale)
  scaleOut.value = `${Math.round(c.scale * 100)}%`
  sleep.value = String(c.sleepAfterMinutes)
  startup.checked = c.startWithWindows
  focusMin.value = String(c.pomodoroFocusMin)
  breakMin.value = String(c.pomodoroBreakMin)
  memoryEnabled.checked = c.memoryEnabled
  voiceEnabled.checked = c.voiceEnabled
  voiceSpeed.value = String(c.voiceSpeed)
  voicePitch.value = String(c.voicePitch)
  listenEnabled.checked = c.listenEnabled
  wakeWordEnabled.checked = c.wakeWordEnabled
  pushToTalkKey.value = c.pushToTalkKey
  $<HTMLLabelElement>('wakeLabel').textContent = `Escuchar siempre y activarse al decir "${c.name}"`
  showSliders()
  await loadVoice(c.voiceId, c.whisperModel)
  void loadLists()
  document.title = `Ajustes de ${c.name}`
  $<HTMLHeadingElement>('title').textContent = `Ajustes de ${c.name}`
  refreshKeyUi()
}

provider.addEventListener('change', onProviderChange)
scale.addEventListener('input', () => (scaleOut.value = `${Math.round(Number(scale.value) * 100)}%`))

$<HTMLButtonElement>('loadModels').addEventListener('click', async () => {
  say(probe, 'Buscando modelos…')
  const r = await window.api.invoke<{ ok: boolean; models?: string[]; error?: string }>('ai:listModels', probeArgs())
  if (!r.ok) return say(probe, r.error ?? 'Error', 'err')
  models.innerHTML = ''
  const list = (r.models ?? []).filter((m) => !/embedding|tts|image|transcribe|robotics|computer-use|audio/i.test(m))
  for (const m of list) {
    const opt = document.createElement('option')
    opt.value = m
    models.appendChild(opt)
  }
  say(probe, `${list.length} modelos disponibles. Haz clic en el campo "Modelo" para elegir.`, 'ok')
})

$<HTMLButtonElement>('test').addEventListener('click', async () => {
  say(probe, 'Probando…')
  const r = await window.api.invoke<{ ok: boolean; text?: string; error?: string }>('ai:test', probeArgs())
  if (r.ok) say(probe, `✓ Responde: ${r.text}`, 'ok')
  else say(probe, r.error ?? 'Error', 'err')
})

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  const config: Config = {
    provider: provider.value as ProviderId,
    model: model.value,
    baseUrl: baseUrl.value,
    name: name.value,
    personality: personality.value,
    scale: Number(scale.value),
    sleepAfterMinutes: Number(sleep.value),
    startWithWindows: startup.checked,
    memoryEnabled: memoryEnabled.checked,
    pomodoroFocusMin: Number(focusMin.value),
    pomodoroBreakMin: Number(breakMin.value),
    voiceEnabled: voiceEnabled.checked,
    voiceId: voiceId.value,
    voiceSpeed: Number(voiceSpeed.value),
    voicePitch: Number(voicePitch.value),
    listenEnabled: listenEnabled.checked,
    wakeWordEnabled: wakeWordEnabled.checked,
    whisperModel: whisperModel.value as Config['whisperModel'],
    pushToTalkKey: pushToTalkKey.value
  }
  const r = await window.api.invoke<{ ok: boolean; hasKey?: Record<ProviderId, boolean>; error?: string }>(
    'config:save',
    { config, apiKey: apiKey.value }
  )
  if (!r.ok) return say(status, r.error ?? 'No se pudo guardar', 'err')
  if (r.hasKey) state.hasKey = r.hasKey
  refreshKeyUi()
  say(status, '✓ Guardado', 'ok')
})

// ---------- Voz ----------

interface VoiceStatus {
  piper: boolean
  whisper: boolean
  voices: Record<string, boolean>
  models: Record<string, boolean>
  catalog: Array<{ id: string; label: string; sizeMB: number }>
  whisperModels: Array<{ id: string; label: string; sizeMB: number }>
}

const voiceEnabled = $<HTMLInputElement>('voiceEnabled')
const voiceId = $<HTMLSelectElement>('voiceId')
const voiceSpeed = $<HTMLInputElement>('voiceSpeed')
const voicePitch = $<HTMLInputElement>('voicePitch')
const voiceMsg = $<HTMLDivElement>('voiceMsg')
const voiceDownload = $<HTMLButtonElement>('voiceDownload')
const listenEnabled = $<HTMLInputElement>('listenEnabled')
const wakeWordEnabled = $<HTMLInputElement>('wakeWordEnabled')
const pushToTalkKey = $<HTMLInputElement>('pushToTalkKey')
const whisperModel = $<HTMLSelectElement>('whisperModel')
const sttDownload = $<HTMLButtonElement>('sttDownload')
const sttMsg = $<HTMLDivElement>('sttMsg')
let vs: VoiceStatus

function showSliders(): void {
  $<HTMLOutputElement>('voiceSpeedOut').value = `${Number(voiceSpeed.value).toFixed(2)}×`
  $<HTMLOutputElement>('voicePitchOut').value = `${Number(voicePitch.value).toFixed(2)}×`
}
voiceSpeed.addEventListener('input', showSliders)
voicePitch.addEventListener('input', showSliders)

function refreshVoiceUi(): void {
  const voiceReady = vs.piper && vs.voices[voiceId.value]
  voiceDownload.style.display = voiceReady ? 'none' : ''
  const v = vs.catalog.find((x) => x.id === voiceId.value)
  if (!voiceReady) say(voiceMsg, `Hay que descargar esta voz (~${(v?.sizeMB ?? 0) + (vs.piper ? 0 : 21)} MB, una sola vez).`)
  else say(voiceMsg, '✓ Voz instalada.', 'ok')
  const sttReady = vs.whisper && vs.models[whisperModel.value]
  sttDownload.style.display = sttReady ? 'none' : ''
  const m = vs.whisperModels.find((x) => x.id === whisperModel.value)
  if (!sttReady)
    say(sttMsg, `Hay que descargar el reconocimiento de voz (~${(m?.sizeMB ?? 0) + (vs.whisper ? 0 : 9)} MB, una sola vez).`)
  else say(sttMsg, '✓ Reconocimiento de voz instalado.', 'ok')
}

async function loadVoice(selectedVoice?: string, selectedModel?: string): Promise<void> {
  vs = await window.api.invoke<VoiceStatus>('voice:status')
  const keepV = selectedVoice ?? voiceId.value
  const keepM = selectedModel ?? whisperModel.value
  voiceId.replaceChildren(
    ...vs.catalog.map((v) => {
      const o = document.createElement('option')
      o.value = v.id
      o.textContent = `${vs.voices[v.id] ? '✓ ' : ''}${v.label}`
      return o
    })
  )
  whisperModel.replaceChildren(
    ...vs.whisperModels.map((m) => {
      const o = document.createElement('option')
      o.value = m.id
      o.textContent = `${vs.models[m.id] ? '✓ ' : ''}${m.label}`
      return o
    })
  )
  voiceId.value = keepV
  whisperModel.value = keepM
  refreshVoiceUi()
}

voiceId.addEventListener('change', refreshVoiceUi)
whisperModel.addEventListener('change', refreshVoiceUi)

window.api.on('voice:progress', (p: { kind: string; label: string; pct: number }) => {
  say(p.kind === 'tts' ? voiceMsg : sttMsg, `${p.label}… ${p.pct}%`)
})

async function install(kind: 'tts' | 'stt', id: string, btn: HTMLButtonElement, msg: HTMLDivElement): Promise<boolean> {
  btn.disabled = true
  say(msg, 'Descargando…')
  const r = await window.api.invoke<{ ok: boolean; error?: string }>('voice:install', { kind, id })
  btn.disabled = false
  if (!r.ok) {
    say(msg, r.error ?? 'Error', 'err')
    return false
  }
  await loadVoice()
  return true
}

voiceDownload.addEventListener('click', async () => {
  if (await install('tts', voiceId.value, voiceDownload, voiceMsg)) {
    voiceEnabled.checked = true
    say(voiceMsg, '✓ Voz instalada. Pulsa Guardar para activarla.', 'ok')
  }
})
sttDownload.addEventListener('click', async () => {
  if (await install('stt', whisperModel.value, sttDownload, sttMsg)) {
    listenEnabled.checked = true
    say(sttMsg, '✓ Instalado. Pulsa Guardar para activarlo.', 'ok')
  }
})

$<HTMLButtonElement>('voiceTest').addEventListener('click', async () => {
  if (!(vs.piper && vs.voices[voiceId.value])) return say(voiceMsg, 'Primero descarga esta voz.', 'err')
  say(voiceMsg, 'Hablando…')
  await window.api.invoke('voice:test', {
    voiceId: voiceId.value,
    speed: Number(voiceSpeed.value),
    pitch: Number(voicePitch.value)
  })
  refreshVoiceUi()
})

void init()
