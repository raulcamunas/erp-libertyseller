import { createClient } from './server'
import { cache } from 'react'

export interface UserProfile {
  id: string
  email: string | null
  full_name: string | null
  role: 'admin' | 'employee'
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
    console.error('Error fetching user profile:', error)
    return null
  }

  return profile as UserProfile
})

