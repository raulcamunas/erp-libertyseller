/**
 * PLATAFORMA · MÓDULO A4 — LO QUE SE LEE Y SE ESCRIBE EN LA BASE
 * =============================================================
 * SOLO SERVIDOR: importa el cliente de service_role. Gemelo de
 * lib/plataforma/buybox/datos.ts.
 *
 * Aquí NO se decide nada. Este fichero lee filas y las traduce; el margen, los
 * umbrales y el veredicto viven en margen.ts y analisis.ts, que son funciones
 * puras y se comprueban con scripts/check-margen-fbmfba.ts sin levantar nada.
 * Repartir la decisión entre la consulta y el motor es como se llega a que el
 * número de la pantalla y el del informe no cuadren y nadie sepa cuál está mal.
 *
 *
 * ============ CUMPLIMIENTO ANTE AMAZON ============
 *
 * Todas las funciones piden un cliente —o una cuenta suya— y devuelven ese
 * cliente. No hay ni una consulta que agregue, compare o clasifique entre
 * clientes, y no la va a haber: los datos de un vendedor se usan exclusivamente
 * para operar y asesorar SU cuenta. El catálogo, los costes y las tarifas de una
 * tienda son justo el tipo de dato que el compromiso firmado obliga a mantener
 * separado.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '../eventos'
import type { UnidadDeTrabajo } from '../datos'
import { CONFIG_A4_DEFECTO, type ConfigFbmFba } from './tipos'
import { fiscalSinConfigurar, type ParametrosFiscales } from './fiscal'

export { isMissingSchema }

/** Cuántas referencias se piden a la base de una vez */
const PASO_CATALOGO = 1000

/**
 * Cuántos días vale un diagnóstico de Buy Box para este análisis.
 *
 * Es el mismo número que usa el monitor (DIAS_VIGENCIA de A2) y no es una
 * coincidencia: de ahí sale QUIÉN TIENE HOY LA OFERTA DESTACADA, y sin eso el
 * precio de referencia de Amazon no se puede interpretar. Uno de hace tres
 * semanas diría que la tenemos cuando ya no, y entonces A4 calcularía el margen
 * al precio de hoy en vez de al precio al que habría que bajar.
 */
export const DIAS_VIGENCIA_A4 = 7

/* ------------------------------------------------------------------ */
/* 1. Los umbrales del cliente                                         */
/* ------------------------------------------------------------------ */

/**
 * La configuración de un cliente, o la de arranque si no tiene.
 *
 * La de arranque trae TODO LO DE NEGOCIO A `null`, y `null` significa NO
 * RECOMENDAR. No es pereza: un número inventado por el programa es
 * indistinguible de uno decidido, y lo que este módulo propone es meter
 * mercancía ajena en un almacén del que sacarla cuesta dinero.
 */
export async function configDeCliente(clientId: string): Promise<ConfigFbmFba> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_fbmfba_config')
    .select('*')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw error

  if (!data) return { clientId, ...CONFIG_A4_DEFECTO }

  const fila = data as Record<string, unknown>
  return {
    clientId,
    id: String(fila.id),
    colchonMargenPct: opcional(fila.colchon_margen_pct),
    mejoraMinimaPuntos: opcional(fila.mejora_minima_puntos),
    rotacionMinimaUnidades: opcional(fila.rotacion_minima_unidades),
    rotacionVentanaDias:
      opcional(fila.rotacion_ventana_dias) ?? CONFIG_A4_DEFECTO.rotacionVentanaDias,
    bsrMaximo: opcional(fila.bsr_maximo),
    exigirDimensionesFiables: fila.exigir_dimensiones_fiables !== false,
    toleranciaTarifaPct:
      opcional(fila.tolerancia_tarifa_pct) ?? CONFIG_A4_DEFECTO.toleranciaTarifaPct,
    notas: texto(fila.notas),
    updatedAt: fila.updated_at ? String(fila.updated_at) : null,
  }
}

/** Lo que se puede cambiar de la configuración. Todo anulable menos los técnicos */
export interface PatchConfigA4 {
  colchonMargenPct?: number | null
  mejoraMinimaPuntos?: number | null
  rotacionMinimaUnidades?: number | null
  rotacionVentanaDias?: number
  bsrMaximo?: number | null
  exigirDimensionesFiables?: boolean
  toleranciaTarifaPct?: number
  notas?: string | null
}

/**
 * Guarda los umbrales.
 *
 * `null` SE GUARDA COMO `null` y no se ignora: borrar un umbral es una decisión
 * tan legítima como ponerlo —«ya no quiero que el ranking descarte a nadie»— y
 * un guardado que solo sabe escribir números convierte esa decisión en
 * imposible. Por eso el patch distingue «no viene la clave» de «viene a null».
 */
export async function guardarConfig(
  clientId: string,
  patch: PatchConfigA4,
  userId: string | null
): Promise<ConfigFbmFba> {
  const service = createServiceClient()
  const fila: Record<string, unknown> = { client_id: clientId, is_active: true }

  if ('colchonMargenPct' in patch) fila.colchon_margen_pct = patch.colchonMargenPct
  if ('mejoraMinimaPuntos' in patch) fila.mejora_minima_puntos = patch.mejoraMinimaPuntos
  if ('rotacionMinimaUnidades' in patch) fila.rotacion_minima_unidades = patch.rotacionMinimaUnidades
  if ('rotacionVentanaDias' in patch) fila.rotacion_ventana_dias = patch.rotacionVentanaDias
  if ('bsrMaximo' in patch) fila.bsr_maximo = patch.bsrMaximo
  if ('exigirDimensionesFiables' in patch) {
    fila.exigir_dimensiones_fiables = patch.exigirDimensionesFiables
  }
  if ('toleranciaTarifaPct' in patch) fila.tolerancia_tarifa_pct = patch.toleranciaTarifaPct
  if ('notas' in patch) fila.notas = patch.notas

  const actual = await configDeCliente(clientId)
  if (actual.id) {
    fila.updated_by = userId
    const { error } = await service.from('amazon_fbmfba_config').update(fila).eq('id', actual.id)
    if (error) throw error
  } else {
    fila.created_by = userId
    fila.updated_by = userId
    const { error } = await service.from('amazon_fbmfba_config').insert(fila)
    if (error) throw error
  }

  return configDeCliente(clientId)
}

/* ------------------------------------------------------------------ */
/* 2. El impuesto del marketplace                                      */
/* ------------------------------------------------------------------ */

/**
 * QUÉ FILA APLICA: la del cliente si la hay, si no la general, y dentro de cada
 * una la de `valido_desde` más alto que no supere la fecha.
 *
 * La excepción por cliente existe porque el régimen fiscal no es solo del país:
 * un cliente acogido a un régimen distinto, o que vende una categoría con tipo
 * reducido, no tributa como el de al lado aunque vendan en el mismo sitio.
 *
 * Y devuelve `sin_configurar` —no un tipo supuesto— cuando no hay ninguna fila.
 * Ese estado es el que hace que A4 se quede sin número y lo diga, en vez de
 * dividir por un 21 % en Estados Unidos, donde el impuesto va fuera del precio.
 */
export async function fiscalDe(
  /** null = solo la regla general. Es lo que se lee al editar esa regla */
  clientId: string | null,
  marketplaceIds: string[],
  fecha: string
): Promise<Map<string, ParametrosFiscales>> {
  const salida = new Map<string, ParametrosFiscales>()
  for (const id of marketplaceIds) salida.set(id, fiscalSinConfigurar(id))
  if (marketplaceIds.length === 0) return salida

  const service = createServiceClient()
  let consulta = service
    .from('amazon_fiscal_marketplace')
    .select('*')
    .in('marketplace_id', marketplaceIds)
  consulta = clientId
    ? consulta.or(`client_id.eq.${clientId},client_id.is.null`)
    : consulta.is('client_id', null)

  const { data, error } = await consulta
    .lte('valido_desde', fecha)
    // De la más vieja a la más nueva y de la general a la del cliente: la
    // última que se escribe en el mapa gana, y así el orden hace la resolución
    // sin una segunda pasada.
    .order('valido_desde', { ascending: true })
    .order('client_id', { ascending: true, nullsFirst: true })
  if (error) throw error

  for (const cruda of (data ?? []) as Array<Record<string, unknown>>) {
    const marketplaceId = String(cruda.marketplace_id)
    const delCliente = cruda.client_id !== null && cruda.client_id !== undefined
    const previo = salida.get(marketplaceId)
    // Una fila general NUNCA pisa a una del cliente, por muy nueva que sea: la
    // excepción del cliente es una decisión y la general es el caso por defecto.
    if (previo && previo.ambito === 'cliente' && !delCliente) continue

    salida.set(marketplaceId, {
      marketplaceId,
      ivaPorcentaje: opcional(cruda.iva_porcentaje),
      precioIncluyeImpuesto:
        typeof cruda.precio_incluye_impuesto === 'boolean' ? cruda.precio_incluye_impuesto : null,
      validoDesde: cruda.valido_desde ? String(cruda.valido_desde) : null,
      actualizadoPor: cruda.updated_by ? String(cruda.updated_by) : null,
      ambito: delCliente ? 'cliente' : 'general',
      notas: texto(cruda.notas),
    })
  }

  return salida
}

export interface PatchFiscal {
  marketplaceId: string
  /** null = la regla general del marketplace, para todos los clientes */
  clientId: string | null
  ivaPorcentaje: number | null
  precioIncluyeImpuesto: boolean | null
  validoDesde: string
  notas: string | null
}

/**
 * Escribe un tramo de impuesto.
 *
 * NO SOBREESCRIBE EL HISTÓRICO: cada `valido_desde` es un tramo, y volver a
 * guardar la misma fecha corrige ese tramo. Los tipos cambian por ley y el
 * margen que se le enseñó a un cliente en marzo tiene que seguir cuadrando con
 * el tipo de marzo.
 */
export async function guardarFiscal(patch: PatchFiscal, userId: string | null): Promise<void> {
  const service = createServiceClient()

  let consulta = service
    .from('amazon_fiscal_marketplace')
    .select('id')
    .eq('marketplace_id', patch.marketplaceId)
    .eq('valido_desde', patch.validoDesde)
  consulta = patch.clientId
    ? consulta.eq('client_id', patch.clientId)
    : consulta.is('client_id', null)

  const { data, error } = await consulta.maybeSingle()
  if (error) throw error

  const fila = {
    client_id: patch.clientId,
    marketplace_id: patch.marketplaceId,
    valido_desde: patch.validoDesde,
    iva_porcentaje: patch.ivaPorcentaje,
    precio_incluye_impuesto: patch.precioIncluyeImpuesto,
    notas: patch.notas,
    updated_by: userId,
  }

  if (data) {
    const { error: fallo } = await service
      .from('amazon_fiscal_marketplace')
      .update(fila)
      .eq('id', (data as { id: string }).id)
    if (fallo) throw fallo
    return
  }

  const { error: fallo } = await service
    .from('amazon_fiscal_marketplace')
    .insert({ ...fila, created_by: userId })
  if (fallo) throw fallo
}

/* ------------------------------------------------------------------ */
/* 3. El catálogo con su última foto de todo                           */
/* ------------------------------------------------------------------ */

/**
 * Una referencia con lo último que se sabe de ella, TAL CUAL SALE DE LA BASE.
 *
 * Todo lo anulable lo es de verdad: `null` significa «no lo sabemos» en cada uno
 * de estos campos, nunca cero. Es la regla que sostiene el módulo entero, y el
 * sitio donde se rompe siempre es una traducción como esta.
 */
export interface FilaCruda {
  sku: string
  asin: string | null
  titulo: string | null
  marca: string | null

  /** El código crudo del canal de logística. NULL = no consta, que no es «lo
      envía el cliente»: `is_fba` colapsa esos dos casos y por eso no se usa */
  fulfillmentChannelCode: string | null
  enSeguimiento: boolean
  clasificacionItem: string | null

  precio: number | null
  moneda: string | null

  hayMedidas: boolean
  dimsOrigen: string | null

  buyboxEstado: string | null
  amazonEstado: string | null
  canalPropio: string | null
  foep: number | null
  foepEstado: string | null
  foepResultado: string | null
  foepFecha: string | null
  diagnosticoFecha: string | null

  feePropio: TarifaCruda
  feeFba: TarifaCruda
  hayFeePreview: boolean
  /** Estimaciones guardadas sin canal. No se pueden usar y hay que decirlo */
  feesSinCanal: number

  bsr: number | null
  bsrTipo: string | null
  bsrCategoria: string | null
  bsrFecha: string | null
}

export interface TarifaCruda {
  precioReferencia: number | null
  moneda: string | null
  referral: number | null
  fba: number | null
  otras: number | null
  origen: string | null
  fecha: string | null
}

/**
 * El catálogo entero de una cuenta y un país, con la última foto de cada serie.
 *
 * Se pide POR TRAMOS y se junta aquí. El tope no es decorativo: sin él, un
 * cliente que crezca a cien mil referencias tumbaría la pantalla, y prefiero que
 * diga «se han analizado las primeras N» a que se quede pensando. Quien lo lea
 * recibe también el total, para saber que está viendo un trozo.
 */
export async function catalogoDeUnidad(
  unidad: UnidadDeTrabajo,
  tope: number
): Promise<{ filas: FilaCruda[]; total: number; truncado: boolean }> {
  const service = createServiceClient()
  const filas: FilaCruda[] = []
  let total = 0

  for (let desde = 0; desde < tope; desde += PASO_CATALOGO) {
    const limite = Math.min(PASO_CATALOGO, tope - desde)
    const { data, error } = await service.rpc('plataforma_fbmfba_datos', {
      p_connection_id: unidad.connectionId,
      p_selling_partner_id: unidad.sellingPartnerId,
      p_marketplace_id: unidad.marketplaceId,
      p_dias_vigencia: DIAS_VIGENCIA_A4,
      p_desde: desde,
      p_limite: limite,
    })
    if (error) throw error

    const tramo = (data ?? []) as Array<Record<string, unknown>>
    if (tramo.length > 0) total = entero(tramo[0].total) ?? 0
    for (const cruda of tramo) filas.push(traducir(cruda))
    if (tramo.length < limite) break
  }

  return { filas, total, truncado: total > filas.length }
}

function traducir(f: Record<string, unknown>): FilaCruda {
  return {
    sku: String(f.sku),
    asin: texto(f.asin),
    titulo: texto(f.titulo),
    marca: texto(f.marca),
    fulfillmentChannelCode: texto(f.fulfillment_channel_code),
    enSeguimiento: f.en_seguimiento === true,
    clasificacionItem: texto(f.clasificacion_item),
    precio: opcional(f.precio),
    moneda: texto(f.moneda),
    hayMedidas: f.hay_medidas === true,
    dimsOrigen: texto(f.dims_origen),
    buyboxEstado: texto(f.buybox_estado),
    amazonEstado: texto(f.amazon_estado),
    canalPropio: texto(f.canal_propio),
    foep: opcional(f.foep),
    foepEstado: texto(f.foep_estado),
    foepResultado: texto(f.foep_resultado),
    foepFecha: texto(f.foep_fecha),
    diagnosticoFecha: texto(f.diagnostico_fecha),
    feePropio: {
      precioReferencia: opcional(f.fee_propio_precio),
      moneda: texto(f.fee_propio_moneda),
      referral: opcional(f.fee_propio_referral),
      fba: opcional(f.fee_propio_fba),
      otras: opcional(f.fee_propio_otras),
      origen: texto(f.fee_propio_origen),
      fecha: texto(f.fee_propio_fecha),
    },
    feeFba: {
      precioReferencia: opcional(f.fee_fba_precio),
      moneda: texto(f.fee_fba_moneda),
      referral: opcional(f.fee_fba_referral),
      fba: opcional(f.fee_fba_fba),
      otras: opcional(f.fee_fba_otras),
      origen: texto(f.fee_fba_origen),
      fecha: texto(f.fee_fba_fecha),
    },
    hayFeePreview: f.hay_fee_preview === true,
    feesSinCanal: entero(f.fees_sin_canal) ?? 0,
    bsr: entero(f.bsr),
    bsrTipo: texto(f.bsr_tipo),
    bsrCategoria: texto(f.bsr_categoria),
    bsrFecha: texto(f.bsr_fecha),
  }
}

/* ------------------------------------------------------------------ */
/* 4. Las ventas de la ventana                                         */
/* ------------------------------------------------------------------ */

/**
 * Las ventas para la regla de rotación.
 *
 * Pasa por `ventasDesde` de A1 —y no por una consulta propia— porque
 * lib/plataforma/ventas.ts es LA INTERFAZ que la Fase B sustituye por el informe
 * de ventas de Amazon en cuanto llegue el rol que falta. Una consulta directa
 * aquí sería el sitio por el que ese cambio dejaría de ser transparente.
 */
export { ventasDesde } from '../datos'

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const limpio = valor.trim()
  return limpio === '' ? null : limpio
}

/**
 * Un número, o `null`.
 *
 * NUNCA devuelve 0 por descuido, y esa es toda la razón de que exista: Postgres
 * entrega NUMERIC como cadena a través de supabase-js, así que un `Number(x)`
 * suelto convierte `null` en `0` y un coste que no existe pasa a ser un coste de
 * cero. Un margen calculado así sale fantástico y falso.
 */
function opcional(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null
  const n = typeof valor === 'number' ? valor : Number(valor)
  return Number.isFinite(n) ? n : null
}

function entero(valor: unknown): number | null {
  const n = opcional(valor)
  return n === null ? null : Math.round(n)
}
