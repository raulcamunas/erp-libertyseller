import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { SIN_CACHE, requerirCorreo, respuestaDeFallo } from '@/lib/correo/rutas'
import { autorizarBuzon, sincronizarBuzonPorId } from '@/lib/correo/servidor'
import { fraseDeBuzonDesconectado, fraseDeContrasenaRechazada, leidoHaceNada } from '@/lib/correo/sincronizar-regla'
import type { RespuestaDeSincronizar } from '@/lib/correo/tipos'
import { leerCuerpoConTope } from '@/lib/subidas-limite'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * TRAER LOS CORREOS NUEVOS DE ESTE BUZÓN, AHORA.
 *
 * POST { buzonId }  Lo puede pedir quien LEE el buzón: su dueño y también quien lo supervisa (un administrador, un permiso de supervisión o un buzón abierto a mano), si no se
 *                   lo han bloqueado. Es lo que hace el proceso automático cada minuto, solo que a petición: solo LEE del servidor de correo (no envía, no borra, no marca
 *                   nada allí) y la contraseña se usa aquí, en el servidor. Antes solo lo podía pedir el dueño, y quien supervisaba tenía que esperar al proceso automático
 *                   (hasta tres minutos) sin poder pedir más; ahora ve «Actualizado hace…» y puede pulsar actualizar, con el mismo tope que el dueño.
 *
 * La pantalla la llama cada 30 s mientras se mira, cada minuto si está oculta, y al pulsar «Actualizar». Si es el DUEÑO, la repite mientras la respuesta diga que quedan correos
 * por traer (la primera importación no cabe en una petición); quien supervisa hace una sola pasada y deja el resto al dueño y al proceso automático. Una lectura reciente no vuelve
 * a preguntar al servidor de correo: no hay nada nuevo en 15 segundos y los proveedores limitan las conexiones (lib/correo/sincronizar-regla.ts). Que el servidor de correo rechace la
 * contraseña, o que el buzón esté desconectado, solo lo puede arreglar el dueño: a quien supervisa se le dice eso y no que la escriba.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_BYTES_CUERPO = 2 * 1024
const PRESUPUESTO_MS = 35_000

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
    // «leer» y no «escribir»: quien puede leer el buzón puede pedir que se ponga al día. Un buzón que no puede leer (o que le han bloqueado) «no existe»
    const auth = await autorizarBuzon(service, sesion, json.buzonId, 'leer')
    if (!auth.ok) return fail(auth.estado, auth.mensaje)

    const { buzon, esDueno } = auth
    if (leidoHaceNada(buzon, Date.now())) {
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
        respuesta = { ok: false, credencialesInvalidas: true, error: fraseDeContrasenaRechazada(esDueno) }
        break
      case 'desconectado':
        respuesta = { ok: false, error: fraseDeBuzonDesconectado(esDueno) }
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
