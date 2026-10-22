/**
 * LOS HILOS: QUÉ CORREOS SON LA MISMA CONVERSACIÓN.
 * =================================================
 * PURO: no toca la base ni la red. Se comprueba con hilos.prueba.ts.
 *
 * Un correo pertenece a una conversación por, en este orden:
 *
 *   1. LAS CABECERAS. Cada correo lleva su `Message-ID`; una respuesta lleva además `In-Reply-To` (el del
 *      correo al que contesta) y `References` (la cadena entera). Dos correos son del mismo hilo si alguno
 *      cita al otro, o si comparten alguno de esos identificadores. La base lo busca en los dos sentidos
 *      (correo_buscar_hilos): la primera importación empieza por lo más reciente, así que la respuesta suele
 *      llegar antes que el correo original.
 *
 *   2. EL ASUNTO, solo si las cabeceras no dicen nada (hay clientes de correo, formularios web y aplicaciones
 *      que contestan sin ponerlas). Mismo asunto sin «Re:» ni «Fwd:» Y alguien en común Y cerca en el tiempo.
 *      Las tres cosas a la vez: el mismo asunto solo («Propuesta») lo usan cien conversaciones distintas, y
 *      mezclarlas es peor que dejarlas separadas.
 *
 * Todo identificador se guarda sin los < > y en minúsculas: hay servidores que cambian las mayúsculas.
 */

/** Prefijos de respuesta y reenvío de los clientes de correo más usados (inglés, español, francés, alemán, portugués…) */
const PREFIJOS = /^\s*(?:(?:re|rv|fw|fwd|tr|aw|wg|sv|vs|antw|enc|res)\s*(?:\[\d+\]|\(\d+\))?\s*:\s*)+/i

/** Asuntos que no dicen nada: dos correos «sin asunto» no son la misma conversación por eso */
const ASUNTOS_VACIOS = new Set(['', 'sin asunto', '(sin asunto)', 'no subject', '(no subject)'])

/** El asunto sin «Re:», «Fwd:»…, en minúsculas, sin acentos y con los espacios normalizados */
export function normalizarAsunto(asunto: unknown): string {
  if (typeof asunto !== 'string') return ''
  const sinPrefijos = asunto.normalize('NFKC').replace(PREFIJOS, '')
  return sinPrefijos
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

/** ¿Sirve este asunto para emparejar dos correos? */
export const asuntoSirveParaAgrupar = (clave: string): boolean => !ASUNTOS_VACIOS.has(clave)

/** «Re: Propuesta» para contestar a «Propuesta» (y no «Re: Re: Propuesta») */
export function asuntoDeRespuesta(asunto: string): string {
  const limpio = asunto.trim()
  if (/^\s*(?:re|rv)\s*(?:\[\d+\]|\(\d+\))?\s*:/i.test(limpio)) return limpio
  return limpio ? `Re: ${limpio}` : 'Re:'
}

/** «Fwd: Propuesta» para reenviar «Propuesta» */
export function asuntoDeReenvio(asunto: string): string {
  const limpio = asunto.trim()
  if (/^\s*(?:fw|fwd|rv)\s*(?:\[\d+\]|\(\d+\))?\s*:/i.test(limpio)) return limpio
  return limpio ? `Fwd: ${limpio}` : 'Fwd:'
}

/** Un Message-ID sin los < >, en minúsculas; null si no hay uno aprovechable */
export function normalizarMessageId(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const entre = /<([^<>\s]+)>/.exec(valor)
  const id = (entre ? entre[1] : valor.trim()).toLowerCase()
  if (!id || id.length > 500 || /[\s<>]/.test(id)) return null
  return id
}

/** La cadena de References: se queda con los 30 últimos, que son los más cercanos al mensaje */
export function referenciasDe(valor: unknown): string[] {
  const textos = Array.isArray(valor) ? valor : [valor]
  const ids: string[] = []
  for (const t of textos) {
    if (typeof t !== 'string') continue
    for (const m of t.matchAll(/<[^<>\s]+>/g)) {
      const id = normalizarMessageId(m[0])
      if (id && !ids.includes(id)) ids.push(id)
    }
  }
  return ids.slice(-30)
}

/** Los identificadores que le importan a un correo para encontrar su hilo: el suyo, aquel al que contesta y su cadena */
export function idsParaElHilo(mensaje: { messageId: string | null; enRespuestaA: string | null; referencias: string[] }): string[] {
  const ids = new Set<string>()
  if (mensaje.messageId) ids.add(mensaje.messageId)
  if (mensaje.enRespuestaA) ids.add(mensaje.enRespuestaA)
  for (const r of mensaje.referencias) ids.add(r)
  return [...ids]
}

/** Las direcciones del otro lado de un correo: remitente, destinatarios y copia, sin la del propio buzón */
export function participantesDe(direcciones: Array<string | null | undefined>, propia: string): string[] {
  const p = propia.toLowerCase()
  const salida = new Set<string>()
  for (const d of direcciones) {
    const a = d?.trim().toLowerCase()
    if (a && a !== p) salida.add(a)
  }
  return [...salida].sort()
}

/** Cuántos días de margen se da a un correo para entrar por el asunto en un hilo que ya existe */
export const VENTANA_POR_ASUNTO_DIAS = 45
const DIA_MS = 24 * 60 * 60 * 1000

export interface CandidatoDeHilo {
  id: string
  participantes: string[]
  primerMensajeAt: string | Date
  ultimoMensajeAt: string | Date
}

const ms = (f: string | Date): number => (f instanceof Date ? f.getTime() : Date.parse(f))

/**
 * De los hilos que tienen este mismo asunto, el que más encaja con un correo que no trae cabeceras de hilo:
 * alguien en común y dentro de los 45 días de actividad del hilo. Si hay varios, el más cercano en el tiempo y,
 * a igual distancia, el que comparte más gente. null si ninguno encaja.
 */
export function elegirHiloPorAsunto(
  candidatos: CandidatoDeHilo[],
  mensaje: { participantes: string[]; fecha: Date },
  ventanaDias: number = VENTANA_POR_ASUNTO_DIAS
): string | null {
  const propios = new Set(mensaje.participantes)
  if (propios.size === 0) return null
  const t = mensaje.fecha.getTime()
  if (!Number.isFinite(t)) return null

  let mejor: { id: string; distancia: number; comunes: number } | null = null
  for (const c of candidatos) {
    const comunes = c.participantes.filter((p) => propios.has(p)).length
    if (comunes === 0) continue

    const primero = ms(c.primerMensajeAt)
    const ultimo = ms(c.ultimoMensajeAt)
    if (!Number.isFinite(primero) || !Number.isFinite(ultimo)) continue
    // Dentro de la vida del hilo la distancia es cero; fuera, lo que le falta para entrar
    const distancia = t < primero ? primero - t : t > ultimo ? t - ultimo : 0
    if (distancia > ventanaDias * DIA_MS) continue

    if (!mejor || distancia < mejor.distancia || (distancia === mejor.distancia && comunes > mejor.comunes)) {
      mejor = { id: c.id, distancia, comunes }
    }
  }
  return mejor?.id ?? null
}

/**
 * De varios hilos que un correo acaba de demostrar que eran uno solo, el que se queda: el más antiguo. Los
 * demás se funden en él.
 */
export function hiloQueSeQueda<T extends { id: string; primerMensajeAt: string | Date }>(hilos: T[]): T | null {
  if (hilos.length === 0) return null
  return [...hilos].sort((a, b) => ms(a.primerMensajeAt) - ms(b.primerMensajeAt) || a.id.localeCompare(b.id))[0]
}
