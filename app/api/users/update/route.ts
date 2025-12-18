import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { userId, email, full_name, password, role, permissions } = body

    // Validar campos requeridos
    if (!userId) {
      return NextResponse.json(
        { error: 'ID de usuario es requerido' },
        { status: 400 }
      )
    }

    // Obtener service_role key desde variables de entorno
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Error de configuración: faltan variables de entorno' },
        { status: 500 }
      )
    }

    // Crear cliente con service_role (bypass RLS)
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // Actualizar email en auth.users si se proporciona
    if (email) {
      const { error: emailError } = await supabaseAdmin.auth.admin.updateUserById(
        userId,
        { email }
      )

      if (emailError) {
        console.error('Error updating email:', emailError)
        return NextResponse.json(
          { error: `Error al actualizar email: ${emailError.message}` },
          { status: 400 }
        )
      }
    }

    // Actualizar contraseña si se proporciona
    if (password && password.length >= 6) {
      const { error: passwordError } = await supabaseAdmin.auth.admin.updateUserById(
        userId,
        { password }
      )

      if (passwordError) {
        console.error('Error updating password:', passwordError)
        return NextResponse.json(
          { error: `Error al actualizar contraseña: ${passwordError.message}` },
          { status: 400 }
        )
      }
    }

    // Actualizar perfil en profiles
    const updateData: { full_name?: string; email?: string; role?: string } = {}
    if (full_name !== undefined) updateData.full_name = full_name
    if (email) updateData.email = email
    if (role) updateData.role = role

    if (Object.keys(updateData).length > 0) {
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .update(updateData)
        .eq('id', userId)

      if (profileError) {
        console.error('Error updating profile:', profileError)
        return NextResponse.json(
          { error: `Error al actualizar perfil: ${profileError.message}` },
          { status: 500 }
        )
      }
    }

    // Actualizar permisos si se proporcionaron
    if (permissions && Array.isArray(permissions)) {
      // Primero, eliminar todos los permisos existentes del usuario
      const { error: deleteError } = await supabaseAdmin
        .from('user_app_permissions')
        .delete()
        .eq('user_id', userId)

      if (deleteError) {
        console.error('Error deleting existing permissions:', deleteError)
        // No fallamos aquí, continuamos
      }

      // Luego, crear los nuevos permisos
      const permissionsToCreate = permissions
        .filter((p: any) => p.can_access)
        .map((p: any) => ({
          user_id: userId,
          app_id: p.app_id,
          can_access: true,
        }))

      if (permissionsToCreate.length > 0) {
        const { error: permissionsError } = await supabaseAdmin
          .from('user_app_permissions')
          .insert(permissionsToCreate)

        if (permissionsError) {
          console.error('Error creating permissions:', permissionsError)
          // No fallamos aquí, el usuario ya está actualizado
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Usuario actualizado correctamente',
    })
  } catch (error: any) {
    console.error('Error in update user API:', error)
    return NextResponse.json(
      { error: error.message || 'Error al actualizar usuario' },
      { status: 500 }
    )
  }
}

