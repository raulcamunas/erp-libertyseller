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
  role: 'admin' | 'employee'
  created_at: string
  permissions: UserAppPermission[]
}

export interface CreateUserData {
  email: string
  password: string
  full_name: string
  permissions: {
    app_id: string
    can_access: boolean
  }[]
}

