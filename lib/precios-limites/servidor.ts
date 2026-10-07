import { randomUUID } from 'node:crypto'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchAll } from '@/lib/supabase/paginacion'
import { connectionCredentials } from '@/lib/amazon/data'
import { AmazonApiError } from '@/lib/amazon/errors'
import { fetchOfertas, fijarLimitesPrecio } from '@/lib/amazon/sp-api'
import { AMAZON_MARKETPLACES } from '@/lib/types/amazon'
import { huellaDe, registrarEvento } from '@/lib/plataforma/eventos'
import { diagnosticar, tieneError, type Alcance } from './diagnostico'

/**
 * SINCRONIZAR PRECIO MÍNIMO Y MÁXIMO · LO QUE HACE EL SERVIDOR.
 * SOLO SERVIDOR. Esto ESCRIBE en la tienda de un cliente.
 *
 * Tres operaciones, y cada una es una petición distinta desde la pantalla:
 *
 *   candidatos   qué referencias hay que mirar, según el alcance elegido.
 *   leer         pregunta a Amazon la oferta de unos SKU y devuelve los que
 *                tienen el precio fuera de su rango.
 *   corregir     vuelve a leer ESOS SKU, recalcula y escribe.
 *
 *
 * ============ POR QUÉ HAY QUE LEER A AMAZON Y NO BASTA CON EL ESPEJO ============
 *
 * El precio mínimo y el máximo NO están en el espejo del catálogo: viven dentro
 * de `purchasable_offer` y solo se leen de Amazon, a veinte SKU por llamada. Un
 * catálogo de 15.000 referencias son 750 llamadas, así que el espejo se usa para
 * una sola cosa: ACOTAR qué SKU merece la pena preguntar. De ahí los alcances.
 *
 *
 * ============ POR QUÉ CORREGIR VUELVE A LEER ============
 *
 * El listing tiene fijación automática de precios, o sea que su precio SE MUEVE
 * mientras la pantalla está abierta. Entre que se escaneó y se pulsa «corregir»
 * pueden pasar minutos, y un mínimo calculado con el precio de hace diez minutos
 * es un mínimo equivocado.
 *
 * Así que corregir NO usa lo que la pantalla enseñó: recibe solo QUÉ SKU, vuelve
 * a leer su oferta y aplica la misma regla sobre el dato de ahora. Lo que se
 * escribe es siempre «el mínimo pasa a valer el precio que tiene en este
 * instante», y el resultado de cada fila dice qué había y qué ha quedado. Si
 * entre medias ya está arreglado —porque alguien lo hizo a mano— se salta.
 *
 * (En Precios Shoplamp se hace lo contrario —el precio viaja y se compara contra
 * lo recalculado— porque allí el precio sale de otro lado, de España. Aquí el
 * precio ES el dato de Amazon, así que no hay otra fuente con la que comparar.)
 */

export interface ConexionResuelta {
  connectionId: string
  nombre: string
}

/** La conexión activa de un cliente, comprobando que el país es uno de los suyos */
export async function resolverConexion(
  clientId: string,
  marketplaceId: string
): Promise<ConexionResuelta | { error: string; status: number }> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_connections')
    .select('id, name, status, is_active, marketplace_ids')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .limit(1)
  if (error) return { error: 'No se ha podido leer la cuenta de Amazon.', status: 502 }

  const c = ((data ?? []) as Array<{
    id: string
    name: string
    status: string
    marketplace_ids: string[] | null
  }>)[0]
  if (!c) return { error: 'Este cliente no tiene ninguna cuenta de Amazon conectada.', status: 404 }
  if (c.status !== 'activa') {
    return { error: 'La cuenta de Amazon de este cliente no está activa.', status: 400 }
  }
  if (!(c.marketplace_ids ?? []).includes(marketplaceId)) {
    return { error: 'Este cliente no nos ha autorizado a trabajar en ese país.', status: 400 }
  }
  if (!AMAZON_MARKETPLACES.some((m) => m.id === marketplaceId)) {
    return { error: 'País desconocido.', status: 400 }
  }
  return { connectionId: c.id, nombre: c.name }
}

/* ------------------------------------------------------------------ */
/* Candidatos                                                          */
/* ------------------------------------------------------------------ */

export interface Candidato {
  sku: string
  titulo: string | null
}

/**
 * Qué SKU merece la pena preguntarle a Amazon.
 *
 * LOS PADRES DE VARIACIÓN SE QUEDAN FUERA siempre: son una agrupación, no se
 * venden y no tienen oferta que pueda estar mal.
 *
 * Y SE EXIGE PRECIO EN EL ESPEJO: sin precio no hay oferta que comparar con su
 * rango, y preguntar por ellos es gastar cupo para recibir un «sin precio».
 */
export async function candidatos(
  connectionId: string,
  marketplaceId: string,
  alcance: Alcance
): Promise<Candidato[]> {
  const service = createServiceClient()

  const filas = await fetchAll<{ sku: string; title: string | null }>((a, b) => {
    let q = service
      .from('amazon_listings')
      .select('sku, title')
      .eq('connection_id', connectionId)
      .eq('marketplace_id', marketplaceId)
      .not('price', 'is', null)
      .or('clasificacion_item.is.null,clasificacion_item.neq.VARIATION_PARENT')

    if (alcance === 'sin_comprar') {
      // Visible pero no comprable: es como Amazon deja un listing con el precio
      // fuera de rango. Ver ALCANCES en diagnostico.ts.
      q = q.contains('listing_status', ['DISCOVERABLE']).not('listing_status', 'cs', '{BUYABLE}')
    } else if (alcance === 'con_stock') {
      q = q.gt('quantity', 0)
    }
    // 'todo': sin más filtro.

    // El SKU es único dentro de (conexión, marketplace): el orden ya termina en
    // columna única y .range() no repite ni se salta filas.
    return q.order('sku', { ascending: true }).range(a, b)
  })

  return filas.map((f) => ({ sku: f.sku, titulo: f.title }))
}

/* ------------------------------------------------------------------ */
/* Leer                                                                */
/* ------------------------------------------------------------------ */

export interface FilaConError {
  sku: string
  precio: number
  moneda: string | null
  minimo: number | null
  maximo: number | null
  /** Lo que quedaría. null = ese límite no se toca */
  minimoNuevo: number | null
  maximoNuevo: number | null
  /** Fracción: 0,25 = el precio está un 25 % fuera de su límite */
  desvio: number
  estado: string
}

export interface ResultadoLeer {
  leidas: number
  correctas: number
  sinPrecio: number
  /** SKU que Amazon no ha devuelto: listings borrados, normalmente */
  noVinieron: number
  errores: FilaConError[]
}

export async function leer(
  connectionId: string,
  marketplaceId: string,
  skus: string[]
): Promise<ResultadoLeer | { error: string; status: number }> {
  const resueltas = await connectionCredentials(connectionId)
  if (!resueltas) return { error: 'Esa cuenta ya no está conectada.', status: 404 }

  const { ofertas, noVinieron } = await fetchOfertas(resueltas.credentials, { marketplaceId, skus })

  const out: ResultadoLeer = {
    leidas: ofertas.length,
    correctas: 0,
    sinPrecio: 0,
    noVinieron: noVinieron.length,
    errores: [],
  }

  for (const o of ofertas) {
    const d = diagnosticar(o)
    if (d.estado === 'sin_precio') out.sinPrecio += 1
    else if (!tieneError(d)) out.correctas += 1
    else {
      out.errores.push({
        sku: o.sku,
        precio: o.precio as number,
        moneda: o.moneda,
        minimo: o.precioMinimo,
        maximo: o.precioMaximo,
        minimoNuevo: d.minimoNuevo,
        maximoNuevo: d.maximoNuevo,
        desvio: d.desvio,
        estado: d.estado,
      })
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Corregir                                                            */
/* ------------------------------------------------------------------ */

export interface ResultadoFila {
  sku: string
  estado: 'aceptado' | 'invalido' | 'error' | 'omitido'
  mensaje: string | null
  precio: number | null
  minimoAntes: number | null
  maximoAntes: number | null
  /** Lo que ha quedado (o quedaría, si se simuló). null = no se ha tocado */
  minimoDespues: number | null
  maximoDespues: number | null
}

export interface ResultadoCorregir {
  simulado: boolean
  batchId: string
  resultados: ResultadoFila[]
  /** Si se cortó el lote antes de terminar, por qué */
  abortReason: string | null
}

export async function corregir(args: {
  clientId: string
  connectionId: string
  marketplaceId: string
  skus: string[]
  simular: boolean
  userId: string | null
}): Promise<ResultadoCorregir | { error: string; status: number }> {
  const { connectionId, marketplaceId, skus, simular } = args
  const service = createServiceClient()

  const resueltas = await connectionCredentials(connectionId)
  if (!resueltas) return { error: 'Esa cuenta ya no está conectada.', status: 404 }
  if (resueltas.connection.status !== 'activa' || !resueltas.connection.is_active) {
    return { error: 'Esta cuenta no está activa, así que no se puede escribir en ella.', status: 400 }
  }

  // El tipo de producto y el canal, que Amazon exige en cada cambio y que solo
  // están en el espejo.
  const espejo = new Map<string, { productType: string | null; canal: string | null }>()
  const { data: filasEspejo, error: errEspejo } = await service
    .from('amazon_listings')
    .select('sku, product_type, fulfillment_channel_code')
    .eq('connection_id', connectionId)
    .eq('marketplace_id', marketplaceId)
    .in('sku', skus)
  if (errEspejo) {
    return { error: `No se ha podido leer el catálogo (${errEspejo.message}). No se ha enviado nada.`, status: 502 }
  }
  for (const l of (filasEspejo ?? []) as Array<{
    sku: string
    product_type: string | null
    fulfillment_channel_code: string | null
  }>) {
    espejo.set(l.sku, { productType: l.product_type, canal: l.fulfillment_channel_code })
  }

  // LA OFERTA DE AHORA. Ver la cabecera: lo que se escribe sale de aquí y no de
  // lo que enseñó la pantalla.
  const { ofertas } = await fetchOfertas(resueltas.credentials, { marketplaceId, skus })
  const porSku = new Map(ofertas.map((o) => [o.sku, o]))

  const moneda =
    AMAZON_MARKETPLACES.find((m) => m.id === marketplaceId)?.currency ?? 'EUR'
  const batchId = randomUUID()
  const resultados: ResultadoFila[] = []
  let abortReason: string | null = null

  for (const sku of skus) {
    const oferta = porSku.get(sku)
    const vacia: ResultadoFila = {
      sku,
      estado: 'omitido',
      mensaje: null,
      precio: oferta?.precio ?? null,
      minimoAntes: oferta?.precioMinimo ?? null,
      maximoAntes: oferta?.precioMaximo ?? null,
      minimoDespues: null,
      maximoDespues: null,
    }

    if (!oferta) {
      resultados.push({ ...vacia, mensaje: 'Amazon ya no devuelve este listing.' })
      continue
    }

    const d = diagnosticar(oferta)
    if (!tieneError(d)) {
      resultados.push({
        ...vacia,
        mensaje:
          d.estado === 'sin_precio'
            ? 'No tiene precio, así que no hay nada que copiar.'
            : 'Ya no tenía error: alguien lo había arreglado.',
      })
      continue
    }

    const e = espejo.get(sku)
    if (!e?.productType) {
      resultados.push({
        ...vacia,
        mensaje: 'No conocemos su tipo de producto y Amazon lo exige en cada cambio.',
      })
      continue
    }

    try {
      const res = await fijarLimitesPrecio(
        resueltas.credentials,
        {
          sku,
          marketplaceId,
          productType: e.productType,
          fulfillmentChannelCode: e.canal,
        },
        {
          precio: oferta.precio as number,
          currency: oferta.moneda ?? moneda,
          minimo: d.minimoNuevo,
          maximo: d.maximoNuevo,
          validateOnly: simular,
        }
      )
      const aceptado = res.status === 'aceptado'
      resultados.push({
        ...vacia,
        estado: res.status,
        mensaje: res.message,
        minimoDespues: aceptado ? (d.minimoNuevo ?? oferta.precioMinimo) : null,
        maximoDespues: aceptado ? (d.maximoNuevo ?? oferta.precioMaximo) : null,
      })
    } catch (error) {
      const humano = error instanceof AmazonApiError ? error.humanMessage : null
      resultados.push({
        ...vacia,
        estado: 'error',
        mensaje: humano ?? (error instanceof Error ? error.message : 'Error desconocido'),
      })
      // La autorización ya no vale o faltan permisos: no es el fallo de UN
      // listing sino el de la conexión entera, y seguir mandando los demás son
      // cientos de errores idénticos y cientos de canjes de token fallidos.
      if (error instanceof AmazonApiError && (error.kind === 'auth' || error.kind === 'permisos')) {
        abortReason = humano ?? 'Amazon ha rechazado la autorización de esta cuenta.'
        break
      }
    }
  }

  // QUEDA CONSTANCIA, con el antes y el después de cada fila. Una simulación no
  // es un cambio y no se registra. Es un evento y no una fila de
  // amazon_submissions porque esa tabla solo conoce los campos precio y
  // cantidad: sumarle «límites» obligaría a tocar su CHECK, o sea a una
  // migración, y el evento guarda lo mismo —quién, cuándo, qué había y qué
  // quedó— sin ella.
  if (!simular) {
    const hechas = resultados.filter((r) => r.estado === 'aceptado')
    if (hechas.length > 0 || abortReason) {
      await registrarEvento({
        tipo: 'limites_precio',
        severidad: abortReason ? 'error' : 'info',
        clientId: args.clientId,
        connectionId,
        marketplaceId,
        huella: huellaDe('limites_precio', connectionId, marketplaceId, batchId),
        createdBy: args.userId,
        mensaje:
          `Límites de precio corregidos: ${hechas.length} listings ` +
          `(${resultados.length - hechas.length} sin cambiar).` +
          (abortReason ? ` Se cortó: ${abortReason}` : ''),
        detalle: {
          batchId,
          filas: hechas.slice(0, 300).map((r) => ({
            sku: r.sku,
            precio: r.precio,
            minimoAntes: r.minimoAntes,
            minimoDespues: r.minimoDespues,
            maximoAntes: r.maximoAntes,
            maximoDespues: r.maximoDespues,
          })),
        },
      })
    }
  }

  return { simulado: simular, batchId, resultados, abortReason }
}
