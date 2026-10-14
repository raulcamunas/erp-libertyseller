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
