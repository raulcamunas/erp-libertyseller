import { manejadorMcp } from '@/lib/mcp/servidor'

/**
 * Los «metadatos del recurso protegido» del conector (RFC 9728): el documento al que
 * apunta el aviso del 401 y que le dice a Claude que el inicio de sesión lo hace
 * Supabase. Es público a propósito —Claude lo pide sin token— y no lleva nada
 * secreto: la dirección del conector y la del servidor de autorización.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return manejadorMcp.metadatos()
}
