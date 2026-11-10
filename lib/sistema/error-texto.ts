/**
 * EL TEXTO DE UN ERROR, VENGA DE DONDE VENGA.
 *
 * `String(error)` con un error de Supabase (un objeto plano `{ message, code, details, hint }`, no un `Error`) daba «[object Object]» y se perdía el motivo real: así se vio en `fba-alertas` y en las
 * caídas de la base del 29 de octubre, donde los procesos fallaban y el registro no decía por qué. Aquí se saca el mensaje de lo que haya: un Error, un error de PostgREST, un texto, o cualquier
 * objeto (que se serializa).
 */
export function textoDeError(error: unknown, maximo = 500): string {
  const recortar = (s: string) => (s.length > maximo ? `${s.slice(0, maximo - 1)}…` : s)
  if (error instanceof Error) return recortar(error.message || error.name)
  if (typeof error === 'string') return recortar(error)
  if (error && typeof error === 'object') {
    const e = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown }
    if (typeof e.message === 'string' && e.message) {
      const extra = [e.code, e.details, e.hint].filter((x): x is string => typeof x === 'string' && x.length > 0)
      return recortar(extra.length > 0 ? `${e.message} (${extra.join(' · ')})` : e.message)
    }
    try {
      const json = JSON.stringify(error)
      if (json) return recortar(json)
    } catch {
      /* referencias circulares: se cae al texto genérico */
    }
  }
  return recortar(String(error))
}
