/**
 * LOS CLIENTES ACTUALES NO RECIBEN INFORMES COMERCIALES.
 *
 * El 13 nov 2026 aparecieron 12 clientes en las listas de leads (Creative Toys, Entrais, ShoesF…). La recogida de informes los salta:
 * por su ID de vendedor de Amazon (conexiones SP-API y clientes de publicidad) o por su nombre / razón social (tablas `clientes`,
 * `clients`, `amazon_clients`, `marketing_clients`), y en las tiendas online también por el dominio de su web.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

const SUFIJOS = /\b(s\s?l\s?u|s\s?l\s?l|s\s?a\s?u|s\s?l|s\s?a|llc|ltd|sociedad limitada|slne)\b/g
export const nombreNormal = (t: unknown) =>
  String(t ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&amp;/g, '&')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(SUFIJOS, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export type Clientes = { sellers: Set<string>; nombres: Set<string> }

export async function clientesActuales(s: SupabaseClient): Promise<Clientes> {
  const nombres = new Set<string>()
  const sellers = new Set<string>()
  const meter = (n: unknown) => {
    const x = nombreNormal(n)
    if (x.length >= 4) nombres.add(x)
  }
  const [a, b, c, d, e] = await Promise.all([
    s.from('clientes').select('nombre'),
    s.from('clients').select('name, marca_propia'),
    s.from('amazon_clients').select('name'),
    s.from('marketing_clients').select('name, amazon_seller_url'),
    s.from('amazon_connections').select('selling_partner_id'),
  ])
  for (const r of (a.data ?? []) as { nombre: string }[]) meter(r.nombre)
  for (const r of (b.data ?? []) as { name: string; marca_propia: string | null }[]) {
    meter(r.name)
    meter(r.marca_propia)
  }
  for (const r of (c.data ?? []) as { name: string }[]) meter(r.name)
  for (const r of (d.data ?? []) as { name: string; amazon_seller_url: string | null }[]) {
    meter(r.name)
    const id = /seller=([A-Z0-9]+)/.exec(r.amazon_seller_url ?? '')?.[1]
    if (id) sellers.add(id)
  }
  for (const r of (e.data ?? []) as { selling_partner_id: string | null }[]) if (r.selling_partner_id) sellers.add(r.selling_partner_id)
  return { sellers, nombres }
}

export function esCliente(c: Clientes, x: { seller?: string | null; nombres?: unknown[]; web?: string | null }): boolean {
  if (x.seller && c.sellers.has(x.seller)) return true
  if ((x.nombres ?? []).some((n) => c.nombres.has(nombreNormal(n)))) return true
  if (x.web) {
    const host = String(x.web).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('.')[0].replace(/[^a-z0-9]/g, '')
    for (const n of c.nombres) if (n.replace(/ /g, '').length >= 5 && host === n.replace(/ /g, '')) return true
  }
  return false
}
