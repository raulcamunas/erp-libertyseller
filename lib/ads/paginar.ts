/**
 * AMAZON ADS · LEER TODAS LAS FILAS DE UNA CONSULTA, DE 1.000 EN 1.000. SOLO SERVIDOR.
 *
 * PostgREST devuelve como mucho `max-rows` filas por consulta (1.000 en Supabase) y un `.limit(5000)` se corta en silencio: con muchas campañas, el presupuesto de
 * 7 días salía mal sumado y la cuarentena incompleta. Esto pide páginas con `.range()` hasta que una llega corta. La consulta tiene que llevar un orden estable.
 */

type Respuesta<T> = { data: T[] | null; error: { code?: string; message?: string } | null }

export async function todasLasFilas<T>(pagina: (desde: number, hasta: number) => PromiseLike<Respuesta<T>>, tope = 50_000, tamano = 1000): Promise<Respuesta<T> & { data: T[] }> {
  const salida: T[] = []
  for (let desde = 0; desde < tope; desde += tamano) {
    const r = await pagina(desde, desde + tamano - 1)
    if (r.error) return { data: salida, error: r.error }
    const filas = r.data ?? []
    salida.push(...filas)
    if (filas.length < tamano) break
  }
  return { data: salida, error: null }
}
