/**
 * LAS PETICIONES DE LA PANTALLA DE CORREO A /api/correo.
 *
 * Todas devuelven un resultado (nunca lanzan): lo que falla trae una frase ya escrita para enseñarla. Las rutas
 * contestan siempre con frases fijas, así que se puede pintar tal cual el `error` de la respuesta.
 */

export type Resultado<T> = { ok: true; datos: T } | { ok: false; estado: number; mensaje: string; extra: Record<string, unknown> }

const SIN_CONEXION = 'No se ha podido conectar con el ERP. Comprueba tu conexión y vuelve a probar.'
const FALLO_GENERICO = 'No se ha podido completar la operación. Vuelve a probar.'

export async function pedir<T>(url: string, init: RequestInit = {}): Promise<Resultado<T>> {
  try {
    const r = await fetch(url, { cache: 'no-store', ...init })
    const json = (await r.json().catch(() => null)) as Record<string, unknown> | null
    if (!r.ok) {
      return { ok: false, estado: r.status, mensaje: typeof json?.error === 'string' ? json.error : FALLO_GENERICO, extra: json ?? {} }
    }
    return { ok: true, datos: (json ?? {}) as T }
  } catch {
    return { ok: false, estado: 0, mensaje: SIN_CONEXION, extra: {} }
  }
}

export function enviarJson<T>(url: string, metodo: 'POST' | 'PATCH' | 'DELETE', cuerpo?: unknown): Promise<Resultado<T>> {
  return pedir<T>(url, {
    method: metodo,
    headers: cuerpo === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  })
}
