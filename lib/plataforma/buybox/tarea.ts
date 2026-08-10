/**
 * PLATAFORMA · MÓDULO A2 — LA TAREA «PRECIOS Y BUY BOX»
 * =====================================================
 * SOLO SERVIDOR. A2 SOLO LEE Y DIAGNOSTICA: aquí no se le escribe ni un precio a
 * Amazon.
 *
 * Corre sobre el motor de trabajos de A1 (lib/plataforma/motor.ts): por lotes,
 * con el progreso guardado después de cada uno y reanudable en la pasada
 * siguiente. No monta ninguna cola propia.
 *
 *
 * ============ LAS TRES FASES, Y POR QUÉ SON TRES Y NO UNA ============
 *
 * Un solo trabajo con tres fases encadenadas, y la fase va DENTRO DEL CURSOR
 * (`ofertas|SKU-123`), que es lo que hace que reanudar sea gratis: el motor
 * guarda el cursor tal cual y en la pasada siguiente se sabe la fase y el punto.
 *
 *   1. OFERTAS      · getListingOffersBatch, 20 SKU por llamada, una cada 2 s.
 *                     El barrido COMPLETO del ámbito, todas las noches: 23
 *                     minutos para 13.700 referencias. De aquí sale quién tiene
 *                     la oferta destacada, a qué precio, con qué canal, cuántos
 *                     competidores y hasta dónde han bajado.
 *
 *   2. FOEP         · getFeaturedOfferExpectedPriceBatch, 40 SKU por llamada,
 *                     UNA CADA TREINTA SEGUNDOS. NO barre el catálogo entero:
 *                     primero la cola —los SKU que la fase 1 ha visto perder la
 *                     oferta destacada— y después la rotación. Ver rotacion.ts.
 *
 *   3. DIAGNÓSTICO  · ni una llamada a Amazon. Cruza la última lectura de
 *                     ofertas con el último FOEP conocido (que puede ser de otra
 *                     noche, y el veredicto lo dice) y con el stock, y escribe el
 *                     veredicto con su porqué.
 *
 * EL ORDEN NO ES INTERCAMBIABLE. La fase 2 necesita saber quién perdió la Buy
 * Box, y eso lo descubre la 1. La fase 3 necesita las dos.
 *
 *
 * ============ POR QUÉ EL DIAGNÓSTICO ES UNA FASE Y NO VA DENTRO DE LA 1 ============
 *
 * Porque el FOEP de un SKU puede ser de hace seis días —es el precio de que la
 * ventana nocturna quepa— y diagnosticar dentro de la fase 1 usaría el techo de
 * anteayer sin llegar a mirar el de esta misma noche, que la fase 2 está a punto
 * de traer. Separarlas cuesta un recorrido más del catálogo, que no gasta ni una
 * ficha de cupo, y a cambio el veredicto usa siempre el dato más fresco que
 * existe.
 */

import { conexionDeTrabajo, marketplaceDeTrabajo } from '../amazon/conexion'
import { type AmbitoCatalogo } from '../catalogo'
import type { UnidadDeTrabajo } from '../datos'
import type { ContextoTarea, CuentasJob, Lote, ResultadoLote, Tarea } from '../motor'
import { MAX_SKUS_FOEP, MAX_SKUS_OFERTAS, leerFoep, leerOfertas } from './api'
import {
  colaFoepPendiente,
  configDelMotor,
  configDeCliente,
  contarSkus,
  encolarFoep,
  insertarDiagnosticos,
  insertarSnapshots,
  listingsDeSkus,
  marcarColaServida,
  siguientesSkus,
  stockPorSku,
  ultimosPorSku,
  type ConfigBuyBox,
  type DiagnosticoNuevo,
  type ListingBuyBox,
  type SnapshotNuevo,
} from './datos'
import {
  diagnosticar,
  FOEP_NO_CONSULTADO,
  type EntradaDiagnostico,
  type LecturaFoep,
  type LecturaOfertas,
  type MargenAlFoep,
} from './diagnostico'
import { leerLoteFoep, leerLoteOfertas, type FalloElemento } from './lectura'
import { diaDeRotacion, leTocaFoep } from './rotacion'
import { STOCK_DESCONOCIDO, type CanalOferta, type EstadoStock } from './tipos'

/* ------------------------------------------------------------------ */
/* Constantes de tamaño                                                */
/* ------------------------------------------------------------------ */

/** Cuántos SKU se diagnostican de golpe. No hay llamadas a Amazon: es barato */
const LOTE_DIAGNOSTICO = 200

/**
 * Cuántas filas del catálogo se escanean como mucho por lote buscando a quién le
 * toca el FOEP.
 *
 * Con rotación de 7 días, uno de cada siete SKU entra: para llenar un lote de 40
 * hacen falta unos 280 escaneados. El tope de 3.000 cubre rotaciones de hasta 70
 * días sin quedarse corto, y evita que un lote se coma la pasada entera cuando
 * el ámbito es un subconjunto pequeño donde casi nadie encaja.
 */
const MAX_ESCANEO_ROTACION = 3000

/** Página de lectura del catálogo mientras se busca a quién le toca */
const PAGINA_ESCANEO = 500

/**
 * Cuántos días atrás se miran las lecturas al diagnosticar.
 *
 * Tiene que cubrir de sobra la rotación del FOEP: con 7 días de rotación, un
 * FOEP legítimo puede tener 7. Se coge el doble más margen para que un barrido
 * que se saltó una noche no deje el catálogo entero «sin FOEP».
 */
function ventanaLecturas(config: ConfigBuyBox): number {
  return Math.max(3, config.foepRotacionDias * 2 + 2)
}

/** A partir de cuántos fallos del mismo tipo en un lote se levanta un evento */
const FALLOS_QUE_PREOCUPAN = 3

/* ------------------------------------------------------------------ */
/* El cursor: fase + clave (+ cuántos FOEP van)                        */
/* ------------------------------------------------------------------ */

export type Fase = 'ofertas' | 'foep' | 'diagnostico'

export interface Cursor {
  fase: Fase
  /** El último SKU tratado en esta fase. '' = por el principio */
  clave: string
  /** Solo en la fase de FOEP: cuántos SKU llevan techo pedido esta noche */
  foepHechos: number
  /** Solo en la fase de FOEP: si la cola ya se ha vaciado */
  colaVacia: boolean
}

const CURSOR_INICIAL: Cursor = { fase: 'ofertas', clave: '', foepHechos: 0, colaVacia: false }

/**
 * El cursor va como texto porque la columna del motor es TEXT y porque así se
 * puede leer de un vistazo en la pantalla de trabajos: «foep|ZAP-0042|360|1» se
 * entiende sin abrir nada.
 */
export function leerCursor(crudo: string | null): Cursor {
  if (!crudo) return { ...CURSOR_INICIAL }
  const partes = crudo.split('|')
  const fase = partes[0]
  if (fase !== 'ofertas' && fase !== 'foep' && fase !== 'diagnostico') {
    // Un cursor que no entendemos NO se interpreta a medias: se empieza de cero.
    // Repetir un barrido es inofensivo —la serie es de solo inserción y dos
    // observaciones del mismo minuto son dos datos correctos— y adivinar una
    // fase equivocada se saltaría medio catálogo en silencio.
    return { ...CURSOR_INICIAL }
  }
  return {
    fase,
    clave: partes[1] ?? '',
    foepHechos: Number(partes[2]) || 0,
    colaVacia: partes[3] === '1',
  }
}

export function escribirCursor(cursor: Cursor): string {
  return `${cursor.fase}|${cursor.clave}|${cursor.foepHechos}|${cursor.colaVacia ? '1' : '0'}`
}

/* ------------------------------------------------------------------ */
/* Contexto del trabajo                                                */
/* ------------------------------------------------------------------ */

interface Entorno {
  unidad: UnidadDeTrabajo
  credenciales: Awaited<ReturnType<typeof conexionDeTrabajo>>['credenciales']
  sellingPartnerId: string
  nombreConexion: string
  config: ConfigBuyBox
  ambito: AmbitoCatalogo
}

/**
 * La caché del entorno, por trabajo.
 *
 * Un trabajo hace decenas de lotes por pasada y cada uno necesita las
 * credenciales y la configuración. Sin caché serían decenas de lecturas de la
 * fila que contiene el token cifrado, que es justo la fila que menos veces
 * conviene leer. Se limpia al terminar la pasada (el proceso vive poco) y por
 * `olvidarEntorno()` cuando alguien cambia la configuración.
 */
const entornos = new Map<string, Entorno>()

export function olvidarEntorno(jobId?: string): void {
  if (jobId) entornos.delete(jobId)
  else entornos.clear()
}

async function entornoDe(ctx: ContextoTarea): Promise<Entorno> {
  const guardado = entornos.get(ctx.job.id)
  if (guardado) return guardado

  const conexion = await conexionDeTrabajo(ctx.job.connection_id)
  const marketplaceId = marketplaceDeTrabajo(conexion, ctx.job.marketplace_id)
  const config = await configDeCliente(ctx.job.client_id)

  const parametros = ctx.job.parametros ?? {}
  const pedido = parametros.soloActivos
  const entorno: Entorno = {
    unidad: {
      connectionId: ctx.job.connection_id as string,
      sellingPartnerId: conexion.sellingPartnerId,
      marketplaceId,
    },
    credenciales: conexion.credenciales,
    sellingPartnerId: conexion.sellingPartnerId,
    nombreConexion: conexion.nombre,
    config,
    ambito: {
      skusFiltro: ctx.job.skus_filtro,
      /**
       * TODO EL CATÁLOGO CON STOCK, no el subconjunto en seguimiento.
       *
       * Antes esto iba a `soloActivos: true` por miedo al cupo, y el miedo
       * estaba mal calibrado: la fase 1 —que es la que contesta «¿gano la Buy
       * Box?»— usa getListingOffersBatch, que va a 20 SKU cada dos segundos.
       * Son 4 min 22 s para las 2.620 referencias de Shoplamp y 22 min para las
       * 13.700 de ShoesF. Cabe de sobra cada cuarto de hora.
       *
       * Lo caro de este trabajo es el FOEP —una petición cada treinta
       * segundos—, y ese NO barre el ámbito: va por cola y rotación con su
       * propio tope. O sea que abrir el ámbito abarata nada y cubre todo.
       *
       * `soloConStock` en vez de `soloActivos` porque un SKU sin existencias no
       * es elegible para la oferta destacada: preguntar si la gana es preguntar
       * por algo que no puede pasar. El seguimiento sigue mandando cuando el
       * trabajo lo pide expresamente (`soloActivos` en los parámetros), que es
       * lo que hace el lanzamiento a mano sobre un subconjunto.
       */
      soloActivos: typeof pedido === 'boolean' ? pedido : false,
      soloConStock: parametros.soloConStock !== false,
    },
  }
  entornos.set(ctx.job.id, entorno)
  return entorno
}

/** ¿Se ha pedido saltarse el FOEP en este trabajo? */
function foepApagado(ctx: ContextoTarea): boolean {
  return (ctx.job.parametros ?? {}).foep === false
}

/** ¿Se ha pedido el FOEP de TODO el ámbito, sin rotación? */
function foepCompleto(ctx: ContextoTarea): boolean {
  return (ctx.job.parametros ?? {}).foep === 'todos'
}

/* ------------------------------------------------------------------ */
/* La tarea                                                            */
/* ------------------------------------------------------------------ */

export const tareaSnapshotPrecios: Tarea = {
  tipo: 'snapshot_precios',
  etiqueta: 'Precios y Buy Box',
  /** Veinte: el máximo de getListingOffersBatch. Las otras dos fases devuelven
      más claves por lote y eso es correcto: el motor no impone el tamaño, lo
      propone */
  tamanoLote: MAX_SKUS_OFERTAS,

  async preparar(ctx) {
    const entorno = await entornoDe(ctx)
    const skus = await contarSkus(entorno.unidad, entorno.ambito)

    if (skus === 0) {
      await ctx.evento({
        tipo: 'buybox_sin_skus',
        severidad: 'aviso',
        mensaje:
          'No hay ninguna referencia en el ámbito de este trabajo, así que no hay nada que ' +
          'consultar. Si esperabas lo contrario: o el catálogo está vacío (lanza antes el censo) ' +
          'o el criterio de «SKU en seguimiento» de este cliente no deja pasar nada.',
      })
      return { totalEstimado: 0 }
    }

    // El total cuenta LOS TRES RECORRIDOS, porque el motor suma los procesados
    // de las tres fases en el mismo contador. Con solo los SKU, la barra llegaría
    // al 100 % al acabar las ofertas y seguiría trabajando dos fases más, que es
    // peor que una barra que avanza despacio.
    const conFoep = foepApagado(ctx)
      ? 0
      : foepCompleto(ctx)
        ? skus
        : Math.ceil(skus / Math.max(1, entorno.config.foepRotacionDias))

    return { totalEstimado: skus + conFoep + skus }
  },

  async siguienteLote(ctx, cursorCrudo, tamano): Promise<Lote> {
    const entorno = await entornoDe(ctx)
    const cursor = leerCursor(cursorCrudo)

    /* ---------------- Fase 1 · Ofertas ---------------- */
    if (cursor.fase === 'ofertas') {
      const tramo = await siguientesSkus(
        entorno.unidad,
        cursor.clave || null,
        tamano,
        entorno.ambito
      )
      if (tramo.listings.length === 0) {
        // Fase agotada. Un lote VACÍO con `hayMas` en true es lo que el motor
        // entiende como «este tramo no tenía nada, sigue por el cursor
        // siguiente»: avanza sin procesar y vuelve a llamar aquí ya en la fase
        // nueva. Es el cambio de fase más barato posible.
        return {
          claves: [],
          cursorSiguiente: escribirCursor({ ...CURSOR_INICIAL, fase: 'foep' }),
          hayMas: true,
        }
      }
      return {
        claves: tramo.listings.map((l) => l.sku),
        cursorSiguiente: escribirCursor({ ...cursor, clave: tramo.ultimo ?? cursor.clave }),
        hayMas: true,
      }
    }

    /* ---------------- Fase 2 · FOEP ---------------- */
    if (cursor.fase === 'foep') {
      if (foepApagado(ctx)) {
        return {
          claves: [],
          cursorSiguiente: escribirCursor({ ...CURSOR_INICIAL, fase: 'diagnostico' }),
          hayMas: true,
        }
      }

      const tope = entorno.config.foepMaxPorNoche
      if (tope !== null && cursor.foepHechos >= tope) {
        await ctx.evento({
          tipo: 'buybox_tope_foep',
          severidad: 'info',
          mensaje:
            `Se ha alcanzado el tope de ${tope} referencias con FOEP por noche configurado para ` +
            'este cliente. El resto espera a la rotación siguiente; las lecturas de ofertas y el ' +
            'diagnóstico continúan.',
        })
        return {
          claves: [],
          cursorSiguiente: escribirCursor({ ...CURSOR_INICIAL, fase: 'diagnostico' }),
          hayMas: true,
        }
      }

      const cabe =
        tope === null ? MAX_SKUS_FOEP : Math.min(MAX_SKUS_FOEP, tope - cursor.foepHechos)

      /* --- 2a. La cola: quien acaba de perder la oferta destacada --- */
      if (!cursor.colaVacia && entorno.config.foepColaActiva) {
        const cola = await colaFoepPendiente(entorno.unidad, cabe)
        if (cola.length > 0) {
          return {
            claves: cola,
            cursorSiguiente: escribirCursor({ ...cursor, foepHechos: cursor.foepHechos + cola.length }),
            hayMas: true,
          }
        }
        // Cola vacía: se marca en el cursor para no volver a consultarla en cada
        // lote de la rotación.
        return {
          claves: [],
          cursorSiguiente: escribirCursor({ ...cursor, colaVacia: true }),
          hayMas: true,
        }
      }

      /* --- 2b. La rotación --- */
      const dia = diaDeRotacion(ctx.ahora)
      const rotacion = foepCompleto(ctx) ? 1 : entorno.config.foepRotacionDias
      const elegidos: string[] = []
      let clave = cursor.clave
      let escaneados = 0
      let quedan = true

      while (elegidos.length < cabe && escaneados < MAX_ESCANEO_ROTACION) {
        const tramo = await siguientesSkus(
          entorno.unidad,
          clave || null,
          PAGINA_ESCANEO,
          entorno.ambito
        )
        if (tramo.listings.length === 0) {
          quedan = false
          break
        }
        escaneados += tramo.listings.length
        for (const listing of tramo.listings) {
          if (elegidos.length >= cabe) break
          clave = listing.sku
          if (leTocaFoep(listing.sku, dia, rotacion)) elegidos.push(listing.sku)
        }
        // Si el lote se ha llenado a mitad de página, `clave` se ha quedado en el
        // último SKU MIRADO, no en el último de la página: por ahí sigue el
        // siguiente lote. Sin esto se saltarían los que quedaban.
        if (elegidos.length >= cabe) break
        if (!tramo.hayMas) {
          quedan = false
          break
        }
      }

      if (elegidos.length === 0 && !quedan) {
        return {
          claves: [],
          cursorSiguiente: escribirCursor({ ...CURSOR_INICIAL, fase: 'diagnostico' }),
          hayMas: true,
        }
      }

      if (elegidos.length === 0) {
        // Se han escaneado 3.000 filas sin que le tocara a ninguna. No es un
        // error: con rotación larga y un subconjunto pequeño pasa. Se avanza el
        // cursor y se sigue en el lote siguiente.
        return {
          claves: [],
          cursorSiguiente: escribirCursor({ ...cursor, clave }),
          hayMas: true,
        }
      }

      return {
        claves: elegidos,
        cursorSiguiente: escribirCursor({
          ...cursor,
          clave,
          foepHechos: cursor.foepHechos + elegidos.length,
        }),
        hayMas: true,
      }
    }

    /* ---------------- Fase 3 · Diagnóstico ---------------- */
    const tramo = await siguientesSkus(
      entorno.unidad,
      cursor.clave || null,
      LOTE_DIAGNOSTICO,
      entorno.ambito
    )
    if (tramo.listings.length === 0) {
      return { claves: [], cursorSiguiente: null, hayMas: false }
    }
    return {
      claves: tramo.listings.map((l) => l.sku),
      cursorSiguiente: escribirCursor({ ...cursor, clave: tramo.ultimo ?? cursor.clave }),
      hayMas: true,
    }
  },

  async procesarLote(ctx, lote): Promise<ResultadoLote> {
    const entorno = await entornoDe(ctx)
    // La fase del lote sale del cursor que la propia `siguienteLote` acaba de
    // devolver: dentro de una fase, el cursor siguiente lleva la misma fase.
    const fase = leerCursor(lote.cursorSiguiente).fase

    if (fase === 'ofertas') return procesarOfertas(ctx, entorno, lote.claves)
    if (fase === 'foep') return procesarFoep(ctx, entorno, lote.claves)
    return procesarDiagnostico(ctx, entorno, lote.claves)
  },

  resumir(_ctx, cuentas: CuentasJob): string {
    const base =
      `${cuentas.procesados} lecturas y diagnósticos de Buy Box en ${cuentas.lotes} lotes`
    return cuentas.omitidos > 0
      ? `${base}, y ${cuentas.omitidos} referencias que Amazon no ha devuelto o ha rechazado una a una.`
      : `${base}.`
  },
}

/* ------------------------------------------------------------------ */
/* Fase 1 · Ofertas                                                    */
/* ------------------------------------------------------------------ */

async function procesarOfertas(
  ctx: ContextoTarea,
  entorno: Entorno,
  skus: string[]
): Promise<ResultadoLote> {
  const listings = await listingsDeSkus(entorno.unidad, skus)
  if (listings.size === 0) return { procesados: 0, omitidos: skus.length }

  const respuesta = await leerOfertas(entorno.credenciales, {
    marketplaceId: entorno.unidad.marketplaceId,
    skus,
    condicion: entorno.config.condicion,
    segmento: entorno.config.segmento,
  })

  const lectura = leerLoteOfertas(respuesta.datos, skus, {
    nuestroSellerId: entorno.sellingPartnerId,
    sellersAmazon: entorno.config.sellersAmazon[entorno.unidad.marketplaceId] ?? [],
    maxOfertasGuardadas: entorno.config.ofertasGuardadas,
  })

  await contarFallos(ctx, entorno, lectura.fallos, lectura.enumsDesconocidos, respuesta.requestId)

  const filas: SnapshotNuevo[] = []
  const perdidas: string[] = []

  for (const [sku, dato] of lectura.porSku) {
    const listing = listings.get(sku)
    filas.push({
      listingId: listing?.id ?? null,
      connectionId: entorno.unidad.connectionId,
      sellingPartnerId: entorno.sellingPartnerId,
      marketplaceId: entorno.unidad.marketplaceId,
      sku,
      asin: listing?.asin ?? null,

      precioPropio: dato.precioPropio,
      precioPropioEnvio: dato.envioPropio,
      // La divisa es OBLIGATORIA en la tabla: «14,99» no dice nada en un cliente
      // que vende en España y en Estados Unidos. Se coge la de la respuesta y,
      // si Amazon no la ha dicho, la del espejo del catálogo.
      moneda: dato.moneda ?? listing?.currency ?? '',
      canalPropio: dato.canalPropio,

      buyboxEstado: dato.buybox,
      precioBuybox: dato.precioBuybox,
      precioBuyboxEnvio: dato.envioBuybox,
      canalGanador: dato.canalGanador,

      nCompetidores: dato.competidores,
      nOfertas: dato.competidores === null ? null : dato.competidores + (dato.hayOfertaPropia ? 1 : 0),
      nCompetidoresPrime: dato.competidoresPrime,
      hayOfertaPropia: dato.hayOfertaPropia,
      precioCompetidorMin: dato.precioCompetidorMin,
      precioCompetidorMinLanded: dato.precioCompetidorMinLanded,

      amazonEstado: dato.amazon,

      // ESTA FASE NO PREGUNTA POR EL FOEP, y eso NO es «no hay FOEP»: es «no se
      // ha preguntado». Confundirlo haría que el diagnóstico dijera «Amazon no
      // da precio» de trece mil referencias a las que nadie ha preguntado nada.
      foep: null,
      foepEstado: 'no_consultado',
      foepResultado: null,
      foepMoneda: null,

      condicion: entorno.config.condicion,
      segmento: entorno.config.segmento,
      ofertas: lectura.ofertasPorSku.get(sku) ?? null,

      origen: 'pricing',
      requestId: respuesta.requestId,
      jobId: ctx.job.id,
    })

    // A la cola de FOEP: los que tienen oferta viva y NO tienen la destacada.
    // Son los únicos para los que el techo cambia algo hoy.
    if (dato.hayOfertaPropia && (dato.buybox === 'de_otro' || dato.buybox === 'nadie')) {
      perdidas.push(sku)
    }
  }

  const filasSinDivisa = filas.filter((f) => f.moneda === '')
  if (filasSinDivisa.length > 0) {
    await ctx.evento({
      tipo: 'buybox_sin_divisa',
      severidad: 'aviso',
      mensaje:
        `${filasSinDivisa.length} referencias han vuelto sin divisa ni en la respuesta de Amazon ni ` +
        'en el espejo del catálogo. No se guarda su lectura: un importe sin moneda no se puede ' +
        'comparar con nada y en un cliente multipaís es directamente un número falso.',
      detalle: { skus: filasSinDivisa.slice(0, 20).map((f) => f.sku) },
    })
  }

  const escribibles = filas.filter((f) => f.moneda !== '')
  await insertarSnapshots(escribibles)

  if (entorno.config.foepColaActiva && perdidas.length > 0) {
    await encolarFoep(entorno.unidad, perdidas, 'perdida')
  }

  return {
    procesados: escribibles.length,
    omitidos: skus.length - escribibles.length,
    errores: 0,
  }
}

/* ------------------------------------------------------------------ */
/* Fase 2 · FOEP                                                       */
/* ------------------------------------------------------------------ */

async function procesarFoep(
  ctx: ContextoTarea,
  entorno: Entorno,
  skus: string[]
): Promise<ResultadoLote> {
  const listings = await listingsDeSkus(entorno.unidad, skus)

  const respuesta = await leerFoep(entorno.credenciales, {
    marketplaceId: entorno.unidad.marketplaceId,
    skus,
    segmento: entorno.config.segmento,
  })

  const lectura = leerLoteFoep(respuesta.datos, skus, {
    nuestroSellerId: entorno.sellingPartnerId,
  })

  await contarFallos(ctx, entorno, lectura.fallos, lectura.enumsDesconocidos, respuesta.requestId)

  const filas: SnapshotNuevo[] = []

  for (const [sku, foep] of lectura.porSku) {
    const listing = listings.get(sku)
    const extra = lectura.extrasPorSku.get(sku)
    const moneda = foep.moneda ?? listing?.currency ?? ''
    if (moneda === '') continue

    filas.push({
      listingId: listing?.id ?? null,
      connectionId: entorno.unidad.connectionId,
      sellingPartnerId: entorno.sellingPartnerId,
      marketplaceId: entorno.unidad.marketplaceId,
      sku,
      asin: extra?.asin ?? listing?.asin ?? null,

      // Esta llamada NO devuelve nuestro precio de listing. Se toma el del
      // espejo del catálogo, que es de hace como mucho quince minutos, y NO se
      // deja a null: sin precio propio el veredicto no puede comparar nada.
      precioPropio: listing?.price ?? null,
      precioPropioEnvio: null,
      moneda,
      canalPropio: extra?.canalPropio ?? canalDeListing(listing),

      // El FOEP SÍ dice quién tiene ahora la oferta destacada, y esa es la
      // comparación de la que cuelga todo el módulo: currentFeaturedOffer contra
      // nuestro identificador de vendedor.
      buyboxEstado: extra?.buybox ?? 'desconocido',
      precioBuybox: extra?.precioBuybox ?? null,
      precioBuyboxEnvio: null,
      canalGanador: extra?.canalGanador ?? null,

      // Esta operación no cuenta ofertas. NO se pone cero: cero competidores es
      // una afirmación fuerte y aquí no se ha mirado.
      nCompetidores: null,
      nOfertas: null,
      nCompetidoresPrime: null,
      hayOfertaPropia: null,
      precioCompetidorMin: null,
      precioCompetidorMinLanded: null,

      amazonEstado: 'indeterminado',

      foep: foep.importe,
      foepEstado: foep.estado,
      foepResultado: foep.resultado,
      foepMoneda: foep.moneda,

      condicion: entorno.config.condicion,
      segmento: entorno.config.segmento,
      ofertas: null,

      origen: 'foep',
      requestId: respuesta.requestId,
      jobId: ctx.job.id,
    })
  }

  await insertarSnapshots(filas)
  // Servidos, hayan traído número o no: lo que la cola pide es que se pregunte,
  // no que Amazon conteste que sí. Sin esto, un SKU al que Amazon nunca da FOEP
  // se quedaría en la cola para siempre y adelantaría el turno de los demás cada
  // noche.
  await marcarColaServida(entorno.unidad, skus)

  return {
    procesados: filas.length,
    omitidos: skus.length - filas.length,
  }
}

function canalDeListing(listing: ListingBuyBox | undefined): CanalOferta {
  if (!listing) return 'desconocido'
  if (listing.is_fba) return 'FBA'
  // El espejo NO sabe distinguir SFP de FBM: eso solo sale de las ofertas. Se
  // dice FBM porque es lo que dice el canal de logística, y la respuesta de
  // ofertas lo corrige cuando llega.
  return listing.fulfillment_channel_code ? 'FBM' : 'desconocido'
}

/* ------------------------------------------------------------------ */
/* Fase 3 · Diagnóstico                                                */
/* ------------------------------------------------------------------ */

/**
 * EL MARGEN AL FOEP, HOY.
 *
 * A2 no lo sabe calcular y no lo finge. Hacen falta tres cosas que viven en
 * otros módulos: el coste de compra (A5), las tarifas de referencia y de FBA
 * (A4) y el IVA del marketplace —que es forzosamente una tabla de configuración
 * con fecha de vigencia, porque no hay ningún endpoint que lo dé con los roles
 * concedidos—.
 *
 * Así que llega como `no_evaluable` con este motivo, el motor lo dice en el
 * veredicto y NO recomienda. El día que A4 y A5 estén, se rellena aquí y los
 * tres veredictos que dependen del margen empiezan a salir sin tocar el motor ni
 * a quien lo consume.
 */
const MARGEN_NO_EVALUABLE: MargenAlFoep = {
  estado: 'no_evaluable',
  motivo:
    'todavía no se puede calcular el margen a ese precio, porque hacen falta el coste de compra ' +
    '(módulo de costes), las tarifas de Amazon (módulo de tarifas) y el IVA del país, y ninguna de ' +
    'las tres está disponible en este módulo.',
}

async function procesarDiagnostico(
  ctx: ContextoTarea,
  entorno: Entorno,
  skus: string[]
): Promise<ResultadoLote> {
  const ventana = ventanaLecturas(entorno.config)
  const [listings, ultimos, stocks] = await Promise.all([
    listingsDeSkus(entorno.unidad, skus),
    ultimosPorSku(entorno.unidad, skus, ventana),
    stockPorSku(entorno.unidad, skus, ventana),
  ])

  const filas: DiagnosticoNuevo[] = []
  const perdidasConfirmadas: string[] = []

  for (const sku of skus) {
    const listing = listings.get(sku)
    const ultimo = ultimos.get(sku)
    const stock: EstadoStock = stocks.get(sku) ?? STOCK_DESCONOCIDO

    const ofertas: LecturaOfertas | null = ultimo?.ofertas
      ? {
          precioPropio: ultimo.ofertas.precio_propio,
          envioPropio: ultimo.ofertas.precio_propio_envio,
          moneda: ultimo.ofertas.moneda,
          canalPropio: (ultimo.ofertas.canal_propio as CanalOferta) ?? 'desconocido',
          hayOfertaPropia: ultimo.ofertas.hay_oferta_propia !== false,
          buybox: ultimo.ofertas.buybox_estado,
          precioBuybox: ultimo.ofertas.precio_buybox,
          envioBuybox: ultimo.ofertas.precio_buybox_envio,
          canalGanador: (ultimo.ofertas.canal_ganador as CanalOferta) ?? null,
          competidores: ultimo.ofertas.n_competidores,
          competidoresPrime: ultimo.ofertas.n_competidores_prime,
          precioCompetidorMin: ultimo.ofertas.precio_competidor_min,
          precioCompetidorMinLanded: ultimo.ofertas.precio_competidor_min_landed,
          amazon: ultimo.ofertas.amazon_estado,
          leidoAt: ultimo.ofertas.fecha,
        }
      : null

    const foep: LecturaFoep = ultimo?.foep
      ? {
          estado: ultimo.foep.foep_estado,
          importe: ultimo.foep.foep,
          moneda: ultimo.foep.foep_moneda ?? ultimo.foep.moneda,
          resultado: ultimo.foep.foep_resultado,
          leidoAt: ultimo.foep.fecha,
        }
      : FOEP_NO_CONSULTADO

    const entrada: EntradaDiagnostico = {
      sku,
      asin: listing?.asin ?? ultimo?.ofertas?.asin ?? null,
      ofertas,
      foep,
      stock,
      margen: MARGEN_NO_EVALUABLE,
      config: configDelMotor(entorno.config, sku),
      ahora: ctx.ahora,
    }

    const resultado = diagnosticar(entrada)

    filas.push({
      listingId: listing?.id ?? null,
      connectionId: entorno.unidad.connectionId,
      sellingPartnerId: entorno.sellingPartnerId,
      marketplaceId: entorno.unidad.marketplaceId,
      sku,
      asin: entrada.asin,
      veredicto: resultado.veredicto,
      motivo: resultado.motivo,
      accion: resultado.accion,
      prioridad: resultado.prioridad,
      buyboxEstado: ofertas?.buybox ?? 'desconocido',
      amazonEstado: ofertas?.amazon ?? 'indeterminado',
      precioPropio: ofertas?.precioPropio ?? listing?.price ?? null,
      moneda: ofertas?.moneda ?? listing?.currency ?? null,
      foep: foep.estado === 'disponible' ? foep.importe : null,
      foepEstado: foep.estado,
      datos: resultado.datos,
      precioPropuesto: resultado.precioPropuesto,
      precioPropuestoMotivo: resultado.precioPropuestoMotivo,
      snapshotId: ultimo?.ofertas?.id ?? null,
      foepFecha: ultimo?.foep?.fecha ?? null,
      jobId: ctx.job.id,
    })

    // ---------- ¿Hay que avisar? ----------
    if (seAcabaDePerder(ultimo?.historial ?? [], entorno.config.lecturasParaAlertar)) {
      perdidasConfirmadas.push(sku)
    }
  }

  await insertarDiagnosticos(filas)

  /**
   * UN SOLO EVENTO POR LOTE, NO UNO POR SKU.
   *
   * La especificación lo dice con todas las letras: «si la cola tiene 200
   * entradas diarias, nadie la revisa: le dan a aceptar todo. Diez decisiones al
   * día que importan valen más que doscientas que no».
   */
  if (perdidasConfirmadas.length > 0) {
    await ctx.evento({
      tipo: 'buybox_perdida',
      severidad: 'aviso',
      mensaje:
        `${perdidasConfirmadas.length} referencias han perdido la oferta destacada en ` +
        `${entorno.nombreConexion}, confirmado en ${entorno.config.lecturasParaAlertar} lecturas ` +
        'seguidas (una sola no basta: la oferta destacada rota entre ofertas empatadas varias ' +
        'veces al día y avisar por una lectura sería una alerta falsa cada noche). El porqué de ' +
        'cada una está en la pantalla de Buy Box.',
      detalle: { skus: perdidasConfirmadas.slice(0, 20), total: perdidasConfirmadas.length },
      // La huella agrupa por unidad de trabajo: si esto pasa cada noche, el aviso
      // no suena veinte veces.
      huella: `buybox_perdida·${entorno.unidad.connectionId}·${entorno.unidad.marketplaceId}`,
    })
  }

  return { procesados: filas.length }
}

/**
 * ¿Se acaba de perder la oferta destacada?
 *
 * PURA y con el historial por parámetro. Pide DOS cosas a la vez:
 *
 *   · que las últimas N lecturas seguidas NO la tengan —una sola no basta,
 *     porque la oferta destacada rota entre ofertas empatadas varias veces al
 *     día y avisar por una lectura sería una alerta falsa por cada SKU
 *     empatado—;
 *   · y que ANTES de esas N sí la tuviéramos. Sin esta segunda condición, un SKU
 *     que lleva medio año sin Buy Box dispararía la misma alerta todas las
 *     noches, y una alerta que suena siempre no es una alerta.
 */
export function seAcabaDePerder(historial: string[], lecturas: number): boolean {
  const n = Math.max(1, lecturas)
  if (historial.length < n + 1) return false
  for (let i = 0; i < n; i++) {
    if (historial[i] === 'nuestra') return false
  }
  return historial.slice(n).includes('nuestra')
}

/* ------------------------------------------------------------------ */
/* Fallos por elemento                                                 */
/* ------------------------------------------------------------------ */

/**
 * Cuenta los fallos de un lote y levanta UN evento por clase, no uno por SKU.
 *
 * Y trata cada clase como toca:
 *   · `rol`  -> es GRAVE y no se arregla reintentando: hay que reautorizar.
 *   · `dato` -> ese elemento se aísla, el resto del lote sigue.
 *   · el resto -> se cuenta y se reintenta en la pasada siguiente.
 */
async function contarFallos(
  ctx: ContextoTarea,
  entorno: Entorno,
  fallos: FalloElemento[],
  enums: string[],
  requestId: string | null
): Promise<void> {
  if (enums.length > 0) {
    await ctx.evento({
      tipo: 'buybox_enum_desconocido',
      severidad: 'aviso',
      mensaje:
        `Amazon ha devuelto valores que no conocíamos: ${enums.join(', ')}. Los enum de la Selling ` +
        'Partner API no están documentados como cerrados, así que estas referencias se tratan como ' +
        '«sin dato» —nunca como cero— y el valor crudo queda guardado en la serie para poder ' +
        'interpretarlo después.',
      detalle: { valores: enums },
      requestId,
      huella: `buybox_enum·${enums.slice().sort().join(',')}`,
    })
  }

  if (fallos.length === 0) return

  const porClase = new Map<string, FalloElemento[]>()
  for (const fallo of fallos) {
    const lista = porClase.get(fallo.clase)
    if (lista) lista.push(fallo)
    else porClase.set(fallo.clase, [fallo])
  }

  for (const [clase, lista] of porClase) {
    if (clase === 'rol') {
      await ctx.evento({
        tipo: 'buybox_sin_permisos',
        severidad: 'critico',
        mensaje:
          `Amazon ha rechazado por permisos la lectura de precios de ${lista.length} referencias de ` +
          `«${entorno.nombreConexion}». Esto NO se arregla reintentando: la autorización de este ` +
          'cliente no incluye el rol de Precios o ha caducado, y tiene que volver a autorizar la ' +
          'aplicación desde «Manage Your Apps» de Seller Central.',
        detalle: { skus: lista.slice(0, 20).map((f) => f.sku) },
        requestId,
      })
      continue
    }

    if (lista.length >= FALLOS_QUE_PREOCUPAN) {
      await ctx.evento({
        tipo: `buybox_fallo_${clase}`,
        severidad: clase === 'dato' ? 'aviso' : 'error',
        mensaje:
          `Amazon ha rechazado ${lista.length} referencias de este lote (${clase}). ` +
          (clase === 'dato'
            ? 'Se aíslan esas y el resto del lote sigue: suele ser un SKU que ya no existe en ese país.'
            : 'Se reintentan en la pasada siguiente.') +
          ` Primer mensaje: ${lista[0].mensaje ?? 'sin mensaje'}.`,
        detalle: {
          skus: lista.slice(0, 20).map((f) => f.sku),
          codigos: [...new Set(lista.map((f) => f.codigo).filter(Boolean))],
        },
        requestId,
      })
    }
  }
}
