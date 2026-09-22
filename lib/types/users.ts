/**
 * Los cuatro roles del ERP.
 *
 * 'cliente' es el único de FUERA de la agencia. Existe para una sola app
 * —Remesas a FBA— y el middleware le cierra el resto del edificio. Qué datos ve
 * dentro lo decide fba_accesos, no el rol.
 */
export type RolUsuario = 'admin' | 'employee' | 'partner' | 'cliente'

export interface UserAppPermission {
  id: string
  user_id: string
  app_id: string
  can_access: boolean
  created_at: string
  updated_at: string
}

export interface ManagedUser {
  id: string
  email: string
  full_name: string | null
  role: RolUsuario
  created_at: string
  permissions: UserAppPermission[]
}

export interface CreateUserData {
  email: string
  password: string
  full_name: string
  role?: RolUsuario
  permissions: {
    app_id: string
    can_access: boolean
  }[]
}


