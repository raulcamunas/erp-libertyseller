/**
 * CUÁNTO CUESTA TENER EL PRODUCTO PARADO EN EL ALMACÉN DE AMAZON: UNA ESTIMACIÓN.
 * ==============================================================================
 * PURO. Se comprueba con almacenaje.prueba.ts.
 *
 * ES UNA ESTIMACIÓN Y LA PANTALLA LO DICE. Amazon cobra el almacenaje por VOLUMEN
 * (metros cúbicos) y por mes, y en el espejo del catálogo no hay medidas de los productos:
 * hay unidades y precios. Así que el cálculo parte de un volumen medio por unidad que se
 * puede ajustar en la propia pantalla, y de las tarifas por metro cúbico, que también.
 * Para la cifra exacta, el informe de tarifas de Seller Central; esto sirve para saber de
 * qué orden es lo que cuesta dejar la mercancía quieta.
 *
 *
 * ============ DE DÓNDE SALEN LAS TARIFAS ============
 *
 * Los valores por defecto (27,54 €/m³ de enero a septiembre y 52,20 €/m³ de octubre a
 * diciembre, tamaño estándar en Amazon.es) son los que recogía una guía de tarifas de
 * julio de 2026. No son un dato verificado contra Amazon —otras fuentes dan cifras
 * distintas—, y Amazon las revisa cada año: por eso se pueden cambiar en la pantalla y no
 * están escritas en ningún cálculo.
 *
 * EL RECARGO POR ANTIGÜEDAD NO TIENE VALOR POR DEFECTO. Amazon cobra de más al stock que
 * lleva mucho tiempo en el almacén, pero no se ha podido confirmar la tarifa vigente de
 * Europa para 2026, y una cifra inventada sería peor que ninguna. Mientras no se
 * configure, la pantalla cuenta cuántas unidades ya están en esa zona (más de 270 días) y
 * no pone importe.
 *
 * Las tarifas de temporada alta (de octubre a diciembre) casi duplican las de la baja: lo
 * que hoy cuesta una cantidad, en noviembre cuesta el doble. Es el momento del año en que
 * más caro sale tener stock parado.
 */

export interface SupuestosAlmacenaje {
  /** Volumen medio de una unidad, en litros (1 m³ = 1.000 litros) */
  litrosPorUnidad: number
  /** €/m³ y mes, de enero a septiembre */
  tarifaBaja: number
  /** €/m³ y mes, de octubre a diciembre */
  tarifaAlta: number
  /** €/m³ y mes EXTRA para lo que lleva más de 270 días. null = sin configurar */
  recargoAntiguedad: number | null
}

export const SUPUESTOS_POR_DEFECTO: SupuestosAlmacenaje = {
  litrosPorUnidad: 8,
  tarifaBaja: 27.54,
  tarifaAlta: 52.2,
  recargoAntiguedad: null,
}

/** La tarifa de un mes (1 = enero) */
export function tarifaDelMes(mes: number, s: SupuestosAlmacenaje = SUPUESTOS_POR_DEFECTO): number {
  return mes >= 10 ? s.tarifaAlta : s.tarifaBaja
}

/** El mes (1-12) de un día 'YYYY-MM-DD' */
export const mesDe = (fecha: string): number => Number(fecha.slice(5, 7))

/** Metros cúbicos que ocupan `unidades` */
export function metrosCubicos(unidades: number, s: SupuestosAlmacenaje = SUPUESTOS_POR_DEFECTO): number {
  return (Math.max(0, unidades) * Math.max(0, s.litrosPorUnidad)) / 1000
}

const redondea = (n: number) => Math.round(n * 100) / 100

/** Lo que cuesta al mes guardar `unidades` */
export function costeMensual(unidades: number, mes: number, s: SupuestosAlmacenaje = SUPUESTOS_POR_DEFECTO): number {
  return redondea(metrosCubicos(unidades, s) * tarifaDelMes(mes, s))
}

export interface EstimacionAlmacenaje {
  m3: number
  tarifa: number
  /** Euros al mes de guardar todo */
  almacenajeMes: number
  /** Euros al mes del recargo por antigüedad. null si no hay tarifa configurada */
  recargoMes: number | null
  unidadesConRecargo: number
  /** El mes siguiente al actual y lo que costaría guardarlo: para ver el salto de temporada */
  almacenajeMesSiguiente: number
}

/**
 * La estimación de un cliente.
 *
 * `unidades` son las que están DENTRO del almacén —lo que viene de camino todavía no paga—
 * y `unidadesAntiguas` las que llevan más de 270 días.
 */
export function estimarAlmacenaje(
  entrada: { unidades: number; unidadesAntiguas: number },
  mes: number,
  s: SupuestosAlmacenaje = SUPUESTOS_POR_DEFECTO
): EstimacionAlmacenaje {
  const m3 = metrosCubicos(entrada.unidades, s)
  const tarifa = tarifaDelMes(mes, s)
  const recargoMes = s.recargoAntiguedad === null ? null : redondea(metrosCubicos(entrada.unidadesAntiguas, s) * s.recargoAntiguedad)
  return {
    m3: Math.round(m3 * 1000) / 1000,
    tarifa,
    almacenajeMes: redondea(m3 * tarifa),
    recargoMes,
    unidadesConRecargo: entrada.unidadesAntiguas,
    almacenajeMesSiguiente: redondea(m3 * tarifaDelMes(mes === 12 ? 1 : mes + 1, s)),
  }
}
