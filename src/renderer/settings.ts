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

$<HTMLImageElement>('avatar').src = iconUrl

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
    startWithWindows: startup.checked
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

void init()
