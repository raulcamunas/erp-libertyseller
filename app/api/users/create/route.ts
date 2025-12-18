import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(request: NextRequest) {
  try {
    console.log('[CREATE USER] Starting user creation process...')
    const body = await request.json()
    const { email, password, full_name, role, permissions } = body

    console.log('[CREATE USER] Received data:', { email, full_name, permissionsCount: permissions?.length || 0 })

    // Validar campos requeridos
    if (!email || !password || !full_name) {
      console.error('[CREATE USER] Missing required fields:', { email: !!email, password: !!password, full_name: !!full_name })
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
    console.log('[CREATE USER] Creating user in auth.users...')
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Confirmar email automáticamente
      user_metadata: {
        full_name,
      },
    })

    if (authError) {
      console.error('[CREATE USER] Error creating user in auth:', {
        message: authError.message,
        status: authError.status,
        code: (authError as any).code,
        details: (authError as any).details,
        hint: (authError as any).hint,
        error: JSON.stringify(authError, null, 2)
      })
      
      // Si el error es de Supabase, devolver el mensaje original
      const errorMessage = authError.message || 'Error al crear usuario en el sistema de autenticación'
      return NextResponse.json(
        { 
          error: errorMessage,
          details: (authError as any).details,
          code: (authError as any).code,
          hint: (authError as any).hint
        },
        { status: 400 }
      )
    }

    if (!authData.user) {
      console.error('[CREATE USER] No user data returned from auth.createUser')
      return NextResponse.json(
        { error: 'No se pudo crear el usuario: no se recibieron datos del usuario' },
        { status: 500 }
      )
    }

    console.log('[CREATE USER] User created in auth.users:', authData.user.id)

    // Esperar un momento para que el trigger handle_new_user() cree el perfil
    // El trigger se ejecuta automáticamente, pero puede haber un pequeño delay
    console.log('[CREATE USER] Waiting for profile to be created by trigger...')
    let profileExists = false
    let retries = 0
    const maxRetries = 5

    while (!profileExists && retries < maxRetries) {
      const { data: profileData, error: profileCheckError } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('id', authData.user.id)
        .single()

      if (profileData && !profileCheckError) {
        profileExists = true
        console.log('[CREATE USER] Profile found after', retries + 1, 'retries')
      } else {
        if (profileCheckError) {
          console.log('[CREATE USER] Profile check error (attempt', retries + 1, '):', profileCheckError.message)
        }
        // Esperar 200ms antes de reintentar
        await new Promise(resolve => setTimeout(resolve, 200))
        retries++
      }
    }

    // Si el perfil no existe después de los reintentos, intentar crearlo manualmente
    if (!profileExists) {
      console.log('[CREATE USER] Profile not found, creating manually...')
      
      // Intentar crear el perfil con upsert para evitar conflictos
      const { data: profileData, error: profileCreateError } = await supabaseAdmin
        .from('profiles')
        .upsert({
          id: authData.user.id,
          email: authData.user.email || email,
          full_name,
          role: role || 'employee',
        }, {
          onConflict: 'id'
        })
        .select()
        .single()

      if (profileCreateError) {
        console.error('[CREATE USER] Error creating profile manually:', {
          message: profileCreateError.message,
          code: profileCreateError.code,
          details: profileCreateError.details,
          hint: profileCreateError.hint,
          error: JSON.stringify(profileCreateError, null, 2)
        })
        
        // Si el error es de conflicto (perfil ya existe), verificar si realmente existe
        if (profileCreateError.code === '23505' || profileCreateError.message?.includes('duplicate')) {
          console.log('[CREATE USER] Profile might already exist, checking...')
          const { data: existingProfile } = await supabaseAdmin
            .from('profiles')
            .select('id')
            .eq('id', authData.user.id)
            .single()
          
          if (existingProfile) {
            console.log('[CREATE USER] Profile exists after all, continuing...')
            profileExists = true
          } else {
            return NextResponse.json(
              { 
                error: `Error al crear el perfil: ${profileCreateError.message}`,
                details: profileCreateError.details,
                code: profileCreateError.code,
                hint: profileCreateError.hint
              },
              { status: 500 }
            )
          }
        } else {
          return NextResponse.json(
            { 
              error: `Error al crear el perfil: ${profileCreateError.message}`,
              details: profileCreateError.details,
              code: profileCreateError.code,
              hint: profileCreateError.hint
            },
            { status: 500 }
          )
        }
      } else {
        console.log('[CREATE USER] Profile created manually successfully')
        profileExists = true
      }
    } else {
      // Actualizar el nombre completo y rol si el perfil ya existe
      console.log('[CREATE USER] Profile exists, updating full_name and role...')
      const { error: profileUpdateError } = await supabaseAdmin
        .from('profiles')
        .update({ full_name, role: role || 'employee' })
        .eq('id', authData.user.id)

      if (profileUpdateError) {
        console.error('[CREATE USER] Error updating profile:', profileUpdateError)
        // No fallamos aquí, el perfil existe
      } else {
        console.log('[CREATE USER] Profile updated successfully')
      }
    }

    // Crear permisos si se proporcionaron
    // Asegurarnos de que el perfil existe antes de crear permisos
    if (permissions && Array.isArray(permissions) && permissions.length > 0) {
      // Verificar que el perfil existe (debería existir después del trigger o creación manual)
      const { data: profileCheck } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('id', authData.user.id)
        .single()

      if (!profileCheck) {
        console.error('Profile does not exist for user:', authData.user.id)
        return NextResponse.json(
          { error: 'Error: El perfil del usuario no se pudo crear correctamente' },
          { status: 500 }
        )
      }

      const permissionsToCreate = permissions
        .filter((p: any) => p.can_access)
        .map((p: any) => ({
          user_id: authData.user.id, // El ID es el mismo para auth.users y profiles
          app_id: p.app_id,
          can_access: true,
        }))

      if (permissionsToCreate.length > 0) {
        const { error: permissionsError } = await supabaseAdmin
          .from('user_app_permissions')
          .insert(permissionsToCreate)

        if (permissionsError) {
          console.error('[CREATE USER] Error creating permissions:', {
            message: permissionsError.message,
            code: permissionsError.code,
            details: permissionsError.details,
            hint: permissionsError.hint,
            error: JSON.stringify(permissionsError, null, 2)
          })
          // No fallamos aquí, el usuario ya está creado
          // Los permisos se pueden añadir manualmente después
          console.warn('[CREATE USER] User created but permissions could not be added:', permissionsError.message)
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
    console.error('[CREATE USER] Unexpected error:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      error: error
    })
    return NextResponse.json(
      { error: error.message || 'Error inesperado al crear usuario' },
      { status: 500 }
    )
  }
}

