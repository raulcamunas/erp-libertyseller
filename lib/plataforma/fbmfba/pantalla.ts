/**
 * PLATAFORMA · MÓDULO A4 — LO QUE LEE LA PANTALLA
 * ===============================================
 * SOLO SERVIDOR: importa el cliente de service_role.
 *
 * Junta las piezas —el catálogo, los costes, las tarifas, las ventas y el
 * ranking— y se las da al motor de analisis.ts, que es el que decide. Aquí no
 * hay ni un umbral, ni una fórmula, ni un veredicto: solo el pegamento.
 *
 *
 * ============ POR QUÉ EL ANÁLISIS SE CALCULA CADA VEZ ============
 *
 * No hay tabla de resultados y es una decisión, no una carencia (está escrito en
 * la migración 129). Un veredicto guardado se calculó con unos costes, unos
 * umbrales y unas tarifas que hoy pueden ser otros, y no hay forma de mirarlo y
 * saber si sigue valiendo. Recalcular cuesta unos segundos por cuenta y país y
 * garantiza que lo que se le enseña al cliente es lo que sale de los datos de
 * hoy. Lo que sí se guarda es lo que no se puede deducir: el impuesto de cada
 * marketplace y los umbrales del cliente.
 *
 *
 * ============ CUMPLIMIENTO ANTE AMAZON ============
 *
 * Todo cuelga de UNA cuenta y UN país de UN cliente. No hay ninguna función que
 * agregue, compare o clasifique entre clientes: los datos de un vendedor se usan
 * exclusivamente para operar y asesorar su cuenta.
 */

import { conexionesDeCliente, unidadesDe } from '../datos'
import { agregarVentas } from '../ventas'
import { costesVigentesPorSku } from '../costes'
import { politicaDe, costesDeCliente } from '../costes/datos'
import { exigenciasDe, type CosteEvaluable, type Exigencias } from '../costes/completitud'
import type { EstadoAmazonRetail, EstadoBuyBox, EstadoFoepA2 } from '../buybox/tipos'
import { analizar, faltaPorDecidir, type AnalisisSku, type EntradaAnalisis } from './analisis'
import type { TarifasEscenario } from './margen'
import {
  catalogoDeUnidad,
  configDeCliente,
  fiscalDe,
  isMissingSchema,
  ventasDesde,
  type FilaCruda,
  type TarifaCruda,
} from './datos'
import { sugerenciaFiscal, type ParametrosFiscales } from './fiscal'
import {
  FALTAN_MIGRACIONES_A4,
  SENTIDO_FOEP_LABELS,
  VEREDICTOS_A4,
  procedenciaDeDims,
  type CanalA4,
  type ConfigFbmFba,
  type Rotacion,
  type VeredictoA4,
} from './tipos'

export { isMissingSchema as faltaEsquema, FALTAN_MIGRACIONES_A4 }

/**
 * Tope de referencias analizadas de una vez.
 *
 * El cliente grande tiene 13.700, así que 20.000 le cabe entero con holgura. No
 * está para recortarle a nadie: está para que un catálogo que se dispare no deje
 * la pantalla pensando sin decir nada. Cuando se toca, la respuesta lo dice y la
 * pantalla lo enseña — un análisis a medias que no se anuncia es peor que uno que
 * no se hace.
 */
export const TOPE_ANALISIS = 20000

/* ------------------------------------------------------------------ */
/* 1. Las unidades de trabajo                                          */
/* ------------------------------------------------------------------ */

export interface UnidadA4 {
  connectionId: string
  connectionName: string
  sellingPartnerId: string
  marketplaceId: string
}

/** Las cuentas y países de un cliente, para el selector de la pantalla */
export async function unidadesDeCliente(clientId: string): Promise<UnidadA4[]> {
  const conexiones = await conexionesDeCliente(clientId)
  const nombres = new Map(conexiones.map((c) => [c.id, c.name]))
  return unidadesDe(conexiones).map((u) => ({
    connectionId: u.connectionId,
    connectionName: nombres.get(u.connectionId) ?? '',
    sellingPartnerId: u.sellingPartnerId,
    marketplaceId: u.marketplaceId,
  }))
}

/* ------------------------------------------------------------------ */
/* 2. El análisis                                                      */
/* ------------------------------------------------------------------ */

export interface ResumenA4 {
  /** Cuántas referencias se han analizado */
  analizadas: number
  /** Cuántas tiene la cuenta en este país */
  total: number
  /** Se ha tocado el tope y falta catálogo por mirar */
  truncado: boolean

  porVeredicto: Record<VeredictoA4, number>

  /**
   * Las coberturas. SIEMPRE con su fracción, nunca solo el porcentaje: un
   * análisis sobre el 30 % del catálogo no es un análisis, es una muestra
   * sesgada hacia lo que alguien se molestó en rellenar.
   */
  conCoste: number
  /** Las que tienen tarifa de logística: es EL número que decide la migración */
  conTarifasFba: number
  conRotacionMedida: number

  /** Referencias que hoy salen del almacén del cliente: el universo de A4 */
  canalPropio: number

  /**
   * Estimaciones guardadas SIN canal, que no se pueden usar.
   *
   * Es un aviso ACCIONABLE y por eso sale a la pantalla y no al panel de
   * información: son tarifas que ya se pagaron a la API y que hay que volver a
   * pedir marcando el escenario, y sin decirlo la referencia sale «sin tarifas»
   * como si nunca se hubiera preguntado.
   */
  feesSinCanal: number

  ultimoDiagnostico: string | null
  ultimaTarifa: string | null
}

export interface VistaA4 {
  unidad: UnidadA4
  filas: AnalisisSku[]
  resumen: ResumenA4
  /** El impuesto que se ha aplicado, y de dónde sale */
  fiscal: ParametrosFiscales
  /** Lo que la pantalla propone si no hay nada configurado. NO se aplica solo */
  sugerenciaFiscal: ReturnType<typeof sugerenciaFiscal>
  config: ConfigFbmFba
  /** Lo que nadie ha decidido todavía y hace falta */
  faltaPorDecidir: string[]
  moneda: string | null
}

export interface FiltroA4 {
  clientId: string
  /** La cuenta y el país, YA RESUELTOS por quien llama. Ver el comentario de abajo */
  unidad: UnidadA4
  veredictos?: VeredictoA4[] | null
  busqueda?: string | null
  ahora?: Date
}

/**
 * EL ANÁLISIS DE UNA CUENTA Y UN PAÍS.
 *
 * Devuelve TODAS las filas ya juzgadas y ordenadas por lo accionable, sin
 * paginar. Paginar antes de juzgar sería enseñar «las doscientas primeras por
 * SKU» en vez de «las doscientas que más importan», que es justo lo contrario de
 * lo que pide esta pantalla: de trece mil referencias, cuáles merecen moverse.
 */
export async function analisisDeUnidad(filtro: FiltroA4): Promise<VistaA4> {
  const ahora = filtro.ahora ?? new Date()
  const hoy = ahora.toISOString().slice(0, 10)
  const { unidad, clientId } = filtro

  const [catalogo, config, politica, tramos, fiscales] = await Promise.all([
    catalogoDeUnidad(unidad, TOPE_ANALISIS),
    configDeCliente(clientId),
    politicaDe(clientId),
    costesDeCliente(clientId),
    fiscalDe(clientId, [unidad.marketplaceId], hoy),
  ])

  const fiscal =
    fiscales.get(unidad.marketplaceId) ?? {
      marketplaceId: unidad.marketplaceId,
      ivaPorcentaje: null,
      precioIncluyeImpuesto: null,
      validoDesde: null,
      actualizadoPor: null,
      ambito: 'sin_configurar' as const,
      notas: null,
    }

  const exigencias = exigenciasDe(politica)
  const costes = costesVigentesPorSku(tramos, hoy)

  // La ventana de rotación es la del cliente. Se pide desde la fecha, no desde
  // un Date: convertir aquí haría que la zona horaria del contenedor moviera el
  // corte un día, que en treinta días es un 3 % de error silencioso.
  const desdeVentas = new Date(ahora.getTime() - config.rotacionVentanaDias * 86400000)
    .toISOString()
    .slice(0, 10)
  const ventas = agregarVentas(
    await ventasDesde(clientId, unidad.marketplaceId, desdeVentas)
  )

  const filas: AnalisisSku[] = []
  for (const cruda of catalogo.filas) {
    filas.push(
      analizar(
        entradaDe(cruda, {
          config,
          exigencias,
          fiscal,
          coste: costes.get(cruda.sku) ?? null,
          rotacion: rotacionDe(cruda, ventas.get(`${unidad.marketplaceId}|${cruda.sku}`), config),
          ahora,
        })
      )
    )
  }

  // Primero lo accionable, y dentro de cada grupo la mayor mejora de margen: si
  // hay cuarenta candidatos, los primeros tienen que ser los que más dinero
  // mueven, no los que empiezan por «A».
  filas.sort(
    (a, b) =>
      a.prioridad - b.prioridad ||
      (b.comparacion.puntos ?? -Infinity) - (a.comparacion.puntos ?? -Infinity) ||
      a.sku.localeCompare(b.sku, 'es')
  )

  return {
    unidad,
    filas: aplicarFiltros(filas, filtro),
    resumen: resumirA4(filas, catalogo),
    fiscal,
    sugerenciaFiscal: sugerenciaFiscal(unidad.marketplaceId),
    config,
    faltaPorDecidir: faltaGlobal(config, fiscal, filas),
    moneda: filas.find((f) => f.moneda)?.moneda ?? null,
  }
}

function aplicarFiltros(filas: AnalisisSku[], filtro: FiltroA4): AnalisisSku[] {
  const busqueda = (filtro.busqueda ?? '').trim().toLowerCase()
  const veredictos = filtro.veredictos && filtro.veredictos.length > 0 ? new Set(filtro.veredictos) : null

  return filas.filter((f) => {
    if (veredictos && !veredictos.has(f.veredicto)) return false
    if (busqueda) {
      const heno = `${f.sku} ${f.asin ?? ''} ${f.titulo ?? ''} ${f.marca ?? ''}`.toLowerCase()
      if (!heno.includes(busqueda)) return false
    }
    return true
  })
}

/* ------------------------------------------------------------------ */
/* 3. De fila cruda a entrada del motor                                */
/* ------------------------------------------------------------------ */

function entradaDe(
  cruda: FilaCruda,
  contexto: {
    config: ConfigFbmFba
    exigencias: Exigencias
    fiscal: ParametrosFiscales
    coste: CosteEvaluable | null
    rotacion: Rotacion
    ahora: Date
  }
): EntradaAnalisis {
  return {
    sku: cruda.sku,
    asin: cruda.asin,
    titulo: cruda.titulo,
    marca: cruda.marca,
    canal: canalDe(cruda),
    enSeguimiento: cruda.enSeguimiento,
    precioActual: cruda.precio,
    moneda: cruda.moneda,
    foep: cruda.foep,
    foepEstado: estadoFoep(cruda.foepEstado),
    foepResultado: cruda.foepResultado,
    foepLeidoAt: cruda.foepFecha,
    buybox: estadoBuybox(cruda.buyboxEstado),
    amazon: estadoAmazon(cruda.amazonEstado),
    procedenciaDims: procedenciaDeDims(cruda.dimsOrigen, cruda.hayFeePreview, cruda.hayMedidas),
    rotacion: contexto.rotacion,
    coste: contexto.coste,
    exigencias: contexto.exigencias,
    fiscal: contexto.fiscal,
    tarifasPropio: tarifaDe(cruda.feePropio),
    tarifasFba: tarifaDe(cruda.feeFba),
    config: contexto.config,
    ahora: contexto.ahora,
  }
}

/**
 * POR DÓNDE SALE HOY EL PAQUETE — y por qué son cinco casos y no dos.
 *
 * El informe de listings dice 'DEFAULT' tanto para un envío normal (FBM) como
 * para Prime del vendedor (SFP): NO HAY NINGÚN CAMPO QUE LOS DISTINGA. Lo único
 * que los separa es la lectura de ofertas, que solo existe para las referencias
 * que ya haya barrido el monitor de Buy Box.
 *
 * Por eso, cuando sabemos que sale del almacén del cliente pero no si lleva
 * insignia Prime, el canal es `propio_prime_desconocido` y no 'FBM'. Colapsarlo
 * sería mentir sobre el dato más caro de esta pantalla: migrar a FBA algo que ya
 * llega con Prime no gana visibilidad, solo cambia quién hace el trabajo, y esa
 * es una conversación distinta con el cliente.
 *
 * Y el código a NULL no es «lo envía el cliente»: es que no consta. `is_fba` del
 * espejo colapsa esos dos casos, que son un candidato y un dato que falta, y por
 * eso aquí se mira el código crudo.
 */
export function canalDe(cruda: Pick<FilaCruda, 'fulfillmentChannelCode' | 'canalPropio'>): CanalA4 {
  const leido = cruda.canalPropio
  if (leido === 'FBA') return 'FBA'

  const codigo = cruda.fulfillmentChannelCode
  if (codigo !== null && codigo !== 'DEFAULT') return 'FBA'

  if (leido === 'SFP') return 'SFP'
  if (leido === 'FBM') return 'FBM'

  // Código 'DEFAULT': sabemos que sale de su almacén y no si lleva Prime.
  if (codigo === 'DEFAULT') return 'propio_prime_desconocido'
  return 'desconocido'
}

/**
 * La rotación, con sus tres estados.
 *
 * «No hay dato» NUNCA se convierte en «no rota». Descartar una referencia porque
 * nadie importó un fichero de ventas sería tirar catálogo bueno, y es el error
 * que corrige la regla 2 de la especificación.
 */
function rotacionDe(
  cruda: FilaCruda,
  ventas: { unidades: number; diasConDato: number } | undefined,
  config: ConfigFbmFba
): Rotacion {
  const comun = {
    ventanaDias: config.rotacionVentanaDias,
    bsr: cruda.bsr,
    bsrCategoria: cruda.bsrCategoria,
    bsrLeidoAt: cruda.bsrFecha,
  }

  if (ventas) {
    return { estado: 'medida', unidades: ventas.unidades, diasConDato: ventas.diasConDato, ...comun }
  }
  if (cruda.bsr !== null) {
    return { estado: 'senal_bsr', unidades: null, diasConDato: 0, ...comun }
  }
  return { estado: 'no_evaluable', unidades: null, diasConDato: 0, ...comun }
}

/**
 * Las tarifas tal cual vinieron.
 *
 * `origen` se valida contra la lista conocida y lo que no encaje cae en `null`,
 * que el motor trata como «no consta». Es la rama por defecto que pide el
 * estudio de la API: ninguno de esos enumerados está cerrado en la
 * documentación, y un valor nuevo tiene que dejar la referencia sin número, no
 * colarse como si fuera uno de los buenos.
 */
function tarifaDe(cruda: TarifaCruda): TarifasEscenario {
  const origen =
    cruda.origen === 'estimado_api' || cruda.origen === 'fee_preview' || cruda.origen === 'liquidacion'
      ? cruda.origen
      : null
  return {
    precioReferencia: cruda.precioReferencia,
    moneda: cruda.moneda,
    referral: cruda.referral,
    fba: cruda.fba,
    otras: cruda.otras,
    origen,
    leidoAt: cruda.fecha,
  }
}

function estadoBuybox(valor: string | null): EstadoBuyBox {
  if (valor === 'nuestra' || valor === 'de_otro' || valor === 'nadie') return valor
  return 'desconocido'
}

function estadoAmazon(valor: string | null): EstadoAmazonRetail {
  // El ternario, y el «no se sabe» es el caso normal: no existe ningún campo de
  // la API que identifique la oferta de Amazon Retail.
  if (valor === 'si' || valor === 'no') return valor
  return 'indeterminado'
}

function estadoFoep(valor: string | null): EstadoFoepA2 {
  if (valor === 'disponible' || valor === 'no_disponible') return valor
  return 'no_consultado'
}

/* ------------------------------------------------------------------ */
/* 4. El resumen                                                       */
/* ------------------------------------------------------------------ */

function resumirA4(
  filas: AnalisisSku[],
  catalogo: { filas: FilaCruda[]; total: number; truncado: boolean }
): ResumenA4 {
  const porVeredicto = Object.fromEntries(VEREDICTOS_A4.map((v) => [v, 0])) as Record<
    VeredictoA4,
    number
  >
  for (const fila of filas) porVeredicto[fila.veredicto] += 1

  let conCoste = 0
  let conTarifasFba = 0
  let conRotacionMedida = 0
  let canalPropio = 0
  let feesSinCanal = 0
  let ultimoDiagnostico: string | null = null
  let ultimaTarifa: string | null = null

  for (const cruda of catalogo.filas) {
    if (cruda.feeFba.fba !== null) conTarifasFba += 1
    feesSinCanal += cruda.feesSinCanal
    ultimoDiagnostico = masNuevo(ultimoDiagnostico, cruda.diagnosticoFecha)
    ultimaTarifa = masNuevo(ultimaTarifa, cruda.feePropio.fecha)
    ultimaTarifa = masNuevo(ultimaTarifa, cruda.feeFba.fecha)
  }

  for (const fila of filas) {
    // Cobertura de COSTE, no de margen: el margen puede faltar por el impuesto o
    // por las tarifas, y mezclarlo haría que la barra dijera que faltan costes
    // cuando lo que falta es configurar el IVA.
    if (!fila.margenPropio.faltan.some((f) => f.includes('coste') || f.includes('compra'))) {
      conCoste += 1
    }
    if (fila.rotacion.estado === 'medida') conRotacionMedida += 1
    if (fila.canal !== 'FBA' && fila.canal !== 'desconocido') canalPropio += 1
  }

  return {
    analizadas: filas.length,
    total: catalogo.total,
    truncado: catalogo.truncado,
    porVeredicto,
    conCoste,
    conTarifasFba,
    conRotacionMedida,
    canalPropio,
    feesSinCanal,
    ultimoDiagnostico,
    ultimaTarifa,
  }
}

function masNuevo(actual: string | null, candidato: string | null): string | null {
  if (!candidato) return actual
  if (!actual) return candidato
  return candidato > actual ? candidato : actual
}

/* ------------------------------------------------------------------ */
/* 5. Lo que falta por decidir                                         */
/* ------------------------------------------------------------------ */

/**
 * Lo que nadie ha configurado y hace falta, para la cuenta entera.
 *
 * Sale de la misma función que lo escribe en cada fila —`faltaPorDecidir` de
 * analisis.ts— para que la pantalla y el motivo de una referencia no puedan
 * decir cosas distintas. Lo único que se añade aquí es lo que solo se ve
 * mirando el conjunto.
 */
function faltaGlobal(
  config: ConfigFbmFba,
  fiscal: ParametrosFiscales,
  filas: AnalisisSku[]
): string[] {
  const falta = faltaPorDecidir({
    config,
    fiscal,
    // Basta con que UNA referencia no se pueda juzgar para que falte la lista de
    // identificadores de Amazon Retail: el aviso es de la cuenta, no de la fila.
    amazon: filas.some((f) => f.amazon === 'indeterminado') ? 'indeterminado' : 'no',
  })

  if (config.rotacionMinimaUnidades !== null && filas.every((f) => f.rotacion.estado !== 'medida')) {
    falta.push(
      'Hay rotación mínima puesta pero NO HAY NI UN DATO DE VENTAS de esta cuenta, así que ese ' +
        'umbral no filtra nada. Las unidades entran por CSV: los roles concedidos no incluyen el ' +
        'informe de ventas de Amazon.'
    )
  }

  return falta
}

/* ------------------------------------------------------------------ */
/* 6. La exportación                                                   */
/* ------------------------------------------------------------------ */

/**
 * EL FICHERO QUE SE LE ENSEÑA AL CLIENTE.
 *
 * Lleva EL MOTIVO ENTERO, no la etiqueta del veredicto. Es la mitad del valor de
 * este módulo: un cliente que recibe «no compensa» discute; uno que recibe
 * «enviándolo Amazon quedaría un 6,2 % a 24,90 €, por debajo de tu colchón del
 * 12 %» entiende. Y lleva también las salvedades, para que una recomendación con
 * dudas no se exporte como si no las tuviera.
 *
 * Punto y coma y BOM: es lo que abre Excel en español sin pasar por el asistente
 * de importación, que es donde se pierde la mitad de los ficheros.
 */
export function csvDeA4(
  filas: AnalisisSku[],
  etiquetas: {
    veredicto: Record<VeredictoA4, string>
    canal: Record<CanalA4, string>
    nombreMarketplace: (id: string) => string
  },
  marketplaceId: string
): string {
  const cabecera = [
    'SKU',
    'ASIN',
    'Título',
    'Marca',
    'País',
    'Canal actual',
    'En seguimiento',
    'Precio actual',
    'Precio evaluado',
    'Precio de referencia de Amazon',
    'Sentido del precio de referencia',
    'Moneda',
    'Margen enviándolo el cliente',
    '% enviándolo el cliente',
    'Margen enviándolo Amazon',
    '% enviándolo Amazon',
    'Diferencia (puntos)',
    'Comisión de referencia',
    'Tarifa de logística de Amazon',
    'Coste de compra',
    'Envío propio',
    'Almacenamiento FBA',
    'Flete de entrada',
    'Rotación',
    'Unidades',
    'Ranking',
    'Procedencia de las medidas',
    'Amazon vende en el ASIN',
    'Veredicto',
    'Motivo',
    'Acción',
    'Salvedades',
  ]

  const lineas = [cabecera.join(';')]

  for (const f of filas) {
    const propio = f.margenPropio.desglose
    const fba = f.margenFba.desglose
    lineas.push(
      [
        escapar(f.sku),
        escapar(f.asin ?? ''),
        escapar(f.titulo ?? ''),
        escapar(f.marca ?? ''),
        escapar(etiquetas.nombreMarketplace(marketplaceId)),
        escapar(etiquetas.canal[f.canal]),
        f.enSeguimiento ? 'Sí' : 'No',
        numeroCsv(f.precioActual),
        numeroCsv(f.precioEvaluado),
        numeroCsv(f.foep),
        // Una sola fuente para las cuatro etiquetas. Escrito a mano, `sin_juicio`
        // caía en el `else` y salía exportado como «Sin dato», que es falso: el
        // techo está, lo que falta es saber de quién es la oferta destacada.
        escapar(SENTIDO_FOEP_LABELS[f.sentidoFoep]),
        escapar(f.moneda ?? ''),
        numeroCsv(f.margenPropio.importe),
        numeroCsv(f.margenPropio.porcentaje),
        numeroCsv(f.margenFba.importe),
        numeroCsv(f.margenFba.porcentaje),
        numeroCsv(f.comparacion.puntos),
        numeroCsv(fba?.referral ?? propio?.referral ?? null),
        numeroCsv(fba?.fba ?? null),
        numeroCsv(propio?.costeCompra ?? fba?.costeCompra ?? null),
        numeroCsv(propio?.costeEnvioPropio ?? null),
        numeroCsv(fba?.costeAlmacenFba ?? null),
        numeroCsv(fba?.costeFleteFba ?? null),
        escapar(
          f.rotacion.estado === 'medida'
            ? `Unidades vendidas en ${f.rotacion.ventanaDias} días`
            : f.rotacion.estado === 'senal_bsr'
              ? 'Solo señal de ranking'
              : 'Sin datos de venta'
        ),
        numeroCsv(f.rotacion.unidades),
        numeroCsv(f.rotacion.bsr),
        escapar(f.procedenciaDims),
        escapar(
          f.amazon === 'si' ? 'Sí' : f.amazon === 'no' ? 'No' : 'No se puede saber'
        ),
        escapar(etiquetas.veredicto[f.veredicto]),
        escapar(f.motivo),
        escapar(f.accion),
        escapar(f.salvedades.map((s) => `${s.degrada ? '[FRENA] ' : ''}${s.texto}`).join(' | ')),
      ].join(';')
    )
  }

  return `﻿${lineas.join('\r\n')}\r\n`
}

function escapar(valor: string): string {
  const limpio = valor.replace(/\r?\n/g, ' ').trim()
  return /[";]/.test(limpio) ? `"${limpio.replace(/"/g, '""')}"` : limpio
}

/**
 * Un número para el CSV, con COMA DECIMAL.
 *
 * Y el hueco se queda hueco: una celda vacía es «no lo sabemos» y un 0 es «vale
 * cero». En un fichero que va a un cliente, confundirlos es decirle que un
 * producto no le cuesta nada.
 */
function numeroCsv(valor: number | null): string {
  if (valor === null || !Number.isFinite(valor)) return ''
  return String(valor).replace('.', ',')
}

export type { AnalisisSku }
