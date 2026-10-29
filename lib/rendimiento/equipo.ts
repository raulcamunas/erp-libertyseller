/**
 * QUIÉN SE MIDE EN RENDIMIENTO.
 * =============================
 * El panel de Rendimiento, su informe semanal y la puerta por la que un administrador vincula el Rinkel de otra persona miden al EQUIPO QUE LLAMA, que son dos clases de
 * perfil: los comerciales (`profiles.is_comercial`) y los managers comerciales (`profiles.puesto = 'manager_comercial'`, migración 257). Un manager supervisa, pero también llama,
 * escribe y agenda —tiene su Rinkel y su WhatsApp de empresa—, y hay que verlo en la misma tabla que a los demás.
 *
 * NO se hace a un manager `is_comercial`: esa marca decide a quién se le reparten leads, quién sale en las listas de comerciales de la Agenda y de las Secuencias, y a quién se
 * le exigen las cifras de un comercial. Un manager es otra cosa (puesto aparte), y por eso Rendimiento mira los dos.
 *
 * Una base sin la migración 257 no tiene `puesto`: se mide solo a los comerciales, como antes (y no se vacía el equipo por una columna que falta). Se comprueba con equipo.prueba.ts.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

/** El filtro de PostgREST (`.or(...)`) de quién se mide */
export const FILTRO_DEL_EQUIPO_MEDIDO = 'is_comercial.eq.true,puesto.eq.manager_comercial'

export const PUESTO_DE_MANAGER = 'manager_comercial'

export interface PerfilDelEquipo {
  id: string
  full_name: string | null
  email: string | null
}

/** ¿Es de quienes se miden? Comercial, o manager comercial */
export const esDelEquipoMedido = (p: { is_comercial?: boolean | null; puesto?: string | null } | null | undefined): boolean => p?.is_comercial === true || p?.puesto === PUESTO_DE_MANAGER

export type ClienteDePerfiles = Pick<SupabaseClient, 'from'>

/** Los perfiles que se miden, por nombre. El error solo viene si fallan las dos lecturas (con y sin `puesto`) */
export async function leerEquipoMedido(db: ClienteDePerfiles): Promise<{ data: PerfilDelEquipo[] | null; error: unknown }> {
  const completa = await db.from('profiles').select('id, full_name, email').or(FILTRO_DEL_EQUIPO_MEDIDO).order('full_name', { ascending: true })
  if (!completa.error) return { data: (completa.data ?? []) as PerfilDelEquipo[], error: null }
  // Sin la migración 257 la base no tiene `puesto`: se mide a los comerciales, como antes de los managers
  const solo = await db.from('profiles').select('id, full_name, email').eq('is_comercial', true).order('full_name', { ascending: true })
  if (solo.error) return { data: null, error: solo.error }
  return { data: (solo.data ?? []) as PerfilDelEquipo[], error: null }
}
