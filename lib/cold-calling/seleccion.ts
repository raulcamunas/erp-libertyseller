/**
 * ELEGIR VARIOS A LA VEZ EN UNA TABLA PAGINADA: UNO A UNO, UNA PÁGINA ENTERA, O «TODOS LOS QUE CUMPLEN EL FILTRO» — PURO.
 * ========================================================================================================================
 * Lo usan la tabla de leads y la del banco de tiendas de la pantalla de Listas. Se comprueba con seleccion.prueba.ts.
 *
 * DOS MODOS, porque una tabla de 100 filas no puede guardar uno por uno los 3.482 leads que cumplen un filtro:
 *   · `ids`     los elegidos uno a uno (o página a página). Sobreviven al cambiar de página.
 *   · `filtro`  TODOS los que cumplen el filtro que hay ahora, MENOS los `excluidos` que se desmarcaron a mano. No se sabe cuáles son hasta el momento de actuar: el
 *               servidor vuelve a preguntar a la base (idsDelFiltro en listas-servidor.ts), así que lo que llegó entre medias también cuenta.
 *
 * UNA SELECCIÓN SOLO VALE PARA EL FILTRO CON EL QUE SE HIZO. Quien la usa tiene que vaciarla cuando cambia el filtro (la pantalla lo hace): si no, «todos los que cumplen el
 * filtro» pasaría a querer decir otra cosa de la que se veía al marcar.
 */

export type Seleccion =
  | { readonly modo: 'ids'; readonly ids: ReadonlySet<string> }
  | { readonly modo: 'filtro'; readonly excluidos: ReadonlySet<string> }

export const SELECCION_VACIA: Seleccion = { modo: 'ids', ids: new Set<string>() }

export const seleccionarElFiltro = (): Seleccion => ({ modo: 'filtro', excluidos: new Set<string>() })

/** ¿Está esta fila elegida? */
export function estaElegido(sel: Seleccion, id: string): boolean {
  return sel.modo === 'ids' ? sel.ids.has(id) : !sel.excluidos.has(id)
}

/** Cuántos hay elegidos. `totalDelFiltro` es cuántos cumplen el filtro ahora (lo que dice la base) */
export function cuantosHay(sel: Seleccion, totalDelFiltro: number): number {
  return sel.modo === 'ids' ? sel.ids.size : Math.max(0, totalDelFiltro - sel.excluidos.size)
}

export function haySeleccion(sel: Seleccion, totalDelFiltro: number): boolean {
  return cuantosHay(sel, totalDelFiltro) > 0
}

/** Marca o desmarca UNA fila */
export function alternar(sel: Seleccion, id: string): Seleccion {
  if (sel.modo === 'ids') {
    const ids = new Set(sel.ids)
    if (!ids.delete(id)) ids.add(id)
    return { modo: 'ids', ids }
  }
  const excluidos = new Set(sel.excluidos)
  if (!excluidos.delete(id)) excluidos.add(id)
  return { modo: 'filtro', excluidos }
}

/** ¿Están elegidas TODAS las filas de esta página? (la casilla de la cabecera). Una página vacía no está «completa» */
export function paginaCompleta(sel: Seleccion, idsDeLaPagina: readonly string[]): boolean {
  return idsDeLaPagina.length > 0 && idsDeLaPagina.every((id) => estaElegido(sel, id))
}

/** ¿Hay alguna elegida y alguna sin elegir? (la casilla de la cabecera, a medias) */
export function paginaAMedias(sel: Seleccion, idsDeLaPagina: readonly string[]): boolean {
  const elegidas = idsDeLaPagina.filter((id) => estaElegido(sel, id)).length
  return elegidas > 0 && elegidas < idsDeLaPagina.length
}

/** Marca todas las filas de esta página (y deja como estaban las de otras páginas) */
export function elegirPagina(sel: Seleccion, idsDeLaPagina: readonly string[]): Seleccion {
  if (sel.modo === 'ids') {
    const ids = new Set(sel.ids)
    for (const id of idsDeLaPagina) ids.add(id)
    return { modo: 'ids', ids }
  }
  const excluidos = new Set(sel.excluidos)
  for (const id of idsDeLaPagina) excluidos.delete(id)
  return { modo: 'filtro', excluidos }
}

/** Desmarca todas las filas de esta página */
export function quitarPagina(sel: Seleccion, idsDeLaPagina: readonly string[]): Seleccion {
  if (sel.modo === 'ids') {
    const ids = new Set(sel.ids)
    for (const id of idsDeLaPagina) ids.delete(id)
    return { modo: 'ids', ids }
  }
  const excluidos = new Set(sel.excluidos)
  for (const id of idsDeLaPagina) excluidos.add(id)
  return { modo: 'filtro', excluidos }
}

/** La casilla de la cabecera: si están todas, las quita; si no, las pone */
export function alternarPagina(sel: Seleccion, idsDeLaPagina: readonly string[]): Seleccion {
  return paginaCompleta(sel, idsDeLaPagina) ? quitarPagina(sel, idsDeLaPagina) : elegirPagina(sel, idsDeLaPagina)
}

/**
 * ¿Hay que ofrecer «Elegir los N que cumplen el filtro»? Cuando están elegidas todas las de la página, hay más de las que caben en ella y todavía no se eligió el filtro entero.
 */
export function ofrecerElegirElFiltro(sel: Seleccion, idsDeLaPagina: readonly string[], totalDelFiltro: number): boolean {
  return sel.modo === 'ids' && paginaCompleta(sel, idsDeLaPagina) && totalDelFiltro > idsDeLaPagina.length && sel.ids.size < totalDelFiltro
}

/** Lo que se manda al servidor: los id elegidos, o «todos los del filtro menos estos» */
export type PeticionDeSeleccion = { ids: string[] } | { todos: true; excluidos: string[] }

export function aPeticion(sel: Seleccion): PeticionDeSeleccion {
  return sel.modo === 'ids' ? { ids: [...sel.ids] } : { todos: true, excluidos: [...sel.excluidos] }
}
