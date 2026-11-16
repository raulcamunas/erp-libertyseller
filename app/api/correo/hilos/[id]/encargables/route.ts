import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { NO_EXISTE } from '@/lib/correo/acceso'
import { cargarReglaEnBloque } from '@/lib/correo/lectores-servidor'
import { SIN_CACHE, requerirCorreo, respuestaDeFallo } from '@/lib/correo/rutas'
import { autorizarBuzon, buzonDeHilo } from '@/lib/correo/servidor'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * A QUIÉN SE PUEDE ENCARGAR UNA CONVERSACIÓN («Encárgate tú»).
 *
 * GET  →  [{ id, nombre, puedeResponder }]   ordenadas por nombre
 *
 * Solo lo pide quien puede responder desde el buzón del hilo (el dueño, o quien lo tiene asignado con respuesta) o un administrador.
 *
 *   · A un ADMINISTRADOR: todas las personas que hoy LEEN ese buzón, por la vía que sea.
 *   · A QUIEN NO LO ES: solo el dueño y las personas con el buzón asignado, SIN decir por qué lo leen. Nunca supervisores, concesiones a mano
 *     ni bloqueos: quién supervisa a quién no es cosa suya.
 *
 * En los dos casos, solo quien tiene la app «Correo», no es partner y está activo. La regla se carga EN BLOQUE (cargarReglaEnBloque: unas
 * pocas consultas para todo el equipo) y se evalúa en memoria con decidirAcceso, sin un quienPide por persona.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

interface Encargable {
  id: string
  nombre: string
  /** Además de leer, puede contestar desde el buzón (lo indica el selector) */
  puedeResponder: boolean
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion

  try {
    const service = createServiceClient()
    const info = await buzonDeHilo(service, params.id)
    if (!info) return fail(404, NO_EXISTE)

    const esAdmin = sesion.role === 'admin'
    const auth = await autorizarBuzon(service, sesion, info.buzonId, esAdmin ? 'leer' : 'responder')
    if (!auth.ok) return fail(auth.estado, auth.mensaje)
    const buzon = { id: auth.buzon.id, user_id: auth.buzon.user_id }

    const regla = await cargarReglaEnBloque(service)
    const salida: Encargable[] = []
    for (const id of regla.personas) {
      const p = regla.persona(id)
      if (!p || !p.appCorreo || !p.activo || p.role === 'partner') continue
      const lee = regla.evaluar(id, buzon, 'leer')
      if (!lee.ok) continue
      // A quien no es administrador, solo el dueño y las personas asignadas: nunca la gente que lo lee por supervisar o por un permiso a mano
      if (!esAdmin && !lee.esDueno && !lee.asignado) continue
      salida.push({ id, nombre: p.nombre, puedeResponder: lee.puedeResponder })
    }
    salida.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
    return NextResponse.json(salida, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('Correo · encargables: fallo', error)
  }
}
