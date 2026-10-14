/** PURA: sin base de datos. Ver seguimiento.ts */

export interface UltimoEvento {
  estado_amazon: string | null
  unidades_recibidas: number | null
}

/** ¿Hay algo que apuntar? La primera observación (sin último evento) siempre se apunta */
export function hayCambio(
  ultimo: UltimoEvento | null,
  ahora: { estado: string | null; recibidas: number | null }
): boolean {
  if (!ultimo) return true
  return ultimo.estado_amazon !== ahora.estado || ultimo.unidades_recibidas !== ahora.recibidas
}

