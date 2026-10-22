'use client'

import { useState, useEffect, useCallback, useSyncExternalStore } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { equipoSilenciado, silenciarEquipo, suscribirPreferenciasDeAvisos } from '@/lib/avisos/preferencias'
import { cn } from '@/lib/utils'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'

interface Notification {
  id: string
  type: string
  title: string
  message: string | null
  related_task_id: string | null
  related_client_id: string | null
  read: boolean
  created_at: string
}

/**
 * LA CAMPANA DE NOTIFICACIONES, EN LA BARRA LATERAL.
 *
 * Es una fila más del menú («Notificaciones» con el número de las que faltan por leer) y, con la barra plegada, un icono con la bolita. Antes
 * era un botón fijo arriba a la derecha de toda la pantalla y se montaba encima del contenido. El panel se abre HACIA ARRIBA desde la
 * campana, alineado con su borde izquierdo, y se encoge en pantallas estrechas para no salirse.
 */
export function NotificationsBell({ colapsado = false }: { colapsado?: boolean }) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()
  // Los avisos del equipo (hitos de llamadas, citas agendadas) se pueden silenciar desde aquí: son una celebración, no una obligación
  const silenciados = useSyncExternalStore(suscribirPreferenciasDeAvisos, equipoSilenciado, () => false)

  useEffect(() => {
    let mounted = true
    let channel: any = null

    const setupNotifications = async () => {
      await loadNotifications()
      
      if (!mounted) return

      // Obtener el usuario actual para filtrar notificaciones
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Suscribirse a nuevas notificaciones solo para este usuario
      channel = supabase
        .channel(`notifications-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            if (mounted) {
              loadNotifications() // Recargar para evitar duplicados
            }
          }
        )
        .subscribe()
    }

    setupNotifications()

    return () => {
      mounted = false
      if (channel) {
        supabase.removeChannel(channel)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadNotifications = useCallback(async () => {
    try {
      setLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) throw error

      setNotifications(data || [])
      setUnreadCount((data || []).filter(n => !n.read).length)
    } catch (error) {
      console.error('Error loading notifications:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  const markAsRead = async (notificationId: string) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', notificationId)

      if (error) throw error

      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
      )
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch (error) {
      console.error('Error marking notification as read:', error)
    }
  }

  const markAllAsRead = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', user.id)
        .eq('read', false)

      if (error) throw error

      setNotifications(prev => prev.map(n => ({ ...n, read: true })))
      setUnreadCount(0)
    } catch (error) {
      console.error('Error marking all as read:', error)
    }
  }

  const getNotificationLink = (notification: Notification) => {
    // Link para notificaciones de web leads
    if (notification.type === 'web_lead') {
      return '/dashboard/web-leads'
    }

    // Un envío detenido o un fichero que no se ha podido procesar: lleva a la
    // pantalla donde está el historial con el motivo. Un aviso que dice que algo
    // se ha parado y no dice dónde mirarlo obliga a buscarlo, y entonces se
    // termina no mirando.
    if (notification.type === 'freno_stock' || notification.type === 'fallo_stock') {
      return '/dashboard/amazon-api'
    }

    if (notification.related_client_id && notification.related_task_id) {
      return `/dashboard/clients/${notification.related_client_id}`
    }
    if (notification.related_client_id) {
      return `/dashboard/clients/${notification.related_client_id}`
    }
    return null
  }

  const etiquetaDeCuenta = unreadCount > 9 ? '9+' : String(unreadCount)

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={colapsado ? 'Notificaciones' : undefined}
          aria-label={unreadCount > 0 ? `Notificaciones: ${unreadCount} sin leer` : 'Notificaciones'}
          className={cn(
            'relative flex h-10 items-center rounded-xl text-white/70 transition-colors hover:bg-white/[0.05] hover:text-white',
            colapsado ? 'w-10 justify-center' : 'min-w-0 flex-1 gap-3 px-3',
            isOpen && 'bg-white/[0.05] text-white'
          )}
        >
          <Bell className="h-5 w-5 flex-shrink-0" />
          {!colapsado && <span className="flex-1 truncate text-left text-sm font-medium">Notificaciones</span>}
          {unreadCount > 0 &&
            (colapsado ? (
              <span className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-[#FF6600] text-[10px] font-semibold text-white">{etiquetaDeCuenta}</span>
            ) : (
              <span className="rounded-full bg-[#FF6600] px-2 py-0.5 text-xs text-white">{etiquetaDeCuenta}</span>
            ))}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(20rem,calc(100vw-1.5rem))] bg-[#1a1a1a] border-white/10 p-0"
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={12}
      >
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          <h3 className="font-semibold text-white">Notificaciones</h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={markAllAsRead}
              className="text-xs text-white/60 hover:text-white"
            >
              Marcar todas como leídas
            </Button>
          )}
        </div>
        <div className="max-h-[400px] overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-white/50 text-sm">
              Cargando...
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-4 text-center text-white/50 text-sm">
              No hay notificaciones
            </div>
          ) : (
            <div className="divide-y divide-white/10">
              {notifications.map((notification) => {
                const link = getNotificationLink(notification)
                const NotificationContent = (
                  <div
                    className={cn(
                      "p-4 hover:bg-white/5 transition-colors cursor-pointer",
                      !notification.read && "bg-[#FF6600]/10"
                    )}
                    onClick={() => {
                      if (!notification.read) {
                        markAsRead(notification.id)
                      }
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn(
                        "w-2 h-2 rounded-full mt-2 flex-shrink-0",
                        !notification.read ? "bg-[#FF6600]" : "bg-transparent"
                      )} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white mb-1">
                          {notification.title}
                        </p>
                        {notification.message && (
                          <p className="text-xs text-white/60 mb-2 line-clamp-2">
                            {notification.message}
                          </p>
                        )}
                        <p className="text-xs text-white/40">
                          {formatDistanceToNow(new Date(notification.created_at), {
                            addSuffix: true,
                            locale: es
                          })}
                        </p>
                      </div>
                    </div>
                  </div>
                )

                if (link) {
                  return (
                    <Link key={notification.id} href={link}>
                      {NotificationContent}
                    </Link>
                  )
                }

                return (
                  <div key={notification.id}>
                    {NotificationContent}
                  </div>
                )
              })}
            </div>
          )}
        </div>
        <div className="border-t border-white/10 p-2">
          <button
            type="button"
            onClick={() => silenciarEquipo(!silenciados)}
            aria-pressed={silenciados}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-white/60 transition-colors hover:bg-white/5 hover:text-white"
          >
            {silenciados ? <BellOff className="h-3.5 w-3.5 shrink-0" /> : <Bell className="h-3.5 w-3.5 shrink-0" />}
            <span className="flex-1">{silenciados ? 'Avisos del equipo silenciados' : 'Avisos del equipo: llamadas y citas'}</span>
            <span className="text-white/40">{silenciados ? 'Activar' : 'Silenciar'}</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

