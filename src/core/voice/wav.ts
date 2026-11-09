/** Convierte muestras float (-1..1) en un archivo WAV PCM de 16 bits, mono. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataLen = samples.length * 2
  const buf = new ArrayBuffer(44 + dataLen)
  const v = new DataView(buf)
  const str = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + dataLen, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true) // tamaño del bloque fmt
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * 2, true) // bytes por segundo
  v.setUint16(32, 2, true) // bytes por muestra
  v.setUint16(34, 16, true) // bits
  str(36, 'data')
  v.setUint32(40, dataLen, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Uint8Array(buf)
}

/** Cambia la frecuencia de muestreo con interpolación lineal (Whisper usa 16 kHz). */
export function resample(src: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return src
  const ratio = from / to
  const out = new Float32Array(Math.floor(src.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio
    const i0 = Math.floor(pos)
    const i1 = Math.min(src.length - 1, i0 + 1)
    const f = pos - i0
    out[i] = src[i0] * (1 - f) + src[i1] * f
  }
  return out
}
