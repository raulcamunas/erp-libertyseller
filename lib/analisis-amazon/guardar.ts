/**
 * GUARDAR UN ANÁLISIS YA CONSTRUIDO: la fila de `analisis_amazon` (con su enlace) y la marca del lead (`cold_leads.analisis_amazon_at`), que es
 * lo que enciende la casilla «Con informe» de Cold Calling. Lo usan la recogida del servidor (recogida.ts) y el importador del portátil.
 *
 * Si ese lead ya tiene informe del mismo día, se actualiza y se conserva el enlace (UNIQUE lead_id + fecha); si es de otro día, es una versión nueva.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { InformeAnalisis } from './construir'
import type { InformeSinAmazon } from '@/lib/analisis-sin-amazon/construir'
import { nuevoToken } from './servidor'

export async function guardarAnalisis(
  s: SupabaseClient,
  v: { lead: string; seller: string },
  informe: InformeAnalisis | InformeSinAmazon,
  fecha: string,
): Promise<{ ok: true } | { ok: false; error: { code?: string; message: string } }> {
  const { data: previo, error: e1 } = await s.from('analisis_amazon').select('id, fecha').eq('lead_id', v.lead).order('fecha', { ascending: false })
  if (e1) return { ok: false, error: e1 }
  const mismoDia = (previo ?? []).find((p: { fecha: string }) => p.fecha === fecha)
  const { error: e2 } = mismoDia
    ? await s.from('analisis_amazon').update({ informe, tipo: informe.tipo }).eq('id', (mismoDia as { id: string }).id)
    : await s.from('analisis_amazon').insert({
        lead_id: v.lead,
        seller_id: v.seller,
        token: nuevoToken(),
        fecha,
        version: (previo?.length ?? 0) + 1,
        tipo: informe.tipo,
        informe,
      })
  // 23505: lo acaba de guardar otro (el portátil y el servidor a la vez el mismo día): ya está
  if (e2 && e2.code !== '23505') return { ok: false, error: e2 }
  const { error: e3 } = await s.from('cold_leads').update({ analisis_amazon_at: new Date().toISOString() }).eq('id', v.lead)
  if (e3) return { ok: false, error: e3 }
  return { ok: true }
}
