/**
 * Llamadas a /api/ads/cuenta/* desde el navegador. Devuelve el JSON o lanza un Error con el mensaje que mandó el servidor (ya escrito en español), que es lo que sale en el aviso.
 */
export async function llamar<T>(url: string, init?: { metodo?: 'GET' | 'POST' | 'PUT' | 'DELETE'; cuerpo?: unknown }): Promise<T> {
  const res = await fetch(url, {
    method: init?.metodo ?? 'GET',
    headers: init?.cuerpo === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init?.cuerpo === undefined ? undefined : JSON.stringify(init.cuerpo),
    cache: 'no-store',
  })
  const datos = (await res.json().catch(() => null)) as (T & { error?: string }) | null
  if (!res.ok) throw new Error(datos?.error ?? `Error ${res.status}`)
  return datos as T
}

/** «1.234,50» — para enseñar importes */
export const fmt = (n: number | null | undefined, decimales = 2) => (n == null || Number.isNaN(n) ? '—' : n.toLocaleString('es-ES', { minimumFractionDigits: decimales, maximumFractionDigits: decimales }))
