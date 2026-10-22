import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail, requireAppAccess } from '@/lib/amazon/api'
import { ErrorRinkel, MENSAJE_DE_ERROR, pedirUrlDeGrabacion } from '@/lib/rendimiento/rinkel'
import { esFaltaDeMigracion, FALTA_MIGRACION_RENDIMIENTO, leerClaveDe } from '@/lib/rendimiento/servidor'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * ESCUCHAR LA GRABACIÓN DE UNA LLAMADA.
 *
 * El `id` es el de NUESTRA fila de llamada (rinkel_llamadas.id), no el de Rinkel: el navegador nunca ve el
 * identificador de la grabación ni la clave. Aquí se pide a Rinkel, con la clave de su dueño, una dirección
 * temporal (3 horas) y se le da al navegador, que descarga el audio directamente de Rinkel.
 *
 * GET              · redirige (302) a esa dirección: sirve para un enlace «abrir»
 * GET ?formato=json · { url }: lo usa el reproductor de la pantalla, que así puede enseñar el motivo si falla
 *
 * QUIÉN PUEDE: la fila se lee con la SESIÓN DE QUIEN PIDE, así que la política de la tabla decide: cada uno
 * escucha las suyas y quien supervisa al equipo escucha las de todos. Lo que no se puede ver se contesta como
 * «no existe» (404), no como «no tienes permiso»: no se confirma que esa llamada exista.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const SIN_CACHE = { 'Cache-Control': 'private, no-store' }

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const sesion = await requireAppAccess('rendimiento')
  if (sesion instanceof NextResponse) return sesion

  if (!UUID.test(params.id)) return fail(404, 'Esa llamada no existe')

  const { data, error } = await sesion.supabase
    .from('rinkel_llamadas')
    .select('user_id, grabacion_id, grabacion_hasta')
    .eq('id', params.id)
    .maybeSingle()
  if (error) {
    console.error('Rendimiento · grabación: no se ha podido leer la llamada', { codigo: error.code ?? null })
    return esFaltaDeMigracion(error) ? fail(503, FALTA_MIGRACION_RENDIMIENTO) : fail(500, 'No se ha podido leer la llamada. Vuelve a intentarlo en un momento.')
  }
  const llamada = data as { user_id: string; grabacion_id: string | null; grabacion_hasta: string | null } | null
  if (!llamada) return fail(404, 'Esa llamada no existe')
  if (!llamada.grabacion_id) return fail(404, 'Esta llamada no tiene grabación')
  if (llamada.grabacion_hasta && Date.parse(llamada.grabacion_hasta) < Date.now()) {
    return fail(410, 'La grabación ya ha caducado: Rinkel las guarda 90 días.')
  }

  try {
    const clave = await leerClaveDe(createServiceClient(), llamada.user_id)
    if (!('clave' in clave)) {
      return fail(409, 'La cuenta de Rinkel de esta persona ya no está vinculada, así que no se puede pedir la grabación.')
    }

    const url = await pedirUrlDeGrabacion(clave.clave, llamada.grabacion_id)
    if (request.nextUrl.searchParams.get('formato') === 'json') {
      return NextResponse.json({ url }, { headers: SIN_CACHE })
    }
    return NextResponse.redirect(url, { status: 302, headers: SIN_CACHE })
  } catch (e) {
    if (e instanceof ErrorRinkel) {
      // La grabación ya no está en Rinkel (se borra a los 90 días, o la quitaron ellos)
      if (e.codigo === 'no_encontrada') return fail(410, 'Rinkel ya no tiene esta grabación.')
      if (e.codigo === 'clave_invalida' || e.codigo === 'sin_permiso') {
        return fail(409, 'La clave de Rinkel de esta persona ya no vale. Hay que volver a vincularla.')
      }
      return fail(e.codigo === 'limite' ? 429 : 502, MENSAJE_DE_ERROR[e.codigo])
    }
    console.error('Rendimiento · grabación: fallo', { mensaje: e instanceof Error ? e.message : 'sin mensaje' })
    return fail(500, 'No se ha podido pedir la grabación. Vuelve a intentarlo en un momento.')
  }
}
