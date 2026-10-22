import { NextResponse, type NextRequest } from 'next/server'
import { fail, UUID } from '@/lib/amazon/api'
import { NO_EXISTE } from '@/lib/correo/acceso'
import { requerirCorreo, respuestaDeFallo } from '@/lib/correo/rutas'
import { autorizarBuzon, descargarAdjunto, nombreDeLaSesion, registrarAcceso } from '@/lib/correo/servidor'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * DESCARGAR UN ADJUNTO.
 *
 * GET ?mensaje=<id del mensaje>&n=<posición del adjunto>
 *
 * Los ficheros no se guardan en el ERP: se piden al servidor de correo en el momento, con la contraseña del buzón, y
 * solo a quien puede abrir ese buzón (su dueño, o quien lo supervisa dejando constancia en correo_accesos).
 *
 * SIEMPRE SE DESCARGA, NUNCA SE ABRE EN LA PÁGINA: tipo genérico, `attachment` y `nosniff`. Un HTML o un SVG que llegara
 * de fuera, servido con su tipo, se ejecutaría con el origen del ERP.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** Nombre apto para la cabecera: solo ASCII sin comillas en la versión simple, y la completa codificada en filename* */
function cabeceraDeDescarga(nombre: string): string {
  const simple = nombre.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_')
  return `attachment; filename="${simple}"; filename*=UTF-8''${encodeURIComponent(nombre).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`
}

export async function GET(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion

  const mensajeId = request.nextUrl.searchParams.get('mensaje') ?? ''
  const n = Number(request.nextUrl.searchParams.get('n'))
  if (!UUID.test(mensajeId) || !Number.isInteger(n) || n < 0) return fail(404, NO_EXISTE)

  try {
    const service = createServiceClient()
    const { data, error } = await service.from('correo_mensajes').select('buzon_id, hilo_id, adjuntos').eq('id', mensajeId.toLowerCase()).maybeSingle()
    if (error) throw new Error('No se ha podido leer el mensaje.', { cause: error })
    const fila = data as { buzon_id: string; hilo_id: string; adjuntos: Array<{ n: number; nombre: string }> } | null
    if (!fila) return fail(404, NO_EXISTE)

    const auth = await autorizarBuzon(service, sesion, fila.buzon_id, 'leer')
    if (!auth.ok) return fail(auth.estado, auth.mensaje)

    if (auth.porSupervision) {
      const ficha = fila.adjuntos?.find((a) => a.n === n)
      await registrarAcceso(service, { userId: sesion.userId, nombre: await nombreDeLaSesion(service, sesion.userId) }, auth.buzon.id, 'adjunto', { id: fila.hilo_id, asunto: ficha?.nombre ?? 'adjunto' })
    }

    const r = await descargarAdjunto(service, auth.buzon, mensajeId, n)
    if (r.tipo === 'no_existe') return fail(404, 'No se encuentra ese adjunto.')
    if (r.tipo === 'sin_copia') return fail(409, 'Este correo aún no tiene copia en el servidor de correo, así que su adjunto no se puede descargar todavía.')
    if (r.tipo === 'error') return fail(r.estado, r.mensaje)

    return new NextResponse(new Uint8Array(r.contenido), {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': cabeceraDeDescarga(r.nombre),
        'Content-Length': String(r.contenido.length),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (error) {
    return respuestaDeFallo('Correo · adjunto: fallo', error)
  }
}
