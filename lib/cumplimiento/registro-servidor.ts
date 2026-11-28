/**
 * CUMPLIMIENTO · EL REGISTRO DE ACCIONES Y LOS COMENTARIOS (migración 343). SOLO SERVIDOR.
 *
 * Quién hizo qué sobre un cliente y cuándo: quitar o volver a seguir un listing (con su motivo), revisar, corregir la ficha, cambiar un precio, y los comentarios del equipo.
 * Las correcciones enviadas salen de cumplimiento_correcciones (313), que ya guarda quién y cuándo. Apuntar una acción NUNCA tumba la acción: si falla, se avisa en el log y se sigue.
 * Todo se pide por CLIENTE (el slug ya traducido en la ruta): no se puede leer lo de otro.
 */

import { todasLasFilas } from '@/lib/ads/paginar'
import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { nombresDe } from '@/lib/seo/edicion-servidor'

export type TipoRegistro = 'comentario' | 'descartar' | 'recuperar' | 'revisar' | 'revisar-todo' | 'corregir' | 'precio'

export interface EntradaRegistro {
  id: string
  tipo: TipoRegistro
  mercado: string | null
  sku: string | null
  asin: string | null
  texto: string | null
  autorId: string | null
  /** null = lo hizo el ERP solo */
  autor: string | null
  at: string
}

export interface Apunte {
  mercado?: string | null
  sku?: string | null
  asin?: string | null
  tipo: TipoRegistro
  texto?: string | null
}

const COLUMNAS = 'id, tipo, marketplace_id, sku, asin, texto, autor, created_at'
export const MAX_TEXTO = 2000

const fila = (clientId: string, a: Apunte, autor: string | null) => ({
  client_id: clientId,
  marketplace_id: a.mercado ?? null,
  sku: a.sku ?? null,
  asin: a.asin ?? null,
  tipo: a.tipo,
  texto: a.texto ? a.texto.slice(0, MAX_TEXTO) : null,
  autor,
})

/** Apunta una o varias acciones. No lanza nunca: el registro no puede romper lo que registra */
export async function apuntar(clientId: string, apuntes: Apunte | Apunte[], autor: string | null): Promise<void> {
  const lista = Array.isArray(apuntes) ? apuntes : [apuntes]
  if (lista.length === 0) return
  try {
    for (let i = 0; i < lista.length; i += 500) {
      const { error } = await createServiceClient().from('cumplimiento_registro').insert(lista.slice(i, i + 500).map((a) => fila(clientId, a, autor)))
      if (error) {
        if (!isMissingSchema(error)) console.error('[cumplimiento] registro:', error.message)
        return
      }
    }
  } catch (e) {
    console.error('[cumplimiento] registro:', e)
  }
}

async function conNombres(filas: Array<Record<string, unknown>>): Promise<EntradaRegistro[]> {
  const nombres = await nombresDe(filas.map((f) => f.autor))
  return filas.map((f) => ({
    id: String(f.id),
    tipo: f.tipo as TipoRegistro,
    mercado: typeof f.marketplace_id === 'string' ? f.marketplace_id : null,
    sku: typeof f.sku === 'string' ? f.sku : null,
    asin: typeof f.asin === 'string' ? f.asin : null,
    texto: typeof f.texto === 'string' ? f.texto : null,
    autorId: typeof f.autor === 'string' ? f.autor : null,
    autor: typeof f.autor === 'string' ? (nombres.get(f.autor) ?? 'alguien del equipo') : null,
    at: String(f.created_at),
  }))
}

/** El registro del cliente (o de un listing), los más nuevos primero. null = falta la migración 343 */
export async function registroDeCliente(clientId: string, opciones: { mercado?: string | null; sku?: string | null; limite?: number } = {}): Promise<EntradaRegistro[] | null> {
  const limite = Math.min(opciones.limite ?? 200, 500)
  let q = createServiceClient().from('cumplimiento_registro').select(COLUMNAS).eq('client_id', clientId)
  if (opciones.mercado) q = q.eq('marketplace_id', opciones.mercado)
  if (opciones.sku) q = q.eq('sku', opciones.sku)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limite)
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  const propias = (data ?? []) as Array<Record<string, unknown>>
  return (await conNombres([...propias, ...(await correcciones(clientId, opciones, limite))])).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limite)
}

/** Las correcciones enviadas a Amazon (313) salen de su propia tabla, que ya guarda quién y cuándo: no se apuntan dos veces */
async function correcciones(clientId: string, o: { mercado?: string | null; sku?: string | null }, limite: number): Promise<Array<Record<string, unknown>>> {
  try {
    const s = createServiceClient()
    const { data: conexiones } = await s.from('amazon_connections').select('id').eq('client_id', clientId)
    const ids = ((conexiones ?? []) as Array<{ id: string }>).map((c) => c.id)
    if (ids.length === 0) return []
    let q = s.from('cumplimiento_correcciones').select('id, marketplace_id, sku, codigo_incidencia, estado, creado_por, creado_at').in('connection_id', ids).eq('modo', 'enviar')
    if (o.mercado) q = q.eq('marketplace_id', o.mercado)
    if (o.sku) q = q.eq('sku', o.sku)
    const { data, error } = await q.order('creado_at', { ascending: false }).limit(limite)
    if (error) return []
    return ((data ?? []) as Array<Record<string, unknown>>).map((c) => ({
      id: `corr-${c.id}`,
      tipo: 'corregir',
      marketplace_id: c.marketplace_id,
      sku: c.sku,
      asin: null,
      texto: `${c.estado === 'aceptado' ? 'Amazon lo aceptó' : c.estado === 'invalido' ? 'Amazon lo rechazó' : 'Falló el envío'}${c.codigo_incidencia ? ` · incidencia ${c.codigo_incidencia}` : ''}`,
      autor: c.creado_por,
      created_at: c.creado_at,
    }))
  } catch {
    return []
  }
}

/** Cuántos comentarios tiene cada listing (clave `mercado|sku`) de los que se están viendo */
export async function comentariosPorListing(clientId: string, listings: ReadonlyArray<{ marketplace_id: string; sku: string }>): Promise<Record<string, number>> {
  if (listings.length === 0) return {}
  // Paginado: sin él PostgREST corta en 1000 comentarios y los listings con muchos salían con la cuenta corta
  const { data, error } = await todasLasFilas<{ marketplace_id: string; sku: string }>((a, b) =>
    createServiceClient()
      .from('cumplimiento_registro')
      .select('marketplace_id, sku')
      .eq('client_id', clientId)
      .eq('tipo', 'comentario')
      .in('sku', [...new Set(listings.map((l) => l.sku))].slice(0, 300))
      .order('id')
      .range(a, b),
  )
  if (error) return {}
  const n: Record<string, number> = {}
  for (const r of (data ?? []) as Array<{ marketplace_id: string; sku: string }>) n[`${r.marketplace_id}|${r.sku}`] = (n[`${r.marketplace_id}|${r.sku}`] ?? 0) + 1
  return n
}

export async function comentar(clientId: string, a: { mercado: string; sku: string; asin: string | null; texto: string }, autor: string): Promise<EntradaRegistro> {
  const { data, error } = await createServiceClient()
    .from('cumplimiento_registro')
    .insert(fila(clientId, { ...a, tipo: 'comentario' }, autor))
    .select(COLUMNAS)
    .single()
  if (error) throw error
  return (await conNombres([data as Record<string, unknown>]))[0]
}

/** Borra un comentario SOLO si es de quien lo pide */
export async function borrarComentario(clientId: string, autor: string, id: string): Promise<boolean> {
  const { data, error } = await createServiceClient().from('cumplimiento_registro').delete().eq('id', id).eq('client_id', clientId).eq('autor', autor).eq('tipo', 'comentario').select('id')
  if (error) throw error
  return (data ?? []).length > 0
}
