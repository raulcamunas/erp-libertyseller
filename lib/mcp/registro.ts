import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'

/**
 * QUIÉN HA CONSULTADO QUÉ.
 * SOLO SERVIDOR.
 *
 * Cada llamada a una herramienta deja una fila en `mcp_llamadas` (migración 228):
 * quién, qué herramienta, sobre qué cliente, si salió bien y cuánto tardó. NO se
 * guardan los argumentos ni lo que se contestó: un texto de búsqueda puede llevar
 * un SKU o un título de un cliente, y el registro lo lee más gente de la necesaria.
 *
 * Es un registro de acceso, no un diario. Sirve para el día en que haya que
 * contestar «¿quién miró esto?» y para el día —más adelante— en que el conector
 * pueda escribir y haya que reconstruir qué se hizo y a nombre de quién.
 *
 * NUNCA LANZA y no espera a nadie: si la tabla no está todavía (migración sin
 * lanzar) o Supabase no contesta, la consulta del usuario sale igual. Un registro
 * que rompe lo que registra es peor que no tenerlo.
 */

let avisadoSinTabla = false

export interface LlamadaRegistrada {
  userId: string
  herramienta: string
  /** El slug del cliente sobre el que se preguntó, si lo hubo */
  cliente: string | null
  esError: boolean
  ms: number
}

export function clienteDeArgs(args: Record<string, unknown>): string | null {
  const c = args.cliente
  return typeof c === 'string' && c.trim() !== '' ? c.trim().toLowerCase().slice(0, 80) : null
}

export async function registrarLlamada(info: LlamadaRegistrada): Promise<void> {
  // Siempre al log del contenedor, aunque falle la tabla: es lo primero que se mira
  console.info(
    `[mcp] ${info.userId} ${info.herramienta}${info.cliente ? ` cliente=${info.cliente}` : ''} ${info.esError ? 'ERROR' : 'ok'} ${info.ms}ms`
  )
  try {
    const { error } = await createServiceClient().from('mcp_llamadas').insert({
      user_id: info.userId,
      herramienta: info.herramienta,
      cliente_slug: info.cliente,
      es_error: info.esError,
      ms: Math.max(0, Math.round(info.ms)),
    })
    if (!error) return
    if (isMissingSchema(error)) {
      if (!avisadoSinTabla) {
        avisadoSinTabla = true
        console.warn('[mcp] falta lanzar la migración 228_mcp_llamadas.sql: las llamadas no se guardan todavía.')
      }
      return
    }
    console.warn('[mcp] no se ha podido guardar la llamada:', error.message)
  } catch (e) {
    console.warn('[mcp] no se ha podido guardar la llamada:', e instanceof Error ? e.message : e)
  }
}
