'use client'

import { useState, useRef, useEffect } from 'react'
import { ArrowLeft, Plus, MoreVertical, Calendar, User, Trash2, Edit2, GripVertical, MessageSquare, X, Users, Search } from 'lucide-react'
import { motion, useMotionValue, useDragControls } from 'framer-motion'
import { Button } from '@/components/ui/button'
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
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { FileText, Clock } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from '@/components/ui/select'

interface Client {
  id: string
  name: string
  description: string | null
  color: string
  icon: string | null
  created_at: string
  updated_at: string
}

interface Task {
  id: string
  client_id: string
  title: string
  description: string | null
  status: 'todo' | 'in_progress' | 'done' | 'archived'
  priority: 'low' | 'medium' | 'high' | 'urgent'
  due_date: string | null
  assigned_to: string | null
  created_at: string
  updated_at: string
  position: number
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
  profiles: User
}

interface TaskComment {
  id: string
  task_id: string
  user_id: string
  content: string
  created_at: string
  updated_at: string
  profiles?: User
}

interface DocumentFile {
  url: string
  name: string
  type: string
}

interface FabricanteContactData {
  nombre_empresa: string
  correo_principal: string
  correo_secundario?: string
  telefono?: string
  direccion_linea1: string
  direccion_linea2?: string
  localidad: string
  estado_provincia?: string
  codigo_postal?: string
  pais: string
}

interface ClientDocumentRow {
  id: string
  client_id: string
  motivo: string | null
  asin: string | null
  producto: string | null
  informacion_a_rellenar: string | null
  pdf_para_subir: DocumentFile[]
  idioma_pdf: string | null
  position: number
  subido: boolean
  created_by: string
  created_at: string
  updated_at: string
}

interface ClientInvoice {
  id: string
  client_id: string
  month: number
  year: number
  coste_mensual_fijo: number
  comision: number
  reporte_url: string | null
  created_by: string
  created_at: string
  updated_at: string
}

interface ClientPrivateBrand {
  id: string
  client_id: string
  nombre: string | null
  asin: string | null
  b1: boolean
  b2: boolean
  b3: boolean
  b4: boolean
  b5: boolean
  descripcion: boolean
  a_plus: boolean
  foto_1: boolean
  foto_2: boolean
  foto_3: boolean
  foto_4: boolean
  foto_5: boolean
  foto_6: boolean
  foto_7: boolean
  video: boolean
  categoria: boolean
  pais: string | null
  position: number
  created_by: string
  created_at: string
  updated_at: string
}

interface ClientDetailProps {
  client: Client
  initialTasks: Task[]
  initialMembers?: ClientMember[]
  allUsers?: User[]
  currentUserId: string
  currentUserRole?: 'admin' | 'employee' | 'partner'
}

// Componente de bloque de tarea estilo Notion (Draggable)
function TaskBlock({ 
  task, 
  onUpdate, 
  onDelete,
  onStatusChange,
  onDragEnd,
  assignedUser,
  commentCount,
  currentUserId
}: { 
  task: Task
  onUpdate: (task: Task) => void
  onDelete: (taskId: string) => void
  onStatusChange: (taskId: string, status: Task['status']) => void
  onDragEnd: (taskId: string, x: number, y: number) => void
  assignedUser?: User | null
  commentCount?: number
  currentUserId: string
}) {
  const dragControls = useDragControls()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const [isEditing, setIsEditing] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description || '')
  const [priority, setPriority] = useState(task.priority)
  const [dueDate, setDueDate] = useState(task.due_date ? task.due_date.split('T')[0] : '')
  const [assignedTo, setAssignedTo] = useState(task.assigned_to || '')
  const [comments, setComments] = useState<TaskComment[]>([])
  const [newComment, setNewComment] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingCommentContent, setEditingCommentContent] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isLoadingComments, setIsLoadingComments] = useState(false)
  const [isUpdatingComment, setIsUpdatingComment] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const commentInputRef = useRef<HTMLTextAreaElement>(null)
  const editingCommentInputRef = useRef<HTMLTextAreaElement>(null)
  const supabase = createClient()
  const availableUsers = (window as any).__availableUsers || []

  useEffect(() => {
    if (isEditing && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [isEditing])

  useEffect(() => {
    if (isSheetOpen) {
      loadComments()
    }
  }, [isSheetOpen])

  const loadComments = async () => {
    setIsLoadingComments(true)
    try {
      const { data, error } = await supabase
        .from('task_comments')
        .select(`
          *,
          profiles:user_id (
            id,
            email,
            full_name
          )
        `)
        .eq('task_id', task.id)
        .order('created_at', { ascending: true })

      if (error) throw error
      setComments(data || [])
    } catch (error: any) {
      console.error('Error loading comments:', error)
    } finally {
      setIsLoadingComments(false)
    }
  }

  const handleAddComment = async () => {
    if (!newComment.trim()) return

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('No autenticado')

      const { data, error } = await supabase
        .from('task_comments')
        .insert({
          task_id: task.id,
          user_id: user.id,
          content: newComment.trim(),
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

      if (error) throw error

      setComments([...comments, data])
      setNewComment('')
      if (commentInputRef.current) {
        commentInputRef.current.focus()
      }
    } catch (error: any) {
      console.error('Error adding comment:', error)
      toast.error(error.message || 'Error al añadir comentario')
    }
  }

  const handleStartEditComment = (comment: TaskComment) => {
    setEditingCommentId(comment.id)
    setEditingCommentContent(comment.content)
    setTimeout(() => {
      editingCommentInputRef.current?.focus()
    }, 0)
  }

  const handleCancelEditComment = () => {
    setEditingCommentId(null)
    setEditingCommentContent('')
  }

  const handleUpdateComment = async (commentId: string) => {
    if (!editingCommentContent.trim()) return

    setIsUpdatingComment(true)
    try {
      const { data, error } = await supabase
        .from('task_comments')
        .update({
          content: editingCommentContent.trim(),
          updated_at: new Date().toISOString()
        })
        .eq('id', commentId)
        .select(`
          *,
          profiles:user_id (
            id,
            email,
            full_name
          )
        `)
        .single()

      if (error) throw error

      setComments(comments.map(c => c.id === commentId ? data : c))
      setEditingCommentId(null)
      setEditingCommentContent('')
      toast.success('Comentario actualizado')
    } catch (error: any) {
      console.error('Error updating comment:', error)
      toast.error(error.message || 'Error al actualizar comentario')
    } finally {
      setIsUpdatingComment(false)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const { error } = await supabase
        .from('client_tasks')
        .update({
          title: title.trim(),
          description: description.trim() || null,
          priority,
          due_date: dueDate || null,
          assigned_to: assignedTo || null,
        })
        .eq('id', task.id)

      if (error) throw error

      onUpdate({
        ...task,
        title: title.trim(),
        description: description.trim() || null,
        priority,
        due_date: dueDate || null,
        assigned_to: assignedTo || null,
      })
      
      setIsEditing(false)
      setIsSheetOpen(false)
      toast.success('Tarea actualizada')
    } catch (error: any) {
      console.error('Error updating task:', error)
      toast.error(error.message || 'Error al actualizar tarea')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('¿Estás seguro de que quieres eliminar esta tarea?')) return

    try {
      const { error } = await supabase
        .from('client_tasks')
        .delete()
        .eq('id', task.id)

      if (error) throw error

      onDelete(task.id)
      toast.success('Tarea eliminada')
    } catch (error: any) {
      console.error('Error deleting task:', error)
      toast.error(error.message || 'Error al eliminar tarea')
    }
  }

  const getPriorityColor = () => {
    switch (priority) {
      case 'urgent':
        return 'border-red-500/50 bg-red-500/10'
      case 'high':
        return 'border-orange-500/50 bg-orange-500/10'
      case 'medium':
        return 'border-yellow-500/50 bg-yellow-500/10'
      default:
        return 'border-white/10'
    }
  }

  const getStatusBadge = () => {
    switch (task.status) {
      case 'todo':
        return { label: 'Sin empezar', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' }
      case 'in_progress':
        return { label: 'En progreso', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' }
      case 'done':
        return { label: 'Hecho', color: 'bg-green-500/20 text-green-400 border-green-500/30' }
      default:
        return { label: 'Archivado', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' }
    }
  }

  const statusBadge = getStatusBadge()

  return (
    <>
      <motion.div
        drag
        dragControls={dragControls}
        dragMomentum={false}
        dragElastic={0}
        onDragEnd={(event, info) => {
          const rect = (event.target as HTMLElement).getBoundingClientRect()
          onDragEnd(task.id, rect.left + rect.width / 2, rect.top + rect.height / 2)
          x.set(0)
          y.set(0)
        }}
        style={{ x, y }}
        whileDrag={{ opacity: 0.5, scale: 1.05, zIndex: 50 }}
        className={cn(
          "group relative bg-[#1a1a1a] border border-white/5 rounded-lg p-3 mb-2 transition-all hover:border-white/20 hover:bg-[#1f1f1f] cursor-move",
          getPriorityColor(),
          task.status === 'done' && 'opacity-60'
        )}
        onClick={() => setIsSheetOpen(true)}
      >
        {/* Handle para arrastrar */}
        <div
          onPointerDown={(e) => {
            dragControls.start(e)
            e.stopPropagation()
          }}
          className="absolute left-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4 text-white/40" />
        </div>
        {/* Header con badge de estado */}
        <div className="flex items-start justify-between mb-2 pl-6">
          <div className="flex-1">
            {isEditing ? (
              <Input
                ref={titleInputRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={handleSave}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleSave()
                  }
                  if (e.key === 'Escape') {
                    setIsEditing(false)
                    setTitle(task.title)
                  }
                }}
                className="bg-transparent border-none p-0 h-auto text-white font-medium focus-visible:ring-0 focus-visible:outline-none"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <h4 
                className={cn(
                  "text-white font-medium text-sm leading-snug",
                  task.status === 'done' && 'line-through text-white/50'
                )}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  setIsEditing(true)
                }}
              >
                {task.title}
              </h4>
            )}
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <span className={cn(
              "px-2 py-0.5 text-xs rounded-full border",
              statusBadge.color
            )}>
              {statusBadge.label}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setIsSheetOpen(true)
              }}
              className="p-1 hover:bg-white/10 rounded"
            >
              <MoreVertical className="h-4 w-4 text-white/50" />
            </button>
          </div>
        </div>

        {/* Descripción (si existe) */}
        {task.description && (
          <p className="text-xs text-white/50 mb-2 line-clamp-2">
            {task.description}
          </p>
        )}

        {/* Footer con metadata */}
        <div className="flex items-center gap-3 text-xs text-white/40 mt-2">
          {assignedUser && (
            <div className="flex items-center gap-1">
              <div className="w-5 h-5 rounded-full bg-[#FF6600] flex items-center justify-center text-white text-[10px] font-semibold">
                {assignedUser.full_name?.charAt(0).toUpperCase() || assignedUser.email?.charAt(0).toUpperCase() || '?'}
              </div>
            </div>
          )}
          {task.due_date && (
            <div className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              <span>{new Date(task.due_date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</span>
            </div>
          )}
          {commentCount !== undefined && commentCount > 0 && (
            <div className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              <span>{commentCount}</span>
            </div>
          )}
          {priority !== 'low' && (
            <span className={cn(
              "px-1.5 py-0.5 rounded text-xs",
              priority === 'urgent' && 'bg-red-500/20 text-red-400',
              priority === 'high' && 'bg-orange-500/20 text-orange-400',
              priority === 'medium' && 'bg-yellow-500/20 text-yellow-400',
            )}>
              {priority === 'urgent' ? 'Urgente' : priority === 'high' ? 'Alta' : 'Media'}
            </span>
          )}
        </div>
      </motion.div>

      {/* Sheet lateral para editar tarea completa */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent className="bg-[#1a1a1a] border-white/10 w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-white">Editar Tarea</SheetTitle>
          </SheetHeader>
          
          <div className="space-y-6 mt-6">
            {/* Título */}
            <div>
              <label className="text-sm font-medium text-white/70 mb-2 block">
                Título
              </label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Título de la tarea"
                className="bg-[#0a0a0a] border-white/10 text-white"
              />
            </div>

            {/* Descripción */}
            <div>
              <label className="text-sm font-medium text-white/70 mb-2 block">
                Descripción
              </label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Añade una descripción..."
                className="bg-[#0a0a0a] border-white/10 text-white min-h-[120px]"
              />
            </div>

            {/* Estado */}
            <div>
              <label className="text-sm font-medium text-white/70 mb-2 block">
                Estado
              </label>
              <select
                value={task.status}
                onChange={(e) => onStatusChange(task.id, e.target.value as Task['status'])}
                className="w-full h-10 rounded-xl border border-white/10 bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#FF6600] focus:ring-offset-2 focus:border-[#FF6600]"
              >
                <option value="todo">Sin empezar</option>
                <option value="in_progress">En progreso</option>
                <option value="done">Hecho</option>
                <option value="archived">Archivado</option>
              </select>
            </div>

            {/* Prioridad */}
            <div>
              <label className="text-sm font-medium text-white/70 mb-2 block">
                Prioridad
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Task['priority'])}
                className="w-full h-10 rounded-xl border border-white/10 bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#FF6600] focus:ring-offset-2 focus:border-[#FF6600]"
              >
                <option value="low">Baja</option>
                <option value="medium">Media</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </select>
            </div>

            {/* Fecha de vencimiento */}
            <div>
              <label className="text-sm font-medium text-white/70 mb-2 block">
                Fecha de vencimiento
              </label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="bg-[#0a0a0a] border-white/10 text-white"
              />
            </div>

            {/* Asignar a */}
            <div>
              <label className="text-sm font-medium text-white/70 mb-2 block">
                Asignar a
              </label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="w-full h-10 rounded-xl border border-white/10 bg-[#0a0a0a] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#FF6600] focus:ring-offset-2 focus:border-[#FF6600]"
              >
                <option value="">Sin asignar</option>
                {availableUsers.map((user: User) => (
                  <option key={user.id} value={user.id}>
                    {user.full_name || user.email || 'Usuario sin nombre'}
                  </option>
                ))}
              </select>
            </div>

            {/* Comentarios estilo Notion */}
            <div className="border-t border-white/10 pt-6">
              <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Comentarios
              </h3>

              {/* Lista de comentarios */}
              <div className="space-y-4 mb-4 max-h-[400px] overflow-y-auto">
                {isLoadingComments ? (
                  <p className="text-white/50 text-sm">Cargando comentarios...</p>
                ) : comments.length === 0 ? (
                  <p className="text-white/50 text-sm">No hay comentarios aún</p>
                ) : (
                  comments.map((comment) => {
                    const user = comment.profiles || availableUsers.find((u: User) => u.id === comment.user_id)
                    const userName = user?.full_name || user?.email || 'Usuario desconocido'
                    const userInitial = userName.charAt(0).toUpperCase()
                    const isOwner = comment.user_id === currentUserId
                    const isEditing = editingCommentId === comment.id

                    return (
                      <div key={comment.id} className="flex gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#FF6600] flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                          {userInitial}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-white">{userName}</span>
                            <span className="text-xs text-white/40">
                              {new Date(comment.created_at).toLocaleDateString('es-ES', {
                                day: 'numeric',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                              {comment.updated_at !== comment.created_at && (
                                <span className="ml-1">(editado)</span>
                              )}
                            </span>
                            {isOwner && !isEditing && (
                              <button
                                onClick={() => handleStartEditComment(comment)}
                                className="ml-auto text-white/40 hover:text-white transition-colors"
                                title="Editar comentario"
                              >
                                <Edit2 className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                          {isEditing ? (
                            <div className="space-y-2">
                              <Textarea
                                ref={editingCommentInputRef}
                                value={editingCommentContent}
                                onChange={(e) => setEditingCommentContent(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') {
                                    handleCancelEditComment()
                                  }
                                }}
                                className="bg-[#0a0a0a] border-white/10 text-white min-h-[80px] resize-none"
                              />
                              <div className="flex gap-2 justify-end">
                                <Button
                                  onClick={handleCancelEditComment}
                                  variant="outline"
                                  size="sm"
                                  className="border-white/10 text-white/70 hover:bg-white/10"
                                >
                                  Cancelar
                                </Button>
                                <Button
                                  onClick={() => handleUpdateComment(comment.id)}
                                  disabled={!editingCommentContent.trim() || isUpdatingComment}
                                  size="sm"
                                  className="bg-[#FF6600] text-white hover:bg-[#FF6600]/90"
                                >
                                  {isUpdatingComment ? 'Guardando...' : 'Guardar'}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-white/70 whitespace-pre-wrap">{comment.content}</p>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Input para nuevo comentario */}
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-[#FF6600] flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                  {(window as any).__currentUser?.full_name?.charAt(0).toUpperCase() || 
                   (window as any).__currentUser?.email?.charAt(0).toUpperCase() || '?'}
                </div>
                <div className="flex-1">
                  <Textarea
                    ref={commentInputRef}
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleAddComment()
                      }
                    }}
                    placeholder="Añade un comentario..."
                    className="bg-[#0a0a0a] border-white/10 text-white min-h-[80px] resize-none"
                  />
                  <div className="flex justify-end mt-2">
                    <Button
                      onClick={handleAddComment}
                      disabled={!newComment.trim()}
                      size="sm"
                      className="bg-[#FF6600] text-white hover:bg-[#FF6600]/90"
                    >
                      Comentar
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Botones */}
            <div className="flex gap-3 pt-4 border-t border-white/10">
              <Button
                variant="outline"
                onClick={handleDelete}
                className="flex-1 border-red-500/50 text-red-400 hover:bg-red-500/10"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Eliminar
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving || !title.trim()}
                className="flex-1 bg-[#FF6600] text-white hover:bg-[#FF6600]/90"
              >
                {isSaving ? 'Guardando...' : 'Guardar'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

export function ClientDetail({ client, initialTasks, initialMembers = [], allUsers = [], currentUserId, currentUserRole = 'employee' }: ClientDetailProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [members, setMembers] = useState<ClientMember[]>(initialMembers)
  const [availableUsersForClient, setAvailableUsersForClient] = useState<User[]>(allUsers)
  const [isCreating, setIsCreating] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [creatingInColumn, setCreatingInColumn] = useState<'todo' | 'in_progress' | 'done' | null>(null)
  const [taskComments, setTaskComments] = useState<Record<string, number>>({})
  const [activeTab, setActiveTab] = useState('tasks')
  const [documentRows, setDocumentRows] = useState<ClientDocumentRow[]>([])
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false)
  const [uploadingFiles, setUploadingFiles] = useState<Record<string, boolean>>({})
  const [draggingOverRow, setDraggingOverRow] = useState<string | null>(null)
  const [fabricanteModalOpen, setFabricanteModalOpen] = useState<string | null>(null)
  const [fabricanteData, setFabricanteData] = useState<Record<string, FabricanteContactData>>({})
  const [asinSearchQuery, setAsinSearchQuery] = useState('')
  const [invoices, setInvoices] = useState<ClientInvoice[]>([])
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false)
  const [editingInvoice, setEditingInvoice] = useState<ClientInvoice | null>(null)
  const [newInvoiceMonth, setNewInvoiceMonth] = useState(new Date().getMonth() + 1)
  const [newInvoiceYear, setNewInvoiceYear] = useState(new Date().getFullYear())
  const [newInvoiceCoste, setNewInvoiceCoste] = useState('')
  const [newInvoiceComision, setNewInvoiceComision] = useState('')
  const [newInvoiceUrl, setNewInvoiceUrl] = useState('')
  const [privateBrandRows, setPrivateBrandRows] = useState<ClientPrivateBrand[]>([])
  const [isLoadingPrivateBrand, setIsLoadingPrivateBrand] = useState(false)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  // Lista de todos los países
  const allCountries = [
    'Reino Unido',
    'Alemania',
    'Francia',
    'España',
    'Italia',
    'Países Bajos',
    'Suecia',
    'Polonia',
    'Bélgica',
    'Irlanda',
    'USA',
    'México',
    'Canadá'
  ].sort()
  const newTaskInputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  // Opciones para los desplegables
  const motivoOptions = [
    'Advertencias e información de seguridad',
    'Datos de Contacto del Fabricante'
  ]

  const informacionOptions = [
    'Guia de usuario',
    'Hojas de datos para pacientes',
    'Hojas de datos para proveedores',
    'Información de Seguridad',
    'Instrucciones de seguridad',
    'Manual de instalación',
    'Manual del usuario'
  ]

  const idiomaOptions = [
    'Español',
    'Frances',
    'Italiano',
    'Aleman',
    'Ingles',
    'Otro'
  ]

  // Exponer usuarios globalmente para TaskBlock
  useEffect(() => {
    (window as any).__availableUsers = availableUsersForClient
    const currentUser = availableUsersForClient.find(u => u.id === currentUserId)
    if (currentUser) {
      (window as any).__currentUser = currentUser
    }
  }, [availableUsersForClient, currentUserId])

  // Cargar conteo de comentarios por tarea
  useEffect(() => {
    loadCommentsCount()
  }, [tasks])

  // Cargar documentos cuando se cambia a la pestaña de documentos
  useEffect(() => {
    if (activeTab === 'documents') {
      loadDocuments()
    }
  }, [activeTab, client.id])

  // Cargar facturas cuando se cambia a la pestaña de facturas
  useEffect(() => {
    if (activeTab === 'invoices') {
      loadInvoices()
    }
  }, [activeTab, client.id])

  const loadCommentsCount = async () => {
    try {
      const taskIds = tasks.map(t => t.id)
      if (taskIds.length === 0) return

      const { data, error } = await supabase
        .from('task_comments')
        .select('task_id')
        .in('task_id', taskIds)

      if (error) throw error

      const counts: Record<string, number> = {}
      data?.forEach((comment: any) => {
        counts[comment.task_id] = (counts[comment.task_id] || 0) + 1
      })

      setTaskComments(counts)
    } catch (error: any) {
      console.error('Error loading comments count:', error)
    }
  }


  // Obtener usuario asignado para cada tarea
  const getAssignedUser = (task: Task): User | null => {
    if (!task.assigned_to) return null
    return availableUsersForClient.find(u => u.id === task.assigned_to) || null
  }

  // Referencias a las columnas para detectar dónde se suelta
  const todoColumnRef = useRef<HTMLDivElement>(null)
  const inProgressColumnRef = useRef<HTMLDivElement>(null)
  const doneColumnRef = useRef<HTMLDivElement>(null)

  const tasksByStatus = {
    todo: tasks.filter(t => t.status === 'todo').sort((a, b) => (a.position || 0) - (b.position || 0)),
    in_progress: tasks.filter(t => t.status === 'in_progress').sort((a, b) => (a.position || 0) - (b.position || 0)),
    done: tasks.filter(t => t.status === 'done').sort((a, b) => (a.position || 0) - (b.position || 0)),
  }

  const handleCreateTask = async (status: Task['status'] = 'todo') => {
    if (!newTaskTitle.trim()) {
      setCreatingInColumn(null)
      return
    }

    setIsCreating(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('No autenticado')

      const maxPosition = Math.max(...tasks.map(t => t.position || 0), -1)

      const { data, error } = await supabase
        .from('client_tasks')
        .insert({
          client_id: client.id,
          title: newTaskTitle.trim(),
          status: status,
          created_by: user.id,
          position: maxPosition + 1,
        })
        .select()
        .single()

      if (error) throw error

      setTasks([...tasks, data])
      setNewTaskTitle('')
      setCreatingInColumn(null)
      toast.success('Tarea creada')
    } catch (error: any) {
      console.error('Error creating task:', error)
      toast.error(error.message || 'Error al crear tarea')
    } finally {
      setIsCreating(false)
    }
  }

  useEffect(() => {
    if (creatingInColumn && newTaskInputRef.current) {
      newTaskInputRef.current.focus()
    }
  }, [creatingInColumn])

  const handleUpdateTaskStatus = async (taskId: string, newStatus: Task['status']) => {
    try {
      const { error } = await supabase
        .from('client_tasks')
        .update({ status: newStatus })
        .eq('id', taskId)

      if (error) throw error

      setTasks(tasks.map(t => t.id === taskId ? { ...t, status: newStatus } : t))
    } catch (error: any) {
      console.error('Error updating task status:', error)
      toast.error(error.message || 'Error al actualizar estado')
    }
  }

  const handleDragEnd = async (taskId: string, x: number, y: number) => {
    // Determinar en qué columna se soltó basándose en la posición
    const todoRect = todoColumnRef.current?.getBoundingClientRect()
    const inProgressRect = inProgressColumnRef.current?.getBoundingClientRect()
    const doneRect = doneColumnRef.current?.getBoundingClientRect()

    let newStatus: Task['status'] | null = null

    if (todoRect && x >= todoRect.left && x <= todoRect.right && y >= todoRect.top && y <= todoRect.bottom) {
      newStatus = 'todo'
    } else if (inProgressRect && x >= inProgressRect.left && x <= inProgressRect.right && y >= inProgressRect.top && y <= inProgressRect.bottom) {
      newStatus = 'in_progress'
    } else if (doneRect && x >= doneRect.left && x <= doneRect.right && y >= doneRect.top && y <= doneRect.bottom) {
      newStatus = 'done'
    }

    if (newStatus) {
      const task = tasks.find(t => t.id === taskId)
      
      if (task && task.status !== newStatus) {
        // Optimistic update
        setTasks(tasks.map(t => t.id === taskId ? { ...t, status: newStatus } : t))
        
        // Actualizar en la base de datos
        try {
          const { error } = await supabase
            .from('client_tasks')
            .update({ status: newStatus })
            .eq('id', taskId)

          if (error) throw error
        } catch (error: any) {
          console.error('Error updating task status:', error)
          // Revertir cambio
          setTasks(tasks.map(t => t.id === taskId ? { ...t, status: task.status } : t))
          toast.error(error.message || 'Error al mover tarea')
        }
      }
    }
  }

  const handleUpdateTask = (updatedTask: Task) => {
    setTasks(tasks.map(t => t.id === updatedTask.id ? updatedTask : t))
  }

  const handleDeleteTask = (taskId: string) => {
    setTasks(tasks.filter(t => t.id !== taskId))
  }

  const loadDocuments = async () => {
    setIsLoadingDocuments(true)
    try {
      const { data, error } = await supabase
        .from('client_document_rows')
        .select('*')
        .eq('client_id', client.id)
        .order('position', { ascending: true })
        .order('created_at', { ascending: false })

      if (error) throw error

      // Parsear JSONB de pdf_para_subir y informacion_a_rellenar
      const rowsWithParsedFiles = (data || []).map(row => {
        let parsedFiles = []
        try {
          parsedFiles = Array.isArray(row.pdf_para_subir) 
            ? row.pdf_para_subir 
            : (typeof row.pdf_para_subir === 'string' ? JSON.parse(row.pdf_para_subir) : [])
        } catch (e) {
          parsedFiles = []
        }

        // Cargar datos de fabricante si existen
        if (row.motivo === 'Datos de Contacto del Fabricante' && row.informacion_a_rellenar) {
          try {
            const fabricanteDataParsed = JSON.parse(row.informacion_a_rellenar)
            setFabricanteData(prev => ({ ...prev, [row.id]: fabricanteDataParsed }))
          } catch (e) {
            // No es JSON válido, ignorar
          }
        }

        return {
          ...row,
          pdf_para_subir: parsedFiles,
          subido: row.subido ?? false
        }
      })

      setDocumentRows(rowsWithParsedFiles)
    } catch (error: any) {
      console.error('Error loading documents:', error)
      toast.error('Error al cargar documentos')
    } finally {
      setIsLoadingDocuments(false)
    }
  }

  const handleCreateRow = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('No autenticado')

      const maxPosition = documentRows.length > 0 
        ? Math.max(...documentRows.map(r => r.position || 0))
        : -1

      const { data, error } = await supabase
        .from('client_document_rows')
        .insert({
          client_id: client.id,
          position: maxPosition + 1,
          created_by: user.id,
          pdf_para_subir: [],
          subido: false
        })
        .select('*')
        .single()

      if (error) throw error

      setDocumentRows([...documentRows, { ...data, pdf_para_subir: [], subido: false }])
    } catch (error: any) {
      console.error('Error creating row:', error)
      toast.error(error.message || 'Error al crear fila')
    }
  }

  // Función para determinar si una fila está completa
  const isRowComplete = (row: ClientDocumentRow): boolean => {
    // Si el motivo es "Datos de Contacto del Fabricante", solo necesita informacion_a_rellenar
    if (row.motivo === 'Datos de Contacto del Fabricante') {
      return !!row.informacion_a_rellenar
    }
    // Para otros motivos, necesita PDF, Idioma e Información a rellenar (todos)
    const hasPdf = row.pdf_para_subir && row.pdf_para_subir.length > 0
    const hasIdioma = !!row.idioma_pdf
    const hasInformacion = !!row.informacion_a_rellenar
    return hasPdf && hasIdioma && hasInformacion
  }

  const handleUpdateRow = async (rowId: string, field: string, value: any) => {
    try {
      const updateData: any = { [field]: value }
      
      const { error } = await supabase
        .from('client_document_rows')
        .update(updateData)
        .eq('id', rowId)

      if (error) throw error

      setDocumentRows(documentRows.map(row => 
        row.id === rowId ? { ...row, [field]: value } : row
      ))
    } catch (error: any) {
      console.error('Error updating row:', error)
      toast.error('Error al actualizar')
    }
  }

  const handleDeleteRow = async (rowId: string) => {
    try {
      // Eliminar archivos del storage primero
      const row = documentRows.find(r => r.id === rowId)
      if (row && row.pdf_para_subir && row.pdf_para_subir.length > 0) {
        for (const file of row.pdf_para_subir) {
          const fileName = file.url.split('/').pop()
          if (fileName) {
            await supabase.storage
              .from('client-documents')
              .remove([`${rowId}/${fileName}`])
          }
        }
      }

      const { error } = await supabase
        .from('client_document_rows')
        .delete()
        .eq('id', rowId)

      if (error) throw error

      setDocumentRows(documentRows.filter(r => r.id !== rowId))
      toast.success('Fila eliminada')
    } catch (error: any) {
      console.error('Error deleting row:', error)
      toast.error(error.message || 'Error al eliminar fila')
    }
  }

  const handleFileUpload = async (rowId: string, files: FileList) => {
    setUploadingFiles(prev => ({ ...prev, [rowId]: true }))
    
    try {
      const row = documentRows.find(r => r.id === rowId)
      if (!row) throw new Error('Fila no encontrada')

      const uploadedFiles: DocumentFile[] = [...(row.pdf_para_subir || [])]

      for (const file of Array.from(files)) {
        // Validar tipo de archivo
        const isValidType = file.type.startsWith('image/') || 
                           file.type === 'application/pdf' ||
                           file.name.endsWith('.pdf') ||
                           file.name.match(/\.(jpg|jpeg|png|gif|webp)$/i)

        if (!isValidType) {
          toast.error(`El archivo ${file.name} no es una imagen o PDF válido`)
          continue
        }

        const fileExt = file.name.split('.').pop()
        const fileName = `${rowId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`
        
        const { error: uploadError } = await supabase.storage
          .from('client-documents')
          .upload(fileName, file)

        if (uploadError) {
          console.error('Error uploading file:', uploadError)
          toast.error(`Error al subir ${file.name}`)
          continue
        }

        const { data: { publicUrl } } = supabase.storage
          .from('client-documents')
          .getPublicUrl(fileName)

        uploadedFiles.push({
          url: publicUrl,
          name: file.name,
          type: file.type || 'application/pdf'
        })
      }

      // Actualizar la fila con los nuevos archivos
      await handleUpdateRow(rowId, 'pdf_para_subir', uploadedFiles)
      toast.success('Archivos subidos correctamente')
    } catch (error: any) {
      console.error('Error uploading files:', error)
      toast.error(error.message || 'Error al subir archivos')
    } finally {
      setUploadingFiles(prev => ({ ...prev, [rowId]: false }))
    }
  }

  const handleDeleteFile = async (rowId: string, fileIndex: number) => {
    try {
      const row = documentRows.find(r => r.id === rowId)
      if (!row) return

      const file = row.pdf_para_subir[fileIndex]
      const fileName = file.url.split('/').pop()
      
      if (fileName) {
        await supabase.storage
          .from('client-documents')
          .remove([`${rowId}/${fileName}`])
      }

      const updatedFiles = row.pdf_para_subir.filter((_, i) => i !== fileIndex)
      await handleUpdateRow(rowId, 'pdf_para_subir', updatedFiles)
      toast.success('Archivo eliminado')
    } catch (error: any) {
      console.error('Error deleting file:', error)
      toast.error('Error al eliminar archivo')
    }
  }

  const handleSaveFabricanteData = async (rowId: string) => {
    try {
      const data = fabricanteData[rowId]
      if (!data) return

      // Validar campos requeridos
      if (!data.nombre_empresa || !data.correo_principal || !data.direccion_linea1 || !data.localidad || !data.pais) {
        toast.error('Por favor completa todos los campos requeridos')
        return
      }

      // Guardar como JSON en informacion_a_rellenar
      await handleUpdateRow(rowId, 'informacion_a_rellenar', JSON.stringify(data))
      setFabricanteModalOpen(null)
      toast.success('Datos guardados correctamente')
    } catch (error: any) {
      console.error('Error saving fabricante data:', error)
      toast.error('Error al guardar datos')
    }
  }

  // Funciones para gestionar facturas
  const loadInvoices = async () => {
    setIsLoadingInvoices(true)
    try {
      const { data, error } = await supabase
        .from('client_invoices')
        .select('*')
        .eq('client_id', client.id)
        .order('year', { ascending: false })
        .order('month', { ascending: false })

      if (error) throw error

      setInvoices(data || [])
    } catch (error: any) {
      console.error('Error loading invoices:', error)
      toast.error('Error al cargar facturas')
    } finally {
      setIsLoadingInvoices(false)
    }
  }

  const handleCreateInvoice = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('No autenticado')

      if (!newInvoiceCoste || !newInvoiceComision) {
        toast.error('Por favor completa el coste mensual fijo y la comisión')
        return
      }

      const { data, error } = await supabase
        .from('client_invoices')
        .insert({
          client_id: client.id,
          month: newInvoiceMonth,
          year: newInvoiceYear,
          coste_mensual_fijo: parseFloat(newInvoiceCoste),
          comision: parseFloat(newInvoiceComision),
          reporte_url: newInvoiceUrl || null,
          created_by: user.id
        })
        .select('*')
        .single()

      if (error) throw error

      setInvoices([...invoices, data])
      setNewInvoiceMonth(new Date().getMonth() + 1)
      setNewInvoiceYear(new Date().getFullYear())
      setNewInvoiceCoste('')
      setNewInvoiceComision('')
      setNewInvoiceUrl('')
      toast.success('Factura creada correctamente')
    } catch (error: any) {
      console.error('Error creating invoice:', error)
      toast.error(error.message || 'Error al crear factura')
    }
  }

  const handleUpdateInvoice = async (invoice: ClientInvoice) => {
    try {
      const { error } = await supabase
        .from('client_invoices')
        .update({
          month: invoice.month,
          year: invoice.year,
          coste_mensual_fijo: invoice.coste_mensual_fijo,
          comision: invoice.comision,
          reporte_url: invoice.reporte_url
        })
        .eq('id', invoice.id)

      if (error) throw error

      setInvoices(invoices.map(i => i.id === invoice.id ? invoice : i))
      setEditingInvoice(null)
      toast.success('Factura actualizada correctamente')
    } catch (error: any) {
      console.error('Error updating invoice:', error)
      toast.error(error.message || 'Error al actualizar factura')
    }
  }

  const handleDeleteInvoice = async (invoiceId: string) => {
    if (!confirm('¿Estás seguro de que quieres eliminar esta factura?')) return

    try {
      const { error } = await supabase
        .from('client_invoices')
        .delete()
        .eq('id', invoiceId)

      if (error) throw error

      setInvoices(invoices.filter(i => i.id !== invoiceId))
      toast.success('Factura eliminada')
    } catch (error: any) {
      console.error('Error deleting invoice:', error)
      toast.error(error.message || 'Error al eliminar factura')
    }
  }

  const getMonthName = (month: number) => {
    const months = [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ]
    return months[month - 1]
  }

  // Funciones para gestionar checklist de marca privada
  const loadPrivateBrand = async () => {
    setIsLoadingPrivateBrand(true)
    try {
      const { data, error } = await supabase
        .from('client_private_brand')
        .select('*')
        .eq('client_id', client.id)
        .order('position', { ascending: true })
        .order('created_at', { ascending: false })

      if (error) throw error

      setPrivateBrandRows(data || [])
    } catch (error: any) {
      console.error('Error loading private brand:', error)
      toast.error('Error al cargar checklist de marca privada')
    } finally {
      setIsLoadingPrivateBrand(false)
    }
  }

  const handleCreatePrivateBrandRow = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('No autenticado')

      const maxPosition = privateBrandRows.length > 0 
        ? Math.max(...privateBrandRows.map(r => r.position || 0))
        : -1

      const { data, error } = await supabase
        .from('client_private_brand')
        .insert({
          client_id: client.id,
          position: maxPosition + 1,
          created_by: user.id
        })
        .select('*')
        .single()

      if (error) throw error

      setPrivateBrandRows([...privateBrandRows, data])
    } catch (error: any) {
      console.error('Error creating private brand row:', error)
      toast.error(error.message || 'Error al crear fila')
    }
  }

  const handleUpdatePrivateBrandRow = async (rowId: string, field: string, value: any) => {
    try {
      const updateData: any = { [field]: value }
      
      const { error } = await supabase
        .from('client_private_brand')
        .update(updateData)
        .eq('id', rowId)

      if (error) throw error

      setPrivateBrandRows(privateBrandRows.map(row => 
        row.id === rowId ? { ...row, [field]: value } : row
      ))
    } catch (error: any) {
      console.error('Error updating private brand row:', error)
      toast.error('Error al actualizar')
    }
  }

  const handleDeletePrivateBrandRow = async (rowId: string) => {
    if (!confirm('¿Estás seguro de que quieres eliminar esta fila?')) return

    try {
      const { error } = await supabase
        .from('client_private_brand')
        .delete()
        .eq('id', rowId)

      if (error) throw error

      setPrivateBrandRows(privateBrandRows.filter(r => r.id !== rowId))
      toast.success('Fila eliminada')
    } catch (error: any) {
      console.error('Error deleting private brand row:', error)
      toast.error(error.message || 'Error al eliminar fila')
    }
  }

  return (
    <div className="space-y-6 w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 flex-1">
          <Link href="/dashboard/clients">
            <Button variant="ghost" size="sm" className="text-white/70 hover:text-white">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Volver
            </Button>
          </Link>
          <div className="flex-1">
            <h1 className="heading-medium text-white mb-2 flex items-center gap-3">
              {client.icon && <span className="text-2xl">{client.icon}</span>}
              {client.name}
            </h1>
            {client.description && (
              <p className="text-white/50">{client.description}</p>
            )}
          </div>
        </div>
        {/* Avatares de usuarios estilo Notion */}
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            {members.slice(0, 5).map((member) => {
              const user = member.profiles
              const userName = user?.full_name || user?.email || 'Usuario desconocido'
              const userInitial = userName.charAt(0).toUpperCase()
              
              return (
                <div
                  key={member.id}
                  className="w-8 h-8 rounded-full bg-[#FF6600] border-2 border-[#0a0a0a] flex items-center justify-center text-white text-xs font-semibold hover:scale-110 transition-transform cursor-pointer"
                  title={userName}
                >
                  {userInitial}
                </div>
              )
            })}
          </div>
          {members.length > 5 && (
            <div className="w-8 h-8 rounded-full bg-white/10 border-2 border-[#0a0a0a] flex items-center justify-center text-white text-xs font-semibold">
              +{members.length - 5}
            </div>
          )}
        </div>
      </div>

      {/* Separador y Pestañas */}
      <div className="border-t border-white/10 pt-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between gap-4 mb-4">
            <TabsList>
              <TabsTrigger value="tasks">Todo List</TabsTrigger>
              <TabsTrigger value="documents">Cumplimiento de politicas</TabsTrigger>
              <TabsTrigger value="invoices">Facturas</TabsTrigger>
              <TabsTrigger value="private-brand">Marca Privada</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="tasks">
            {/* Kanban Board estilo Notion */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Sin empezar */}
        <div ref={todoColumnRef} className="bg-[#0a0a0a] rounded-lg p-4 min-h-[600px]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-gray-500"></div>
              <h3 className="font-semibold text-white text-sm">Sin empezar</h3>
              <span className="text-xs text-white/40 bg-white/5 px-2 py-0.5 rounded-full">
                {tasksByStatus.todo.length}
              </span>
            </div>
            <button className="text-white/40 hover:text-white p-1">
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2">
            {tasksByStatus.todo.map((task) => (
              <TaskBlock
                key={task.id}
                task={task}
                onUpdate={handleUpdateTask}
                onDelete={handleDeleteTask}
                onStatusChange={handleUpdateTaskStatus}
                onDragEnd={handleDragEnd}
                assignedUser={getAssignedUser(task)}
                commentCount={taskComments[task.id] || 0}
                currentUserId={currentUserId}
              />
            ))}
            {creatingInColumn === 'todo' ? (
              <div className="bg-[#1a1a1a] border border-white/10 rounded-lg p-3 mb-2">
                <Input
                  ref={newTaskInputRef}
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleCreateTask('todo')
                    }
                    if (e.key === 'Escape') {
                      setNewTaskTitle('')
                      setCreatingInColumn(null)
                    }
                  }}
                  onBlur={() => {
                    if (!newTaskTitle.trim()) {
                      setCreatingInColumn(null)
                    }
                  }}
                  placeholder="Título de la tarea..."
                  className="bg-transparent border-none p-0 h-auto text-white text-sm focus-visible:ring-0 focus-visible:outline-none"
                  autoFocus
                />
              </div>
            ) : (
              <button
                onClick={() => setCreatingInColumn('todo')}
                className="w-full p-3 text-left text-white/40 hover:text-white/60 hover:bg-white/5 rounded-lg border border-dashed border-white/10 transition-colors flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                <span className="text-sm">Nuevo proyecto</span>
              </button>
            )}
          </div>
        </div>

        {/* En progreso */}
        <div ref={inProgressColumnRef} className="bg-[#0a0a0a] rounded-lg p-4 min-h-[600px]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-500"></div>
              <h3 className="font-semibold text-white text-sm">En progreso</h3>
              <span className="text-xs text-white/40 bg-white/5 px-2 py-0.5 rounded-full">
                {tasksByStatus.in_progress.length}
              </span>
            </div>
            <button className="text-white/40 hover:text-white p-1">
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2">
            {tasksByStatus.in_progress.map((task) => (
              <TaskBlock
                key={task.id}
                task={task}
                onUpdate={handleUpdateTask}
                onDelete={handleDeleteTask}
                onStatusChange={handleUpdateTaskStatus}
                onDragEnd={handleDragEnd}
                assignedUser={getAssignedUser(task)}
                commentCount={taskComments[task.id] || 0}
                currentUserId={currentUserId}
              />
            ))}
            {creatingInColumn === 'in_progress' ? (
              <div className="bg-[#1a1a1a] border border-white/10 rounded-lg p-3 mb-2">
                <Input
                  ref={newTaskInputRef}
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleCreateTask('in_progress')
                    }
                    if (e.key === 'Escape') {
                      setNewTaskTitle('')
                      setCreatingInColumn(null)
                    }
                  }}
                  onBlur={() => {
                    if (!newTaskTitle.trim()) {
                      setCreatingInColumn(null)
                    }
                  }}
                  placeholder="Título de la tarea..."
                  className="bg-transparent border-none p-0 h-auto text-white text-sm focus-visible:ring-0 focus-visible:outline-none"
                  autoFocus
                />
              </div>
            ) : (
              <button
                onClick={() => setCreatingInColumn('in_progress')}
                className="w-full p-3 text-left text-white/40 hover:text-white/60 hover:bg-white/5 rounded-lg border border-dashed border-white/10 transition-colors flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                <span className="text-sm">Nuevo proyecto</span>
              </button>
            )}
          </div>
        </div>

        {/* Hecho */}
        <div ref={doneColumnRef} className="bg-[#0a0a0a] rounded-lg p-4 min-h-[600px]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500"></div>
              <h3 className="font-semibold text-white text-sm">Hecho</h3>
              <span className="text-xs text-white/40 bg-white/5 px-2 py-0.5 rounded-full">
                {tasksByStatus.done.length}
              </span>
            </div>
            <button className="text-white/40 hover:text-white p-1">
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-2">
            {tasksByStatus.done.map((task) => (
              <TaskBlock
                key={task.id}
                task={task}
                onUpdate={handleUpdateTask}
                onDelete={handleDeleteTask}
                onStatusChange={handleUpdateTaskStatus}
                onDragEnd={handleDragEnd}
                assignedUser={getAssignedUser(task)}
                commentCount={taskComments[task.id] || 0}
                currentUserId={currentUserId}
              />
            ))}
            {creatingInColumn === 'done' ? (
              <div className="bg-[#1a1a1a] border border-white/10 rounded-lg p-3 mb-2">
                <Input
                  ref={newTaskInputRef}
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      handleCreateTask('done')
                    }
                    if (e.key === 'Escape') {
                      setNewTaskTitle('')
                      setCreatingInColumn(null)
                    }
                  }}
                  onBlur={() => {
                    if (!newTaskTitle.trim()) {
                      setCreatingInColumn(null)
                    }
                  }}
                  placeholder="Título de la tarea..."
                  className="bg-transparent border-none p-0 h-auto text-white text-sm focus-visible:ring-0 focus-visible:outline-none"
                  autoFocus
                />
              </div>
            ) : (
              <button
                onClick={() => setCreatingInColumn('done')}
                className="w-full p-3 text-left text-white/40 hover:text-white/60 hover:bg-white/5 rounded-lg border border-dashed border-white/10 transition-colors flex items-center gap-2"
              >
                <Plus className="h-4 w-4" />
                <span className="text-sm">Nuevo proyecto</span>
              </button>
            )}
          </div>
        </div>
      </div>
          </TabsContent>

          <TabsContent value="documents">
            {/* Buscador de ASIN */}
            <div className="mb-4">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-white/50 z-10" />
                <Input
                  type="text"
                  placeholder="Buscar por ASIN..."
                  value={asinSearchQuery}
                  onChange={(e) => setAsinSearchQuery(e.target.value)}
                  className="pl-10 pr-10 input-glass"
                />
                {asinSearchQuery && (
                  <button
                    onClick={() => setAsinSearchQuery('')}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-white/40 hover:text-white transition-colors z-10"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Tabla de documentos estilo Notion/Excel */}
            <div className="glass-card overflow-hidden w-full">
              <div className="overflow-x-auto w-full">
                <table className="w-full border-collapse" style={{ tableLayout: 'auto', minWidth: '100%' }}>
                  <thead>
                    <tr className="border-b border-white/10 bg-[#0a0a0a]">
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 flex-shrink-0" />
                          <span className="truncate">Motivo</span>
                        </div>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 flex-shrink-0" />
                          <span className="truncate">ASIN</span>
                        </div>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 flex-shrink-0" />
                          <span className="truncate">Producto</span>
                        </div>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 flex-shrink-0" />
                          <span className="truncate">Información a rellenar</span>
                        </div>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 flex-shrink-0" />
                          <span className="truncate">PDF para subir</span>
                        </div>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 flex-shrink-0" />
                          <span className="truncate">Idioma PDF</span>
                        </div>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <span className="truncate">Subido</span>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70">
                        <span className="truncate">Acciones</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoadingDocuments ? (
                      <tr>
                        <td colSpan={7} className="p-8 text-center text-white/50 text-sm">
                          Cargando documentos...
                        </td>
                      </tr>
                    ) : documentRows.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="p-8 text-center text-white/50 text-sm">
                          No hay documentos aún. Haz clic en el botón para añadir una fila.
                        </td>
                      </tr>
                    ) : (() => {
                      // Filtrar filas por ASIN si hay búsqueda
                      const filteredRows = asinSearchQuery.trim()
                        ? documentRows.filter(row => 
                            row.asin?.toLowerCase().includes(asinSearchQuery.toLowerCase().trim())
                          )
                        : documentRows

                      if (filteredRows.length === 0 && asinSearchQuery.trim()) {
                        return (
                          <tr key="no-results">
                            <td colSpan={8} className="p-8 text-center text-white/50 text-sm">
                              No se encontraron documentos con el ASIN "{asinSearchQuery}"
                            </td>
                          </tr>
                        )
                      }

                      return filteredRows.map((row) => {
                        const complete = isRowComplete(row)
                        const rowBgColor = row.subido 
                          ? 'bg-green-500/20 hover:bg-green-500/30' 
                          : complete 
                            ? 'bg-yellow-500/20 hover:bg-yellow-500/30' 
                            : 'hover:bg-white/5'
                        
                        return (
                        <tr
                          key={row.id}
                          className={`border-b border-white/10 transition-colors ${rowBgColor}`}
                        >
                          {/* Motivo */}
                          <td className="p-2 border-r border-white/10">
                            <select
                              value={row.motivo || ''}
                              onChange={(e) => {
                                const newMotivo = e.target.value || null
                                handleUpdateRow(row.id, 'motivo', newMotivo)
                                // Si cambia el motivo, limpiar informacion_a_rellenar si no es "Datos de Contacto del Fabricante"
                                if (newMotivo !== 'Datos de Contacto del Fabricante') {
                                  handleUpdateRow(row.id, 'informacion_a_rellenar', null)
                                } else {
                                  // Si es "Datos de Contacto del Fabricante", limpiar PDF e idioma
                                  handleUpdateRow(row.id, 'pdf_para_subir', [])
                                  handleUpdateRow(row.id, 'idioma_pdf', null)
                                }
                              }}
                              className="w-full bg-transparent border-none text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#FF6600] rounded px-2 py-1"
                              title={row.motivo || ''}
                            >
                              <option value="">Seleccionar</option>
                              {motivoOptions.map(opt => (
                                <option key={opt} value={opt} className="bg-[#0a0a0a] text-white">
                                  {opt}
                                </option>
                              ))}
                            </select>
                          </td>

                          {/* ASIN */}
                          <td className="p-2 border-r border-white/10">
                            <Input
                              value={row.asin || ''}
                              onChange={(e) => handleUpdateRow(row.id, 'asin', e.target.value || null)}
                              placeholder="ASIN"
                              className="bg-transparent border-none p-1 h-auto text-white text-sm focus-visible:ring-1 focus-visible:ring-[#FF6600] focus-visible:outline-none w-full"
                            />
                          </td>

                          {/* Producto */}
                          <td className="p-2 border-r border-white/10">
                            <Input
                              value={row.producto || ''}
                              onChange={(e) => handleUpdateRow(row.id, 'producto', e.target.value || null)}
                              placeholder="Producto"
                              className="bg-transparent border-none p-1 h-auto text-white text-sm focus-visible:ring-1 focus-visible:ring-[#FF6600] focus-visible:outline-none w-full"
                            />
                          </td>

                          {/* Información a rellenar */}
                          <td className="p-2 border-r border-white/10">
                            {row.motivo === 'Datos de Contacto del Fabricante' ? (
                              <div className="flex items-center gap-2 flex-wrap">
                                <Button
                                  onClick={() => {
                                    // Cargar datos existentes si hay
                                    const existingData = fabricanteData[row.id]
                                    if (!existingData && row.informacion_a_rellenar) {
                                      try {
                                        const parsed = JSON.parse(row.informacion_a_rellenar)
                                        setFabricanteData(prev => ({ ...prev, [row.id]: parsed }))
                                      } catch (e) {
                                        // Si no es JSON válido, crear objeto vacío
                                        setFabricanteData(prev => ({ ...prev, [row.id]: {
                                          nombre_empresa: '',
                                          correo_principal: '',
                                          correo_secundario: '',
                                          telefono: '',
                                          direccion_linea1: '',
                                          direccion_linea2: '',
                                          localidad: '',
                                          estado_provincia: '',
                                          codigo_postal: '',
                                          pais: ''
                                        }}))
                                      }
                                    } else if (!existingData) {
                                      setFabricanteData(prev => ({ ...prev, [row.id]: {
                                        nombre_empresa: '',
                                        correo_principal: '',
                                        correo_secundario: '',
                                        telefono: '',
                                        direccion_linea1: '',
                                        direccion_linea2: '',
                                        localidad: '',
                                        estado_provincia: '',
                                        codigo_postal: '',
                                        pais: ''
                                      }}))
                                    }
                                    setFabricanteModalOpen(row.id)
                                  }}
                                  size="sm"
                                  className="bg-[#FF6600] text-white hover:bg-[#FF6600]/90 text-xs whitespace-nowrap"
                                >
                                  Rellenar datos
                                </Button>
                                {row.informacion_a_rellenar && (
                                  <span className="text-xs text-green-400 whitespace-nowrap">✓ Completado</span>
                                )}
                              </div>
                            ) : (
                              <select
                                value={row.informacion_a_rellenar || ''}
                                onChange={(e) => handleUpdateRow(row.id, 'informacion_a_rellenar', e.target.value || null)}
                                className="w-full bg-transparent border-none text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#FF6600] rounded px-2 py-1"
                                title={row.informacion_a_rellenar || ''}
                              >
                                <option value="">Selecciona un Medio de Cumplimiento</option>
                                {informacionOptions.map(opt => (
                                  <option key={opt} value={opt} className="bg-[#0a0a0a] text-white">
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>

                          {/* PDF para subir */}
                          <td className="p-2 border-r border-white/10">
                            <div
                              className={`min-h-[60px] border-2 border-dashed rounded-lg p-2 transition-colors ${
                                row.motivo === 'Datos de Contacto del Fabricante'
                                  ? 'border-white/10 bg-white/5 opacity-50 cursor-not-allowed'
                                  : draggingOverRow === row.id
                                  ? 'border-[#FF6600] bg-[#FF6600]/10'
                                  : 'border-white/20 hover:border-white/40'
                              } ${uploadingFiles[row.id] ? 'opacity-50' : ''}`}
                              onDragOver={(e) => {
                                if (row.motivo === 'Datos de Contacto del Fabricante') return
                                e.preventDefault()
                                setDraggingOverRow(row.id)
                              }}
                              onDragLeave={() => {
                                if (row.motivo === 'Datos de Contacto del Fabricante') return
                                setDraggingOverRow(null)
                              }}
                              onDrop={(e) => {
                                if (row.motivo === 'Datos de Contacto del Fabricante') return
                                e.preventDefault()
                                setDraggingOverRow(null)
                                if (e.dataTransfer.files.length > 0) {
                                  handleFileUpload(row.id, e.dataTransfer.files)
                                }
                              }}
                            >
                              {row.pdf_para_subir && row.pdf_para_subir.length > 0 ? (
                                <div className="space-y-1">
                                  {row.pdf_para_subir.map((file, idx) => (
                                    <div key={idx} className="flex items-center gap-2 text-xs text-white/70 bg-white/5 rounded px-2 py-1">
                                      <FileText className="h-3 w-3" />
                                      <span className="flex-1 truncate">{file.name}</span>
                                      <a
                                        href={file.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[#FF6600] hover:underline"
                                      >
                                        Ver
                                      </a>
                                      <button
                                        onClick={() => handleDeleteFile(row.id, idx)}
                                        className="text-red-400 hover:text-red-300"
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-center text-white/40 text-xs py-2">
                                  {uploadingFiles[row.id] ? 'Subiendo...' : (
                                    row.motivo === 'Datos de Contacto del Fabricante' ? (
                                      <>
                                        <div>No es necesario</div>
                                        <div className="text-white/30 text-[10px] mt-1">(arrastra PDFs o imágenes)</div>
                                      </>
                                    ) : (
                                      <>
                                        <div>Arrastra PDFs o imágenes aquí</div>
                                      </>
                                    )
                                  )}
                                </div>
                              )}
                              {row.motivo !== 'Datos de Contacto del Fabricante' && (
                                <>
                                  <input
                                    type="file"
                                    multiple
                                    accept=".pdf,.jpg,.jpeg,.png,.gif,.webp"
                                    onChange={(e) => {
                                      if (e.target.files && e.target.files.length > 0) {
                                        handleFileUpload(row.id, e.target.files)
                                      }
                                    }}
                                    className="hidden"
                                    id={`file-input-${row.id}`}
                                  />
                                  {(!row.pdf_para_subir || row.pdf_para_subir.length === 0) && !uploadingFiles[row.id] && (
                                    <label
                                      htmlFor={`file-input-${row.id}`}
                                      className="cursor-pointer text-xs text-[#FF6600] hover:underline mt-1 block text-center"
                                    >
                                      o haz clic para seleccionar
                                    </label>
                                  )}
                                </>
                              )}
                            </div>
                          </td>

                          {/* Idioma PDF */}
                          <td className="p-2 border-r border-white/10">
                            <select
                              value={row.idioma_pdf || ''}
                              onChange={(e) => handleUpdateRow(row.id, 'idioma_pdf', e.target.value || null)}
                              disabled={row.motivo === 'Datos de Contacto del Fabricante'}
                              className={`w-full bg-transparent border-none text-sm focus:outline-none focus:ring-1 focus:ring-[#FF6600] rounded px-2 py-1 ${
                                row.motivo === 'Datos de Contacto del Fabricante'
                                  ? 'text-white/30 cursor-not-allowed opacity-50'
                                  : 'text-white/50'
                              }`}
                              title={row.idioma_pdf || ''}
                            >
                              <option value="">Seleccionar</option>
                              {idiomaOptions.map(opt => (
                                <option key={opt} value={opt} className="bg-[#0a0a0a] text-white">
                                  {opt}
                                </option>
                              ))}
                            </select>
                          </td>

                          {/* Subido */}
                          <td className="p-2 border-r border-white/10">
                            <button
                              onClick={() => handleUpdateRow(row.id, 'subido', !row.subido)}
                              className="flex items-center justify-center w-6 h-6 rounded-full border-2 transition-all hover:scale-110"
                              style={{
                                borderColor: row.subido ? '#10b981' : '#6b7280',
                                backgroundColor: row.subido ? '#10b981' : 'transparent'
                              }}
                              title={row.subido ? 'Marcado como subido' : 'Marcar como subido'}
                            >
                              {row.subido && (
                                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </button>
                          </td>

                          {/* Acciones */}
                          <td className="p-2">
                            <button
                              onClick={() => handleDeleteRow(row.id)}
                              className="p-1.5 text-white/40 hover:text-red-400 transition-colors"
                              title="Eliminar fila"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      )})
                    })()}
                    
                    {/* Botón para añadir nueva fila */}
                    <tr>
                      <td colSpan={8} className="p-3 border-t border-white/10">
                        <button
                          onClick={handleCreateRow}
                          className="w-full p-3 text-left text-white/40 hover:text-white/60 hover:bg-white/5 rounded-lg border border-dashed border-white/10 transition-colors flex items-center gap-2"
                        >
                          <Plus className="h-4 w-4" />
                          <span className="text-sm">Añadir nueva fila</span>
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="invoices">
            {/* Tabla de facturas */}
            <div className="glass-card overflow-hidden w-full">
              <div className="overflow-x-auto w-full">
                <table className="w-full border-collapse" style={{ tableLayout: 'auto', minWidth: '100%' }}>
                  <thead>
                    <tr className="border-b border-white/10 bg-[#0a0a0a]">
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 flex-shrink-0" />
                          <span>Mes</span>
                        </div>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 flex-shrink-0" />
                          <span>Año</span>
                        </div>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 flex-shrink-0" />
                          <span>Coste Mensual Fijo</span>
                        </div>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 flex-shrink-0" />
                          <span>Comisión</span>
                        </div>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 flex-shrink-0" />
                          <span>URL del Reporte</span>
                        </div>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70">
                        <span>Acciones</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoadingInvoices ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-white/50 text-sm">
                          Cargando facturas...
                        </td>
                      </tr>
                    ) : invoices.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-white/50 text-sm">
                          No hay facturas aún. Añade una nueva factura.
                        </td>
                      </tr>
                    ) : (
                      invoices.map((invoice) => (
                        <tr
                          key={invoice.id}
                          className="border-b border-white/10 hover:bg-white/5 transition-colors"
                        >
                          <td className="p-2 border-r border-white/10">
                            {editingInvoice?.id === invoice.id ? (
                              <select
                                value={editingInvoice.month}
                                onChange={(e) => setEditingInvoice({ ...editingInvoice, month: parseInt(e.target.value) })}
                                className="w-full bg-transparent border-none text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#FF6600] rounded px-2 py-1"
                              >
                                {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                                  <option key={month} value={month} className="bg-[#0a0a0a] text-white">
                                    {getMonthName(month)}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="text-white text-sm px-2 py-1">{getMonthName(invoice.month)}</span>
                            )}
                          </td>
                          <td className="p-2 border-r border-white/10">
                            {editingInvoice?.id === invoice.id ? (
                              <Input
                                type="number"
                                value={editingInvoice.year}
                                onChange={(e) => setEditingInvoice({ ...editingInvoice, year: parseInt(e.target.value) })}
                                className="bg-transparent border-none p-1 h-auto text-white text-sm focus-visible:ring-1 focus-visible:ring-[#FF6600] focus-visible:outline-none w-full"
                              />
                            ) : (
                              <span className="text-white text-sm px-2 py-1">{invoice.year}</span>
                            )}
                          </td>
                          <td className="p-2 border-r border-white/10">
                            {editingInvoice?.id === invoice.id ? (
                              <Input
                                type="number"
                                step="0.01"
                                value={editingInvoice.coste_mensual_fijo}
                                onChange={(e) => setEditingInvoice({ ...editingInvoice, coste_mensual_fijo: parseFloat(e.target.value) || 0 })}
                                className="bg-transparent border-none p-1 h-auto text-white text-sm focus-visible:ring-1 focus-visible:ring-[#FF6600] focus-visible:outline-none w-full"
                              />
                            ) : (
                              <span className="text-white text-sm px-2 py-1">€{invoice.coste_mensual_fijo.toFixed(2)}</span>
                            )}
                          </td>
                          <td className="p-2 border-r border-white/10">
                            {editingInvoice?.id === invoice.id ? (
                              <Input
                                type="number"
                                step="0.01"
                                value={editingInvoice.comision}
                                onChange={(e) => setEditingInvoice({ ...editingInvoice, comision: parseFloat(e.target.value) || 0 })}
                                className="bg-transparent border-none p-1 h-auto text-white text-sm focus-visible:ring-1 focus-visible:ring-[#FF6600] focus-visible:outline-none w-full"
                              />
                            ) : (
                              <span className="text-white text-sm px-2 py-1">€{invoice.comision.toFixed(2)}</span>
                            )}
                          </td>
                          <td className="p-2 border-r border-white/10">
                            {editingInvoice?.id === invoice.id ? (
                              <Input
                                type="url"
                                value={editingInvoice.reporte_url || ''}
                                onChange={(e) => setEditingInvoice({ ...editingInvoice, reporte_url: e.target.value || null })}
                                placeholder="https://..."
                                className="bg-transparent border-none p-1 h-auto text-white text-sm focus-visible:ring-1 focus-visible:ring-[#FF6600] focus-visible:outline-none w-full"
                              />
                            ) : invoice.reporte_url ? (
                              <a
                                href={invoice.reporte_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#FF6600] hover:underline text-sm px-2 py-1 block truncate"
                                title={invoice.reporte_url}
                              >
                                Ver reporte
                              </a>
                            ) : (
                              <span className="text-white/50 text-sm px-2 py-1">-</span>
                            )}
                          </td>
                          <td className="p-2">
                            {editingInvoice?.id === invoice.id ? (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => handleUpdateInvoice(editingInvoice)}
                                  className="p-1.5 text-green-400 hover:text-green-300 transition-colors"
                                  title="Guardar"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => setEditingInvoice(null)}
                                  className="p-1.5 text-white/40 hover:text-white/60 transition-colors"
                                  title="Cancelar"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => setEditingInvoice({ ...invoice })}
                                  className="p-1.5 text-white/40 hover:text-[#FF6600] transition-colors"
                                  title="Editar"
                                >
                                  <Edit2 className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteInvoice(invoice.id)}
                                  className="p-1.5 text-white/40 hover:text-red-400 transition-colors"
                                  title="Eliminar"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                    
                    {/* Fila para añadir nueva factura */}
                    <tr className="border-t border-white/10 bg-white/5">
                      <td className="p-2 border-r border-white/10">
                        <select
                          value={newInvoiceMonth}
                          onChange={(e) => setNewInvoiceMonth(parseInt(e.target.value))}
                          className="w-full bg-transparent border-none text-white text-sm focus:outline-none focus:ring-1 focus:ring-[#FF6600] rounded px-2 py-1"
                        >
                          {Array.from({ length: 12 }, (_, i) => i + 1).map(month => (
                            <option key={month} value={month} className="bg-[#0a0a0a] text-white">
                              {getMonthName(month)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2 border-r border-white/10">
                        <Input
                          type="number"
                          value={newInvoiceYear}
                          onChange={(e) => setNewInvoiceYear(parseInt(e.target.value) || new Date().getFullYear())}
                          placeholder="Año"
                          className="bg-transparent border-none p-1 h-auto text-white text-sm focus-visible:ring-1 focus-visible:ring-[#FF6600] focus-visible:outline-none w-full"
                        />
                      </td>
                      <td className="p-2 border-r border-white/10">
                        <Input
                          type="number"
                          step="0.01"
                          value={newInvoiceCoste}
                          onChange={(e) => setNewInvoiceCoste(e.target.value)}
                          placeholder="0.00"
                          className="bg-transparent border-none p-1 h-auto text-white text-sm focus-visible:ring-1 focus-visible:ring-[#FF6600] focus-visible:outline-none w-full"
                        />
                      </td>
                      <td className="p-2 border-r border-white/10">
                        <Input
                          type="number"
                          step="0.01"
                          value={newInvoiceComision}
                          onChange={(e) => setNewInvoiceComision(e.target.value)}
                          placeholder="0.00"
                          className="bg-transparent border-none p-1 h-auto text-white text-sm focus-visible:ring-1 focus-visible:ring-[#FF6600] focus-visible:outline-none w-full"
                        />
                      </td>
                      <td className="p-2 border-r border-white/10">
                        <Input
                          type="url"
                          value={newInvoiceUrl}
                          onChange={(e) => setNewInvoiceUrl(e.target.value)}
                          placeholder="https://..."
                          className="bg-transparent border-none p-1 h-auto text-white text-sm focus-visible:ring-1 focus-visible:ring-[#FF6600] focus-visible:outline-none w-full"
                        />
                      </td>
                      <td className="p-2">
                        <button
                          onClick={handleCreateInvoice}
                          className="p-1.5 text-[#FF6600] hover:text-[#FF6600]/80 transition-colors"
                          title="Añadir factura"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="private-brand">
            {/* Tabla de checklist de marca privada */}
            <div className="glass-card overflow-hidden w-full">
                <div className="overflow-x-auto w-full">
                <table className="w-full border-collapse" style={{ tableLayout: 'auto', minWidth: '100%' }}>
                  <thead>
                    <tr className="border-b border-white/10 bg-[#0a0a0a]">
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <div className="flex items-center gap-2">
                          <span>País</span>
                          <button
                            onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
                            className="text-white/40 hover:text-white/70 transition-colors"
                            title={sortOrder === 'desc' ? 'Ordenar A-Z' : 'Ordenar Z-A'}
                          >
                            {sortOrder === 'desc' ? '↓' : '↑'}
                          </button>
                        </div>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <span>Nombre</span>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <span>ASIN</span>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <span>B1</span>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <span>B2</span>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <span>B3</span>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <span>B4</span>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <span>B5</span>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <span>Descripción</span>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <span>A+</span>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <span>Fotos 1-7</span>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <span>Video</span>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70 border-r border-white/10">
                        <span>Categoria</span>
                      </th>
                      <th className="text-left p-3 text-sm font-semibold text-white/70">
                        <span>Acciones</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoadingPrivateBrand ? (
                      <tr>
                        <td colSpan={14} className="p-8 text-center text-white/50 text-sm">
                          Cargando checklist...
                        </td>
                      </tr>
                    ) : privateBrandRows.length === 0 ? (
                      <tr>
                        <td colSpan={14} className="p-8 text-center text-white/50 text-sm">
                          No hay elementos aún. Añade una nueva fila.
                        </td>
                      </tr>
                    ) : (
                      [...privateBrandRows]
                        .sort((a, b) => {
                          const aPais = a.pais || ''
                          const bPais = b.pais || ''
                          if (sortOrder === 'desc') {
                            return bPais.localeCompare(aPais)
                          } else {
                            return aPais.localeCompare(bPais)
                          }
                        })
                        .map((row) => (
                        <tr
                          key={row.id}
                          className="border-b border-white/10 hover:bg-white/5 transition-colors"
                        >
                          {/* País */}
                          <td className="p-2 border-r border-white/10">
                            <Select
                              value={row.pais || undefined}
                              onValueChange={(value) => {
                                handleUpdatePrivateBrandRow(row.id, 'pais', value || null)
                              }}
                            >
                              <SelectTrigger 
                                className="w-full h-8 text-xs bg-transparent border-white/10 hover:border-white/20 cursor-pointer"
                                style={{ pointerEvents: 'auto' }}
                              >
                                <SelectValue placeholder="Seleccionar" />
                              </SelectTrigger>
                              <SelectContent className="z-[100]">
                                {allCountries.map((country) => (
                                  <SelectItem key={country} value={country}>
                                    {country}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          {/* Nombre */}
                          <td className="p-2 border-r border-white/10">
                            <Input
                              value={row.nombre || ''}
                              onChange={(e) => handleUpdatePrivateBrandRow(row.id, 'nombre', e.target.value || null)}
                              placeholder="Nombre"
                              className="bg-transparent border-none p-1 h-auto text-white text-sm focus-visible:ring-1 focus-visible:ring-[#FF6600] focus-visible:outline-none w-full"
                            />
                          </td>
                          {/* ASIN */}
                          <td className="p-2 border-r border-white/10">
                            <Input
                              value={row.asin || ''}
                              onChange={(e) => handleUpdatePrivateBrandRow(row.id, 'asin', e.target.value || null)}
                              placeholder="ASIN"
                              className="bg-transparent border-none p-1 h-auto text-white text-sm focus-visible:ring-1 focus-visible:ring-[#FF6600] focus-visible:outline-none w-full"
                            />
                          </td>
                          {/* B1 */}
                          <td className="p-2 border-r border-white/10">
                            <div className="flex items-center justify-center">
                              <button
                                onClick={() => handleUpdatePrivateBrandRow(row.id, 'b1', !row.b1)}
                                className="flex items-center justify-center w-6 h-6 rounded-full border-2 transition-all hover:scale-110"
                                style={{
                                  borderColor: row.b1 ? '#10b981' : '#6b7280',
                                  backgroundColor: row.b1 ? '#10b981' : 'transparent'
                                }}
                              >
                              {row.b1 && (
                                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </button>
                            </div>
                          </td>
                          {/* B2 */}
                          <td className="p-2 border-r border-white/10">
                            <div className="flex items-center justify-center">
                              <button
                                onClick={() => handleUpdatePrivateBrandRow(row.id, 'b2', !row.b2)}
                                className="flex items-center justify-center w-6 h-6 rounded-full border-2 transition-all hover:scale-110"
                                style={{
                                  borderColor: row.b2 ? '#10b981' : '#6b7280',
                                  backgroundColor: row.b2 ? '#10b981' : 'transparent'
                                }}
                              >
                                {row.b2 && (
                                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </button>
                            </div>
                          </td>
                          {/* B3 */}
                          <td className="p-2 border-r border-white/10">
                            <div className="flex items-center justify-center">
                              <button
                                onClick={() => handleUpdatePrivateBrandRow(row.id, 'b3', !row.b3)}
                                className="flex items-center justify-center w-6 h-6 rounded-full border-2 transition-all hover:scale-110"
                                style={{
                                  borderColor: row.b3 ? '#10b981' : '#6b7280',
                                  backgroundColor: row.b3 ? '#10b981' : 'transparent'
                                }}
                              >
                                {row.b3 && (
                                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </button>
                            </div>
                          </td>
                          {/* B4 */}
                          <td className="p-2 border-r border-white/10">
                            <div className="flex items-center justify-center">
                              <button
                                onClick={() => handleUpdatePrivateBrandRow(row.id, 'b4', !row.b4)}
                                className="flex items-center justify-center w-6 h-6 rounded-full border-2 transition-all hover:scale-110"
                                style={{
                                  borderColor: row.b4 ? '#10b981' : '#6b7280',
                                  backgroundColor: row.b4 ? '#10b981' : 'transparent'
                                }}
                              >
                                {row.b4 && (
                                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </button>
                            </div>
                          </td>
                          {/* B5 */}
                          <td className="p-2 border-r border-white/10">
                            <div className="flex items-center justify-center">
                              <button
                                onClick={() => handleUpdatePrivateBrandRow(row.id, 'b5', !row.b5)}
                                className="flex items-center justify-center w-6 h-6 rounded-full border-2 transition-all hover:scale-110"
                                style={{
                                  borderColor: row.b5 ? '#10b981' : '#6b7280',
                                  backgroundColor: row.b5 ? '#10b981' : 'transparent'
                                }}
                              >
                                {row.b5 && (
                                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </button>
                            </div>
                          </td>
                          {/* Descripción */}
                          <td className="p-2 border-r border-white/10">
                            <div className="flex items-center justify-center">
                              <button
                                onClick={() => handleUpdatePrivateBrandRow(row.id, 'descripcion', !row.descripcion)}
                                className="flex items-center justify-center w-6 h-6 rounded-full border-2 transition-all hover:scale-110"
                                style={{
                                  borderColor: row.descripcion ? '#10b981' : '#6b7280',
                                  backgroundColor: row.descripcion ? '#10b981' : 'transparent'
                                }}
                              >
                                {row.descripcion && (
                                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </button>
                            </div>
                          </td>
                          {/* A+ */}
                          <td className="p-2 border-r border-white/10">
                            <div className="flex items-center justify-center">
                              <button
                                onClick={() => handleUpdatePrivateBrandRow(row.id, 'a_plus', !row.a_plus)}
                                className="flex items-center justify-center w-6 h-6 rounded-full border-2 transition-all hover:scale-110"
                                style={{
                                  borderColor: row.a_plus ? '#10b981' : '#6b7280',
                                  backgroundColor: row.a_plus ? '#10b981' : 'transparent'
                                }}
                              >
                                {row.a_plus && (
                                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </button>
                            </div>
                          </td>
                          {/* Fotos 1-7 */}
                          <td className="p-2 border-r border-white/10">
                            <div className="flex items-center justify-center gap-1">
                              {[1, 2, 3, 4, 5, 6, 7].map((num) => {
                                const fieldName = `foto_${num}` as keyof ClientPrivateBrand
                                const isChecked = row[fieldName] as boolean
                                return (
                                  <button
                                    key={num}
                                    onClick={() => handleUpdatePrivateBrandRow(row.id, fieldName, !isChecked)}
                                    className="flex items-center justify-center w-5 h-5 rounded-full border-2 transition-all hover:scale-110"
                                    style={{
                                      borderColor: isChecked ? '#10b981' : '#6b7280',
                                      backgroundColor: isChecked ? '#10b981' : 'transparent'
                                    }}
                                    title={`Foto ${num}`}
                                  >
                                    {isChecked && (
                                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                      </svg>
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                          </td>
                          {/* Video */}
                          <td className="p-2 border-r border-white/10">
                            <div className="flex items-center justify-center">
                              <button
                                onClick={() => handleUpdatePrivateBrandRow(row.id, 'video', !row.video)}
                                className="flex items-center justify-center w-6 h-6 rounded-full border-2 transition-all hover:scale-110"
                                style={{
                                  borderColor: row.video ? '#10b981' : '#6b7280',
                                  backgroundColor: row.video ? '#10b981' : 'transparent'
                                }}
                              >
                                {row.video && (
                                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </button>
                            </div>
                          </td>
                          {/* Categoria */}
                          <td className="p-2 border-r border-white/10">
                            <div className="flex items-center justify-center">
                              <button
                                onClick={() => handleUpdatePrivateBrandRow(row.id, 'categoria', !row.categoria)}
                                className="flex items-center justify-center w-6 h-6 rounded-full border-2 transition-all hover:scale-110"
                                style={{
                                  borderColor: row.categoria ? '#10b981' : '#6b7280',
                                  backgroundColor: row.categoria ? '#10b981' : 'transparent'
                                }}
                              >
                                {row.categoria && (
                                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </button>
                            </div>
                          </td>
                          {/* País */}
                          <td className="p-2 border-r border-white/10">
                            <Select
                              value={row.pais || undefined}
                              onValueChange={(value) => {
                                handleUpdatePrivateBrandRow(row.id, 'pais', value || null)
                              }}
                            >
                              <SelectTrigger 
                                className="w-full h-8 text-xs bg-transparent border-white/10 hover:border-white/20 cursor-pointer"
                                style={{ pointerEvents: 'auto' }}
                              >
                                <SelectValue placeholder="Seleccionar" />
                              </SelectTrigger>
                              <SelectContent className="z-[100]">
                                {allCountries.map((country) => (
                                  <SelectItem key={country} value={country}>
                                    {country}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          {/* Acciones */}
                          <td className="p-2">
                            <button
                              onClick={() => handleDeletePrivateBrandRow(row.id)}
                              className="p-1.5 text-white/40 hover:text-red-400 transition-colors"
                              title="Eliminar fila"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                    
                    {/* Botón para añadir nueva fila */}
                    <tr>
                      <td colSpan={14} className="p-3 border-t border-white/10">
                        <button
                          onClick={handleCreatePrivateBrandRow}
                          className="w-full p-3 text-left text-white/40 hover:text-white/60 hover:bg-white/5 rounded-lg border border-dashed border-white/10 transition-colors flex items-center gap-2"
                        >
                          <Plus className="h-4 w-4" />
                          <span className="text-sm">Añadir nueva fila</span>
                        </button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

          </TabsContent>
        </Tabs>
      </div>

      {/* Modal de Datos de Contacto del Fabricante */}
      {fabricanteModalOpen && (
        <div 
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setFabricanteModalOpen(null)
            }
          }}
        >
          <div 
            className="glass-card p-6 max-w-5xl w-full my-auto rounded-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold text-white">Datos de Contacto del Fabricante</h2>
              <button
                onClick={() => setFabricanteModalOpen(null)}
                className="text-white/40 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[70vh] overflow-y-auto pr-2">
              {/* Nombre o empresa */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Nombre o empresa <span className="text-red-400">*</span>
                </label>
                <Input
                  value={fabricanteData[fabricanteModalOpen]?.nombre_empresa || ''}
                  onChange={(e) => setFabricanteData(prev => ({
                    ...prev,
                    [fabricanteModalOpen]: { 
                      ...(prev[fabricanteModalOpen] || {
                        nombre_empresa: '',
                        correo_principal: '',
                        correo_secundario: '',
                        telefono: '',
                        direccion_linea1: '',
                        direccion_linea2: '',
                        localidad: '',
                        estado_provincia: '',
                        codigo_postal: '',
                        pais: ''
                      }), 
                      nombre_empresa: e.target.value 
                    }
                  }))}
                  placeholder="Introduce el nombre o empresa"
                  className="input-glass"
                />
              </div>

              {/* Correo electrónico o URL principal */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Correo electrónico o URL principal <span className="text-red-400">*</span>
                </label>
                <Input
                  value={fabricanteData[fabricanteModalOpen]?.correo_principal || ''}
                  onChange={(e) => setFabricanteData(prev => ({
                    ...prev,
                    [fabricanteModalOpen]: { 
                      ...(prev[fabricanteModalOpen] || {
                        nombre_empresa: '',
                        correo_principal: '',
                        correo_secundario: '',
                        telefono: '',
                        direccion_linea1: '',
                        direccion_linea2: '',
                        localidad: '',
                        estado_provincia: '',
                        codigo_postal: '',
                        pais: ''
                      }), 
                      correo_principal: e.target.value 
                    }
                  }))}
                  placeholder="Introduce la dirección de correo electrónico o URL (sin espacios iniciales)"
                  className="input-glass"
                />
              </div>

              {/* Correo electrónico o URL secundario */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Correo electrónico o URL secundario (opcional)
                </label>
                <Input
                  value={fabricanteData[fabricanteModalOpen]?.correo_secundario || ''}
                  onChange={(e) => setFabricanteData(prev => ({
                    ...prev,
                    [fabricanteModalOpen]: { 
                      ...(prev[fabricanteModalOpen] || {
                        nombre_empresa: '',
                        correo_principal: '',
                        correo_secundario: '',
                        telefono: '',
                        direccion_linea1: '',
                        direccion_linea2: '',
                        localidad: '',
                        estado_provincia: '',
                        codigo_postal: '',
                        pais: ''
                      }), 
                      correo_secundario: e.target.value 
                    }
                  }))}
                  placeholder="Introduce la dirección de correo electrónico o URL (sin espacios iniciales)"
                  className="input-glass"
                />
              </div>

              {/* Número de teléfono */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Número de teléfono (opcional)
                </label>
                <Input
                  value={fabricanteData[fabricanteModalOpen]?.telefono || ''}
                  onChange={(e) => setFabricanteData(prev => ({
                    ...prev,
                    [fabricanteModalOpen]: { 
                      ...(prev[fabricanteModalOpen] || {
                        nombre_empresa: '',
                        correo_principal: '',
                        correo_secundario: '',
                        telefono: '',
                        direccion_linea1: '',
                        direccion_linea2: '',
                        localidad: '',
                        estado_provincia: '',
                        codigo_postal: '',
                        pais: ''
                      }), 
                      telefono: e.target.value 
                    }
                  }))}
                  placeholder="Número de teléfono que empiece con el código de marcación internacional"
                  className="input-glass"
                />
              </div>

              {/* Línea de dirección 1 */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Línea de dirección 1 <span className="text-red-400">*</span>
                </label>
                <Input
                  value={fabricanteData[fabricanteModalOpen]?.direccion_linea1 || ''}
                  onChange={(e) => setFabricanteData(prev => ({
                    ...prev,
                    [fabricanteModalOpen]: { 
                      ...(prev[fabricanteModalOpen] || {
                        nombre_empresa: '',
                        correo_principal: '',
                        correo_secundario: '',
                        telefono: '',
                        direccion_linea1: '',
                        direccion_linea2: '',
                        localidad: '',
                        estado_provincia: '',
                        codigo_postal: '',
                        pais: ''
                      }), 
                      direccion_linea1: e.target.value 
                    }
                  }))}
                  placeholder="Dirección postal, nombre de la empresa o dirección temporal"
                  className="input-glass"
                />
              </div>

              {/* Línea de dirección 2 */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Línea de dirección 2 (opcional)
                </label>
                <Input
                  value={fabricanteData[fabricanteModalOpen]?.direccion_linea2 || ''}
                  onChange={(e) => setFabricanteData(prev => ({
                    ...prev,
                    [fabricanteModalOpen]: { 
                      ...(prev[fabricanteModalOpen] || {
                        nombre_empresa: '',
                        correo_principal: '',
                        correo_secundario: '',
                        telefono: '',
                        direccion_linea1: '',
                        direccion_linea2: '',
                        localidad: '',
                        estado_provincia: '',
                        codigo_postal: '',
                        pais: ''
                      }), 
                      direccion_linea2: e.target.value 
                    }
                  }))}
                  placeholder="Apartamento, suite, unidad o piso"
                  className="input-glass"
                />
              </div>

              {/* Localidad */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Localidad <span className="text-red-400">*</span>
                </label>
                <Input
                  value={fabricanteData[fabricanteModalOpen]?.localidad || ''}
                  onChange={(e) => setFabricanteData(prev => ({
                    ...prev,
                    [fabricanteModalOpen]: { 
                      ...(prev[fabricanteModalOpen] || {
                        nombre_empresa: '',
                        correo_principal: '',
                        correo_secundario: '',
                        telefono: '',
                        direccion_linea1: '',
                        direccion_linea2: '',
                        localidad: '',
                        estado_provincia: '',
                        codigo_postal: '',
                        pais: ''
                      }), 
                      localidad: e.target.value 
                    }
                  }))}
                  placeholder="Introduce el nombre de la localidad"
                  className="input-glass"
                />
              </div>

              {/* Estado, región o provincia */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Estado, región o provincia
                </label>
                <Input
                  value={fabricanteData[fabricanteModalOpen]?.estado_provincia || ''}
                  onChange={(e) => setFabricanteData(prev => ({
                    ...prev,
                    [fabricanteModalOpen]: { 
                      ...(prev[fabricanteModalOpen] || {
                        nombre_empresa: '',
                        correo_principal: '',
                        correo_secundario: '',
                        telefono: '',
                        direccion_linea1: '',
                        direccion_linea2: '',
                        localidad: '',
                        estado_provincia: '',
                        codigo_postal: '',
                        pais: ''
                      }), 
                      estado_provincia: e.target.value 
                    }
                  }))}
                  placeholder="Introduce el estado, región o provincia, si procede"
                  className="input-glass"
                />
              </div>

              {/* Código postal */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  Código postal (opcional)
                </label>
                <Input
                  value={fabricanteData[fabricanteModalOpen]?.codigo_postal || ''}
                  onChange={(e) => setFabricanteData(prev => ({
                    ...prev,
                    [fabricanteModalOpen]: { 
                      ...(prev[fabricanteModalOpen] || {
                        nombre_empresa: '',
                        correo_principal: '',
                        correo_secundario: '',
                        telefono: '',
                        direccion_linea1: '',
                        direccion_linea2: '',
                        localidad: '',
                        estado_provincia: '',
                        codigo_postal: '',
                        pais: ''
                      }), 
                      codigo_postal: e.target.value 
                    }
                  }))}
                  placeholder="Introduce el código postal"
                  className="input-glass"
                />
              </div>

              {/* País */}
              <div>
                <label className="block text-sm font-medium text-white/70 mb-2">
                  País <span className="text-red-400">*</span>
                </label>
                <Input
                  value={fabricanteData[fabricanteModalOpen]?.pais || ''}
                  onChange={(e) => setFabricanteData(prev => ({
                    ...prev,
                    [fabricanteModalOpen]: { 
                      ...(prev[fabricanteModalOpen] || {
                        nombre_empresa: '',
                        correo_principal: '',
                        correo_secundario: '',
                        telefono: '',
                        direccion_linea1: '',
                        direccion_linea2: '',
                        localidad: '',
                        estado_provincia: '',
                        codigo_postal: '',
                        pais: ''
                      }), 
                      pais: e.target.value 
                    }
                  }))}
                  placeholder="Seleccionar"
                  className="input-glass"
                />
              </div>
            </div>
            </div>

            <div className="flex gap-3 mt-6">
              <Button
                onClick={() => setFabricanteModalOpen(null)}
                variant="outline"
                className="flex-1 border-white/10 text-white/70 hover:bg-white/10"
              >
                Cancelar
              </Button>
              <Button
                onClick={() => handleSaveFabricanteData(fabricanteModalOpen)}
                className="flex-1 bg-[#FF6600] text-white hover:bg-[#FF6600]/90"
              >
                Guardar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
