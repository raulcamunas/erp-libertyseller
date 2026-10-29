import type { createServiceClient } from '@/lib/supabase/service'

/**
 * ¿SIGUE EN MARCHA LA PASADA ANTERIOR DEL CORREO? — SOLO SERVIDOR.
 * =================================================================
 * El proceso que lee todos los buzones (`/api/correo/cron`) corre cada minuto. Una pasada normal dura ~12 s (unos 1,3 s por buzón), pero si el proveedor de correo va lento
 * puede alargarse hasta su tope (4 minutos). Sin esta comprobación, cada minuto empezaría otra pasada encima de la anterior, todas contra el mismo proveedor lento: justo lo que
 * más lo agobia. Con ella, mientras una siga en marcha las siguientes no empiezan. (Los buzones ya se protegen entre sí con un turno por buzón, así que esto no evita lecturas
 * dobles —eso ya estaba cubierto—, sino la acumulación de pasadas.)
 *
 * Solo cuentan las pasadas AUTOMÁTICAS (`lanzado_por` vacío): una que alguien lance a mano desde Sistema no bloquea a la automática. Una pasada que lleva más de lo que la ruta puede
 * durar sin terminar se da por muerta (el contenedor se reinició a mitad) y deja de bloquear. Si el registro no se puede leer, se deja correr: ante la duda, el correo se lee.
 */

type Servicio = ReturnType<typeof createServiceClient>

/** La ruta no puede durar más de 300 s; con un margen, una pasada sin terminar pasado esto está muerta */
export const PASADA_MUERTA_TRAS_MS = 330_000

export async function hayPasadaEnMarcha(service: Servicio, ahora: number = Date.now()): Promise<boolean> {
  try {
    const { data, error } = await service
      .from('cron_ejecuciones')
      .select('iniciado_at')
      .eq('tarea', 'correo-sync')
      .is('lanzado_por', null)
      .is('terminado_at', null)
      .gte('iniciado_at', new Date(ahora - PASADA_MUERTA_TRAS_MS).toISOString())
      .limit(1)
    if (error) return false
    return (data?.length ?? 0) > 0
  } catch {
    return false
  }
}
