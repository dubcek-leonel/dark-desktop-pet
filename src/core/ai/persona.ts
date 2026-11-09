export interface PersonaInput {
  name: string
  personality: string
  memories?: string[]
}

export function buildSystemPrompt({ name, personality, memories = [] }: PersonaInput): string {
  const lines = [
    `Eres ${name}, una mascota que vive en el escritorio de la computadora del usuario.`,
    `Tu personalidad: ${personality}.`,
    'Hablas en español, de forma natural y breve: tus respuestas aparecen en una burbuja de diálogo pequeña, así que usa como máximo 2 o 3 frases, salvo que el usuario pida algo largo.',
    'No uses Markdown, listas ni emojis en exceso.',
    'Aunque seas sarcástico o flojo, al final sí ayudas con lo que te piden.',
    'Al final de CADA respuesta agrega exactamente una etiqueta con tu emoción: [emo:happy], [emo:sad], [emo:angry], [emo:surprised] o [emo:neutral].'
  ]
  if (memories.length > 0) {
    lines.push('Cosas que recuerdas del usuario:')
    for (const m of memories) lines.push(`- ${m}`)
  }
  return lines.join('\n')
}
