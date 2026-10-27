'use client'

import { useState, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties, type MouseEvent } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, LogOut, Menu, X } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { NotificationsBell } from '@/components/layout/NotificationsBell'
import { leerCorreoSinLeer, suscribirContadores } from '@/lib/avisos/contadores'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { apps, APPS_FUERA_DEL_MENU, APPS_OCULTAS_A_ADMIN, APPS_SOLO_ADMIN, APP_CRM, APP_GROWTH, GRUPOS_DEL_MENU, puedeVerCrm, puedeVerGrowth, type AppConfig } from '@/lib/config/apps'
import { etiquetaDeRol } from '@/lib/inicio/saludo'
import { etiquetaDeInsignia, inicialesDe, rutaActivaDelMenu } from '@/lib/layout/barra'
import { aplanarMenu, armarMenu, grupoDeLaRuta, rutaParaElMenu } from '@/lib/layout/menu'
import { createClient } from '@/lib/supabase/client'
import type { RolUsuario } from '@/lib/types/users'

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
  role: RolUsuario
  email: string | null
  full_name: string | null
}

// Antes de pintar, medir dónde está la entrada encendida; en el servidor no hay nada que medir y `useLayoutEffect` avisa
const useEfectoAntesDePintar = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** Qué desplegables estaban abiertos (los ids de grupo), para que al volver estén como se dejaron */
const CLAVE_DE_GRUPOS_ABIERTOS = 'erp:menu:grupos-abiertos'

const ANCHO_ABIERTA = '16rem'
const ANCHO_PLEGADA = '4.5rem'

export function AppSidebar({ perfil }: { perfil?: PerfilDeLaBarra }) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [userPermissions, setUserPermissions] = useState<Set<string>>(new Set())
  const [permisosCargados, setPermisosCargados] = useState(false)
  const [userRole, setUserRole] = useState<RolUsuario | null>(perfil?.role ?? null)
  const [userEmail, setUserEmail] = useState<string | null>(perfil?.email ?? null)
  const [userName, setUserName] = useState<string | null>(perfil?.full_name ?? null)
  const [webLeadsBadge, setWebLeadsBadge] = useState<number | undefined>(undefined)
  // Cuántas conversaciones de correo tienen algo sin leer: lo publica el lector de correo nuevo (components/avisos), esté donde esté la persona
  const correoSinLeer = useSyncExternalStore(suscribirContadores, leerCorreoSinLeer, () => 0)
  const pathname = usePathname()
  const router = useRouter()
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
        .select('role, email, full_name')
        .eq('id', user.id)
        .single()

      if (profile) {
        setUserRole(profile.role)
        setUserEmail(profile.email)
        setUserName(profile.full_name ?? null)

        // Si es admin, tiene acceso a todo
        if (profile.role === 'admin') {
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

  // Un empleado ve «Inicio» y, hasta que llegan sus permisos, unas filas que se están rellenando (en vez de un menú que de repente crece)
  const cargandoPermisos = userRole === 'employee' && !permisosCargados

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
    setIsCollapsed(!isCollapsed)
  }

  const toggleMobile = () => {
    setIsMobileOpen(!isMobileOpen)
  }

  const cerrarSesion = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
    router.refresh()
  }

  const nombreVisible = (userName ?? '').trim() || (userEmail ?? '').split('@')[0] || 'Mi cuenta'

  return (
    <>
      {/* Botón del menú, solo en pantallas estrechas */}
      <button
        type="button"
        onClick={toggleMobile}
        className="lat-hamburguesa"
        aria-label={isMobileOpen ? 'Cerrar el menú' : 'Abrir el menú'}
        aria-expanded={isMobileOpen}
      >
        {isMobileOpen ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
      </button>

      <aside className="lat" data-plegada={isCollapsed ? 'true' : undefined} data-movil={isMobileOpen ? 'abierta' : undefined} aria-label="Menú principal">
        {/* El fondo: una luz que se mueve despacio arriba y un hilo de luz que baja por el borde */}
        <div className="lat-decorado" aria-hidden>
          <span className="lat-aurora" />
          <span className="lat-hilo" />
        </div>

        {/* Cabecera con el logo */}
        <div className="lat-cabecera">
          {isCollapsed ? (
            <Link href="/" className="lat-monograma" aria-label="Liberty Seller Hub">
              <span>LS</span>
            </Link>
          ) : (
            <span className="lat-logo">
              <Logo width={132} height={21} />
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
            <span className="lat-avatar" aria-hidden>
              <span>{inicialesDe(userName, userEmail)}</span>
            </span>
            <span className="lat-usuario-datos">
              <span className="lat-usuario-nombre">{nombreVisible}</span>
              <span className="lat-usuario-rol">{etiquetaDeRol(userRole)}</span>
            </span>
            <button type="button" onClick={cerrarSesion} className="lat-salir" title="Cerrar sesión" aria-label="Cerrar sesión">
              <LogOut className="lat-salir-icono" aria-hidden />
            </button>
          </div>

          <div className="lat-acciones">
            <NotificationsBell colapsado={isCollapsed} />
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

      {/* Telón del cajón en pantallas estrechas */}
      {isMobileOpen && <div className="lat-velo" onClick={toggleMobile} aria-hidden />}
    </>
  )
}
