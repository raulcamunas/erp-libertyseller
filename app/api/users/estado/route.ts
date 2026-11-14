import { NextRequest, NextResponse } from 'next/server'
import { DURACION_DEL_BLOQUEO, errorAlDarDeBaja } from '@/lib/usuarios/gestion'
import { contarAdminsPlenos, leerPerfil, requireGestorDeUsuarios } from '@/lib/usuarios/gestion-servidor'

/**
 * DESACTIVAR O REACTIVAR A UN USUARIO SIN BORRARLO. SOLO EL GESTOR DE USUARIOS (lib/usuarios/gestion.ts).
 *
 * Usa el bloqueo de Supabase Auth (`ban_duration`): un usuario desactivado no puede iniciar sesión ni renovar la que tenga, y su perfil, sus horas, citas, leads y correos se
 * quedan como estaban. OJO: la sesión que ya tenga abierta dura hasta que caduque su token (en torno a una hora). Reactivar quita el bloqueo.
 *
 * Nunca deja desactivarse a uno mismo, al dueño ni al último administrador (errorAlDarDeBaja). Reactivar no tiene límites.
 *
 *   POST { userId, activo: boolean }
 */

export async function POST(request: NextRequest) {
  try {
    const sesion = await requireGestorDeUsuarios('Solo el administrador del ERP puede desactivar usuarios')
    if (sesion instanceof NextResponse) return sesion
    const { servicio } = sesion

    const body = await request.json()
    const { userId, activo } = body ?? {}
    if (!userId || typeof userId !== 'string' || typeof activo !== 'boolean') {
      return NextResponse.json({ error: 'Faltan userId y activo (verdadero o falso)' }, { status: 400 })
    }

    const objetivo = await leerPerfil(servicio, userId)
    if (!objetivo) return NextResponse.json({ error: 'Ese usuario no existe' }, { status: 404 })

    if (!activo) {
      const prohibido = errorAlDarDeBaja('desactivar', sesion.userId, objetivo, await contarAdminsPlenos(servicio))
      if (prohibido) return NextResponse.json({ error: prohibido }, { status: 409 })
    }

    const { error } = await servicio.auth.admin.updateUserById(userId, { ban_duration: activo ? 'none' : DURACION_DEL_BLOQUEO })
    if (error) {
      console.error('Usuarios · no se ha podido cambiar el estado', { codigo: error.status ?? null })
      return NextResponse.json({ error: `No se ha podido ${activo ? 'reactivar' : 'desactivar'}: ${error.message}` }, { status: 400 })
    }

    return NextResponse.json({ success: true, activo })
  } catch (error: unknown) {
    console.error('Usuarios · error al cambiar el estado', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Error al cambiar el estado del usuario' }, { status: 500 })
  }
}
