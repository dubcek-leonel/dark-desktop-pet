import type { ChatMessage } from './ai/types'

const MAX_LEN = 200

/** Lee la lista de recuerdos que devuelve la IA (un arreglo JSON de textos). */
export function parseMemoryList(raw: string): string[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : raw
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  try {
    const arr = JSON.parse(body.slice(start, end + 1)) as unknown
    if (!Array.isArray(arr)) return []
    return arr.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
  } catch {
    return []
  }
}

const key = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[.!¡?¿\s]+$/u, '')

/** Junta recuerdos nuevos con los viejos, sin duplicados; si sobran, se van los más viejos. */
export function mergeMemories(existing: string[], incoming: string[], max = 60): string[] {
  const out = [...existing]
  const seen = new Set(existing.map(key))
  for (const raw of incoming) {
    const s = raw.trim().slice(0, MAX_LEN)
    if (!s || seen.has(key(s))) continue
    seen.add(key(s))
    out.push(s)
  }
  return out.slice(-max)
}

/** Pide a la IA que extraiga datos duraderos sobre el usuario de una conversación. */
export function buildExtractionMessages(conversation: ChatMessage[], known: string[]): ChatMessage[] {
  const convo = conversation
    .filter((m) => m.role !== 'system')
    .map((m) => `${m.role === 'user' ? 'Usuario' : 'Mascota'}: ${m.content}`)
    .join('\n')
  return [
    {
      role: 'system',
      content: [
        'Extraes datos duraderos sobre el USUARIO a partir de una conversación con su mascota de escritorio.',
        'Solo hechos útiles a futuro: nombre, gustos, estudios, trabajo, proyectos, personas importantes, metas, preferencias de cómo quiere que le hablen.',
        'No incluyas cosas pasajeras (lo que pidió hace un momento, saludos, el clima), ni datos de la mascota, ni contraseñas o datos sensibles.',
        'Cada dato es una frase corta en español, en tercera persona (por ejemplo: "Se llama Leo").',
        'No repitas lo que ya se sabe.',
        'Responde SOLO con un arreglo JSON de textos. Si no hay nada nuevo, responde [].'
      ].join('\n')
    },
    {
      role: 'user',
      content: `Lo que ya se sabe:\n${known.length ? known.map((k) => `- ${k}`).join('\n') : '(nada)'}\n\nConversación:\n${convo}`
    }
  ]
}
