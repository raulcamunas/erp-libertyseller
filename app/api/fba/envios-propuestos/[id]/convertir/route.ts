import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { convertirEnRemesa, respuestaDeErrorDeEnvio, sesionDeAgencia } from '@/lib/fba/envios-propuestos-servidor'
import { diaEnEspana } from '@/lib/fba/fechas'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * «CONVERTIR EN REMESA» UN ENVÍO PROPUESTO (spec remesas-pro §4.2 y D20).
 *
 * POST → { remesaId, yaExistia, analisisGuardado }
 *
 * Crea la remesa en BORRADOR con lo hablado con el cliente (o lo que pide el plan), con referencia, nombre, talla,
 * EAN, FNSKU y ASIN del catálogo, el mercado de sus remesas (nunca el de la lectura de ventas) y el porqué de cada
 * línea en el análisis. A partir de ahí sigue el flujo de siempre: enlace al cliente → aprobada → etiquetas →
 * encajando → lista → enviada.
 *
 * Sin duplicados: primero reclama el envío propuesto con un update condicional y solo entonces crea la remesa; si
 * crear falla, lo deshace. Dos clics (o dos personas) a la vez dan UNA remesa. Idempotente: si ya tenía remesa,
 * devuelve esa con `yaExistia: true`.
 *
 * Solo la agencia con permiso de editar ese cliente; el rol `cliente` recibe 403 (D26). Sin la 316, 409 con el aviso.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!UUID.test(params.id)) return fail(400, 'Ese envío propuesto no existe')
    const sesion = await sesionDeAgencia('editar')
    if (sesion instanceof NextResponse) return sesion

    // La versión y la huella de las líneas que se ven (A2.1); sin ellas (pantallas viejas) se convierte como siempre
    const cuerpo = (await request.json().catch(() => null)) as { version?: unknown; huella?: unknown } | null
    const vista = cuerpo ? { version: typeof cuerpo.version === 'number' ? cuerpo.version : null, huella: typeof cuerpo.huella === 'string' ? cuerpo.huella : null } : undefined
    const r = await convertirEnRemesa(createServiceClient(), sesion, params.id, diaEnEspana(), vista)
    return NextResponse.json(r)
  } catch (error) {
    return respuestaDeErrorDeEnvio(error) ?? errorResponse(error, 'No se ha podido convertir el envío en remesa')
  }
}
