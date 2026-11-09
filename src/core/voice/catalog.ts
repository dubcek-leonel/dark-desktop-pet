export interface VoiceInfo {
  id: string
  label: string
  onnx: string
  json: string
  sizeMB: number
}

const HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/es'

function piper(locale: string, name: string, quality: string, label: string, sizeMB: number): VoiceInfo {
  const id = `${locale}-${name}-${quality}`
  const base = `${HF}/${locale}/${name}/${quality}/${id}`
  return { id, label, onnx: `${base}.onnx`, json: `${base}.onnx.json`, sizeMB }
}

/** Voces de Piper en español (todas gratis y sin internet una vez descargadas). */
export const VOICES: VoiceInfo[] = [
  piper('es_MX', 'ald', 'medium', 'Ald — hombre, México', 60),
  piper('es_ES', 'davefx', 'medium', 'Davefx — hombre, España', 60),
  piper('es_ES', 'carlfm', 'x_low', 'Carlfm — hombre, España (ligera)', 27),
  piper('es_ES', 'sharvard', 'medium', 'Sharvard — España', 73),
  piper('es_MX', 'claude', 'high', 'Claude — mujer, México', 60),
  piper('es_AR', 'daniela', 'high', 'Daniela — mujer, Argentina', 109)
]

export const DEFAULT_VOICE = 'es_MX-ald-medium'

export interface WhisperModel {
  id: 'tiny' | 'base' | 'small'
  label: string
  url: string
  sizeMB: number
}

const WHF = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'
export const WHISPER_MODELS: WhisperModel[] = [
  { id: 'tiny', label: 'Tiny — muy rápido, se equivoca más', url: `${WHF}/ggml-tiny.bin`, sizeMB: 74 },
  { id: 'base', label: 'Base — equilibrado (recomendado)', url: `${WHF}/ggml-base.bin`, sizeMB: 141 },
  { id: 'small', label: 'Small — más preciso, más lento', url: `${WHF}/ggml-small.bin`, sizeMB: 465 }
]

export const PIPER_ZIP = {
  url: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip',
  sizeMB: 21
}
export const WHISPER_ZIP = {
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip',
  sizeMB: 9
}

/**
 * Tono y velocidad: el tono se logra reproduciendo el audio más rápido o lento
 * (playbackRate), y Piper genera el audio más largo o corto para compensar la duración.
 */
export function speechParams(speed: number, pitch: number): { lengthScale: number; playbackRate: number } {
  return { lengthScale: Math.round((pitch / speed) * 1000) / 1000, playbackRate: pitch }
}

/** Divide un texto en frases para empezar a hablar sin esperar al final. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}
