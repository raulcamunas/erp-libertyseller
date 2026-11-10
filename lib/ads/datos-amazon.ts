/**
 * AMAZON ADS · LOS NÚMEROS DE UN PRODUCTO QUE YA SABE AMAZON (para no teclearlos en Marketing Test).
 * SOLO SERVIDOR. Solo lee: no se le escribe nada a Amazon.
 *
 * Al añadir un producto, lo único que tiene que decidir una persona es el ACoS objetivo. El resto sale de la cuenta del cliente:
 *
 *   · precio        el de la ficha (amazon_listings), con el IVA dentro como lo ve el comprador.
 *   · IVA           el general del país (ivaPorDefecto).
 *   · comisión      `getMyFeesEstimates` de SP-API, pedida a ESE precio y con el canal que tiene HOY el SKU: la comisión de referencia en % del precio, la tarifa FBA y lo demás en «otros».
 *                   Si Amazon no contesta, la última estimación guardada en amazon_fees_estimados (la tarea de tarifas de Buy Box la llena en los clientes que la tienen).
 *   · coste         el vigente en amazon_costes_producto, si alguien lo cargó. Si no, se queda vacío: no es obligatorio (solo sirve para enseñar el ACoS de equilibrio).
 *
 * Cada número dice de dónde ha salido, para que la pantalla no presente un 15 % por defecto como si fuera de Amazon.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { connectionCredentials } from '@/lib/amazon/data'
import { leerTarifas, type TarifaSku } from '@/lib/plataforma/amazon/tarifas'
import { marketplaceDePais } from './cuenta'
import { ivaPorDefecto } from './margen'

export type FuenteDeDato = 'amazon' | 'guardado' | 'pais' | 'erp' | 'falta'

export interface DatosDeAmazon {
  precio: number | null
  moneda: string | null
  ivaPct: number
  comisionPct: number | null
  tarifaFba: number | null
  otrosCostes: number | null
  costeProducto: number | null
  esFba: boolean | null
  fuentes: { precio: FuenteDeDato; iva: FuenteDeDato; tarifas: FuenteDeDato; coste: FuenteDeDato }
  /** Por qué no han llegado las tarifas de Amazon, si no han llegado */
  aviso: string | null
}

const r = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d

/** De la estimación de Amazon a los tres números de la ficha. Pura, para poder probarla */
export function tarifasAFicha(t: Pick<TarifaSku, 'referral' | 'fba' | 'otras'>, precio: number): { comisionPct: number | null; tarifaFba: number; otrosCostes: number } {
  return {
    comisionPct: t.referral != null && precio > 0 ? r((t.referral / precio) * 100, 1) : null,
    tarifaFba: r(t.fba ?? 0),
    otrosCostes: r(t.otras ?? 0),
  }
}

export async function datosDeAmazon(cuenta: { clienteAmazonId: string | null; pais: string; moneda: string | null }, sku: string): Promise<DatosDeAmazon> {
  const salida: DatosDeAmazon = {
    precio: null,
    moneda: cuenta.moneda,
    ivaPct: ivaPorDefecto(cuenta.pais),
    comisionPct: null,
    tarifaFba: null,
    otrosCostes: null,
    costeProducto: null,
    esFba: null,
    fuentes: { precio: 'falta', iva: 'pais', tarifas: 'falta', coste: 'falta' },
    aviso: null,
  }
  const marketplace = marketplaceDePais(cuenta.pais)
  if (!cuenta.clienteAmazonId || !marketplace || !sku.trim()) {
    salida.aviso = 'Este cliente no tiene la cuenta de vendedor conectada: el precio y las comisiones hay que ponerlos a mano.'
    return salida
  }
  const service = createServiceClient()

  // El coste, si alguien lo cargó (el vigente hoy)
  const hoy = new Date().toISOString().slice(0, 10)
  const { data: coste } = await service
    .from('amazon_costes_producto')
    .select('coste, moneda')
    .eq('client_id', cuenta.clienteAmazonId)
    .eq('sku', sku)
    .lte('valido_desde', hoy)
    .order('valido_desde', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (coste && (!cuenta.moneda || (coste as { moneda: string }).moneda === cuenta.moneda)) {
    salida.costeProducto = Number((coste as { coste: number }).coste)
    salida.fuentes.coste = 'erp'
  }

  // El listing: precio, canal y la conexión con la que preguntar
  const { data: conexiones } = await service.from('amazon_connections').select('id').eq('client_id', cuenta.clienteAmazonId).eq('is_active', true)
  const ids = ((conexiones ?? []) as Array<{ id: string }>).map((c) => c.id)
  if (ids.length === 0) {
    salida.aviso = 'Este cliente no tiene la cuenta de vendedor conectada: el precio y las comisiones hay que ponerlos a mano.'
    return salida
  }
  const { data: listing } = await service
    .from('amazon_listings')
    .select('connection_id, price, currency, is_fba')
    .in('connection_id', ids)
    .eq('marketplace_id', marketplace)
    .eq('sku', sku)
    .limit(1)
    .maybeSingle()
  const l = listing as { connection_id: string; price: number | null; currency: string | null; is_fba: boolean | null } | null
  if (!l) {
    salida.aviso = 'Ese SKU no está en el catálogo leído de la cuenta en este país.'
    return salida
  }
  salida.esFba = l.is_fba
  if (l.price != null && Number(l.price) > 0) {
    salida.precio = Number(l.price)
    salida.moneda = l.currency ?? cuenta.moneda
    salida.fuentes.precio = 'amazon'
  }
  if (salida.precio == null) {
    salida.aviso = 'Amazon no tiene precio para ese SKU (¿sin oferta activa?): sin precio no se pueden pedir las comisiones.'
    return salida
  }

  // Las tarifas, preguntadas a Amazon a ESE precio
  try {
    const c = await connectionCredentials(l.connection_id)
    if (!c) throw new Error('La conexión de vendedor ya no existe.')
    const lectura = await leerTarifas(c.credentials, { marketplaceId: marketplace, peticiones: [{ sku, precio: salida.precio, moneda: salida.moneda ?? 'EUR', esFba: l.is_fba ?? true }] })
    const t = lectura.porSku.get(sku)
    if (t) {
      Object.assign(salida, tarifasAFicha(t, salida.precio))
      salida.fuentes.tarifas = salida.comisionPct == null ? 'falta' : 'amazon'
      return salida
    }
    salida.aviso = lectura.fallos[0] ? `Amazon no ha dado las comisiones: ${lectura.fallos[0].mensaje}` : 'Amazon no ha devuelto las comisiones de ese SKU.'
  } catch (e) {
    salida.aviso = `No se han podido pedir las comisiones a Amazon: ${e instanceof Error ? e.message : 'error desconocido'}`
  }

  // Si Amazon no contesta: la última estimación guardada, solo si se pidió a un precio parecido (la comisión tiene mínimos y la FBA tramos)
  const { data: guardada } = await service
    .from('amazon_fees_estimados')
    .select('precio_referencia, referral_fee, fba_fee, otras_fees')
    .eq('connection_id', l.connection_id)
    .eq('marketplace_id', marketplace)
    .eq('sku', sku)
    .order('fecha', { ascending: false })
    .limit(1)
    .maybeSingle()
  const g = guardada as { precio_referencia: number; referral_fee: number | null; fba_fee: number | null; otras_fees: number | null } | null
  if (g && Math.abs(Number(g.precio_referencia) - salida.precio) <= salida.precio * 0.05) {
    Object.assign(salida, tarifasAFicha({ referral: g.referral_fee == null ? null : Number(g.referral_fee), fba: g.fba_fee == null ? null : Number(g.fba_fee), otras: g.otras_fees == null ? null : Number(g.otras_fees) }, salida.precio))
    if (salida.comisionPct != null) {
      salida.fuentes.tarifas = 'guardado'
      salida.aviso = null
    }
  }
  return salida
}
