import type { FilaStock, StockElegido } from '@/lib/fba/plan-tipos'
import { diaEnEspana } from '@/lib/fba/fechas'
import { marketplaceLabel } from '@/lib/types/amazon'

/**
 * QUÉ COPIA DEL LIBRO MAYOR SE LEE Y DE DÓNDE SALE EL STOCK DE CADA REFERENCIA.
 * ============================================================================
 * PURO. Se comprueba con lectura-elegida.prueba.ts. Spec remesas-pro §0.2, §11 D11 y D35.
 *
 * El libro mayor de Amazon es de TODA la cuenta, pero la pasada lo guarda una vez por cada mercado
 * que lee (`fba_lecturas` tiene una fila por conexión y mercado). Cada pantalla leía una copia
 * distinta: Creative Toys tenía España al 6 nov e Italia al 15 nov; el panel del cliente cogía el
 * mercado de la primera remesa y el inventario otro. Aquí hay UNA regla y la usan todos:
 *
 *   1. Las lecturas sin `leidoHasta` no cuentan si hay alguna con fecha.
 *   2. Gana la más reciente ENTRE LAS QUE CUBREN la historia que hace falta (`desdeNecesario`:
 *      el primer envío real o hoy − 400). Una copia al día de ayer pero que empieza hace un mes
 *      no sirve para el ritmo de 90 días ni para la estacionalidad: la de España al 6 nov desde
 *      2025 gana a la de Italia al 15 nov desde el 16 oct, y se avisa «ventas hasta el 6 nov».
 *   3. Si ninguna cubre, la que más historia tiene, con aviso.
 *   4. En empate, España. Si ninguna tiene fecha, España (o la primera, si no está).
 *
 * Y el stock: sale de los listings del mercado elegido. Si a una referencia le falta ahí (ShoesF
 * tiene SKU sin fila en España), se toma el de otro mercado de la misma conexión: el MÁXIMO, nunca
 * la suma, porque el stock paneuropeo se repite en cada país; y solo filas de los últimos 2 días.
 * Si solo hay filas viejas, se usa la más reciente y se dice cuántos días tiene (`viejoDias`): el
 * planificador baja la confianza un nivel y pone el aviso `stock_viejo`.
 */

export const MERCADO_ESPANA = 'A1RKKUPIHCS9HS'

/** Días que puede tener una fila de stock de OTRO mercado para fiarse de ella (D11) */
export const STOCK_RECIENTE_DIAS = 2

export interface LecturaCandidata {
  marketplaceId: string
  /** Último día leído del libro (YYYY-MM-DD); null = nunca se ha leído bien */
  leidoHasta: string | null
  /** Primer día que hay en el libro de esa copia (`select fecha … order fecha asc limit 1`) */
  leidoDesde: string | null
  ultimoError: string | null
}

export interface LecturaElegida<T extends LecturaCandidata> {
  elegida: T
  /** Frase para la banda de calidad; null si la elegida es la más reciente y cubre la historia */
  aviso: string | null
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** «6 nov» (y «6 nov 2025» si no es del año de `hoy`) */
export function fechaCorta(fecha: string, hoy?: string): string {
  const [a, m, d] = fecha.slice(0, 10).split('-').map(Number)
  const base = `${d} ${MESES[(m || 1) - 1]}`
  return hoy && Number(hoy.slice(0, 4)) !== a ? `${base} ${a}` : base
}

function dia(f: string): string {
  return f.slice(0, 10)
}

/** a < b → negativo; compara fechas YYYY-MM-DD (con o sin hora) */
function cmpFecha(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return -1
  if (b === null) return 1
  return dia(a) < dia(b) ? -1 : dia(a) > dia(b) ? 1 : 0
}

/** España primero; después, por id para que el resultado no dependa del orden de entrada */
function desempate(a: LecturaCandidata, b: LecturaCandidata): number {
  const ea = a.marketplaceId === MERCADO_ESPANA ? 0 : 1
  const eb = b.marketplaceId === MERCADO_ESPANA ? 0 : 1
  if (ea !== eb) return ea - eb
  return a.marketplaceId < b.marketplaceId ? -1 : a.marketplaceId > b.marketplaceId ? 1 : 0
}

function cubre(l: LecturaCandidata, desdeNecesario: string): boolean {
  return l.leidoDesde !== null && dia(l.leidoDesde) <= dia(desdeNecesario)
}

/**
 * Elige la copia del libro de una conexión. `null` solo si no hay ninguna lectura.
 * `desdeNecesario`: el primer envío real del cliente o hoy − 400 (lo que sea más reciente lo decide quien llama).
 */
export function elegirLectura<T extends LecturaCandidata>(lecturas: T[], desdeNecesario: string): LecturaElegida<T> | null {
  if (lecturas.length === 0) return null

  const conFecha = lecturas.filter((l) => l.leidoHasta !== null)
  if (conFecha.length === 0) {
    const elegida = [...lecturas].sort(desempate)[0]
    return { elegida, aviso: 'Las ventas no están leídas todavía: sin libro de Amazon no se puede calcular el ritmo' }
  }

  const masReciente = (a: T, b: T) => -cmpFecha(a.leidoHasta, b.leidoHasta) || desempate(a, b)
  const queCubren = conFecha.filter((l) => cubre(l, desdeNecesario))

  if (queCubren.length > 0) {
    const elegida = [...queCubren].sort(masReciente)[0]
    // ¿Hay otra copia más al día que no se ha cogido por falta de historia? Se dice, porque la banda
    // enseñará «leído hasta el 6 nov» y alguien verá en Amazon ventas del 14.
    const otraMasReciente = conFecha.some((l) => cmpFecha(l.leidoHasta, elegida.leidoHasta) > 0)
    const aviso = otraMasReciente
      ? `Ventas hasta el ${fechaCorta(elegida.leidoHasta!)}: la copia de ${marketplaceLabel(elegida.marketplaceId)} es la única con historia suficiente`
      : null
    return { elegida, aviso }
  }

  // Ninguna cubre: la de más historia (la que empieza antes). Sin `leidoDesde` = sin historia.
  const masHistoria = (a: T, b: T) => {
    if (a.leidoDesde === null && b.leidoDesde !== null) return 1
    if (b.leidoDesde === null && a.leidoDesde !== null) return -1
    return cmpFecha(a.leidoDesde, b.leidoDesde) || masReciente(a, b)
  }
  const elegida = [...conFecha].sort(masHistoria)[0]
  const aviso = elegida.leidoDesde
    ? `Las ventas solo están leídas desde el ${fechaCorta(elegida.leidoDesde, elegida.leidoHasta ?? undefined)}: falta historia para el ritmo y la estacionalidad`
    : 'El libro de Amazon está vacío: falta historia para el ritmo y la estacionalidad'
  return { elegida, aviso }
}

/* ------------------------------ Stock entre mercados ------------------------------ */

function restarDias(fecha: string, dias: number): string {
  const d = new Date(`${dia(fecha)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - dias)
  return d.toISOString().slice(0, 10)
}

function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${dia(desde)}T00:00:00Z`)
  const b = Date.parse(`${dia(hasta)}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/** El día (en España) de un `updated_at` con hora; una fecha sola se deja tal cual */
function diaDeActualizacion(updatedAt: string): string {
  if (updatedAt.length <= 10) return updatedAt
  const t = Date.parse(updatedAt)
  return Number.isFinite(t) ? diaEnEspana(new Date(t)) : dia(updatedAt)
}

/** La fila «más grande»: más vendibles; luego más entrante; luego la más reciente; luego por mercado */
function mayor(a: FilaStock, b: FilaStock): number {
  return (
    b.vendibles - a.vendibles ||
    b.entrante - a.entrante ||
    -cmpFecha(a.updatedAt, b.updatedAt) ||
    (a.marketplaceId < b.marketplaceId ? -1 : a.marketplaceId > b.marketplaceId ? 1 : 0)
  )
}

/**
 * Una fila de stock por referencia.
 * - La del mercado `preferido` (el de la lectura elegida), tal cual.
 * - Si no la hay: la MAYOR de las de otros mercados con `updatedAt` de los últimos 2 días (nunca la suma).
 * - Si todas las de otros mercados son viejas: la más reciente, con `viejoDias`.
 * - Si ninguna trae fecha: la mayor, con `viejoDias = null` (no se sabe la edad).
 */
export function stockEntreMercados(filas: FilaStock[], preferido: string, hoy: string): Map<string, StockElegido> {
  const porSku = new Map<string, FilaStock[]>()
  for (const f of filas) {
    const lista = porSku.get(f.sku)
    if (lista) lista.push(f)
    else porSku.set(f.sku, [f])
  }

  const limite = restarDias(hoy, STOCK_RECIENTE_DIAS)
  const salida = new Map<string, StockElegido>()

  for (const [sku, lista] of Array.from(porSku.entries())) {
    const propia = lista.filter((f) => f.marketplaceId === preferido).sort(mayor)[0]
    if (propia) {
      salida.set(sku, { ...propia, deOtroMercado: false, viejoDias: null })
      continue
    }

    const conFecha = lista.filter((f) => f.updatedAt !== null)
    const recientes = conFecha.filter((f) => diaDeActualizacion(f.updatedAt!) >= limite)
    if (recientes.length > 0) {
      salida.set(sku, { ...[...recientes].sort(mayor)[0], deOtroMercado: true, viejoDias: null })
      continue
    }

    if (conFecha.length > 0) {
      // Solo hay filas viejas: la más reciente de ellas (a igual fecha, la mayor)
      const vieja = [...conFecha].sort((a, b) => -cmpFecha(diaDeActualizacion(a.updatedAt!), diaDeActualizacion(b.updatedAt!)) || mayor(a, b))[0]
      salida.set(sku, { ...vieja, deOtroMercado: true, viejoDias: Math.max(0, diasEntre(diaDeActualizacion(vieja.updatedAt!), hoy)) })
      continue
    }

    salida.set(sku, { ...[...lista].sort(mayor)[0], deOtroMercado: true, viejoDias: null })
  }

  return salida
}
