/**
 * LEER TODAS LAS FILAS DE UNA CONSULTA, DE MIL EN MIL.
 *
 * Supabase corta cualquier consulta a 1.000 filas y NO da error: devuelve las primeras mil y ya. Con el libro mayor de inventario eso
 * es letal para el reparto FIFO, porque las ventas que quedan fuera simplemente no se descuentan: en Opinas (3.130 movimientos) la pantalla
 * de Remesas veía una tercera parte de las ventas y enseñaba «0 % vendido» en envíos de meses atrás.
 *
 * Quien llama tiene que ordenar por una columna ÚNICA al final (por ejemplo `.order('fecha').order('id')`): `.range()` sobre un orden con
 * empates puede repetir o saltarse filas entre tramos.
 *
 * Un error NO se traga: quedarse a medias no daría ningún aviso y devolvería un reparto con ventas de menos, que es justo lo que esto arregla.
 */
export const PAGINA_SUPABASE = 1000

export async function leerTodo<T>(
  construir: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: unknown }>,
  pagina: number = PAGINA_SUPABASE
): Promise<T[]> {
  const todas: T[] = []
  for (let desde = 0; ; desde += pagina) {
    const { data, error } = await construir(desde, desde + pagina - 1)
    if (error) throw error
    const tramo = (data as T[] | null) ?? []
    todas.push(...tramo)
    if (tramo.length < pagina) break
  }
  return todas
}
