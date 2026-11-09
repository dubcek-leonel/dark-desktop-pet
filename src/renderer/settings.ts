import './theme.css'
import './settings.css'
import iconUrl from '../../assets/character/dark/icon-512.png'
import { normalizeConfig, type Config, type ProviderId } from '../core/config'
import type { CompanionAction, CompanionOverview } from '../core/companion'

interface Preset { label: string; baseUrl: string; model: string; needsKey: boolean }
interface GetResult { config: Config; hasKey: Record<ProviderId, boolean>; presets: Record<ProviderId, Preset> }
interface VoiceStatus {
  piper: boolean; whisper: boolean; voices: Record<string, boolean>; models: Record<string, boolean>
  catalog: Array<{ id: string; label: string; sizeMB: number }>
  whisperModels: Array<{ id: string; label: string; sizeMB: number }>
  geminiVoices: Array<{ id: string; label: string }>; hasGeminiKey: boolean
}
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T
const input = (id: string): HTMLInputElement => $(id)
const button = (id: string): HTMLButtonElement => $(id)
const provider = $<HTMLSelectElement>('provider')
const voiceEngine = $<HTMLSelectElement>('voiceEngine')
const voicePick = $<HTMLSelectElement>('voicePick')
const apiKey = input('apiKey')
const main = $('main')
let state: GetResult
let cfg: Config
let vs: VoiceStatus
let loaded = false
let dirty = false
let saving = false
let downloading = false
let activeProvider: ProviderId = 'gemini'
let activeVoiceEngine: 'piper' | 'gemini' = 'piper'
const keyDrafts: Partial<Record<ProviderId, string>> = {}
const connectionDrafts: Partial<Record<ProviderId, { model: string; baseUrl: string }>> = {}
let voiceChoices = { piper: '', gemini: '' }
let overview: CompanionOverview | null = null

$<HTMLImageElement>('avatar').src = iconUrl
function selectTab(tab: string): void {
  document.querySelectorAll<HTMLButtonElement>('nav [data-tab]').forEach((b) => {
    const active = b.dataset.tab === tab
    b.classList.toggle('active', active)
    b.setAttribute('aria-current', active ? 'page' : 'false')
  })
  document.querySelectorAll<HTMLElement>('section[data-tab]').forEach((s) => {
    s.hidden = s.dataset.tab !== tab
    s.classList.toggle('active', !s.hidden)
  })
  main.scrollTop = 0
  if (tab === 'tareas' && loaded) void refreshOverview()
}
document.querySelectorAll<HTMLButtonElement>('nav [data-tab], [data-go]').forEach((b) => b.addEventListener('click', () => selectTab(b.dataset.go ?? b.dataset.tab!)))
function feedback(text: string, kind = ''): void {
  $('saved').textContent = text
  $('saved').dataset.kind = kind
}
function status(id: string, text: string, kind = '', pct?: number): void {
  const el = $(id)
  el.hidden = !text
  el.className = `status ${kind}`
  el.querySelector('span')!.textContent = text
  const progress = el.querySelector<HTMLElement>('.progress')
  if (progress) {
    progress.hidden = pct === undefined
    progress.querySelector<HTMLElement>('div')!.style.width = `${pct ?? 0}%`
  }
}
const errorText = (e: unknown): string => e instanceof Error ? e.message : 'No se pudo completar la operación. Inténtalo de nuevo.'
function readForm(): Config {
  return {
    ...cfg,
    provider: provider.value as ProviderId, model: input('model').value.trim(), baseUrl: input('baseUrl').value.trim(),
    name: input('name').value.trim(), personality: $<HTMLTextAreaElement>('personality').value,
    wanderEnabled: input('wanderEnabled').checked,
    scale: Number(input('scale').value), sleepAfterMinutes: Number(input('sleep').value), startWithWindows: input('startup').checked,
    memoryEnabled: input('memoryEnabled').checked, pomodoroFocusMin: Number(input('focusMin').value), pomodoroBreakMin: Number(input('breakMin').value),
    voiceEnabled: input('voiceEnabled').checked, voiceEngine: voiceEngine.value as Config['voiceEngine'],
    voiceId: voiceEngine.value === 'piper' ? voicePick.value : voiceChoices.piper,
    geminiVoice: voiceEngine.value === 'gemini' ? voicePick.value : voiceChoices.gemini,
    voiceSpeed: Number(input('voiceSpeed').value), voicePitch: Number(input('voicePitch').value),
    listenEnabled: input('listenOn').checked,
    wakeWordEnabled: input('listenOn').checked && document.querySelector<HTMLInputElement>('input[name="listenMode"]:checked')?.value === 'wake',
    conversationMode: input('conversationMode').checked, pushToTalkKey: input('pushToTalkKey').value.trim(),
    sttEngine: $<HTMLSelectElement>('sttEngine').value as Config['sttEngine'], whisperModel: $<HTMLSelectElement>('whisperModel').value as Config['whisperModel']
  }
}
function invalidControl(): HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined {
  return Array.from(document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-setting]')).find((el) => {
    if (el.closest('#listenOptions') && !input('listenOn').checked) return false
    if (el.closest('#speakOptions') && !input('voiceEnabled').checked) return false
    return !el.checkValidity()
  })
}
function markDirty(): void {
  if (!loaded || saving) return
  const form = readForm()
  dirty = !!apiKey.value.trim() || !!invalidControl() || (Object.keys(cfg) as Array<keyof Config>).some((key) => form[key] !== cfg[key])
  button('saveSettings').disabled = !dirty
  feedback(dirty ? 'Cambios sin guardar' : 'Sin cambios pendientes')
}
function validate(): boolean {
  const invalid = invalidControl()
  if (!invalid) return true
  selectTab(invalid.closest<HTMLElement>('section[data-tab]')!.dataset.tab!)
  const details = invalid.closest('details')
  if (details) details.open = true
  // Dependent controls can be hidden while their feature is switched off.
  if (invalid.closest('[hidden]')) {
    feedback('Revisa los campos de la sección seleccionada antes de guardar.', 'error')
  } else invalid.reportValidity()
  return false
}
async function save(): Promise<boolean> {
  if (!loaded || saving || !validate()) return false
  saving = true
  main.inert = true
  button('saveSettings').disabled = true
  button('saveSettings').textContent = 'Guardando…'
  feedback('Guardando cambios…')
  try {
    const config = readForm()
    const key = apiKey.value.trim()
    const r = await window.api.invoke<{ ok: boolean; config?: Config; hasKey?: GetResult['hasKey']; error?: string }>('config:save', { config, apiKey: key })
    if (!r.ok) throw new Error(r.error ?? 'No se pudieron guardar los cambios. Inténtalo de nuevo.')
    cfg = r.config ?? normalizeConfig(config)
    if (r.hasKey) state.hasKey = r.hasKey
    apiKey.value = ''
    keyDrafts[config.provider] = ''
    dirty = false
    input('name').value = cfg.name
    input('model').value = cfg.model
    input('baseUrl').value = cfg.baseUrl
    updateTitle()
    refreshConnectionUi()
    feedback('Cambios guardados', 'ok')
    // A status refresh failing must not turn a successful save into a reported failure.
    try { await refreshVoice() } catch { status('voiceStatus', 'Los cambios se guardaron. Vuelve a abrir Ajustes para actualizar el estado de la voz.', 'warn') }
    return true
  } catch (e) { feedback(errorText(e), 'error'); return false }
  finally {
    saving = false
    main.inert = false
    button('saveSettings').textContent = 'Guardar cambios'
    button('saveSettings').disabled = !dirty
  }
}
button('saveSettings').addEventListener('click', () => void save())
document.querySelectorAll<HTMLElement>('[data-setting]').forEach((el) => {
  el.addEventListener('input', markDirty)
  el.addEventListener('change', markDirty)
})
apiKey.addEventListener('input', () => { markDirty(); status('probe', '') })
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty) void save() }
})
window.addEventListener('beforeunload', (e) => {
  if (saving || (dirty && !confirm('Tienes cambios sin guardar. ¿Cerrar sin guardarlos?'))) { e.preventDefault(); e.returnValue = '' }
})
function updateTitle(): void {
  $('title').textContent = `Ajustes de ${cfg.name}`
  document.title = `Ajustes de ${cfg.name}`
  $('wakeTitle').textContent = `Al decir “${input('name').value || cfg.name}”`
}
function refreshConnectionUi(): void {
  const p = provider.value as ProviderId
  $('keyBlock').hidden = !state.presets[p].needsKey
  apiKey.placeholder = state.hasKey[p] ? 'Clave guardada. Escribe otra para reemplazarla…' : 'Pega aquí tu clave…'
  $('getKey').hidden = p !== 'gemini'
  $('keyHint').textContent = state.hasKey[p] ? 'Ya hay una clave guardada para este servicio. Déjalo vacío para conservarla.' : 'Se guarda cifrada en tu equipo. No necesitas escribirla cada vez.'
  $('providerHint').textContent = p === 'ollama' ? 'Usa una IA instalada en tu PC. Abre Ollama y descarga un modelo antes de probar.' : p === 'gemini' ? 'Conecta Google AI Studio con una clave de Google.' : 'Para OpenAI u otro servicio compatible. Revisa la dirección en Conexión avanzada.'
}
provider.addEventListener('change', () => {
  keyDrafts[activeProvider] = apiKey.value
  connectionDrafts[activeProvider] = { model: input('model').value, baseUrl: input('baseUrl').value }
  activeProvider = provider.value as ProviderId
  const draft = connectionDrafts[activeProvider] ?? state.presets[activeProvider]
  input('model').value = draft.model
  input('baseUrl').value = draft.baseUrl
  apiKey.value = keyDrafts[activeProvider] ?? ''
  apiKey.type = 'password'
  button('showKey').textContent = 'Mostrar'
  button('showKey').setAttribute('aria-pressed', 'false')
  $('models').replaceChildren()
  status('probe', '')
  refreshConnectionUi()
  markDirty()
})
button('showKey').addEventListener('click', () => {
  const show = apiKey.type === 'password'
  apiKey.type = show ? 'text' : 'password'
  button('showKey').textContent = show ? 'Ocultar' : 'Mostrar'
  button('showKey').setAttribute('aria-pressed', String(show))
})
button('getKey').addEventListener('click', () => window.api.send('settings:getKey'))
const probeArgs = () => ({ provider: provider.value, baseUrl: input('baseUrl').value, model: input('model').value, apiKey: apiKey.value })
function validProbe(): boolean {
  if (!input('baseUrl').checkValidity()) {
    input('baseUrl').closest('details')!.open = true
    input('baseUrl').reportValidity()
    return false
  }
  if (!input('model').value.trim()) { status('probe', 'Elige un modelo antes de probar. Puedes usar «Buscar modelos».', 'warn'); input('model').focus(); return false }
  return true
}
button('test').addEventListener('click', async () => {
  if (!validProbe()) return
  const args = probeArgs()
  button('test').disabled = true
  status('probe', 'Probando la conexión…')
  try {
    const r = await window.api.invoke<{ ok: boolean; text?: string; error?: string }>('ai:test', args)
    if (JSON.stringify(args) !== JSON.stringify(probeArgs())) return
    status('probe', r.ok ? `La conexión funciona.${dirty ? ' Guarda los cambios para usarla.' : ''}` : r.error ?? 'No se pudo conectar. Revisa la clave y el modelo.', r.ok ? 'ok' : 'err')
  } catch (e) { if (JSON.stringify(args) === JSON.stringify(probeArgs())) status('probe', errorText(e), 'err') }
  finally { button('test').disabled = false }
})
button('loadModels').addEventListener('click', async () => {
  const args = probeArgs()
  button('loadModels').disabled = true
  status('probe', 'Buscando modelos…')
  try {
    const r = await window.api.invoke<{ ok: boolean; models?: string[]; error?: string }>('ai:listModels', args)
    if (JSON.stringify(args) !== JSON.stringify(probeArgs())) return
    if (!r.ok) throw new Error(r.error ?? 'No se pudo obtener la lista. Revisa la conexión.')
    const models = (r.models ?? []).filter((m) => !/embedding|tts|image|transcribe|robotics|computer-use|audio/i.test(m))
    $('models').replaceChildren(...models.map((m) => Object.assign(document.createElement('option'), { value: m })))
    if (!input('model').value && models.length) { input('model').value = models[0]; markDirty() }
    status('probe', models.length ? `${models.length} modelos disponibles. Elige uno en el campo Modelo.` : 'No hay modelos de conversación disponibles. Comprueba el servicio o instala un modelo local.', models.length ? 'ok' : 'warn')
  } catch (e) { if (JSON.stringify(args) === JSON.stringify(probeArgs())) status('probe', errorText(e), 'err') }
  finally { button('loadModels').disabled = false }
})
function fillVoices(): void {
  const options = voiceEngine.value === 'gemini' ? vs.geminiVoices : vs.catalog
  voicePick.replaceChildren(...options.map((v) => Object.assign(document.createElement('option'), { value: v.id, textContent: v.label })))
  const chosen = voiceChoices[voiceEngine.value as 'piper' | 'gemini']
  if (options.some((v) => v.id === chosen)) voicePick.value = chosen
}
function refreshVoiceUi(): void {
  if (!vs) return
  const c = readForm()
  $('speakOptions').hidden = !c.voiceEnabled
  $('listenOptions').hidden = !c.listenEnabled
  $('speedControl').hidden = c.voiceEngine === 'gemini'
  $('speedNote').hidden = c.voiceEngine !== 'gemini'
  const voiceReady = c.voiceEngine === 'gemini' ? vs.hasGeminiKey : vs.piper && vs.voices[c.voiceId]
  const localVoice = vs.catalog.find((v) => v.id === c.voiceId)
  button('voiceDownload').hidden = c.voiceEngine !== 'piper' || !!voiceReady
  button('voiceDownload').textContent = `Descargar voz${localVoice ? ` (${localVoice.sizeMB} MB)` : ''}`
  button('voiceDownload').disabled = downloading
  button('voiceTest').disabled = !voiceReady || downloading
  $('voiceConnection').hidden = c.voiceEngine !== 'gemini' || vs.hasGeminiKey
  if (!downloading) status('voiceStatus', c.voiceEngine === 'gemini' ? (voiceReady ? 'Lista para usar. Necesita conexión a internet.' : 'Falta una clave de Google. Configúrala en Conexión.') : voiceReady ? 'Voz instalada. Funciona sin internet.' : 'Descarga esta voz para poder escucharla.', voiceReady ? 'ok' : 'warn')
  const local = vs.whisper && vs.models[c.whisperModel]
  const useLocal = c.sttEngine === 'whisper' || (c.sttEngine === 'auto' && (local || !vs.hasGeminiKey))
  const listenReady = useLocal ? local : vs.hasGeminiKey
  $('localRecognition').hidden = !useLocal
  button('sttDownload').hidden = !useLocal || !!local
  button('sttDownload').disabled = downloading
  const model = vs.whisperModels.find((m) => m.id === c.whisperModel)
  button('sttDownload').textContent = `Descargar reconocimiento${model ? ` (${model.sizeMB} MB)` : ''}`
  $('listenConnection').hidden = listenReady || useLocal
  button('micTest').disabled = !listenReady || downloading
  if (!downloading) status('listenStatus', listenReady ? (useLocal ? 'Listo. Tu voz se reconoce en este equipo.' : 'Listo. Gemini entiende tu voz con internet.') : useLocal ? 'Descarga el reconocimiento local para usar el micrófono.' : 'Necesitas una clave de Google para usar Gemini.', listenReady ? 'ok' : 'warn')
  $('kbdShow').textContent = c.pushToTalkKey || 'Ctrl+Alt+D'
  $('wakeTitle').textContent = `Al decir “${c.name || cfg.name}”`
  $<HTMLOutputElement>('voiceSpeedOut').value = `${c.voiceSpeed.toFixed(2)}×`
  $<HTMLOutputElement>('voicePitchOut').value = `${c.voicePitch.toFixed(2)}×`
  $<HTMLOutputElement>('scaleOut').value = `${Math.round(c.scale * 100)}%`
}
voiceEngine.addEventListener('change', () => {
  voiceChoices[activeVoiceEngine] = voicePick.value
  activeVoiceEngine = voiceEngine.value as 'piper' | 'gemini'
  fillVoices(); refreshVoiceUi(); markDirty()
})
voicePick.addEventListener('change', () => { voiceChoices[activeVoiceEngine] = voicePick.value; refreshVoiceUi() })
document.querySelectorAll('[data-setting]').forEach((el) => el.addEventListener('input', () => { if (loaded) refreshVoiceUi() }))
async function refreshVoice(): Promise<void> {
  vs = await window.api.invoke<VoiceStatus>('voice:status')
  fillVoices()
  const wm = $<HTMLSelectElement>('whisperModel')
  const keep = wm.value || cfg.whisperModel
  wm.replaceChildren(...vs.whisperModels.map((m) => Object.assign(document.createElement('option'), { value: m.id, textContent: m.label })))
  wm.value = keep
  refreshVoiceUi()
}
async function install(kind: 'tts' | 'stt'): Promise<void> {
  if (downloading) return
  downloading = true
  refreshVoiceUi()
  const id = kind === 'tts' ? voicePick.value : $<HTMLSelectElement>('whisperModel').value
  const statusId = kind === 'tts' ? 'voiceStatus' : 'listenStatus'
  status(statusId, 'Descargando…', '', 0)
  try {
    const r = await window.api.invoke<{ ok: boolean; error?: string }>('voice:install', { kind, id })
    if (!r.ok) throw new Error(r.error ?? 'La descarga no terminó. Inténtalo de nuevo.')
    downloading = false
    await refreshVoice()
  } catch (e) { downloading = false; refreshVoiceUi(); status(statusId, `No se pudo descargar: ${errorText(e)}`, 'err') }
}
button('voiceDownload').addEventListener('click', () => void install('tts'))
button('sttDownload').addEventListener('click', () => void install('stt'))
window.api.on('voice:progress', (p: { kind: string; label: string; pct: number }) => status(p.kind === 'tts' ? 'voiceStatus' : 'listenStatus', `Descargando ${p.label}… ${p.pct}%`, '', p.pct))
button('voiceTest').addEventListener('click', async () => {
  if (dirty && !(await save())) return
  const c = readForm()
  button('voiceTest').disabled = true
  status('voiceStatus', 'Reproduciendo la voz…')
  try {
    const r = await window.api.invoke<{ ok: boolean; error?: string }>('voice:test', { voiceEngine: c.voiceEngine, voiceId: c.voiceId, geminiVoice: c.geminiVoice, voiceSpeed: c.voiceSpeed, voicePitch: c.voicePitch })
    status('voiceStatus', r.ok ? 'Prueba terminada. Esta es la voz seleccionada.' : r.error ?? 'No se pudo reproducir la voz.', r.ok ? 'ok' : 'err')
  } catch (e) { status('voiceStatus', errorText(e), 'err') }
  finally { button('voiceTest').disabled = false }
})
window.api.on('voice:level', (level: number) => { $('micMeter').style.width = `${Math.round(Math.max(0, Math.min(1, level)) * 100)}%` })
button('micTest').addEventListener('click', async () => {
  if (dirty && !(await save())) return
  button('micTest').disabled = true
  $('micHint').textContent = 'Habla ahora. La prueba termina al detectar una frase.'
  try {
    const r = await window.api.invoke<{ ok: boolean; text?: string; error?: string }>('voice:micTest')
    status('listenStatus', !r.ok ? r.error ?? 'No se pudo usar el micrófono.' : r.text ? `Se escuchó: “${r.text}”` : 'No se detectó voz. Revisa el micrófono y los permisos de Windows.', !r.ok ? 'err' : r.text ? 'ok' : 'warn')
  } catch (e) { status('listenStatus', errorText(e), 'err') }
  finally { button('micTest').disabled = false; $('micMeter').style.width = '0'; $('micHint').textContent = 'Puedes repetir la prueba cuando quieras.' }
})
function renderList(id: string, list: Array<{ text: string; extra?: string; remove: () => Promise<unknown> }>, empty: string): void {
  $(id).replaceChildren(...(list.length ? list.map((item) => {
    const row = document.createElement('li')
    const text = Object.assign(document.createElement('span'), { textContent: item.text })
    if (item.extra) text.append(Object.assign(document.createElement('small'), { textContent: item.extra }))
    const remove = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Eliminar' })
    remove.setAttribute('aria-label', `Eliminar: ${item.text}`)
    remove.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar “${item.text}”?`)) return
      remove.disabled = true
      try { await item.remove(); await loadLists() }
      catch (e) { feedback(errorText(e), 'error'); remove.disabled = false }
    })
    row.append(text, remove)
    return row
  }) : [Object.assign(document.createElement('li'), { className: 'empty', textContent: empty })]))
}
async function loadLists(): Promise<void> {
  const [memories, reminders] = await Promise.all([window.api.invoke<string[]>('memory:list'), window.api.invoke<Array<{ id: string; text: string; when: string }>>('reminders:list')])
  renderList('memList', memories.map((text, index) => ({ text, remove: () => window.api.invoke('memory:delete', index) })), 'Todavía no hay recuerdos guardados.')
  button('memClear').disabled = !memories.length
  renderList('remList', reminders.map((r) => ({ text: r.text, extra: r.when, remove: () => window.api.invoke('reminders:delete', r.id) })), 'No hay recordatorios pendientes.')
}
button('memClear').addEventListener('click', async () => {
  if (!confirm('¿Borrar todos los recuerdos? Esta acción no se puede deshacer.')) return
  button('memClear').disabled = true
  try { await window.api.invoke('memory:clear'); await loadLists(); status('memoryStatus', 'Se borraron los recuerdos.', 'ok') }
  catch (e) { status('memoryStatus', errorText(e), 'err'); button('memClear').disabled = false }
})
async function refreshOverview(): Promise<void> {
  try {
    overview = await window.api.invoke<CompanionOverview>('app:overview')
    const f = overview.focus
    const seconds = Math.max(0, Math.ceil((f.phase === 'off' ? Number(input('focusMin').value || f.focusMin) * 60_000 : f.remainingMs) / 1000))
    $('focusClock').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
    $('focusPhase').textContent = f.phase === 'off' ? 'Alterna concentración y descanso.' : f.phase === 'focus' ? 'Sesión de concentración en curso.' : 'Tiempo de descanso.'
    button('focusToggle').textContent = f.phase === 'off' ? 'Empezar foco' : 'Terminar sesión'
  } catch (e) { $('taskFeedback').textContent = errorText(e) }
}
async function command(action: CompanionAction, btn: HTMLButtonElement): Promise<boolean> {
  btn.disabled = true
  try {
    const r = await window.api.invoke<{ ok: boolean; text?: string; error?: string }>('app:command', action)
    if (!r.ok) throw new Error(r.error ?? 'La acción no se pudo completar.')
    $('taskFeedback').textContent = r.text ?? ''
    await Promise.all([refreshOverview(), loadLists()])
    return true
  } catch (e) { feedback(errorText(e), 'error'); $('taskFeedback').textContent = errorText(e); return false }
  finally { btn.disabled = false }
}
button('openChat').addEventListener('click', () => void command({ type: 'chat' }, button('openChat')))
button('focusToggle').addEventListener('click', async () => {
  if (!overview) return
  if (overview.focus.phase === 'off' && dirty && !(await save())) return
  await command({ type: overview.focus.phase === 'off' ? 'focusStart' : 'focusStop' }, button('focusToggle'))
})
$('quickReminder').addEventListener('submit', async (e) => {
  e.preventDefault()
  const text = input('reminderText')
  if (await command({ type: 'reminder', text: text.value, minutes: Number(input('reminderMinutes').value) }, document.querySelector<HTMLButtonElement>('#quickReminder button')!)) text.value = ''
})
window.api.on('settings:refresh', () => {
  if (!loaded) return
  void loadLists().catch((e) => feedback(errorText(e), 'error'))
  if (document.querySelector('section[data-tab="tareas"].active')) void refreshOverview()
})
setInterval(() => { if (loaded && !document.hidden && document.querySelector('section[data-tab="tareas"].active')) void refreshOverview() }, 1000)
async function init(): Promise<void> {
  main.inert = true
  loaded = false
  button('retryLoad').hidden = true
  try {
    state = await window.api.invoke<GetResult>('config:get')
    cfg = state.config
    activeProvider = cfg.provider
    activeVoiceEngine = cfg.voiceEngine
    voiceChoices = { piper: cfg.voiceId, gemini: cfg.geminiVoice }
    provider.replaceChildren(...Object.entries(state.presets).map(([value, p]) => Object.assign(document.createElement('option'), { value, textContent: ({ gemini: 'Gemini (Google)', openai: 'OpenAI u otro servicio compatible', ollama: 'Ollama (en este equipo)' } as Record<string, string>)[value] ?? p.label })))
    provider.value = cfg.provider
    const values = { model: cfg.model, baseUrl: cfg.baseUrl, name: cfg.name, personality: cfg.personality, scale: cfg.scale, sleep: cfg.sleepAfterMinutes, focusMin: cfg.pomodoroFocusMin, breakMin: cfg.pomodoroBreakMin, voiceSpeed: cfg.voiceSpeed, voicePitch: cfg.voicePitch, pushToTalkKey: cfg.pushToTalkKey }
    for (const [id, value] of Object.entries(values)) $<HTMLInputElement | HTMLTextAreaElement>(id).value = String(value)
    for (const [id, checked] of Object.entries({ startup: cfg.startWithWindows, wanderEnabled: cfg.wanderEnabled, memoryEnabled: cfg.memoryEnabled, voiceEnabled: cfg.voiceEnabled, listenOn: cfg.listenEnabled || cfg.wakeWordEnabled, conversationMode: cfg.conversationMode })) input(id).checked = checked
    voiceEngine.value = cfg.voiceEngine
    $<HTMLSelectElement>('sttEngine').value = cfg.sttEngine
    document.querySelector<HTMLInputElement>(`input[name="listenMode"][value="${cfg.wakeWordEnabled ? 'wake' : 'button'}"]`)!.checked = true
    updateTitle(); refreshConnectionUi()
    await refreshVoice()
    loaded = true
    main.inert = false
    markDirty()
    await Promise.all([loadLists(), refreshOverview()])
  } catch (e) { feedback(`No se pudieron cargar los ajustes: ${errorText(e)}`, 'error'); button('retryLoad').hidden = false }
}
button('retryLoad').addEventListener('click', () => void init())
void init()
