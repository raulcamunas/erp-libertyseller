/**
 * INFORMES URGENTES · LO QUE TOCA STORAGE Y KEEPA (lo puro y el porqué, en urgentes.ts).
 * Pedir un informe: se mira qué informe le toca al lead (vendedor de Amazon si tiene `seller=` en su seller_url; si no, el de su web), se
 * asegura que está en su cola (si no estaba, se añade) y se apunta en urgentes.json. La recogida lo hace en la siguiente pasada con saldo.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { escribirJson, leerJson, type EnCola, type EnColaSinAmazon } from './almacen'
import { saldoKeepa } from './keepa'
import { COSTE_DE_TIPO, type TipoDeCola } from './turnos'
import { anadirPedido, minutosDeEspera, pendientesUrgentes, vendedorDeUrl, type PedidoUrgente } from './urgentes'

export const FICHERO_URGENTES = 'urgentes.json'

export type EstadoDelPedido =
  | { estado: 'pendiente'; puesto: number; minutos: { min: number; max: number } | null; pedidoAt: string; tipo: TipoDeCola }
  | { estado: 'saltado'; motivo: string; resueltoAt: string | null }
  | null

export type ResultadoDePedir = { ok: true; pedido: EstadoDelPedido } | { ok: false; error: string; status: number }

/** Lo que le falta al saldo para cada pedido hasta el del lead, y cuánto tardará */
async function estimar(lista: readonly PedidoUrgente[], leadId: string): Promise<EstadoDelPedido> {
  const propio = lista.find((p) => p.lead === leadId)
  if (!propio) return null
  if (propio.estado === 'saltado') return { estado: 'saltado', motivo: propio.motivo ?? 'no se ha podido', resueltoAt: propio.resueltoAt ?? null }
  const pendientes = pendientesUrgentes(lista)
  const puesto = pendientes.findIndex((p) => p.lead === leadId)
  const costes = pendientes.slice(0, puesto + 1).map((p) => COSTE_DE_TIPO[p.tipo])
  let minutos: { min: number; max: number } | null = null
  const clave = (process.env.KEEPA_KEY ?? '').trim()
  if (clave) {
    try {
      const saldo = await saldoKeepa(clave)
      minutos = minutosDeEspera(costes, saldo.tokens, saldo.ritmo)
    } catch {
      // Sin saldo no hay estimación; el pedido sigue en pie
    }
  }
  return { estado: 'pendiente', puesto: puesto + 1, minutos, pedidoAt: propio.at, tipo: propio.tipo }
}

export async function estadoDelPedido(s: SupabaseClient, leadId: string): Promise<EstadoDelPedido> {
  const lista = await leerJson<PedidoUrgente[]>(s, FICHERO_URGENTES, [])
  return estimar(Array.isArray(lista) ? lista : [], leadId)
}

export async function pedirInformeUrgente(s: SupabaseClient, leadId: string, por: string | null): Promise<ResultadoDePedir> {
  const { data, error } = await s.from('cold_leads').select('id, store_name, company, web, seller_url, analisis_amazon_at, assigned_to').eq('id', leadId).maybeSingle()
  if (error) throw error
  const lead = data as { store_name: string | null; company: string | null; web: string | null; seller_url: string | null; analisis_amazon_at: string | null; assigned_to: string | null } | null
  if (!lead) return { ok: false, error: 'El lead ya no existe', status: 404 }
  if (lead.analisis_amazon_at) return { ok: false, error: 'Este lead ya tiene su informe', status: 409 }

  const vendedor = vendedorDeUrl(lead.seller_url)
  const web = lead.web?.trim() || null
  if (!vendedor && !web) return { ok: false, error: 'Sin web ni enlace de vendedor de Amazon no se puede sacar el informe: añade uno de los dos en la ficha', status: 422 }
  const tipo: TipoDeCola = vendedor ? 'amazon' : 'sin'
  const tienda = lead.store_name?.trim() || lead.company?.trim() || web || 'Tienda'
  const comercialId = lead.assigned_to ?? undefined

  // Que esté en su cola: la recogida saca de ahí el vendedor (y el mercado) o la web
  if (vendedor) {
    const cola = await leerJson<EnCola[]>(s, 'cola.json', [])
    const i = cola.findIndex((c) => c.lead === leadId)
    if (i < 0 || cola[i].seller !== vendedor.seller) {
      const entrada: EnCola = { lead: leadId, seller: vendedor.seller, tienda, ...(comercialId ? { comercialId } : {}), ...(vendedor.mercado === 'mx' ? { mercado: 'mx' as const } : {}) }
      await escribirJson(s, 'cola.json', [entrada, ...cola.filter((c) => c.lead !== leadId)])
    }
  } else {
    const cola = await leerJson<EnColaSinAmazon[]>(s, 'cola-sin-amazon.json', [])
    const i = cola.findIndex((c) => c.lead === leadId)
    if (i < 0 || cola[i].web !== web) {
      const entrada: EnColaSinAmazon = { lead: leadId, tienda, web: web!, ...(comercialId ? { comercialId } : {}) }
      await escribirJson(s, 'cola-sin-amazon.json', [entrada, ...cola.filter((c) => c.lead !== leadId)])
    }
  }

  const previa = await leerJson<PedidoUrgente[]>(s, FICHERO_URGENTES, [])
  const lista = anadirPedido(Array.isArray(previa) ? previa : [], { lead: leadId, tipo, tienda, por, at: new Date().toISOString() })
  await escribirJson(s, FICHERO_URGENTES, lista)
  return { ok: true, pedido: await estimar(lista, leadId) }
}
