/**
 * VENTAS · TODAS LAS FILAS DE UNA CONSULTA, PÁGINAS DE 4 EN 4 EN PARALELO. Supabase (PostgREST) devuelve como mucho 1.000 filas por petición aunque se
 * pida `.limit(5000)`: así se perdían pedidos, BSR, pagos y envíos de reseñas sin avisar. La consulta TIENE que llevar un orden único (`.order(...)` por
 * la clave) para que las páginas no se pisen. Para al ver una página incompleta. Devuelve el error de Supabase como `error` (no lanza), igual que una
 * consulta normal, para poder distinguir «falta la tabla».
 */
export async function todasLasPaginas<T>(pagina: (desde: number) => PromiseLike<{ data: unknown; error: unknown }>, tope = 200): Promise<{ data: T[]; error: unknown }> {
  const filas: T[] = []
  const LOTE = 4
  for (let base = 0; base < tope; base += LOTE) {
    const trozos = await Promise.all(Array.from({ length: LOTE }, (_, i) => pagina((base + i) * 1000)))
    for (const r of trozos) {
      if (r.error) return { data: filas, error: r.error }
      const t = (r.data ?? []) as T[]
      filas.push(...t)
      if (t.length < 1000) return { data: filas, error: null }
    }
  }
  return { data: filas, error: null }
}
