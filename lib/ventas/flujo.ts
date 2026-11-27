/**
 * VENTAS · FLUJO DE CAJA (como la página de Sellerboard). PURO: vale en el navegador y se comprueba con flujo.prueba.ts.
 *
 * Los periodos son las LIQUIDACIONES de Amazon (cada ~14 días): cada una acaba con un pago al banco. Dentro de cada periodo van ese pago y los
 * apuntes a mano (inversiones, gastos, compra de bienes, dividendos, IVA) de esas fechas. «Efectivo en mano» es el acumulado de todo desde el
 * principio; «Diferencia» lo que cambia en el periodo. La liquidación abierta (lo que Amazon lleva acumulado y aún no ha pagado) y los periodos
 * siguientes son PRONÓSTICO: la abierta con su saldo de ahora y los siguientes con la media de los últimos pagos.
 */

export type TipoFlujo = 'pago' | 'inversion' | 'gasto' | 'compra' | 'dividendo' | 'iva'
export const TIPOS_FLUJO: TipoFlujo[] = ['pago', 'inversion', 'gasto', 'compra', 'dividendo', 'iva']
export const NOMBRE_TIPO: Record<TipoFlujo, string> = { pago: 'Pagos', inversion: 'Inversiones', gasto: 'Gastos', compra: 'Compra de bienes', dividendo: 'Dividendos', iva: 'IVA' }
/** El signo con el que entra cada tipo al apuntarlo a mano (el importe se escribe en positivo). Los pagos llevan el suyo */
export const SIGNO_TIPO: Record<TipoFlujo, 1 | -1 | 0> = { pago: 0, inversion: 1, gasto: -1, compra: -1, dividendo: -1, iva: -1 }

export interface PagoAmazon {
  grupo: string
  /** YYYY-MM-DD */
  inicio: string | null
  fin: string | null
  fechaPago: string | null
  abierto: boolean
  /** En euros */
  importe: number
  importeOriginal: number
  moneda: string | null
  estadoPago: string | null
  oculto: boolean
}

export interface ApunteFlujo {
  id: string
  fecha: string
  descripcion: string
  tipo: TipoFlujo
  /** Con su signo */
  importe: number
}

export interface EntradaFlujo {
  clave: string
  fecha: string
  descripcion: string
  tipo: TipoFlujo
  importe: number
  /** El efectivo en mano después de esta entrada */
  efectivo: number
  origen: 'amazon' | 'manual' | 'estimado'
  /** El id del apunte o el grupo de Amazon (para borrar) */
  ref: string | null
  previsto: boolean
}

export interface PeriodoFlujo {
  desde: string
  hasta: string
  entradas: EntradaFlujo[]
  porTipo: Record<TipoFlujo, number>
  diferencia: number
  /** El efectivo en mano al acabar el periodo */
  efectivo: number
  previsto: boolean
}

const r2 = (n: number) => Math.round(n * 100) / 100
const DIA = 86_400_000
export const sumarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10)
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA)
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`
const ceros = (): Record<TipoFlujo, number> => ({ pago: 0, inversion: 0, gasto: 0, compra: 0, dividendo: 0, iva: 0 })

export function descripcionDePago(p: PagoAmazon): string {
  const tramo = p.inicio && p.fin ? `Liquidación ${ddmm(p.inicio)} – ${ddmm(p.fin)}` : p.inicio ? `Liquidación abierta desde el ${ddmm(p.inicio)}` : 'Liquidación de Amazon'
  const fuera = p.moneda && p.moneda !== 'EUR' ? ` · ${p.importeOriginal.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${p.moneda}` : ''
  const fallo = p.estadoPago && /fail/i.test(p.estadoPago) ? ' · transferencia fallida' : ''
  return tramo + fuera + fallo
}

/**
 * Arma los periodos. `pronostico` = cuántos periodos más allá del abierto se estiman (0 = ninguno). `hoy` = YYYY-MM-DD.
 */
export function construirFlujo(pagos: PagoAmazon[], apuntes: ApunteFlujo[], hoy: string, pronostico = 2): PeriodoFlujo[] {
  const visibles = pagos.filter((p) => !p.oculto)
  const cerrados = visibles.filter((p) => !p.abierto && p.fin).sort((a, b) => (a.fin as string).localeCompare(b.fin as string))
  const abiertos = visibles.filter((p) => p.abierto || !p.fin)

  // Los cortes: el fin de cada liquidación cerrada (las de varias monedas o mercados que acaban a 2 días o menos van juntas)
  const cortes: string[] = []
  for (const p of cerrados) {
    const fin = p.fin as string
    const ultimo = cortes[cortes.length - 1]
    if (ultimo && diasEntre(ultimo, fin) <= 2) cortes[cortes.length - 1] = fin > ultimo ? fin : ultimo
    else cortes.push(fin)
  }

  const periodos: Array<{ desde: string; hasta: string; previsto: boolean }> = []
  const primeraFecha = [...cerrados.map((p) => p.inicio ?? p.fin), ...apuntes.map((a) => a.fecha)].filter(Boolean).sort()[0] as string | undefined
  cortes.forEach((c, i) => {
    const desde = i === 0 ? [primeraFecha ?? sumarDias(c, -13), sumarDias(c, -13)].sort()[0] : sumarDias(cortes[i - 1], 1)
    periodos.push({ desde, hasta: c, previsto: false })
  })
  // El abierto: desde el último corte (o el inicio de la liquidación abierta) hasta ~14 días después
  const desdeAbierto = cortes.length ? sumarDias(cortes[cortes.length - 1], 1) : (abiertos.map((p) => p.inicio).filter(Boolean).sort()[0] as string | undefined) ?? primeraFecha ?? hoy
  const finAbierto = [sumarDias(desdeAbierto, 13), hoy].sort().reverse()[0]
  periodos.push({ desde: desdeAbierto, hasta: finAbierto, previsto: true })
  // Los siguientes: hasta cubrir los apuntes con fecha futura y los periodos de pronóstico pedidos
  const ultimoApunte = apuntes.map((a) => a.fecha).sort().reverse()[0]
  let extra = 0
  while (extra < pronostico || (ultimoApunte && ultimoApunte > periodos[periodos.length - 1].hasta)) {
    const desde = sumarDias(periodos[periodos.length - 1].hasta, 1)
    periodos.push({ desde, hasta: sumarDias(desde, 13), previsto: true })
    extra++
    if (extra > 60) break
  }

  const dondeVa = (fecha: string) => {
    if (fecha < periodos[0].desde) return 0
    const i = periodos.findIndex((p) => fecha >= p.desde && fecha <= p.hasta)
    return i >= 0 ? i : periodos.length - 1
  }
  const crudas: Array<Omit<EntradaFlujo, 'efectivo'> & { i: number }> = []
  for (const p of cerrados) crudas.push({ clave: `a|${p.grupo}`, fecha: p.fin as string, descripcion: descripcionDePago(p), tipo: 'pago', importe: r2(p.importe), origen: 'amazon', ref: p.grupo, previsto: false, i: dondeVa(p.fin as string) })
  const iAbierto = cortes.length
  for (const p of abiertos) crudas.push({ clave: `a|${p.grupo}`, fecha: periodos[iAbierto].hasta, descripcion: `${descripcionDePago(p)} (aún sin pagar)`, tipo: 'pago', importe: r2(p.importe), origen: 'amazon', ref: p.grupo, previsto: true, i: iAbierto })
  for (const a of apuntes) {
    const i = dondeVa(a.fecha)
    crudas.push({ clave: `m|${a.id}`, fecha: a.fecha, descripcion: a.descripcion, tipo: a.tipo, importe: r2(a.importe), origen: 'manual', ref: a.id, previsto: periodos[i].previsto && a.fecha > hoy, i })
  }
  // El pago estimado de los periodos de pronóstico: la media de los pagos de los últimos 4 periodos cerrados
  const pagosPorPeriodo = periodos.map((_, i) => crudas.filter((c) => c.i === i && c.tipo === 'pago' && c.origen === 'amazon').reduce((s, c) => s + c.importe, 0))
  const ultimos = pagosPorPeriodo.slice(0, iAbierto).slice(-4)
  const media = ultimos.length ? r2(ultimos.reduce((s, x) => s + x, 0) / ultimos.length) : 0
  for (let i = iAbierto + 1; i < periodos.length; i++) {
    if (media !== 0) crudas.push({ clave: `e|${i}`, fecha: periodos[i].hasta, descripcion: 'Pago estimado (media de los últimos pagos)', tipo: 'pago', importe: media, origen: 'estimado', ref: null, previsto: true, i })
  }

  let efectivo = 0
  return periodos.map((p, i) => {
    const entradas = crudas
      .filter((c) => c.i === i)
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.origen === 'amazon' ? -1 : 1))
      .map((c) => {
        efectivo = r2(efectivo + c.importe)
        return { clave: c.clave, fecha: c.fecha, descripcion: c.descripcion, tipo: c.tipo, importe: c.importe, origen: c.origen, ref: c.ref, previsto: c.previsto, efectivo }
      })
    const porTipo = ceros()
    for (const e of entradas) porTipo[e.tipo] = r2(porTipo[e.tipo] + e.importe)
    return { ...p, entradas, porTipo, diferencia: r2(entradas.reduce((s, e) => s + e.importe, 0)), efectivo }
  })
}

/** Lee un CSV de apuntes: «fecha;descripción;tipo;importe» (fecha 31/12/2026 o 2026-12-31; tipo por nombre o clave; importe con coma o punto) */
export function leerApuntesCsv(texto: string): { apuntes: Array<Omit<ApunteFlujo, 'id'>>; errores: number } {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  const sep = (lineas[0] ?? '').includes(';') ? ';' : ','
  const porNombre = new Map<string, TipoFlujo>()
  for (const t of TIPOS_FLUJO) {
    porNombre.set(t, t)
    porNombre.set(NOMBRE_TIPO[t].toLowerCase(), t)
  }
  porNombre.set('inversión', 'inversion')
  porNombre.set('compra', 'compra')
  const apuntes: Array<Omit<ApunteFlujo, 'id'>> = []
  let errores = 0
  for (const l of lineas) {
    const c = l.split(sep).map((x) => x.trim().replace(/^"|"$/g, ''))
    if (/^fecha$/i.test(c[0] ?? '')) continue
    const f = c[0] ?? ''
    const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(f)
    const fecha = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : null
    const tipo = porNombre.get((c[2] ?? '').toLowerCase())
    const bruto = (c[3] ?? '').replace(/\s|€/g, '')
    const importe = Number(bruto.includes(',') ? bruto.replace(/\./g, '').replace(',', '.') : bruto)
    if (!fecha || !tipo || !Number.isFinite(importe) || bruto === '') {
      errores++
      continue
    }
    apuntes.push({ fecha, descripcion: c[1] ?? '', tipo, importe: r2(importe) })
  }
  return { apuntes, errores }
}
