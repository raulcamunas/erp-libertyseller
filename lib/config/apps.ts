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
  Boxes,
  HandCoins,
  Palmtree,
  Palette,
  Plug
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
  {
    id: 'stock-sync',
    name: 'Sincronismo de stock',
    description: 'Del volcado del ERP del cliente al fichero de stock de Amazon',
    icon: Boxes,
    route: '/dashboard/stock-sync',
    status: 'new',
    category: 'core'
  },
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
    description: 'Catálogo, precios y stock de los clientes, directo contra Amazon',
    icon: Plug,
    route: '/dashboard/amazon-api',
    status: 'new',
    category: 'core'
  },
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

export const getAppById = (id: string): AppConfig | undefined => {
  return apps.find(app => app.id === id)
}

export const getAppsByCategory = (category: string): AppConfig[] => {
  return apps.filter(app => app.category === category)
}
