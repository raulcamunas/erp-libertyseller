import { createClient } from './server'
import { cache } from 'react'

export interface UserProfile {
  id: string
  email: string | null
  full_name: string | null
  role: 'admin' | 'employee' | 'partner'
}

/**
 * Obtiene el perfil del usuario actual desde la base de datos
 * Usa cache() para evitar múltiples llamadas en el mismo request
 */
export const getUserProfile = cache(async (): Promise<UserProfile | null> => {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return null
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, role')
    .eq('id', user.id)
    .single()

  if (error) {
    // NO SE CONFUNDE «NO HAY PERFIL» CON «LA CONSULTA HA FALLADO».
    //
    // QUÉ PROBLEMA RESUELVE, reproducido: se montó un Supabase falso que
    // responde 200 en /auth/v1/user (sesión buena) y 500 en /rest/v1/profiles
    // (código 08006, «server closed the connection unexpectedly»), y se
    // levantó el ERP real contra él con una cookie de sesión fabricada:
    //
    //   GET /dashboard   -> 307 a /auth/login   (app/dashboard/layout.tsx:22,
    //                                            porque esto devolvía null)
    //   GET /auth/login  -> 307 a /dashboard    (middleware.ts:61, porque el
    //                                            usuario SÍ existe)
    //   siguiendo redirecciones: 12 saltos -> ERR_TOO_MANY_REDIRECTS
    //
    // Es decir: un fallo pasajero de la consulta de perfiles dejaba el ERP
    // ENTERO en bucle de redirecciones, para todos a la vez y sin un mensaje.
    // El control con el mismo montaje devolviendo profiles bien da 200.
    //
    // PGRST116 es «no hay ninguna fila» y ese sí es un null legítimo: es lo
    // que devuelve `.single()` cuando el usuario no tiene perfil. Cualquier
    // otro código —red, permisos, RLS, la base caída— es un fallo de verdad y
    // tiene que propagarse para que lo recoja app/dashboard/error.tsx (o
    // app/global-error.tsx si el que revienta es el layout raíz), que enseña
    // el digest y deja rastro, en vez de mandar a nadie a un bucle mudo.
    //
    // Mientras profiles responda —que es siempre— esto no se nota en nada.
    if (error.code === 'PGRST116') {
      return null
    }
    console.error('Error fetching user profile:', error)
    throw error
  }

  return profile as UserProfile
})

