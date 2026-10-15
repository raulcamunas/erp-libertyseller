import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { marketplaceLabel } from '@/lib/types/amazon'
import { TEMAS, TAMANO_PAGINA } from './tipos'
import type {
  FiltrosCumplimiento,
  FilaCumplimiento,
  PaginaCumplimiento,
  RespuestaResumen,
  Tema,
} from './tipos'
import { conexionesDeCliente } from './conexiones'

/**
 * LO QUE LEE LA PANTALLA DE CUMPLIMIENTO.
 * SOLO SERVIDOR.
 *
 * Todo se pide por CLIENTE, y el cliente se traduce a sus conexiones AQUÍ, en el
 * servidor: la pantalla manda un slug y nunca un identificador de conexión. Una
 * consulta de este fichero no puede devolver filas de una cuenta que no sea la del
 * cliente elegido.
 */

const COLUMNAS =
  'sku, asin, titulo, marketplace_id, estado, en_amazon, errores, avisos, suprimido, tema, temas, ' +
  'desde, incidencias, con_stock, es_padre, revisado_at'

/**
 * Quita lo que rompería un filtro `ilike` de PostgREST: comas, paréntesis, comodines
 * y comillas. El guion bajo SE QUEDA: es muy común en un SKU, y en `ilike` solo
 * amplía la búsqueda (vale por cualquier carácter), nunca la rompe.
 */
export function limpiarBusqueda(q: string): string {
  return q
    .replace(/[,()%*\\"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

/**
 * Aplica los filtros de la pantalla a una consulta sobre listing_cumplimiento.
 *
 * `any` a propósito: el constructor de consultas de Supabase cambia de tipo en cada
 * paso y aquí solo se encadenan filtros que cualquiera de sus formas admite.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function conFiltros(consulta: any, connIds: string[], f: FiltrosCumplimiento): any {
  let q = consulta.in('connection_id', connIds).eq('en_amazon', true)
  if (f.mercado !== 'todos') q = q.eq('marketplace_id', f.mercado)
  if (f.gravedad === 'atencion') q = q.or('errores.gt.0,suprimido.eq.true')
  else if (f.gravedad === 'avisos') q = q.gt('avisos', 0).eq('errores', 0).eq('suprimido', false)
  else q = q.or('errores.gt.0,avisos.gt.0,suprimido.eq.true')
  if (f.tema !== 'todos') q = q.eq('tema', f.tema)
  if (f.soloStock) q = q.eq('con_stock', true)
  const b = limpiarBusqueda(f.busca)
  // `*` y no `%`: es el comodín de los filtros de PostgREST
  if (b) q = q.or(`sku.ilike.*${b}*,asin.ilike.*${b}*,titulo.ilike.*${b}*`)
  return q
}

export function filtrosValidos(x: unknown): FiltrosCumplimiento {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
  const gravedad = o.gravedad === 'avisos' || o.gravedad === 'todo' ? o.gravedad : 'atencion'
  const tema = typeof o.tema === 'string' && (TEMAS as readonly string[]).includes(o.tema) ? (o.tema as Tema) : 'todos'
  return {
    mercado: typeof o.mercado === 'string' && /^[A-Z0-9]{8,16}$/.test(o.mercado) ? o.mercado : 'todos',
    gravedad,
    tema,
    soloStock: o.soloStock === true,
    busca: typeof o.busca === 'string' ? o.busca.slice(0, 120) : '',
  }
}

/* ------------------------------------------------------------------ */
/* Las cifras                                                          */
/* ------------------------------------------------------------------ */

export async function resumenDeCliente(
  amazonClientId: string,
  mercadoElegido = 'todos'
): Promise<RespuestaResumen> {
  try {
    const service = createServiceClient()
    const conexiones = await conexionesDeCliente(amazonClientId)
    if (conexiones.length === 0) return { ok: false, error: 'Este cliente no tiene ninguna cuenta de Amazon activa.' }
    const connIds = conexiones.map((c) => c.id)

    // ---- ¿está la tabla? ----
    const sonda = await service.from('listing_cumplimiento').select('id').limit(1)
    if (sonda.error) {
      if (isMissingSchema(sonda.error)) return { ok: false, faltaMigracion: true }
      return { ok: false, error: 'No se han podido leer las revisiones.' }
    }

    const base = (mercado: string) => {
      let q = service
        .from('listing_cumplimiento')
        .select('id', { count: 'exact', head: true })
        .in('connection_id', connIds)
        .eq('en_amazon', true)
      if (mercado !== 'todos') q = q.eq('marketplace_id', mercado)
      return q
    }
    const atencion = (mercado: string) => base(mercado).or('errores.gt.0,suprimido.eq.true')

    // ---- los países con listings, con su recuento ----
    const mercadosDeLaCuenta = [...new Set(conexiones.flatMap((c) => c.marketplace_ids))]
    const totalesPorMercado = await Promise.all(
      mercadosDeLaCuenta.map(async (id) => {
        const [tot, rev] = await Promise.all([
          service
            .from('amazon_listings')
            .select('id', { count: 'exact', head: true })
            .in('connection_id', connIds)
            .eq('marketplace_id', id),
          base(id),
        ])
        return { id, nombre: marketplaceLabel(id), total: tot.count ?? 0, revisados: rev.count ?? 0 }
      })
    )
    const mercados = totalesPorMercado.filter((m) => m.total > 0).sort((a, b) => b.total - a.total)

    const mercado = mercados.some((m) => m.id === mercadoElegido) ? mercadoElegido : 'todos'
    const enLoElegido = mercado === 'todos' ? mercados : mercados.filter((m) => m.id === mercado)

    const [conErrores, suprimidos, atn, soloAvisos, atnStock, ultima, temas] = await Promise.all([
      base(mercado).gt('errores', 0),
      base(mercado).eq('suprimido', true),
      atencion(mercado),
      base(mercado).gt('avisos', 0).eq('errores', 0).eq('suprimido', false),
      atencion(mercado).eq('con_stock', true),
      (() => {
        let q = service
          .from('listing_cumplimiento')
          .select('revisado_at')
          .in('connection_id', connIds)
          .order('revisado_at', { ascending: false })
          .limit(1)
        if (mercado !== 'todos') q = q.eq('marketplace_id', mercado)
        return q
      })(),
      Promise.all(TEMAS.map((t) => atencion(mercado).eq('tema', t))),
    ])

    return {
      ok: true,
      mercados,
      total: enLoElegido.reduce((n, m) => n + m.total, 0),
      revisados: enLoElegido.reduce((n, m) => n + m.revisados, 0),
      ultimaRevision: ((ultima.data ?? [])[0] as { revisado_at: string } | undefined)?.revisado_at ?? null,
      atencion: atn.count ?? 0,
      conErrores: conErrores.count ?? 0,
      suprimidos: suprimidos.count ?? 0,
      soloAvisos: soloAvisos.count ?? 0,
      atencionConStock: atnStock.count ?? 0,
      porTema: TEMAS.map((t, i) => ({ tema: t, n: temas[i].count ?? 0 })).filter((t) => t.n > 0),
    }
  } catch (e) {
    console.error('[cumplimiento] no se ha podido leer el resumen:', e)
    return { ok: false, error: 'No se han podido leer las revisiones.' }
  }
}

/* ------------------------------------------------------------------ */
/* La lista                                                            */
/* ------------------------------------------------------------------ */

/** El orden: lo que tiene stock primero, luego lo que está oculto, luego por errores */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ordenado(q: any): any {
  return q
    .order('con_stock', { ascending: false })
    .order('suprimido', { ascending: false })
    .order('errores', { ascending: false })
    .order('sku', { ascending: true })
    .order('marketplace_id', { ascending: true })
}

export async function paginaDeCliente(
  amazonClientId: string,
  filtros: FiltrosCumplimiento,
  pagina: number
): Promise<PaginaCumplimiento | { error: string }> {
  try {
    const conexiones = await conexionesDeCliente(amazonClientId)
    if (conexiones.length === 0) return { error: 'Este cliente no tiene ninguna cuenta de Amazon activa.' }
    const connIds = conexiones.map((c) => c.id)

    const desde = Math.max(0, Math.floor(pagina)) * TAMANO_PAGINA
    // Se pide una de más para saber si hay otra página sin contar todo
    const { data, error } = await ordenado(
      conFiltros(createServiceClient().from('listing_cumplimiento').select(COLUMNAS), connIds, filtros)
    ).range(desde, desde + TAMANO_PAGINA)
    if (error) throw error

    const filas = (data ?? []) as unknown as FilaCumplimiento[]
    return { filas: filas.slice(0, TAMANO_PAGINA), hayMas: filas.length > TAMANO_PAGINA }
  } catch (e) {
    console.error('[cumplimiento] no se ha podido leer la lista:', e)
    return { error: 'No se ha podido leer la lista.' }
  }
}

/**
 * TODAS las filas de un filtro, para el CSV. Con un tope: una lista de cien mil
 * filas no es algo que se mande a un cliente, y tampoco cabe en una respuesta.
 */
export const MAX_FILAS_EXPORTAR = 30_000

export async function todasLasFilas(
  amazonClientId: string,
  filtros: FiltrosCumplimiento
): Promise<{ filas: FilaCumplimiento[]; truncado: boolean } | { error: string }> {
  try {
    const conexiones = await conexionesDeCliente(amazonClientId)
    if (conexiones.length === 0) return { error: 'Este cliente no tiene ninguna cuenta de Amazon activa.' }
    const connIds = conexiones.map((c) => c.id)
    const service = createServiceClient()

    const filas: FilaCumplimiento[] = []
    for (let desde = 0; desde < MAX_FILAS_EXPORTAR; desde += 1000) {
      const { data, error } = await ordenado(
        conFiltros(service.from('listing_cumplimiento').select(COLUMNAS), connIds, filtros)
      ).range(desde, desde + 999)
      if (error) throw error
      const trozo = (data ?? []) as unknown as FilaCumplimiento[]
      filas.push(...trozo)
      if (trozo.length < 1000) return { filas, truncado: false }
    }
    return { filas, truncado: true }
  } catch (e) {
    console.error('[cumplimiento] no se ha podido leer para exportar:', e)
    return { error: 'No se ha podido leer la lista.' }
  }
}
