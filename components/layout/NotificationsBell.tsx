'use client'

import { useState, useEffect, useCallback, useRef, useSyncExternalStore, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Bell, BellOff, BellRing, Boxes, CheckSquare, CirclePause, CircleSlash, Flame, Globe, HeartPulse, Mail, MailX, MessageSquare, Volume2, VolumeX, type LucideIcon } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { chatALaVista } from '@/lib/chat/dock-estado'
import { pastillaDelChatVisible, publicarVistaPrevia } from '@/lib/chat/vista-previa'
import { equipoSilenciado, silenciarEquipo, suscribirPreferenciasDeAvisos } from '@/lib/avisos/preferencias'
import { publicarAviso } from '@/lib/avisos/pila'
import { abrirDialogoDeSonidos } from '@/lib/sonidos/dialogo'
import { ponerSonidoDeCorreo, probarSonido, sonarCorreo, sonidoDeCorreoActivo, suscribirSonido } from '@/lib/avisos/sonido'
import { activarEscritorio, avisarEnEscritorio, desactivarEscritorio, escritorioActivo, escritorioDenegado, escritorioDisponible, ficheroDeSonidoDeTarea, ponerSonidoDeTareas, probarSonidoDeTarea, sonarTarea, sonidoDeTareasActivo, suscribirSonidoDeTareas } from '@/lib/avisos/sonido-tareas'
import { destinoDeAvisoDeCorreo, type DestinoDeAviso } from '@/lib/correo/campana-tipos'
import { pedirAlCorreo } from '@/lib/correo/peticiones'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import Link from 'next/link'
import { AvisosPush } from '@/components/push/AvisosPush'
import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'

interface Notification {
  id: string
  type: string
  title: string
  message: string | null
  related_task_id: string | null
  related_client_id: string | null
  /** De dónde es el aviso (migración 251): los de correo lo usan para llevarte a su conversación o a su secuencia */
  datos?: unknown
  read: boolean
  created_at: string
}

/** Cuántos avisos se enseñan: los más recientes. El número de sin leer sale de una cuenta aparte, así que no depende de este tope */
const AVISOS_A_ENSENAR = 30
/** Las altas y los cambios llegan a ráfagas (marcar todo como leído son N cambios): se espera un poco y se recarga una sola vez */
const ESPERA_ANTES_DE_RECARGAR_MS = 400

type Tono = 'acc' | 'verde' | 'ambar' | 'rojo' | 'neutro'

/** El icono y el color de cada tipo de aviso: así se distingue de un vistazo un correo de un fallo */
const ICONOS_DE_AVISO: Record<string, { Icono: LucideIcon; tono: Tono }> = {
  correo_nuevo: { Icono: Mail, tono: 'acc' },
  correo_rebote: { Icono: MailX, tono: 'rojo' },
  secuencia_pausada: { Icono: CirclePause, tono: 'ambar' },
  secuencia_parada: { Icono: CircleSlash, tono: 'rojo' },
  respuesta_lead: { Icono: Flame, tono: 'verde' },
  alarma_correo: { Icono: HeartPulse, tono: 'ambar' },
  web_lead: { Icono: Globe, tono: 'acc' },
  freno_stock: { Icono: AlertTriangle, tono: 'ambar' },
  fallo_stock: { Icono: AlertTriangle, tono: 'rojo' },
  fallo_amazon: { Icono: AlertTriangle, tono: 'rojo' },
  job_amazon: { Icono: AlertTriangle, tono: 'ambar' },
  fba_alerta: { Icono: Boxes, tono: 'ambar' },
  fba_resumen: { Icono: Boxes, tono: 'acc' },
  comment: { Icono: MessageSquare, tono: 'neutro' },
  mention: { Icono: MessageSquare, tono: 'acc' },
  task_assigned: { Icono: CheckSquare, tono: 'neutro' },
  task_updated: { Icono: CheckSquare, tono: 'neutro' },
}
const iconoDeAviso = (tipo: string, datos?: unknown) => {
  // Los recordatorios de fecha de las tareas viajan como `task_updated` con su motivo dentro: se distinguen por él
  const motivo = (datos as { motivo?: string } | null | undefined)?.motivo
  if (motivo === 'vencidas') return { Icono: Flame, tono: 'rojo' as Tono }
  if (motivo === 'vence') return { Icono: AlertTriangle, tono: 'ambar' as Tono }
  return ICONOS_DE_AVISO[tipo] ?? { Icono: Bell, tono: 'neutro' as Tono }
}

/**
 * LA CAMPANA DE NOTIFICACIONES, EN LA BARRA LATERAL.
 *
 * Es una fila más del menú («Notificaciones» con el número de las que faltan por leer) y, con la barra plegada, un icono con la bolita. Antes
 * era un botón fijo arriba a la derecha de toda la pantalla y se montaba encima del contenido. El panel se abre HACIA ARRIBA desde la
 * campana, alineado con su borde izquierdo, y se encoge en pantallas estrechas para no salirse.
 *
 * LOS AVISOS DE CORREO (migración 251) son de cada persona y de lo suyo: un correo nuevo, un correo que rebota, un seguimiento que se ha pausado o parado,
 * un lead que contesta algo que hay que atender. Al pulsarlos llevan a su sitio SIN recargar nada: abren esa conversación en Correo, o esa secuencia en
 * Correo → Secuencias (lib/correo/peticiones.ts, el mismo camino que el aviso de «correo nuevo» de abajo a la derecha). Escribirlos es cosa del servidor
 * (lib/correo/campana-servidor.ts); aquí solo se pintan. Los de antes (leads web, Amazon, alarmas) funcionan igual que siempre.
 */
export function NotificationsBell({ colapsado = false, conTareas = false }: { colapsado?: boolean; conTareas?: boolean }) {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()
  // Los avisos del equipo (hitos de llamadas, citas agendadas) se pueden silenciar desde aquí: son una celebración, no una obligación
  const silenciados = useSyncExternalStore(suscribirPreferenciasDeAvisos, equipoSilenciado, () => false)
  // El sonido suave que avisa de un correo nuevo (lib/avisos/sonido.ts): suena aunque el ERP esté en segundo plano
  const sonidoActivo = useSyncExternalStore(suscribirSonido, sonidoDeCorreoActivo, () => true)
  const [pruebaDeSonido, setPruebaDeSonido] = useState<'' | 'bloqueado' | 'sin_audio'>('')
  // Lo mismo para los avisos de tareas: su sonido (que puede ser un fichero propio en public/sonidos/) y las notificaciones del escritorio
  const sonidoDeTareas = useSyncExternalStore(suscribirSonidoDeTareas, sonidoDeTareasActivo, () => true)
  const escritorio = useSyncExternalStore(suscribirSonidoDeTareas, escritorioActivo, () => false)
  const [notaDeTareas, setNotaDeTareas] = useState('')
  const [ficheroPropio, setFicheroPropio] = useState<string | null>(null)
  useEffect(() => {
    if (conTareas) void ficheroDeSonidoDeTarea().then(setFicheroPropio)
  }, [conTareas])

  // Al abrir el ERP y cada media hora: se crean las tareas que se repiten y el servidor genera los recordatorios de fecha de esta persona (vence hoy, vence mañana, vencidas)
  useEffect(() => {
    if (!conTareas) return
    // Primero las tareas que se repiten (las de hoy se crean), y después los recordatorios, que ya cuentan con ellas
    const pedir = () =>
      void fetch('/api/tareas-clientes/plantillas/ejecutar', { method: 'POST' })
        .catch(() => undefined)
        .then(() => fetch('/api/tareas-clientes/avisos/vencimientos', { method: 'POST' }))
        .catch(() => undefined)
    pedir()
    const id = window.setInterval(() => document.visibilityState === 'visible' && pedir(), 30 * 60_000)
    return () => window.clearInterval(id)
  }, [conTareas])

  const loadNotifications = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // La lista (los más recientes) y, aparte, cuántos faltan por leer en total: con muchos avisos de correo la cuenta no puede salir solo de la lista
      const [lista, sinLeer] = await Promise.all([
        supabase.from('notifications').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(AVISOS_A_ENSENAR),
        supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('read', false),
      ])
      if (lista.error) throw lista.error

      const data = (lista.data || []) as Notification[]
      setNotifications(data)
      setUnreadCount(sinLeer.error || sinLeer.count === null ? data.filter(n => !n.read).length : sinLeer.count)
    } catch (error) {
      console.error('Error loading notifications:', error)
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let mounted = true
    let channel: any = null
    let temporizador: ReturnType<typeof setTimeout> | null = null

    // Lo que llega (un aviso nuevo, o uno que mejora o se marca leído desde el servidor) recarga la lista, de una vez aunque lleguen varios seguidos
    const recargarEnBreve = () => {
      if (!mounted) return
      if (temporizador) clearTimeout(temporizador)
      temporizador = setTimeout(() => {
        if (mounted) void loadNotifications()
      }, ESPERA_ANTES_DE_RECARGAR_MS)
    }

    const setupNotifications = async () => {
      await loadNotifications()

      if (!mounted) return

      // Obtener el usuario actual para filtrar notificaciones
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Suscribirse a los avisos de esta persona solo: los nuevos y los que cambian
      channel = supabase
        .channel(`notifications-${user.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, (payload) => {
          // Un correo nuevo en MI buzón (lo escribe el servidor al leerlo, con la pestaña a la vista o no): suena. La clave es «msg:<id del correo>»
          const fila = (payload as { new?: { type?: unknown; clave?: unknown; title?: unknown; message?: unknown; datos?: unknown } }).new
          if (fila?.type === 'correo_nuevo') void sonarCorreo(typeof fila.clave === 'string' ? fila.clave.replace(/^msg:/, '') : undefined)
          // Un mensaje del chat (un directo o una mención): suena, sale en el escritorio si la pestaña está oculta y asoma abajo a la derecha. Dentro del propio chat no: allí ya se ve en la barra
          const dChat = fila?.datos as { app?: string; canalId?: string | null; tipo?: string } | null | undefined
          if (dChat?.app === 'chat') {
            const rutaDelChat = typeof dChat.canalId === 'string' && /^[0-9a-f-]{36}$/i.test(dChat.canalId) ? `/dashboard/chat?canal=${dChat.canalId}` : '/dashboard/chat'
            // Un recordatorio suena siempre; un mensaje, solo si no estás ya dentro del chat (allí se ve en la barra)
            if (dChat.tipo === 'recordatorio' || !chatALaVista(window.location.pathname)) {
              void sonarTarea(typeof fila?.clave === 'string' ? fila.clave : undefined)
              avisarEnEscritorio(String(fila?.title ?? 'Chat'), String(fila?.message ?? ''), rutaDelChat)
              const claveDelAviso = typeof fila?.clave === 'string' ? fila.clave : String(Date.now())
              // Con la pastilla del chat a la vista, el mensaje asoma ENCIMA de ella (quién es y el principio de lo que dice); si no, el aviso lateral de siempre. Un recordatorio, siempre el lateral
              if (dChat.tipo !== 'recordatorio' && pastillaDelChatVisible()) {
                publicarVistaPrevia({ clave: claveDelAviso, titulo: String(fila?.title ?? 'Chat'), texto: String(fila?.message ?? ''), canalId: typeof dChat.canalId === 'string' ? dChat.canalId : null })
              } else {
                publicarAviso({ id: `chat:${claveDelAviso}`, tipo: 'tarea', titulo: String(fila?.title ?? 'Chat'), detalle: String(fila?.message ?? ''), duracionMs: dChat.tipo === 'recordatorio' ? 14000 : 9000, accion: { etiqueta: 'Abrir', alPulsar: () => router.push(rutaDelChat) } })
              }
            }
          }
          // Un aviso de tareas (te asignan, te mencionan, comentan, o una fecha): su propio sonido, y la notificación del escritorio si la pestaña no se está viendo
          const d = fila?.datos as { app?: string; clienteId?: string; tareaId?: string } | null | undefined
          if (d?.app === 'tareas-clientes') {
            void sonarTarea(typeof fila?.clave === 'string' ? fila.clave : undefined)
            const rutaDeTarea = d.clienteId ? `/dashboard/tareas-clientes/${d.clienteId}${d.tareaId ? `?tarea=${d.tareaId}` : ''}` : null
            if (rutaDeTarea) avisarEnEscritorio(String(fila?.title ?? 'Tareas de clientes'), String(fila?.message ?? ''), rutaDeTarea)
            // Y el aviso lateral de abajo a la derecha, como los de las llamadas: comentarios, menciones, asignaciones y tareas propuestas. Los recordatorios de fecha («vence hoy») no: salen
            // varios de golpe al abrir el ERP y ya están en la campana
            const motivo = (fila?.datos as { motivo?: string } | null | undefined)?.motivo
            if (rutaDeTarea && !motivo) {
              publicarAviso({ id: `tarea:${typeof fila?.clave === 'string' ? fila.clave : String(Date.now())}`, tipo: 'tarea', titulo: String(fila?.title ?? 'Tareas de clientes'), detalle: String(fila?.message ?? ''), duracionMs: 9000, accion: { etiqueta: 'Abrir', alPulsar: () => router.push(rutaDeTarea) } })
            }
          }
          recargarEnBreve()
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, recargarEnBreve)
        .subscribe()
    }

    setupNotifications()

    return () => {
      mounted = false
      if (temporizador) clearTimeout(temporizador)
      if (channel) {
        supabase.removeChannel(channel)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // Una alerta de logística FBA (rotura de stock, envío parado…) o el resumen del lunes: al tablero de alertas
    if (notification.type === 'fba_alerta' || notification.type === 'fba_resumen') {
      return '/dashboard/remesas/alertas'
    }

    // Un mensaje del chat: se abre en su canal
    const datosChat = notification.datos as { app?: string; canalId?: string | null } | null | undefined
    if (datosChat?.app === 'chat') {
      return typeof datosChat.canalId === 'string' && /^[0-9a-f-]{36}$/i.test(datosChat.canalId) ? `/dashboard/chat?canal=${datosChat.canalId}` : '/dashboard/chat'
    }

    // Una tarea de cliente (comentario, mención o asignación): se abre en su tablero, con la tarea a la vista
    const datosTarea = notification.datos as { app?: string; clienteId?: string; tareaId?: string } | null | undefined
    if (datosTarea?.app === 'tareas-clientes' && datosTarea.clienteId) {
      return `/dashboard/tareas-clientes/${datosTarea.clienteId}${datosTarea.tareaId ? `?tarea=${datosTarea.tareaId}` : ''}`
    }

    if (notification.related_client_id && notification.related_task_id) {
      return `/dashboard/clients/${notification.related_client_id}`
    }
    if (notification.related_client_id) {
      return `/dashboard/clients/${notification.related_client_id}`
    }
    return null
  }

  /** Pulsar un aviso de correo: se da por leído y se abre su conversación o su secuencia en Correo, sin recargar nada */
  const abrirAviso = (notification: Notification, destino: DestinoDeAviso) => {
    if (!notification.read) void markAsRead(notification.id)
    setIsOpen(false)
    if (destino.tipo === 'hilo') pedirAlCorreo({ tipo: 'hilo', buzonId: destino.buzonId, hiloId: destino.hiloId })
    else if (destino.tipo === 'secuencia') pedirAlCorreo({ tipo: 'secuencia', inscripcionId: destino.inscripcionId })
    router.push('/dashboard/correo')
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
          {loading && notifications.length === 0 ? (
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
              const { Icono, tono } = iconoDeAviso(notification.type, notification.datos)
              const destino = destinoDeAvisoDeCorreo(notification.type, notification.datos)
              const link = destino ? null : getNotificationLink(notification)
              const propios = {
                className: 'lat-aviso',
                'data-sin-leer': !notification.read ? 'true' : undefined,
                style: { '--i': i } as CSSProperties,
              }
              const contenido = (
                <>
                  <span className="lat-aviso-icono" data-tono={tono}>
                    <Icono className="h-4 w-4" aria-hidden />
                  </span>
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
                </>
              )

              // Los de correo llevan a su conversación o a su secuencia
              if (destino) {
                return (
                  <button key={notification.id} type="button" {...propios} onClick={() => abrirAviso(notification, destino)}>
                    {contenido}
                  </button>
                )
              }

              if (link) {
                return (
                  <Link
                    key={notification.id}
                    href={link}
                    {...propios}
                    onClick={() => {
                      if (!notification.read) void markAsRead(notification.id)
                      setIsOpen(false)
                    }}
                  >
                    {contenido}
                  </Link>
                )
              }

              return (
                <div
                  key={notification.id}
                  {...propios}
                  onClick={() => {
                    if (!notification.read) void markAsRead(notification.id)
                  }}
                >
                  {contenido}
                </div>
              )
            })
          )}
        </div>
        <div className="lat-avisos-pie">
          <div className="lat-avisos-sonido">
            <button
              type="button"
              onClick={() => {
                const nuevo = !sonidoActivo
                ponerSonidoDeCorreo(nuevo)
                setPruebaDeSonido('')
                // Al encenderlo se oye una vez: así se sabe cómo suena y que funciona
                if (nuevo) void probarSonido().then((r) => setPruebaDeSonido(r === 'sono' ? '' : r))
              }}
              aria-pressed={sonidoActivo}
              className="lat-avisos-silencio"
            >
              {sonidoActivo ? <Volume2 className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <VolumeX className="h-3.5 w-3.5 shrink-0" aria-hidden />}
              <span className="flex-1">{sonidoActivo ? 'Suena al llegar un correo' : 'Sin sonido al llegar un correo'}</span>
              <span className="lat-avisos-silencio-accion">{sonidoActivo ? 'Quitar' : 'Poner'}</span>
            </button>
            {sonidoActivo && (
              <button
                type="button"
                className="lat-avisos-probar"
                onClick={() => void probarSonido().then((r) => setPruebaDeSonido(r === 'sono' ? '' : r))}
                title="Oír el aviso"
              >
                Probar
              </button>
            )}
          </div>
          {pruebaDeSonido !== '' && (
            <p className="lat-avisos-nota" role="status">
              {pruebaDeSonido === 'bloqueado' ? 'El navegador no deja sonar todavía: pulsa en cualquier parte de la página y vuelve a probar.' : 'Este navegador no tiene audio.'}
            </p>
          )}
          {conTareas && (
            <>
              <div className="lat-avisos-sonido">
                <button
                  type="button"
                  onClick={() => {
                    const nuevo = !sonidoDeTareas
                    ponerSonidoDeTareas(nuevo)
                    setNotaDeTareas('')
                    if (nuevo) void probarSonidoDeTarea().then((r) => setNotaDeTareas(r === 'bloqueado' ? 'El navegador no deja sonar todavía: pulsa en cualquier parte de la página y vuelve a probar.' : r === 'sin_audio' ? 'Este navegador no tiene audio.' : ''))
                  }}
                  aria-pressed={sonidoDeTareas}
                  className="lat-avisos-silencio"
                  title={ficheroPropio ? `Suena ${ficheroPropio}` : 'Suena el «ding» de siempre; para poner el tuyo, copia un tarea.mp3 en public/sonidos'}
                >
                  {sonidoDeTareas ? <Volume2 className="h-3.5 w-3.5 shrink-0" aria-hidden /> : <VolumeX className="h-3.5 w-3.5 shrink-0" aria-hidden />}
                  <span className="flex-1">{sonidoDeTareas ? 'Suena al llegar un aviso de tareas' : 'Sin sonido en los avisos de tareas'}</span>
                  <span className="lat-avisos-silencio-accion">{sonidoDeTareas ? 'Quitar' : 'Poner'}</span>
                </button>
                {sonidoDeTareas && (
                  <button type="button" className="lat-avisos-probar" onClick={() => void probarSonidoDeTarea().then((r) => setNotaDeTareas(r === 'bloqueado' ? 'El navegador no deja sonar todavía: pulsa en cualquier parte de la página y vuelve a probar.' : ''))} title="Oír el aviso">
                    Probar
                  </button>
                )}
              </div>
              {escritorioDisponible() && (
                <button
                  type="button"
                  onClick={async () => {
                    if (escritorio) {
                      desactivarEscritorio()
                      return
                    }
                    const r = await activarEscritorio()
                    setNotaDeTareas(r === 'denegado' ? 'El navegador tiene bloqueadas las notificaciones de esta página: se desbloquean en el candado de la barra de direcciones.' : '')
                  }}
                  aria-pressed={escritorio}
                  className="lat-avisos-silencio"
                  title="Una notificación del sistema cuando llegue un aviso de tareas y la pestaña del ERP no esté a la vista"
                >
                  <BellRing className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="flex-1">{escritorio ? 'Avisos del escritorio activados' : escritorioDenegado() ? 'Avisos del escritorio bloqueados' : 'Avisos del escritorio apagados'}</span>
                  <span className="lat-avisos-silencio-accion">{escritorio ? 'Quitar' : 'Activar'}</span>
                </button>
              )}
              <AvisosPush />
              {notaDeTareas !== '' && (
                <p className="lat-avisos-nota" role="status">
                  {notaDeTareas}
                </p>
              )}
            </>
          )}
          <button type="button" onClick={abrirDialogoDeSonidos} className="lat-avisos-silencio" title="Elegir qué suena en cada caso: mensajes, correo, juntas de voz y llamadas">
            <Volume2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="flex-1">Elegir los sonidos</span>
            <span className="lat-avisos-silencio-accion">Abrir</span>
          </button>
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
