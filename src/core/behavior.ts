/**
 * Cerebro de Dark: una máquina de estados pura (sin Electron) que decide
 * qué animación mostrar y dónde está la ventana.
 * Coordenadas: (x, y) es la esquina superior izquierda de la ventana en la pantalla.
 */

export type Emotion = 'happy' | 'sad' | 'angry' | 'surprised' | 'neutral'

export type State =
  | 'wave'
  | 'idle'
  | 'walk'
  | 'sit_down'
  | 'sit'
  | 'yawn'
  | 'sleep'
  | 'wake_up'
  | 'click'
  | 'surprised'
  | 'drag'
  | 'fall'
  | 'land'
  | 'hang'
  | 'think'
  | 'talk'
  | 'emote'
  | 'dance'
  | 'listen'
  | 'work'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface Env {
  /** Área de trabajo del monitor donde está Dark (sin la barra de tareas). */
  bounds: Bounds
  /** Escala del sprite: la ventana mide 256 × scale. */
  scale: number
  rand: () => number
  /** Duración de una pasada de la animación (para las que no se repiten). */
  durationOf: (anim: string) => number
  /** Tiempo sin interacción antes de dormirse. */
  sleepAfterMs: number
}

export interface Pet {
  state: State
  anim: string
  x: number
  y: number
  vy: number
  facing: 1 | -1
  /** ms en el estado actual */
  t: number
  /** ms que debe durar el estado actual (idle, sit, hang, dance, emote) */
  wait: number
  targetX: number | null
  /** ms desde la última interacción del usuario */
  idleFor: number
  clicks: number[]
  clock: number
  ai: 'idle' | 'thinking' | 'talking'
  /** Pomodoro en foco: Dark trabaja en vez de pasear o dormir. */
  working: boolean
}

export type PetEvent =
  | { type: 'work'; on: boolean }
  | { type: 'alert' }
  | { type: 'sleep' }
  | { type: 'click' }
  | { type: 'dragStart' }
  | { type: 'dragMove'; x: number; y: number }
  | { type: 'dragEnd' }
  | { type: 'aiThinking' }
  | { type: 'aiTalking' }
  | { type: 'aiDone'; emotion: Emotion }
  | { type: 'dance' }

// Medidas del sprite (en píxeles del frame de 256).
const FEET_Y = 244
const HANDS_Y = 12
const BODY_LEFT = 50
const BODY_RIGHT = 206

const WALK_SPEED = 70 // px/s a escala 1
const GRAVITY = 2400 // px/s²
const MULTI_CLICK_WINDOW = 2000
const EMOTE_MS = 2500

/** Estados que terminan solos cuando acaba su animación, y a dónde van. */
const ONE_SHOT: Partial<Record<State, State>> = {
  wave: 'idle',
  click: 'idle',
  surprised: 'idle',
  land: 'idle',
  wake_up: 'idle',
  sit_down: 'sit',
  yawn: 'sleep'
}

const AIRBORNE: ReadonlySet<State> = new Set(['drag', 'fall', 'hang'])

export function groundY(env: Env): number {
  return env.bounds.y + env.bounds.height - FEET_Y * env.scale
}

export function hangY(env: Env): number {
  return env.bounds.y - HANDS_Y * env.scale
}

export function clampX(x: number, env: Env): number {
  const min = env.bounds.x - BODY_LEFT * env.scale
  const max = env.bounds.x + env.bounds.width - BODY_RIGHT * env.scale
  return Math.min(max, Math.max(min, x))
}

function enter(p: Pet, state: State, extra: Partial<Pet> = {}): Pet {
  return { ...p, state, anim: state, t: 0, wait: 0, targetX: null, ...extra }
}

function randomBetween(env: Env, a: number, b: number): number {
  return a + env.rand() * (b - a)
}

/** Vuelve a reposo; si la IA está trabajando, va directo a pensar o hablar. */
function toIdle(p: Pet, env: Env): Pet {
  if (p.ai === 'thinking') return enter(p, 'think')
  if (p.ai === 'talking') return enter(p, 'talk')
  if (p.working) return enter(p, 'work')
  return enter(p, 'idle', { wait: randomBetween(env, 3000, 8000) })
}

export function createPet(env: Env, x: number): Pet {
  return {
    state: 'wave',
    anim: 'wave',
    x: clampX(x, env),
    y: groundY(env),
    vy: 0,
    facing: 1,
    t: 0,
    wait: 0,
    targetX: null,
    idleFor: 0,
    clicks: [],
    clock: 0,
    ai: 'idle',
    working: false
  }
}

function chooseNext(p: Pet, env: Env): Pet {
  const r = env.rand()
  if (r < 0.45) {
    const min = clampX(-Infinity, env)
    const max = clampX(Infinity, env)
    const targetX = min + env.rand() * (max - min)
    return enter(p, 'walk', { targetX, facing: targetX < p.x ? -1 : 1 })
  }
  if (r < 0.65) return enter(p, 'sit_down')
  if (r < 0.75) return enter(p, 'dance', { wait: randomBetween(env, 4000, 8000) })
  return toIdle(p, env)
}

export function step(prev: Pet, dtMs: number, env: Env): Pet {
  let p: Pet = { ...prev, t: prev.t + dtMs, clock: prev.clock + dtMs }
  if (p.state !== 'drag') p.idleFor += dtMs

  // En el suelo: siempre pegado al suelo y dentro de la pantalla (por si cambió el monitor).
  if (!AIRBORNE.has(p.state)) {
    p.y = groundY(env)
    p.x = clampX(p.x, env)
  }

  const next = ONE_SHOT[p.state]
  if (next) {
    if (p.t >= env.durationOf(p.anim)) return next === 'idle' ? toIdle(p, env) : enter(p, next)
    return p
  }

  const sleepy = p.idleFor >= env.sleepAfterMs && p.ai === 'idle'

  switch (p.state) {
    case 'idle':
      if (sleepy) return enter(p, 'yawn')
      if (p.t >= p.wait) return chooseNext(p, env)
      return p

    case 'walk': {
      const target = clampX(p.targetX ?? p.x, env)
      const move = WALK_SPEED * env.scale * (dtMs / 1000)
      const dist = target - p.x
      if (Math.abs(dist) <= move) return toIdle({ ...p, x: target }, env)
      return { ...p, x: p.x + Math.sign(dist) * move, facing: dist < 0 ? -1 : 1 }
    }

    case 'sit':
      if (p.wait === 0) p.wait = randomBetween(env, 10_000, 30_000)
      if (sleepy) return enter(p, 'yawn')
      if (p.t >= p.wait) return toIdle(p, env)
      return p

    case 'dance':
      if (p.t >= p.wait) return toIdle(p, env)
      return p

    case 'emote':
      if (p.t >= p.wait) return toIdle(p, env)
      return p

    case 'hang':
      if (p.t >= p.wait) return enter(p, 'fall', { vy: 0 })
      return p

    case 'fall': {
      const vy = p.vy + GRAVITY * env.scale * (dtMs / 1000)
      const y = p.y + vy * (dtMs / 1000)
      const ground = groundY(env)
      const x = clampX(p.x, env)
      if (y >= ground) return enter({ ...p, x, y: ground, vy: 0 }, 'land')
      return { ...p, x, y, vy }
    }

    default:
      // sleep, drag, think, talk, listen, work: esperan un evento.
      return p
  }
}

export function handle(p: Pet, ev: PetEvent, env: Env): Pet {
  switch (ev.type) {
    case 'click': {
      const q = { ...p, idleFor: 0 }
      if (q.state === 'sleep' || q.state === 'yawn') return enter(q, 'wake_up')
      if (q.state === 'hang') return enter(q, 'fall', { vy: 0 })
      if (q.state === 'drag' || q.state === 'fall' || q.state === 'think' || q.state === 'talk') return q
      const clicks = [...q.clicks.filter((c) => q.clock - c < MULTI_CLICK_WINDOW), q.clock]
      if (clicks.length >= 3) return enter({ ...q, clicks: [] }, 'surprised')
      return enter({ ...q, clicks }, 'click')
    }

    case 'dragStart':
      return enter({ ...p, idleFor: 0, vy: 0 }, 'drag')

    case 'dragMove':
      if (p.state !== 'drag') return p
      return { ...p, x: ev.x, y: ev.y }

    case 'dragEnd': {
      if (p.state !== 'drag') return p
      if (p.y <= env.bounds.y + 30 * env.scale) {
        return enter({ ...p, x: clampX(p.x, env), y: hangY(env) }, 'hang', {
          wait: randomBetween(env, 8000, 20_000)
        })
      }
      const ground = groundY(env)
      if (p.y >= ground) return enter({ ...p, x: clampX(p.x, env), y: ground }, 'land')
      return enter(p, 'fall', { vy: 0 })
    }

    case 'aiThinking': {
      const q: Pet = { ...p, ai: 'thinking', idleFor: 0 }
      return AIRBORNE.has(q.state) ? q : enter(q, 'think')
    }

    case 'aiTalking': {
      const q: Pet = { ...p, ai: 'talking' }
      return AIRBORNE.has(q.state) ? q : enter(q, 'talk')
    }

    case 'aiDone': {
      const q: Pet = { ...p, ai: 'idle', idleFor: 0 }
      if (q.state !== 'think' && q.state !== 'talk') return q
      if (ev.emotion === 'neutral') return toIdle(q, env)
      const wait = ev.emotion === 'surprised' ? env.durationOf('surprised') : EMOTE_MS
      return enter(q, 'emote', { anim: ev.emotion, wait })
    }

    case 'dance':
      if (AIRBORNE.has(p.state)) return p
      return enter(p, 'dance', { wait: randomBetween(env, 4000, 8000) })

    case 'alert': {
      // Llama la atención (recordatorio): saluda; si dormía, se despierta primero.
      const q: Pet = { ...p, idleFor: 0 }
      if (q.state === 'sleep' || q.state === 'yawn') return enter(q, 'wake_up')
      if (AIRBORNE.has(q.state) || q.ai !== 'idle') return q
      return enter(q, 'wave')
    }

    case 'sleep':
      // Se duerme por orden (bosteza primero).
      if (AIRBORNE.has(p.state) || p.ai !== 'idle' || p.state === 'sleep') return p
      return enter({ ...p, working: false }, 'yawn')

    case 'work': {
      const q: Pet = { ...p, working: ev.on, idleFor: 0 }
      if (ev.on) {
        if (AIRBORNE.has(q.state) || q.ai !== 'idle') return q
        return enter(q, 'work')
      }
      return q.state === 'work' ? toIdle(q, env) : q
    }
  }
}
