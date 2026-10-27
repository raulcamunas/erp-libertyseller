'use client'

import { useState, useEffect } from 'react'
import { ManagedUser, CreateUserData } from '@/lib/types/users'
import { APPS_SIN_EFECTO, PERMISOS_SUELTOS, apps } from '@/lib/config/apps'
import { aplicarPuesto, esComercialDelPuesto, etiquetaDeRol, llevaListaPropia, opcionDeRol, rolYPuestoDe, type OpcionDeRol } from '@/lib/usuarios/puestos'

/**
 * LAS CASILLAS QUE SE OFRECEN, que NO son lo mismo que las apps del menú.
 *
 * `apps` es lo que se pinta como tarjeta; hay permisos que abren puertas sin ser
 * una app —'stock-sync' es el caso— y sin esto se quedan sin casilla, o sea
 * imposibles de conceder desde aquí. Pasó exactamente eso y costó de ver, porque
 * el síntoma es que marcas la casilla que sí está y no ocurre nada.
 *
 * Solo se usan `id` y `name`, así que las dos listas se aplanan a eso.
 */
const COLUMNAS_PERMISO: ReadonlyArray<{ id: string; name: string }> = [
  ...apps.map(a => ({ id: a.id, name: a.name })),
  ...PERMISOS_SUELTOS.map(p => ({ id: p.id, name: p.name })),
]
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, Trash2, Save, X, Edit } from 'lucide-react'
import { AccesosRemesas } from './AccesosRemesas'
import { SelectorDeRol } from './SelectorDeRol'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Checkbox } from '@/components/ui/checkbox'

/** Un formulario en blanco: empleado sin puesto, sin casillas marcadas */
const formularioVacio = (): CreateUserData => ({
  email: '',
  password: '',
  full_name: '',
  role: 'employee',
  puesto: null,
  is_comercial: false,
  crear_lista: false,
  permissions: COLUMNAS_PERMISO.map(app => ({ app_id: app.id, can_access: false })),
})

/** El color de la insignia de cada rol o puesto en la tabla */
const COLOR_DE_OPCION: Record<OpcionDeRol, string> = {
  admin: 'bg-[#FF6600]/20 text-[#FF6600] border border-[#FF6600]/30',
  partner: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
  comercial: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
  manager_comercial: 'bg-violet-500/15 text-violet-300 border border-violet-500/30',
  gestion_administrativa: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
  employee: 'bg-white/10 text-white/70 border border-white/20',
  cliente: 'bg-white/10 text-white/70 border border-white/20',
}

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
  const [formData, setFormData] = useState<CreateUserData>(formularioVacio())

  /**
   * Cambiar el rol o el puesto en el formulario. Un puesto se guarda como empleado + puesto y pre-marca sus casillas: al CREAR se sustituyen las que hubiera (no hay nada que
   * conservar), al EDITAR se suman a las que ya tenía la persona (cambiar de puesto no le quita lo que ya se le dio).
   */
  const cambiarOpcion = (opcion: OpcionDeRol, modo: 'sustituir' | 'sumar') => {
    const { role, puesto } = rolYPuestoDe(opcion)
    setFormData(previo => {
      const llama = esComercialDelPuesto(puesto, previo.is_comercial) ?? previo.is_comercial ?? false
      return {
        ...previo,
        role,
        puesto,
        is_comercial: llama,
        crear_lista: modo === 'sustituir' && llevaListaPropia(puesto, llama),
        permissions: aplicarPuesto(previo.permissions, puesto, modo),
      }
    })
  }

  /** Lo que se manda de `is_comercial`: lo fija el puesto; sin puesto no se manda (no se toca lo que la persona ya tenía) */
  const llamaParaEnviar = (): boolean | undefined => (formData.puesto ? esComercialDelPuesto(formData.puesto, formData.is_comercial ?? false) : undefined)

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
        puesto: profile.puesto ?? null,
        is_comercial: profile.is_comercial === true,
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
          puesto: formData.puesto ?? null,
          is_comercial: llamaParaEnviar(),
          crear_lista: formData.crear_lista === true && llevaListaPropia(formData.puesto ?? null, formData.is_comercial === true),
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

      toast.success(data?.lista ? `Usuario creado. Su lista «${data.lista}» está creada y asignada.` : 'Usuario creado correctamente')
      for (const aviso of (data?.avisos ?? []) as string[]) toast.warning(aviso)
      setIsCreateModalOpen(false)
      setFormData(formularioVacio())
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
      puesto: user.puesto ?? null,
      is_comercial: user.is_comercial === true,
      crear_lista: false,
      permissions: COLUMNAS_PERMISO.map(app => ({
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
          puesto: formData.puesto ?? null,
          is_comercial: llamaParaEnviar(),
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
      for (const aviso of (data?.avisos ?? []) as string[]) toast.warning(aviso)
      setIsEditModalOpen(false)
      setEditingUser(null)
      setFormData(formularioVacio())
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
    const app = COLUMNAS_PERMISO.find(a => a.id === appId)
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
                {COLUMNAS_PERMISO.map(app => (
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
                  <TableCell colSpan={COLUMNAS_PERMISO.length + 4} className="text-center text-white/60 py-8">
                    No hay usuarios registrados
                  </TableCell>
                </TableRow>
              ) : (
                users.map(user => (
                  <TableRow key={user.id} className="border-white/10">
                    <TableCell className="text-white">{user.email}</TableCell>
                    <TableCell className="text-white">{user.full_name || '-'}</TableCell>
                    <TableCell>
                      <span
                        title={user.puesto === 'manager_comercial' && user.is_comercial ? 'También llama: sale en el equipo de Cold Calling y en la Agenda' : undefined}
                        className={cn("px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap", COLOR_DE_OPCION[opcionDeRol(user.role, user.puesto)])}
                      >
                        {etiquetaDeRol(user.role, user.puesto)}
                      </span>
                    </TableCell>
                    {COLUMNAS_PERMISO.map(app => (
                      <TableCell key={app.id} className="text-center">
                        <Checkbox
                          checked={hasPermission(user, app.id)}
                          disabled={APPS_SIN_EFECTO.has(app.id)}
                          title={APPS_SIN_EFECTO.get(app.id)}
                          onCheckedChange={(checked) =>
                            handleTogglePermission(user.id, app.id, !checked)
                          }
                          className="border-white/30 data-[state=checked]:bg-[#FF6600] data-[state=checked]:border-[#FF6600] disabled:opacity-30 disabled:cursor-not-allowed"
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

              <SelectorDeRol
                idBase="edit-role"
                opcion={opcionDeRol(formData.role, formData.puesto)}
                onCambiar={(o) => cambiarOpcion(o, 'sumar')}
                llama={formData.is_comercial === true}
                onLlama={(v) => setFormData({ ...formData, is_comercial: v })}
              />
            </div>

            {/* Un cliente no tiene apps del ERP: tiene CUENTAS de Amazon a las que
                entrar en Remesas a FBA. Se le enseña eso y no la rejilla de
                permisos, que no le aplica y solo confundiría. */}
            {formData.role === 'cliente' && editingUser ? (
              <div>
                <Label className="text-sm font-semibold text-white mb-3 block">
                  Cuentas a las que puede entrar
                </Label>
                <AccesosRemesas usuarioId={editingUser.id} />
              </div>
            ) : (
            <div>
              <Label className="text-sm font-semibold text-white mb-3 block">
                Permisos de Aplicaciones
              </Label>
              <div className="space-y-2">
                {COLUMNAS_PERMISO.map(app => (
                  <div
                    key={app.id}
                    className="flex items-center justify-between glass-card p-3"
                    title={APPS_SIN_EFECTO.get(app.id)}
                  >
                    <span className={APPS_SIN_EFECTO.has(app.id) ? 'text-white/40' : 'text-white'}>
                      {app.name}
                    </span>
                    <Checkbox
                      disabled={APPS_SIN_EFECTO.has(app.id)}
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
            )}

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

              <SelectorDeRol
                idBase="role"
                opcion={opcionDeRol(formData.role, formData.puesto)}
                onCambiar={(o) => cambiarOpcion(o, 'sustituir')}
                llama={formData.is_comercial === true}
                onLlama={(v) => setFormData({ ...formData, is_comercial: v, crear_lista: v })}
                crearLista={formData.crear_lista === true}
                onCrearLista={(v) => setFormData({ ...formData, crear_lista: v })}
              />
            </div>

            {/* Permisos por aplicación */}
            <div>
              <Label className="text-sm font-semibold text-white mb-3 block">
                Permisos de Aplicaciones
              </Label>
              <div className="space-y-2">
                {COLUMNAS_PERMISO.map(app => (
                  <div
                    key={app.id}
                    className="flex items-center justify-between glass-card p-3"
                    title={APPS_SIN_EFECTO.get(app.id)}
                  >
                    <span className={APPS_SIN_EFECTO.has(app.id) ? 'text-white/40' : 'text-white'}>
                      {app.name}
                    </span>
                    <Checkbox
                      disabled={APPS_SIN_EFECTO.has(app.id)}
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


