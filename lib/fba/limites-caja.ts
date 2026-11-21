/**
 * LOS LÍMITES DE AMAZON PARA UNA CAJA (FBA, Europa). PURO: se comprueba con limites-caja.prueba.ts.
 *
 * Un solo sitio para las tres pantallas que los miran: el paso a «Lista» (ERP y enlace del cliente, vía `puedeAvanzar`), el Excel de embalaje y el
 * motor del envío por la API (`validarCaja`). Antes solo los miraba el motor: una caja de 28 kg llegaba a «Lista», precintada, y fallaba al enviarla.
 *
 * Excepción de Amazon: una caja con UNA sola unidad (un producto voluminoso que va en su propia caja) puede pasarse; entonces solo se avisa.
 */
export const LIMITES_CAJA = { maxLadoCm: 63.5, maxPesoKg: 23, pesadoDesdeKg: 15, minPesoKg: 0.1 }

const es = (n: number): string => n.toLocaleString('es-ES', { maximumFractionDigits: 2 })

export interface CajaParaLimites {
  numero: number
  largoCm: number | null
  anchoCm: number | null
  altoCm: number | null
  pesoKg: number | null
  /** Unidades dentro (para la excepción de una sola unidad) */
  unidades: number
}

/** Lo que se pasa de los límites en una caja, con su frase. `bloquea` = no deja pasar a «Lista» (una caja de una sola unidad solo avisa) */
export function fueraDeLimites(c: CajaParaLimites): Array<{ numero: number; texto: string; bloquea: boolean }> {
  const out: Array<{ numero: number; texto: string; bloquea: boolean }> = []
  const bloquea = c.unidades !== 1
  const nota = bloquea ? '' : ' (lleva una sola unidad: Amazon lo admite como producto voluminoso)'
  const lados = [c.largoCm, c.anchoCm, c.altoCm].filter((x): x is number => x != null && x > 0)
  if (lados.length > 0) {
    const mayor = Math.max(...lados)
    if (mayor > LIMITES_CAJA.maxLadoCm) out.push({ numero: c.numero, texto: `La caja ${c.numero} mide ${es(mayor)} cm de lado y Amazon admite ${es(LIMITES_CAJA.maxLadoCm)} cm${nota}`, bloquea })
  }
  if (c.pesoKg != null && c.pesoKg > LIMITES_CAJA.maxPesoKg) out.push({ numero: c.numero, texto: `La caja ${c.numero} pesa ${es(c.pesoKg)} kg y Amazon admite ${LIMITES_CAJA.maxPesoKg} kg${nota}`, bloquea })
  return out
}

/** ¿Lleva la etiqueta de «pesado»? (desde 15 kg) */
export const esCajaPesada = (pesoKg: number | null): boolean => pesoKg != null && pesoKg >= LIMITES_CAJA.pesadoDesdeKg

/** Las frases que impiden pasar a «Lista», de todas las cajas */
export const motivosDeLimites = (cajas: CajaParaLimites[]): string[] => cajas.flatMap(fueraDeLimites).filter((x) => x.bloquea).map((x) => x.texto)
