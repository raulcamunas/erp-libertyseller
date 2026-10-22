/**
 * LOS NÚMEROS QUE VAN JUNTO A UNA APLICACIÓN EN EL MENÚ, y que no son de la aplicación que se está viendo.
 *
 * Hoy uno: cuántas conversaciones de correo tienen algo sin leer. Lo publican el lector de correo nuevo (cada minuto, esté donde esté la
 * persona) y la propia pantalla de Correo (al instante, en cuanto lee algo); lo pinta el menú lateral. Módulo del navegador, sin React:
 * suscribirse y leer es lo que necesita `useSyncExternalStore`.
 */

let correoSinLeer = 0
const oyentes = new Set<() => void>()

export function ponerCorreoSinLeer(n: number): void {
  const nuevo = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  if (nuevo === correoSinLeer) return
  correoSinLeer = nuevo
  for (const oyente of [...oyentes]) oyente()
}

export const leerCorreoSinLeer = (): number => correoSinLeer

export function suscribirContadores(oyente: () => void): () => void {
  oyentes.add(oyente)
  return () => {
    oyentes.delete(oyente)
  }
}
