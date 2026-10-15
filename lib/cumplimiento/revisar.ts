import { createServiceClient } from '@/lib/supabase/service'
import { fetchAll } from '@/lib/supabase/paginacion'
import { connectionCredentials } from '@/lib/amazon/data'
import { AmazonApiError } from '@/lib/amazon/errors'
import { fetchIncidenciasPorSku, type AmazonCredentials } from '@/lib/amazon/sp-api'
import { leerTramos } from '@/lib/auditor-stock/paralelo'
import { mercadosDeConexion } from '@/lib/types/amazon'
import { conexionesDeCliente, type ConexionRevisable } from './conexiones'
import { FALTA_MIGRACION_CUMPLIMIENTO, hayTablaCumplimiento } from './esquema'
import { construirFilas, type Fila, type MetaListing } from './filas'
import {
  POLITICA_POR_DEFECTO,
  clave,
  elegirPendientes,
  huerfanas,
  type FilaPrevia,
  type FilaUniverso,
} from './pendientes'
import type { Incidencia } from './tipos'

/**
 * LA REVISIÓN DE CUMPLIMIENTO.
 * SOLO SERVIDOR. Lee de Amazon y escribe en `listing_cumplimiento`; no toca ni un
 * listing, ni un precio, ni un stock de nadie.
 *
 *
 * ============ UNA PASADA = LOS MÁS URGENTES, NO TODOS ============
 *
 * Amazon deja leer las incidencias de veinte SKU por llamada y el cupo se comparte
 * con el catálogo y con el auditor. Cada pasada elige con `elegirPendientes` los N
 * más urgentes (con stock y sin revisar primero; luego los que ya tienen problemas,
 * para enterarse pronto de que se han arreglado), los lee y los guarda. Lo que no
 * cabe espera a la siguiente. La primera vuelta a una cuenta grande tarda horas; lo
 * que ya está revisado no se pierde por cortar la pasada a medias, porque cada
 * tramo se guarda en cuanto se lee.
 *
 *
 * ============ UNA CUENTA CADA VEZ ============
 *
 * Todo cuelga de UNA conexión, que es de UN cliente. Aquí no se cruzan ni se
 * comparan datos de cuentas distintas: el bucle de `revisarTodos` solo las visita
 * una detrás de otra.
 *
 *
 * ============ QUÉ SE HACE CUANDO ALGO NO CUADRA ============
 *
 *   · Amazon no devuelve un SKU que le pedimos → se apunta `en_amazon = false` y no
 *     cuenta ni como limpio ni como con problemas.
 *   · Un tramo falla (autorización caducada, cupo agotado) → se para la pasada
 *     entera, se conserva lo leído y se dice por qué. Seguir con los demás tramos
 *     serían cientos de errores idénticos.
 *   · Se acaba el tiempo → igual: lo guardado se queda, la pasada es `parcial`.
 */

/** Cuánto se deja trabajar a la pasada del cron. La ruta admite 300 s */
export const PRESUPUESTO_MS = 200_000
/** Cuántos listings como máximo por cuenta y por pasada del cron */
export const MAX_SKUS_POR_PASADA = 4_000
/** «Revisar ahora»: menos, para contestar mientras alguien mira */
export const PRESUPUESTO_AHORA_MS = 90_000
export const MAX_SKUS_AHORA = 1_500

/** SKU por tramo: cinco llamadas. Es la granularidad con la que se mira el reloj */
const TRAMO = 100
/**
 * Pocos tramos a la vez, a diferencia del auditor: esta lectura no es urgente y
 * comparte cubo de fichas con el catálogo (cada quince minutos) y con el auditor.
 * Dos en vuelo dan unas 4 llamadas por segundo, que es lo que cabe sin hacerles
 * esperar.
 */
const CONCURRENCIA = 2
const TANDA_ESCRITURA = 200

/** UNA REVISIÓN A LA VEZ POR CUENTA. En memoria: hay un solo contenedor */
const enCurso = new Set<string>()

export function hayRevisionEnCurso(connectionIds: readonly string[]): boolean {
  return connectionIds.some((id) => enCurso.has(id))
}

export interface ResultadoRevision {
  estado: 'completa' | 'parcial' | 'error' | 'omitida'
  mensaje: string
  /** Listings que se eligió revisar */
  pedidos: number
  /** Listings que Amazon devolvió y se guardaron */
  leidos: number
  /** Los que Amazon no devolvió */
  noVinieron: number
  /** Devueltos SIN el campo de incidencias: se cuentan como limpios, y esto avisa si pasa en masa */
  sinCampo: number
  llamadas: number
  duracionMs: number
}

const vacio = (mensaje: string, estado: ResultadoRevision['estado']): ResultadoRevision => ({
  estado,
  mensaje,
  pedidos: 0,
  leidos: 0,
  noVinieron: 0,
  sinCampo: 0,
  llamadas: 0,
  duracionMs: 0,
})

export interface OpcionesRevision {
  presupuestoMs: number
  maxSkus: number
  /** «Revisar ahora»: no espera a que venza el plazo de los que tienen problemas ni de los limpios con stock */
  forzar?: boolean
  /** Cuándo empezó todo, para repartir el tiempo entre varias cuentas */
  inicio?: number
}

/* ------------------------------------------------------------------ */
/* Leer lo que hay                                                     */
/* ------------------------------------------------------------------ */

interface FilaEspejo {
  sku: string
  clasificacion_item: string | null
  is_fba: boolean | null
  quantity: number | null
  fba_quantity: number | null
  fba_fulfillable_quantity: number | null
}

/** ¿Tiene algo que vender? FBA, el stock de Amazon; FBM, el que declara el vendedor */
function tieneStock(f: FilaEspejo): boolean {
  const unidades = f.is_fba ? (f.fba_fulfillable_quantity ?? f.fba_quantity ?? 0) : (f.quantity ?? 0)
  return unidades > 0
}

async function leerUniverso(connectionId: string, mercado: string): Promise<FilaEspejo[]> {
  const service = createServiceClient()
  return fetchAll<FilaEspejo>((a, b) =>
    service
      .from('amazon_listings')
      .select('sku, clasificacion_item, is_fba, quantity, fba_quantity, fba_fulfillable_quantity')
      .eq('connection_id', connectionId)
      .eq('marketplace_id', mercado)
      // El SKU es único dentro de (conexión, marketplace): el orden ya termina en
      // columna única y .range() no repite ni se salta filas.
      .order('sku', { ascending: true })
      .range(a, b)
  )
}

type PreviaConId = FilaPrevia & { id: string }

async function leerPrevias(connectionId: string, mercado: string): Promise<PreviaConId[]> {
  const service = createServiceClient()
  const filas = await fetchAll<{
    id: string
    sku: string
    revisado_at: string
    en_amazon: boolean
    errores: number
    suprimido: boolean
  }>((a, b) =>
    service
      .from('listing_cumplimiento')
      .select('id, sku, revisado_at, en_amazon, errores, suprimido')
      .eq('connection_id', connectionId)
      .eq('marketplace_id', mercado)
      .order('id', { ascending: true })
      .range(a, b)
  )
  return filas.map((f) => ({
    id: f.id,
    mercado,
    sku: f.sku,
    revisadoAt: Date.parse(f.revisado_at),
    // Los avisos solos NO cuentan como «abierto»: son miles, y revisarlos cada 6 h
    // gastaría el cupo en lo que menos urge.
    abierto: f.errores > 0 || f.suprimido,
    enAmazon: f.en_amazon,
  }))
}

/* ------------------------------------------------------------------ */
/* Guardar                                                             */
/* ------------------------------------------------------------------ */

async function guardar(filas: Fila[]): Promise<void> {
  if (filas.length === 0) return
  const service = createServiceClient()
  for (let i = 0; i < filas.length; i += TANDA_ESCRITURA) {
    const { error } = await service
      .from('listing_cumplimiento')
      .upsert(filas.slice(i, i + TANDA_ESCRITURA), { onConflict: 'connection_id,marketplace_id,sku' })
    if (error) throw error
  }
}

async function borrarHuerfanas(ids: string[]): Promise<void> {
  const service = createServiceClient()
  for (let i = 0; i < ids.length; i += TANDA_ESCRITURA) {
    const { error } = await service
      .from('listing_cumplimiento')
      .delete()
      .in('id', ids.slice(i, i + TANDA_ESCRITURA))
    // No es motivo para parar la revisión: se reintenta en la siguiente pasada
    if (error) console.error('[cumplimiento] no se han podido quitar filas huérfanas:', error)
  }
}

/* ------------------------------------------------------------------ */
/* Un tramo                                                            */
/* ------------------------------------------------------------------ */

interface Contexto {
  connectionId: string
  creds: AmazonCredentials
  meta: Map<string, MetaListing>
  leidos: number
  noVinieron: number
  sinCampo: number
  llamadas: number
}

/**
 * Lee un tramo de SKU de un país, lo interpreta y lo guarda.
 *
 * Se guarda AQUÍ, tramo a tramo, y no al final: una pasada que se corta por falta
 * de tiempo o por un fallo de Amazon conserva todo lo que ya leyó.
 */
async function procesarTramo(ctx: Contexto, mercado: string, skus: string[]): Promise<void> {
  const service = createServiceClient()
  const { items, noVinieron, llamadas } = await fetchIncidenciasPorSku(ctx.creds, {
    marketplaceId: mercado,
    skus,
  })
  ctx.llamadas += llamadas

  // Las incidencias de la vez anterior, solo de los que tenían problemas: es lo
  // que permite conservar el «desde cuándo» de cada una.
  const ids = skus
    .map((s) => ctx.meta.get(clave(mercado, s)))
    .filter((m): m is MetaListing & { id: string } => !!m && m.abierto && m.id !== null)
    .map((m) => m.id)
  const previas = new Map<string, Incidencia[]>()
  if (ids.length > 0) {
    const { data } = await service.from('listing_cumplimiento').select('sku, incidencias').in('id', ids)
    for (const f of (data ?? []) as Array<{ sku: string; incidencias: Incidencia[] | null }>) {
      previas.set(f.sku, Array.isArray(f.incidencias) ? f.incidencias : [])
    }
  }

  const { devueltos, ausentes, sinCampo } = construirFilas({
    connectionId: ctx.connectionId,
    mercado,
    items,
    noVinieron,
    meta: ctx.meta,
    previas,
    ahora: new Date(),
  })
  ctx.sinCampo += sinCampo

  await guardar(devueltos)
  await guardar(ausentes)

  ctx.leidos += devueltos.length
  ctx.noVinieron += ausentes.length
}

const mensajeDe = (e: unknown) =>
  e instanceof AmazonApiError ? e.humanMessage : e instanceof Error ? e.message : 'Error desconocido'

/* ------------------------------------------------------------------ */
/* Una cuenta                                                          */
/* ------------------------------------------------------------------ */

export async function revisarConexion(
  conn: ConexionRevisable,
  opciones: OpcionesRevision
): Promise<ResultadoRevision> {
  // El cerrojo se pone ANTES de cualquier espera
  if (enCurso.has(conn.id)) return vacio('Ya hay una revisión de esta cuenta en marcha.', 'omitida')
  enCurso.add(conn.id)
  try {
    return await ejecutar(conn, opciones)
  } finally {
    enCurso.delete(conn.id)
  }
}

async function ejecutar(conn: ConexionRevisable, opciones: OpcionesRevision): Promise<ResultadoRevision> {
  const inicio = opciones.inicio ?? Date.now()

  // ANTES de gastar ni una llamada a Amazon
  if (!(await hayTablaCumplimiento())) throw new Error(FALTA_MIGRACION_CUMPLIMIENTO)

  const mercados = mercadosDeConexion(conn)
  if (mercados.length === 0) return vacio('Esta cuenta no tiene ningún país activo.', 'omitida')

  // ---------- 1. Qué hay y qué se sabe ----------
  const universo: FilaUniverso[] = []
  const previas: PreviaConId[] = []
  const meta = new Map<string, MetaListing>()

  const lecturas = await Promise.all(
    mercados.map(async (mercado) => ({
      mercado,
      espejo: await leerUniverso(conn.id, mercado),
      previas: await leerPrevias(conn.id, mercado),
    }))
  )
  for (const l of lecturas) {
    const porSku = new Map(l.previas.map((p) => [p.sku, p]))
    for (const f of l.espejo) {
      const conStock = tieneStock(f)
      universo.push({ mercado: l.mercado, sku: f.sku, conStock })
      const p = porSku.get(f.sku)
      meta.set(clave(l.mercado, f.sku), {
        conStock,
        esPadre: f.clasificacion_item === 'VARIATION_PARENT',
        id: p?.id ?? null,
        abierto: p?.abierto ?? false,
      })
    }
    previas.push(...l.previas)
  }

  if (universo.length === 0) {
    return vacio('Esta cuenta no tiene ningún listing en el catálogo del ERP: hay que lanzar antes el censo.', 'omitida')
  }

  // Las filas de listings que ya no están en el catálogo se quitan: inflan los totales
  const sobran = huerfanas(universo, previas)
  if (sobran.length > 0) await borrarHuerfanas(sobran.map((s) => s.id))

  // ---------- 2. Qué se revisa ----------
  const elegidos = elegirPendientes(
    universo,
    previas,
    { ahora: Date.now(), ...POLITICA_POR_DEFECTO, forzar: opciones.forzar },
    opciones.maxSkus
  )
  if (elegidos.length === 0) {
    return { ...vacio('Todo está al día: no hay nada que revisar todavía.', 'completa'), duracionMs: Date.now() - inicio }
  }

  // Por país, con el país que tiene lo más urgente primero. Dentro de cada uno se
  // conserva el orden de prioridad.
  const porPais = new Map<string, string[]>()
  for (const c of elegidos) {
    const lista = porPais.get(c.mercado) ?? []
    lista.push(c.sku)
    porPais.set(c.mercado, lista)
  }
  const tramos: Array<{ mercado: string; skus: string[] }> = []
  for (const [mercado, skus] of porPais) {
    for (let i = 0; i < skus.length; i += TRAMO) tramos.push({ mercado, skus: skus.slice(i, i + TRAMO) })
  }

  // ---------- 3. Leer de Amazon, mirando el reloj ----------
  const resueltas = await connectionCredentials(conn.id)
  if (!resueltas) throw new Error('Esa cuenta ya no está conectada.')

  const ctx: Contexto = {
    connectionId: conn.id,
    creds: resueltas.credentials,
    meta,
    leidos: 0,
    noVinieron: 0,
    sinCampo: 0,
    llamadas: 0,
  }

  const lectura = await leerTramos(
    tramos.length,
    (idx) => procesarTramo(ctx, tramos[idx].mercado, tramos[idx].skus),
    { concurrencia: CONCURRENCIA, limiteMs: opciones.presupuestoMs, inicio, mensajeDe }
  )

  const base = {
    pedidos: elegidos.length,
    leidos: ctx.leidos,
    noVinieron: ctx.noVinieron,
    sinCampo: ctx.sinCampo,
    llamadas: ctx.llamadas,
    duracionMs: Date.now() - inicio,
  }
  if (lectura.fallo !== null) {
    return { ...base, estado: ctx.leidos > 0 ? 'parcial' : 'error', mensaje: lectura.fallo }
  }
  if (lectura.sinTiempo) {
    return {
      ...base,
      estado: 'parcial',
      mensaje: `Se acabó el tiempo: se han revisado ${ctx.leidos + ctx.noVinieron} de ${elegidos.length}. El resto sigue en la cola.`,
    }
  }
  return {
    ...base,
    estado: 'completa',
    mensaje: `${ctx.leidos + ctx.noVinieron} listings revisados.`,
  }
}

/* ------------------------------------------------------------------ */
/* Un cliente, y todos                                                 */
/* ------------------------------------------------------------------ */

function sumar(a: ResultadoRevision, b: ResultadoRevision): ResultadoRevision {
  const orden = { error: 3, parcial: 2, completa: 1, omitida: 0 } as const
  const peor = orden[b.estado] > orden[a.estado] ? b : a
  return {
    estado: peor.estado,
    mensaje: peor.mensaje,
    pedidos: a.pedidos + b.pedidos,
    leidos: a.leidos + b.leidos,
    noVinieron: a.noVinieron + b.noVinieron,
    sinCampo: a.sinCampo + b.sinCampo,
    llamadas: a.llamadas + b.llamadas,
    duracionMs: a.duracionMs + b.duracionMs,
  }
}

/** Revisa las cuentas de UN cliente (casi siempre es una) */
export async function revisarCliente(
  amazonClientId: string,
  opciones: OpcionesRevision
): Promise<ResultadoRevision> {
  const conexiones = await conexionesDeCliente(amazonClientId)
  if (conexiones.length === 0) {
    return vacio('Este cliente no tiene ninguna cuenta de Amazon activa.', 'omitida')
  }
  let total = vacio('', 'omitida')
  for (const c of conexiones) {
    try {
      total = sumar(total, await revisarConexion(c, opciones))
    } catch (e) {
      total = sumar(total, vacio(mensajeDe(e), 'error'))
    }
  }
  return total
}

/**
 * La pasada del cron: todas las cuentas activas, una detrás de otra.
 *
 * El tiempo es de todas juntas. La cuenta por la que se empieza ROTA cada hora:
 * si siempre fuese la misma y gastase el presupuesto, las últimas no se revisarían
 * nunca.
 */
export async function revisarTodos(): Promise<ResultadoRevision & { cuentas: number; errores: number }> {
  const inicio = Date.now()
  const { data, error } = await createServiceClient()
    .from('amazon_connections')
    .select('id, marketplace_ids, marketplaces_activos')
    .eq('is_active', true)
    .eq('status', 'activa')
    .order('id', { ascending: true })
  if (error) throw error
  const conexiones = (data ?? []) as ConexionRevisable[]

  let total = vacio('', 'omitida')
  let errores = 0
  if (conexiones.length > 0) {
    const desde = Math.floor(Date.now() / 3_600_000) % conexiones.length
    const orden = [...conexiones.slice(desde), ...conexiones.slice(0, desde)]
    for (const c of orden) {
      if (Date.now() - inicio > PRESUPUESTO_MS) break
      try {
        const r = await revisarConexion(c, { presupuestoMs: PRESUPUESTO_MS, maxSkus: MAX_SKUS_POR_PASADA, inicio })
        if (r.estado === 'error') errores += 1
        total = sumar(total, r)
      } catch (e) {
        errores += 1
        console.error('[cumplimiento] una cuenta ha fallado:', mensajeDe(e))
      }
    }
  }
  return { ...total, duracionMs: Date.now() - inicio, cuentas: conexiones.length, errores }
}

/* ------------------------------------------------------------------ */
/* «Revisar ahora»                                                     */
/* ------------------------------------------------------------------ */

/** Cómo acabó la última revisión manual de cada cliente. En memoria: se pierde al reiniciar */
const ultimoManual = new Map<string, { at: string; resultado: ResultadoRevision }>()

export function ultimoResultadoManual(amazonClientId: string) {
  return ultimoManual.get(amazonClientId) ?? null
}

/**
 * Arranca una revisión de un cliente y CONTESTA EN SEGUIDA.
 *
 * Una revisión son uno o dos minutos y una petición HTTP abierta tanto tiempo la
 * corta cualquier proxy por el camino. La pantalla pregunta por el estado cada pocos
 * segundos hasta que termina. El proceso del servidor sigue vivo después de
 * contestar: es un Node normal en un contenedor, no una función que se congela.
 *
 * Fuerza los listings con problemas y los limpios con stock aunque no les toque
 * (`forzar`): es lo que se pulsa después de arreglar algo en Seller Central.
 */
export async function lanzarRevisionManual(
  amazonClientId: string
): Promise<{ iniciada: true } | { iniciada: false; motivo: string }> {
  const conexiones = await conexionesDeCliente(amazonClientId)
  if (conexiones.length === 0) {
    return { iniciada: false, motivo: 'Este cliente no tiene ninguna cuenta de Amazon activa.' }
  }
  if (hayRevisionEnCurso(conexiones.map((c) => c.id))) {
    return { iniciada: false, motivo: 'Ya hay una revisión en marcha.' }
  }
  if (!(await hayTablaCumplimiento())) return { iniciada: false, motivo: FALTA_MIGRACION_CUMPLIMIENTO }

  ultimoManual.delete(amazonClientId)
  const acabada = (resultado: ResultadoRevision) =>
    ultimoManual.set(amazonClientId, { at: new Date().toISOString(), resultado })

  // Sin await a propósito: ver arriba
  void revisarCliente(amazonClientId, {
    presupuestoMs: PRESUPUESTO_AHORA_MS,
    maxSkus: MAX_SKUS_AHORA,
    forzar: true,
  })
    .then(acabada)
    .catch((e) => {
      console.error('[cumplimiento] la revisión manual ha fallado:', mensajeDe(e))
      acabada(vacio(mensajeDe(e), 'error'))
    })
  return { iniciada: true }
}

/* ------------------------------------------------------------------ */
/* Un solo SKU                                                         */
/* ------------------------------------------------------------------ */

/**
 * Vuelve a mirar UN listing. Es lo que se pulsa tras arreglar algo en Seller
 * Central: una llamada, y el listing sale de la lista si Amazon ya lo da por bueno.
 *
 * Se busca el listing DENTRO de las cuentas del cliente, así que no se puede pedir
 * el de otro cliente con solo saber su SKU.
 */
export async function revisarUnSku(
  amazonClientId: string,
  mercado: string,
  sku: string
): Promise<{ ok: true; encontrado: boolean } | { ok: false; error: string }> {
  if (!(await hayTablaCumplimiento())) return { ok: false, error: FALTA_MIGRACION_CUMPLIMIENTO }

  const service = createServiceClient()
  const conexiones = await conexionesDeCliente(amazonClientId)
  for (const conn of conexiones) {
    const { data: fila } = await service
      .from('amazon_listings')
      .select('sku, clasificacion_item, is_fba, quantity, fba_quantity, fba_fulfillable_quantity')
      .eq('connection_id', conn.id)
      .eq('marketplace_id', mercado)
      .eq('sku', sku)
      .maybeSingle()
    if (!fila) continue

    const espejo = fila as FilaEspejo
    const { data: previa } = await service
      .from('listing_cumplimiento')
      .select('id')
      .eq('connection_id', conn.id)
      .eq('marketplace_id', mercado)
      .eq('sku', sku)
      .maybeSingle()

    const resueltas = await connectionCredentials(conn.id)
    if (!resueltas) return { ok: false, error: 'Esa cuenta ya no está conectada.' }

    const ctx: Contexto = {
      connectionId: conn.id,
      creds: resueltas.credentials,
      meta: new Map([
        [
          clave(mercado, sku),
          {
            conStock: tieneStock(espejo),
            esPadre: espejo.clasificacion_item === 'VARIATION_PARENT',
            id: (previa as { id: string } | null)?.id ?? null,
            // Siempre se traen sus incidencias anteriores, para conservar el «desde»
            abierto: true,
          },
        ],
      ]),
      leidos: 0,
      noVinieron: 0,
      sinCampo: 0,
      llamadas: 0,
    }
    try {
      await procesarTramo(ctx, mercado, [sku])
      return { ok: true, encontrado: ctx.leidos > 0 }
    } catch (e) {
      return { ok: false, error: mensajeDe(e) }
    }
  }
  return { ok: false, error: 'Ese listing no está en el catálogo de este cliente.' }
}
