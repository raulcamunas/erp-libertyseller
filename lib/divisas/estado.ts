/**
 * LOS TIPOS DE CAMBIO QUE YA TIENE EL NAVEGADOR (sin React: lo puede importar cualquier módulo, también los que usa el servidor, donde siempre está vacío).
 * Los rellena lib/divisas/cliente.ts al pedirlos a /api/tipos-de-cambio.
 */
let porEuro: Record<string, number> | null = null
const oyentes = new Set<() => void>()

export const tiposActuales = () => porEuro
export function ponerTipos(t: Record<string, number>) {
  porEuro = t
  for (const o of oyentes) o()
}
export function suscribirTipos(o: () => void) {
  oyentes.add(o)
  return () => {
    oyentes.delete(o)
  }
}

/** Un importe en `moneda`, en euros (null si aún no hay tipo de cambio) */
export function aEuros(importe: number, moneda: string): number | null {
  if (moneda === 'EUR') return importe
  const t = porEuro?.[moneda]
  return t ? importe / t : null
}
