import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'

/**
 * Piper abierto en segundo plano: el modelo se carga una sola vez y cada frase
 * tarda ~150 ms. Recibe JSON por stdin y responde con la ruta del WAV generado.
 */
export class PiperTTS {
  private proc: ChildProcessWithoutNullStreams | null = null
  private key = ''
  private buf = ''
  private waiters: Array<{ resolve: (path: string) => void; reject: (e: Error) => void }> = []

  constructor(private outDir: string) {}

  private ensure(exe: string, model: string, lengthScale: number): ChildProcessWithoutNullStreams {
    const key = `${exe}|${model}|${lengthScale}`
    if (this.proc && this.key === key && this.proc.exitCode === null) return this.proc
    this.stop()
    const p = spawn(
      exe,
      ['--model', model, '--output_dir', this.outDir, '--json-input', '--length_scale', String(lengthScale)],
      { windowsHide: true }
    )
    p.stdout.setEncoding('utf8')
    p.stdout.on('data', (d: string) => {
      this.buf += d
      let i: number
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim()
        this.buf = this.buf.slice(i + 1)
        if (line) this.waiters.shift()?.resolve(line)
      }
    })
    p.stderr.on('data', () => {}) // Piper escribe su registro aquí
    const fail = (e: Error): void => {
      for (const w of this.waiters.splice(0)) w.reject(e)
      if (this.proc === p) this.proc = null
    }
    p.on('error', fail)
    p.on('exit', () => fail(new Error('Piper se cerró')))
    this.proc = p
    this.key = key
    return p
  }

  /** Genera el audio de una frase y devuelve los bytes del WAV. */
  async synth(text: string, exe: string, model: string, lengthScale: number): Promise<Uint8Array> {
    const p = this.ensure(exe, model, lengthScale)
    const path = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Piper tardó demasiado')), 20_000)
      this.waiters.push({
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        }
      })
      p.stdin.write(JSON.stringify({ text }) + '\n')
    })
    const bytes = await readFile(path)
    void rm(path, { force: true })
    return new Uint8Array(bytes)
  }

  stop(): void {
    if (this.proc) {
      this.proc.removeAllListeners('exit')
      this.proc.kill()
    }
    this.proc = null
    this.key = ''
    for (const w of this.waiters.splice(0)) w.reject(new Error('Piper detenido'))
  }
}
