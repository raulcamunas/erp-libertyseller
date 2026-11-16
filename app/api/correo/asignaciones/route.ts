import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { validarPeticionDeAsignacion } from '@/lib/correo/asignaciones'
import { cambiarAsignacion, leerAsignaciones } from '@/lib/correo/asignaciones-servidor'
import { FALTA_MIGRACION_318 } from '@/lib/correo/preferencias-servidor'
import { SIN_CACHE, requerirCorreo, respuestaDeFallo } from '@/lib/correo/rutas'
import { nombreDeLaSesion } from '@/lib/correo/servidor'
import { leerCuerpoConTope } from '@/lib/subidas-limite'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * ASIGNAR BUZONES A PERSONAS — SOLO PARA ADMINISTRADORES (migración 318).
 *
 * Asignar un buzón da a esa persona lectura, avisos y «Mis correos»; con «Puede responder y enviar» (marcado por defecto) además envía desde él, y queda anotado quién
 * envió cada correo. Se asigna a un employee o a un admin (también a uno mismo); nunca a un partner ni al dueño (400). La regla de qué abre una asignación
 * sigue en lib/correo/acceso.ts; la de qué se puede asignar, en lib/correo/asignaciones.ts.
 *
 * GET   { buzones: [{ id, direccion, nombre, dueno, deAdmin, asignaciones: [...] }], personas: [{ id, nombre, role, puesto, esYo, bloqueados }], cambios: [...] }
 *       Las personas son employees y admins con la app de Correo, también quien pide («Yo», la primera). Los cambios, el historial único de «Quién ve qué»
 *       (concedido, quitado, bloqueado, desbloqueado, asignado, desasignado, responde, solo avisos).
 * POST  { buzonId, personaId, accion: 'asignar' | 'quitar' | 'responde' | 'solo_avisos', puedeResponder? } (puedeResponder solo cuenta al asignar; por defecto true).
 *       Al asignar a quien tenía el buzón bloqueado, se le quita el bloqueo (y queda `desbloqueado` en el historial). Lo que DA acceso escribe el historial antes
 *       (si falla, no se cambia nada); lo que lo QUITA se aplica antes. Avisa en la campana a la persona y al dueño. Devuelve lo hecho y la vista ya al día.
 *
 * A quien no es administrador, «no existe» (404), como si la ruta no estuviera. Sin la 318, 503 con FALTA_MIGRACION_318.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const MAX_BYTES_CUERPO = 4 * 1024
const NO_EXISTE = 'No existe esa página.'

export async function GET() {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion
  if (sesion.role !== 'admin') return fail(404, NO_EXISTE)

  try {
    const r = await leerAsignaciones(createServiceClient(), sesion.userId)
    if (!r.disponible) return fail(503, FALTA_MIGRACION_318)
    return NextResponse.json(r.vista, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('Correo · asignaciones: fallo al leer', error)
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
  const valida = validarPeticionDeAsignacion(json)
  if (!valida.ok) return fail(400, valida.error)
  // La casilla «Puede responder y enviar»: solo un false explícito la quita (viene marcada por defecto)
  const casilla = (json as { puedeResponder?: unknown }).puedeResponder
  if (casilla !== undefined && typeof casilla !== 'boolean') return fail(400, 'puedeResponder tiene que ser verdadero o falso.')

  try {
    const service = createServiceClient()
    const nombre = await nombreDeLaSesion(service, sesion.userId)
    const r = await cambiarAsignacion(service, { id: sesion.userId, nombre }, { ...valida.peticion, ...(typeof casilla === 'boolean' ? { puedeResponder: casilla } : {}) })
    if (!r.ok) return fail(r.estado, r.faltaMigracion ? FALTA_MIGRACION_318 : r.error)

    const despues = await leerAsignaciones(service, sesion.userId)
    return NextResponse.json(
      { ok: true, cambiado: r.cambiado, accion: r.accion, puedeResponder: r.puedeResponder, desbloqueado: r.desbloqueado, ...(despues.disponible ? despues.vista : {}) },
      { headers: SIN_CACHE }
    )
  } catch (error) {
    return respuestaDeFallo('Correo · asignaciones: fallo al cambiar', error)
  }
}
