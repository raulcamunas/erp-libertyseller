import { mencionaFacturacion } from '../ia-ejemplos'

/**
 * COMPROBAR UN SEGUIMIENTO — PURO Y PEQUEÑO.
 * ==========================================
 * Las reglas con las que se da por bueno el texto de un seguimiento. Viven aparte de seguimientos.ts (el encargo a la IA, con sus prompts) para que el
 * cuadro de Correo pueda aplicarlas en el navegador, mientras la persona edita, sin llevarse los prompts en el paquete. El servidor las vuelve a aplicar
 * siempre (inscripcion.ts y la propia IA): esto es solo para avisar antes.
 */

const palabrasDe = (texto: string): number => texto.trim().split(/\s+/).filter(Boolean).length

export type ProblemaDeSeguimiento = 'dinero' | 'hueco' | 'largo' | 'corto' | 'repite'

export const PALABRAS_MAXIMAS_DE_SEGUIMIENTO = 130
export const PALABRAS_MINIMAS_DE_SEGUIMIENTO = 12
/** Parecido (0 a 1) a partir del cual un seguimiento se da por una repetición de otro correo */
export const PARECIDO_MAXIMO = 0.6

const palabrasSignificativas = (texto: string): Set<string> =>
  new Set(
    texto
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9ñ]+/)
      .filter((p) => p.length >= 4)
  )

/** Qué parte de las palabras (de 4 o más letras) se comparte entre dos textos: 1 = el mismo, 0 = nada en común */
export function parecido(a: string, b: string): number {
  const A = palabrasSignificativas(a)
  const B = palabrasSignificativas(b)
  if (A.size === 0 || B.size === 0) return 0
  let comunes = 0
  for (const p of A) if (B.has(p)) comunes++
  return comunes / (A.size + B.size - comunes)
}

/**
 * Qué le pasa a un seguimiento que no puede salir tal cual.
 *   · dinero: habla de facturación, ventas o una cifra de dinero (la regla que no admite excepciones)
 *   · hueco:  deja algo por rellenar entre corchetes, llaves o ángulos
 *   · largo / corto: un seguimiento tiene que leerse en diez segundos
 *   · repite: es casi el mismo texto que un correo anterior de la secuencia (`anteriores`)
 */
export function revisarSeguimiento(texto: string, anteriores: readonly string[] = []): ProblemaDeSeguimiento[] {
  const problemas: ProblemaDeSeguimiento[] = []
  if (mencionaFacturacion(texto)) problemas.push('dinero')
  if (/\{\{|\[[^\]\n]{1,60}\]|<[\p{L} ]{2,30}>/u.test(texto)) problemas.push('hueco')
  const palabras = palabrasDe(texto)
  if (palabras > PALABRAS_MAXIMAS_DE_SEGUIMIENTO) problemas.push('largo')
  if (palabras < PALABRAS_MINIMAS_DE_SEGUIMIENTO) problemas.push('corto')
  if (anteriores.some((a) => parecido(texto, a) >= PARECIDO_MAXIMO)) problemas.push('repite')
  return problemas
}

/** Revisa todos los seguimientos de una secuencia: cada uno contra el primer correo y los seguimientos que lo preceden */
export function revisarSeguimientos(textos: readonly string[], primerCorreo: string): ProblemaDeSeguimiento[][] {
  return textos.map((t, i) => revisarSeguimiento(t, [primerCorreo, ...textos.slice(0, i)]))
}
