export interface PersonaInput {
  name: string
  personality: string
  memories?: string[]
  /** Fecha y hora actual, para que pueda calcular recordatorios. */
  now?: Date
}

function formatNow(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const dia = d.toLocaleDateString('es', { weekday: 'long' })
  return `${dia} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function buildSystemPrompt({ name, personality, memories = [], now }: PersonaInput): string {
  const lines = [
    `Eres ${name}, una mascota que vive en el escritorio de la computadora del usuario.`,
    `Tu personalidad: ${personality}.`,
    'Hablas en español, de forma natural y breve: tus respuestas aparecen en una burbuja de diálogo pequeña, así que usa como máximo 2 o 3 frases, salvo que el usuario pida algo largo.',
    'No uses Markdown, listas ni emojis en exceso.',
    'Aunque seas sarcástico o flojo, al final sí ayudas con lo que te piden.',
    '',
    'RECORDATORIOS: si el usuario te pide que le recuerdes algo, confírmalo y agrega una etiqueta así:',
    '[recordar:CUÁNDO|QUÉ]  donde CUÁNDO es "+20m" o "+2h" (desde ahora), "HH:MM" (hoy, o mañana si ya pasó) o "AAAA-MM-DD HH:MM".',
    'Ejemplo: "Bueno, te aviso. [recordar:+20m|tomar agua]". Solo usa la etiqueta cuando te pidan un recordatorio.',
    '',
    'Al final de CADA respuesta agrega exactamente una etiqueta con tu emoción: [emo:happy], [emo:sad], [emo:angry], [emo:surprised] o [emo:neutral].'
  ]
  if (now) lines.push('', `Fecha y hora actual: ${formatNow(now)}.`)
  if (memories.length > 0) {
    lines.push('', 'Cosas que recuerdas del usuario (úsalas con naturalidad, sin recitarlas):')
    for (const m of memories) lines.push(`- ${m}`)
  }
  return lines.join('\n')
}
