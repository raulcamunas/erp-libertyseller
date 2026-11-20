/**
 * AMAZON ADS · LEER TODAS LAS FILAS DE UNA CONSULTA, DE 1.000 EN 1.000. SOLO SERVIDOR.
 *
 * PostgREST devuelve como mucho `max-rows` filas por consulta (1.000 en Supabase) y un `.limit(5000)` se corta en silencio: con muchas campañas, el presupuesto de
 * 7 días salía mal sumado y la cuarentena incompleta. Esto pide páginas con `.range()` hasta que una llega corta. La consulta tiene que llevar un orden estable (y total: con empates, una fila
 * puede cambiar de página entre dos consultas y salir dos veces o ninguna).
 *
 * `lanzarAlTope`: los que DECIDEN con la suma (pujas, negativas, cosechas) no pueden seguir con una parte de las filas. Con él, si se llega al tope con la última página llena (puede haber más),
 * se devuelve un error «lectura incompleta» en vez de la parte leída como si fuera todo.
 */

type Respuesta<T> = { data: T[] | null; error: { code?: string; message?: string } | null }

export interface OpcionesDePaginar {
  tope?: number
  tamano?: number
  lanzarAlTope?: boolean
}

export const CODIGO_TOPE_DE_FILAS = 'TOPE_DE_FILAS'

export async function todasLasFilas<T>(pagina: (desde: number, hasta: number) => PromiseLike<Respuesta<T>>, topeU: number | OpcionesDePaginar = 50_000, tamanoU = 1000): Promise<Respuesta<T> & { data: T[] }> {
  const o: OpcionesDePaginar = typeof topeU === 'number' ? { tope: topeU, tamano: tamanoU } : topeU
  const tope = o.tope ?? 50_000
  const tamano = o.tamano ?? tamanoU
  const salida: T[] = []
  let ultimaLlena = false
  for (let desde = 0; desde < tope; desde += tamano) {
    const r = await pagina(desde, desde + tamano - 1)
    if (r.error) return { data: salida, error: r.error }
    const filas = r.data ?? []
    salida.push(...filas)
    ultimaLlena = filas.length >= tamano
    if (!ultimaLlena) break
  }
  if (ultimaLlena && o.lanzarAlTope) {
    // Un Error de verdad (con su código) para que quien lo recoja con `e.message` lo lea bien
    const error = Object.assign(new Error(`Lectura incompleta: se ha llegado al tope de ${tope} filas y puede haber más.`), { code: CODIGO_TOPE_DE_FILAS })
    return { data: salida, error }
  }
  return { data: salida, error: null }
}

/** Parte una lista en trozos (p. ej. los ids de un `.in()`, que van en la URL: con cientos de campañas la petición da 414/400) */
export function trozos<T>(lista: readonly T[], tamano = 100): T[][] {
  const salida: T[][] = []
  for (let i = 0; i < lista.length; i += tamano) salida.push(lista.slice(i, i + tamano))
  return salida
}
