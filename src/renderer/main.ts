const canvas = document.getElementById('pet') as HTMLCanvasElement
const ctx = canvas.getContext('2d', { willReadFrequently: true })!
ctx.fillStyle = '#7a3cff'
ctx.fillRect(64, 64, 128, 128)

// ¿El mouse está sobre un píxel visible de Dark?
let over = false
function isOpaque(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return false
  return ctx.getImageData(x, y, 1, 1).data[3] > 30
}
window.addEventListener('mousemove', (e) => {
  const hit = isOpaque(e.offsetX, e.offsetY)
  if (hit !== over) {
    over = hit
    window.api.send('pet:hit', hit)
  }
})
window.addEventListener('mouseleave', () => {
  if (over) {
    over = false
    window.api.send('pet:hit', false)
  }
})
window.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  window.api.send('pet:contextmenu')
})
