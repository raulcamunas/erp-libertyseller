/**
 * LOS MENSAJES DE ERROR DE LAS RUTAS DE REMESAS.
 *
 * API
 *   sinRespuestaDe(que, estado)          el texto cuando la respuesta NO es el JSON de nuestra ruta (502/503/504 = reinicio)
 *   leerRespuesta<T>(res, que)           { ok: true, datos } | { ok: false, estado, error, datos } — nunca lanza
 *
 * Lo que se dice cuando la respuesta NO es el JSON de nuestra ruta: no la ha dado la ruta, sino lo que hay delante
 * —el servidor que se está reiniciando, un proxy—. Con el código se sabe qué fue sin abrir las herramientas del
 * navegador; un «no se ha podido» a secas no distingue un reinicio de un fallo.
 */
export const sinRespuestaDe = (que: string, estado: number) =>
  estado === 502 || estado === 503 || estado === 504
    ? `El servidor no ha contestado (código ${estado}). Suele pasar justo cuando la aplicación se está actualizando: espera un minuto y vuelve a probar.`
    : `${que} (código ${estado}).`

export type Respuesta<T> =
  | { ok: true; estado: number; datos: T }
  | { ok: false; estado: number; error: string; datos: Record<string, unknown> | null }

/**
 * Lee el JSON de una respuesta de nuestras rutas. Si la ruta contestó con `{ error }`, ese texto va tal cual a la
 * pantalla (ya viene redactado); si no hay JSON, el de `sinRespuestaDe`. El resto del cuerpo de un error (p. ej. el
 * `envio` de un 409 por versión) va en `datos`.
 */
export async function leerRespuesta<T>(res: Response, que: string): Promise<Respuesta<T>> {
  const cuerpo = (await res.json().catch(() => null)) as unknown
  if (res.ok && cuerpo !== null) return { ok: true, estado: res.status, datos: cuerpo as T }
  const objeto = cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo) ? (cuerpo as Record<string, unknown>) : null
  const texto = objeto && typeof objeto.error === 'string' && objeto.error.trim() !== '' ? objeto.error : sinRespuestaDe(que, res.status)
  return { ok: false, estado: res.status, error: texto, datos: objeto }
}
