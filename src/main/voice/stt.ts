import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { cpus } from 'node:os'

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      s.close(() => resolve(port))
    })
  })
}

/** Quita marcas que Whisper agrega cuando no hay voz: [BLANK_AUDIO], (música), *risas*… */
export function cleanTranscript(t: string): string {
  return t
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** whisper-server en segundo plano, con el modelo cargado; se le mandan WAV por HTTP. */
export class WhisperServer {
  private proc: ChildProcess | null = null
  private port = 0
  private key = ''
  private ready: Promise<void> | null = null

  async start(exe: string, model: string, name: string): Promise<void> {
    const key = `${exe}|${model}|${name}`
    if (this.proc && this.key === key && this.proc.exitCode === null && this.ready) return this.ready
    this.stop()
    this.port = await freePort()
    const threads = Math.max(2, Math.min(8, Math.floor(cpus().length / 2)))
    const p = spawn(
      exe,
      [
        '-m', model,
        '-l', 'es',
        '--host', '127.0.0.1',
        '--port', String(this.port),
        '-t', String(threads),
        // Le da contexto para que reconozca el nombre de la mascota.
        '--prompt', `${name}, ¿qué hora es? ${name}, recuérdame algo.`
      ],
      { windowsHide: true, stdio: 'ignore' }
    )
    p.on('exit', () => {
      if (this.proc === p) {
        this.proc = null
        this.ready = null
      }
    })
    this.proc = p
    this.key = key
    this.ready = this.waitReady()
    return this.ready
  }

  private async waitReady(): Promise<void> {
    const until = Date.now() + 30_000
    while (Date.now() < until) {
      if (!this.proc) throw new Error('whisper-server no arrancó')
      try {
        const r = await fetch(`http://127.0.0.1:${this.port}/`)
        if (r.ok) return
      } catch {
        /* todavía cargando */
      }
      await new Promise((r) => setTimeout(r, 300))
    }
    throw new Error('whisper-server tardó demasiado en arrancar')
  }

  isRunning(): boolean {
    return !!this.proc && this.proc.exitCode === null
  }

  async transcribe(wav: Uint8Array): Promise<string> {
    if (!this.ready) throw new Error('El reconocimiento de voz no está activo')
    await this.ready
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav')
    form.append('response_format', 'json')
    form.append('language', 'es')
    form.append('temperature', '0')
    const r = await fetch(`http://127.0.0.1:${this.port}/inference`, { method: 'POST', body: form })
    if (!r.ok) throw new Error(`whisper-server respondió ${r.status}`)
    const j = (await r.json()) as { text?: string }
    return cleanTranscript(j.text ?? '')
  }

  stop(): void {
    this.proc?.kill()
    this.proc = null
    this.ready = null
    this.key = ''
  }
}
