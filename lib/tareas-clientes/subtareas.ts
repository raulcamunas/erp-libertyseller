/**
 * SUBTAREAS Y TAREAS QUE BLOQUEAN A OTRAS — PURO.
 *
 * Una SUBTAREA es un paso pequeño de una tarea (un título, hecho o no, quién y para cuándo). No es una tarea del tablero: vive dentro de la suya y no viaja a Notion.
 * Una tarea está BLOQUEADA mientras alguna de las tareas de las que depende (`bloqueada_por`) siga sin estar hecha. Dos tareas no pueden bloquearse entre ellas, ni en cadena.
 */

export const MAX_SUBTAREAS = 100
export const MAX_BLOQUEOS = 20

export interface SubtareaTC {
  id: string
  tarea_id: string
  titulo: string
  hecha: boolean
  responsable_id: string | null
  /** AAAA-MM-DD */
  fecha: string | null
  orden: number
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Lo que se acepta al crear o cambiar una subtarea; null = no vale. Solo trae los campos que vienen en la entrada */
export function limpiarSubtarea(entrada: Record<string, unknown>, esNueva: boolean): Partial<Pick<SubtareaTC, 'titulo' | 'hecha' | 'responsable_id' | 'fecha'>> | null {
  const sal: Partial<Pick<SubtareaTC, 'titulo' | 'hecha' | 'responsable_id' | 'fecha'>> = {}
  if ('titulo' in entrada || esNueva) {
    if (typeof entrada.titulo !== 'string') return null
    const t = entrada.titulo.replace(/\s+/g, ' ').trim()
    if (t.length < 1 || t.length > 300) return null
    sal.titulo = t
  }
  if ('hecha' in entrada) sal.hecha = entrada.hecha === true
  if ('responsable_id' in entrada) {
    if (entrada.responsable_id === null || entrada.responsable_id === '') sal.responsable_id = null
    else if (typeof entrada.responsable_id === 'string' && UUID.test(entrada.responsable_id)) sal.responsable_id = entrada.responsable_id
    else return null
  }
  if ('fecha' in entrada) {
    if (entrada.fecha === null || entrada.fecha === '') sal.fecha = null
    else if (typeof entrada.fecha === 'string' && FECHA.test(entrada.fecha) && !Number.isNaN(Date.parse(entrada.fecha))) sal.fecha = entrada.fecha
    else return null
  }
  return sal
}

export const contarSubtareas = (lista: ReadonlyArray<Pick<SubtareaTC, 'hecha'>>): { total: number; hechas: number } => ({ total: lista.length, hechas: lista.filter((s) => s.hecha).length })

/** Las tareas que bloquean a ésta y siguen sin estar hechas. `hecha` dice si una tarea está hecha; una que ya no existe (borrada, archivada) no bloquea */
export function bloqueantesPendientes(bloqueada_por: readonly string[] | undefined, existe: (id: string) => boolean, hecha: (id: string) => boolean): string[] {
  return (bloqueada_por ?? []).filter((id) => existe(id) && !hecha(id))
}

/**
 * Valida a qué tareas se quiere hacer depender esta. `otras` son TODAS las del cliente con su lista de bloqueos. Devuelve la lista limpia (sin repetidos, sin ella misma, solo
 * las que existen) o el motivo del rechazo.
 */
export function validarBloqueos(tareaId: string, ids: unknown, otras: ReadonlyMap<string, readonly string[]>): { ok: true; ids: string[] } | { ok: false; motivo: string } {
  if (!Array.isArray(ids)) return { ok: false, motivo: 'Los bloqueos no son una lista.' }
  const limpios = [...new Set(ids.filter((x): x is string => typeof x === 'string' && UUID.test(x)))]
  if (limpios.includes(tareaId)) return { ok: false, motivo: 'Una tarea no puede depender de sí misma.' }
  if (limpios.length > MAX_BLOQUEOS) return { ok: false, motivo: `Una tarea puede depender de hasta ${MAX_BLOQUEOS} tareas.` }
  const desconocidas = limpios.filter((id) => !otras.has(id))
  if (desconocidas.length > 0) return { ok: false, motivo: 'Solo puede depender de tareas del mismo cliente.' }
  // Un ciclo: alguna de las elegidas depende (directa o indirectamente) de esta
  for (const id of limpios) {
    const visitadas = new Set<string>()
    const pila = [id]
    while (pila.length > 0) {
      const actual = pila.pop() as string
      if (actual === tareaId) return { ok: false, motivo: 'Eso crearía un círculo: esa tarea ya depende de ésta.' }
      if (visitadas.has(actual)) continue
      visitadas.add(actual)
      for (const siguiente of otras.get(actual) ?? []) pila.push(siguiente)
    }
  }
  return { ok: true, ids: limpios }
}

/**
 * Qué tareas están bloqueadas ahora mismo: las que dependen de otra que está en la lista (viva) y no está hecha. Una tarea hecha no se enseña como bloqueada aunque su
 * bloqueo siga pendiente: ya no estorba.
 */
export function tareasBloqueadas<T extends { id: string; bloqueada_por?: readonly string[] }>(tareas: readonly T[], hecha: (t: T) => boolean): Set<string> {
  const porId = new Map(tareas.map((t) => [t.id, t]))
  const bloqueadas = new Set<string>()
  for (const t of tareas) {
    if (!t.bloqueada_por?.length || hecha(t)) continue
    if (bloqueantesPendientes(t.bloqueada_por, (id) => porId.has(id), (id) => hecha(porId.get(id) as T)).length > 0) bloqueadas.add(t.id)
  }
  return bloqueadas
}
