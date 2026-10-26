/**
 * LANZAR TAREAS DE A POCAS A LA VEZ — PURO.
 * Hace `fn` con cada elemento, `limite` a la vez, y devuelve los resultados en el mismo orden. Diez llamadas a la IA de golpe saturarían la API (un 429 de regalo): de cuatro
 * en cuatro la espera es casi la misma. `fn` no debe lanzar: un fallo dentro de un elemento lo tiene que contar `fn` en su resultado, no tumbar a los demás.
 */
export async function conLimite<T, R>(elementos: readonly T[], limite: number, fn: (e: T, i: number) => Promise<R>): Promise<R[]> {
  const salida = new Array<R>(elementos.length)
  let siguiente = 0
  const obreros = Array.from({ length: Math.min(limite, elementos.length) }, async () => {
    while (siguiente < elementos.length) {
      const i = siguiente++
      salida[i] = await fn(elementos[i], i)
    }
  })
  await Promise.all(obreros)
  return salida
}
