/**
 * Memoria corta en el proceso para cálculos caros que muchas personas piden a la vez (los paneles de «Todos los clientes»): el mismo resultado durante
 * `ms`, y si ya se está calculando, se espera a ese cálculo en vez de lanzar otro. Si falla, no se guarda.
 */
const guardados = new Map<string, { at: number; valor: unknown }>()
const enCurso = new Map<string, Promise<unknown>>()

export async function conMemoria<T>(clave: string, ms: number, calcular: () => Promise<T>): Promise<T> {
  const g = guardados.get(clave)
  if (g && Date.now() - g.at < ms) return g.valor as T
  const p = enCurso.get(clave)
  if (p) return p as Promise<T>
  const nueva = calcular()
    .then((v) => {
      guardados.set(clave, { at: Date.now(), valor: v })
      if (guardados.size > 200) for (const [k, x] of guardados) if (Date.now() - x.at > ms) guardados.delete(k)
      return v
    })
    .finally(() => enCurso.delete(clave))
  enCurso.set(clave, nueva)
  return nueva
}
