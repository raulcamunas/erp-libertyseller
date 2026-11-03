import { COMISIONES_POR_CATEGORIA, type TarifaComision } from './comisiones'

/**
 * EL MARGEN EN PCCOMPONENTES — PURO.
 * =================================
 * Entra un coste y un precio de mercado, sale lo que quedaría. No toca la red ni la base: se comprueba con unos pocos números.
 *
 * Lo que hay que saber de cómo cobra PcComponentes (sacado del histórico real de Entrais, no de su documentación):
 *
 *   · El comprador paga el precio CON IVA. La comisión se calcula sobre el precio SIN IVA:    comisión = fija + pct × (precio / 1,21)
 *   · No hay «tasa digital» como en Amazon. Y el IVA de la comisión se deduce, así que no cuenta.
 *   · `coste` es el del ERP: proveedor + canon + porte, SIN IVA. El envío al cliente ya va dentro del porte.
 *   · NO cuenta las devoluciones (entre un 9 % y un 25 % de lo vendido según el año): el margen que sale es antes de ellas.
 *
 *     margen = (base − comisión − coste) / base       con base = precio / 1,21
 *     precio mínimo para un margen m:   base = (coste + fija) / (1 − m − pct),   precio = base × 1,21
 */

export const IVA = 0.21

/** Para una categoría que no está en el histórico: la comisión más alta que se ha visto en accesorios, que es la prudente */
export const TARIFA_POR_DEFECTO: TarifaComision = { fija: 0.7, pct: 0.17, lineas: 0, origen: 'antigua' }

export function normalizarCategoria(categoria: string | null | undefined): string {
  return (categoria ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

export interface ComisionDeCategoria extends TarifaComision {
  /** true = la categoría no está en el histórico y se usa la tarifa por defecto */
  porDefecto: boolean
}

export function comisionDe(categoria: string | null | undefined): ComisionDeCategoria {
  const t = COMISIONES_POR_CATEGORIA.get(normalizarCategoria(categoria))
  return t ? { ...t, porDefecto: false } : { ...TARIFA_POR_DEFECTO, porDefecto: true }
}

const redondear = (n: number) => Math.round(n * 100) / 100

export interface MargenAlPrecio {
  /** Precio sin IVA */
  base: number
  comision: number
  beneficio: number
  /** Sobre la base sin IVA: 0,05 = 5 % */
  margen: number
}

export function margenAlPrecio(precioConIva: number, coste: number, tarifa: TarifaComision): MargenAlPrecio {
  const base = precioConIva / (1 + IVA)
  const comision = tarifa.fija + tarifa.pct * base
  const beneficio = base - comision - coste
  return { base: redondear(base), comision: redondear(comision), beneficio: redondear(beneficio), margen: base > 0 ? beneficio / base : 0 }
}

/** El precio CON IVA que deja justo el margen pedido. null = imposible: la comisión y el margen se comen todo lo que entra */
export function precioMinimoParaMargen(coste: number, margen: number, tarifa: TarifaComision): number | null {
  const resto = 1 - margen - tarifa.pct
  if (resto <= 0.001 || coste <= 0) return null
  return redondear(((coste + tarifa.fija) / resto) * (1 + IVA))
}

export interface JuicioDeMercado {
  comision: ComisionDeCategoria
  /** Lo que quedaría vendiendo al precio más bajo del mercado. null = nadie lo vende */
  alMercado: MargenAlPrecio | null
  /** El precio con IVA con el que se llega al margen objetivo */
  suelo: number | null
  /** true = el suelo está en el precio de mercado o por debajo: se puede igualar al más barato y cumplir el margen */
  competitivo: boolean
  /** Cuánto habría que bajar el coste, o resignar de margen, para llegar: suelo − mercado. Positivo = estamos por encima */
  sobreElMercado: number | null
}

export function juzgar(entrada: { coste: number; categoria: string | null; precioMercado: number | null; margenObjetivo: number }): JuicioDeMercado {
  const comision = comisionDe(entrada.categoria)
  const suelo = precioMinimoParaMargen(entrada.coste, entrada.margenObjetivo, comision)
  const alMercado = entrada.precioMercado !== null && entrada.precioMercado > 0 ? margenAlPrecio(entrada.precioMercado, entrada.coste, comision) : null
  return {
    comision,
    alMercado,
    suelo,
    competitivo: alMercado !== null && suelo !== null && suelo <= (entrada.precioMercado ?? 0) + 0.005,
    sobreElMercado: suelo !== null && entrada.precioMercado !== null ? redondear(suelo - entrada.precioMercado) : null,
  }
}
