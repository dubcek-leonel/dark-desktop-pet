import atlasUrl from '../../assets/character/dark/dark-atlas.png'
import dark from '../../assets/character/dark/dark.json'
import { frameAt, type SpriteSheet } from '../core/animation'

const sheet = dark as SpriteSheet
const canvas = document.getElementById('pet') as HTMLCanvasElement
const ctx = canvas.getContext('2d', { willReadFrequently: true })!

const atlas = new Image()
atlas.src = atlasUrl

let anim = 'wave'
let facing: 1 | -1 = 1
let startedAt = performance.now()

window.api.on('pet:anim', (msg: { anim: string; facing: 1 | -1; restart?: boolean }) => {
  if (msg.anim !== anim || msg.restart) startedAt = performance.now()
  anim = msg.anim
  facing = msg.facing
})

function fitCanvas(): void {
  const w = window.innerWidth
  const h = window.innerHeight
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
}

function draw(now: number): void {
  fitCanvas()
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (atlas.complete && atlas.naturalWidth > 0) {
    const f = frameAt(sheet, anim, now - startedAt)
    const fw = sheet.frameWidth
    const fh = sheet.frameHeight
    ctx.save()
    ctx.imageSmoothingQuality = 'high'
    if (facing === -1) {
      ctx.translate(canvas.width, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(atlas, f.col * fw, f.row * fh, fw, fh, 0, 0, canvas.width, canvas.height)
    ctx.restore()
  }
  requestAnimationFrame(draw)
}
requestAnimationFrame(draw)

// ---- Interacción con el mouse ----

let over = false
function isOpaque(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return false
  return ctx.getImageData(x, y, 1, 1).data[3] > 30
}
function setOver(hit: boolean): void {
  if (hit !== over) {
    over = hit
    window.api.send('pet:hit', hit)
  }
}

let down: { x: number; y: number } | null = null
let dragging = false
const DRAG_THRESHOLD = 4

window.addEventListener('mousemove', (e) => {
  if (down && !dragging) {
    if (Math.hypot(e.screenX - down.x, e.screenY - down.y) > DRAG_THRESHOLD) {
      dragging = true
      window.api.send('pet:dragStart', { offsetX: e.offsetX, offsetY: e.offsetY })
    }
  }
  if (!dragging) setOver(isOpaque(e.offsetX, e.offsetY))
})

window.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !isOpaque(e.offsetX, e.offsetY)) return
  down = { x: e.screenX, y: e.screenY }
})

window.addEventListener('mouseup', (e) => {
  if (e.button !== 0) return
  if (dragging) window.api.send('pet:dragEnd')
  else if (down) {
    // Espera un poco: si llega un doble clic, no se cuenta como clic simple.
    if (clickTimer) clearTimeout(clickTimer)
    clickTimer = setTimeout(() => {
      clickTimer = null
      window.api.send('pet:click')
    }, 260)
  }
  down = null
  dragging = false
})

let clickTimer: ReturnType<typeof setTimeout> | null = null
window.addEventListener('dblclick', (e) => {
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
  }
  if (isOpaque(e.offsetX, e.offsetY)) window.api.send('pet:dblclick')
})

window.addEventListener('mouseleave', () => {
  if (!dragging) setOver(false)
})

window.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  window.api.send('pet:contextmenu')
})
