'use client'

import { useState, useEffect } from 'react'
import { ManagedUser, CreateUserData } from '@/lib/types/users'
import { apps } from '@/lib/config/apps'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Trash2, Save, X, Edit } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'

export function UsersManagement() {
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [updating, setUpdating] = useState(false)
  const supabase = createClient()

  // Form state
  const [formData, setFormData] = useState<CreateUserData>({
    email: '',
    password: '',
    full_name: '',
    role: 'employee',
    permissions: apps.map(app => ({ app_id: app.id, can_access: false })),
  })

  useEffect(() => {
    loadUsers()
  }, [])

  const loadUsers = async () => {
    try {
      setLoading(true)
      
      // Obtener todos los perfiles (solo admin puede hacer esto)
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false })

      if (profilesError) throw profilesError

      // Obtener permisos de todos los usuarios
      const { data: permissions, error: permissionsError } = await supabase
        .from('user_app_permissions')
        .select('*')

      if (permissionsError) throw permissionsError

      // Combinar perfiles con permisos
      const usersWithPermissions: ManagedUser[] = (profiles || []).map(profile => ({
        id: profile.id,
        email: profile.email || '',
        full_name: profile.full_name,
        role: profile.role,
        created_at: profile.created_at,
        permissions: (permissions || []).filter(p => p.user_id === profile.id),
      }))

      setUsers(usersWithPermissions)
    } catch (error) {
      console.error('Error loading users:', error)
      toast.error('Error al cargar usuarios')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateUser = async () => {
    if (!formData.email || !formData.password || !formData.full_name) {
      toast.error('Por favor completa todos los campos')
      return
    }

    setCreating(true)
    try {
      console.log('[FRONTEND] Creating user with data:', {
        email: formData.email,
        full_name: formData.full_name,
        permissionsCount: formData.permissions.filter(p => p.can_access).length
      })

      // Llamar a la API para crear el usuario
      const response = await fetch('/api/users/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: formData.email,
          password: formData.password,
          full_name: formData.full_name,
          role: formData.role || 'employee',
          permissions: formData.permissions,
        }),
      })

      console.log('[FRONTEND] Response status:', response.status, response.statusText)

      let data
      try {
        data = await response.json()
        console.log('[FRONTEND] Response data:', data)
      } catch (parseError) {
        console.error('[FRONTEND] Error parsing response:', parseError)
        const text = await response.text()
        console.error('[FRONTEND] Response text:', text)
        throw new Error(`Error al procesar la respuesta del servidor: ${response.status} ${response.statusText}`)
      }

      if (!response.ok) {
        const errorMessage = data?.error || `Error ${response.status}: ${response.statusText}`
        console.error('[FRONTEND] Error response:', { status: response.status, error: errorMessage, data })
        throw new Error(errorMessage)
      }

      toast.success('Usuario creado correctamente')
      setIsCreateModalOpen(false)
      setFormData({
        email: '',
        password: '',
        full_name: '',
        permissions: apps.map(app => ({ app_id: app.id, can_access: false })),
      })
      loadUsers()
    } catch (error: any) {
      console.error('[FRONTEND] Error creating user:', {
        message: error.message,
        name: error.name,
        stack: error.stack,
        error
      })
      toast.error(error.message || 'Error al crear usuario. Revisa la consola para más detalles.')
    } finally {
      setCreating(false)
    }
  }

  const handleTogglePermission = async (userId: string, appId: string, currentValue: boolean) => {
    try {
      if (currentValue) {
        // Eliminar permiso
        const { error } = await supabase
          .from('user_app_permissions')
          .delete()
          .eq('user_id', userId)
          .eq('app_id', appId)

        if (error) throw error
      } else {
        // Crear permiso
        const { error } = await supabase
          .from('user_app_permissions')
          .insert({
            user_id: userId,
            app_id: appId,
            can_access: true,
          })

        if (error) throw error
      }

      toast.success('Permiso actualizado')
      loadUsers()
    } catch (error) {
      console.error('Error updating permission:', error)
      toast.error('Error al actualizar permiso')
    }
  }

  const handleEditUser = (user: ManagedUser) => {
    setEditingUser(user)
    setFormData({
      email: user.email,
      password: '', // No prellenar contraseña por seguridad
      full_name: user.full_name || '',
      role: user.role,
      permissions: apps.map(app => ({
        app_id: app.id,
        can_access: hasPermission(user, app.id),
      })),
    })
    setIsEditModalOpen(true)
  }

  const handleUpdateUser = async () => {
    if (!editingUser || !formData.full_name) {
      toast.error('Por favor completa todos los campos requeridos')
      return
    }

    setUpdating(true)
    try {
      const response = await fetch('/api/users/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: editingUser.id,
          email: formData.email,
          full_name: formData.full_name,
          password: formData.password || undefined, // Solo enviar si se proporciona
          role: formData.role || 'employee',
          permissions: formData.permissions,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        const errorMessage = data.error || 'Error al actualizar usuario'
        console.error('Error updating user:', errorMessage)
        throw new Error(errorMessage)
      }

      toast.success('Usuario actualizado correctamente')
      setIsEditModalOpen(false)
      setEditingUser(null)
      setFormData({
        email: '',
        password: '',
        full_name: '',
        permissions: apps.map(app => ({ app_id: app.id, can_access: false })),
      })
      loadUsers()
    } catch (error: any) {
      console.error('Error updating user:', error)
      toast.error(error.message || 'Error al actualizar usuario')
    } finally {
      setUpdating(false)
    }
  }

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('¿Estás seguro de que quieres eliminar este usuario?')) {
      return
    }

    try {
      // Llamar a la API para eliminar el usuario
      const response = await fetch('/api/users/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Error al eliminar usuario')
      }

      toast.success('Usuario eliminado')
      loadUsers()
    } catch (error: any) {
      console.error('Error deleting user:', error)
      toast.error(error.message || 'Error al eliminar usuario')
    }
  }

  const getAppName = (appId: string) => {
    const app = apps.find(a => a.id === appId)
    return app?.name || appId
  }

  const hasPermission = (user: ManagedUser, appId: string) => {
    return user.permissions.some(p => p.app_id === appId && p.can_access)
  }

  if (loading) {
    return (
      <div className="glass-card p-12 text-center">
        <p className="text-white/60">Cargando usuarios...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Botón Crear Usuario */}
      <div className="flex justify-end">
        <Button
          onClick={() => setIsCreateModalOpen(true)}
          className="bg-[#FF6600] text-white hover:bg-[#FF6600]/90"
        >
          <Plus className="h-4 w-4 mr-2" />
          Crear Usuario
        </Button>
      </div>

      {/* Tabla de Usuarios */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-white/10">
                <TableHead className="text-white">Email</TableHead>
                <TableHead className="text-white">Nombre</TableHead>
                <TableHead className="text-white">Rol</TableHead>
                {apps.map(app => (
                  <TableHead key={app.id} className="text-white text-center">
                    {app.name}
                  </TableHead>
                ))}
                <TableHead className="text-white text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={apps.length + 4} className="text-center text-white/60 py-8">
                    No hay usuarios registrados
                  </TableCell>
                </TableRow>
              ) : (
                users.map(user => (
                  <TableRow key={user.id} className="border-white/10">
                    <TableCell className="text-white">{user.email}</TableCell>
                    <TableCell className="text-white">{user.full_name || '-'}</TableCell>
                    <TableCell>
                      <span className={cn(
                        "px-2 py-1 rounded-full text-xs font-semibold",
                        user.role === 'admin'
                          ? "bg-[#FF6600]/20 text-[#FF6600] border border-[#FF6600]/30"
                          : user.role === 'partner'
                          ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                          : "bg-white/10 text-white/70 border border-white/20"
                      )}>
                        {user.role === 'admin' ? 'Admin' : user.role === 'partner' ? 'Partner' : 'Empleado'}
                      </span>
                    </TableCell>
                    {apps.map(app => (
                      <TableCell key={app.id} className="text-center">
                        <Checkbox
                          checked={hasPermission(user, app.id)}
                          onCheckedChange={(checked) =>
                            handleTogglePermission(user.id, app.id, !checked)
                          }
                          className="border-white/30 data-[state=checked]:bg-[#FF6600] data-[state=checked]:border-[#FF6600]"
                        />
                      </TableCell>
                    ))}
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditUser(user)}
                          className="text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteUser(user.id)}
                          className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Modal Editar Usuario */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="bg-[#080808] border-white/10 max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-white">
              Editar Usuario
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 mt-4">
            {/* Campos básicos */}
            <div className="space-y-4">
              <div>
                <Label htmlFor="edit-email" className="text-sm font-semibold text-white mb-2 block">
                  Email
                </Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="usuario@empresa.com"
                  className="input-glass"
                />
              </div>

              <div>
                <Label htmlFor="edit-password" className="text-sm font-semibold text-white mb-2 block">
                  Nueva Contraseña (opcional)
                </Label>
                <Input
                  id="edit-password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Dejar vacío para no cambiar"
                  className="input-glass"
                />
              </div>

              <div>
                <Label htmlFor="edit-full_name" className="text-sm font-semibold text-white mb-2 block">
                  Nombre Completo
                </Label>
                <Input
                  id="edit-full_name"
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  placeholder="Juan Pérez"
                  className="input-glass"
                />
              </div>

              <div>
                <Label htmlFor="edit-role" className="text-sm font-semibold text-white mb-2 block">
                  Rol
                </Label>
                <select
                  id="edit-role"
                  value={formData.role || 'employee'}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as 'admin' | 'employee' | 'partner' })}
                  className="w-full h-10 rounded-xl border border-white/10 bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#FF6600] focus:ring-offset-2 focus:border-[#FF6600]"
                >
                  <option value="employee">Empleado</option>
                  <option value="admin">Admin</option>
                  <option value="partner">Partner</option>
                </select>
              </div>
            </div>

            {/* Permisos por aplicación */}
            <div>
              <Label className="text-sm font-semibold text-white mb-3 block">
                Permisos de Aplicaciones
              </Label>
              <div className="space-y-2">
                {apps.map(app => (
                  <div
                    key={app.id}
                    className="flex items-center justify-between glass-card p-3"
                  >
                    <span className="text-white">{app.name}</span>
                    <Checkbox
                      checked={formData.permissions.find(p => p.app_id === app.id)?.can_access || false}
                      onCheckedChange={(checked) => {
                        setFormData({
                          ...formData,
                          permissions: formData.permissions.map(p =>
                            p.app_id === app.id
                              ? { ...p, can_access: checked as boolean }
                              : p
                          ),
                        })
                      }}
                      className="border-white/30 data-[state=checked]:bg-[#FF6600] data-[state=checked]:border-[#FF6600]"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Botones */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setIsEditModalOpen(false)
                  setEditingUser(null)
                }}
                className="flex-1 border-white/20 hover:border-white/40"
              >
                <X className="h-4 w-4 mr-2" />
                Cancelar
              </Button>
              <Button
                onClick={handleUpdateUser}
                disabled={updating}
                className="flex-1 bg-[#FF6600] text-white hover:bg-[#FF6600]/90"
              >
                <Save className="h-4 w-4 mr-2" />
                {updating ? 'Guardando...' : 'Guardar Cambios'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal Crear Usuario */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="bg-[#080808] border-white/10 max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-white">
              Crear Nuevo Usuario
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 mt-4">
            {/* Campos básicos */}
            <div className="space-y-4">
              <div>
                <Label htmlFor="email" className="text-sm font-semibold text-white mb-2 block">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="usuario@empresa.com"
                  className="input-glass"
                />
              </div>

              <div>
                <Label htmlFor="password" className="text-sm font-semibold text-white mb-2 block">
                  Contraseña
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="Mínimo 6 caracteres"
                  className="input-glass"
                />
              </div>

              <div>
                <Label htmlFor="full_name" className="text-sm font-semibold text-white mb-2 block">
                  Nombre Completo
                </Label>
                <Input
                  id="full_name"
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  placeholder="Juan Pérez"
                  className="input-glass"
                />
              </div>

              <div>
                <Label htmlFor="role" className="text-sm font-semibold text-white mb-2 block">
                  Rol
                </Label>
                <select
                  id="role"
                  value={formData.role || 'employee'}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as 'admin' | 'employee' | 'partner' })}
                  className="w-full h-10 rounded-xl border border-white/10 bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#FF6600] focus:ring-offset-2 focus:border-[#FF6600]"
                >
                  <option value="employee">Empleado</option>
                  <option value="admin">Admin</option>
                  <option value="partner">Partner</option>
                </select>
              </div>
            </div>

            {/* Permisos por aplicación */}
            <div>
              <Label className="text-sm font-semibold text-white mb-3 block">
                Permisos de Aplicaciones
              </Label>
              <div className="space-y-2">
                {apps.map(app => (
                  <div
                    key={app.id}
                    className="flex items-center justify-between glass-card p-3"
                  >
                    <span className="text-white">{app.name}</span>
                    <Checkbox
                      checked={formData.permissions.find(p => p.app_id === app.id)?.can_access || false}
                      onCheckedChange={(checked) => {
                        setFormData({
                          ...formData,
                          permissions: formData.permissions.map(p =>
                            p.app_id === app.id
                              ? { ...p, can_access: checked as boolean }
                              : p
                          ),
                        })
                      }}
                      className="border-white/30 data-[state=checked]:bg-[#FF6600] data-[state=checked]:border-[#FF6600]"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Botones */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setIsCreateModalOpen(false)}
                className="flex-1 border-white/20 hover:border-white/40"
              >
                <X className="h-4 w-4 mr-2" />
                Cancelar
              </Button>
              <Button
                onClick={handleCreateUser}
                disabled={creating}
                className="flex-1 bg-[#FF6600] text-white hover:bg-[#FF6600]/90"
              >
                <Save className="h-4 w-4 mr-2" />
                {creating ? 'Creando...' : 'Crear Usuario'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function cn(...classes: (string | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}


