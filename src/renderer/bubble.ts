type ChatUpdate =
  | { state: 'thinking'; question: string }
  | { state: 'talking'; text: string }
  | { state: 'done'; text: string }
  | { state: 'error'; text: string }
  | { state: 'notice'; text: string }

const wrap = document.getElementById('wrap')!
const question = document.getElementById('question')!
const answer = document.getElementById('answer')!
const form = document.getElementById('form') as HTMLFormElement
const input = document.getElementById('input') as HTMLInputElement
const send = document.getElementById('send') as HTMLButtonElement
const closeBtn = document.getElementById('close')!

const AUTO_CLOSE_MS = 25_000
let busy = false
let closeTimer: ReturnType<typeof setTimeout> | null = null

function cancelAutoClose(): void {
  if (closeTimer) clearTimeout(closeTimer)
  closeTimer = null
}

function scheduleAutoClose(): void {
  cancelAutoClose()
  closeTimer = setTimeout(() => {
    if (document.activeElement === input || input.value.trim()) return scheduleAutoClose()
    window.api.send('chat:close')
  }, AUTO_CLOSE_MS)
}

function setBusy(b: boolean): void {
  busy = b
  send.disabled = b
}

function showDots(): void {
  answer.classList.remove('error')
  answer.innerHTML = '<span class="dots"><span>.</span><span>.</span><span>.</span></span>'
}

window.api.on('chat:update', (msg: ChatUpdate) => {
  cancelAutoClose()
  switch (msg.state) {
    case 'thinking':
      setBusy(true)
      question.textContent = `Tú: ${msg.question}`
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
      scheduleAutoClose()
      break
    case 'notice':
      // Aviso de Dark (recordatorio, Pomodoro…): no es respuesta a una pregunta.
      if (busy) break
      question.textContent = ''
      answer.classList.remove('error')
      answer.textContent = msg.text
      scheduleAutoClose()
      break
    case 'error':
      setBusy(false)
      answer.classList.add('error')
      answer.textContent = msg.text
      scheduleAutoClose()
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
