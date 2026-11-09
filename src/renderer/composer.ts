import './theme.css'
import './composer.css'
import type { ChatUpdate } from '../main/chat'
const form = document.getElementById('form') as HTMLFormElement
const input = document.getElementById('input') as HTMLInputElement
const mic = document.getElementById('mic') as HTMLButtonElement
const send = document.getElementById('send') as HTMLButtonElement
let busy = false
let listening = false
function update(msg: ChatUpdate): void {
  if (msg.state === 'notice') return
  busy = msg.state === 'thinking' || msg.state === 'talking' || msg.state === 'speaking' || msg.state === 'transcribing'
  listening = msg.state === 'listening' || msg.state === 'transcribing'
  send.disabled = busy
  mic.disabled = busy && !listening
  mic.dataset.listening = String(listening)
  mic.setAttribute('aria-label', listening ? 'Dejar de escuchar' : 'Hablar por voz')
  mic.title = listening ? 'Dejar de escuchar' : 'Hablar por voz'
}
window.api.on('chat:update', update)
window.api.on('chat:focus', () => input.focus())
form.addEventListener('submit', (e) => {
  e.preventDefault()
  const text = input.value.trim()
  if (!text || busy) return
  busy = true
  send.disabled = true
  mic.disabled = true
  input.value = ''
  window.api.send('chat:send', text)
})
mic.addEventListener('click', () => window.api.send('chat:mic'))
document.getElementById('close')!.addEventListener('click', () => window.api.send('chat:close'))
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.api.send('chat:close') })
