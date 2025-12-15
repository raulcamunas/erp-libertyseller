import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password, full_name, permissions } = body

    // Validar campos requeridos
    if (!email || !password || !full_name) {
      return NextResponse.json(
        { error: 'Email, contraseña y nombre completo son requeridos' },
        { status: 400 }
      )
    }

    // Validar que la contraseña tenga al menos 6 caracteres
    if (password.length < 6) {
      return NextResponse.json(
        { error: 'La contraseña debe tener al menos 6 caracteres' },
        { status: 400 }
      )
    }

    // Obtener service_role key desde variables de entorno
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl) {
      console.error('Missing NEXT_PUBLIC_SUPABASE_URL')
      return NextResponse.json(
        { error: 'Error de configuración: falta NEXT_PUBLIC_SUPABASE_URL' },
        { status: 500 }
      )
    }

    if (!supabaseServiceKey) {
      console.error('Missing SUPABASE_SERVICE_ROLE_KEY')
      return NextResponse.json(
        { 
          error: 'Error de configuración: falta SUPABASE_SERVICE_ROLE_KEY. Agrega esta variable en tu .env.local con la service_role key de Supabase (Settings → API → service_role key)'
        },
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

    // Crear usuario en auth.users
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Confirmar email automáticamente
      user_metadata: {
        full_name,
      },
    })

    if (authError) {
      console.error('Error creating user in auth:', authError)
      return NextResponse.json(
        { error: authError.message || 'Error al crear usuario' },
        { status: 400 }
      )
    }

    if (!authData.user) {
      return NextResponse.json(
        { error: 'No se pudo crear el usuario' },
        { status: 500 }
      )
    }

    // El trigger handle_new_user() debería crear el perfil automáticamente
    // Pero por si acaso, verificamos y actualizamos el nombre completo
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({ full_name })
      .eq('id', authData.user.id)

    if (profileError) {
      console.error('Error updating profile:', profileError)
      // No fallamos aquí, el perfil puede no existir aún
    }

    // Crear permisos si se proporcionaron
    if (permissions && Array.isArray(permissions) && permissions.length > 0) {
      const permissionsToCreate = permissions
        .filter((p: any) => p.can_access)
        .map((p: any) => ({
          user_id: authData.user.id,
          app_id: p.app_id,
          can_access: true,
        }))

      if (permissionsToCreate.length > 0) {
        const { error: permissionsError } = await supabaseAdmin
          .from('user_app_permissions')
          .insert(permissionsToCreate)

        if (permissionsError) {
          console.error('Error creating permissions:', permissionsError)
          // No fallamos aquí, el usuario ya está creado
        }
      }
    }

    return NextResponse.json({
      success: true,
      user: {
        id: authData.user.id,
        email: authData.user.email,
        full_name,
      },
    })
  } catch (error: any) {
    console.error('Error in create user API:', error)
    return NextResponse.json(
      { error: error.message || 'Error al crear usuario' },
      { status: 500 }
    )
  }
}

