import { actualizarTarea, ErrorDeTareas, esUuid, moverTarea, type Actor } from './servidor'

/**
 * ACCIONES SOBRE VARIAS TAREAS A LA VEZ (lo que se hace tras marcar varias con el cuadro de selección): moverlas a una columna o archivarlas.
 *
 * Cada tarea se trata como si se hiciera una a una (mismo historial, misma cola hacia Notion, mismas comprobaciones, p. ej. que la columna exista en el Notion de su cliente),
 * y lo que falla no impide el resto: se devuelve cuántas salieron bien y cuáles no, con el motivo. Archivar NO borra: la tarea se puede recuperar (y en Notion va a la papelera).
 */

export const MAX_TAREAS_POR_LOTE = 100

export interface ResultadoDeLote {
  hechas: number
  fallidas: Array<{ id: string; motivo: string }>
}

export async function ejecutarLote(actor: Actor, entrada: Record<string, unknown>): Promise<ResultadoDeLote> {
  const ids = Array.isArray(entrada.ids) ? [...new Set(entrada.ids.filter(esUuid))] : []
  if (ids.length === 0) throw new ErrorDeTareas('No hay ninguna tarea seleccionada.')
  if (ids.length > MAX_TAREAS_POR_LOTE) throw new ErrorDeTareas(`Se pueden tocar como mucho ${MAX_TAREAS_POR_LOTE} tareas a la vez.`)
  const accion = entrada.accion
  if (accion !== 'mover' && accion !== 'archivar') throw new ErrorDeTareas('Esa acción no existe.')
  const estado = typeof entrada.estado === 'string' ? entrada.estado.trim() : ''
  if (accion === 'mover' && !estado) throw new ErrorDeTareas('Falta la columna de destino.')

  const resultado: ResultadoDeLote = { hechas: 0, fallidas: [] }
  for (const id of ids) {
    try {
      if (accion === 'mover') await moverTarea(actor, id, { estado, despuesDe: null, alFinal: true })
      else await actualizarTarea(actor, id, { archivada: true })
      resultado.hechas += 1
    } catch (e) {
      resultado.fallidas.push({ id, motivo: e instanceof Error ? e.message : 'No se ha podido' })
    }
  }
  return resultado
}
