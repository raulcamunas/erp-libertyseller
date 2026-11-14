import type { EnvioInbound } from './inbound'
import { ESTADOS_DE_ENVIO_YA_SALIDO } from './inbound'

/**
 * QUÉ ENVÍOS DE AMAZON FALTAN POR IMPORTAR — la parte PURA (se comprueba con envios-nuevos.prueba.ts). La que habla con Amazon está en envios-nuevos-servidor.ts.
 *
 * Un envío es «nuevo» si Amazon lo tiene en la cuenta del cliente, ya ha salido, y ninguna remesa del ERP lleva su número. Se queda fuera:
 *   · lo que ya está en el ERP (dos remesas para el mismo envío contarían sus ventas dos veces),
 *   · los borradores y los cancelados (no traen unidades fiables).
 */

export interface EnvioNuevo {
  shipmentId: string
  nombre: string | null
  estado: string
  centro: string | null
  mercadoId: string
  mercadoNombre: string
  /** 'YYYY-MM-DD' leído del nombre del envío, si lo lleva (es la mejor fecha de envío que hay) */
  diaCreacion: string | null
}

export const FORMATO_FBA = /^FBA[0-9A-Z]{6,20}$/

/** De lo que dice Amazon, lo que falta por importar. Sin repetidos (el mismo envío puede salir en dos mercados de la cuenta) y los más recientes primero por nombre/día */
export function soloNuevos<T extends Pick<EnvioInbound, 'shipmentId' | 'estado'>>(enAmazon: readonly T[], yaImportados: ReadonlySet<string>): T[] {
  const vistos = new Set<string>()
  const salida: T[] = []
  for (const e of enAmazon) {
    const id = e.shipmentId.trim().toUpperCase()
    if (!FORMATO_FBA.test(id) || vistos.has(id) || yaImportados.has(id)) continue
    if (!ESTADOS_DE_ENVIO_YA_SALIDO.includes(e.estado)) continue
    vistos.add(id)
    salida.push(e)
  }
  return salida
}

/** Más recientes primero: por el día del nombre y, a igualdad, por el número (los FBA nuevos «crecen») */
export function ordenarNuevos<T extends Pick<EnvioNuevo, 'diaCreacion' | 'shipmentId'>>(lista: readonly T[]): T[] {
  return [...lista].sort((a, b) => (b.diaCreacion ?? '').localeCompare(a.diaCreacion ?? '') || b.shipmentId.localeCompare(a.shipmentId))
}
