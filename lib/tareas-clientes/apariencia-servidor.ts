import { createServiceClient } from '@/lib/supabase/service'
import { elegirApariencia, type MapaDeApariencia } from './apariencia'
import { ErrorDeTareas } from './servidor'

/** Lo que ha elegido cada persona. Si todavía falta la migración 283 devuelve vacío (todo el mundo sigue con sus iniciales) y `disponible: false` */
export async function leerApariencias(): Promise<{ mapa: MapaDeApariencia; disponible: boolean; nombres: Record<string, string> }> {
  const service = createServiceClient()
  const { data, error } = await service.from('tc_preferencias').select('usuario_id, avatar_color, avatar_icono').or('avatar_color.not.is.null,avatar_icono.not.is.null')
  if (error) return { mapa: {}, disponible: false, nombres: {} }
  const mapa: MapaDeApariencia = {}
  for (const f of (data ?? []) as Array<{ usuario_id: string; avatar_color: string | null; avatar_icono: string | null }>) mapa[f.usuario_id] = { color: f.avatar_color, icono: f.avatar_icono }
  // Los nombres de quien tiene algo cogido, para decir «lo tiene Ana» sin pedir la lista de personas
  const ids = Object.keys(mapa)
  const nombres: Record<string, string> = {}
  if (ids.length > 0) {
    const { data: perfiles } = await service.from('profiles').select('id, full_name').in('id', ids)
    for (const p of (perfiles ?? []) as Array<{ id: string; full_name: string | null }>) nombres[p.id] = (p.full_name ?? '').trim().split(' ')[0] || 'otra persona'
  }
  return { mapa, disponible: true, nombres }
}

export async function guardarApariencia(userId: string, quiere: { color: unknown; icono: unknown }): Promise<MapaDeApariencia> {
  const { mapa, disponible } = await leerApariencias()
  if (!disponible) throw new ErrorDeTareas('Falta lanzar la migración 283 en Supabase.', 409)
  const service = createServiceClient()
  const { data: perfiles } = await service.from('profiles').select('id, full_name')
  const nombres = new Map(((perfiles ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => [p.id, (p.full_name ?? 'otra persona').split(' ')[0]]))
  const r = elegirApariencia(mapa, userId, quiere, (id) => nombres.get(id) ?? 'otra persona')
  if (!r.ok) throw new ErrorDeTareas(r.motivo, 409)
  const { error } = await service.from('tc_preferencias').upsert({ usuario_id: userId, avatar_color: r.color, avatar_icono: r.icono, actualizado_en: new Date().toISOString() }, { onConflict: 'usuario_id' })
  // Dos personas pulsando a la vez: gana la primera y el índice único frena a la segunda
  if (error) throw new ErrorDeTareas(error.code === '23505' ? 'Alguien acaba de coger eso. Elige otro.' : `No se ha podido guardar: ${error.message}`, error.code === '23505' ? 409 : 500)
  return (await leerApariencias()).mapa
}
