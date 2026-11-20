/**
 * SEO · LEER UNA TABLA ENTERA A TROZOS. Supabase (PostgREST) corta cada respuesta en 1000 filas aunque se pida `.limit(5000)`, y lo hace SIN avisar: lo que pase de ahí se pierde.
 *
 * leerTodo() pide páginas de 1000 con `.range` hasta que una trae menos. La consulta que se construye DEBE llevar un orden ÚNICO (la clave primaria o un desempate que la complete): con un orden
 * que empata, Postgres puede repartir las filas empatadas de otra forma en cada página, y entonces unas salen dos veces y otras ninguna.
 */

export const TAMANO_DE_PAGINA = 1000
export const MAX_PAGINAS = 50

interface RespuestaDePagina<T> {
  data: T[] | null
  error: unknown
}

/**
 * Todas las filas de una consulta. `construir(desde, hasta)` devuelve la consulta ya con su `.range(desde, hasta)` y su orden. Lanza el error de la base tal cual (quien llama decide si una tabla
 * que falta es un vacío). Con 50 páginas (50.000 filas) se para y lo avisa en el registro: es un tope de seguridad, no un límite esperado.
 */
export async function leerTodo<T>(construir: (desde: number, hasta: number) => PromiseLike<RespuestaDePagina<T>>, opciones?: { etiqueta?: string; tamano?: number; maxPaginas?: number }): Promise<T[]> {
  const tamano = opciones?.tamano ?? TAMANO_DE_PAGINA
  const maxPaginas = opciones?.maxPaginas ?? MAX_PAGINAS
  const salida: T[] = []
  for (let pagina = 0; pagina < maxPaginas; pagina++) {
    const desde = pagina * tamano
    const { data, error } = await construir(desde, desde + tamano - 1)
    if (error) throw error
    const filas = data ?? []
    salida.push(...filas)
    if (filas.length < tamano) return salida
  }
  console.warn(`SEO: ${opciones?.etiqueta ?? 'lectura paginada'}: se ha llegado al tope de ${maxPaginas} páginas (${salida.length} filas); puede faltar algo`)
  return salida
}

/** Parte una lista en trozos de `n` (para los `.in()`, que van en la dirección y no admiten listas enormes) */
export function enTrozos<T>(lista: readonly T[], n: number): T[][] {
  const salida: T[][] = []
  for (let i = 0; i < lista.length; i += n) salida.push(lista.slice(i, i + n))
  return salida
}
