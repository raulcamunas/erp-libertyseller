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
  // SOLO avisos menores: algo en el JSON, pero nada que cuente (ver MENORES en incidencias.ts)
  else if (f.gravedad === 'menores') q = q.eq('errores', 0).eq('avisos', 0).eq('suprimido', false).neq('incidencias', '[]')
  // Cualquier incidencia, menores incluidas: lo que se pide al llegar desde un código o una tarea de «Hoy»
  else if (f.gravedad === 'cualquiera') q = q.neq('incidencias', '[]')
  else q = q.or('errores.gt.0,avisos.gt.0,suprimido.eq.true')
  // `temas` (todos los del listing) y no `tema` (solo el de su incidencia más grave):
  // un listing con un error de precio y un aviso de normativa TIENE un problema de
  // normativa, y quien filtra por normativa quiere verlo.
  if (f.tema !== 'todos') q = q.contains('temas', [f.tema])
  if (f.soloStock) q = q.eq('con_stock', true)
  // JSONB «contiene»: se pasa como texto porque postgrest-js convierte un array en un array de Postgres, no en JSON
  // Varios códigos (una tarea de «Hoy» junta varios): un OR de «contiene». Los códigos ya vienen validados
  // (letras, números y `_.:-`), así que no pueden romper la sintaxis del OR de PostgREST.
  const codigos = f.codigos && f.codigos.length > 0 ? f.codigos : f.codigo ? [f.codigo] : []
  if (codigos.length === 1) q = q.contains('incidencias', JSON.stringify([{ codigo: codigos[0] }]))
  else if (codigos.length > 1) q = q.or(codigos.map((c) => `incidencias.cs.${JSON.stringify([{ codigo: c }])}`).join(','))
  const b = limpiarBusqueda(f.busca)
  // `*` y no `%`: es el comodín de los filtros de PostgREST
  if (b) q = q.or(`sku.ilike.*${b}*,asin.ilike.*${b}*,titulo.ilike.*${b}*`)
  return q
}

export function filtrosValidos(x: unknown): FiltrosCumplimiento {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
  const gravedad: FiltrosCumplimiento['gravedad'] =
    o.gravedad === 'avisos' || o.gravedad === 'todo' || o.gravedad === 'menores' || o.gravedad === 'cualquiera' ? o.gravedad : 'atencion'
  const codigoValido = (c: unknown): c is string => typeof c === 'string' && /^[A-Za-z0-9_.:-]{1,40}$/.test(c)
  const tema = typeof o.tema === 'string' && (TEMAS as readonly string[]).includes(o.tema) ? (o.tema as Tema) : 'todos'
  return {
    mercado: typeof o.mercado === 'string' && /^[A-Z0-9]{8,16}$/.test(o.mercado) ? o.mercado : 'todos',
    gravedad,
    tema,
    soloStock: o.soloStock === true,
    busca: typeof o.busca === 'string' ? o.busca.slice(0, 120) : '',
    codigo: codigoValido(o.codigo) ? o.codigo : '',
    // Hasta 30: una tarea junta como mucho una decena. Uno que no sea válido se descarta, no tumba el filtro
    codigos: Array.isArray(o.codigos) ? [...new Set(o.codigos.filter(codigoValido))].slice(0, 30) : [],
  }
}

/* ------------------------------------------------------------------ */
/* Las cifras                                                          */
/* ------------------------------------------------------------------ */

/**
 * Las cifras de arriba de la lista. Primero con las funciones de la migración 297, que leen la tabla UNA vez agrupando
 * por país (3 consultas). Antes eran unos 35 recuentos por petición —dos por cada tema— y la pantalla los repetía cada
 * dos minutos mientras estaba abierta: con la base en Nano, eso se nota. Sin la 297, los recuentos de siempre.
 */
export async function resumenDeCliente(amazonClientId: string, mercadoElegido = 'todos'): Promise<RespuestaResumen> {
  try {
    const conexiones = await conexionesDeCliente(amazonClientId)
    if (conexiones.length === 0) return { ok: false, error: 'Este cliente no tiene ninguna cuenta de Amazon activa.' }
    const ids = conexiones.map((c) => c.id)
    const service = createServiceClient()
    const n = (v: unknown) => Number(v ?? 0) || 0

    const [cif, cat] = await Promise.all([
      service.rpc('cumplimiento_cifras', { p_conexiones: ids }),
      service.rpc('cumplimiento_catalogo', { p_conexiones: ids }),
    ])
    if (cif.error || cat.error) return await resumenPorRecuentos(amazonClientId, mercadoElegido)

    const porPais = new Map(((cif.data ?? []) as Array<Record<string, unknown>>).map((f) => [String(f.marketplace_id), f]))
    const mercados = ((cat.data ?? []) as Array<{ marketplace_id: string; total: number }>)
      .map((t) => {
        const id = t.marketplace_id
        const revisados = n(porPais.get(id)?.revisados)
        return { id, nombre: marketplaceLabel(id), total: Math.max(n(t.total), revisados), revisados }
      })
      .filter((m) => m.total > 0)
      .sort((a, b) => b.total - a.total)
    const mercado = mercados.some((m) => m.id === mercadoElegido) ? mercadoElegido : 'todos'
    const elegidos = [...porPais.entries()].filter(([id]) => mercado === 'todos' || id === mercado).map(([, f]) => f)
    const suma = (campo: string) => elegidos.reduce((t, f) => t + n(f[campo]), 0)
    const ultima = elegidos.map((f) => (f.ultima_revision as string | null) ?? '').sort().pop() || null

    const tem = await service.rpc('cumplimiento_temas', { p_conexiones: ids, p_mercado: mercado === 'todos' ? null : mercado })
    if (tem.error) return await resumenPorRecuentos(amazonClientId, mercadoElegido)
    const temas = ((tem.data ?? []) as Array<Record<string, unknown>>).filter((t) => (TEMAS as readonly string[]).includes(String(t.tema)))
    const serie = (campo: 'atencion' | 'todos') =>
      TEMAS.map((t) => ({ tema: t, n: n(temas.find((x) => x.tema === t)?.[campo]) })).filter((t) => t.n > 0)

    const enLoElegido = mercado === 'todos' ? mercados : mercados.filter((m) => m.id === mercado)
    return {
      ok: true,
      mercados,
      total: enLoElegido.reduce((t, m) => t + m.total, 0),
      revisados: suma('revisados'),
      ultimaRevision: ultima,
      atencion: suma('atencion'),
      conErrores: suma('con_errores'),
      suprimidos: suma('ocultos'),
      soloAvisos: suma('solo_avisos'),
      atencionConStock: suma('atencion_con_stock'),
      porTema: serie('atencion'),
      porTemaTodos: serie('todos'),
    }
  } catch (e) {
    console.error('[cumplimiento] no se ha podido leer el resumen:', e)
    return { ok: false, error: 'No se han podido leer las revisiones.' }
  }
}

/** El resumen a base de recuentos, como antes de la 297. Solo si faltan sus funciones */
async function resumenPorRecuentos(
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

    const [conErrores, suprimidos, atn, soloAvisos, atnStock, ultima, temas, temasTodos] = await Promise.all([
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
      Promise.all(TEMAS.map((t) => atencion(mercado).contains('temas', [t]))),
      // Con CUALQUIER incidencia, avisos incluidos: es donde está casi toda la normativa
      // (Amazon manda como aviso lo de la RAP y el GPSR hasta que bloquea)
      Promise.all(
        TEMAS.map((t) => base(mercado).or('errores.gt.0,avisos.gt.0,suprimido.eq.true').contains('temas', [t]))
      ),
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
      porTemaTodos: TEMAS.map((t, i) => ({ tema: t, n: temasTodos[i].count ?? 0 })).filter((t) => t.n > 0),
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
  pagina: number,
  /** Filas por página. La pantalla usa 100; el conector de Claude pide menos para no llenar el chat */
  tamano: number = TAMANO_PAGINA
): Promise<PaginaCumplimiento | { error: string }> {
  try {
    const conexiones = await conexionesDeCliente(amazonClientId)
    if (conexiones.length === 0) return { error: 'Este cliente no tiene ninguna cuenta de Amazon activa.' }
    const connIds = conexiones.map((c) => c.id)

    const desde = Math.max(0, Math.floor(pagina)) * tamano
    // Se pide una de más para saber si hay otra página sin contar todo
    const { data, error } = await ordenado(
      conFiltros(createServiceClient().from('listing_cumplimiento').select(COLUMNAS), connIds, filtros)
    ).range(desde, desde + tamano)
    if (error) throw error

    const filas = (data ?? []) as unknown as FilaCumplimiento[]
    return { filas: filas.slice(0, tamano), hayMas: filas.length > tamano }
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
