/**
 * EL BOTÓN «ATRÁS» DE LA CABECERA DEL MÓVIL: ¿hay a dónde volver dentro del ERP?
 * ==============================================================================
 * PURO. Se comprueba con historial.prueba.ts. La pila de rutas de esta pestaña se guarda en `sessionStorage` (la escribe la cabecera):
 *   · Llegar a una ruta que es la de antes de la última = se ha vuelto atrás: se quita la última.
 *   · Llegar a la misma ruta (otro `?filtro`): no cambia nada.
 *   · Cualquier otra: se apila.
 * Con algo debajo, «Atrás» es el del navegador (respeta la ruta exacta de la que se vino); sin nada (se entró por un enlace, por una notificación o
 * recargando), «Atrás» lleva al Inicio en vez de sacar a la persona del ERP.
 */

export const CLAVE_HISTORIAL = 'erp:movil:historial'
const MAX = 30

export function apilarRuta(pila: readonly string[], ruta: string): string[] {
  if (!ruta) return [...pila]
  const ultima = pila[pila.length - 1]
  if (ultima === ruta) return [...pila]
  if (pila.length >= 2 && pila[pila.length - 2] === ruta) return pila.slice(0, -1)
  return [...pila, ruta].slice(-MAX)
}

export function hayAtras(pila: readonly string[]): boolean {
  return pila.length >= 2
}
