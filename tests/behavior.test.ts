import { describe, expect, it } from 'vitest'
import {
  clampX,
  createPet,
  groundY,
  handle,
  hangY,
  step,
  type Env,
  type Pet
} from '../src/core/behavior'

const DUR: Record<string, number> = {
  wave: 660,
  click: 400,
  surprised: 420,
  land: 300,
  wake_up: 720,
  sit_down: 560,
  yawn: 880
}

function makeEnv(over: Partial<Env> = {}, rolls: number[] = []): Env {
  let i = 0
  return {
    bounds: { x: 0, y: 0, width: 1920, height: 1040 },
    scale: 1,
    rand: () => (i < rolls.length ? rolls[i++] : 0.99),
    durationOf: (a) => DUR[a] ?? 0,
    sleepAfterMs: 60_000,
    ...over
  }
}

/** Avanza la simulación en pasos de 33 ms. */
function run(p: Pet, ms: number, env: Env): Pet {
  let s = p
  for (let t = 0; t < ms; t += 33) s = step(s, 33, env)
  return s
}

describe('posiciones', () => {
  it('el suelo deja los pies (y=244 del frame) sobre el borde inferior del área de trabajo', () => {
    const env = makeEnv()
    expect(groundY(env)).toBe(1040 - 244)
    expect(groundY(makeEnv({ scale: 0.5 }))).toBe(1040 - 122)
  })
  it('colgado, las manos (y=12) quedan en el borde superior', () => {
    expect(hangY(makeEnv({ bounds: { x: 0, y: 30, width: 800, height: 600 } }))).toBe(18)
  })
  it('clampX mantiene el cuerpo visible', () => {
    const env = makeEnv()
    expect(clampX(-500, env)).toBe(-50)
    expect(clampX(5000, env)).toBe(1920 - 206)
  })
})

describe('inicio', () => {
  it('empieza saludando en el suelo y luego pasa a idle', () => {
    const env = makeEnv()
    let p = createPet(env, 500)
    expect(p.state).toBe('wave')
    expect(p.anim).toBe('wave')
    expect(p.y).toBe(groundY(env))
    p = run(p, 700, env)
    expect(p.state).toBe('idle')
  })
})

describe('paseo', () => {
  it('desde idle puede caminar hacia un punto y mira en esa dirección', () => {
    // rolls: espera de idle, elección (walk), destino
    const env = makeEnv({}, [0, 0.1, 0.0])
    let p: Pet = { ...createPet(env, 1000), state: 'idle', anim: 'idle', t: 0, wait: 0 }
    p = step(p, 33, env)
    expect(p.state).toBe('walk')
    expect(p.facing).toBe(-1)
    const x0 = p.x
    p = run(p, 1000, env)
    expect(p.x).toBeLessThan(x0)
  })

  it('al llegar al destino vuelve a idle y nunca sale de los límites', () => {
    const env = makeEnv({}, [0, 0.1, 0.0])
    let p: Pet = { ...createPet(env, 100), state: 'idle', anim: 'idle', t: 0, wait: 0 }
    p = run(p, 10_000, env)
    expect(p.x).toBeGreaterThanOrEqual(-50)
    expect(p.state).not.toBe('walk')
  })
})

describe('arrastrar y soltar', () => {
  it('drag mueve a Dark; al soltarlo en medio cae, aterriza y vuelve a idle', () => {
    const env = makeEnv()
    let p = run(createPet(env, 500), 700, env)
    p = handle(p, { type: 'dragStart' }, env)
    expect(p.anim).toBe('drag')
    p = handle(p, { type: 'dragMove', x: 800, y: 300 }, env)
    expect(p.x).toBe(800)
    expect(p.y).toBe(300)
    p = handle(p, { type: 'dragEnd' }, env)
    expect(p.state).toBe('fall')
    p = run(p, 2000, env)
    expect(p.y).toBe(groundY(env))
    expect(['land', 'idle', 'walk', 'sit_down', 'dance']).toContain(p.state)
    p = run(p, 400, env)
    expect(p.state).not.toBe('land')
  })

  it('soltarlo pegado al borde superior lo deja colgado, y después de un rato cae', () => {
    const env = makeEnv({}, [0])
    let p = handle(createPet(env, 500), { type: 'dragStart' }, env)
    p = handle(p, { type: 'dragMove', x: 600, y: 5 }, env)
    p = handle(p, { type: 'dragEnd' }, env)
    expect(p.state).toBe('hang')
    expect(p.y).toBe(hangY(env))
    p = run(p, 9_000, env)
    expect(['fall', 'land', 'idle']).toContain(p.state)
  })

  it('un clic mientras cuelga lo hace caer', () => {
    const env = makeEnv()
    let p = handle(createPet(env, 500), { type: 'dragStart' }, env)
    p = handle(p, { type: 'dragMove', x: 600, y: 0 }, env)
    p = handle(p, { type: 'dragEnd' }, env)
    p = handle(p, { type: 'click' }, env)
    expect(p.state).toBe('fall')
  })
})

describe('clics', () => {
  it('un clic → click; tres clics seguidos → surprised', () => {
    const env = makeEnv()
    let p = run(createPet(env, 500), 700, env)
    p = handle(p, { type: 'click' }, env)
    expect(p.state).toBe('click')
    p = step(p, 100, env)
    p = handle(p, { type: 'click' }, env)
    p = step(p, 100, env)
    p = handle(p, { type: 'click' }, env)
    expect(p.state).toBe('surprised')
    p = run(p, 500, env)
    expect(p.state).toBe('idle')
  })
})

describe('sueño', () => {
  it('sin actividad bosteza y se duerme; un clic lo despierta', () => {
    const env = makeEnv({ sleepAfterMs: 5_000 })
    let p = run(createPet(env, 500), 5_200, env)
    expect(['yawn', 'sleep']).toContain(p.state)
    p = run(p, 1_000, env)
    expect(p.state).toBe('sleep')
    p = run(p, 30_000, env)
    expect(p.state).toBe('sleep')
    p = handle(p, { type: 'click' }, env)
    expect(p.state).toBe('wake_up')
    p = run(p, 800, env)
    expect(p.state).toBe('idle')
  })
})

describe('IA', () => {
  it('piensa, habla y termina con la emoción de la respuesta', () => {
    const env = makeEnv()
    let p = run(createPet(env, 500), 700, env)
    p = handle(p, { type: 'aiThinking' }, env)
    expect(p.state).toBe('think')
    p = run(p, 20_000, env)
    expect(p.state).toBe('think')
    p = handle(p, { type: 'aiTalking' }, env)
    expect(p.state).toBe('talk')
    p = handle(p, { type: 'aiDone', emotion: 'angry' }, env)
    expect(p.state).toBe('emote')
    expect(p.anim).toBe('angry')
    p = run(p, 3_000, env)
    expect(p.state).toBe('idle')
  })

  it('emoción neutral vuelve directo a idle', () => {
    const env = makeEnv()
    let p = handle(run(createPet(env, 500), 700, env), { type: 'aiThinking' }, env)
    p = handle(p, { type: 'aiDone', emotion: 'neutral' }, env)
    expect(p.state).toBe('idle')
  })

  it('si está cayendo cuando la IA empieza, piensa al aterrizar', () => {
    const env = makeEnv()
    let p = handle(createPet(env, 500), { type: 'dragStart' }, env)
    p = handle(p, { type: 'dragMove', x: 500, y: 200 }, env)
    p = handle(p, { type: 'dragEnd' }, env)
    p = handle(p, { type: 'aiThinking' }, env)
    expect(p.state).toBe('fall')
    p = run(p, 3_000, env)
    expect(p.state).toBe('think')
  })
})

describe('cambio de pantalla', () => {
  it('si el área de trabajo cambia, Dark se reacomoda al suelo y dentro de los límites', () => {
    const env = makeEnv()
    let p = run(createPet(env, 1700), 700, env)
    const small = makeEnv({ bounds: { x: 0, y: 0, width: 1280, height: 680 } })
    p = step(p, 33, small)
    expect(p.y).toBe(groundY(small))
    expect(p.x).toBeLessThanOrEqual(1280 - 206)
  })
})
