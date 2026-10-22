import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { SIN_CACHE, requerirCorreo, respuestaDeFallo } from '@/lib/correo/rutas'
import { autorizarBuzon, sincronizarBuzonPorId } from '@/lib/correo/servidor'
import type { RespuestaDeSincronizar } from '@/lib/correo/tipos'
import { leerCuerpoConTope } from '@/lib/subidas-limite'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * TRAER LOS CORREOS NUEVOS DE MI BUZÓN, AHORA.
 *
 * POST { buzonId }  Solo su dueño: abre el buzón con SU contraseña, así que ni un administrador lo lanza por otro.
 *
 * La pantalla la llama cada minuto mientras está abierta y al pulsar «Actualizar», y la repite mientras la respuesta
 * diga que quedan correos por traer (la primera importación no cabe en una petición). Una lectura reciente no vuelve
 * a preguntar al servidor de correo: no hay nada nuevo en 15 segundos y los proveedores limitan las conexiones.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BYTES_CUERPO = 2 * 1024
const PRESUPUESTO_MS = 35_000
const ENTRE_LECTURAS_MS = 15_000

export async function POST(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion

  const cuerpo = await leerCuerpoConTope(request, MAX_BYTES_CUERPO)
  if (cuerpo instanceof NextResponse) return cuerpo
  let json: { buzonId?: unknown }
  try {
    json = JSON.parse(cuerpo.texto) as typeof json
  } catch {
    return fail(400, 'No se ha entendido lo que se ha mandado')
  }

  try {
    const service = createServiceClient()
    const auth = await autorizarBuzon(service, sesion, json.buzonId, 'escribir')
    if (!auth.ok) return fail(auth.estado, auth.mensaje)

    const { buzon } = auth
    if (buzon.historico_completo && buzon.ultimo_intento_at && Date.now() - Date.parse(buzon.ultimo_intento_at) < ENTRE_LECTURAS_MS) {
      const respuesta: RespuestaDeSincronizar = { ok: true, recienLeido: true }
      return NextResponse.json(respuesta, { headers: SIN_CACHE })
    }

    const lectura = await sincronizarBuzonPorId(service, buzon.id, { presupuestoMs: PRESUPUESTO_MS })
    let respuesta: RespuestaDeSincronizar
    switch (lectura.tipo) {
      case 'hecha':
        respuesta = { ok: true, lectura: { importados: lectura.importados, quedan: lectura.quedan, completo: lectura.completo } }
        break
      case 'ocupada':
        respuesta = { ok: true, ocupada: true }
        break
      case 'credenciales_invalidas':
        respuesta = { ok: false, credencialesInvalidas: true, error: 'El servidor de correo ha rechazado la contraseña. Vuelve a escribirla para seguir recibiendo correos.' }
        break
      case 'desconectado':
        respuesta = { ok: false, error: 'Este buzón está desconectado. Vuelve a conectarlo.' }
        break
      case 'no_existe':
        return fail(404, 'No existe ese buzón.')
      default:
        respuesta = { ok: false, error: lectura.mensaje }
    }
    return NextResponse.json(respuesta, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('Correo · sincronizar: fallo', error)
  }
}
