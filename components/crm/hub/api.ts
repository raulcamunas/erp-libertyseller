/**
 * LAS TRES LLAMADAS DEL HUB A LAS RUTAS DE LAS NOTAS DE GEMINI (todas de dirección): sincronizar, analizar y asignar. Devuelven siempre `{ ok, error }` y no lanzan: la pantalla
 * enseña el motivo tal cual lo dice el servidor.
 */

export interface RespuestaDeRuta {
  ok: boolean
  error: string | null
  datos: Record<string, unknown>
}

async function llamar(url: string, cuerpo?: unknown): Promise<RespuestaDeRuta> {
  try {
    const res = await fetch(url, { method: 'POST', headers: cuerpo !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined })
    let datos: Record<string, unknown> = {}
    try {
      datos = ((await res.json()) ?? {}) as Record<string, unknown>
    } catch {
      /* sin cuerpo legible */
    }
    const ok = res.ok && datos.ok !== false
    const error = ok ? null : typeof datos.error === 'string' ? datos.error : typeof datos.detenida === 'string' ? datos.detenida : typeof datos.aviso === 'string' ? datos.aviso : 'No se ha podido completar. Prueba otra vez en un momento.'
    return { ok, error, datos }
  } catch {
    return { ok: false, error: 'No hay conexión con el servidor.', datos: {} }
  }
}

export const sincronizarNotas = () => llamar('/api/crm/notas-gemini/sincronizar')
export const analizarNota = (id: string) => llamar(`/api/crm/notas-gemini/${id}/analizar`)
export const asignarNota = (id: string, clientId: string | null) => llamar(`/api/crm/notas-gemini/${id}/asignar`, { clientId })
