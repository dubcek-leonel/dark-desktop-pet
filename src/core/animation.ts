export interface AnimDef {
  frames: number
  durationMs: number
  loop: boolean
  row: number
}

export interface SpriteSheet {
  frameWidth: number
  frameHeight: number
  animations: Record<string, AnimDef>
}

export interface FrameInfo {
  row: number
  col: number
  finished: boolean
}

function def(sheet: SpriteSheet, name: string): AnimDef {
  return sheet.animations[name] ?? sheet.animations['idle']
}

/** Frame que toca mostrar de `name` cuando han pasado `elapsedMs` desde que empezó. */
export function frameAt(sheet: SpriteSheet, name: string, elapsedMs: number): FrameInfo {
  const a = def(sheet, name)
  const t = Math.max(0, elapsedMs)
  const step = Math.floor(t / a.durationMs)
  if (a.loop) return { row: a.row, col: step % a.frames, finished: false }
  return { row: a.row, col: Math.min(step, a.frames - 1), finished: step >= a.frames }
}

/** Duración total de una pasada de la animación. */
export function animDurationMs(sheet: SpriteSheet, name: string): number {
  const a = def(sheet, name)
  return a.frames * a.durationMs
}
