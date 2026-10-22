import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { NO_EXISTE } from '@/lib/correo/acceso'
import { SIN_CACHE, requerirCorreo, respuestaDeFallo } from '@/lib/correo/rutas'
import {
  abrirHilo,
  autorizarBuzon,
  buzonDeHilo,
  destacarHilo,
  marcarEnElServidor,
  marcarHiloLeido,
  marcarHiloNoLeido,
  nombreDeLaSesion,
  registrarAcceso,
} from '@/lib/correo/servidor'
import { leerCuerpoConTope } from '@/lib/subidas-limite'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * UN HILO: ABRIRLO Y MARCARLO.
 *
 * GET    · el hilo con sus mensajes (los más recientes si son muchos). Mirar un hilo NO lo marca como leído: eso lo pide
 *          la pantalla con el PATCH de abajo, y solo si es el buzón de quien mira.
 * PATCH  · { destacado?: boolean, leido?: boolean }  Solo el dueño del buzón. Marcar como leído también lo marca en el
 *          servidor de correo, para que el webmail del proveedor y el móvil vean lo mismo (mejor esfuerzo).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const MAX_BYTES_CUERPO = 1024

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion

  try {
    const service = createServiceClient()
    const info = await buzonDeHilo(service, params.id)
    if (!info) return fail(404, NO_EXISTE)

    const auth = await autorizarBuzon(service, sesion, info.buzonId, 'leer')
    if (!auth.ok) return fail(auth.estado, auth.mensaje)

    if (auth.porSupervision) {
      await registrarAcceso(service, { userId: sesion.userId, nombre: await nombreDeLaSesion(service, sesion.userId) }, auth.buzon.id, 'hilo', { id: params.id.toLowerCase(), asunto: info.asunto })
    }

    const hilo = await abrirHilo(service, auth.buzon.id, params.id.toLowerCase())
    if (!hilo) return fail(404, NO_EXISTE)
    return NextResponse.json({ hilo, esMio: auth.esDueno }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('Correo · abrir hilo: fallo', error)
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion

  const cuerpo = await leerCuerpoConTope(request, MAX_BYTES_CUERPO)
  if (cuerpo instanceof NextResponse) return cuerpo
  let json: { destacado?: unknown; leido?: unknown }
  try {
    json = JSON.parse(cuerpo.texto) as typeof json
  } catch {
    return fail(400, 'No se ha entendido lo que se ha mandado')
  }
  if (json.destacado !== undefined && typeof json.destacado !== 'boolean') return fail(400, 'No se ha entendido lo que se ha mandado')
  if (json.leido !== undefined && typeof json.leido !== 'boolean') return fail(400, 'No se ha entendido lo que se ha mandado')

  try {
    const service = createServiceClient()
    const info = await buzonDeHilo(service, params.id)
    if (!info) return fail(404, NO_EXISTE)

    const auth = await autorizarBuzon(service, sesion, info.buzonId, 'escribir')
    if (!auth.ok) return fail(auth.estado, auth.mensaje)
    const hiloId = params.id.toLowerCase()

    if (typeof json.destacado === 'boolean') await destacarHilo(service, hiloId, json.destacado)

    if (typeof json.leido === 'boolean') {
      const afectados = json.leido ? await marcarHiloLeido(service, hiloId) : await marcarHiloNoLeido(service, hiloId)
      // En el servidor de correo, sin esperar: la respuesta no depende de que el proveedor conteste
      void marcarEnElServidor(service, auth.buzon, afectados, json.leido).catch(() => undefined)
    }

    return NextResponse.json({ ok: true }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('Correo · marcar hilo: fallo', error)
  }
}
