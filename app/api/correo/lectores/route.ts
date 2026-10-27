import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { validarPeticion } from '@/lib/correo/lectores'
import { FALTA_MIGRACION_LECTORES, FaltaMigracionDeLectores, cambiarLectores, leerDatosDeLaMatriz } from '@/lib/correo/lectores-servidor'
import { SIN_CACHE, requerirCorreo, respuestaDeFallo } from '@/lib/correo/rutas'
import { nombreDeLaSesion } from '@/lib/correo/servidor'
import { leerCuerpoConTope } from '@/lib/subidas-limite'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * QUIÉN VE QUÉ BUZÓN — SOLO PARA ADMINISTRADORES («managers»).
 *
 * GET   la matriz de personas por buzón: qué lee cada persona y por qué (suyo, un permiso de supervisión, abierto a mano o nada) y los últimos cambios.
 * POST  { lectorId, cambios: [{ buzonId, leer }] } abre (leer: true) o cierra (leer: false) buzones a UNA persona. Solo lectura: abrir un buzón no deja escribir desde él.
 *       Devuelve lo que se ha hecho y la matriz ya al día.
 *
 * NO ES UN AJUSTE DE PANTALLA: es quien decide qué correos ven los empleados. Se comprueba aquí que quien llama es administrador (a cualquier otro, «no existe»,
 * igual que si la ruta no estuviera) y la regla de qué abre cada permiso sigue estando en lib/correo/acceso.ts. Cada apertura deja su rastro (correo_buzon_lectores_historial) y,
 * si el rastro no se puede escribir, no se abre nada.
 *
 * NECESITA LA MIGRACIÓN 255. Sin ella contesta 503 con el nombre del fichero; el resto de Correo no se entera.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const MAX_BYTES_CUERPO = 16 * 1024
const NO_EXISTE = 'No existe esa página.'

export async function GET() {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion
  if (sesion.role !== 'admin') return fail(404, NO_EXISTE)

  try {
    return NextResponse.json(await leerDatosDeLaMatriz(createServiceClient()), { headers: SIN_CACHE })
  } catch (error) {
    if (error instanceof FaltaMigracionDeLectores) return fail(503, FALTA_MIGRACION_LECTORES)
    return respuestaDeFallo('Correo · lectores: fallo al leer', error)
  }
}

export async function POST(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion
  if (sesion.role !== 'admin') return fail(404, NO_EXISTE)

  const cuerpo = await leerCuerpoConTope(request, MAX_BYTES_CUERPO)
  if (cuerpo instanceof NextResponse) return cuerpo
  let json: unknown
  try {
    json = JSON.parse(cuerpo.texto)
  } catch {
    return fail(400, 'No se ha entendido lo que se ha mandado')
  }
  const valida = validarPeticion(json)
  if (!valida.ok) return fail(400, valida.error)

  try {
    const service = createServiceClient()
    const nombre = await nombreDeLaSesion(service, sesion.userId)
    const r = await cambiarLectores(service, { id: sesion.userId, nombre }, valida.peticion)
    if (!r.ok) return fail(r.estado, r.error)
    const datos = await leerDatosDeLaMatriz(service)
    return NextResponse.json({ concedidos: r.concedidos, quitados: r.quitados, rechazados: r.rechazados, ...datos }, { headers: SIN_CACHE })
  } catch (error) {
    if (error instanceof FaltaMigracionDeLectores) return fail(503, FALTA_MIGRACION_LECTORES)
    return respuestaDeFallo('Correo · lectores: fallo al cambiar', error)
  }
}
