export type ProviderId = 'gemini' | 'openai' | 'ollama'

export interface Config {
  provider: ProviderId
  model: string
  baseUrl: string
  name: string
  personality: string
  /** Tamaño de Dark: 256 px × scale */
  scale: number
  sleepAfterMinutes: number
  startWithWindows: boolean
  memoryEnabled: boolean
  pomodoroFocusMin: number
  pomodoroBreakMin: number
  /** Dark responde en voz alta (Piper). */
  voiceEnabled: boolean
  voiceId: string
  voiceSpeed: number
  voicePitch: number
  /** Botón de micrófono y atajo de teclado para hablarle (whisper.cpp). */
  listenEnabled: boolean
  /** Escucha siempre y se activa al oír su nombre. */
  wakeWordEnabled: boolean
  whisperModel: 'tiny' | 'base' | 'small'
  pushToTalkKey: string
  /** Motor de voz: Piper (local, instantáneo) o Gemini (natural, usa internet). */
  voiceEngine: 'piper' | 'gemini'
  geminiVoice: string
  /** Quién transcribe: automático (Whisper local si está, si no Gemini), o uno fijo. */
  sttEngine: 'auto' | 'whisper' | 'gemini'
  /** Después de responder por voz, sigue escuchando unos segundos para continuar la charla. */
  conversationMode: boolean
}

export const GEMINI_VOICES: Array<{ id: string; label: string }> = [
  { id: 'Puck', label: 'Puck — animado (natural)' },
  { id: 'Fenrir', label: 'Fenrir — intenso (natural)' },
  { id: 'Charon', label: 'Charon — grave y tranquilo (natural)' },
  { id: 'Orus', label: 'Orus — firme (natural)' },
  { id: 'Zephyr', label: 'Zephyr — brillante (natural)' },
  { id: 'Kore', label: 'Kore — femenina, segura (natural)' },
  { id: 'Leda', label: 'Leda — femenina, juvenil (natural)' }
]

export const PROVIDER_PRESETS: Record<ProviderId, { label: string; baseUrl: string; model: string; needsKey: boolean }> = {
  gemini: {
    label: 'Google AI Studio (Gemini)',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.5-flash-lite',
    needsKey: true
  },
  openai: {
    label: 'Compatible con OpenAI (OpenAI, Groq…)',
    baseUrl: 'https://api.openai.com/v1',
    model: '',
    needsKey: true
  },
  ollama: {
    label: 'Ollama (local, sin internet)',
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3:4b',
    needsKey: false
  }
}

export const DEFAULT_CONFIG: Config = {
  provider: 'gemini',
  model: PROVIDER_PRESETS.gemini.model,
  baseUrl: PROVIDER_PRESETS.gemini.baseUrl,
  name: 'Dark',
  personality: 'sarcástico y algo flojo',
  scale: 1,
  sleepAfterMinutes: 5,
  startWithWindows: false,
  memoryEnabled: true,
  pomodoroFocusMin: 25,
  pomodoroBreakMin: 5,
  voiceEnabled: false,
  voiceId: 'es_MX-ald-medium',
  voiceSpeed: 1,
  voicePitch: 1,
  listenEnabled: false,
  wakeWordEnabled: false,
  whisperModel: 'base',
  pushToTalkKey: 'Ctrl+Alt+D',
  voiceEngine: 'piper',
  geminiVoice: 'Puck',
  sttEngine: 'auto',
  conversationMode: true
}

function str(v: unknown, fallback: string, max = 2000): string {
  if (typeof v !== 'string') return fallback
  const s = v.trim().slice(0, max)
  return s || fallback
}

function num(v: unknown, fallback: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback
  return Math.min(max, Math.max(min, v))
}

/** Valida lo que venga del archivo o de la ventana de ajustes. Solo copia campos conocidos. */
export function normalizeConfig(raw: unknown): Config {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const provider: ProviderId =
    r.provider === 'gemini' || r.provider === 'openai' || r.provider === 'ollama' ? r.provider : DEFAULT_CONFIG.provider
  const preset = PROVIDER_PRESETS[provider]
  return {
    provider,
    model: str(r.model, preset.model, 200),
    baseUrl: str(r.baseUrl, preset.baseUrl, 500),
    name: str(r.name, DEFAULT_CONFIG.name, 40),
    personality: str(r.personality, DEFAULT_CONFIG.personality, 1000),
    scale: num(r.scale, DEFAULT_CONFIG.scale, 0.5, 2),
    sleepAfterMinutes: num(r.sleepAfterMinutes, DEFAULT_CONFIG.sleepAfterMinutes, 1, 120),
    startWithWindows: r.startWithWindows === true,
    memoryEnabled: r.memoryEnabled !== false,
    pomodoroFocusMin: Math.round(num(r.pomodoroFocusMin, DEFAULT_CONFIG.pomodoroFocusMin, 5, 90)),
    pomodoroBreakMin: Math.round(num(r.pomodoroBreakMin, DEFAULT_CONFIG.pomodoroBreakMin, 1, 30)),
    voiceEnabled: r.voiceEnabled === true,
    voiceId: typeof r.voiceId === 'string' && /^[a-z]{2}_[A-Z]{2}-[\w]+-[\w]+$/.test(r.voiceId) ? r.voiceId : DEFAULT_CONFIG.voiceId,
    voiceSpeed: num(r.voiceSpeed, DEFAULT_CONFIG.voiceSpeed, 0.6, 1.6),
    voicePitch: num(r.voicePitch, DEFAULT_CONFIG.voicePitch, 0.75, 1.4),
    listenEnabled: r.listenEnabled === true,
    wakeWordEnabled: r.wakeWordEnabled === true,
    whisperModel: r.whisperModel === 'tiny' || r.whisperModel === 'small' ? r.whisperModel : 'base',
    pushToTalkKey: str(r.pushToTalkKey, DEFAULT_CONFIG.pushToTalkKey, 40),
    voiceEngine: r.voiceEngine === 'gemini' ? 'gemini' : 'piper',
    geminiVoice: GEMINI_VOICES.some((v) => v.id === r.geminiVoice) ? (r.geminiVoice as string) : DEFAULT_CONFIG.geminiVoice,
    sttEngine: r.sttEngine === 'whisper' || r.sttEngine === 'gemini' ? r.sttEngine : 'auto',
    conversationMode: r.conversationMode !== false
  }
}
