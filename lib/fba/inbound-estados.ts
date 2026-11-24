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

/**
 * ¿SE SIGUE MIRANDO UN ENVÍO YA CERRADO? (24 nov 2026). PURO.
 *
 * Amazon da un envío por «Cerrado» y DESPUÉS sigue conciliando: FBA15MS4X7Q2 de Creative Toys se cerró el 22 nov con 1.555 de 1.757
 * unidades y el 24 ya contaba 1.628 (4O-KBRE-B8Q6 pasó de 108 a 144; IA-AIQW-970Z, de 66 a 84). El ERP dejaba de mirarlo al verlo cerrado y
 * el CSV para reclamar pedía 202 unidades cuando Amazon ya solo debía 129. Ahora un cerrado se sigue mirando mientras:
 *
 *   · le falten unidades (recibidas < enviadas): uno completo ya no va a cambiar,
 *   · no hayan pasado los 60 días del plazo para reclamar desde que se vio cerrado, y
 *   · cada 6 horas como mucho: Amazon concilia despacio y cada vistazo son llamadas a su API.
 */
export const SEGUIR_CERRADO = { diasDesdeElCierre: 60, horasEntreVistazos: 6 } as const

export function seguirCerrado(p: {
  enviadas: number
  recibidas: number
  /** Cuándo se vio cerrado por primera vez (ISO); null = no consta (remesas viejas, de antes del historial): no se sigue */
  cerradoDesde: string | null
  /** El último vistazo (ISO) */
  seguimientoAt: string | null
  ahora: Date
}): boolean {
  if (!(p.enviadas > p.recibidas)) return false
  if (!p.cerradoDesde) return false
  const ms = p.ahora.getTime()
  if (ms - Date.parse(p.cerradoDesde) > SEGUIR_CERRADO.diasDesdeElCierre * 86_400_000) return false
  if (p.seguimientoAt && ms - Date.parse(p.seguimientoAt) < SEGUIR_CERRADO.horasEntreVistazos * 3_600_000) return false
  return true
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
