/**
 * AMAZON ADS · LA CUENTA DE UN CLIENTE: FICHA, PRODUCTOS, ESTRUCTURA Y LOG.
 * SOLO SERVIDOR.
 *
 * Todo cuelga de UNA cuenta de anunciante (`ads_profiles`, «un cliente en un país») y de un cliente concreto: no hay ninguna lectura que mezcle varios. La migración es la 292; sin ella, todo lo de
 * aquí lanza un error que `esSinMigracion` reconoce y la pantalla traduce a «falta lanzar la 292».
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { AMAZON_MARKETPLACES } from '@/lib/types/amazon'
import type { Rol } from './estructura'

export const esSinMigracion = isMissingSchema

/* ------------------------------------------------------------------ */
/* Las cuentas de anunciante de un cliente                             */
/* ------------------------------------------------------------------ */

export interface CuentaDeAnunciante {
  /** Nuestro id (ads_profiles.id) */
  id: string
  /** El de Amazon, el que va en la cabecera de cada llamada */
  profileId: number
  conexionId: string
  pais: string
  moneda: string | null
  nombre: string | null
  tipo: string | null
}

/**
 * Las cuentas de anunciante EN USO de un cliente (una por país), con España primero. Vacío si no tiene Amazon Ads conectado.
 *
 * Se respeta `en_uso`, que es la cerradura que ya tiene Amazon API · Publicidad: Amazon devuelve todas las cuentas a las que llega el correo que autorizó, incluidas las de encargos antiguos, y de las
 * apagadas no se pide ni se escribe nada. Para trabajar un país aquí, se enciende su interruptor «Se usa» allí.
 */
export async function cuentasDeCliente(amazonClientId: string): Promise<CuentaDeAnunciante[]> {
  const service = createServiceClient()
  const { data: conexiones, error } = await service.from('ads_connections').select('id').eq('client_id', amazonClientId)
  if (error) throw error
  const ids = ((conexiones ?? []) as Array<{ id: string }>).map((c) => c.id)
  if (ids.length === 0) return []
  const { data, error: e2 } = await service
    .from('ads_profiles')
    .select('id, profile_id, connection_id, pais, moneda, nombre, tipo')
    .in('connection_id', ids)
    .eq('en_uso', true)
    .order('pais')
  if (e2) throw e2
  const filas = ((data ?? []) as Array<{ id: string; profile_id: number; connection_id: string; pais: string | null; moneda: string | null; nombre: string | null; tipo: string | null }>).sort((a, b) => Number(b.pais === 'ES') - Number(a.pais === 'ES'))
  return filas.map((p) => ({
    id: p.id,
    profileId: Number(p.profile_id),
    conexionId: p.connection_id,
    pais: p.pais ?? '',
    moneda: p.moneda,
    nombre: p.nombre,
    tipo: p.tipo,
  }))
}

/**
 * Las cuentas de anunciante EN USO de varios clientes de una vez (para la barra lateral de Marketing Test), con España primero dentro de cada cliente. Una sola vuelta a la base en vez de una por cliente.
 */
export async function cuentasDeClientes(amazonClientIds: readonly string[]): Promise<Map<string, CuentaDeAnunciante[]>> {
  const salida = new Map<string, CuentaDeAnunciante[]>(amazonClientIds.map((id) => [id, []]))
  if (amazonClientIds.length === 0) return salida
  const service = createServiceClient()
  const { data: conexiones, error } = await service.from('ads_connections').select('id, client_id').in('client_id', [...amazonClientIds])
  if (error) throw error
  const clienteDeConexion = new Map(((conexiones ?? []) as Array<{ id: string; client_id: string }>).map((c) => [c.id, c.client_id]))
  if (clienteDeConexion.size === 0) return salida
  const { data, error: e2 } = await service
    .from('ads_profiles')
    .select('id, profile_id, connection_id, pais, moneda, nombre, tipo')
    .in('connection_id', [...clienteDeConexion.keys()])
    .eq('en_uso', true)
    .order('pais')
  if (e2) throw e2
  for (const p of (data ?? []) as Array<{ id: string; profile_id: number; connection_id: string; pais: string | null; moneda: string | null; nombre: string | null; tipo: string | null }>) {
    const cliente = clienteDeConexion.get(p.connection_id)
    if (!cliente) continue
    salida.get(cliente)?.push({ id: p.id, profileId: Number(p.profile_id), conexionId: p.connection_id, pais: p.pais ?? '', moneda: p.moneda, nombre: p.nombre, tipo: p.tipo })
  }
  for (const lista of salida.values()) lista.sort((a, b) => Number(b.pais === 'ES') - Number(a.pais === 'ES'))
  return salida
}

/** Los clientes (ids de amazon_clients) que tienen alguna cuenta de anunciante en uso: los únicos con los que se puede trabajar en Marketing Test */
export async function clientesConAds(): Promise<Set<string>> {
  const service = createServiceClient()
  const { data: perfiles, error } = await service.from('ads_profiles').select('connection_id').eq('en_uso', true)
  if (error) throw error
  const conexiones = [...new Set(((perfiles ?? []) as Array<{ connection_id: string }>).map((p) => p.connection_id))]
  if (conexiones.length === 0) return new Set()
  const { data, error: e2 } = await service.from('ads_connections').select('client_id').in('id', conexiones)
  if (e2) throw e2
  return new Set(((data ?? []) as Array<{ client_id: string }>).map((c) => c.client_id))
}

/** La cuenta de anunciante por su id, con lo necesario para llamar a Amazon. null si no existe o está apagada */
export async function cuentaPorId(perfilId: string): Promise<(CuentaDeAnunciante & { clienteAmazonId: string | null }) | null> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('ads_profiles')
    .select('id, profile_id, connection_id, pais, moneda, nombre, tipo, en_uso, ads_connections(client_id)')
    .eq('id', perfilId)
    .maybeSingle()
  if (error) throw error
  if (!data || !(data as { en_uso: boolean }).en_uso) return null
  const d = data as unknown as { id: string; profile_id: number; connection_id: string; pais: string | null; moneda: string | null; nombre: string | null; tipo: string | null; ads_connections: { client_id: string } | { client_id: string }[] | null }
  const con = Array.isArray(d.ads_connections) ? d.ads_connections[0] : d.ads_connections
  return { id: d.id, profileId: Number(d.profile_id), conexionId: d.connection_id, pais: d.pais ?? '', moneda: d.moneda, nombre: d.nombre, tipo: d.tipo, clienteAmazonId: con?.client_id ?? null }
}

/** El marketplace de Amazon de un país de Ads. Ads dice «UK»; SP-API, «GB» */
export function marketplaceDePais(pais: string): string | null {
  const codigo = pais === 'UK' ? 'GB' : pais
  return AMAZON_MARKETPLACES.find((m) => m.countryCode === codigo)?.id ?? null
}

/* ------------------------------------------------------------------ */
/* La ficha de cuenta                                                  */
/* ------------------------------------------------------------------ */

export interface FichaDeCuenta {
  fase: 'lanzamiento' | 'crecimiento' | 'madurez'
  acosLanzamientoX: number
  acosMaduroX: number
  tacosObjetivoPct: number
  subidaPresupuestoPct: number
  horasEntreSubidas: number
  cambioPujaPct: number
  diasEntreCambiosPuja: number
  comprasParaExacta: number
  ventanaExactaDias: number
  gastoSinVentaX: number
  clicsMinimosNegativizar: number
  muestraMinimaClics: number
  presupuestoMensual: number | null
  notas: string | null
  firmadaPor: string | null
  firmadaPorNombre: string | null
  firmadaAt: string | null
  /** false = todavía no hay fila: lo que se ve son los valores de arranque del SOP */
  guardada: boolean
}

/** Los «VALOR DE ARRANQUE PROPUESTO» del SOP v5, sección 05 */
export const FICHA_DE_ARRANQUE: Omit<FichaDeCuenta, 'firmadaPor' | 'firmadaPorNombre' | 'firmadaAt' | 'guardada'> = {
  fase: 'lanzamiento',
  acosLanzamientoX: 1.5,
  acosMaduroX: 0.7,
  tacosObjetivoPct: 10,
  subidaPresupuestoPct: 20,
  horasEntreSubidas: 72,
  cambioPujaPct: 10,
  diasEntreCambiosPuja: 7,
  comprasParaExacta: 2,
  ventanaExactaDias: 14,
  gastoSinVentaX: 2,
  clicsMinimosNegativizar: 15,
  muestraMinimaClics: 12,
  presupuestoMensual: null,
  notas: null,
}

type FilaFicha = {
  fase: FichaDeCuenta['fase']
  acos_lanzamiento_x: number
  acos_maduro_x: number
  tacos_objetivo_pct: number
  subida_presupuesto_pct: number
  horas_entre_subidas: number
  cambio_puja_pct: number
  dias_entre_cambios_puja: number
  compras_para_exacta: number
  ventana_exacta_dias: number
  gasto_sin_venta_x: number
  clics_minimos_negativizar: number
  muestra_minima_clics: number
  presupuesto_mensual: number | null
  notas: string | null
  firmada_por: string | null
  firmada_at: string | null
}

const num = (v: unknown) => Number(v)

function deFila(f: FilaFicha, nombreFirmante: string | null): FichaDeCuenta {
  return {
    fase: f.fase,
    acosLanzamientoX: num(f.acos_lanzamiento_x),
    acosMaduroX: num(f.acos_maduro_x),
    tacosObjetivoPct: num(f.tacos_objetivo_pct),
    subidaPresupuestoPct: num(f.subida_presupuesto_pct),
    horasEntreSubidas: f.horas_entre_subidas,
    cambioPujaPct: num(f.cambio_puja_pct),
    diasEntreCambiosPuja: f.dias_entre_cambios_puja,
    comprasParaExacta: f.compras_para_exacta,
    ventanaExactaDias: f.ventana_exacta_dias,
    gastoSinVentaX: num(f.gasto_sin_venta_x),
    clicsMinimosNegativizar: f.clics_minimos_negativizar,
    muestraMinimaClics: f.muestra_minima_clics,
    presupuestoMensual: f.presupuesto_mensual == null ? null : num(f.presupuesto_mensual),
    notas: f.notas,
    firmadaPor: f.firmada_por,
    firmadaPorNombre: nombreFirmante,
    firmadaAt: f.firmada_at,
    guardada: true,
  }
}

const COLUMNAS_FICHA =
  'fase, acos_lanzamiento_x, acos_maduro_x, tacos_objetivo_pct, subida_presupuesto_pct, horas_entre_subidas, cambio_puja_pct, dias_entre_cambios_puja, compras_para_exacta, ventana_exacta_dias, gasto_sin_venta_x, clics_minimos_negativizar, muestra_minima_clics, presupuesto_mensual, notas, firmada_por, firmada_at'

async function nombreDe(userId: string | null): Promise<string | null> {
  if (!userId) return null
  const { data } = await createServiceClient().from('profiles').select('full_name').eq('id', userId).maybeSingle()
  return (data as { full_name: string | null } | null)?.full_name ?? null
}

export async function leerFicha(perfilId: string): Promise<FichaDeCuenta> {
  const service = createServiceClient()
  const { data, error } = await service.from('ads_fichas').select(COLUMNAS_FICHA).eq('perfil_id', perfilId).maybeSingle()
  if (error) throw error
  if (!data) return { ...FICHA_DE_ARRANQUE, firmadaPor: null, firmadaPorNombre: null, firmadaAt: null, guardada: false }
  const f = data as unknown as FilaFicha
  return deFila(f, await nombreDe(f.firmada_por))
}

/** Los campos de la ficha que se pueden editar (todo menos la firma) */
export type CamposDeFicha = Omit<FichaDeCuenta, 'firmadaPor' | 'firmadaPorNombre' | 'firmadaAt' | 'guardada'>

/** ¿Algún número es distinto? Es lo que decide si una edición le quita la firma a la ficha */
export function fichaCambia(antes: CamposDeFicha, despues: CamposDeFicha): boolean {
  return (Object.keys(FICHA_DE_ARRANQUE) as Array<keyof CamposDeFicha>).some((k) => antes[k] !== despues[k])
}

/**
 * Guarda la ficha. Si ya estaba firmada y se cambia CUALQUIER valor, la firma se quita: nadie opera con unos umbrales que la persona que firmó no ha visto. Devuelve la ficha guardada.
 */
export async function guardarFicha(perfilId: string, campos: CamposDeFicha, userId: string): Promise<FichaDeCuenta> {
  const service = createServiceClient()
  const antes = await leerFicha(perfilId)
  const cambia = fichaCambia(antes, { ...campos })
  const perderFirma = antes.firmadaAt != null && cambia
  const { error } = await service.from('ads_fichas').upsert(
    {
      perfil_id: perfilId,
      fase: campos.fase,
      acos_lanzamiento_x: campos.acosLanzamientoX,
      acos_maduro_x: campos.acosMaduroX,
      tacos_objetivo_pct: campos.tacosObjetivoPct,
      subida_presupuesto_pct: campos.subidaPresupuestoPct,
      horas_entre_subidas: campos.horasEntreSubidas,
      cambio_puja_pct: campos.cambioPujaPct,
      dias_entre_cambios_puja: campos.diasEntreCambiosPuja,
      compras_para_exacta: campos.comprasParaExacta,
      ventana_exacta_dias: campos.ventanaExactaDias,
      gasto_sin_venta_x: campos.gastoSinVentaX,
      clics_minimos_negativizar: campos.clicsMinimosNegativizar,
      muestra_minima_clics: campos.muestraMinimaClics,
      presupuesto_mensual: campos.presupuestoMensual,
      notas: campos.notas,
      ...(perderFirma ? { firmada_por: null, firmada_at: null } : {}),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'perfil_id' }
  )
  if (error) throw error
  return leerFicha(perfilId)
}

/** Firma la ficha tal y como está guardada. Hay que haberla guardado antes: se firma lo que se ha visto, no los valores de arranque sin tocar */
export async function firmarFicha(perfilId: string, userId: string): Promise<FichaDeCuenta> {
  const service = createServiceClient()
  const { data } = await service.from('ads_fichas').select('perfil_id').eq('perfil_id', perfilId).maybeSingle()
  if (!data) throw new Error('Guarda primero la ficha: se firma lo que se ha revisado.')
  const { error } = await service.from('ads_fichas').update({ firmada_por: userId, firmada_at: new Date().toISOString() }).eq('perfil_id', perfilId)
  if (error) throw error
  return leerFicha(perfilId)
}

export async function quitarFirma(perfilId: string): Promise<FichaDeCuenta> {
  const { error } = await createServiceClient().from('ads_fichas').update({ firmada_por: null, firmada_at: null }).eq('perfil_id', perfilId)
  if (error) throw error
  return leerFicha(perfilId)
}

/* ------------------------------------------------------------------ */
/* Los productos                                                       */
/* ------------------------------------------------------------------ */

export interface ProductoDeAds {
  id: string
  asin: string
  sku: string
  titulo: string | null
  resumen: string
  precio: number | null
  ivaPct: number
  costeProducto: number | null
  comisionPct: number
  tarifaFba: number
  otrosCostes: number
  activo: boolean
  notas: string | null
}

const COLUMNAS_PRODUCTO = 'id, asin, sku, titulo, resumen, precio, iva_pct, coste_producto, comision_pct, tarifa_fba, otros_costes, activo, notas'

function productoDeFila(f: Record<string, unknown>): ProductoDeAds {
  const n = (v: unknown) => (v == null ? null : Number(v))
  return {
    id: f.id as string,
    asin: f.asin as string,
    sku: f.sku as string,
    titulo: (f.titulo as string | null) ?? null,
    resumen: f.resumen as string,
    precio: n(f.precio),
    ivaPct: Number(f.iva_pct),
    costeProducto: n(f.coste_producto),
    comisionPct: Number(f.comision_pct),
    tarifaFba: Number(f.tarifa_fba),
    otrosCostes: Number(f.otros_costes),
    activo: f.activo as boolean,
    notas: (f.notas as string | null) ?? null,
  }
}

export async function productosDeCuenta(perfilId: string): Promise<ProductoDeAds[]> {
  const { data, error } = await createServiceClient().from('ads_productos').select(COLUMNAS_PRODUCTO).eq('perfil_id', perfilId).order('created_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as Array<Record<string, unknown>>).map(productoDeFila)
}

export async function productoDeCuenta(perfilId: string, productoId: string): Promise<ProductoDeAds | null> {
  const { data, error } = await createServiceClient().from('ads_productos').select(COLUMNAS_PRODUCTO).eq('perfil_id', perfilId).eq('id', productoId).maybeSingle()
  if (error) throw error
  return data ? productoDeFila(data as Record<string, unknown>) : null
}

export type CamposDeProducto = Omit<ProductoDeAds, 'id'>

const aFila = (c: CamposDeProducto) => ({
  asin: c.asin.trim().toUpperCase(),
  sku: c.sku.trim(),
  titulo: c.titulo,
  resumen: c.resumen,
  precio: c.precio,
  iva_pct: c.ivaPct,
  coste_producto: c.costeProducto,
  comision_pct: c.comisionPct,
  tarifa_fba: c.tarifaFba,
  otros_costes: c.otrosCostes,
  activo: c.activo,
  notas: c.notas,
})

export async function crearProducto(perfilId: string, c: CamposDeProducto, userId: string): Promise<ProductoDeAds> {
  const { data, error } = await createServiceClient().from('ads_productos').insert({ perfil_id: perfilId, created_by: userId, ...aFila(c) }).select(COLUMNAS_PRODUCTO).single()
  if (error) throw error
  return productoDeFila(data as Record<string, unknown>)
}

export async function actualizarProducto(perfilId: string, productoId: string, c: CamposDeProducto): Promise<ProductoDeAds> {
  const { data, error } = await createServiceClient()
    .from('ads_productos')
    .update({ ...aFila(c), updated_at: new Date().toISOString() })
    .eq('perfil_id', perfilId)
    .eq('id', productoId)
    .select(COLUMNAS_PRODUCTO)
    .single()
  if (error) throw error
  return productoDeFila(data as Record<string, unknown>)
}

/** Quita un producto. Con campañas creadas por el ERP NO se puede: borrar la fila perdería a qué producto pertenece cada una */
export async function quitarProducto(perfilId: string, productoId: string): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const service = createServiceClient()
  const { count, error } = await service.from('ads_estructuras').select('id', { count: 'exact', head: true }).eq('producto_id', productoId)
  if (error) throw error
  if ((count ?? 0) > 0) return { ok: false, motivo: 'Este producto ya tiene campañas creadas desde el ERP. Márcalo como inactivo en vez de quitarlo.' }
  const { error: e2 } = await service.from('ads_productos').delete().eq('perfil_id', perfilId).eq('id', productoId)
  if (e2) throw e2
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* El catálogo de la cuenta, para elegir producto                      */
/* ------------------------------------------------------------------ */

export interface ProductoDelCatalogo {
  sku: string
  asin: string
  titulo: string | null
  precio: number | null
  moneda: string | null
  stockFba: number | null
  yaAnadido: boolean
}

/**
 * Los productos de la cuenta de Amazon del cliente EN EL PAÍS de esta cuenta de anunciante, para elegir cuál anunciar. Salen del catálogo que ya se sincroniza (SP-API), no de Ads: un producto
 * nuevo sin ninguna campaña no aparecería en Ads y es justo el que hay que poder elegir.
 *
 * Solo con ASIN, y los activos primero. `q` busca en SKU, ASIN y título.
 */
export async function catalogoDeCuenta(cuenta: { clienteAmazonId: string | null; pais: string; id: string }, q: string): Promise<ProductoDelCatalogo[]> {
  if (!cuenta.clienteAmazonId) return []
  const marketplace = marketplaceDePais(cuenta.pais)
  if (!marketplace) return []
  const service = createServiceClient()
  const { data: conexiones, error } = await service.from('amazon_connections').select('id').eq('client_id', cuenta.clienteAmazonId).eq('is_active', true)
  if (error) throw error
  const ids = ((conexiones ?? []) as Array<{ id: string }>).map((c) => c.id)
  if (ids.length === 0) return []

  let consulta = service
    .from('amazon_listings')
    .select('sku, asin, title, price, currency, fba_fulfillable_quantity, listing_status')
    .in('connection_id', ids)
    .eq('marketplace_id', marketplace)
    .not('asin', 'is', null)
    .order('listing_status', { ascending: true })
    .limit(60)
  const termino = q.trim().replace(/[%,()]/g, ' ').slice(0, 60)
  if (termino) consulta = consulta.or(`sku.ilike.%${termino}%,asin.ilike.%${termino}%,title.ilike.%${termino}%`)
  const { data, error: e2 } = await consulta
  if (e2) throw e2

  const { data: ya } = await service.from('ads_productos').select('asin, sku').eq('perfil_id', cuenta.id)
  const añadidos = new Set(((ya ?? []) as Array<{ asin: string; sku: string }>).map((p) => `${p.asin}|${p.sku}`))

  return ((data ?? []) as Array<{ sku: string; asin: string; title: string | null; price: number | null; currency: string | null; fba_fulfillable_quantity: number | null }>).map((l) => ({
    sku: l.sku,
    asin: l.asin,
    titulo: l.title,
    precio: l.price == null ? null : Number(l.price),
    moneda: l.currency,
    stockFba: l.fba_fulfillable_quantity,
    yaAnadido: añadidos.has(`${l.asin}|${l.sku}`),
  }))
}

/* ------------------------------------------------------------------ */
/* La estructura creada y el log                                       */
/* ------------------------------------------------------------------ */

export interface EstructuraCreada {
  id: string
  productoId: string
  rol: Rol
  campaignId: string
  adGroupId: string | null
  nombre: string
  presupuestoDiario: number | null
  pujaBase: number | null
  creadaAt: string
}

export async function estructurasDeCuenta(perfilId: string): Promise<EstructuraCreada[]> {
  const { data, error } = await createServiceClient().from('ads_estructuras').select('id, producto_id, rol, campaign_id, ad_group_id, nombre, presupuesto_diario, puja_base, created_at').eq('perfil_id', perfilId).order('created_at', { ascending: true })
  if (error) throw error
  return ((data ?? []) as Array<Record<string, unknown>>).map((f) => ({
    id: f.id as string,
    productoId: f.producto_id as string,
    rol: f.rol as Rol,
    campaignId: f.campaign_id as string,
    adGroupId: (f.ad_group_id as string | null) ?? null,
    nombre: f.nombre as string,
    presupuestoDiario: f.presupuesto_diario == null ? null : Number(f.presupuesto_diario),
    pujaBase: f.puja_base == null ? null : Number(f.puja_base),
    creadaAt: f.created_at as string,
  }))
}

export interface NuevaEstructura {
  perfilId: string
  productoId: string
  rol: Rol
  campaignId: string
  adGroupId: string | null
  nombre: string
  presupuestoDiario: number
  pujaBase: number
  userId: string
}

export async function guardarEstructura(e: NuevaEstructura): Promise<void> {
  const { error } = await createServiceClient().from('ads_estructuras').insert({
    perfil_id: e.perfilId,
    producto_id: e.productoId,
    rol: e.rol,
    campaign_id: e.campaignId,
    ad_group_id: e.adGroupId,
    nombre: e.nombre,
    presupuesto_diario: e.presupuestoDiario,
    puja_base: e.pujaBase,
    creada_por: e.userId,
  })
  if (error) throw error
}

export interface EntradaDeLog {
  id: string
  creadoAt: string
  origen: 'estructura' | 'automatico' | 'manual'
  entidad: string
  accion: string
  campo: string | null
  valorAnterior: string | null
  valorNuevo: string | null
  motivo: string | null
  nombreCampana: string | null
  campaignId: string | null
  productoId: string | null
  ok: boolean
  error: string | null
  usuario: string | null
}

export interface NuevaEntradaDeLog {
  perfilId: string
  productoId?: string | null
  campaignId?: string | null
  nombreCampana?: string | null
  entidad: 'campaña' | 'grupo' | 'anuncio' | 'keyword' | 'target' | 'negativa'
  accion: 'crear' | 'cambiar' | 'pausar' | 'activar' | 'archivar' | 'negativizar' | 'promover'
  campo?: string | null
  valorAnterior?: string | null
  valorNuevo?: string | null
  motivo?: string | null
  origen: 'estructura' | 'automatico' | 'manual'
  ok?: boolean
  error?: string | null
  userId?: string | null
}

/**
 * Apunta un cambio en el log. NUNCA LANZA: que no se pueda escribir el rastro no puede deshacer ni esconder lo que ya se hizo en Amazon; se deja constancia en el registro del servidor.
 */
export async function anotarCambio(e: NuevaEntradaDeLog): Promise<void> {
  try {
    const { error } = await createServiceClient().from('ads_cambios_log').insert({
      perfil_id: e.perfilId,
      producto_id: e.productoId ?? null,
      campaign_id: e.campaignId ?? null,
      nombre_campana: e.nombreCampana ?? null,
      entidad: e.entidad,
      accion: e.accion,
      campo: e.campo ?? null,
      valor_anterior: e.valorAnterior ?? null,
      valor_nuevo: e.valorNuevo ?? null,
      motivo: e.motivo ?? null,
      origen: e.origen,
      ok: e.ok ?? true,
      error: e.error ? e.error.slice(0, 500) : null,
      usuario_id: e.userId ?? null,
    })
    if (error) console.error('Ads: no se ha podido anotar el cambio en el log:', error.message)
  } catch (err) {
    console.error('Ads: no se ha podido anotar el cambio en el log:', err instanceof Error ? err.message : err)
  }
}

export async function leerLog(perfilId: string, opciones: { productoId?: string | null; origen?: string | null; limite?: number } = {}): Promise<EntradaDeLog[]> {
  let consulta = createServiceClient()
    .from('ads_cambios_log')
    .select('id, creado_at, origen, entidad, accion, campo, valor_anterior, valor_nuevo, motivo, nombre_campana, campaign_id, producto_id, ok, error, usuario_id')
    .eq('perfil_id', perfilId)
    .order('creado_at', { ascending: false })
    .limit(Math.min(Math.max(opciones.limite ?? 200, 1), 500))
  if (opciones.productoId) consulta = consulta.eq('producto_id', opciones.productoId)
  if (opciones.origen) consulta = consulta.eq('origen', opciones.origen)
  const { data, error } = await consulta
  if (error) throw error
  const filas = (data ?? []) as Array<Record<string, unknown>>
  const ids = [...new Set(filas.map((f) => f.usuario_id as string | null).filter((x): x is string => !!x))]
  const nombres = new Map<string, string>()
  if (ids.length > 0) {
    const { data: ps } = await createServiceClient().from('profiles').select('id, full_name').in('id', ids)
    for (const p of (ps ?? []) as Array<{ id: string; full_name: string | null }>) if (p.full_name) nombres.set(p.id, p.full_name)
  }
  return filas.map((f) => ({
    id: f.id as string,
    creadoAt: f.creado_at as string,
    origen: f.origen as EntradaDeLog['origen'],
    entidad: f.entidad as string,
    accion: f.accion as string,
    campo: (f.campo as string | null) ?? null,
    valorAnterior: (f.valor_anterior as string | null) ?? null,
    valorNuevo: (f.valor_nuevo as string | null) ?? null,
    motivo: (f.motivo as string | null) ?? null,
    nombreCampana: (f.nombre_campana as string | null) ?? null,
    campaignId: (f.campaign_id as string | null) ?? null,
    productoId: (f.producto_id as string | null) ?? null,
    ok: f.ok as boolean,
    error: (f.error as string | null) ?? null,
    usuario: f.usuario_id ? (nombres.get(f.usuario_id as string) ?? null) : null,
  }))
}
