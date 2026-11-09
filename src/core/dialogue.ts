/** Small, readable speech pages. Never split a Unicode code point. */
export function dialoguePages(text: string, limit = 280): string[] {
  const chars = Array.from(text.trim())
  const pages: string[] = []
  const size = Math.max(40, Math.floor(limit))
  while (chars.length > size) {
    const chunk = chars.slice(0, size).join('')
    const sentences = Array.from(chunk.matchAll(/[.!?…]\s+/g))
    const last = sentences.at(-1)
    const boundary = last ? last.index! + last[0].length : chunk.lastIndexOf(' ')
    const count = boundary >= chunk.length * 0.4 ? Array.from(chunk.slice(0, boundary)).length : size
    pages.push(chars.splice(0, count).join('').trim())
    while (chars[0] && /\s/.test(chars[0])) chars.shift()
  }
  if (chars.length) pages.push(chars.join(''))
  return pages.length ? pages : ['']
}
