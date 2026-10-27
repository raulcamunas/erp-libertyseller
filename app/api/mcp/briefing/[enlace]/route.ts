import { comprobarEnlaceDelConector } from '@/lib/briefing/servidor'
import { manejadorDelBriefing } from '@/lib/mcp/servidor-briefing'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL CONECTOR QUE SOLO PUBLICA EL BRIEFING (https://app.libertyseller.com/api/mcp/briefing/<enlace>).
 *
 * El enlace secreto ES la llave: se crea en Briefing → «Conexión con Claude», solo se ve una vez y en la base solo queda su huella. Aquí se comprueba ANTES de
 * hablar MCP:
 *   · no es el de ahora (o está anulado, o tiene una forma imposible) → 404, igual que si la ruta no existiera;
 *   · no se ha podido comprobar (la base no contesta) → 503, no 404: Claude daría por muerto un enlace bueno.
 *
 * middleware.ts deja pasar todo lo que empieza por /api/ sin sesión, así que esta ruta se protege SOLA, como /api/mcp. Lo que hace y lo que NO hace el conector está
 * en lib/mcp/briefing.ts: publica un briefing y nada más.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const CABECERAS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }

const sinEnlace = (status: 404 | 503, mensaje: string) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: mensaje } }), { status, headers: CABECERAS })

export async function POST(request: Request, { params }: { params: { enlace: string } }) {
  const estado = await comprobarEnlaceDelConector(createServiceClient(), params.enlace)
  if (estado === 'invalido') return sinEnlace(404, 'Este enlace no existe o se ha anulado.')
  if (estado === 'error') return sinEnlace(503, 'No se ha podido comprobar el enlace ahora mismo. Vuelve a probar en un momento.')
  return manejadorDelBriefing.POST(request)
}

export async function GET() {
  return manejadorDelBriefing.GET()
}

export async function DELETE() {
  return manejadorDelBriefing.DELETE()
}
