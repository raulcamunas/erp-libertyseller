/**
 * SELECCIONAR VARIAS TAREAS CON UN CUADRO (clic y arrastrar sobre el fondo, como en el escritorio). PURO: las cuentas de rectángulos y de conjuntos; lo del ratón está en
 * components/tareas-clientes/useMarco.tsx.
 */

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

/** El rectángulo que forman dos puntos, sea cual sea la dirección en que se arrastró */
export function rectDeDosPuntos(x0: number, y0: number, x1: number, y1: number): Rect {
  return { left: Math.min(x0, x1), top: Math.min(y0, y1), right: Math.max(x0, x1), bottom: Math.max(y0, y1) }
}

/** ¿Se tocan (aunque sea un poco)? Rozar el borde cuenta como tocar */
export const seTocan = (a: Rect, b: Rect): boolean => a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top

/** La parte de `a` que cae dentro de `limite`; null si no cae nada (lo que está tapado por el borde de una columna con scroll no cuenta) */
export function recortar(a: Rect, limite: Rect | null): Rect | null {
  if (!limite) return a
  const r = { left: Math.max(a.left, limite.left), top: Math.max(a.top, limite.top), right: Math.min(a.right, limite.right), bottom: Math.min(a.bottom, limite.bottom) }
  return r.left <= r.right && r.top <= r.bottom ? r : null
}

/** La selección que queda: la que ya había más lo tocado (si se mantuvo Mayús/Ctrl/Cmd al empezar) o solo lo tocado */
export function combinarSeleccion(base: ReadonlySet<string>, tocadas: readonly string[], aditivo: boolean): Set<string> {
  return new Set(aditivo ? [...base, ...tocadas] : tocadas)
}

/** Marca o desmarca una tarea */
export function alternar(seleccion: ReadonlySet<string>, id: string): Set<string> {
  const n = new Set(seleccion)
  if (!n.delete(id)) n.add(id)
  return n
}
