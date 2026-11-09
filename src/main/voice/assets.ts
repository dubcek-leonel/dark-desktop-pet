import { execFile } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app } from 'electron'
import { PIPER_ZIP, VOICES, WHISPER_MODELS, WHISPER_ZIP, type WhisperModel } from '../../core/voice/catalog'

export type Progress = (label: string, pct: number) => void

const root = (): string => join(app.getPath('userData'), 'voice')
const dirs = {
  piper: () => join(root(), 'piper'),
  voices: () => join(root(), 'voices'),
  whisper: () => join(root(), 'whisper'),
  models: () => join(root(), 'models'),
  out: () => join(root(), 'out')
}

/** Busca un archivo por nombre dentro de una carpeta (los zips traen subcarpetas). */
function findFile(dir: string, name: string, depth = 3): string | null {
  if (!existsSync(dir) || depth < 0) return null
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (e.toLowerCase() === name.toLowerCase()) return p
    if (statSync(p).isDirectory()) {
      const r = findFile(p, name, depth - 1)
      if (r) return r
    }
  }
  return null
}

export const paths = {
  piperExe: () => findFile(dirs.piper(), 'piper.exe'),
  voiceModel: (id: string) => {
    const p = join(dirs.voices(), `${id}.onnx`)
    return existsSync(p) && existsSync(`${p}.json`) ? p : null
  },
  whisperServer: () => findFile(dirs.whisper(), 'whisper-server.exe'),
  whisperModel: (id: WhisperModel['id']) => {
    const p = join(dirs.models(), `ggml-${id}.bin`)
    return existsSync(p) ? p : null
  },
  outDir: () => {
    mkdirSync(dirs.out(), { recursive: true })
    return dirs.out()
  }
}

export function status(): {
  piper: boolean
  whisper: boolean
  voices: Record<string, boolean>
  models: Record<string, boolean>
} {
  return {
    piper: !!paths.piperExe(),
    whisper: !!paths.whisperServer(),
    voices: Object.fromEntries(VOICES.map((v) => [v.id, !!paths.voiceModel(v.id)])),
    models: Object.fromEntries(WHISPER_MODELS.map((m) => [m.id, !!paths.whisperModel(m.id)]))
  }
}

/** Descarga a un archivo .part y lo renombra al terminar (así nunca queda un archivo a medias). */
async function download(url: string, dest: string, label: string, onProgress: Progress): Promise<void> {
  mkdirSync(join(dest, '..'), { recursive: true })
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`No se pudo descargar ${label} (HTTP ${res.status})`)
  const total = Number(res.headers.get('content-length')) || 0
  let got = 0
  let lastPct = -1
  const body = Readable.fromWeb(res.body as never)
  body.on('data', (chunk: Buffer) => {
    got += chunk.length
    const pct = total ? Math.floor((got / total) * 100) : 0
    if (pct !== lastPct) {
      lastPct = pct
      onProgress(label, pct)
    }
  })
  const part = `${dest}.part`
  await pipeline(body, createWriteStream(part))
  renameSync(part, dest)
}

/** Descomprime un .zip con el tar de Windows. */
function unzip(zip: string, dir: string): Promise<void> {
  mkdirSync(dir, { recursive: true })
  const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  return new Promise((resolve, reject) =>
    execFile(tar, ['-xf', zip, '-C', dir], (err) => (err ? reject(err) : resolve()))
  )
}

let busy = false

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  if (busy) throw new Error('Ya hay una descarga en curso')
  busy = true
  try {
    return await fn()
  } finally {
    busy = false
  }
}

/** Instala Piper y una voz. */
export function installVoice(voiceId: string, onProgress: Progress): Promise<void> {
  return guarded(async () => {
    const v = VOICES.find((x) => x.id === voiceId)
    if (!v) throw new Error('Voz desconocida')
    if (!paths.piperExe()) {
      const zip = join(root(), 'piper.zip')
      await download(PIPER_ZIP.url, zip, 'Motor de voz (Piper)', onProgress)
      await unzip(zip, dirs.piper())
      rmSync(zip, { force: true })
    }
    if (!paths.voiceModel(v.id)) {
      const base = join(dirs.voices(), `${v.id}.onnx`)
      await download(v.json, `${base}.json`, 'Configuración de la voz', onProgress)
      await download(v.onnx, base, `Voz ${v.label}`, onProgress)
    }
    onProgress('Listo', 100)
  })
}

/** Instala whisper.cpp y un modelo. */
export function installWhisper(model: WhisperModel['id'], onProgress: Progress): Promise<void> {
  return guarded(async () => {
    const m = WHISPER_MODELS.find((x) => x.id === model)
    if (!m) throw new Error('Modelo desconocido')
    if (!paths.whisperServer()) {
      const zip = join(root(), 'whisper.zip')
      await download(WHISPER_ZIP.url, zip, 'Reconocimiento de voz (whisper.cpp)', onProgress)
      await unzip(zip, dirs.whisper())
      rmSync(zip, { force: true })
    }
    if (!paths.whisperModel(m.id)) {
      await download(m.url, join(dirs.models(), `ggml-${m.id}.bin`), `Modelo ${m.id}`, onProgress)
    }
    onProgress('Listo', 100)
  })
}
