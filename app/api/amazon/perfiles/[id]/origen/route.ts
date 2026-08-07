import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { MAX_FICHERO_BYTES } from '@/lib/stock-sync/proceso'
import { conectorDe } from '@/lib/stock-sync/origenes'
import { loadPerfil } from '@/lib/stock-sync/perfiles'

/**
 * COMPRUEBA EL ORIGEN SIN PROCESAR NADA.
 *
 * Contesta a una sola pregunta: ¿llegamos al fichero? Y cuando no, dice por qué
 * con la frase que resuelve el caso — que en Drive es, nueve de cada diez
 * veces, que la carpeta no está compartida con la cuenta de servicio, y el
 * mensaje incluye el correo con el que hay que compartirla.
 *
 * Va aparte de «Probar» a propósito: son dos fallos distintos con dos arreglos
 * distintos, y mezclarlos obliga a adivinar cuál de los dos ha pasado. Aquí no
 * se descarga nada, solo se lista la carpeta: se puede pulsar tantas veces como
 * haga falta mientras el cliente termina de compartirla.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    if (!UUID.test(params.id)) return fail(400, 'Ese perfil no existe')

    const perfil = await loadPerfil(params.id)
    if (!perfil) return fail(404, 'Ese perfil ya no existe')

    /**
     * La configuración puede venir en el cuerpo para poder comprobar lo que hay
     * EN PANTALLA sin haberlo guardado todavía. Es lo que permite pegar el
     * identificador de la carpeta, pulsar «Comprobar» y corregirlo si está mal,
     * en vez de guardar un perfil roto para poder probarlo.
     */
    const body = (await request.json().catch(() => ({}))) as { config?: unknown }
    const config =
      body.config && typeof body.config === 'object' && !Array.isArray(body.config)
        ? (body.config as Record<string, unknown>)
        : ((perfil.origen_config ?? {}) as Record<string, unknown>)

    const conector = conectorDe(perfil.origen)
    const estado = await conector.comprobar({
      config,
      perfil: perfil.name,
      maxBytes: MAX_FICHERO_BYTES,
      subida: null,
    })

    // Un origen que no se puede leer NO es un error de la petición: la petición
    // ha funcionado y la respuesta es «no se llega, y este es el motivo». Un 400
    // aquí haría que la pantalla lo pintara como un fallo del ERP en vez de como
    // el diagnóstico que es.
    return NextResponse.json({ estado })
  } catch (error) {
    return errorResponse(error, 'Error comprobando el origen de un perfil')
  }
}
