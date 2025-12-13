'use client'

import { useState, useEffect } from 'react'
import { ManagedUser, CreateUserData } from '@/lib/types/users'
import { apps } from '@/lib/config/apps'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Trash2, Save, X } from 'lucide-react'
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
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const supabase = createClient()

  // Form state
  const [formData, setFormData] = useState<CreateUserData>({
    email: '',
    password: '',
    full_name: '',
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
      // Crear usuario en auth
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: formData.email,
        password: formData.password,
        email_confirm: true,
        user_metadata: {
          full_name: formData.full_name,
        },
      })

      if (authError) throw authError

      if (!authData.user) {
        throw new Error('No se pudo crear el usuario')
      }

      // Actualizar perfil con nombre completo
      const { error: profileError } = await supabase
        .from('profiles')
        .update({ full_name: formData.full_name })
        .eq('id', authData.user.id)

      if (profileError) throw profileError

      // Crear permisos
      const permissionsToCreate = formData.permissions
        .filter(p => p.can_access)
        .map(p => ({
          user_id: authData.user.id,
          app_id: p.app_id,
          can_access: true,
        }))

      if (permissionsToCreate.length > 0) {
        const { error: permissionsError } = await supabase
          .from('user_app_permissions')
          .insert(permissionsToCreate)

        if (permissionsError) throw permissionsError
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
      console.error('Error creating user:', error)
      toast.error(error.message || 'Error al crear usuario')
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

  const handleDeleteUser = async (userId: string) => {
    if (!confirm('¿Estás seguro de que quieres eliminar este usuario?')) {
      return
    }

    try {
      const { error } = await supabase.auth.admin.deleteUser(userId)
      if (error) throw error

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
                          : "bg-white/10 text-white/70 border border-white/20"
                      )}>
                        {user.role === 'admin' ? 'Admin' : 'Empleado'}
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteUser(user.id)}
                        className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

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

