/**
 * SEO TEST · LOS COMENTARIOS DE LA PESTAÑA «CAMBIOS» (migración 342). SOLO SERVIDOR.
 *
 * Un hilo por cambio de ficha («cambio:<edición>») o por acción del registro («ev:<id>»). Quien los escribe sale con su nombre y su avatar; cada uno borra solo los suyos.
 * Sin la migración, la lista llega vacía con sinTabla = true y la pantalla avisa en vez de dejar escribir.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { nombresDe } from './edicion-servidor'

export interface ComentarioSeo {
  id: string
  hilo: string
  asin: string | null
  texto: string
  autorId: string
  autor: string
  at: string
}

type Cuenta = { connectionId: string; marketplaceId: string }
const COLUMNAS = 'id, hilo, asin, texto, autor, created_at'
export const MAX_TEXTO = 2000
const HILO = /^(cambio|ev):[\w.:@~-]{1,190}$/

export function hiloValido(h: unknown): h is string {
  return typeof h === 'string' && HILO.test(h)
}

async function conNombres(filas: Array<Record<string, unknown>>): Promise<ComentarioSeo[]> {
  const nombres = await nombresDe(filas.map((f) => f.autor))
  return filas.map((f) => ({
    id: String(f.id),
    hilo: String(f.hilo),
    asin: typeof f.asin === 'string' ? f.asin : null,
    texto: String(f.texto),
    autorId: String(f.autor),
    autor: nombres.get(String(f.autor)) ?? 'alguien del equipo',
    at: String(f.created_at),
  }))
}

/** Todos los comentarios de la cuenta y país (los 6 últimos meses), los más viejos primero dentro de cada hilo */
export async function comentariosDeLaCuenta(c: Cuenta): Promise<{ comentarios: ComentarioSeo[]; sinTabla: boolean }> {
  const desde = new Date(Date.now() - 200 * 86_400_000).toISOString()
  const { data, error } = await createServiceClient().from('seo_comentarios').select(COLUMNAS).eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).gte('created_at', desde).order('created_at', { ascending: true }).limit(2000)
  if (error) {
    if (isMissingSchema(error)) return { comentarios: [], sinTabla: true }
    throw error
  }
  return { comentarios: await conNombres((data ?? []) as Array<Record<string, unknown>>), sinTabla: false }
}

export async function comentar(c: Cuenta, autor: string, hilo: string, asin: string | null, texto: string): Promise<ComentarioSeo> {
  const { data, error } = await createServiceClient()
    .from('seo_comentarios')
    .insert({ connection_id: c.connectionId, marketplace_id: c.marketplaceId, hilo, asin, texto, autor })
    .select(COLUMNAS)
    .single()
  if (error) throw error
  return (await conNombres([data as Record<string, unknown>]))[0]
}

/** Borra un comentario SOLO si es de quien lo pide. Devuelve si se borró */
export async function borrarComentario(c: Cuenta, autor: string, id: string): Promise<boolean> {
  const { data, error } = await createServiceClient().from('seo_comentarios').delete().eq('id', id).eq('autor', autor).eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).select('id')
  if (error) throw error
  return (data ?? []).length > 0
}
