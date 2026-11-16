/**
 * AMAZON ADS · EL AGENTE PPC: COPIA SEMANAL DE LOS TÉRMINOS DE BÚSQUEDA (SOLO SERVIDOR; solo base de datos).
 *
 * `ads_terminos` es una ventana MÓVIL de 30 días (se reescribe con cada informe): sin copia, a las 5 semanas no se sabe qué hizo un término antes de negativizarlo, ni si vendió hace 2 meses.
 * Cada lunes local se copia, AGREGADA por (campaña, término en minúsculas) — los grupos de anuncios se suman: la PK de `ads_terminos_semana` es (perfil, semana, campaña, término) — y se borran las
 * copias de más de 26 semanas.
 *
 * Sin la 315, lanza `Error(FALTA_MIGRACION_315)`.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { todasLasFilas } from '../paginar'
import { asinDeCampana } from '../productos-agrupar'
import { desplazar, lanzar, numero, redondear2 } from './contexto-servidor'
import { AGENTE } from './tipos'

const LOTE_UPSERT = 500
/** Campañas cuyo nombre se pide a la vez (una consulta cada una) y cuántas como mucho (con más, no se comprueba: falla cerrado) */
const LOTE_NOMBRES = 20
const MAX_CAMPANAS_A_IDENTIFICAR = 500

export interface FilaDeTerminoSemana {
  campaign_id: string
  termino: string
  clics: number
  gasto: number
  ventas: number
  pedidos: number
  desde: string | null
  hasta: string | null
}

/** La clave de un término: minúsculas y espacios simples (como `lower(termino)` en la base, sin espacios sobrantes) */
export const claveDeTermino = (t: string): string => t.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * PURO. Agrega las filas de `ads_terminos` por (campaign_id, término en minúsculas): suma clics, gasto, ventas y pedidos; `desde` el más antiguo y `hasta` el más reciente. Términos vacíos fuera.
 */
export function agregarTerminos(
  filas: ReadonlyArray<{ campaign_id: string; termino: string; clics: unknown; gasto: unknown; ventas: unknown; pedidos: unknown; desde?: string | null; hasta?: string | null }>,
): FilaDeTerminoSemana[] {
  const por = new Map<string, FilaDeTerminoSemana>()
  for (const f of filas) {
    const termino = claveDeTermino(String(f.termino ?? ''))
    const campaign = String(f.campaign_id ?? '')
    if (!termino || !campaign) continue
    const clave = `${campaign}\u0000${termino}`
    const x = por.get(clave) ?? { campaign_id: campaign, termino, clics: 0, gasto: 0, ventas: 0, pedidos: 0, desde: null, hasta: null }
    x.clics += numero(f.clics) ?? 0
    x.gasto += numero(f.gasto) ?? 0
    x.ventas += numero(f.ventas) ?? 0
    x.pedidos += numero(f.pedidos) ?? 0
    const d = f.desde ? String(f.desde).slice(0, 10) : null
    const h = f.hasta ? String(f.hasta).slice(0, 10) : null
    if (d && (!x.desde || d < x.desde)) x.desde = d
    if (h && (!x.hasta || h > x.hasta)) x.hasta = h
    por.set(clave, x)
  }
  return Array.from(por.values()).map((x) => ({ ...x, clics: Math.round(x.clics), pedidos: Math.round(x.pedidos), gasto: redondear2(x.gasto), ventas: redondear2(x.ventas) }))
}

/**
 * Copia `ads_terminos` de la cuenta en la semana `lunes` (fecha local del lunes), AGREGADA por (campaña, término en minúsculas), con upsert (se puede repetir). Borra las semanas de más de 26.
 * Devuelve cuántas filas ha guardado.
 */
export async function guardarTerminosDeLaSemana(perfilId: string, lunes: string): Promise<number> {
  const service = createServiceClient()
  const r = await todasLasFilas<Record<string, unknown>>((a, b) =>
    service
      .from('ads_terminos')
      .select('campaign_id, ad_group_id, termino, clics, gasto, ventas, pedidos, desde, hasta')
      .eq('perfil_id', perfilId)
      .order('campaign_id')
      .order('ad_group_id')
      .order('termino')
      .range(a, b) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { code?: string; message?: string } | null }>,
  200_000)
  if (r.error) {
    // Sin ads_terminos (294) no hay nada que copiar
    if (isMissingSchema(r.error) && /ads_terminos(?!_)/.test(String(r.error.message ?? ''))) return 0
    lanzar(r.error)
  }
  const filas = agregarTerminos(r.data as Array<{ campaign_id: string; termino: string; clics: unknown; gasto: unknown; ventas: unknown; pedidos: unknown; desde?: string | null; hasta?: string | null }>)

  let guardadas = 0
  for (let i = 0; i < filas.length; i += LOTE_UPSERT) {
    const lote = filas.slice(i, i + LOTE_UPSERT).map((f) => ({ perfil_id: perfilId, semana: lunes, ...f }))
    const { error } = await service.from('ads_terminos_semana').upsert(lote, { onConflict: 'perfil_id,semana,campaign_id,termino' })
    if (error) lanzar(error)
    guardadas += lote.length
  }

  const limite = desplazar(lunes, -AGENTE.SEMANAS_TERMINOS_SE_CONSERVAN * 7)
  const { error: eBorrar } = await service.from('ads_terminos_semana').delete().eq('perfil_id', perfilId).lt('semana', limite)
  if (eBorrar) lanzar(eBorrar)
  return guardadas
}

/** Escapa los comodines de LIKE (% y _) y la barra */
const sinComodines = (t: string) => t.replace(/[\\%_]/g, (c) => `\\${c}`)

/**
 * Los pedidos que ha tenido un término (de un producto, o de toda la cuenta si `asin` es null): los de la ventana de 30 días (`ads_terminos`) más los de las copias semanales de los últimos 90 días
 * (`ads_terminos_semana`). Como cada copia semanal es a su vez una ventana de 30 días, las copias se SOLAPAN: de ellas se toma la que más pedidos tiene (sumarlas contaría el mismo pedido hasta 4
 * veces). Lo que importa a quien llama es si es > 0 («ha vendido: lo decide una persona»).
 */
export async function pedidosHistoricosDeTermino(perfilId: string, asin: string | null, termino: string): Promise<number> {
  const service = createServiceClient()
  const clave = claveDeTermino(termino)
  if (!clave) return 0
  const asinMayus = asin ? asin.toUpperCase() : null

  // 30 días: ads_terminos (con el nombre de la campaña para saber su producto)
  const { data: d30, error: e30 } = await service
    .from('ads_terminos')
    .select('campaign_id, campaign_nombre, termino, pedidos')
    .eq('perfil_id', perfilId)
    .ilike('termino', sinComodines(clave))
    .limit(2000)
  if (e30 && !isMissingSchema(e30)) throw e30
  const campanasDelAsin = new Set<string>()
  let pedidos30 = 0
  for (const f of (d30 ?? []) as Array<{ campaign_id: string; campaign_nombre: string | null; termino: string; pedidos: unknown }>) {
    if (claveDeTermino(f.termino) !== clave) continue
    const a = f.campaign_nombre ? asinDeCampana(f.campaign_nombre) : null
    // Una campaña cuyo producto no se sabe por el nombre CUENTA (falla cerrado, igual que en las copias semanales)
    if (asinMayus && a && a !== asinMayus) continue
    if (a) campanasDelAsin.add(f.campaign_id)
    pedidos30 += numero(f.pedidos) ?? 0
  }

  // 90 días: las copias semanales (sin nombre de campaña: el producto de cada campaña sale del rendimiento diario)
  const desde = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
  const { data: dSem, error: eSem } = await service
    .from('ads_terminos_semana')
    .select('semana, campaign_id, pedidos')
    .eq('perfil_id', perfilId)
    .eq('termino', clave)
    .gte('semana', desde)
    .limit(5000)
  if (eSem) lanzar(eSem)
  const filasSem = (dSem ?? []) as Array<{ semana: string; campaign_id: string; pedidos: unknown }>
  // Las campañas que no salen en la ventana de 30 días: su producto, por el nombre MÁS RECIENTE de cada una en el rendimiento diario (una consulta por campaña, sin el
  // tope de filas de PostgREST). Fallar cerrado: si falla la lectura, lanza (quien llama no negativiza); una campaña cuyo producto no se sabe CUENTA (mejor contar de más
  // y dejarlo a una persona que negativizar un término que vendió)
  const sinProducto = new Set<string>()
  if (asinMayus && filasSem.length > 0) {
    const desconocidas = Array.from(new Set(filasSem.map((f) => f.campaign_id))).filter((c) => !campanasDelAsin.has(c))
    if (desconocidas.length > MAX_CAMPANAS_A_IDENTIFICAR) throw new Error(`Demasiadas campañas (${desconocidas.length}) para saber de qué producto son las ventas del término: no lo compruebo.`)
    for (let i = 0; i < desconocidas.length; i += LOTE_NOMBRES) {
      const lote = desconocidas.slice(i, i + LOTE_NOMBRES)
      const nombres = await Promise.all(
        lote.map(async (campaignId) => {
          const { data, error } = await service.from('ads_rendimiento_diario').select('nombre').eq('perfil_id', perfilId).eq('campaign_id', campaignId).order('fecha', { ascending: false }).limit(1)
          if (error) lanzar(error)
          const nombre = ((data ?? []) as Array<{ nombre: string | null }>)[0]?.nombre ?? null
          return { campaignId, nombre }
        }),
      )
      for (const n of nombres) {
        const a = n.nombre ? asinDeCampana(n.nombre) : null
        if (a === asinMayus) campanasDelAsin.add(n.campaignId)
        else if (!a) sinProducto.add(n.campaignId)
      }
    }
  }
  const porSemana = new Map<string, number>()
  for (const f of filasSem) {
    if (asinMayus && !campanasDelAsin.has(f.campaign_id) && !sinProducto.has(f.campaign_id)) continue
    porSemana.set(f.semana, (porSemana.get(f.semana) ?? 0) + (numero(f.pedidos) ?? 0))
  }
  const maxSemana = Math.max(0, ...Array.from(porSemana.values()))
  return Math.round(pedidos30 + maxSemana)
}
