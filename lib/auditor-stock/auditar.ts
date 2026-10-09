import { createServiceClient } from '@/lib/supabase/service'
import { fetchAll } from '@/lib/supabase/paginacion'
import { connectionCredentials } from '@/lib/amazon/data'
import { AmazonApiError } from '@/lib/amazon/errors'
import { fetchListingsBySku } from '@/lib/amazon/sp-api'
import { isMissingSchema, registrarEvento } from '@/lib/plataforma/eventos'
import {
  clasificar,
  diferencias,
  type Cambios,
  type DelEspejo,
  type FilaDetalle,
  type ItemVivo,
} from './clasificar'
import { leerTramos } from './paralelo'

/**
 * EL AUDITOR DE STOCK.
 * SOLO SERVIDOR. Lee de Amazon y escribe en `stock_auditorias`; no toca ni un
 * listing, ni un precio, ni un stock de nadie.
 *
 * Una pasada lee EN DIRECTO el stock de todos los listings de la cuenta y apunta
 * cuántos tienen y cuántos no, con la lista de los que sí.
 *
 *
 * ============ POR QUÉ NO BASTA CON EL ESPEJO DEL CATÁLOGO ============
 *
 * El ciclo de quince minutos refresca el espejo a razón de ~1.000 referencias
 * por pasada (searchListingsItems no pagina más), así que el stock que guarda de
 * un SKU concreto puede tener horas. Medido en ShoesF: 1.000 filas vistas en el
 * último cuarto de hora y el catálogo entero tardando varias horas en dar la
 * vuelta. Un auditor que se apoyara ahí vería el stock de hace tres horas y lo
 * llamaría «ahora».
 *
 * Así que se pregunta a Amazon por IDENTIFICADOR, veinte SKU por llamada. El
 * espejo se usa para una sola cosa: saber QUÉ SKU preguntar.
 *
 *
 * ============ LO QUE CUESTA, Y POR QUÉ SE LIMITA EL TIEMPO ============
 *
 * ~14.000 listings son ~700 llamadas. A 5 por segundo —el límite de Amazon—
 * serían unos 140 s, y eso es lo que se estimó. NO es lo que pasó: la primera
 * auditoría real leyó las llamadas una detrás de otra y fue a ~2 por segundo,
 * porque cada una espera los ~450 ms que tarda Amazon en contestar. 10.800
 * listings en 244 s, y se quedó a medias. Ahora van tres tramos en paralelo (ver
 * CONCURRENCIA). Es lo que hay que pagar por un dato en directo, y por eso la
 * cadencia se cambia desde Sistema y no está escrita aquí.
 *
 * Si Amazon va lento y se acaba el presupuesto, la pasada se PARA y se guarda
 * como `parcial`, con lo que se haya leído y marcada como tal. Lo que NO se hace
 * es seguir hasta el final y pisar la siguiente, ni guardar unas cifras a medias
 * como si fueran las de la cuenta entera: una auditoría que dice «2.000 con
 * stock» habiendo leído la mitad es un dato falso con aspecto de verdadero.
 */

/** ShoesF es el único cliente con auditor. Ver lib/growth/modulos */
export const SLUG_AUDITADO = 'shoesf'

/**
 * España, y solo España. El stock de ShoesF sale de un único almacén y es el
 * mismo número en todos los países, así que auditar los cuatro multiplicaría las
 * llamadas por cuatro para leer el mismo dato cuatro veces.
 */
export const MERCADO_AUDITADO = 'A1RKKUPIHCS9HS'

/**
 * Cuánto se deja trabajar a una pasada. La ruta admite 300 s y el último tramo
 * puede tardar: 240 deja margen para guardar y para que un tramo lento no
 * reviente el límite de la petición.
 */
export const PRESUPUESTO_MS = 240_000

/** SKU por tramo: cinco llamadas. Es la granularidad con la que se mira el reloj */
const TRAMO = 100

/**
 * CUÁNTOS TRAMOS SE LEEN A LA VEZ.
 *
 * La primera auditoría real se quedó a medias: 10.800 de 13.975 listings en 244 s.
 * Eran ~2 llamadas por segundo, y el límite de Amazon es 5. El cuello de botella
 * NO era el cupo sino la LATENCIA: leyendo las llamadas una detrás de otra, cada
 * una espera los ~450 ms que tarda Amazon en contestar y el ritmo es 1/0,45.
 *
 * Con tres tramos en vuelo la demanda pasa de 2 a unas 6 llamadas por segundo, y
 * el cubo de fichas (lib/amazon/throttle.ts) la recorta a 5 sin que haga falta
 * hacer nada: sirve las esperas EN ORDEN, así que pedir de más no se come el
 * límite, solo hace cola. No hay riesgo de pasarse; lo que sí hay es que durante
 * la pasada las demás lecturas de esta cuenta esperan su turno detrás.
 */
const CONCURRENCIA = 3

/** Cuánto se conserva. ~25 KB comprimidos por auditoría: unos 50 MB en régimen */
export const RETENCION_DIAS = 21

/**
 * Qué parte de los SKU puede no volver sin que la auditoría deje de ser
 * completa. Ver el comentario donde se usa. Un 3 % son unos 420 de 14.000.
 */
export const UMBRAL_NO_VINIERON = 0.03

/**
 * Cuántos SKU como máximo se guardan en cada lista de «entran» y «salen».
 *
 * Estaba en 500 y SE QUEDÓ CORTO LA PRIMERA VEZ QUE IMPORTÓ: una caída real de
 * 594 productos en diez minutos guardaba el recuento exacto (594) pero solo la
 * lista de los primeros 500, así que la pestaña «Salen (594)» enseñaba 500
 * filas. Un tope pensado para evitar abusos acababa recortando justo el caso
 * para el que existe el auditor.
 *
 * 5.000 es más de lo que puede haber: solo pueden «salir» los SKU que tenían
 * stock (unos 2.200 en ShoesF), así que en la práctica no corta nunca, y queda
 * como guarda contra un dato desbocado. Una lista de 2.200 son unos 80 KB, y
 * solo se guarda cuando de verdad ha pasado algo.
 */
const MAX_LISTA_CAMBIOS = 5000

/**
 * UNA PASADA A LA VEZ. En memoria del proceso, que aquí es suficiente: hay un
 * solo contenedor. Evita que el cron y el botón «Auditar ahora» lancen dos
 * lecturas del catálogo entero a la vez y se coman el cupo de Amazon.
 */
const enCurso = new Set<string>()

export function hayAuditoriaEnCurso(): boolean {
  return enCurso.size > 0
}

export interface ResultadoAuditoria {
  /** null si no se ha podido ni empezar (no hay cliente o cuenta) */
  id: string | null
  estado: 'completa' | 'parcial' | 'error' | 'omitida'
  mensaje: string
  conStock: number
  sinStock: number
  sinDato: number
  leidas: number
  skusPedidos: number
  duracionMs: number
  entran: number | null
  salen: number | null
}

const vacio = (mensaje: string, estado: ResultadoAuditoria['estado']): ResultadoAuditoria => ({
  id: null,
  estado,
  mensaje,
  conStock: 0,
  sinStock: 0,
  sinDato: 0,
  leidas: 0,
  skusPedidos: 0,
  duracionMs: 0,
  entran: null,
  salen: null,
})

/** El cliente y la conexión que se auditan */
export async function cuentaAuditada(): Promise<
  { clientId: string; connectionId: string; nombre: string } | { error: string }
> {
  const service = createServiceClient()
  const { data: cli } = await service
    .from('amazon_clients')
    .select('id, name')
    .eq('slug', SLUG_AUDITADO)
    .maybeSingle()
  if (!cli) return { error: 'No hay ningún cliente dado de alta con ese nombre.' }

  const { data: conns } = await service
    .from('amazon_connections')
    .select('id, status, is_active')
    .eq('client_id', (cli as { id: string }).id)
    .eq('is_active', true)
    .limit(1)
  const c = ((conns ?? []) as Array<{ id: string; status: string }>)[0]
  if (!c) return { error: 'Este cliente no tiene ninguna cuenta de Amazon conectada.' }
  if (c.status !== 'activa') return { error: 'La cuenta de Amazon de este cliente no está activa.' }

  return {
    clientId: (cli as { id: string }).id,
    connectionId: c.id,
    nombre: (cli as { name: string }).name,
  }
}

interface FilaEspejo {
  sku: string
  asin: string | null
  fba_fulfillable_quantity: number | null
  fba_quantity: number | null
}

/**
 * QUÉ SKU SE PREGUNTAN: los hijos del catálogo.
 *
 * Los PADRES DE VARIACIÓN se quedan fuera: son una agrupación, no se venden y
 * no tienen stock. Contarlos metería ~1.600 «sin stock» que no son productos.
 * Es el mismo criterio de «Sincronizar precio Min y Max».
 */
export async function universo(connectionId: string, marketplaceId: string): Promise<FilaEspejo[]> {
  const service = createServiceClient()
  return fetchAll<FilaEspejo>((a, b) =>
    service
      .from('amazon_listings')
      .select('sku, asin, fba_fulfillable_quantity, fba_quantity')
      .eq('connection_id', connectionId)
      .eq('marketplace_id', marketplaceId)
      .or('clasificacion_item.is.null,clasificacion_item.neq.VARIATION_PARENT')
      // El SKU es único dentro de (conexión, marketplace): el orden ya termina en
      // columna única y .range() no repite ni se salta filas.
      .order('sku', { ascending: true })
      .range(a, b)
  )
}

export async function auditar(
  marketplaceId: string = MERCADO_AUDITADO
): Promise<ResultadoAuditoria> {
  const cuenta = await cuentaAuditada()
  if ('error' in cuenta) return vacio(cuenta.error, 'error')

  // El cerrojo se pone ANTES de cualquier otra espera.
  if (enCurso.has(cuenta.connectionId)) {
    return vacio('Ya hay una auditoría en marcha: no se lanza otra encima.', 'omitida')
  }
  enCurso.add(cuenta.connectionId)

  // El `finally` envuelve la pasada ENTERA, no solo el último tramo. Antes se
  // liberaba en el `finally` del guardado, y cualquier cosa que lanzara entre
  // poner el cerrojo y llegar ahí lo dejaba puesto: el auditor se quedaba
  // «en curso» para siempre —el botón apagado y el cron saltándose cada pasada—
  // hasta que alguien reiniciara el contenedor.
  try {
    return await ejecutar(cuenta, marketplaceId)
  } finally {
    enCurso.delete(cuenta.connectionId)
  }
}

async function ejecutar(
  cuenta: { clientId: string; connectionId: string; nombre: string },
  marketplaceId: string
): Promise<ResultadoAuditoria> {
  const inicio = Date.now()
  const service = createServiceClient()

  let estado: 'completa' | 'parcial' | 'error' = 'completa'
  let error: string | null = null
  let skus: string[] = []
  const vivos = new Map<string, ItemVivo>()
  const espejo = new Map<string, DelEspejo>()
  /** Qué tramos han terminado, por posición. En paralelo no acaban en orden */
  const hechos: number[] = []
  const tramos: string[][] = []

  // ---------- 0. ¿Hay dónde guardarlo? ----------
  //
  // ANTES de gastar ni una llamada a Amazon. Las migraciones se lanzan a mano, y
  // el código puede llegar desplegado antes que la tabla: sin esta comprobación,
  // cada pasada del cron leería ~700 listings durante dos o tres minutos para
  // descubrir al final que no puede guardar nada, y lo repetiría cada quince
  // minutos hasta que alguien lanzara la migración.
  const sonda = await service.from('stock_auditorias').select('id').limit(1)
  if (sonda.error && isMissingSchema(sonda.error)) {
    throw new Error(
      'Falta lanzar la migración 220_auditor_stock.sql en el editor SQL de Supabase: ' +
        'no hay dónde guardar las auditorías, así que no se ha leído nada de Amazon.'
    )
  }

  try {
    // ---------- 1. Qué se pregunta ----------
    const filas = await universo(cuenta.connectionId, marketplaceId)
    skus = filas.map((f) => f.sku)
    for (const f of filas) {
      espejo.set(f.sku, {
        sku: f.sku,
        asin: f.asin,
        fbaCantidad: f.fba_fulfillable_quantity ?? f.fba_quantity ?? null,
      })
    }

    if (skus.length === 0) {
      estado = 'error'
      error =
        'No hay ningún listing de este país en el catálogo, así que no hay nada que auditar. ' +
        'Hay que lanzar antes el censo del catálogo.'
    } else {
      // ---------- 2. Leer de Amazon, mirando el reloj ----------
      const resueltas = await connectionCredentials(cuenta.connectionId)
      if (!resueltas) throw new Error('Esa cuenta ya no está conectada.')

      for (let i = 0; i < skus.length; i += TRAMO) tramos.push(skus.slice(i, i + TRAMO))

      const lectura = await leerTramos(
        tramos.length,
        async (idx) => {
          const { items } = await fetchListingsBySku(resueltas.credentials, {
            marketplaceId,
            skus: tramos[idx],
            // Solo el stock: sin las ofertas la respuesta pesa menos y tarda menos.
            incluir: ['summaries', 'fulfillmentAvailability'],
          })
          for (const it of items) {
            vivos.set(it.sku, {
              sku: it.sku,
              asin: it.asin,
              quantity: it.quantity,
              isFba: it.isFba,
            })
          }
        },
        {
          concurrencia: CONCURRENCIA,
          limiteMs: PRESUPUESTO_MS,
          inicio,
          mensajeDe: (e) =>
            e instanceof AmazonApiError
              ? e.humanMessage
              : e instanceof Error
                ? e.message
                : 'Error desconocido',
        }
      )
      hechos.push(...lectura.hechos)

      const leidosEnTotal = hechos.reduce((n, idx) => n + tramos[idx].length, 0)
      if (lectura.fallo !== null) {
        // Se guarda lo leído hasta aquí. Si ni un tramo salió, es un error; si
        // salieron algunos, es una auditoría parcial.
        error = lectura.fallo
        estado = hechos.length > 0 ? 'parcial' : 'error'
      } else if (lectura.sinTiempo) {
        estado = 'parcial'
        error =
          `Se acabó el tiempo: Amazon va más lento de lo normal y se han leído ` +
          `${leidosEnTotal.toLocaleString('es-ES')} de ${skus.length.toLocaleString('es-ES')}.`
      }
    }
  } catch (e) {
    estado = 'error'
    error = e instanceof Error ? e.message : 'Error desconocido'
  }

  // ---------- 3. El recuento ----------
  // Solo se cuentan los SKU que se llegaron a PEDIR: en una parcial, los que no
  // se pidieron no son «que no vinieron», son «que no se preguntaron».
  // Con tramos en paralelo los terminados NO son un prefijo de la lista: pueden
  // faltar uno del medio y estar hechos los de después. Se cuentan por tramo.
  const preguntados = [...hechos].sort((a, b) => a - b).flatMap((idx) => tramos[idx])
  const r = clasificar(preguntados, vivos, espejo)

  // UNA AUDITORÍA A LA QUE LE FALTAN MUCHOS SKU NO ES COMPLETA.
  //
  // Un SKU que se pide y Amazon no devuelve no cuenta ni como con stock ni como
  // sin stock: simplemente no está. Si faltan unos pocos —listings borrados que
  // el espejo todavía no ha quitado— es ruido. Si faltan cientos, lo normal es
  // que Amazon haya contestado a medias, y entonces el «con stock» sale más bajo
  // de lo que es: el auditor enseñaría una CAÍDA DE STOCK que no ha ocurrido, que
  // es justo lo que existe para detectar.
  if (estado === 'completa' && r.pedidos > 0 && r.noVinieron / r.pedidos > UMBRAL_NO_VINIERON) {
    estado = 'parcial'
    error =
      `Amazon no ha devuelto ${r.noVinieron.toLocaleString('es-ES')} de ` +
      `${r.pedidos.toLocaleString('es-ES')} listings (más del ${Math.round(UMBRAL_NO_VINIERON * 100)} %), ` +
      'así que el recuento sería más bajo que el real. Se guarda como parcial.'
  }

  // ---------- 4. Qué se movió ----------
  let cambios: Cambios | null = null
  if (estado === 'completa') {
    try {
      const { data } = await service
        .from('stock_auditorias')
        .select('detalle')
        .eq('connection_id', cuenta.connectionId)
        .eq('marketplace_id', marketplaceId)
        .eq('estado', 'completa')
        .order('creada_at', { ascending: false })
        .limit(1)
      const previa = ((data ?? []) as Array<{ detalle: FilaDetalle[] | null }>)[0]
      if (previa?.detalle) cambios = diferencias(previa.detalle, r.cantidades)
    } catch {
      // Sin la anterior no hay comparación, y eso no impide guardar esta.
    }
  }

  const duracionMs = Date.now() - inicio

  // ---------- 5. Se guarda ----------
  const fila = {
    client_id: cuenta.clientId,
    connection_id: cuenta.connectionId,
    marketplace_id: marketplaceId,
    duracion_ms: duracionMs,
    estado,
    error,
    skus_pedidos: skus.length,
    leidas: r.leidas,
    no_vinieron: r.noVinieron,
    con_stock: r.conStock,
    sin_stock: r.sinStock,
    sin_dato: r.sinDato,
    unidades: r.unidades,
    con_stock_fbm: r.conStockFbm,
    con_stock_fba: r.conStockFba,
    entran: cambios ? cambios.entran.length : null,
    salen: cambios ? cambios.salen.length : null,
    cambios: cambios
      ? {
          entran: cambios.entran.slice(0, MAX_LISTA_CAMBIOS),
          salen: cambios.salen.slice(0, MAX_LISTA_CAMBIOS),
        }
      : null,
    detalle: estado === 'error' ? null : r.detalle,
  }

  try {
    const { data, error: errInsert } = await service
      .from('stock_auditorias')
      .insert(fila)
      .select('id')
      .single()
    if (errInsert) throw errInsert

    // La limpieza no puede tumbar una auditoría que ya está guardada.
    const limite = new Date(Date.now() - RETENCION_DIAS * 86_400_000).toISOString()
    void service
      .from('stock_auditorias')
      .delete()
      .eq('connection_id', cuenta.connectionId)
      .lt('creada_at', limite)
      .then(({ error: e }) => {
        if (e) console.warn('[auditor-stock] no se ha podido limpiar lo antiguo:', e.message)
      })

    if (estado === 'error') {
      await registrarEvento({
        tipo: 'auditor_stock_fallo',
        severidad: 'error',
        clientId: cuenta.clientId,
        connectionId: cuenta.connectionId,
        marketplaceId,
        mensaje: `El auditor de stock de ${cuenta.nombre} no ha podido leer la cuenta: ${error}`,
      })
    }

    return {
      id: (data as { id: string }).id,
      estado,
      mensaje:
        estado === 'completa'
          ? `${r.conStock} con stock · ${r.sinStock} sin stock`
          : (error ?? 'No se ha completado'),
      conStock: r.conStock,
      sinStock: r.sinStock,
      sinDato: r.sinDato,
      leidas: r.leidas,
      skusPedidos: skus.length,
      duracionMs,
      entran: fila.entran,
      salen: fila.salen,
    }
  } catch (e) {
    if (isMissingSchema(e)) {
      throw new Error(
        'Falta lanzar la migración 220_auditor_stock.sql en el editor SQL de Supabase: ' +
          'la auditoría se ha hecho pero no hay dónde guardarla.'
      )
    }
    throw e
  }
}
