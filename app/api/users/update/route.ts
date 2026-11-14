import { NextRequest, NextResponse } from 'next/server'
import { cambioDePuestoDeLaPeticion } from '@/lib/usuarios/puestos'
import { guardarPuesto } from '@/lib/usuarios/puestos-servidor'
import { CASILLAS_GESTIONADAS } from '@/lib/usuarios/casillas'
import { casillasMarcadasDeLaPeticion, errorAlEditar, planDeCasillas } from '@/lib/usuarios/gestion'
import { contarAdminsPlenos, leerPerfil, requireGestorDeUsuarios } from '@/lib/usuarios/gestion-servidor'

/** Los cuatro roles del ERP. Cualquier otra cosa en `role` se rechaza */
const ROLES_VALIDOS = new Set(['admin', 'employee', 'partner', 'cliente'])

/**
 * EDITAR UN USUARIO DEL ERP. SOLO EL GESTOR DE USUARIOS (el mismo criterio que la pantalla: lib/usuarios/gestion.ts).
 *
 * HISTORIA DE LA PUERTA
 * ---------------------
 * 1) Al principio no comprobaba NADA y middleware.ts declara pública toda /api/: un `curl` sin cookie ascendía a quien fuera o le cambiaba la contraseña, con
 *    SUPABASE_SERVICE_ROLE_KEY contra la API de administración de Supabase de PRODUCCIÓN.
 * 2) Luego requireAdmin(): cualquier administrador, CEO incluido, aunque la pantalla fuera solo del dueño. Un CEO podía cambiarle el correo o la contraseña al dueño.
 * 3) Desde el 14 nov 2026, requireGestorDeUsuarios(): administrador pleno (no CEO) con el correo del dueño, leído de la base con la sesión de quien llama.
 *
 * LO QUE NUNCA SE DEJA HACER (errorAlEditar): quitarse a uno mismo el administrador, cambiarle el correo al dueño o quitarle el administrador, ni dejar al ERP sin
 * administrador pleno.
 *
 * LAS CASILLAS: solo se tocan las que la pantalla gestiona (CASILLAS_GESTIONADAS). Antes se borraban TODAS las filas de la persona y se reinsertaban solo las conocidas: un
 * permiso sin casilla ('briefing', los antiguos 'leads', 'reports'…) se perdía en silencio. Ahora primero se ponen las marcadas (upsert) y, solo si eso ha ido bien, se quitan
 * las desmarcadas; si algo falla, la respuesta lo dice (antes decía «actualizado correctamente» y el error iba solo a la consola del servidor).
 */

export async function POST(request: NextRequest) {
  try {
    const sesion = await requireGestorDeUsuarios('Solo el administrador del ERP puede editar usuarios')
    if (sesion instanceof NextResponse) return sesion
    const { servicio } = sesion

    const body = await request.json()
    const { userId, email, full_name, password, role, permissions } = body

    if (role !== undefined && role !== null && !ROLES_VALIDOS.has(role)) {
      return NextResponse.json({ error: 'Ese rol no existe' }, { status: 400 })
    }
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'ID de usuario es requerido' }, { status: 400 })
    }
    if (password !== undefined && password !== null && password !== '' && (typeof password !== 'string' || password.length < 6)) {
      // Antes una contraseña corta se ignoraba sin avisar
      return NextResponse.json({ error: 'La contraseña nueva tiene que tener al menos 6 caracteres' }, { status: 400 })
    }

    const objetivo = await leerPerfil(servicio, userId)
    if (!objetivo) return NextResponse.json({ error: 'Ese usuario no existe' }, { status: 404 })

    // El puesto y si la persona llama. Se valida ANTES de tocar nada, con el rol que tendrá al terminar (el de la petición, o el que ya tenía)
    const rolFinal: string = role || objetivo.role || 'employee'
    let puesto: ReturnType<typeof cambioDePuestoDeLaPeticion> | null = null
    if (body.puesto !== undefined || body.is_comercial !== undefined || role) {
      puesto = cambioDePuestoDeLaPeticion({ puesto: body.puesto, is_comercial: body.is_comercial }, rolFinal)
      if (!puesto.ok) return NextResponse.json({ error: puesto.error }, { status: 400 })
    }
    const puestoFinal = puesto && puesto.ok && puesto.puesto !== undefined ? puesto.puesto : (objetivo.puesto ?? null)

    // Lo que nunca se deja hacer
    const adminsPlenos = await contarAdminsPlenos(servicio)
    const prohibido = errorAlEditar({
      actorId: sesion.userId,
      objetivo,
      rolFinal,
      puestoFinal,
      correoNuevo: typeof email === 'string' ? email : undefined,
      adminsPlenos,
    })
    if (prohibido) return NextResponse.json({ error: prohibido }, { status: 409 })

    // El correo en el sistema de acceso, solo si cambia
    const correoCambia = typeof email === 'string' && email.trim() !== '' && email.trim().toLowerCase() !== (objetivo.email ?? '').toLowerCase()
    if (correoCambia) {
      const { error: emailError } = await servicio.auth.admin.updateUserById(userId, { email: email.trim() })
      if (emailError) {
        console.error('Usuarios · no se ha podido cambiar el correo', { codigo: emailError.status ?? null })
        return NextResponse.json({ error: `Error al actualizar el correo: ${emailError.message}` }, { status: 400 })
      }
    }

    if (typeof password === 'string' && password.length >= 6) {
      const { error: passwordError } = await servicio.auth.admin.updateUserById(userId, { password })
      if (passwordError) {
        console.error('Usuarios · no se ha podido cambiar la contraseña', { codigo: passwordError.status ?? null })
        return NextResponse.json({ error: `Error al actualizar la contraseña: ${passwordError.message}` }, { status: 400 })
      }
    }

    const updateData: { full_name?: string; email?: string; role?: string } = {}
    if (typeof full_name === 'string') updateData.full_name = full_name
    if (correoCambia) updateData.email = email.trim()
    if (role) updateData.role = role
    if (Object.keys(updateData).length > 0) {
      const { error: profileError } = await servicio.from('profiles').update(updateData).eq('id', userId)
      if (profileError) {
        console.error('Usuarios · no se ha podido actualizar el perfil', { codigo: profileError.code ?? null })
        return NextResponse.json({ error: `Error al actualizar perfil: ${profileError.message}` }, { status: 500 })
      }
    }

    // El puesto y si llama: no hace fallar la edición, se avisa
    const avisos: string[] = []
    if (puesto && puesto.ok) avisos.push(...(await guardarPuesto(servicio, userId, puesto)).avisos)

    // Las casillas: solo las que gestiona la pantalla. Primero se ponen, después se quitan
    if (Array.isArray(permissions)) {
      const { poner, quitar } = planDeCasillas(casillasMarcadasDeLaPeticion(permissions), CASILLAS_GESTIONADAS)
      let fallo = false
      if (poner.length > 0) {
        const { error } = await servicio
          .from('user_app_permissions')
          .upsert(poner.map((app_id) => ({ user_id: userId, app_id, can_access: true })), { onConflict: 'user_id,app_id' })
        if (error) {
          fallo = true
          console.error('Usuarios · no se han podido poner los accesos', { codigo: error.code ?? null })
        }
      }
      if (!fallo && quitar.length > 0) {
        const { error } = await servicio.from('user_app_permissions').delete().eq('user_id', userId).in('app_id', quitar)
        if (error) {
          fallo = true
          console.error('Usuarios · no se han podido quitar los accesos', { codigo: error.code ?? null })
        }
      }
      if (fallo) avisos.push('Los datos se han guardado, pero los accesos no: vuelve a guardarlos.')
    }

    return NextResponse.json({ success: true, message: 'Usuario actualizado correctamente', avisos })
  } catch (error: unknown) {
    console.error('Usuarios · error al editar', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error al actualizar usuario' }, { status: 500 })
  }
}
