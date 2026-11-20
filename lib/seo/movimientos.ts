/**
 * SEO · LOS MOVIMIENTOS DE LA SEMANA. PURO (se prueba sin base de datos).
 *
 * Qué búsquedas de un producto han subido o bajado de verdad esta semana, comparando la última semana con la media de las 4 anteriores:
 *   · BASE: las búsquedas del producto (relevantes y sin sospecha de ser ajenas) que salen en al menos 2 de esas 4 semanas, con una media de impresiones del mercado de 2.000 o más (con menos,
 *     cualquier cuota baila sola);
 *   · SUBE / BAJA: la cuota de impresiones cambia un 40 % o más frente a la media Y al menos 0,3 puntos (las dos cosas: un 0,1 % → 0,2 % es +100 % y no es nada);
 *   · SALEN: las de la base que esta semana no están en el informe (un hueco, no un cero: Amazon solo da las búsquedas donde el producto sale);
 *   · CAÍDA GENERAL: si, con una base de 10 o más, más de la mitad baja o sale. Eso no es SEO: es la publicidad apagada, una rotura de stock o una supresión.
 *
 * Los umbrales están ajustados con 2 cuentas y 10 semanas (habrían avisado en las semanas de octubre en que se apagó la publicidad de B0FK5X28D6 y B0GV4FLP99, y en ninguna semana normal). Se
 * revisan al mes: están en UMBRALES_DE_MOVIMIENTOS y se pueden cambiar por llamada.
 */

import type { ConsultaGuardada } from './datos'
import { claveDeBusqueda, cuotasDe, diagnosticarTodas, esDelProducto, type OpcionesDeDiagnostico } from './embudo'

export const UMBRALES_DE_MOVIMIENTOS = {
  /** Semanas anteriores con las que se hace la media */
  semanasAtras: 4,
  /** En cuántas de esas semanas tiene que salir una búsqueda para entrar en la base */
  semanasMinimas: 2,
  /** Media de impresiones del mercado mínima para entrar en la base */
  impresionesMinimas: 2000,
  /** Cambio relativo de la cuota frente a la media (0,4 = 40 %) */
  cambioRelativo: 0.4,
  /** Cambio mínimo en puntos de cuota (0,3 puntos) */
  cambioMinimoPt: 0.3,
  /** Fracción de la base que baja o sale para hablar de caída general (más de) */
  caidaGeneral: 0.5,
  /** Base mínima para hablar de caída general */
  baseMinima: 10,
}
export type UmbralesDeMovimientos = typeof UMBRALES_DE_MOVIMIENTOS

export interface Mov {
  consulta: string
  /** La cuota de impresiones de esta semana; null si ha salido del informe */
  cuotaAhora: number | null
  /** La media de la cuota de impresiones en las semanas anteriores en que salió */
  cuotaMedia: number
  /** Ahora − media, en puntos (null si ha salido) */
  deltaPt: number | null
  /** La media de compras del mercado en esa búsqueda (para ordenar y elegir las que enseñar) */
  comprasTotalMedia: number
}

export interface Movimientos {
  /** La semana que se mira (su `desde`); null sin semanas */
  semana: string | null
  /** Cuántas semanas hay leídas de las 5 que hacen falta (la que se mira y las 4 anteriores) */
  semanasLeidas: number
  /** Cuántas búsquedas hay en la base */
  base: number
  suben: Mov[]
  bajan: Mov[]
  salen: Mov[]
  caidaGeneral: boolean
}

export interface OpcionesDeMovimientos extends OpcionesDeDiagnostico {
  /** La semana que se mira (`desde`). Sin ella, la última semana de TODAS las filas (de la cuenta): si el producto no sale en ella, todo «sale» */
  semana?: string
  umbrales?: Partial<UmbralesDeMovimientos>
}

const DIA = 86_400_000
const semanaAntes = (desde: string, k: number) => new Date(Date.parse(`${desde.slice(0, 10)}T00:00:00Z`) - 7 * k * DIA).toISOString().slice(0, 10)
const media = (xs: readonly number[]) => (xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length)

/** LOS MOVIMIENTOS DE UN PRODUCTO EN LA ÚLTIMA SEMANA frente a la media de las 4 anteriores */
export function movimientosDe(filas: readonly ConsultaGuardada[], asin: string, precio: number | null | undefined, opciones: OpcionesDeMovimientos = {}): Movimientos {
  const u = { ...UMBRALES_DE_MOVIMIENTOS, ...opciones.umbrales }
  const semanales = filas.filter((f) => f.periodo === 'WEEK')
  const semana = opciones.semana ?? semanales.reduce<string | null>((m, f) => (m == null || f.desde > m ? f.desde : m), null)
  const vacio: Movimientos = { semana, semanasLeidas: 0, base: 0, suben: [], bajan: [], salen: [], caidaGeneral: false }
  if (!semana) return vacio

  const delProducto = semanales.filter((f) => f.asin === asin)
  const anteriores = Array.from({ length: u.semanasAtras }, (_, i) => semanaAntes(semana, i + 1))
  const porSemana = new Map<string, ConsultaGuardada[]>()
  for (const f of delProducto) if (f.desde === semana || anteriores.includes(f.desde)) porSemana.set(f.desde, [...(porSemana.get(f.desde) ?? []), f])
  const semanasLeidas = porSemana.size

  // Cada búsqueda en cada semana anterior, con su veredicto de esa semana (la relevancia es la de la semana más reciente en que salió)
  const historia = new Map<string, Array<{ semana: string; fila: ConsultaGuardada; delProducto: boolean }>>()
  for (const s of anteriores) {
    const deEsa = porSemana.get(s) ?? []
    if (deEsa.length === 0) continue
    const { busquedas } = diagnosticarTodas(deEsa, precio, opciones)
    for (const d of busquedas) {
      const k = claveDeBusqueda(d.fila.consulta)
      const lista = historia.get(k) ?? []
      if (!lista.some((x) => x.semana === s)) lista.push({ semana: s, fila: d.fila, delProducto: esDelProducto(d) })
      historia.set(k, lista)
    }
  }

  const ahora = new Map((porSemana.get(semana) ?? []).map((f) => [claveDeBusqueda(f.consulta), f]))
  const suben: Mov[] = []
  const bajan: Mov[] = []
  const salen: Mov[] = []
  let base = 0
  for (const lista of historia.values()) {
    if (lista.length < u.semanasMinimas) continue
    const masReciente = [...lista].sort((a, b) => b.semana.localeCompare(a.semana))[0]
    if (!masReciente.delProducto) continue
    if (media(lista.map((x) => x.fila.impresionesTotal ?? 0)) < u.impresionesMinimas) continue
    const cuotas = lista.map((x) => cuotasDe(x.fila).impresiones).filter((x): x is number => x != null)
    if (cuotas.length === 0) continue
    base++
    const cuotaMedia = media(cuotas)
    const comprasTotalMedia = media(lista.map((x) => x.fila.comprasTotal ?? 0))
    const consulta = masReciente.fila.consulta
    const fila = ahora.get(claveDeBusqueda(consulta))
    if (!fila) {
      salen.push({ consulta, cuotaAhora: null, cuotaMedia, deltaPt: null, comprasTotalMedia })
      continue
    }
    const cuotaAhora = cuotasDe(fila).impresiones
    if (cuotaAhora == null) continue
    const delta = cuotaAhora - cuotaMedia
    const relativo = cuotaMedia > 0 ? Math.abs(delta) / cuotaMedia : delta !== 0 ? Infinity : 0
    if (relativo >= u.cambioRelativo - 1e-9 && Math.abs(delta) * 100 >= u.cambioMinimoPt - 1e-9) (delta > 0 ? suben : bajan).push({ consulta, cuotaAhora, cuotaMedia, deltaPt: delta * 100, comprasTotalMedia })
  }
  const orden = (a: Mov, b: Mov) => b.comprasTotalMedia - a.comprasTotalMedia
  suben.sort(orden)
  bajan.sort(orden)
  salen.sort(orden)
  const caidaGeneral = base >= u.baseMinima && (bajan.length + salen.length) / base > u.caidaGeneral
  return { semana, semanasLeidas, base, suben, bajan, salen, caidaGeneral }
}
