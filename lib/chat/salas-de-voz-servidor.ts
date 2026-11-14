import { createServiceClient } from '@/lib/supabase/service'
import { CANALES_DE_VOZ_POR_DEFECTO, origenDeVoz } from './voz'

/**
 * Crea los canales de voz con los que nace el chat (sala-general, comercial, reuniones), una vez por arranque del servidor. Entran solos todos los del equipo (`auto_unirse`) la próxima vez que
 * abren el chat. Si alguien ya tiene un canal con ese nombre, se deja tranquilo. Nunca lanza: el chat sigue igual si algo falla.
 */
let preparado: Promise<void> | null = null

export function prepararCanalesDeVoz(): Promise<void> {
  if (!preparado) {
    preparado = (async () => {
      try {
        const service = createServiceClient()
        const origenes = CANALES_DE_VOZ_POR_DEFECTO.map((c) => origenDeVoz(c.clave))
        const { data, error } = await service.from('chat_canales').select('origen_id').in('origen_id', origenes)
        if (error) return // sin la migración 287 no existe `origen_id`: no hay canales de voz todavía
        const hay = new Set(((data ?? []) as Array<{ origen_id: string }>).map((c) => c.origen_id))
        for (const c of CANALES_DE_VOZ_POR_DEFECTO) {
          if (hay.has(origenDeVoz(c.clave))) continue
          const { error: errorAlCrear } = await service.from('chat_canales').insert({ tipo: 'canal', nombre: c.nombre, descripcion: c.descripcion, auto_unirse: true, origen_id: origenDeVoz(c.clave) })
          if (errorAlCrear && errorAlCrear.code !== '23505') console.error(`Chat: no se ha podido crear el canal de voz ${c.nombre}:`, errorAlCrear.message)
        }
      } catch (e) {
        console.error('Chat: no se han podido preparar los canales de voz:', e instanceof Error ? e.message : e)
        preparado = null
      }
    })()
  }
  return preparado
}
