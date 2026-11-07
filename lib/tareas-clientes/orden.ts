/**
 * EL SITIO DE CADA TARJETA DENTRO DE SU COLUMNA.
 *
 * Cada tarea lleva un número (`orden`) y se ordena por él. Soltar una tarjeta entre otras dos le da la media de las dos: no hace falta reescribir el orden de las demás, y
 * dos personas arrastrando a la vez no se pisan. Cuando dos números se quedan tan juntos que ya no caben más entre medias (muchos arrastres seguidos en el mismo hueco),
 * se renumera la columna entera de golpe.
 */

export const SEPARACION = 1024
const MARGEN_MINIMO = 1e-6

/** El número de una tarjeta que va entre `antes` y `despues` (null = no hay nadie a ese lado) */
export function ordenEntre(antes: number | null, despues: number | null): number {
  if (antes == null && despues == null) return SEPARACION
  if (antes == null) return (despues as number) - SEPARACION
  if (despues == null) return antes + SEPARACION
  return (antes + despues) / 2
}

/** El número de una tarjeta que va la última de su columna */
export function ordenAlFinal(ordenes: readonly number[]): number {
  return ordenes.length === 0 ? SEPARACION : Math.max(...ordenes) + SEPARACION
}

/** ¿Ya no cabe nada entre estos dos? Entonces hay que renumerar la columna */
export function hayQueRenumerar(antes: number | null, despues: number | null): boolean {
  return antes != null && despues != null && Math.abs(despues - antes) < MARGEN_MINIMO
}

/** Los números nuevos de una columna entera, en el orden de sus ids */
export function renumerar(ids: readonly string[]): Array<{ id: string; orden: number }> {
  return ids.map((id, i) => ({ id, orden: (i + 1) * SEPARACION }))
}

/**
 * Dónde cae una tarjeta soltada en `posicion` de una columna. `columna` es la columna YA SIN la tarjeta que se mueve (sus ids en orden) y `ordenes` el número de cada
 * una. Devuelve el número nuevo y, si hubo que renumerar, los de toda la columna.
 */
export function colocar(
  columna: readonly string[],
  ordenes: ReadonlyMap<string, number>,
  posicion: number
): { orden: number; renumeradas: Array<{ id: string; orden: number }> | null } {
  const i = Math.max(0, Math.min(posicion, columna.length))
  const antes = i > 0 ? (ordenes.get(columna[i - 1]) ?? null) : null
  const despues = i < columna.length ? (ordenes.get(columna[i]) ?? null) : null
  if (hayQueRenumerar(antes, despues)) {
    const renumeradas = renumerar([...columna.slice(0, i), '__movida__', ...columna.slice(i)])
    const propia = renumeradas.find((r) => r.id === '__movida__')!
    return { orden: propia.orden, renumeradas: renumeradas.filter((r) => r.id !== '__movida__') }
  }
  return { orden: ordenEntre(antes, despues), renumeradas: null }
}
