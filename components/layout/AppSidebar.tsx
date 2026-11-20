'use client'

import { PerfilEnLaBarra } from './PerfilEnLaBarra'
import { useState, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties, type MouseEvent, type TouchEvent } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, KanbanSquare, LogOut, MessagesSquare } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { NotificationsBell } from '@/components/layout/NotificationsBell'
import { leerAvisosSinLeer, leerChatSinLeer, leerCorreoSinLeer, ponerWebLeadsSinVer, suscribirContadores } from '@/lib/avisos/contadores'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { esCeo } from '@/lib/usuarios/ceo'
import { apps, getAppById, nombreCortoDe, APPS_EN_EL_PIE, APPS_FUERA_DEL_MENU, APPS_OCULTAS_A_ADMIN, APPS_SOLO_ADMIN, APP_CHAT, APP_CRM, APP_GROWTH, APP_TAREAS_CLIENTES, GRUPOS_DEL_MENU, puedeVerCrm, puedeVerGrowth, type AppConfig } from '@/lib/config/apps'
import { etiquetaDeRol } from '@/lib/inicio/saludo'
import { esRutaInmersiva, EVENTO_ABRIR_MENU } from '@/lib/layout/inmersivo'
import { etiquetaDeInsignia, inicialesDe, rutaActivaDelMenu } from '@/lib/layout/barra'
import { aplanarMenu, armarMenu, grupoDeLaRuta, rutaParaElMenu } from '@/lib/layout/menu'
import { createClient } from '@/lib/supabase/client'
import type { RolUsuario } from '@/lib/types/users'
import { BarraInferior, type PestanaDeLaBarra } from '@/components/layout/movil/BarraInferior'
import { CabeceraMovil } from '@/components/layout/movil/CabeceraMovil'
import { EVENTO_ABRIR_AVISOS, EVENTO_NAVEGANDO } from '@/lib/movil/eventos'
import { apilarRuta, CLAVE_HISTORIAL, hayAtras } from '@/lib/movil/historial'
import { elegirPestanas } from '@/lib/movil/pestanas'
import { EVENTO_USO_CAMBIA, fijadas as leerFijadas, leerIdsDe, leerUso, registrarApertura, type Uso } from '@/lib/movil/uso'
import { useTeclado } from '@/lib/movil/useTeclado'

/**
 * LA BARRA LATERAL: el menú de aplicaciones, tu cuenta, los avisos y el tema.
 *
 * Todo el aspecto vive en un bloque de app/globals.css («BARRA LATERAL · ESCENA Y MOVIMIENTO», clases `lat-*`) y se deshace borrándolo; aquí solo está lo que
 * piensa: qué entradas ve cada persona, cuál está encendida y dónde tiene que ir la marca que se desliza de una a otra.
 *
 * `perfil` lo da el layout del servidor, que ya lo tiene: con el rol a la vista desde el primer pintado, un empleado no ve durante un instante el menú de todo el
 * mundo antes de que se encoja al suyo. Sin él (una vista previa, una prueba) se pregunta al navegador como siempre.
 */
export interface PerfilDeLaBarra {
  id?: string
  role: RolUsuario
  email: string | null
  full_name: string | null
  /** El puesto: 'ceo' = administrador cuyo acceso a cada aplicación lo deciden las casillas (lib/usuarios/ceo.ts) */
  puesto?: string | null
}

// Antes de pintar, medir dónde está la entrada encendida; en el servidor no hay nada que medir y `useLayoutEffect` avisa
const useEfectoAntesDePintar = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** Qué desplegables estaban abiertos (los ids de grupo), para que al volver estén como se dejaron */
const CLAVE_DE_GRUPOS_ABIERTOS = 'erp:menu:grupos-abiertos'

/** Las tres pestañas de la barra de abajo del móvil, congeladas mientras dura la sesión (lib/movil/pestanas.ts) */
const CLAVE_PESTANAS = 'erp:movil:pestanas'

const leerDeLaSesion = (clave: string): string | null => {
  try {
    return window.sessionStorage.getItem(clave)
  } catch {
    return null
  }
}
const escribirEnLaSesion = (clave: string, valor: string | null) => {
  try {
    if (valor === null) window.sessionStorage.removeItem(clave)
    else window.sessionStorage.setItem(clave, valor)
  } catch {
    /* sin almacenamiento: se recalcula en cada carga */
  }
}

const ANCHO_ABIERTA = '16rem'
const ANCHO_PLEGADA = '4.5rem'

export function AppSidebar({ perfil }: { perfil?: PerfilDeLaBarra }) {
  // Lo que la persona eligió para las pantallas normales. En las aplicaciones que se abren a pantalla completa (Tareas, Chat) la barra se queda SIEMPRE a la vista, pero como un carril fino:
  // se amplía con el botón de plegar y se acuerda esa elección (aparte de la de las pantallas normales)
  const [plegadaElegida, setIsCollapsed] = useState(false)
  const [ampliadaEnApps, setAmpliadaEnApps] = useState(false)
  useEffect(() => {
    try {
      setAmpliadaEnApps(window.localStorage.getItem('lat:ampliada-en-apps') === '1')
    } catch {
      /* sin almacenamiento: carril fino */
    }
  }, [])
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [userPermissions, setUserPermissions] = useState<Set<string>>(new Set())
  const [permisosCargados, setPermisosCargados] = useState(false)
  const [userRole, setUserRole] = useState<RolUsuario | null>(perfil?.role ?? null)
  const [userPuesto, setUserPuesto] = useState<string | null>(perfil?.puesto ?? null)
  const [userEmail, setUserEmail] = useState<string | null>(perfil?.email ?? null)
  const [userName, setUserName] = useState<string | null>(perfil?.full_name ?? null)
  const [userId, setUserId] = useState<string | null>(perfil?.id ?? null)
  const [webLeadsBadge, setWebLeadsBadge] = useState<number | undefined>(undefined)
  // Cuántas conversaciones de correo tienen algo sin leer: lo publica el lector de correo nuevo (components/avisos), esté donde esté la persona
  const correoSinLeer = useSyncExternalStore(suscribirContadores, leerCorreoSinLeer, () => 0)
  const pathname = usePathname()
  const router = useRouter()
  // Hay pantallas que se abren «como otra aplicación» (lib/layout/inmersivo.ts): la barra no se esconde, se queda como un carril fino (en pantallas estrechas sigue siendo un cajón)
  const inmersivo = esRutaInmersiva(pathname)
  const isCollapsed = inmersivo ? !ampliadaEnApps : plegadaElegida
  // Cuánto chat hay sin leer: lo publica el dock del chat (o la propia aplicación), esté donde esté la persona
  const chatSinLeer = useSyncExternalStore(suscribirContadores, leerChatSinLeer, leerChatSinLeer)
  const supabase = createClient()

  // Una sola vez al montar: el perfil y los permisos no cambian mientras la
  // pestaña esté abierta.
  useEffect(() => {
    loadUserPermissions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Solo depende del rol, y a propósito. `supabase` sale de createClient() en
  // cada render, así que meterlo en las dependencias volvería a suscribir el
  // canal de realtime cada vez que se repinta la barra; y loadWebLeadsCount se
  // redefine igual en cada render. Añadirlos no arregla nada y rompe esto.
  useEffect(() => {
    if (userRole === 'admin') {
      loadWebLeadsCount()

      // Suscribirse a cambios en web_leads para actualizar el badge
      const channel = supabase
        .channel('web_leads_badge')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'web_leads',
          },
          () => {
            loadWebLeadsCount()
          }
        )
        .subscribe()

      return () => {
        supabase.removeChannel(channel)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userRole])

  const loadWebLeadsCount = async () => {
    try {
      // Solo cargar el badge si el usuario es admin
      if (userRole !== 'admin') return

      const { count, error } = await supabase
        .from('web_leads')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'registrado')

      if (error) throw error

      setWebLeadsBadge(count && count > 0 ? count : undefined)
      // También para las celdas del Inicio en el móvil
      ponerWebLeadsSinVer(count ?? 0)
    } catch (error) {
      console.error('Error loading web leads count:', error)
    }
  }

  const loadUserPermissions = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Obtener perfil del usuario
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, email, full_name, puesto')
        .eq('id', user.id)
        .single()

      setUserId(user.id)
      if (profile) {
        setUserRole(profile.role)
        setUserPuesto(profile.puesto ?? null)
        setUserEmail(profile.email)
        setUserName(profile.full_name ?? null)

        // Si es admin, tiene acceso a todo. Un CEO (administrador cuyo acceso decide la casilla, lib/usuarios/ceo.ts) no: se cargan sus casillas como las de un empleado
        if (profile.role === 'admin' && !esCeo(profile.role, profile.puesto)) {
          setUserPermissions(new Set(apps.map(app => app.id)))
          return
        }

        // Partners: el menú y accesos se controlan en middleware y en el filtrado de apps
        if (profile.role === 'partner') {
          setUserPermissions(new Set())
          return
        }

        // Si es employee, cargar permisos específicos
        const { data: permissions } = await supabase
          .from('user_app_permissions')
          .select('app_id')
          .eq('user_id', user.id)
          .eq('can_access', true)

        if (permissions) {
          setUserPermissions(new Set(permissions.map(p => p.app_id)))
        }
      }
    } catch (error) {
      console.error('Error loading permissions:', error)
    } finally {
      setPermisosCargados(true)
    }
  }

  // Filtrar apps según permisos
  const filteredApps = apps.filter(app => {
    // Las que se abren desde otra pantalla (Actividad del equipo, desde Mi rendimiento) no van en el menú
    if (APPS_FUERA_DEL_MENU.has(app.id)) return false
    // Las que tienen su sitio en el pie de la barra (entre tu nombre y los avisos) no se repiten en la lista
    if (APPS_EN_EL_PIE.has(app.id)) return false
    // El rol 'cliente' es gente de fuera: ve Remesas a FBA y absolutamente nada
    // más, ni el Inicio. El middleware ya le cierra las rutas; esto es para que
    // el menú no le enseñe puertas que no puede abrir.
    if (userRole === 'cliente') return app.id === 'remesas'

    // Home siempre visible
    if (app.id === 'home') return true
    // Gestión de usuarios solo para admin específico
    if (app.id === 'users') {
      return userRole === 'admin' && userEmail === 'raulcamunas369@gmail.com'
    }
    // Un CEO abre solo las aplicaciones que tiene marcadas, como un empleado (lib/usuarios/ceo.ts). Antes de todo lo de abajo: mientras no llegan sus casillas no se le enseña nada
    if (esCeo(userRole, userPuesto)) return userPermissions.has(app.id)
    // Las apps de solo-admin, con el motivo de cada una escrito junto a la
    // lista en lib/config/apps.ts. Va ANTES del "si aún no se ha cargado el
    // rol, mostrar todas" de abajo: si no, aparecen un instante en el menú de
    // cualquiera mientras se resuelve el perfil.
    if (APPS_SOLO_ADMIN.has(app.id)) {
      return userRole === 'admin' && !APPS_OCULTAS_A_ADMIN.has(app.id)
    }

    // Las que el admin no usa. No es un permiso: el módulo sigue abierto y
    // quien lo tenga concedido lo sigue viendo. Ver APPS_OCULTAS_A_ADMIN.
    if (userRole === 'admin' && APPS_OCULTAS_A_ADMIN.has(app.id)) return false
    // Growth Partner: admin, más quien tenga el permiso suelto 'stock-sync', que
    // dentro solo ve el sincronismo. Ver lib/growth/acceso.ts. Va aquí, antes
    // del "si aún no se ha cargado el rol", por el mismo motivo que la lista de
    // arriba: si no, parpadea en el menú de cualquiera.
    if (app.id === APP_GROWTH) {
      return puedeVerGrowth(userRole, userPermissions)
    }
    // El CRM de clientes: admin, o quien supervisa al equipo comercial ('equipo-comercial'). Antes del «si aún no se ha cargado el rol»: no parpadea en el menú de nadie
    if (app.id === APP_CRM) {
      return puedeVerCrm(userRole, userPermissions)
    }
    // Si aún no se ha cargado el rol, mostrar todas temporalmente (evita parpadeo)
    if (userRole === null) return true
    // Para admins, acceso a todo
    if (userRole === 'admin') return true
    // Para partners, mostrar solo apps permitidas
    if (userRole === 'partner') {
      return app.id === 'clients' || app.id === 'monthly-closings' || app.id === 'biweekly-reports'
    }
    // Para employees, verificar permisos
    return userPermissions.has(app.id)
  })

  // Tareas Clientes vive en el pie: lo ve un administrador y quien tenga su casilla (un partner o un cliente no entran por serlo)
  const ceo = esCeo(userRole, userPuesto)
  const puedeVerTareas = (userRole === 'admin' && !ceo) || ((userRole === 'employee' || ceo) && userPermissions.has(APP_TAREAS_CLIENTES))
  // El Chat, también en el pie, junto a Tareas: son las dos de cada día (con lo que hay sin leer)
  const puedeVerChat = (userRole === 'admin' && !ceo) || ((userRole === 'employee' || ceo) && userPermissions.has(APP_CHAT))
  const enElChat = Boolean(pathname?.startsWith('/dashboard/chat'))

  // Un empleado ve «Inicio» y, hasta que llegan sus permisos, unas filas que se están rellenando (en vez de un menú que de repente crece)
  const cargandoPermisos = (userRole === 'employee' || ceo) && !permisosCargados

  // Al pulsar una entrada se enciende ya, sin esperar a que cargue la página: si la ruta nueva no llega a abrirse se deshace sola
  const [pendiente, setPendiente] = useState<string | null>(null)
  useEffect(() => {
    setPendiente(null)
  }, [pathname])
  useEffect(() => {
    if (!pendiente) return
    const id = window.setTimeout(() => setPendiente(null), 4000)
    return () => window.clearTimeout(id)
  }, [pendiente])

  // El menú: las aplicaciones sueltas y los desplegables (lib/layout/menu.ts). Un desplegable existe para quien ve al menos dos de sus aplicaciones
  const menu = armarMenu(filteredApps, GRUPOS_DEL_MENU)
  const rutasDelMenu = aplanarMenu(menu).map((a) => a.route)
  // Estando en una pantalla que cuelga de otra (Actividad, desde Mi rendimiento), se enciende la de la que cuelga
  const rutaActiva = rutaActivaDelMenu(rutasDelMenu, rutaParaElMenu(pendiente ?? pathname ?? ''))
  const grupoActivo = grupoDeLaRuta(menu, rutaActiva)

  /* ---------------- EL MÓVIL: cabecera, barra de abajo y hoja «Más» (todo `lg:hidden` o con CSS de pantallas estrechas) ---------------- */
  useTeclado()
  // Una celda del Inicio avisa al pulsar: el título y la pestaña cambian ya, sin esperar a la página
  useEffect(() => {
    const alNavegar = (e: Event) => {
      const ruta = (e as CustomEvent<string>).detail
      if (typeof ruta === 'string' && ruta !== pathname) setPendiente(ruta)
    }
    window.addEventListener(EVENTO_NAVEGANDO, alNavegar)
    return () => window.removeEventListener(EVENTO_NAVEGANDO, alNavegar)
  }, [pathname])

  // Las aplicaciones que pueden ir en la barra de abajo: las del menú (en su orden) y las del pie (Chat, Tareas), si las ve
  const appsDelMovil: AppConfig[] = [...aplanarMenu(menu)]
  for (const [id, puede] of [[APP_CHAT, puedeVerChat], [APP_TAREAS_CLIENTES, puedeVerTareas]] as const) {
    const app = puede ? getAppById(id) : undefined
    if (app && !appsDelMovil.some((a) => a.id === id)) appsDelMovil.push(app)
  }
  const rutasDelMovil = appsDelMovil.map((a) => a.route)
  const rutaDelMovil = rutaActivaDelMenu(rutasDelMovil, rutaParaElMenu(pendiente ?? pathname ?? ''))
  const appActual = rutaDelMovil ? appsDelMovil.find((a) => a.route === rutaDelMovil) : undefined
  const enInicio = (pendiente ?? pathname ?? '').replace(/\/+$/, '') === '/dashboard'

  // Cada vez que se entra en otra aplicación se apunta (solo en este navegador): de ahí salen «Recientes» y las pestañas
  const rutaRealDelMovil = rutaActivaDelMenu(rutasDelMovil, rutaParaElMenu(pathname ?? ''))
  const ultimaApuntada = useRef<string | null>(null)
  useEffect(() => {
    const app = rutaRealDelMovil ? appsDelMovil.find((a) => a.route === rutaRealDelMovil) : undefined
    if (!app || app.id === 'home' || ultimaApuntada.current === app.id) return
    ultimaApuntada.current = app.id
    registrarApertura(app.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rutaRealDelMovil])

  // Las tres pestañas del medio. Se leen el uso y las fijadas al montar; la elección se congela en la sesión para que no bailen bajo el dedo
  const [uso, setUso] = useState<Uso>({})
  const [fijadasMovil, setFijadasMovil] = useState<string[]>([])
  const [congeladas, setCongeladas] = useState<string[] | null>(null)
  const [movilMontado, setMovilMontado] = useState(false)
  useEffect(() => {
    setUso(leerUso())
    setFijadasMovil(leerFijadas())
    setCongeladas(leerIdsDe(leerDeLaSesion(CLAVE_PESTANAS)))
    setMovilMontado(true)
    let antes = JSON.stringify(leerFijadas())
    const alCambiar = () => {
      setUso(leerUso())
      const ahora = leerFijadas()
      const texto = JSON.stringify(ahora)
      if (texto === antes) return
      // Fijar o quitar una a mano sí cambia la barra al momento
      antes = texto
      setFijadasMovil(ahora)
      setCongeladas(null)
      escribirEnLaSesion(CLAVE_PESTANAS, null)
    }
    window.addEventListener(EVENTO_USO_CAMBIA, alCambiar)
    return () => window.removeEventListener(EVENTO_USO_CAMBIA, alCambiar)
  }, [])
  const pestanasListas = userRole !== null && !cargandoPermisos
  const idsPestanas = elegirPestanas({ visibles: appsDelMovil.map((a) => a.id), uso, fijadas: fijadasMovil, rol: userRole, ahora: Date.now(), congeladas })
  const clavePestanas = idsPestanas.join('|')
  useEffect(() => {
    if (!movilMontado || !pestanasListas) return
    if ((congeladas ?? []).join('|') === clavePestanas) return
    const ids = clavePestanas === '' ? [] : clavePestanas.split('|')
    setCongeladas(ids)
    escribirEnLaSesion(CLAVE_PESTANAS, JSON.stringify(ids))
  }, [movilMontado, pestanasListas, clavePestanas, congeladas])

  const avisosSinLeer = useSyncExternalStore(suscribirContadores, leerAvisosSinLeer, () => 0)
  const insigniaMovil = (id: string): { texto: string | null; urgente?: boolean } => {
    if (id === 'correo') return { texto: etiquetaDeInsignia(correoSinLeer, false) }
    if (id === 'chat') return { texto: etiquetaDeInsignia(chatSinLeer.mensajes + chatSinLeer.menciones, false), urgente: chatSinLeer.menciones > 0 }
    if (id === 'web-leads' && userRole === 'admin') return { texto: etiquetaDeInsignia(webLeadsBadge, false) }
    return { texto: null }
  }
  const pestanasMovil: PestanaDeLaBarra[] = idsPestanas
    .map((id) => appsDelMovil.find((a) => a.id === id))
    .filter((a): a is AppConfig => Boolean(a))
    .map((a) => {
      const { texto, urgente } = insigniaMovil(a.id)
      return { id: a.id, nombre: nombreCortoDe(a), ruta: a.route, icono: a.icon, insignia: texto, urgente }
    })

  // «Atrás»: la pila de rutas de esta pestaña (lib/movil/historial.ts). Con algo debajo es el «atrás» del navegador; si no, al Inicio
  const [puedeAtras, setPuedeAtras] = useState(false)
  useEffect(() => {
    if (!pathname) return
    let guardada: string[] = []
    try {
      const crudo: unknown = JSON.parse(leerDeLaSesion(CLAVE_HISTORIAL) ?? '[]')
      if (Array.isArray(crudo)) guardada = crudo.filter((x): x is string => typeof x === 'string')
    } catch {
      /* una pila rota empieza de cero */
    }
    const pila = apilarRuta(guardada, pathname)
    escribirEnLaSesion(CLAVE_HISTORIAL, JSON.stringify(pila))
    setPuedeAtras(hayAtras(pila))
  }, [pathname])
  const volver = () => {
    if (puedeAtras) router.back()
    else router.push('/dashboard')
  }

  // Los desplegables abiertos. Se recuerdan en este navegador; el de la página en la que se está se abre solo al llegar a ella (pero se puede cerrar a mano: no se
  // vuelve a abrir hasta que se cambie de página)
  const [abiertos, setAbiertos] = useState<ReadonlySet<string>>(() => new Set())
  const abiertosRef = useRef<Set<string>>(new Set())
  const guardarAbiertos = (n: ReadonlySet<string>) => {
    abiertosRef.current = new Set(n)
    setAbiertos(new Set(n))
    try {
      window.localStorage.setItem(CLAVE_DE_GRUPOS_ABIERTOS, JSON.stringify([...n]))
    } catch {
      // sin almacenamiento (ventana privada): el menú funciona igual, solo que no se acuerda
    }
  }
  // Se lee después de montar: en el servidor no hay almacenamiento y lo que se pinta primero tiene que ser igual en los dos sitios
  useEffect(() => {
    try {
      const guardado: unknown = JSON.parse(window.localStorage.getItem(CLAVE_DE_GRUPOS_ABIERTOS) ?? '[]')
      if (Array.isArray(guardado)) {
        const ids = guardado.filter((x): x is string => typeof x === 'string')
        if (ids.length > 0) {
          const union = new Set([...abiertosRef.current, ...ids])
          abiertosRef.current = union
          setAbiertos(new Set(union))
        }
      }
    } catch {
      // un valor roto en el almacenamiento no puede romper el menú
    }
  }, [])
  useEffect(() => {
    if (!grupoActivo || abiertosRef.current.has(grupoActivo)) return
    guardarAbiertos(new Set([...abiertosRef.current, grupoActivo]))
    // Solo al llegar a una página de otro grupo: cerrarlo a mano estando dentro no lo reabre
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupoActivo, rutaActiva])
  const alternarGrupo = (id: string) => {
    const n = new Set(abiertosRef.current)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    guardarAbiertos(n)
  }
  const abiertosClave = [...abiertos].sort().join('|')

  // La marca luminosa que se desliza hasta la entrada encendida: se mide dónde está y cuánto mide, y se coloca con una transición.
  // La primera colocación no se anima (que no venga desde arriba al cargar la página)
  const listaRef = useRef<HTMLDivElement>(null)
  // Dónde está la marca (se recuerda aunque desaparezca: si vuelve, vuelve desde donde estaba y no desde arriba) y si se ve
  const [posicion, setPosicion] = useState<{ y: number; h: number } | null>(null)
  const [hayMarca, setHayMarca] = useState(false)
  const [animar, setAnimar] = useState(false)
  const idsVisibles = filteredApps.map((a) => a.id).join('|')
  useEfectoAntesDePintar(() => {
    const activo = listaRef.current?.querySelector<HTMLElement>('[data-activa="true"]')
    if (!activo) {
      setHayMarca(false)
      return
    }
    const nueva = { y: activo.offsetTop, h: activo.offsetHeight }
    setPosicion((antes) => (antes && antes.y === nueva.y && antes.h === nueva.h ? antes : nueva))
    setHayMarca(true)
  }, [rutaActiva, idsVisibles, isCollapsed, cargandoPermisos, abiertosClave])
  useEffect(() => {
    if (!posicion || animar) return
    // Un instante después de la primera colocación, cuando ya se ha pintado: a partir de ahí, cada cambio se desliza
    const id = window.setTimeout(() => setAnimar(true), 80)
    return () => window.clearTimeout(id)
  }, [posicion, animar])

  // El contenido de la página se aparta lo que ocupe la barra (el layout lee esta variable)
  useEffect(() => {
    const raiz = document.documentElement
    raiz.style.setProperty('--lat-ancho', isCollapsed ? ANCHO_PLEGADA : ANCHO_ABIERTA)
    return () => {
      raiz.style.removeProperty('--lat-ancho')
    }
  }, [isCollapsed])

  // El cajón se cierra al cambiar de página; a pantalla completa se abre con el botón de la página (que avisa por `window`) y se cierra con Escape
  useEffect(() => {
    setIsMobileOpen(false)
  }, [pathname])
  useEffect(() => {
    const abrir = () => setIsMobileOpen(true)
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMobileOpen(false)
    }
    window.addEventListener(EVENTO_ABRIR_MENU, abrir)
    window.addEventListener('keydown', alPulsar)
    return () => {
      window.removeEventListener(EVENTO_ABRIR_MENU, abrir)
      window.removeEventListener('keydown', alPulsar)
    }
  }, [])

  // En una pantalla estrecha la barra es un cajón y no se pliega: si se estrecha la ventana con la barra plegada, se despliega
  useEffect(() => {
    const ancha = window.matchMedia('(min-width: 1024px)')
    const alCambiar = () => {
      if (!ancha.matches) setIsCollapsed(false)
    }
    alCambiar()
    ancha.addEventListener('change', alCambiar)
    return () => ancha.removeEventListener('change', alCambiar)
  }, [])

  // Con la barra plegada, el nombre de cada entrada sale en una etiqueta al lado. Es UNA sola, fuera de la lista que se desplaza, para que no la recorte
  const [etiqueta, setEtiqueta] = useState<{ texto: string; y: number } | null>(null)
  const [etiquetaVisible, setEtiquetaVisible] = useState(false)
  const mostrarEtiqueta = (el: HTMLElement, texto: string) => {
    if (!isCollapsed) return
    const caja = el.getBoundingClientRect()
    setEtiqueta({ texto, y: caja.top + caja.height / 2 })
    setEtiquetaVisible(true)
  }
  const ocultarEtiqueta = () => setEtiquetaVisible(false)
  useEffect(() => {
    if (!isCollapsed) setEtiquetaVisible(false)
  }, [isCollapsed])

  // El foco de luz de cada entrada sigue al ratón (`--mx` y `--my` los lee el CSS)
  const seguirRaton = (e: MouseEvent<HTMLElement>) => {
    const caja = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--mx', `${e.clientX - caja.left}px`)
    e.currentTarget.style.setProperty('--my', `${e.clientY - caja.top}px`)
  }

  const toggleCollapse = () => {
    if (inmersivo) {
      const nueva = !ampliadaEnApps
      setAmpliadaEnApps(nueva)
      try {
        window.localStorage.setItem('lat:ampliada-en-apps', nueva ? '1' : '0')
      } catch {
        /* se queda para esta sesión */
      }
      return
    }
    setIsCollapsed(!plegadaElegida)
  }

  const toggleMobile = () => {
    setIsMobileOpen(!isMobileOpen)
  }

  // La hoja «Más» se cierra también arrastrándola hacia abajo desde su asa o su cabecera
  const asaRef = useRef<HTMLButtonElement>(null)
  const arrastre = useRef<{ y0: number; dy: number } | null>(null)
  const asideRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (isMobileOpen && window.matchMedia('(max-width: 1023.98px)').matches) asaRef.current?.focus({ preventScroll: true })
  }, [isMobileOpen])
  const alEmpezarArrastre = (e: TouchEvent) => {
    const t = e.target as HTMLElement
    if (!isMobileOpen || !t.closest('.lat-asa, .lat-cabecera') || !window.matchMedia('(max-width: 1023.98px)').matches) return
    arrastre.current = { y0: e.touches[0].clientY, dy: 0 }
  }
  const alArrastrar = (e: TouchEvent) => {
    const a = arrastre.current
    const el = asideRef.current
    if (!a || !el) return
    a.dy = Math.max(0, e.touches[0].clientY - a.y0)
    el.style.transition = 'none'
    el.style.translate = `0 ${a.dy}px`
  }
  const alSoltarArrastre = () => {
    const a = arrastre.current
    const el = asideRef.current
    arrastre.current = null
    if (!a || !el) return
    el.style.transition = ''
    el.style.translate = ''
    if (a.dy > 80) setIsMobileOpen(false)
  }

  const cerrarSesion = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  const nombreVisible = (userName ?? '').trim() || (userEmail ?? '').split('@')[0] || 'Mi cuenta'

  return (
    <>
      {/* EN EL MÓVIL: la cabecera (atrás, título y campana) en vez del botón flotante del menú; a pantalla completa (Chat, Tareas) no, que traen la suya */}
      {!inmersivo && (
        <CabeceraMovil
          titulo={appActual?.name ?? 'Liberty Hub'}
          enInicio={enInicio}
          avisos={avisosSinLeer}
          alVolver={volver}
          alAbrirAvisos={() => {
            setIsMobileOpen(true)
            // La campana de verdad vive en la hoja: se abre su panel cuando la hoja ya ha subido
            window.setTimeout(() => window.dispatchEvent(new Event(EVENTO_ABRIR_AVISOS)), 380)
          }}
          alAbrirMenu={userRole === 'cliente' ? toggleMobile : undefined}
        />
      )}

      <aside
        ref={asideRef}
        className="lat"
        data-plegada={isCollapsed ? 'true' : undefined}
        data-movil={isMobileOpen ? 'abierta' : undefined}
        data-inmersivo={inmersivo ? 'true' : undefined}
        aria-label="Menú principal"
        onTouchStart={alEmpezarArrastre}
        onTouchMove={alArrastrar}
        onTouchEnd={alSoltarArrastre}
        onTouchCancel={alSoltarArrastre}
      >
        {/* El asa de la hoja «Más» (solo en el móvil): se toca o se arrastra hacia abajo para cerrarla */}
        <button ref={asaRef} type="button" className="lat-asa" onClick={() => setIsMobileOpen(false)} aria-label="Cerrar el menú" tabIndex={isMobileOpen ? 0 : -1}>
          <span aria-hidden />
        </button>
        {/* El fondo: una luz que se mueve despacio arriba y un hilo de luz que baja por el borde */}
        <div className="lat-decorado" aria-hidden>
          <span className="lat-aurora" />
          <span className="lat-hilo" />
        </div>

        {/* Cabecera con el logo */}
        <div className="lat-cabecera">
          {isCollapsed ? (
            <Link href="/" className="lat-monograma" aria-label="Liberty Seller Hub">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/pwa/icono-192.png" alt="" width={38} height={38} draggable={false} />
            </Link>
          ) : (
            <span className="lat-marca">
              <span className="lat-logo">
                <Logo width={132} height={21} />
              </span>
            </span>
          )}
          <button
            type="button"
            onClick={toggleCollapse}
            className="lat-plegar"
            aria-label={isCollapsed ? 'Desplegar la barra lateral' : 'Plegar la barra lateral'}
            aria-expanded={!isCollapsed}
          >
            <ChevronLeft className="lat-plegar-icono" aria-hidden />
          </button>
        </div>

        {/* Menú de aplicaciones */}
        <nav className="lat-nav" aria-label="Aplicaciones">
          <p className="lat-rotulo" aria-hidden>
            Aplicaciones
          </p>
          <div className="lat-lista" ref={listaRef}>
            <span
              className="lat-indicador"
              data-visible={hayMarca ? 'true' : 'false'}
              data-animar={animar ? 'true' : 'false'}
              style={{ '--y': `${posicion?.y ?? 0}px`, '--h': `${posicion?.h ?? 40}px` } as CSSProperties}
              aria-hidden
            />
            {(() => {
              // Una sola cuenta para todas las entradas (sueltas, cabeceras de desplegable y las de dentro): `--i` escalona la entrada de cada una
              let posicionEnLaLista = 0
              const entrada = (app: AppConfig, dentro: boolean) => {
                const i = posicionEnLaLista++
                const Icon = app.icon
                const activa = app.route === rutaActiva

                // Usar badge dinámico para web-leads si es admin
                const badge =
                  app.id === 'web-leads' && userRole === 'admin'
                    ? webLeadsBadge
                    : app.id === 'correo' && correoSinLeer > 0
                      ? correoSinLeer
                      : app.badge
                const insignia = etiquetaDeInsignia(badge, isCollapsed)

                return (
                  <Link
                    key={app.id}
                    href={app.route}
                    className={dentro ? 'lat-item lat-item-hijo' : 'lat-item'}
                    data-activa={activa ? 'true' : undefined}
                    aria-current={activa ? 'page' : undefined}
                    style={{ '--i': i } as CSSProperties}
                    onClick={(e) => {
                      setIsMobileOpen(false)
                      // Un clic normal: con Ctrl, Cmd o Mays se abre en otra pestaña y esta página no cambia
                      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
                      if (!activa) setPendiente(app.route)
                    }}
                    onMouseMove={seguirRaton}
                    onMouseEnter={(e) => mostrarEtiqueta(e.currentTarget, app.name)}
                    onMouseLeave={ocultarEtiqueta}
                    onFocus={(e) => mostrarEtiqueta(e.currentTarget, app.name)}
                    onBlur={ocultarEtiqueta}
                  >
                    <span className="lat-icono">
                      <Icon className="lat-icono-svg" aria-hidden />
                    </span>
                    <span className="lat-texto">{app.name}</span>
                    {insignia && (
                      <span key={insignia} className="lat-insignia">
                        {insignia}
                      </span>
                    )}
                  </Link>
                )
              }

              return menu.map((e) => {
                if (e.tipo === 'app') return entrada(e.app, false)

                const { grupo, apps: hijas } = e
                const abierto = abiertos.has(grupo.id)
                const GrupoIcono = grupo.icon
                const i = posicionEnLaLista++
                // Cerrado, la cabecera es la que se enciende si la página en la que se está es de dentro: así la marca no desaparece
                const encendida = !abierto && grupoActivo === grupo.id
                return (
                  <div key={grupo.id} className="lat-grupo" data-abierto={abierto ? 'true' : undefined}>
                    <button
                      type="button"
                      className="lat-item lat-grupo-cab"
                      data-activa={encendida ? 'true' : undefined}
                      aria-expanded={abierto}
                      aria-controls={`lat-grupo-${grupo.id}`}
                      style={{ '--i': i } as CSSProperties}
                      onClick={() => alternarGrupo(grupo.id)}
                      onMouseMove={seguirRaton}
                      onMouseEnter={(ev) => mostrarEtiqueta(ev.currentTarget, grupo.name)}
                      onMouseLeave={ocultarEtiqueta}
                      onFocus={(ev) => mostrarEtiqueta(ev.currentTarget, grupo.name)}
                      onBlur={ocultarEtiqueta}
                    >
                      <span className="lat-icono">
                        <GrupoIcono className="lat-icono-svg" aria-hidden />
                      </span>
                      <span className="lat-texto">{grupo.name}</span>
                      <ChevronRight className="lat-chevron" aria-hidden />
                    </button>
                    {abierto && (
                      <div className="lat-grupo-hijos" id={`lat-grupo-${grupo.id}`} role="group" aria-label={grupo.name}>
                        {hijas.map((a) => entrada(a, true))}
                      </div>
                    )}
                  </div>
                )
              })
            })()}
            {cargandoPermisos &&
              [0, 1, 2, 3].map((n) => (
                <span key={`espera-${n}`} className="lat-espera" style={{ '--i': menu.length + n } as CSSProperties} aria-hidden>
                  <span className="lat-espera-icono" />
                  <span className="lat-espera-texto" style={{ width: `${48 + ((n * 17) % 30)}%` }} />
                </span>
              ))}
          </div>
        </nav>

        {/* Pie: tu cuenta, los avisos y el tema.
            LAS NOTIFICACIONES Y EL TEMA VIVEN AQUÍ, ABAJO A LA IZQUIERDA: antes eran dos botones fijos arriba a la derecha de la pantalla y
            se montaban encima de pestañas, desplegables y botones de cabecera. En una barra plegada se apilan.
            «Gestión de usuarios» ya no se repite aquí: es una entrada más del menú y solo la ve quien puede abrirla (a los demás este enlace les devolvía al inicio). */}
        <div className="lat-pie">
          <div className="lat-usuario">
            <PerfilEnLaBarra id={userId} nombre={nombreVisible} iniciales={inicialesDe(userName, userEmail)} />
            <span className="lat-usuario-datos">
              <span className="lat-usuario-nombre">{nombreVisible}</span>
              <span className="lat-usuario-rol">{etiquetaDeRol(userRole)}</span>
            </span>
            <button type="button" onClick={cerrarSesion} className="lat-salir" title="Cerrar sesión" aria-label="Cerrar sesión">
              <LogOut className="lat-salir-icono" aria-hidden />
            </button>
          </div>

          {puedeVerTareas && (
            <Link href="/dashboard/tareas-clientes" className="lat-app" data-activa={inmersivo && !enElChat ? 'true' : undefined} aria-current={inmersivo && !enElChat ? 'page' : undefined} title={isCollapsed ? 'Tareas Clientes' : undefined} onClick={() => setIsMobileOpen(false)}>
              <span className="lat-icono">
                <KanbanSquare className="lat-icono-svg" aria-hidden />
              </span>
              <span className="lat-app-texto">Tareas Clientes</span>
            </Link>
          )}
          {puedeVerChat && (
            <Link href="/dashboard/chat" className="lat-app" data-activa={enElChat ? 'true' : undefined} aria-current={enElChat ? 'page' : undefined} title={isCollapsed ? 'Chat' : undefined} onClick={() => setIsMobileOpen(false)}>
              <span className="lat-icono">
                <MessagesSquare className="lat-icono-svg" aria-hidden />
                {chatSinLeer.menciones + chatSinLeer.mensajes > 0 && (
                  <span className="lat-insignia-chat" data-mencion={chatSinLeer.menciones > 0 ? 'true' : undefined} aria-label={`${chatSinLeer.menciones + chatSinLeer.mensajes} sin leer en el chat`}>
                    {chatSinLeer.menciones + chatSinLeer.mensajes > 99 ? '99+' : chatSinLeer.menciones + chatSinLeer.mensajes}
                  </span>
                )}
              </span>
              <span className="lat-app-texto">Chat</span>
            </Link>
          )}

          <div className="lat-acciones">
            <NotificationsBell colapsado={isCollapsed} conTareas={puedeVerTareas} />
            <ThemeToggle />
          </div>
        </div>

        {/* El nombre de la entrada, al lado, cuando la barra va plegada */}
        <div
          className="lat-etiqueta"
          data-visible={isCollapsed && etiquetaVisible ? 'true' : 'false'}
          style={{ top: etiqueta?.y ?? 0 }}
          role="tooltip"
          aria-hidden={!(isCollapsed && etiquetaVisible)}
        >
          {etiqueta?.texto}
        </div>
      </aside>

      {/* La barra de pestañas de abajo (móvil). No para un cliente (solo ve Remesas y no tiene Inicio) ni a pantalla completa */}
      {!inmersivo && userRole !== 'cliente' && (
        <BarraInferior
          pestanas={pestanasMovil}
          rutaActiva={rutaDelMovil}
          enInicio={enInicio}
          masAbierto={isMobileOpen}
          alPulsar={(ruta) => {
            setIsMobileOpen(false)
            setPendiente(ruta)
          }}
          alPulsarMas={toggleMobile}
        />
      )}

      {/* Telón del cajón en pantallas estrechas */}
      {isMobileOpen && <div className="lat-velo" data-inmersivo={inmersivo ? 'true' : undefined} onClick={toggleMobile} aria-hidden />}
    </>
  )
}
