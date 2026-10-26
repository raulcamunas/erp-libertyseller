'use client'

import { useState, useEffect, useCallback, useRef, useSyncExternalStore, type CSSProperties } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { equipoSilenciado, silenciarEquipo, suscribirPreferenciasDeAvisos } from '@/lib/avisos/preferencias'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
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

    // Un buzón sin conexión, el motor de seguimientos parado, envíos fallidos o rebotes de más: el mensaje dice qué pasa, y esto lleva a Correo
    // (Secuencias → Salud lo enseña con todo detalle)
    if (notification.type === 'alarma_correo') {
      return '/dashboard/correo'
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

  // La campana suena cuando llega un aviso nuevo (no cuando se lee uno): cada vez que sube la cuenta cambia la clave del icono y el CSS repite el movimiento.
  // Con avisos sin leer ya al cargar suena una vez.
  const cuentaAntes = useRef(0)
  const [sonidos, setSonidos] = useState(0)
  useEffect(() => {
    if (unreadCount > cuentaAntes.current) setSonidos((n) => n + 1)
    cuentaAntes.current = unreadCount
  }, [unreadCount])

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={colapsado ? 'Notificaciones' : undefined}
          aria-label={unreadCount > 0 ? `Notificaciones: ${unreadCount} sin leer` : 'Notificaciones'}
          className="lat-accion lat-campana"
          data-hay={unreadCount > 0 ? 'true' : undefined}
          data-abierto={isOpen ? 'true' : undefined}
        >
          <span className="lat-icono">
            <Bell key={sonidos} className="lat-icono-svg lat-campana-icono" aria-hidden />
          </span>
          <span className="lat-texto">Notificaciones</span>
          {unreadCount > 0 && (
            <span key={etiquetaDeCuenta} className="lat-insignia lat-insignia-viva">
              {etiquetaDeCuenta}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="lat-avisos" side="top" align="start" sideOffset={10} collisionPadding={12}>
        <div className="lat-avisos-cab">
          <h3 className="lat-avisos-titulo">
            Notificaciones
            {unreadCount > 0 && <span className="lat-avisos-cuenta">{unreadCount} sin leer</span>}
          </h3>
          {unreadCount > 0 && (
            <button type="button" onClick={markAllAsRead} className="lat-avisos-todas" title="Marcar todas como leídas" aria-label="Marcar todas como leídas">
              Marcar todas
            </button>
          )}
        </div>
        <div className="lat-avisos-lista">
          {loading ? (
            <p className="lat-avisos-vacio">Cargando…</p>
          ) : notifications.length === 0 ? (
            <div className="lat-avisos-vacio">
              <span className="lat-avisos-vacio-icono">
                <Bell className="h-5 w-5" aria-hidden />
              </span>
              <p className="lat-avisos-vacio-titulo">Todo al día</p>
              <p>No hay notificaciones.</p>
            </div>
          ) : (
            notifications.map((notification, i) => {
              const link = getNotificationLink(notification)
              const NotificationContent = (
                <div
                  className="lat-aviso"
                  data-sin-leer={!notification.read ? 'true' : undefined}
                  style={{ '--i': i } as CSSProperties}
                  onClick={() => {
                    if (!notification.read) {
                      markAsRead(notification.id)
                    }
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="lat-aviso-titulo">{notification.title}</p>
                    {notification.message && <p className="lat-aviso-texto">{notification.message}</p>}
                    <p className="lat-aviso-hora">
                      {formatDistanceToNow(new Date(notification.created_at), {
                        addSuffix: true,
                        locale: es
                      })}
                    </p>
                  </div>
                  {!notification.read && <span className="lat-aviso-punto" aria-label="Sin leer" />}
                </div>
              )

              if (link) {
                return (
                  <Link key={notification.id} href={link}>
                    {NotificationContent}
                  </Link>
                )
              }

              return <div key={notification.id}>{NotificationContent}</div>
            })
          )}
        </div>
        <div className="lat-avisos-pie">
          <button type="button" onClick={() => silenciarEquipo(!silenciados)} aria-pressed={silenciados} className="lat-avisos-silencio">
            {silenciados ? <BellOff className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <Bell className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            <span className="flex-1">{silenciados ? 'Avisos del equipo silenciados' : 'Avisos del equipo: llamadas y citas'}</span>
            <span className="lat-avisos-silencio-accion">{silenciados ? 'Activar' : 'Silenciar'}</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

