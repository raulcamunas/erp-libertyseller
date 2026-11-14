import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { entrarConEnlace, respuestaDeFalloInterno } from '@/lib/fba/encaje-http'
import { generarEtiquetasDeRemesa, registrarImpresion, respuestaPdf } from '@/lib/fba/etiquetas-remesa'
import { registrarEnHistorial } from '@/lib/fba/historial'
import { ipDe } from '@/lib/fba/limite-publico'

/**
 * LAS ETIQUETAS FNSKU DESDE EL ENLACE DEL CLIENTE.
 *
 * El cliente es quien etiqueta, y hasta ahora no podía sacarlas sin cuenta en el ERP. Con el envío aprobado
 * (la misma regla que en el ERP: nunca en borrador) descarga el PDF desde su portal. La tirada queda en
 * fba_impresiones con origen 'enlace' y en el historial con la IP.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const r = await entrarConEnlace(request, params.token, 'etiquetas')
    if (r instanceof NextResponse) return r
    if (r.remesa.estado === 'borrador') return fail(409, 'Las etiquetas se descargan cuando Liberty Seller ha aprobado la propuesta.')

    const formato = request.nextUrl.searchParams.get('formato') ?? 'a4-21'
    const res = await generarEtiquetasDeRemesa(r.remesa.id, formato)
    if (!res.ok) return fail(res.estado, res.error)

    void registrarImpresion(res, { userId: null, origen: 'enlace', enlaceId: r.enlace.id })
    void registrarEnHistorial({ remesaId: r.remesa.id, actor: 'enlace', enlaceId: r.enlace.id, accion: 'etiquetas', ip: ipDe(request), detalle: { etiquetas: res.impresas, formato } })
    return respuestaPdf(res) as NextResponse
  } catch (error) {
    return respuestaDeFalloInterno(error, 'Portal del cliente: no se han podido generar las etiquetas')
  }
}
