import { manejadorMcp } from '@/lib/mcp/servidor'

/**
 * EL CONECTOR MCP DEL ERP — SOLO PARA EL EQUIPO DE LIBERTY SELLER.
 *
 * Es lo que Claude llama cuando se añade el ERP como conector personalizado
 * (https://app.libertyseller.com/api/mcp). Hoy solo ofrece herramientas de LECTURA.
 *
 * middleware.ts deja pasar todo lo que empieza por /api/ sin sesión, así que esta
 * ruta se protege SOLA: sin un token OAuth de Supabase de un administrador contesta
 * 401 (y con él, el aviso que hace que Claude abra el inicio de sesión). Todo está
 * explicado en lib/mcp/manejador.ts y lib/mcp/auth.ts.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: Request) {
  return manejadorMcp.POST(request)
}

export async function GET() {
  return manejadorMcp.GET()
}

export async function DELETE() {
  return manejadorMcp.DELETE()
}
