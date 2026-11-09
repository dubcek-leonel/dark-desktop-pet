import './theme.css'
import './bubble.css'
import { dialoguePages } from '../core/dialogue'
import type { ChatUpdate, BubbleButton } from '../main/chat'
const $ = (id: string): HTMLElement => document.getElementById(id)!
const answer = $('answer')
const question = $('question')
const history = $('history')
const stop = $('stop') as HTMLButtonElement
const retry = $('retry') as HTMLButtonElement
let busy = false
let completed = false
let revision = 0
let hovered = false
let pages: string[] = []
let page = 0
let closeTimer: ReturnType<typeof setTimeout> | null = null
const labels: Record<ChatUpdate['state'], string> = { thinking: 'Pensando…', talking: 'Respondiendo…', speaking: 'Hablando…', done: 'Aquí contigo', error: 'Necesito tu atención', notice: 'Aquí contigo', caption: 'Aquí contigo', listening: 'Te escucho…', transcribing: 'Entendiendo tu voz…', reset: 'Nueva conversación', ready: 'Aquí contigo' }
function cancelAutoClose(): void { if (closeTimer) clearTimeout(closeTimer); closeTimer = null }
function scheduleAutoClose(): void {
  cancelAutoClose()
  closeTimer = setTimeout(() => {
    if (hovered || $('alerts').childElementCount || ($('recent') as HTMLDetailsElement).open) return scheduleAutoClose()
    window.api.send('chat:dismiss')
  }, 25_000)
}
function archive(q: string, text: string): void {
  const row = Object.assign(document.createElement('div'), { className: 'turn' })
  row.append(Object.assign(document.createElement('small'), { textContent: q }), Object.assign(document.createElement('div'), { textContent: text }))
  history.append(row)
  while (history.childElementCount > 10) history.firstElementChild!.remove()
  history.scrollTop = history.scrollHeight
}
let fullAnswer = ''
function showPage(): void {
  answer.textContent = pages[page] ?? ''
  $('pager').hidden = pages.length <= 1
  $('pageNumber').textContent = `${page + 1} / ${pages.length}`
  $('nextPage').textContent = page + 1 < pages.length ? 'Siguiente' : 'Cerrar respuesta'
  answer.title = pages.length > 1 ? 'Haz clic para seguir leyendo' : 'Haz clic para cerrar esta respuesta'
}
function showAnswer(text: string, paginate = false): void {
  fullAnswer = text
  pages = paginate ? dialoguePages(text) : [text]
  page = 0
  showPage()
}
function nextPage(): void {
  if (busy) return
  if (page + 1 < pages.length) { page++; showPage(); scheduleAutoClose() }
  else window.api.send('chat:dismiss')
}
function setNotes(notes: string[] = []): void {
  $('notes').replaceChildren(...notes.map((text) => Object.assign(document.createElement('span'), { textContent: text, className: text.startsWith('⚠') ? 'note warn' : 'note' })))
}
function appendNotice(text: string, buttons: BubbleButton[] = []): void {
  const row = document.createElement('div')
  row.append(Object.assign(document.createElement('span'), { textContent: text }))
  const actions = [...buttons]
  if (!actions.some((a) => a.id === 'dismiss')) actions.push({ id: 'dismiss', label: 'Cerrar aviso' })
  for (const action of actions) {
    const button = Object.assign(document.createElement('button'), { textContent: action.label })
    button.addEventListener('click', () => { row.remove(); if (action.id !== 'dismiss') window.api.send('chat:action', action.id) })
    row.append(button)
  }
  $('alerts').append(row)
}
function update(msg: ChatUpdate): void {
  revision++
  cancelAutoClose()
  if (msg.state !== 'notice') {
    busy = ['thinking', 'talking', 'speaking', 'transcribing'].includes(msg.state)
    stop.hidden = !busy || msg.state === 'transcribing'
    if (busy) retry.hidden = true
    $('chatStatus').textContent = labels[msg.state]
  }
  switch (msg.state) {
    case 'thinking':
      if (completed) archive(question.textContent ?? '', fullAnswer)
      completed = false
      $('emptyHint').hidden = true
      answer.classList.remove('error')
      question.textContent = `Tú: ${msg.question}`
      setNotes()
      showAnswer('…')
      break
    case 'talking':
      answer.classList.remove('error')
      showAnswer(msg.text)
      break
    case 'speaking':
      answer.classList.remove('error')
      showAnswer(msg.text, true)
      setNotes(msg.notes)
      break
    case 'done':
      completed = true
      $('emptyHint').hidden = true
      answer.classList.remove('error')
      showAnswer(msg.text, true)
      setNotes(msg.notes)
      scheduleAutoClose()
      break
    case 'caption':
      if (completed) archive(question.textContent ?? '', fullAnswer)
      completed = false
      question.textContent = ''
      $('emptyHint').hidden = true
      answer.classList.remove('error')
      setNotes()
      showAnswer(msg.text, true)
      scheduleAutoClose()
      break
    case 'notice':
      appendNotice(msg.text, msg.buttons)
      break
    case 'reset':
      history.replaceChildren()
      completed = false
      question.textContent = ''
      showAnswer('')
      setNotes()
      retry.hidden = true
      $('emptyHint').hidden = false
      break
    case 'listening':
      if (completed) archive(question.textContent ?? '', fullAnswer)
      completed = false
      $('emptyHint').hidden = true
      question.textContent = ''
      answer.classList.remove('error')
      showAnswer('Te escucho…')
      answer.insertAdjacentHTML('beforeend', '<div class="meter"><div id="meterBar"></div></div>')
      setNotes()
      break
    case 'transcribing':
      showAnswer('Un momento, estoy entendiendo lo que dijiste…')
      break
    case 'ready':
      answer.classList.remove('error')
      showAnswer('Escucha detenida. Puedes escribir o volver a pulsar el micrófono.')
      break
    case 'error':
      $('emptyHint').hidden = true
      answer.classList.add('error')
      showAnswer(msg.text)
      setNotes()
      retry.hidden = !msg.retryable
      if (!msg.retryable) scheduleAutoClose()
      break
  }
}
window.api.on('chat:update', update)
window.api.on('chat:level', (level: number) => { const bar = document.getElementById('meterBar'); if (bar) bar.style.width = `${Math.round(Math.max(0, Math.min(1, level)) * 100)}%` })
answer.addEventListener('click', nextPage)
$('nextPage').addEventListener('click', nextPage)
$('close').addEventListener('click', () => window.api.send('chat:dismiss'))
stop.addEventListener('click', () => window.api.send('chat:cancel'))
retry.addEventListener('click', () => { retry.hidden = true; window.api.send('chat:retry') })
$('openSettings').addEventListener('click', () => window.api.send('settings:open'))
$('newChat').addEventListener('click', () => { if ((!completed && !busy && !history.childElementCount) || confirm('¿Limpiar la conversación actual? Los recuerdos guardados se conservan.')) window.api.send('chat:reset') })
$('wrap').addEventListener('mouseenter', () => { hovered = true })
$('wrap').addEventListener('mouseleave', () => { hovered = false })
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.api.send('chat:dismiss') })
new ResizeObserver(() => window.api.send('chat:resize', $('wrap').offsetHeight + 24)).observe($('wrap'))
async function restore(): Promise<void> {
  const before = revision
  try {
    const snapshot = await window.api.invoke<{ history: Array<{ role: string; content: string }>; current: ChatUpdate | null; question: string }>('chat:snapshot')
    if (revision === before) {
      const messages = snapshot.history.slice()
      if (snapshot.current?.state === 'done' || snapshot.current?.state === 'speaking') messages.splice(-2)
      for (let i = 0; i < messages.length; i++) if (messages[i].role === 'user' && messages[i + 1]?.role === 'assistant') archive(`Tú: ${messages[i].content}`, messages[++i].content)
      question.textContent = snapshot.question ? `Tú: ${snapshot.question}` : ''
      if (snapshot.current) update(snapshot.current)
    }
    const state = await window.api.invoke<{ config: { name: string } }>('config:get')
    $('companionName').textContent = state.config.name
  } catch { /* Receiving live updates remains available when the snapshot is unavailable. */ }
}
void restore()
