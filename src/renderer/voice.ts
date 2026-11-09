/**
 * Ventana oculta de audio: usa el micrófono (solo cuando hace falta), detecta
 * cuándo hablas, manda la frase en WAV de 16 kHz y reproduce la voz de Dark.
 */
import { Vad } from '../core/voice/vad'
import { encodeWav, resample } from '../core/voice/wav'

type Mode = { wake: boolean; command: boolean; muted: boolean; commandTimeoutMs?: number }

let mode: Mode = { wake: false, command: false, muted: false }
let ctx: AudioContext | null = null
let stream: MediaStream | null = null
let node: ScriptProcessorNode | null = null

const PRE_ROLL_MS = 400
let lastLevelAt = 0
let vad = new Vad()
let chunks: Float32Array[] = []
let preRoll: Float32Array[] = []
let capturing = false
let commandTimer: ReturnType<typeof setTimeout> | null = null

function newVad(): Vad {
  return mode.command ? new Vad({ silenceMs: 900, maxMs: 15_000 }) : new Vad({ silenceMs: 600, maxMs: 8000 })
}

async function startMic(): Promise<void> {
  if (stream) return
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
    })
  } catch (e) {
    window.api.send('voice:error', e instanceof Error ? e.message : String(e))
    return
  }
  ctx = ctx ?? new AudioContext()
  const src = ctx.createMediaStreamSource(stream)
  node = ctx.createScriptProcessor(2048, 1, 1)
  node.onaudioprocess = (ev) => onAudio(ev.inputBuffer.getChannelData(0), ctx!.sampleRate)
  src.connect(node)
  node.connect(ctx.destination) // necesario para que el procesador corra (la salida queda en silencio)
}

function stopMic(): void {
  node?.disconnect()
  node = null
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  capturing = false
  chunks = []
  preRoll = []
}

function onAudio(input: Float32Array, rate: number): void {
  if (mode.muted || (!mode.wake && !mode.command)) return
  const data = new Float32Array(input)
  let sum = 0
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
  const rms = Math.sqrt(sum / data.length)
  const dt = (data.length / rate) * 1000

  // Medidor de volumen para la burbuja (unas 12 veces por segundo).
  const now = performance.now()
  if (mode.command && now - lastLevelAt > 80) {
    lastLevelAt = now
    window.api.send('voice:level', Math.min(1, rms * 14))
  }

  // Guarda un poco de audio previo para no cortar el inicio de la frase.
  preRoll.push(data)
  while (preRoll.length * dt > PRE_ROLL_MS) preRoll.shift()

  const ev = vad.push(rms, dt)
  if (ev === 'start') {
    capturing = true
    chunks = [...preRoll]
    if (commandTimer) clearTimeout(commandTimer)
  } else if (capturing) {
    chunks.push(data)
  }
  if (ev === 'cancel') {
    capturing = false
    chunks = []
  }
  if (ev === 'end') {
    capturing = false
    const total = chunks.reduce((n, c) => n + c.length, 0)
    const all = new Float32Array(total)
    let off = 0
    for (const c of chunks) {
      all.set(c, off)
      off += c.length
    }
    chunks = []
    const wav = encodeWav(resample(all, rate, 16000), 16000)
    window.api.send('voice:utterance', { mode: mode.command ? 'command' : 'wake', wav })
    if (mode.command) {
      mode = { ...mode, command: false }
      vad = newVad()
    }
  }
}

window.api.on('voice:mode', async (m: Mode) => {
  const wasCommand = mode.command
  const changed = m.command !== mode.command || m.wake !== mode.wake
  mode = m
  if (changed || m.muted) {
    vad = newVad()
    capturing = false
    chunks = []
  }
  if (commandTimer) clearTimeout(commandTimer)
  if (m.command && !wasCommand) {
    commandTimer = setTimeout(() => {
      if (mode.command && !capturing) window.api.send('voice:timeout')
    }, m.commandTimeoutMs ?? 9000)
  }
  if (m.wake || m.command) await startMic()
  else stopMic()
})

// ---------- Reproducción ----------

let current: AudioBufferSourceNode | null = null

window.api.on('voice:play', async (msg: { id: number; wav: Uint8Array; rate: number }) => {
  ctx = ctx ?? new AudioContext()
  if (ctx.state === 'suspended') await ctx.resume()
  try {
    const copy = msg.wav.slice().buffer
    const buf = await ctx.decodeAudioData(copy)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.playbackRate.value = msg.rate
    src.connect(ctx.destination)
    current = src
    src.onended = () => {
      if (current === src) current = null
      window.api.send('voice:played', msg.id)
    }
    src.start()
  } catch {
    window.api.send('voice:played', msg.id)
  }
})

window.api.on('voice:stopPlayback', () => {
  try {
    current?.stop()
  } catch {
    /* ya terminó */
  }
})

export {}
