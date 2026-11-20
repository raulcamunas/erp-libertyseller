import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { MiraklError } from './mirakl'
import { ventasDe } from './ventas-servidor'
import type { LineaVenta, ResumenVentas, DiaVentas } from './ventas'

/**
 * EL PANEL DE PCCOMPONENTES PARA ENTRAIS (enlace con clave, migración 329). SOLO SERVIDOR. SOLO LEE.
 *
 *   · Cifras de la última pasada de la sincronización: ofertas publicadas, con stock y en cuántas son los más baratos.
 *   · Ingresos y gastos del periodo: lo vendido sin IVA, la comisión de PcComponentes, el coste del proveedor, las devoluciones y la cuota mensual (39,99 €
 *     prorrateados por días), y lo que queda.
 *   · Los pedidos del periodo, línea a línea.
 *   · Los cambios de precio y de stock que se han ENVIADO a la tienda (lo del registro que no llegó a subirse no sale).
 *
 * Los pedidos se leen de PcComponentes (con 5 minutos de memoria); si su API no contesta, el resto del panel sale igual y se dice.
 */

export const CUOTA_MENSUAL = 39.99
const r2 = (n: number) => Math.round(n * 100) / 100
const DIA = /^\d{4}-\d{2}-\d{2}$/

export interface CambioEnTienda {
  at: string
  sku: string
  ean: string | null
  titulo: string | null
  precioAntes: number | null
  precioNuevo: number | null
  minimo: number | null
  rivalPrecio: number | null
  rivalTienda: string | null
  stockAntes: number | null
  stockNuevo: number | null
  motivo: string
}

export interface DatosPanelPcc {
  periodo: { desde: string; hasta: string }
  sincronizacion: { ultima: string | null; publicadas: number | null; conStock: number | null; primeros: number | null; cadaMinutos: number | null }
  ventas: { resumen: ResumenVentas; dias: DiaVentas[]; lineas: LineaVenta[] } | null
  ventasError: string | null
  cuota: number
  precios: CambioEnTienda[]
  stock: CambioEnTienda[]
  /** Si se ha llegado al tope de filas leídas del registro (el periodo tiene más cambios de los que se enseñan) */
  recortado: boolean
}

/** La parte de la cuota mensual que toca a un periodo: cada día vale 39,99 € ÷ los días de su mes */
export function cuotaDelPeriodo(desde: string, hasta: string): number {
  let total = 0
  const d = new Date(`${desde}T12:00:00Z`)
  const fin = new Date(`${hasta}T12:00:00Z`)
  for (let i = 0; d <= fin && i < 800; i++) {
    const diasDelMes = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
    total += CUOTA_MENSUAL / diasDelMes
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return r2(total)
}

const TOPE_FILAS = 12_000

type FilaLog = {
  pasada_at: string
  sku: string
  ean: string | null
  titulo: string | null
  precio_antes: number | null
  precio_nuevo: number | null
  minimo: number | null
  competidor_precio: number | null
  competidor_tienda: string | null
  motivo: string
  stock_antes?: number | null
  stock_nuevo?: number | null
}

async function cambiosEnviados(desde: string, hasta: string): Promise<{ filas: FilaLog[]; recortado: boolean }> {
  const service = createServiceClient()
  const base = 'pasada_at, sku, ean, titulo, precio_antes, precio_nuevo, minimo, competidor_precio, competidor_tienda, motivo'
  let columnas = `${base}, stock_antes, stock_nuevo`
  const filas: FilaLog[] = []
  for (let a = 0; a < TOPE_FILAS; a += 1000) {
    const leer = () =>
      service
        .from('pcc_precios_log')
        .select(columnas)
        .eq('enviado', true)
        .gte('pasada_at', `${desde}T00:00:00+01:00`)
        .lte('pasada_at', `${hasta}T23:59:59+01:00`)
        .order('pasada_at', { ascending: false })
        .order('id', { ascending: false })
        .range(a, a + 999)
    let { data, error } = await leer()
    // Sin la migración 329 no están las columnas del stock
    if (error && columnas !== base && /stock_(antes|nuevo)/.test(error.message)) {
      columnas = base
      ;({ data, error } = await leer())
    }
    if (error) {
      if (isMissingSchema(error)) return { filas: [], recortado: false }
      throw error
    }
    const pagina = (data ?? []) as unknown as FilaLog[]
    filas.push(...pagina)
    if (pagina.length < 1000) return { filas, recortado: false }
  }
  return { filas, recortado: true }
}

/** Los nombres que faltan (las ofertas que se crearon antes de guardarlo), del catálogo de PcComponentes por EAN */
async function completarTitulos(filas: FilaLog[]): Promise<void> {
  const faltan = [...new Set(filas.filter((f) => !f.titulo && f.ean).map((f) => f.ean as string))]
  if (faltan.length === 0) return
  const service = createServiceClient()
  const titulos = new Map<string, string>()
  for (let i = 0; i < faltan.length; i += 300) {
    const { data } = await service.from('pcc_mercado').select('ean, titulo').in('ean', faltan.slice(i, i + 300))
    for (const f of (data ?? []) as Array<{ ean: string; titulo: string | null }>) if (f.titulo) titulos.set(f.ean, f.titulo)
  }
  for (const f of filas) if (!f.titulo && f.ean) f.titulo = titulos.get(f.ean) ?? null
}

const aCambio = (f: FilaLog): CambioEnTienda => ({
  at: f.pasada_at,
  sku: f.sku,
  ean: f.ean,
  titulo: f.titulo,
  precioAntes: f.precio_antes === null ? null : Number(f.precio_antes),
  precioNuevo: f.precio_nuevo === null ? null : Number(f.precio_nuevo),
  minimo: f.minimo === null ? null : Number(f.minimo),
  rivalPrecio: f.competidor_precio === null ? null : Number(f.competidor_precio),
  rivalTienda: f.competidor_tienda,
  stockAntes: f.stock_antes ?? null,
  stockNuevo: f.stock_nuevo ?? null,
  motivo: f.motivo,
})

export async function datosDelPanelPcc(desde: unknown, hasta: unknown): Promise<DatosPanelPcc> {
  if (typeof desde !== 'string' || typeof hasta !== 'string' || !DIA.test(desde) || !DIA.test(hasta) || desde > hasta) throw new Error('Fechas no válidas.')
  const service = createServiceClient()

  const [config, log, ventas] = await Promise.all([
    service.from('pcc_precios_config').select('ultima_pasada_at, ultimo_resumen, cada_minutos').eq('unica', true).maybeSingle(),
    cambiosEnviados(desde, hasta),
    ventasDe(`${desde}T00:00:00Z`, `${hasta}T23:59:59Z`)
      .then((v) => ({ v, error: null as string | null }))
      .catch((e) => ({
        v: null,
        error: e instanceof MiraklError && e.estado === 429 ? 'PcComponentes está limitando las consultas ahora mismo: los pedidos saldrán en un par de minutos.' : 'No se han podido leer los pedidos de PcComponentes. Prueba otra vez en un momento.',
      })),
  ])

  const c = (config.data ?? null) as { ultima_pasada_at: string | null; ultimo_resumen: Record<string, unknown> | null; cada_minutos: number | null } | null
  const res = c?.ultimo_resumen ?? null
  const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

  await completarTitulos(log.filas)
  const precios: CambioEnTienda[] = []
  const stock: CambioEnTienda[] = []
  for (const f of log.filas) {
    const cambioPrecio = f.motivo !== 'stock' && (f.precio_antes === null || f.precio_nuevo === null || Math.abs(Number(f.precio_nuevo) - Number(f.precio_antes)) >= 0.005)
    const cambioStock = f.motivo === 'stock' || f.motivo === 'nueva' || (f.stock_antes != null && f.stock_nuevo != null && f.stock_antes !== f.stock_nuevo)
    if (cambioPrecio) precios.push(aCambio(f))
    if (cambioStock) stock.push(aCambio(f))
  }

  return {
    periodo: { desde, hasta },
    sincronizacion: {
      ultima: (res?.at as string | undefined) ?? c?.ultima_pasada_at ?? null,
      publicadas: numero(res?.publicadas),
      conStock: numero(res?.conStock),
      primeros: numero(res?.primeros),
      cadaMinutos: c?.cada_minutos ?? null,
    },
    ventas: ventas.v ? { resumen: ventas.v.resumen, dias: ventas.v.dias, lineas: ventas.v.lineas } : null,
    ventasError: ventas.error,
    cuota: cuotaDelPeriodo(desde, hasta),
    precios,
    stock,
    recortado: log.recortado,
  }
}
