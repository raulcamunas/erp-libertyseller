import { NextRequest, NextResponse } from 'next/server'
import { errorAlDarDeBaja } from '@/lib/usuarios/gestion'
import { contarAdminsPlenos, leerPerfil, requireGestorDeUsuarios } from '@/lib/usuarios/gestion-servidor'

/**
 * BORRAR UN USUARIO DEL ERP PARA SIEMPRE. SOLO EL GESTOR DE USUARIOS (el mismo criterio que la pantalla: lib/usuarios/gestion.ts).
 *
 * Al principio no comprobaba nada (middleware.ts declara pública toda /api/: un `curl` sin cookie borraba cuentas); luego bastaba ser administrador, CEO incluido. Desde el
 * 14 nov 2026 exige lo mismo que la pantalla, y nunca deja borrarse a uno mismo, borrar al dueño ni al último administrador (errorAlDarDeBaja).
 *
 * En la pantalla lo normal es DESACTIVAR (/api/users/estado), que conserva el historial: borrar se lleva por delante, en cascada, lo que cuelga del perfil.
 */

export async function POST(request: NextRequest) {
  try {
    const sesion = await requireGestorDeUsuarios('Solo el administrador del ERP puede borrar usuarios')
    if (sesion instanceof NextResponse) return sesion
    const { servicio } = sesion

    const body = await request.json()
    const { userId } = body
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'User ID es requerido' }, { status: 400 })
    }

    const objetivo = await leerPerfil(servicio, userId)
    if (objetivo) {
      const prohibido = errorAlDarDeBaja('borrar', sesion.userId, objetivo, await contarAdminsPlenos(servicio))
      if (prohibido) return NextResponse.json({ error: prohibido }, { status: 409 })
    } else if (userId === sesion.userId) {
      return NextResponse.json({ error: 'No puedes borrarte a ti mismo.' }, { status: 409 })
    }

    const { error: deleteError } = await servicio.auth.admin.deleteUser(userId)
    if (deleteError) {
      console.error('Usuarios · no se ha podido borrar', { codigo: deleteError.status ?? null })
      return NextResponse.json(
        { error: `No se ha podido borrar (${deleteError.message}). Si tiene historial que lo impide, desactívalo en su lugar.` },
        { status: 400 }
      )
    }

    return NextResponse.json({ success: true, message: 'Usuario eliminado correctamente' })
  } catch (error: unknown) {
    console.error('Usuarios · error al borrar', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error al eliminar usuario' }, { status: 500 })
  }
}
