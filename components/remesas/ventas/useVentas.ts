'use client'

import type { CalidadDatos, VentasFba } from '@/lib/fba/plan-tipos'
import { porSemanaDe } from '@/lib/fba/ventas-fba'
import type { RespuestaVentas } from '@/lib/fba/ventas-servidor'
import { AMAZON_MARKETPLACES } from '@/lib/types/amazon'
import type { CalidadParaBanda } from '../comun/estilo-plan'
import type { PuntoVentas } from '../comun/graficos'
import { useAgencia, type EstadoAgencia } from '../comun/useAgencia'
import { diasEntre, fechaCorta } from '../formato'

/**
 * LAS VENTAS FBA DE UN CLIENTE EN PANTALLA (sección «Ventas», spec remesas-pro §6.3 y §11 D36).
 *
 * `useVentas(clienteId, dias)` pide `GET /api/fba/ventas?cliente=&dias=` con la memoria de 5 min de `useAgencia`.
 * El resto es PURO (se prueba con useVentas.prueba.ts) y lo usan los componentes de la carpeta:
 *
 *   PERIODOS                         7 · 30 · 90 · 365
 *   urlVentas(clienteId, dias)       la URL de la ruta
 *   textoHasta(v, hoy)               «hasta el 6 nov» (el último día del periodo = el último leído si el libro va atrasado)
 *   calidadDeVentas(v, hoy)          lo que entiende la BandaDeCalidad a partir de la respuesta (libro, atraso, aviso)
 *   kpisDeVentas(v)                  unidades, €, ud/día, devoluciones (y su tasa) y el periodo anterior SOLO si está completo
 *   datosDelGrafico(v)               por día o, con 365, por semana; el anterior solo si está completo (D36)
 *   salidasConNombre(v)              el país del almacén con su nombre y su % (no es el país del comprador)
 *   concentracion(v, n)              qué % de las unidades se llevan las n primeras referencias
 *   csvDiario(v) / csvTop(v) / nombreCsv(cliente, v, que)   lo que baja el botón «CSV» (con descargarCsv)
 */

export type DiasVentas = VentasFba['dias']
export const PERIODOS: readonly DiasVentas[] = [7, 30, 90, 365]
export type { RespuestaVentas }

export function urlVentas(clienteId: string, dias: DiasVentas): string {
  return `/api/fba/ventas?cliente=${encodeURIComponent(clienteId)}&dias=${dias}`
}

export function useVentas(clienteId: string | null, dias: DiasVentas): EstadoAgencia<RespuestaVentas> {
  return useAgencia<RespuestaVentas>(clienteId ? urlVentas(clienteId, dias) : null, { que: 'No se han podido leer las ventas FBA' })
}

/* ------------------------------------------------------------------ */
/* Fechas y calidad                                                    */
/* ------------------------------------------------------------------ */

/** «hasta el 6 nov». Con un año distinto del de hoy lo dice («hasta el 30 dic 2025») */
export function textoHasta(v: Pick<VentasFba, 'hasta'>, hoy: string): string {
  return `hasta el ${fechaCorta(v.hasta, hoy)}`
}

/** «últimos 30 días» / «último año» */
export function textoPeriodo(dias: DiasVentas): string {
  return dias === 365 ? 'último año' : `últimos ${dias} días`
}

/**
 * La banda de calidad a partir de la respuesta de ventas (no hay plan aquí: el cliente externo también la ve).
 * Sin conexión → «Sin API de Amazon»; sin `leidoHasta` → libro sin leer; si no, el atraso y el aviso de la lectura
 * elegida (p. ej. «Ventas hasta el 6 nov: la copia de España es la única con historia suficiente»).
 */
export function calidadDeVentas(v: Pick<RespuestaVentas, 'leidoHasta' | 'leidoDesde' | 'mercado' | 'aviso'>, hoy: string): CalidadParaBanda {
  const sinConexion = !!v.aviso && /^Sin API de Amazon/i.test(v.aviso)
  const leido = !!v.leidoHasta
  const libro: CalidadDatos['libro'] = leido ? 'ok' : 'sin_leer'
  const diasAtraso = v.leidoHasta ? Math.max(0, diasEntre(v.leidoHasta.slice(0, 10), hoy)) : null
  return {
    libro,
    leidoHasta: v.leidoHasta,
    leidoDesde: v.leidoDesde,
    diasAtraso,
    mercado: v.mercado,
    sinConexion,
    // Sin libro, el aviso del servidor dice lo mismo que «No hay ventas leídas»: no se repite
    avisos: leido && v.aviso ? [v.aviso] : [],
  }
}

/* ------------------------------------------------------------------ */
/* KPI                                                                 */
/* ------------------------------------------------------------------ */

export interface KpisVentas {
  unidades: number
  euros: number | null
  udDia: number
  devoluciones: number
  /** Devoluciones sobre unidades vendidas, en %; null sin ventas */
  tasaDevolucion: number | null
  /** El periodo anterior de los mismos días; null si el libro no lo cubre entero (no se compara) */
  anterior: { unidades: number; euros: number | null; udDia: number } | null
}

export function kpisDeVentas(v: Pick<VentasFba, 'dias' | 'totales' | 'anterior' | 'anteriorCompleto'>): KpisVentas {
  const t = v.totales
  let anterior: KpisVentas['anterior'] = null
  if (v.anteriorCompleto) {
    const unidades = v.anterior.reduce((s, d) => s + d.unidades, 0)
    const conEuros = t.euros !== null && v.anterior.some((d) => d.euros !== null)
    const euros = conEuros ? Math.round(v.anterior.reduce((s, d) => s + (d.euros ?? 0), 0) * 100) / 100 : null
    anterior = { unidades, euros, udDia: Math.round((unidades / v.dias) * 100) / 100 }
  }
  return {
    unidades: t.unidades,
    euros: t.euros,
    udDia: t.udDia,
    devoluciones: t.devoluciones,
    tasaDevolucion: t.unidades > 0 ? Math.round((t.devoluciones / t.unidades) * 1000) / 10 : null,
    anterior,
  }
}

/* ------------------------------------------------------------------ */
/* Gráfico                                                             */
/* ------------------------------------------------------------------ */

export interface DatosGraficoVentas {
  datos: PuntoVentas[]
  /** null = no se pinta la línea del periodo anterior (libro que no llega o sin ventas entonces) */
  anterior: PuntoVentas[] | null
  porSemana: boolean
}

/** Con 365 días, por semanas (lunes). El anterior solo si el libro lo cubre entero (D36): uno a medias engaña */
export function datosDelGrafico(v: Pick<VentasFba, 'porDia' | 'porSemana' | 'anterior' | 'anteriorCompleto'>): DatosGraficoVentas {
  const semanal = v.porSemana !== null && v.porSemana !== undefined
  const datos: PuntoVentas[] = semanal
    ? v.porSemana!.map((s) => ({ fecha: s.semana, unidades: s.unidades, euros: s.euros }))
    : v.porDia.map((d) => ({ fecha: d.fecha, unidades: d.unidades, euros: d.euros }))
  let anterior: PuntoVentas[] | null = null
  if (v.anteriorCompleto && v.anterior.some((d) => d.unidades > 0)) {
    anterior = semanal
      ? porSemanaDe(v.anterior).map((s) => ({ fecha: s.semana, unidades: s.unidades, euros: s.euros }))
      : v.anterior.map((d) => ({ fecha: d.fecha, unidades: d.unidades, euros: d.euros }))
  }
  return { datos, anterior, porSemana: semanal }
}

/** El mejor día (o semana) del periodo; null sin ventas */
export function mejorPunto(datos: ReadonlyArray<PuntoVentas>): PuntoVentas | null {
  let mejor: PuntoVentas | null = null
  for (const d of datos) if (d.unidades > 0 && (!mejor || d.unidades > mejor.unidades)) mejor = d
  return mejor
}

/* ------------------------------------------------------------------ */
/* Top y salidas por almacén                                           */
/* ------------------------------------------------------------------ */

/** % de las unidades del periodo que se llevan las `n` primeras referencias; null sin ventas */
export function concentracion(v: Pick<VentasFba, 'top' | 'totales'>, n = 3): number | null {
  if (v.totales.unidades <= 0) return null
  const suma = v.top.slice(0, n).reduce((s, x) => s + x.unidades, 0)
  return Math.round((suma / v.totales.unidades) * 1000) / 10
}

const OTROS_NOMBRES: Record<string, string> = { UK: 'Reino Unido', CZ: 'Chequia', AT: 'Austria', IE: 'Irlanda', PT: 'Portugal', SK: 'Eslovaquia' }

/** «ES» → «España». Lo que no se conoce sale tal cual */
export function nombrePais(codigo: string): string {
  const c = codigo.trim().toUpperCase()
  if (!c || c === 'SIN PAÍS') return 'Sin país'
  return AMAZON_MARKETPLACES.find((m) => m.countryCode === c)?.label ?? OTROS_NOMBRES[c] ?? c
}

export interface SalidaAlmacen {
  pais: string
  nombre: string
  unidades: number
  /** % de las salidas del periodo */
  pct: number
}

export function salidasConNombre(v: Pick<VentasFba, 'salidasPorAlmacen'>): SalidaAlmacen[] {
  const total = v.salidasPorAlmacen.reduce((s, x) => s + x.unidades, 0)
  if (total <= 0) return []
  return v.salidasPorAlmacen
    .filter((x) => x.unidades > 0)
    .map((x) => ({ pais: x.pais, nombre: nombrePais(x.pais), unidades: x.unidades, pct: Math.round((x.unidades / total) * 1000) / 10 }))
    .sort((a, b) => b.unidades - a.unidades || a.nombre.localeCompare(b.nombre, 'es'))
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

const num = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n).replace('.', ','))

/** Día a día (o semana a semana con 365) con el periodo anterior al lado si está completo */
export function csvDiario(v: Pick<VentasFba, 'porDia' | 'porSemana' | 'anterior' | 'anteriorCompleto' | 'moneda'>): { cabecera: string[]; filas: Array<Array<string | number>> } {
  const g = datosDelGrafico(v)
  const unidad = g.porSemana ? 'Semana (lunes)' : 'Fecha'
  const conAnterior = g.anterior !== null
  const cabecera = [unidad, 'Unidades', `Ventas (${v.moneda}, precio actual)`, ...(conAnterior ? ['Periodo anterior: fecha', 'Periodo anterior: unidades'] : [])]
  const desfase = g.anterior ? g.anterior.length - g.datos.length : 0
  const filas = g.datos.map((d, i) => {
    const a = g.anterior ? g.anterior[i + desfase] : undefined
    return [d.fecha, d.unidades, num(d.euros), ...(conAnterior ? [a?.fecha ?? '', a ? a.unidades : ''] : [])]
  })
  return { cabecera, filas }
}

export function csvTop(v: Pick<VentasFba, 'top' | 'totales' | 'moneda'>): { cabecera: string[]; filas: Array<Array<string | number>> } {
  const total = v.totales.unidades
  return {
    cabecera: ['SKU', 'Producto', 'Unidades', `Ventas (${v.moneda}, precio actual)`, 'Ud/día', '% de las unidades'],
    filas: v.top.map((t) => [t.sku, t.nombre ?? '', t.unidades, num(t.euros), num(t.udDia), total > 0 ? num(Math.round((t.unidades / total) * 1000) / 10) : '']),
  }
}

/** «ventas-fba-opinas-30d-hasta-2026-11-06.csv» */
export function nombreCsv(cliente: string, v: Pick<VentasFba, 'dias' | 'hasta'>, que: 'dias' | 'top' | 'almacen'): string {
  const limpio =
    cliente
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'cliente'
  const sufijo = que === 'dias' ? '' : que === 'top' ? '-referencias' : '-almacenes'
  return `ventas-fba-${limpio}-${v.dias}d${sufijo}-hasta-${v.hasta}.csv`
}
