import { createServiceClient } from '@/lib/supabase/service'
import { huellaDeContenido, type Bloque } from './bloques'
import { MAX_VERSIONES, resumirVersion, tocaGuardarVersion, type OrigenDeVersion } from './historial'

/**
 * GUARDAR UNA COPIA DEL CUERPO ANTES DE PISARLO (tabla `tc_versiones`, migración 278). SOLO SERVIDOR.
 *
 * Esto NO PUEDE TUMBAR el guardado de una tarea: si la tabla no existe todavía (las migraciones se lanzan a mano y el código puede llegar antes) o la base falla, se sigue
 * sin la copia. Quien lo llama no espera nada de vuelta. Para leer, listar y restaurar versiones, ver historial-lectura.ts (aparte para no importarse en círculo con servidor.ts).
 */
export async function guardarVersion(tarea: { id: string; titulo: string }, anterior: readonly Bloque[], quien: { userId?: string | null; nombre: string }, origen: OrigenDeVersion, forzar = false): Promise<void> {
  try {
    if (anterior.length === 0) return
    const service = createServiceClient()
    const { data: ultima, error } = await service.from('tc_versiones').select('huella, creado_en').eq('tarea_id', tarea.id).order('creado_en', { ascending: false }).limit(1).maybeSingle()
    if (error) return
    const huella = huellaDeContenido(anterior)
    if (!tocaGuardarVersion(anterior, ultima ? { huella: (ultima as { huella: string }).huella, creadaEn: (ultima as { creado_en: string }).creado_en } : null, new Date(), forzar)) return
    const { error: errorAlGuardar } = await service.from('tc_versiones').insert({
      tarea_id: tarea.id,
      titulo: tarea.titulo.slice(0, 300),
      contenido: anterior,
      huella,
      resumen: resumirVersion(anterior),
      origen,
      usuario_id: quien.userId || null,
      usuario_nombre: quien.nombre.slice(0, 120),
    })
    if (errorAlGuardar) return
    // Solo se conservan las últimas
    const { data: viejas } = await service.from('tc_versiones').select('id').eq('tarea_id', tarea.id).order('creado_en', { ascending: false }).range(MAX_VERSIONES, MAX_VERSIONES + 200)
    const ids = ((viejas ?? []) as Array<{ id: string }>).map((v) => v.id)
    if (ids.length > 0) await service.from('tc_versiones').delete().in('id', ids)
  } catch {
    /* sin copia, pero la tarea se guarda */
  }
}
