import type { Puesto } from '@/lib/usuarios/puestos'

/**
 * Los cuatro roles del ERP.
 *
 * 'cliente' es el único de FUERA de la agencia. Existe para una sola app
 * —Remesas a FBA— y el middleware le cierra el resto del edificio. Qué datos ve
 * dentro lo decide fba_accesos, no el rol.
 */
export type RolUsuario = 'admin' | 'employee' | 'partner' | 'cliente'

/**
 * El puesto de un empleado: Comercial, Manager Comercial o Gestión Administrativa (lib/usuarios/puestos.ts). NO es un rol: el rol sigue siendo uno de los cuatro de
 * arriba y el puesto solo nombra a la persona y pre-marca sus casillas. null = sin puesto (o todavía sin lanzar la migración 257).
 */
export type { Puesto }

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
  /** El puesto (migración 257). Undefined antes de lanzarla */
  puesto?: Puesto | null
  /** Sale en el equipo que llama (Cold Calling y Agenda) */
  is_comercial?: boolean
  created_at: string
  permissions: UserAppPermission[]
}

export interface CreateUserData {
  email: string
  password: string
  full_name: string
  role?: RolUsuario
  /** Solo para un empleado: Comercial, Manager Comercial o Gestión Administrativa */
  puesto?: Puesto | null
  /** Si llama (sale en el equipo de Cold Calling y en la Agenda). Un Comercial siempre; un Manager, lo que se marque */
  is_comercial?: boolean
  /** Al darlo de alta, crearle su lista de leads («Ana V1») y asignársela */
  crear_lista?: boolean
  permissions: {
    app_id: string
    can_access: boolean
  }[]
}


