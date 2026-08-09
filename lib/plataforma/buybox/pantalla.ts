/**
 * PLATAFORMA · MÓDULO A2 — LO QUE LEE LA PANTALLA
 * ===============================================
 * SOLO SERVIDOR: importa el cliente de service_role.
 *
 * Gemelo de lib/plataforma/pantallas.ts, para el monitor de Buy Box. Los
 * recuentos NO se hacen aquí: se hacen en Postgres con las funciones de la
 * migración 126, por lo mismo que las tres de la 125. «De los SKU de este
 * cliente, ¿cuántos tienen la oferta destacada?» sobre 13.700 referencias × 90
 * noches son más de un millón de filas para contar trece mil valores, y eso es
 * la clase de consulta que funciona el primer mes y revienta justo cuando el
 * histórico empieza a servir para algo.
 *
 *
 * ============ CUMPLIMIENTO ANTE AMAZON ============
 *
 * Todas las funciones de aquí piden un cliente y devuelven un cliente. NO hay ni
 * una vista que agregue, compare o clasifique entre clientes, y no la va a
 * haber: los datos de un vendedor se usan exclusivamente para operar y asesorar
 * SU cuenta. Los precios y la competencia de una tienda son justamente el tipo de
 * dato que el compromiso firmado obliga a mantener separado.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '../eventos'
import { conexionesDeCliente, unidadesDe } from '../datos'
import {
  CONFIG_BUYBOX_DEFECTO,
  configDeCliente,
  contarColaFoep,
  type ConfigBuyBox,
} from './datos'
import { minutosDeFoep, minutosDeOfertas } from './rotacion'
import type { EstadoBuyBox, Veredicto } from './tipos'

export { isMissingSchema as faltaEsquema }

export const FALTAN_MIGRACIONES =
  'Faltan las tablas del monitor de Buy Box: lanza 126_plataforma_a2_buybox.sql en el editor SQL de Supabase.'

/**
 * Cuántos días vale un diagnóstico.
 *
 * Uno de hace tres semanas no es un diagnóstico, es un recuerdo. Y contarlo como
 * vigente hace que el porcentaje de Buy Box de un cliente no se mueva nunca
 * aunque los barridos hayan dejado de correr — que es exactamente el fallo
 * silencioso que toda esta plataforma existe para evitar.
 */
export const DIAS_VIGENCIA = 7

/* ------------------------------------------------------------------ */
/* 1. El resumen por cuenta y país                                     */
/* ------------------------------------------------------------------ */

export interface ResumenBuyBox {
  connection_id: string
  connection_name: string
  selling_partner_id: string
  marketplace_id: string
  skus_en_seguimiento: number
  diagnosticados: number
  con_buybox: number
  sin_buybox: number
  sin_juicio: number
  con_foep: number
  amazon_indeterminado: number
  con_propuesta: number
  ultima_lectura: string | null
  /** veredicto -> cuántos */
  causas: Record<string, number>
  /** Cuántos esperan FOEP fuera de turno */
  cola_foep: number
}

export async function resumenBuyBox(clientId: string): Promise<ResumenBuyBox[]> {
  const service = createServiceClient()
  const { data, error } = await service.rpc('plataforma_buybox_resumen', {
    p_client_id: clientId,
    p_dias_vigencia: DIAS_VIGENCIA,
  })
  if (error) throw error

  const filas = (data ?? []) as Array<Record<string, unknown>>
  const salida: ResumenBuyBox[] = []

  for (const fila of filas) {
    const connectionId = String(fila.connection_id)
    const marketplaceId = String(fila.marketplace_id ?? '')
    salida.push({
      connection_id: connectionId,
      connection_name: String(fila.connection_name ?? ''),
      selling_partner_id: String(fila.selling_partner_id ?? ''),
      marketplace_id: marketplaceId,
      // Postgres entrega los count(*) como BIGINT y supabase-js los da como
      // cadena. Sin este paso, `a + b` en la pantalla CONCATENA y «12 de 100» se
      // pinta como «12100». Es la misma trampa que ya documentó la 125.
      skus_en_seguimiento: numero(fila.skus_en_seguimiento),
      diagnosticados: numero(fila.diagnosticados),
      con_buybox: numero(fila.con_buybox),
      sin_buybox: numero(fila.sin_buybox),
      sin_juicio: numero(fila.sin_juicio),
      con_foep: numero(fila.con_foep),
      amazon_indeterminado: numero(fila.amazon_indeterminado),
      con_propuesta: numero(fila.con_propuesta),
      ultima_lectura: fila.ultima_lectura ? String(fila.ultima_lectura) : null,
      causas: causasDe(fila.causas),
      cola_foep: await contarColaFoep({
        connectionId,
        sellingPartnerId: String(fila.selling_partner_id ?? ''),
        marketplaceId,
      }),
    })
  }

  return salida
}

/* ------------------------------------------------------------------ */
/* 2. El listado accionable                                            */
/* ------------------------------------------------------------------ */

export interface FilaBuyBox {
  connection_id: string
  connection_name: string
  marketplace_id: string
  sku: string
  asin: string | null
  titulo: string | null
  marca: string | null
  es_fba: boolean | null
  en_seguimiento: boolean
  veredicto: Veredicto
  motivo: string
  accion: string
  prioridad: number
  buybox_estado: EstadoBuyBox
  amazon_estado: 'si' | 'no' | 'indeterminado'
  precio_propio: number | null
  moneda: string | null
  foep: number | null
  foep_estado: 'disponible' | 'no_disponible' | 'no_consultado'
  precio_propuesto: number | null
  precio_propuesto_motivo: string | null
  datos: Record<string, unknown>
  fecha: string
  foep_fecha: string | null
}

export interface FiltroBuyBox {
  clientId: string
  connectionId?: string | null
  marketplaceId?: string | null
  veredictos?: Veredicto[] | null
  busqueda?: string | null
  desde?: number
  limite?: number
}

export async function listadoBuyBox(
  filtro: FiltroBuyBox
): Promise<{ filas: FilaBuyBox[]; total: number }> {
  const service = createServiceClient()
  const { data, error } = await service.rpc('plataforma_buybox_listado', {
    p_client_id: filtro.clientId,
    p_connection_id: filtro.connectionId ?? null,
    p_marketplace_id: filtro.marketplaceId ?? null,
    p_veredictos: filtro.veredictos && filtro.veredictos.length > 0 ? filtro.veredictos : null,
    p_busqueda: filtro.busqueda ?? null,
    p_dias_vigencia: DIAS_VIGENCIA,
    p_desde: filtro.desde ?? 0,
    p_limite: filtro.limite ?? 200,
  })
  if (error) throw error

  const filas = (data ?? []) as Array<Record<string, unknown>>
  return {
    filas: filas.map((f) => ({
      connection_id: String(f.connection_id),
      connection_name: String(f.connection_name ?? ''),
      marketplace_id: String(f.marketplace_id ?? ''),
      sku: String(f.sku),
      asin: f.asin ? String(f.asin) : null,
      titulo: f.titulo ? String(f.titulo) : null,
      marca: f.marca ? String(f.marca) : null,
      es_fba: typeof f.es_fba === 'boolean' ? f.es_fba : null,
      en_seguimiento: f.en_seguimiento === true,
      veredicto: String(f.veredicto) as Veredicto,
      motivo: String(f.motivo ?? ''),
      accion: String(f.accion ?? ''),
      prioridad: numero(f.prioridad),
      buybox_estado: String(f.buybox_estado ?? 'desconocido') as EstadoBuyBox,
      amazon_estado: String(f.amazon_estado ?? 'indeterminado') as FilaBuyBox['amazon_estado'],
      precio_propio: opcional(f.precio_propio),
      moneda: f.moneda ? String(f.moneda) : null,
      foep: opcional(f.foep),
      foep_estado: String(f.foep_estado ?? 'no_consultado') as FilaBuyBox['foep_estado'],
      precio_propuesto: opcional(f.precio_propuesto),
      precio_propuesto_motivo: f.precio_propuesto_motivo
        ? String(f.precio_propuesto_motivo)
        : null,
      datos: (f.datos ?? {}) as Record<string, unknown>,
      fecha: String(f.fecha),
      foep_fecha: f.foep_fecha ? String(f.foep_fecha) : null,
    })),
    total: filas.length > 0 ? numero(filas[0].total) : 0,
  }
}

/* ------------------------------------------------------------------ */
/* 3. El histórico de un SKU — lo que sustituye a Keepa                */
/* ------------------------------------------------------------------ */

export interface PuntoSerie {
  f: string
  b: EstadoBuyBox
  p: number | null
  bb: number | null
  c: number | null
  cm: number | null
  foep: number | null
}

export interface HistoricoSku {
  lecturas: number
  lecturas_con_juicio: number
  con_buybox: number
  sin_buybox: number
  nadie: number
  /**
   * El porcentaje del tiempo con la oferta destacada.
   *
   * EL DENOMINADOR EXCLUYE LAS LECTURAS SIN DATO. Contar un fallo de red como
   * «perdida» baja el porcentaje que se le enseña al cliente en la reunión, y
   * ese número es justo el que este módulo existe para poder defender.
   *
   * null cuando no hay ni una lectura con juicio: 0 % y «no lo sabemos» no son
   * lo mismo y no se pintan igual.
   */
  porcentaje: number | null
  primera: string | null
  ultima: string | null
  competidores_min: number | null
  competidores_max: number | null
  competidores_ultimo: number | null
  precio_competidor_min_visto: number | null
  foep_min: number | null
  foep_max: number | null
  serie: PuntoSerie[]
}

export interface CompetidorHistorico {
  vendedor: string
  es_nuestro: boolean
  veces_visto: number
  veces_destacada: number
  primera: string | null
  ultima: string | null
  precio_min: number | null
  precio_max: number | null
  precio_ultimo: number | null
  canal_ultimo: string | null
}

export async function historicoSku(params: {
  connectionId: string
  marketplaceId: string
  sku: string
  dias?: number
}): Promise<{ historico: HistoricoSku; competidores: CompetidorHistorico[] }> {
  const service = createServiceClient()
  const dias = params.dias ?? 90

  const [resumen, competencia] = await Promise.all([
    service.rpc('plataforma_buybox_historico_sku', {
      p_connection_id: params.connectionId,
      p_marketplace_id: params.marketplaceId,
      p_sku: params.sku,
      p_dias: dias,
    }),
    service.rpc('plataforma_buybox_competidores_sku', {
      p_connection_id: params.connectionId,
      p_marketplace_id: params.marketplaceId,
      p_sku: params.sku,
      p_dias: dias,
    }),
  ])

  if (resumen.error) throw resumen.error
  if (competencia.error) throw competencia.error

  const fila = ((resumen.data ?? []) as Array<Record<string, unknown>>)[0] ?? {}
  const conJuicio = numero(fila.lecturas_con_juicio)

  return {
    historico: {
      lecturas: numero(fila.lecturas),
      lecturas_con_juicio: conJuicio,
      con_buybox: numero(fila.con_buybox),
      sin_buybox: numero(fila.sin_buybox),
      nadie: numero(fila.nadie),
      porcentaje: conJuicio > 0 ? (numero(fila.con_buybox) / conJuicio) * 100 : null,
      primera: fila.primera ? String(fila.primera) : null,
      ultima: fila.ultima ? String(fila.ultima) : null,
      competidores_min: opcional(fila.competidores_min),
      competidores_max: opcional(fila.competidores_max),
      competidores_ultimo: opcional(fila.competidores_ultimo),
      precio_competidor_min_visto: opcional(fila.precio_competidor_min_visto),
      foep_min: opcional(fila.foep_min),
      foep_max: opcional(fila.foep_max),
      serie: Array.isArray(fila.serie) ? (fila.serie as PuntoSerie[]) : [],
    },
    competidores: ((competencia.data ?? []) as Array<Record<string, unknown>>).map((c) => ({
      vendedor: String(c.vendedor),
      es_nuestro: c.es_nuestro === true,
      veces_visto: numero(c.veces_visto),
      veces_destacada: numero(c.veces_destacada),
      primera: c.primera ? String(c.primera) : null,
      ultima: c.ultima ? String(c.ultima) : null,
      precio_min: opcional(c.precio_min),
      precio_max: opcional(c.precio_max),
      precio_ultimo: opcional(c.precio_ultimo),
      canal_ultimo: c.canal_ultimo ? String(c.canal_ultimo) : null,
    })),
  }
}

/* ------------------------------------------------------------------ */
/* 4. La configuración y LO QUE FALTA POR DECIDIR                      */
/* ------------------------------------------------------------------ */

export interface DecisionPendiente {
  clave: string
  titulo: string
  /** Qué pasa mientras no se decida. En español y sin rodeos */
  consecuencia: string
}

export interface ConfigPantalla {
  config: ConfigBuyBox
  /**
   * Lo que falta por decidir, con su consecuencia.
   *
   * VA A LA PANTALLA A PROPÓSITO. La especificación es literal: «los umbrales,
   * los costes, las reglas de margen y las excepciones por cliente las pongo yo».
   * Así que ninguno viene con número inventado, y para que eso no se lea como
   * «ya está configurado», la pantalla enseña la lista de lo que falta. Que se
   * vea que falta, no que parezca decidido.
   */
  pendientes: DecisionPendiente[]
  /** Lo que cuesta el barrido de este cliente, en minutos, con su catálogo real */
  coste: {
    skus: number
    minutosOfertas: number
    minutosFoepCompleto: number
    minutosFoepPorNoche: number
  }
}

export async function configPantalla(
  clientId: string,
  skusEnSeguimiento: number
): Promise<ConfigPantalla> {
  const config = await configDeCliente(clientId)
  return {
    config,
    pendientes: decisionesPendientes(config),
    coste: {
      skus: skusEnSeguimiento,
      minutosOfertas: minutosDeOfertas(skusEnSeguimiento),
      minutosFoepCompleto: minutosDeFoep(skusEnSeguimiento),
      minutosFoepPorNoche: minutosDeFoep(
        Math.ceil(skusEnSeguimiento / Math.max(1, config.foepRotacionDias))
      ),
    },
  }
}

/** PURA: la lista de lo que falta por decidir en un cliente */
export function decisionesPendientes(config: ConfigBuyBox): DecisionPendiente[] {
  const pendientes: DecisionPendiente[] = []

  if (config.margenMinimoPct === null) {
    pendientes.push({
      clave: 'margen_minimo_pct',
      titulo: 'Margen mínimo aceptable',
      consecuencia:
        'Sin él, el motor no puede decir si bajar al precio que pide Amazon compensa. Los SKU ' +
        'recuperables salen como «falta criterio» en vez de como «bajar» o «descartar».',
    })
  }
  if (config.deltaFoep === null) {
    pendientes.push({
      clave: 'delta_foep',
      titulo: 'Margen de seguridad por debajo del FOEP',
      consecuencia:
        'Hoy se propone el FOEP exacto. Como el FOEP es un TECHO, ponerse justo en él deja la ' +
        'oferta pegada al borde del umbral: cualquier recálculo de Amazon la tumba.',
    })
  }
  if (config.precioSuelo === null) {
    pendientes.push({
      clave: 'precio_suelo',
      titulo: 'Precio suelo',
      consecuencia:
        'Nada impide que una propuesta baje por debajo del coste. Mientras el modo sea simulacro ' +
        'no se aplica nada, pero la cifra que se enseña puede ser una que no se debería tocar.',
    })
  }
  if (config.precioTecho === null) {
    pendientes.push({
      clave: 'precio_techo',
      titulo: 'Precio techo',
      consecuencia:
        'Nada acota una subida cuando el FOEP permite subir. Es el caso que el repricer nativo de ' +
        'Amazon nunca ve, y también el que más fácil se pasa de frenada.',
    })
  }
  if (config.skusExcluidos.length === 0) {
    pendientes.push({
      clave: 'skus_excluidos',
      titulo: 'SKU con precio mínimo impuesto por la marca (MAP)',
      consecuencia:
        'La lista está vacía. Si algún fabricante impone precio mínimo y ese SKU no está aquí, el ' +
        'motor propondrá bajarlo. Es un riesgo contractual, no técnico.',
    })
  }
  if (Object.keys(config.sellersAmazon).length === 0) {
    pendientes.push({
      clave: 'sellers_amazon',
      titulo: 'Identificadores de vendedor de Amazon Retail',
      consecuencia:
        'Amazon no publica esta lista y no hay ningún campo de la API que identifique su propia ' +
        'oferta. Mientras esté vacía, «¿compite Amazon en este ASIN?» se responde «no se puede ' +
        'saber» siempre que haya competencia, que es lo honesto pero no ayuda a decidir.',
    })
  }

  return pendientes
}

/* ------------------------------------------------------------------ */
/* 4 bis. CUÁNTO HISTÓRICO HAY DE VERDAD                               */
/* ------------------------------------------------------------------ */

/**
 * ============ POR QUÉ ESTO EXISTE, Y POR QUÉ VA A LA PANTALLA ============
 *
 * Este módulo es el que GENERA el histórico que sustituye a Keepa para nuestras
 * referencias. O sea que el día que se enciende NO HAY NINGUNO, y va a seguir
 * sin haberlo durante semanas.
 *
 * Ese estado —«todavía no hay serie»— se parece muchísimo a otro que significa
 * lo contrario: «la serie está y sale plana». Y la pantalla que los confunde
 * miente hacia el lado caro: un 0 % de referencias perdidas con cero lecturas se
 * lee como «vamos perfectos». Por eso todo lo que dependa de la serie —el
 * porcentaje del tiempo con la oferta destacada, la evolución del número de
 * competidores, hasta dónde ha bajado cada uno— se enseña SIEMPRE junto a
 * cuántas lecturas lo sostienen, y cuando no hay ninguna se dice, no se pinta un
 * cero ni un gráfico vacío.
 */

/**
 * A partir de cuántas lecturas con juicio el porcentaje del tiempo con oferta
 * destacada se puede enseñar sin coletilla.
 *
 * NO ES UN UMBRAL DE NEGOCIO —los umbrales de negocio de este módulo están todos
 * a `null` en la configuración del cliente y los pone una persona—: es un
 * criterio de LECTURA del dato, igual que DIAS_VIGENCIA de más arriba. Siete son
 * una semana de barridos nocturnos, y el motivo es aritmético: con N lecturas,
 * cada una pesa 100/N puntos del porcentaje. Con tres lecturas una sola noche
 * mueve el número 33 puntos, así que ese porcentaje no describe el mes: describe
 * la última subasta.
 *
 * La pantalla enseña además ese peso (100/N) al lado, que es el dato que de
 * verdad dice cuánto fiarse y no depende de ninguna constante.
 */
export const LECTURAS_PARA_SERIE = 7

export interface HistoricoDisponible {
  connection_id: string
  marketplace_id: string
  /** El diagnóstico más antiguo guardado. null = nunca se ha diagnosticado */
  primera: string | null
  ultima: string | null
  /** Días transcurridos desde la primera lectura. null cuando no hay ninguna */
  dias: number | null
  /**
   * Barridos de precios TERMINADOS sobre esta cuenta.
   *
   * Se cuenta por conexión y no por conexión + país porque un barrido recorre
   * todos los países de la cuenta en la misma pasada: contarlo por país
   * multiplicaría el mismo trabajo por cuatro y diría que hay cuatro veces más
   * histórico del que hay.
   */
  barridos: number
}

/**
 * Cuánto histórico hay, por cuenta y país.
 *
 * Tres consultas por unidad, las tres por índice: el diagnóstico más antiguo y
 * el más nuevo van por idx_amazon_buybox_diag_unidad (connection_id,
 * marketplace_id, fecha DESC), y el recuento de barridos va sobre amazon_jobs,
 * que tiene una fila por pasada y no una por referencia.
 *
 * NO se cuenta «cuántas noches distintas hay en los snapshots»: eso es un
 * DISTINCT sobre la tabla que crece para siempre —13.700 referencias por noche—
 * y es la clase de consulta que funciona el primer mes y revienta justo cuando
 * el histórico empieza a servir para algo.
 */
export async function historicoDisponible(clientId: string): Promise<HistoricoDisponible[]> {
  const service = createServiceClient()
  const unidades = unidadesDe(await conexionesDeCliente(clientId))
  const ahora = Date.now()
  const salida: HistoricoDisponible[] = []

  for (const unidad of unidades) {
    const base = () =>
      service
        .from('amazon_buybox_diagnostico')
        .select('fecha')
        .eq('connection_id', unidad.connectionId)
        .eq('marketplace_id', unidad.marketplaceId)

    const [antigua, reciente, barridos] = await Promise.all([
      base().order('fecha', { ascending: true }).limit(1),
      base().order('fecha', { ascending: false }).limit(1),
      service
        .from('amazon_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('tipo', 'snapshot_precios')
        .eq('connection_id', unidad.connectionId)
        .eq('estado', 'terminado'),
    ])

    if (antigua.error) throw antigua.error
    if (reciente.error) throw reciente.error
    if (barridos.error) throw barridos.error

    const primera = (antigua.data ?? [])[0]?.fecha ? String((antigua.data ?? [])[0].fecha) : null
    const ultima = (reciente.data ?? [])[0]?.fecha ? String((reciente.data ?? [])[0].fecha) : null
    const t = primera ? Date.parse(primera) : NaN

    salida.push({
      connection_id: unidad.connectionId,
      marketplace_id: unidad.marketplaceId,
      primera,
      ultima,
      dias: Number.isFinite(t) ? Math.max(0, Math.floor((ahora - t) / 86400000)) : null,
      barridos: barridos.count ?? 0,
    })
  }

  return salida
}

/* ------------------------------------------------------------------ */
/* 5. La exportación                                                   */
/* ------------------------------------------------------------------ */

/**
 * El CSV que se le enseña al cliente.
 *
 * SEPARADOR PUNTO Y COMA Y BOM. No es capricho: Excel en español abre un CSV con
 * comas metiendo la fila entera en la columna A, y sin BOM se come los acentos.
 * Es lo mismo que ya hace el resto del ERP con sus exportaciones.
 *
 * Y va el MOTIVO ENTERO, no solo la etiqueta. Es la mitad del valor de este
 * módulo: un cliente que recibe «no recuperable» discute; uno que recibe «bajar
 * a 24,90 € dejaría un 3,1 % de margen, por debajo de tu mínimo del 12 %, y quien
 * la tiene entrega por FBA» entiende.
 */
export function csvDeBuyBox(filas: FilaBuyBox[], nombreMarketplace: (id: string) => string): string {
  const cabeceras = [
    'Cuenta',
    'País',
    'SKU',
    'ASIN',
    'Título',
    'Marca',
    'Canal',
    'Oferta destacada',
    'Precio propio',
    'Moneda',
    'FOEP',
    'Estado del FOEP',
    'Veredicto',
    'Por qué',
    'Acción sugerida',
    'Precio propuesto (SIMULACRO)',
    'Por qué ese precio',
    'Amazon en el ASIN',
    'Competidores',
    'Leído',
    'FOEP leído',
  ]

  const lineas = [cabeceras.join(';')]

  for (const f of filas) {
    lineas.push(
      [
        f.connection_name,
        nombreMarketplace(f.marketplace_id),
        f.sku,
        f.asin ?? '',
        f.titulo ?? '',
        f.marca ?? '',
        f.es_fba === null ? '' : f.es_fba ? 'FBA' : 'Vendedor',
        etiquetaBuybox(f.buybox_estado),
        numeroCsv(f.precio_propio),
        f.moneda ?? '',
        numeroCsv(f.foep),
        etiquetaFoep(f.foep_estado),
        f.veredicto,
        f.motivo,
        f.accion,
        numeroCsv(f.precio_propuesto),
        f.precio_propuesto_motivo ?? '',
        etiquetaAmazon(f.amazon_estado),
        String(f.datos.competidores ?? ''),
        f.fecha,
        f.foep_fecha ?? '',
      ]
        .map(escapar)
        .join(';')
    )
  }

  return `﻿${lineas.join('\r\n')}\r\n`
}

function escapar(valor: string): string {
  const texto = String(valor ?? '')
  if (/[";\r\n]/.test(texto)) return `"${texto.replace(/"/g, '""')}"`
  return texto
}

/** Coma decimal: es lo que espera Excel en español */
function numeroCsv(valor: number | null): string {
  if (valor === null || !Number.isFinite(valor)) return ''
  return valor.toFixed(2).replace('.', ',')
}

function etiquetaBuybox(estado: EstadoBuyBox): string {
  if (estado === 'nuestra') return 'La tenemos'
  if (estado === 'de_otro') return 'La tiene otro'
  if (estado === 'nadie') return 'No la tiene nadie'
  return 'Sin dato'
}

function etiquetaFoep(estado: string): string {
  if (estado === 'disponible') return 'Amazon da precio'
  if (estado === 'no_disponible') return 'Amazon no da precio'
  return 'No preguntado en esta ronda'
}

function etiquetaAmazon(estado: string): string {
  if (estado === 'si') return 'Sí'
  if (estado === 'no') return 'No'
  return 'No se puede saber'
}

/* ------------------------------------------------------------------ */

function numero(valor: unknown): number {
  const n = Number(valor)
  return Number.isFinite(n) ? n : 0
}

function opcional(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null
  const n = Number(valor)
  return Number.isFinite(n) ? n : null
}

function causasDe(valor: unknown): Record<string, number> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return {}
  const salida: Record<string, number> = {}
  for (const [clave, n] of Object.entries(valor as Record<string, unknown>)) {
    salida[clave] = numero(n)
  }
  return salida
}

export { CONFIG_BUYBOX_DEFECTO }
export type { ConfigBuyBox }
