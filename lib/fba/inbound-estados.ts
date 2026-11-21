/**
 * LOS ESTADOS DE UN ENVÍO DE AMAZON, SIN NADA DE SERVIDOR.
 * Pura: se puede importar desde una pantalla sin arrastrar la API de Amazon.
 * Vive aparte de inbound.ts por eso; inbound.ts la vuelve a exportar.
 */

/** Los estados por los que pasa un envío, en orden */
export const ESTADOS_INBOUND = [
  'WORKING',
  'READY_TO_SHIP',
  'SHIPPED',
  'IN_TRANSIT',
  'DELIVERED',
  'CHECKED_IN',
  'RECEIVING',
  'CLOSED',
  'CANCELLED',
  'DELETED',
  'ERROR',
] as const

/**
 * ¿Merece la pena volver a preguntar por este envío?
 *
 * Un envío CERRADO o CANCELADO ya no cambia: seguir preguntando cada noche es
 * gastar cupo de Amazon para recibir la misma respuesta. Los demás sí, porque
 * es justo mientras viajan cuando interesa saber dónde están.
 */
export function sigueVivo(estado: string | null): boolean {
  if (!estado) return true
  return !['CLOSED', 'CANCELLED', 'DELETED', 'ERROR'].includes(estado)
}

/** Para la pantalla: el estado en español y de qué color va */
export const ESTADO_INBOUND_TEXTO: Record<string, { texto: string; tono: 'espera' | 'camino' | 'ok' | 'malo' }> = {
  WORKING: { texto: 'Preparándose', tono: 'espera' },
  READY_TO_SHIP: { texto: 'Listo para salir', tono: 'espera' },
  SHIPPED: { texto: 'Enviado', tono: 'camino' },
  IN_TRANSIT: { texto: 'En tránsito', tono: 'camino' },
  DELIVERED: { texto: 'Entregado en Amazon', tono: 'camino' },
  CHECKED_IN: { texto: 'Registrado', tono: 'camino' },
  RECEIVING: { texto: 'Recibiendo', tono: 'camino' },
  CLOSED: { texto: 'Cerrado', tono: 'ok' },
  CANCELLED: { texto: 'Cancelado', tono: 'malo' },
  DELETED: { texto: 'Borrado', tono: 'malo' },
  ERROR: { texto: 'Con error', tono: 'malo' },
}

/** El orden de avance de un envío en Amazon: el estado de una remesa con varios FBA es el del MENOS avanzado (sigue viva mientras falte uno) */
const ORDEN_DE_AVANCE = ['WORKING', 'READY_TO_SHIP', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CHECKED_IN', 'RECEIVING', 'CLOSED']

/**
 * PURO. Junta varios envíos de Amazon de una misma remesa (Amazon la reparte en varios centros): el estado es el del envío MENOS avanzado sin contar los
 * cancelados (si todos están cancelados, el del primero) y las unidades se SUMAN por SKU.
 */
export function combinarEnvios(envios: ReadonlyArray<{ estado: string; lineas: ReadonlyArray<{ sku: string; enviadas: number; recibidas: number }> }>): { estado: string | null; lineas: Array<{ sku: string; enviadas: number; recibidas: number }> } {
  const vivos = envios.filter((e) => !['CANCELLED', 'DELETED', 'ERROR'].includes(e.estado))
  const base = vivos.length > 0 ? vivos : envios
  let estado: string | null = null
  for (const e of base) {
    const i = ORDEN_DE_AVANCE.indexOf(e.estado)
    const j = estado == null ? Number.POSITIVE_INFINITY : ORDEN_DE_AVANCE.indexOf(estado)
    if (estado == null || (i >= 0 && (j < 0 || i < j))) estado = e.estado
  }
  const porSku = new Map<string, { sku: string; enviadas: number; recibidas: number }>()
  for (const e of vivos) {
    for (const l of e.lineas) {
      const x = porSku.get(l.sku) ?? { sku: l.sku, enviadas: 0, recibidas: 0 }
      x.enviadas += l.enviadas
      x.recibidas += l.recibidas
      porSku.set(l.sku, x)
    }
  }
  return { estado, lineas: [...porSku.values()] }
}
