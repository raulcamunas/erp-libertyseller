/**
 * SEO TEST · LAS BÚSQUEDAS DECIDIDAS A MANO («No es nuestro producto» / «Sí es nuestro»). SOLO SERVIDOR. Migración 333.
 *
 * Sin la migración, la lectura devuelve listas vacías (la pantalla sigue con la heurística de lib/seo/embudo.ts) y guardar avisa de que falta lanzarla.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { claveDeBusqueda } from './embudo'

export interface DecisionesGuardadas {
  ajenas: string[]
  nuestras: string[]
  /** ¿Está la migración 333? Sin ella, el botón no se puede usar */
  disponible: boolean
}

export class FaltaMigracion333 extends Error {
  constructor() {
    super('Falta lanzar la migración 333 en Supabase para guardar las búsquedas que no son de tu producto.')
  }
}

/** Las búsquedas decididas en una cuenta y país (normalizadas). Vacías si falta la migración 333 */
export async function decisionesDeBusquedas(connectionId: string, marketplaceId: string): Promise<DecisionesGuardadas> {
  const ajenas: string[] = []
  const nuestras: string[] = []
  for (let i = 0; i < 20_000; i += 1000) {
    const { data, error } = await createServiceClient()
      .from('seo_busquedas_decididas')
      .select('consulta, decision')
      .eq('connection_id', connectionId)
      .eq('marketplace_id', marketplaceId)
      .order('consulta', { ascending: true })
      .range(i, i + 999)
    if (error) {
      if (isMissingSchema(error)) return { ajenas: [], nuestras: [], disponible: false }
      throw error
    }
    for (const r of (data ?? []) as Array<{ consulta: string; decision: string }>) (r.decision === 'ajena' ? ajenas : nuestras).push(r.consulta)
    if (!data || data.length < 1000) break
  }
  return { ajenas, nuestras, disponible: true }
}

/** Guarda (o cambia) la decisión sobre una búsqueda */
export async function decidirBusqueda(connectionId: string, marketplaceId: string, texto: string, decision: 'ajena' | 'nuestra', asin: string | null, userId: string): Promise<void> {
  const consulta = claveDeBusqueda(texto)
  if (!consulta) throw new Error('Falta la búsqueda.')
  const { error } = await createServiceClient()
    .from('seo_busquedas_decididas')
    .upsert({ connection_id: connectionId, marketplace_id: marketplaceId, consulta, texto: texto.slice(0, 300), decision, asin, created_by: userId, created_at: new Date().toISOString() }, { onConflict: 'connection_id,marketplace_id,consulta' })
  if (error) {
    if (isMissingSchema(error)) throw new FaltaMigracion333()
    throw error
  }
}

/** Quita la decisión: la búsqueda vuelve a juzgarse con la heurística */
export async function quitarDecision(connectionId: string, marketplaceId: string, texto: string): Promise<void> {
  const { error } = await createServiceClient().from('seo_busquedas_decididas').delete().eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).eq('consulta', claveDeBusqueda(texto))
  if (error) {
    if (isMissingSchema(error)) throw new FaltaMigracion333()
    throw error
  }
}
