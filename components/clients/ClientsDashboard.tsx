'use client'

import { useState, useEffect } from 'react'
import { Plus, Search, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

interface Client {
  id: string
  name: string
  description: string | null
  color: string
  icon: string | null
  created_by: string
  created_at: string
  updated_at: string
}

interface User {
  id: string
  email: string | null
  full_name: string | null
}

interface ClientMember {
  id: string
  client_id: string
  user_id: string
  role: 'owner' | 'member'
  profiles?: User
}

interface ClientsDashboardProps {
  initialClients: Client[]
  currentUserRole?: 'admin' | 'employee' | 'partner'
}

export function ClientsDashboard({ initialClients, currentUserRole = 'employee' }: ClientsDashboardProps) {
  const [clients, setClients] = useState<Client[]>(initialClients)
  const [searchQuery, setSearchQuery] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [selectedClient, setSelectedClient] = useState<Client | null>(null)
  const [isMembersSheetOpen, setIsMembersSheetOpen] = useState(false)
  const [members, setMembers] = useState<ClientMember[]>([])
  const [allUsers, setAllUsers] = useState<User[]>([])
  const [selectedUserId, setSelectedUserId] = useState('')
  const [isAddingMember, setIsAddingMember] = useState(false)
  const [isLoadingMembers, setIsLoadingMembers] = useState(false)
  const supabase = createClient()

  const filteredClients = clients.filter(client =>
    client.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (client.description && client.description.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  const handleCreateClient = async () => {
    const name = prompt('Nombre del cliente:')
    if (!name || !name.trim()) return

    setIsCreating(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('No autenticado')

      const { data, error } = await supabase
        .from('client_canvas')
        .insert({
          name: name.trim(),
          created_by: user.id,
        })
        .select()
        .single()

      if (error) throw error

      // Añadir automáticamente el creador como miembro "owner"
      // Verificar primero si ya existe (por si acaso)
      const { data: existingMember } = await supabase
        .from('client_members')
        .select('id')
        .eq('client_id', data.id)
        .eq('user_id', user.id)
        .single()

      if (!existingMember) {
        const { error: memberError } = await supabase
          .from('client_members')
          .insert({
            client_id: data.id,
            user_id: user.id,
            role: 'owner',
            added_by: user.id,
          })

        if (memberError) {
          console.error('Error adding creator as member:', memberError)
          // No bloqueamos la creación si falla esto
        }
      }

      setClients([data, ...clients])
      toast.success('Cliente creado correctamente')
    } catch (error: any) {
      console.error('Error creating client:', error)
      toast.error(error.message || 'Error al crear cliente')
    } finally {
      setIsCreating(false)
    }
  }

  const handleOpenMembersSheet = async (client: Client, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setSelectedClient(client)
    setIsMembersSheetOpen(true)
    await loadMembers(client.id)
    await loadAllUsers()
  }

  const loadMembers = async (clientId: string) => {
    setIsLoadingMembers(true)
    try {
      const { data, error } = await supabase
        .from('client_members')
        .select(`
          *,
          profiles:user_id (
            id,
            email,
            full_name
          )
        `)
        .eq('client_id', clientId)

      if (error) throw error
      setMembers(data || [])
    } catch (error: any) {
      console.error('Error loading members:', error)
      toast.error('Error al cargar miembros')
    } finally {
      setIsLoadingMembers(false)
    }
  }

  const loadAllUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .order('full_name', { ascending: true })

      if (error) throw error
      setAllUsers(data || [])
    } catch (error: any) {
      console.error('Error loading users:', error)
    }
  }

  const handleAddMember = async () => {
    if (!selectedUserId || !selectedClient) return

    const isAlreadyMember = members.some(m => m.user_id === selectedUserId)
    if (isAlreadyMember) {
      toast.error('Este usuario ya es miembro del proyecto')
      return
    }

    setIsAddingMember(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('No autenticado')

      const { data, error } = await supabase
        .from('client_members')
        .insert({
          client_id: selectedClient.id,
          user_id: selectedUserId,
          added_by: user.id,
        })
        .select(`
          *,
          profiles:user_id (
            id,
            email,
            full_name
          )
        `)
        .single()

      if (error) {
        if (error.code === '23505' || error.message.includes('duplicate key')) {
          toast.error('Este usuario ya es miembro del proyecto')
          return
        }
        throw error
      }

      setMembers([...members, data])
      setSelectedUserId('')
      toast.success('Usuario añadido al cliente')
    } catch (error: any) {
      console.error('Error adding member:', error)
      toast.error(error.message || 'Error al añadir usuario')
    } finally {
      setIsAddingMember(false)
    }
  }

  const handleRemoveMember = async (memberId: string, userId: string) => {
    if (!selectedClient) return

    if (selectedClient.created_by === userId) {
      toast.error('No se puede eliminar al propietario del cliente')
      return
    }

    try {
      const { error } = await supabase
        .from('client_members')
        .delete()
        .eq('id', memberId)

      if (error) throw error

      setMembers(members.filter(m => m.id !== memberId))
      toast.success('Usuario eliminado del cliente')
    } catch (error: any) {
      console.error('Error removing member:', error)
      toast.error(error.message || 'Error al eliminar usuario')
    }
  }

  const availableUsersToAdd = allUsers.filter(
    user => !members.some(m => m.user_id === user.id)
  )

  return (
    <div className="space-y-6">
      {/* Barra de búsqueda y crear */}
      <div className="flex gap-4 items-center">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-white/50" />
          <Input
            type="text"
            placeholder="Buscar clientes..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 input-glass"
          />
        </div>
        <Button
          onClick={handleCreateClient}
          disabled={isCreating}
          className="bg-[#FF6600] text-white hover:bg-[#FF6600]/90"
        >
          <Plus className="h-4 w-4 mr-2" />
          {isCreating ? 'Creando...' : 'Nuevo Cliente'}
        </Button>
      </div>

      {/* Grid de Clientes */}
      {filteredClients.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <p className="text-white/60 mb-4">
            {searchQuery ? 'No se encontraron clientes' : 'No hay clientes aún'}
          </p>
          {!searchQuery && (
            <Button
              onClick={handleCreateClient}
              className="bg-[#FF6600] text-white hover:bg-[#FF6600]/90"
            >
              <Plus className="h-4 w-4 mr-2" />
              Crear primer cliente
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredClients.map((client) => (
            <div key={client.id} className="group relative">
              <Link
                href={`/dashboard/clients/${client.id}`}
                className="block"
              >
                <div className="glass-card p-6 h-full transition-all duration-300 hover:scale-[1.02] hover:border-[#FF6600]/30 cursor-pointer relative overflow-hidden">
                  {/* Color indicator */}
                  <div
                    className="absolute top-0 left-0 right-0 h-1"
                    style={{ backgroundColor: client.color }}
                  />

                  {/* Icon */}
                  {client.icon && (
                    <div className="text-3xl mb-3">{client.icon}</div>
                  )}

                  {/* Title */}
                  <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-[#FF6600] transition-colors">
                    {client.name}
                  </h3>

                  {/* Description */}
                  {client.description && (
                    <p className="text-sm text-white/50 mb-4 line-clamp-2">
                      {client.description}
                    </p>
                  )}

                  {/* Footer */}
                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-white/10">
                    <span className="text-xs text-white/40">
                      Ver detalles →
                    </span>
                  </div>
                </div>
              </Link>
              {currentUserRole === 'admin' && (
                <button
                  onClick={(e) => handleOpenMembersSheet(client, e)}
                  className="absolute top-4 right-4 p-2 bg-[#0a0a0a] border border-white/10 rounded-lg hover:bg-white/5 hover:border-[#FF6600]/30 transition-colors opacity-0 group-hover:opacity-100"
                  title="Gestionar usuarios"
                >
                  <Users className="h-4 w-4 text-white/70" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Sheet para gestionar miembros */}
      <Sheet open={isMembersSheetOpen} onOpenChange={setIsMembersSheetOpen}>
        <SheetContent className="bg-[#0a0a0a] border-white/10">
          <SheetHeader>
            <SheetTitle className="text-white">
              Gestionar usuarios - {selectedClient?.name}
            </SheetTitle>
          </SheetHeader>

          <div className="mt-6 space-y-6">
            {/* Añadir usuario */}
            {currentUserRole === 'admin' && availableUsersToAdd.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-white">Añadir usuario</h3>
                <div className="flex gap-2">
                  <select
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    className="flex-1 h-9 rounded-lg border border-white/10 bg-[#0a0a0a] px-3 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#FF6600]"
                  >
                    <option value="">Seleccionar usuario...</option>
                    {availableUsersToAdd.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.full_name || user.email || 'Usuario sin nombre'}
                      </option>
                    ))}
                  </select>
                  <Button
                    onClick={handleAddMember}
                    disabled={!selectedUserId || isAddingMember}
                    size="sm"
                    className="bg-[#FF6600] text-white hover:bg-[#FF6600]/90"
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Añadir
                  </Button>
                </div>
              </div>
            )}

            {/* Lista de miembros */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-white">
                Miembros ({members.length})
              </h3>
              {isLoadingMembers ? (
                <p className="text-white/50 text-sm">Cargando miembros...</p>
              ) : members.length === 0 ? (
                <p className="text-white/50 text-sm">No hay miembros aún</p>
              ) : (
                <div className="space-y-2">
                  {members.map((member) => {
                    const user = member.profiles
                    const userName = user?.full_name || user?.email || 'Usuario desconocido'
                    const userInitial = userName.charAt(0).toUpperCase()

                    return (
                      <div
                        key={member.id}
                        className="flex items-center justify-between bg-[#0a0a0a] border border-white/10 rounded-lg px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-[#FF6600] flex items-center justify-center text-white text-xs font-semibold">
                            {userInitial}
                          </div>
                          <div>
                            <span className="text-sm text-white">{userName}</span>
                            {member.role === 'owner' && (
                              <span className="text-xs text-white/50 ml-2">(Propietario)</span>
                            )}
                          </div>
                        </div>
                        {selectedClient && member.user_id !== selectedClient.created_by && currentUserRole === 'admin' && (
                          <button
                            onClick={() => handleRemoveMember(member.id, member.user_id)}
                            className="text-white/40 hover:text-red-400 transition-colors"
                            title="Eliminar miembro"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

