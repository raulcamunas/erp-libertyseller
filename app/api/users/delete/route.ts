import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/auth/api'

/**
 * BORRAR UN USUARIO DEL ERP. SOLO ADMIN.
 *
 * QUÉ IMPIDE EL requireAdmin() DE ABAJO
 * -------------------------------------
 * Igual que su hermana /api/users/update: no comprobaba nada, y middleware.ts
 * (línea 41) declara pública toda /api/. Reproducido sin cookie:
 *
 *     $ curl -X POST http://SERVIDOR/api/users/delete \
 *            -H 'Content-Type: application/json' -d '{}'
 *     {"error":"User ID es requerido"}      <- HTTP 400, NUNCA 401
 *
 * El 400 es de su propia validación: la petición anónima ya había entrado. Con
 * un `userId` de verdad, `auth.admin.deleteUser()` con SUPABASE_SERVICE_ROLE_KEY
 * borra la cuenta. Un solo curl repetido diez veces deja el ERP sin usuarios y
 * a la agencia fuera de su propia herramienta.
 *
 * POR QUÉ NO CAMBIA NADA PARA QUIEN LA USA: el único llamante es
 * components/users/UsersManagement.tsx (/dashboard/users), que ya está cerrada
 * a un admin en middleware.ts y manda cookie.
 */

export async function POST(request: NextRequest) {
  try {
    const sesion = await requireAdmin(
      'Solo un administrador puede eliminar usuarios del ERP'
    )
    if (sesion instanceof NextResponse) return sesion

    const body = await request.json()
    const { userId } = body

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID es requerido' },
        { status: 400 }
      )
    }

    // Obtener service_role key desde variables de entorno
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Missing Supabase credentials')
      return NextResponse.json(
        { error: 'Error de configuración del servidor' },
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

    // Eliminar usuario
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(userId)

    if (deleteError) {
      console.error('Error deleting user:', deleteError)
      return NextResponse.json(
        { error: deleteError.message || 'Error al eliminar usuario' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Usuario eliminado correctamente',
    })
  } catch (error: any) {
    console.error('Error in delete user API:', error)
    return NextResponse.json(
      { error: error.message || 'Error al eliminar usuario' },
      { status: 500 }
    )
  }
}




