import { huellaDeContenido, textoPlano, type Bloque } from './bloques'

/**
 * EL HISTORIAL DEL CUERPO DE UNA TAREA — PURO.
 *
 * Antes de que un cambio pise el cuerpo (lo que escribe alguien aquí, lo que llega de Notion o una restauración) se guarda una copia de cómo estaba. Hay una copia por «tramo
 * de edición»: mientras alguien escribe, el editor guarda cada segundo y eso no son cien versiones, sino una que dice «así estaba al empezar». Se conservan las últimas
 * `MAX_VERSIONES` de cada tarea.
 */

export const MAX_VERSIONES = 40
/** Entre una copia y la siguiente de la misma tarea tienen que pasar al menos estos minutos (salvo al restaurar, que siempre guarda) */
export const MINUTOS_ENTRE_VERSIONES = 10

export type OrigenDeVersion = 'erp' | 'notion' | 'restaurar'

export interface ResumenDeVersion {
  bloques: number
  palabras: number
  /** Las primeras letras, para reconocerla en la lista */
  extracto: string
}

export function resumirVersion(bloques: readonly Bloque[]): ResumenDeVersion {
  const texto = textoPlano(bloques).replace(/\s+/g, ' ').trim()
  return { bloques: bloques.length, palabras: texto ? texto.split(' ').length : 0, extracto: texto.slice(0, 140) }
}

/**
 * ¿Hay que guardar copia ahora? No si el cuerpo estaba vacío (no hay nada que perder), ni si es igual a la última copia, ni si la última es de hace menos de
 * `MINUTOS_ENTRE_VERSIONES` (salvo `forzar`).
 */
export function tocaGuardarVersion(anterior: readonly Bloque[], ultima: { huella: string; creadaEn: string } | null, ahora: Date, forzar = false): boolean {
  if (anterior.length === 0 || textoPlano(anterior).trim() === '' && !anterior.some((b) => b.tipo === 'imagen' || b.tipo === 'tabla')) return false
  const huella = huellaDeContenido(anterior)
  if (ultima && ultima.huella === huella) return false
  if (forzar || !ultima) return true
  return ahora.getTime() - new Date(ultima.creadaEn).getTime() >= MINUTOS_ENTRE_VERSIONES * 60_000
}

/**
 * El cuerpo de una versión vieja, listo para ponerlo como el actual SIN romper la sincronización con Notion. Un bloque lleva el identificador del de Notion al que
 * corresponde; si ese bloque ya no está en el cuerpo de ahora (alguien lo borró) mandar un cambio a ese identificador fallaría, así que:
 *   · a un bloque editable se le quita el identificador (queda como nuevo y se crea otra vez en Notion);
 *   · una tabla pierde también los de sus filas;
 *   · uno que solo Notion sabe pintar (`notion`) y ya no existe se omite: aquí no hay con qué recrearlo;
 *   · una imagen que ya no existe y no tiene dirección nuestra se omite.
 */
export function cuerpoParaRestaurar(version: readonly Bloque[], actual: readonly Bloque[]): Bloque[] {
  const vivos = new Set(actual.map((b) => b.notion_id).filter((x): x is string => Boolean(x)))
  const filasVivas = new Set(actual.flatMap((b) => b.filaIds ?? []).filter((x): x is string => Boolean(x)))
  const salida: Bloque[] = []
  for (const b of version) {
    const existe = !b.notion_id || vivos.has(b.notion_id)
    if (b.tipo === 'notion') {
      if (existe) salida.push(b)
      continue
    }
    if (b.tipo === 'imagen' && !existe && !b.url) continue
    const copia: Bloque = existe ? { ...b } : { ...b, notion_id: undefined }
    if (!existe) delete copia.notion_id
    if (copia.filaIds) copia.filaIds = copia.filaIds.map((f) => (f && filasVivas.has(f) && existe ? f : null))
    salida.push(copia)
  }
  return salida
}
