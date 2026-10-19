import type { EstadoSku, IdTramo } from '@/lib/fba/inventario'
import type { TonoEstado } from '@/lib/estilo/denso'

/** Pequeñas funciones de formato del panel de inventario */

const ES = 'es-ES'

/** 1.234 */
export const n0 = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : Math.round(v).toLocaleString(ES))

/** 1.234,5 — un decimal, y sin el «,0» sobrante */
export const n1 = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : v.toLocaleString(ES, { maximumFractionDigits: 1 }))

/** 0,25 — dos decimales, para ritmos de venta */
export const n2 = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : v.toLocaleString(ES, { maximumFractionDigits: 2 }))

/** Metros cúbicos: tres decimales cuando es poco, uno cuando es mucho */
export const m3 = (v: number): string => `${v.toLocaleString(ES, { maximumFractionDigits: v < 1 ? 3 : 1 })} m³`

/** 1.234 € (sin decimales: en un panel de cientos de filas los céntimos solo estorban) */
export const eur = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : v.toLocaleString(ES, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

/** 1.234,56 € */
export const eur2 = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : v.toLocaleString(ES, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 0,215 → «21,5 %» */
export const pct = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : `${(v * 100).toLocaleString(ES, { maximumFractionDigits: 1 })} %`)

/** «hoy», «ayer» o «hace 5 d» a partir de los días que han pasado */
export const hace = (dias: number | null | undefined): string => {
  if (dias === null || dias === undefined) return '—'
  if (dias <= 0) return 'hoy'
  if (dias === 1) return 'ayer'
  return `hace ${dias} d`
}

export const ESTADO_SKU: Record<EstadoSku, { texto: string; tono: TonoEstado; ayuda: string }> = {
  agotado: { texto: 'Agotado', tono: 'rojo', ayuda: 'Sin stock vendible y con ventas en los últimos 90 días: se están perdiendo ventas' },
  urgente: { texto: 'Urgente', tono: 'naranja', ayuda: 'Se agota en 14 días o menos al ritmo actual: hay que reponer ya' },
  bajo: { texto: 'Stock bajo', tono: 'ambar', ayuda: 'Entre 15 y 30 días de stock al ritmo actual' },
  ok: { texto: 'Bien', tono: 'verde', ayuda: 'Entre 30 y 120 días de stock al ritmo actual' },
  exceso: { texto: 'Exceso', tono: 'azul', ayuda: 'Más de 120 días de stock al ritmo actual: de sobra' },
  parado: { texto: 'Parado', tono: 'magenta', ayuda: 'Lleva 60 días o más sin venderse y sigue ocupando almacén' },
  sin_ventas: { texto: 'Sin ventas', tono: 'gris', ayuda: 'No se ha vendido nada en 90 días, pero lleva poco tiempo en Amazon como para darlo por parado' },
  sin_datos: { texto: 'Sin datos', tono: 'gris', ayuda: 'No hay libro mayor leído de este cliente: no se sabe cuánto vende' },
}

export const COLOR_TRAMO: Record<IdTramo, string> = {
  t0: 'var(--ls-e-verde)',
  t91: 'var(--ls-e-ambar)',
  t181: 'var(--ls-e-naranja)',
  t271: 'var(--ls-e-rojo)',
  t366: 'var(--ls-e-magenta)',
}
