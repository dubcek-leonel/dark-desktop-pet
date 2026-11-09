const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length][b.length]
}

const FILLER = '(?:oye|hey|ey|hola|ok|okay|eh)'
const PATTERN = new RegExp(
  `^[\\s"'«“¡¿]*(?:${FILLER}[\\s,!.]+)?([\\p{L}]+)[\\s,.!:;?]*(.*)$`,
  'isu'
)

/**
 * ¿La frase empieza llamando a la mascota por su nombre? ("Dark, …", "Oye Dark …").
 * Tolera pequeños errores de transcripción (Darc, Dar).
 */
export function detectWake(text: string, name: string): { woke: boolean; rest: string } {
  const m = text.trim().match(PATTERN)
  if (!m) return { woke: false, rest: '' }
  const word = norm(m[1])
  const target = norm(name.trim().split(/\s+/)[0] ?? '')
  if (!target) return { woke: false, rest: '' }
  const maxDist = target.length >= 4 ? 1 : 0
  const close = word === target || (word.length >= 3 && distance(word, target) <= maxDist)
  return close ? { woke: true, rest: m[2].trim() } : { woke: false, rest: '' }
}
