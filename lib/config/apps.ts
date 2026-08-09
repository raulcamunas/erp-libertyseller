import {
  Home,
  Users,
  Calculator,
  Globe,
  Linkedin,
  Activity,
  Clock,
  Timer,
  PhoneCall,
  Landmark,
  Megaphone,
  PhoneForwarded,
  CalendarDays,
  HandCoins,
  Palmtree,
  Palette,
  Plug,
  Sprout
} from 'lucide-react'
import { LucideIcon } from 'lucide-react'

export interface AppConfig {
  id: string
  name: string
  description: string
  icon: LucideIcon
  route: string
  badge?: string | number
  status?: 'active' | 'inactive' | 'new'
  category?: 'core' | 'productivity' | 'analytics'
}

export const apps: AppConfig[] = [
  {
    id: 'home',
    name: 'Inicio',
    description: 'Dashboard principal',
    icon: Home,
    route: '/dashboard',
    status: 'active',
    category: 'core'
  },
  {
    id: 'web-leads',
    name: 'CRM Leads Web',
    description: 'Leads desde tu sitio web',
    icon: Globe,
    route: '/dashboard/web-leads',
    status: 'active',
    category: 'core'
  },
  {
    id: 'linkedin',
    name: 'LinkedIn Prospección',
    description: 'Gestión de prospección ABM en LinkedIn',
    icon: Linkedin,
    route: '/dashboard/linkedin',
    status: 'active',
    category: 'core'
  },
  {
    id: 'agenda',
    name: 'Agenda Comercial',
    description: 'Calendario de citas del equipo, sincronizado con Google Calendar',
    icon: CalendarDays,
    route: '/dashboard/agenda',
    status: 'new',
    category: 'core'
  },
  {
    id: 'commissions',
    name: 'Comisiones',
    description: 'Calculadora de comisiones y liquidaciones',
    icon: Calculator,
    route: '/dashboard/commissions',
    status: 'active',
    category: 'core'
  },
  {
    id: 'commissions-shoes-f',
    name: 'Comisiones Shoes F',
    description: 'Comparativa de años + % manual + desglose por país',
    icon: Calculator,
    route: '/dashboard/commissions-shoes-f',
    status: 'active',
    category: 'core'
  },
  {
    id: 'cold-calling',
    name: 'Cold Calling',
    description: 'Cartera de sellers a prospectar, con estado e historial de llamadas',
    icon: PhoneCall,
    route: '/dashboard/cold-calling',
    status: 'new',
    category: 'core'
  },
  {
    id: 'horas',
    name: 'Mis Horas',
    description: 'Apunta tus horas y mira en vivo tu salario y comisiones',
    icon: Timer,
    route: '/dashboard/horas',
    status: 'new',
    category: 'productivity'
  },
  {
    id: 'tesoreria',
    name: 'Tesorería',
    description: 'Ingresos por cliente, gastos y beneficio mes a mes',
    icon: Landmark,
    route: '/dashboard/tesoreria',
    status: 'new',
    category: 'core'
  },
  {
    // 'empleados' no lo usa ninguna otra app. El id tiene que coincidir letra
    // por letra aquí, en el mapa de middleware.ts y en la columna app_id de
    // user_app_permissions: si baila en uno de los tres, el módulo queda
    // invisible sin dar ningún error.
    // Icono distinto de Users (gestión de usuarios) y de Activity (Employee
    // Tracker): tres apps con gente dentro y en el menú se distinguen por el
    // dibujo antes que por el texto.
    id: 'empleados',
    name: 'Control empleados',
    description: 'Horas contratadas, sueldos y subidas mes a mes',
    icon: HandCoins,
    route: '/dashboard/empleados',
    status: 'new',
    category: 'core'
  },
  {
    // Al contrario que 'empleados', esta SÍ la ve el equipo: cada uno su
    // calendario y su saldo, sin un solo dato salarial. Por eso es una ruta
    // aparte y no una pestaña dentro de Control empleados, que está cerrada a
    // admin porque enseña los sueldos.
    // El id tiene que coincidir letra por letra aquí, en el mapa de
    // middleware.ts y en la columna app_id de user_app_permissions (lo reparte
    // la migración 116). Si baila en uno de los tres, la app queda invisible
    // sin dar ningún error.
    id: 'vacaciones',
    name: 'Mis vacaciones',
    description: 'Días generados, los que has cogido y los que puedes pedir',
    icon: Palmtree,
    route: '/dashboard/vacaciones',
    status: 'new',
    category: 'productivity'
  },
  {
    // El id no es 'marketing' a propósito: esa app quedó retirada del menú y
    // reutilizar su id le daría acceso a este módulo a quien tuviera aquel
    // permiso suelto en user_app_permissions.
    id: 'marketing-ads',
    name: 'Marketing',
    description: 'Revisión semanal de las campañas de Amazon Ads',
    icon: Megaphone,
    route: '/dashboard/marketing-ads',
    status: 'new',
    category: 'core'
  },
  // 'stock-sync' YA NO ES UNA APP DEL MENÚ. No se ha borrado nada: el módulo
  // entero vive ahora dentro de Growth Partner, en /dashboard/growth?m=stock-sync,
  // porque sincronizar el stock de un cliente es TRABAJAR sobre su cuenta y ese
  // es el corte que separa los dos módulos de Amazon (ver el comentario de
  // 'growth'). /dashboard/stock-sync sigue existiendo y redirige, que hay gente
  // con esa dirección abierta y en marcadores.
  //
  // El id 'stock-sync' SIGUE VIVO en user_app_permissions y en el mapa
  // routeToAppId de middleware.ts, y no se toca: borrar esas filas sería tirar
  // los permisos que alguien repartió a mano, y volver a concederlos exige
  // acordarse de a quién. Que no esté en esta lista solo significa que no se
  // pinta como una tarjeta ni como una entrada de menú.
  {
    // SOLO ADMIN, y por la misma razón que 'empleados': desde aquí se cambian
    // precios y stock en las tiendas de los clientes, y se guardan las llaves
    // de acceso a esas tiendas. Está cerrado en cuatro sitios —middleware.ts,
    // el filtro de esta lista en app/dashboard/page.tsx, el de
    // components/layout/AppSidebar.tsx y las políticas RLS de la migración
    // 118—, y el que manda de verdad es el último.
    //
    // Convive con 'stock-sync' a propósito: aquel hace lo mismo por fichero y
    // se ha decidido que los dos sigan. Icono distinto (Plug: se enchufa a
    // Amazon) para que en el menú no se confundan.
    //
    // El id tiene que coincidir letra por letra aquí, en middleware.ts y en la
    // columna app_id de user_app_permissions (lo reparte la migración 118). Si
    // baila en uno de los tres, el módulo queda invisible sin dar ningún error.
    id: 'amazon-api',
    name: 'Amazon API',
    description: 'Las tripas: cuentas, catálogo, marcas, costes, BSR y de dónde sale cada dato',
    icon: Plug,
    route: '/dashboard/amazon-api',
    status: 'new',
    category: 'core'
  },
  {
    // GROWTH PARTNER — el trabajo sobre la cuenta de un cliente.
    //
    // EL CORTE ENTRE ESTE MÓDULO Y AMAZON API, que es la regla que decide dónde
    // va cada pantalla nueva y por eso está escrita aquí y no en un documento:
    //
    //   CONFIGURAR va en Amazon API. TRABAJAR va en Growth Partner.
    //
    // De dónde llega el fichero de un cliente se configura en las tripas; el
    // sincronizar de verdad vive aquí. Qué marcas son suyas se decide en las
    // tripas; el análisis FBM→FBA que usa esa marca vive aquí.
    //
    // Todo cuelga de UN SELECTOR DE CLIENTE común a los submódulos. No es una
    // preferencia de diseño: es el compromiso firmado ante Amazon. Los datos de
    // un vendedor se usan exclusivamente para operar SU cuenta, así que no hay
    // ni una vista que mezcle, agregue o compare clientes.
    //
    // SOLO ADMIN, igual que Amazon API: desde aquí se ven los datos de las
    // cuentas de los clientes. El id tiene que coincidir letra por letra aquí,
    // en middleware.ts y en APPS_SOLO_ADMIN de más abajo; si baila en uno, el
    // módulo queda invisible sin dar ningún error.
    id: 'growth',
    name: 'Growth Partner',
    description: 'Lo que hacemos crecer en la cuenta de un cliente: stock, Buy Box y FBM→FBA',
    icon: Sprout,
    route: '/dashboard/growth',
    status: 'new',
    category: 'analytics'
  },
  // 'plataforma' YA NO ES UNA APP DEL MENÚ. Su contenido —los trabajos de
  // ingesta, la cobertura de datos y la ficha de SKU— es ahora la pestaña
  // «Ingesta» de Amazon API: es información sobre lo que guardamos, o sea las
  // tripas, y tenerla en un módulo aparte obligaba a saber de antemano en cuál
  // de los dos estaba cada cosa. /dashboard/plataforma redirige a la pestaña.
  {
    id: 'telefonos',
    name: 'Teléfonos',
    description: 'Números que usamos y para qué es cada uno',
    icon: PhoneForwarded,
    route: '/dashboard/telefonos',
    status: 'new',
    category: 'productivity'
  },
  {
    id: 'users',
    name: 'Gestión de Usuarios',
    description: 'Crea y gestiona usuarios del sistema',
    icon: Users,
    route: '/dashboard/users',
    status: 'active',
    category: 'core'
  },
  {
    id: 'tracker',
    name: 'Employee Tracker',
    description: 'Seguimiento de actividad de empleados',
    icon: Activity,
    route: '/dashboard/tracker',
    status: 'active',
    category: 'productivity'
  },
  {
    id: 'usos-horarios',
    name: 'Usos horarios',
    description: 'México (4 zonas) y España (Madrid)',
    icon: Clock,
    route: '/dashboard/usos-horarios',
    status: 'active',
    category: 'productivity'
  },
  {
    // SOLO ADMIN, por dos motivos. Uno: es una pantalla de DECISIÓN y la
    // decisión la toman los socios — enseñarle al equipo tres ERP posibles antes
    // de que haya uno elegido es sembrar tres expectativas y defraudar dos. Dos:
    // las maquetas usan nombres reales de cuentas y clientes de la agencia, con
    // cifras y estados inventados, porque con relleno no se puede juzgar una
    // tabla.
    //
    // Cerrada en tres sitios: middleware.ts, el redirect del propio
    // app/dashboard/disenos/page.tsx (el que manda, porque corre en servidor) y
    // el filtro de esta lista, replicado en app/dashboard/page.tsx y en
    // components/layout/AppSidebar.tsx. No hay migración ni políticas RLS porque
    // el módulo no consulta ninguna tabla: lo que protege esos nombres es el
    // control de rol, no la base de datos.
    //
    // A diferencia de 'empleados' y 'amazon-api', el id no aparece en
    // user_app_permissions: no se puede conceder a nadie suelto, es admin o nada.
    id: 'disenos',
    name: 'Diseños del ERP',
    description: 'Tres propuestas de cambio de imagen sobre las pantallas reales, para elegir una',
    icon: Palette,
    route: '/dashboard/disenos',
    status: 'new',
    category: 'productivity'
  }
]

/**
 * LAS APPS QUE SON DE ADMIN Y DE NADIE MÁS.
 *
 * Estaba escrito a mano y por duplicado en app/dashboard/page.tsx y en
 * components/layout/AppSidebar.tsx: cuatro `if` idénticos en cada fichero, ocho
 * en total. Así es como se llega a que un módulo salga en el menú pero no en la
 * rejilla, o al revés, sin que nadie dé un error.
 *
 * NO ES EL FILTRO DE VERDAD. Esto solo decide qué se PINTA. Quien manda son las
 * políticas RLS de cada módulo y el requireAmazonAdmin() de cada ruta de API; en
 * middleware.ts todo lo que empieza por /api/ es ruta pública, así que una ruta
 * que no comprueba nada le contesta a cualquiera. Esta lista evita el viaje y la
 * pantalla vacía, nada más.
 *
 * Se comprueba ANTES del «si es admin, acceso a todo» de los dos filtros, y
 * antes del «si aún no se ha cargado el rol, enseñar todas» del menú: sin eso,
 * un employee con el permiso suelto en user_app_permissions vería la entrada, y
 * cualquiera la vería parpadear mientras se resuelve el perfil.
 */
export const APPS_SOLO_ADMIN: ReadonlySet<string> = new Set([
  // Los sueldos de todo el equipo.
  'empleados',
  // Las llaves de las tiendas de los clientes y el botón que les cambia el precio.
  'amazon-api',
  // Una pantalla de decisión, con nombres reales de clientes en las maquetas.
  'disenos',
])

/**
 * Growth Partner NO está en la lista de arriba, y no es un descuido.
 *
 * Es solo-admin CON UNA EXCEPCIÓN: quien tenga el permiso suelto 'stock-sync'
 * —la persona de operaciones, que sube el stock dos veces por semana— entra y ve
 * ÚNICAMENTE el submódulo de sincronismo. Antes de la mudanza ese módulo era una
 * entrada propia del menú y esa persona la tenía; si Growth quedara en
 * APPS_SOLO_ADMIN, la entrada desaparecería del menú y de la rejilla y se
 * quedaría sin ninguna puerta.
 *
 * El porqué entero y el recorte de lo que ve están en lib/growth/acceso.ts. Aquí
 * solo se decide QUÉ SE PINTA; quien manda son las RLS y el middleware.
 */
export const APP_GROWTH = 'growth'
export const PERMISO_STOCK_SYNC = 'stock-sync'

export function puedeVerGrowth(
  rol: string | null | undefined,
  permisos: ReadonlySet<string>
): boolean {
  return rol === 'admin' || permisos.has(PERMISO_STOCK_SYNC)
}

export const getAppById = (id: string): AppConfig | undefined => {
  return apps.find(app => app.id === id)
}

export const getAppsByCategory = (category: string): AppConfig[] => {
  return apps.filter(app => app.category === category)
}
