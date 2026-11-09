interface BubbleButton {
  id: string
  label: string
}
type Notice = { state: 'notice'; text: string; buttons?: BubbleButton[] }
type ChatUpdate =
  | { state: 'thinking'; question: string }
  | { state: 'talking'; text: string }
  | { state: 'done'; text: string; notes?: string[] }
  | { state: 'error'; text: string }
  | Notice

const wrap = document.getElementById('wrap')!
const question = document.getElementById('question')!
const answer = document.getElementById('answer')!
const notes = document.getElementById('notes')!
const buttons = document.getElementById('buttons')!
const form = document.getElementById('form') as HTMLFormElement
const input = document.getElementById('input') as HTMLInputElement
const send = document.getElementById('send') as HTMLButtonElement
const closeBtn = document.getElementById('close')!

const AUTO_CLOSE_MS = 25_000
const AUTO_CLOSE_WITH_BUTTONS_MS = 90_000
let busy = false
let closeTimer: ReturnType<typeof setTimeout> | null = null
let queuedNotice: Notice | null = null

function cancelAutoClose(): void {
  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = null
}

function scheduleAutoClose(ms = AUTO_CLOSE_MS): void {
  cancelAutoClose()
  closeTimer = setTimeout(() => {
    if (document.activeElement === input || input.value.trim()) return scheduleAutoClose(ms)
    window.api.send('chat:close')
  }, ms)
}

function setBusy(b: boolean): void {
  busy = b
  send.disabled = b
}

function showDots(): void {
  answer.classList.remove('error')
  answer.innerHTML = '<span class="dots"><span>.</span><span>.</span><span>.</span></span>'
}

function setNotes(list: string[] = []): void {
  notes.replaceChildren(
    ...list.map((t) => {
      const el = document.createElement('span')
      el.className = t.startsWith('⚠') ? 'note warn' : 'note'
      el.textContent = t
      return el
    })
  )
}

function setButtons(list: BubbleButton[] = []): void {
  buttons.replaceChildren(
    ...list.map((b) => {
      const el = document.createElement('button')
      el.type = 'button'
      el.textContent = b.label
      el.addEventListener('click', () => {
        setButtons([])
        window.api.send('chat:action', b.id)
      })
      return el
    })
  )
}

function showNotice(msg: Notice): void {
  question.textContent = ''
  answer.classList.remove('error')
  answer.textContent = msg.text
  setNotes([])
  setButtons(msg.buttons)
  scheduleAutoClose(msg.buttons?.length ? AUTO_CLOSE_WITH_BUTTONS_MS : AUTO_CLOSE_MS)
}

/** Si llegó un aviso mientras respondía, se muestra unos segundos después. */
function flushQueuedNotice(): void {
  if (!queuedNotice) return
  const n = queuedNotice
  queuedNotice = null
  setTimeout(() => (busy ? (queuedNotice = n) : showNotice(n)), 4000)
}

window.api.on('chat:update', (msg: ChatUpdate) => {
  cancelAutoClose()
  switch (msg.state) {
    case 'thinking':
      setBusy(true)
      question.textContent = `Tú: ${msg.question}`
      setNotes([])
      setButtons([])
      showDots()
      break
    case 'talking':
      answer.classList.remove('error')
      answer.textContent = msg.text
      answer.scrollTop = answer.scrollHeight
      break
    case 'done':
      setBusy(false)
      answer.classList.remove('error')
      answer.textContent = msg.text
      setNotes(msg.notes)
      scheduleAutoClose()
      flushQueuedNotice()
      break
    case 'notice':
      // Aviso de Dark (recordatorio, Pomodoro…): no es respuesta a una pregunta.
      if (busy) queuedNotice = msg
      else showNotice(msg)
      break
    case 'error':
      setBusy(false)
      answer.classList.add('error')
      answer.textContent = msg.text
      setNotes([])
      scheduleAutoClose()
      flushQueuedNotice()
      break
  }
})

window.api.on('chat:focus', () => {
  cancelAutoClose()
  input.focus()
})

form.addEventListener('submit', (e) => {
  e.preventDefault()
  const text = input.value.trim()
  if (!text || busy) return
  input.value = ''
  window.api.send('chat:send', text)
})

closeBtn.addEventListener('click', () => window.api.send('chat:close'))
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.send('chat:close')
})
input.addEventListener('input', cancelAutoClose)

// La ventana se adapta al alto del contenido.
new ResizeObserver(() => {
  window.api.send('chat:resize', wrap.offsetHeight + 24)
}).observe(wrap)

export {}
