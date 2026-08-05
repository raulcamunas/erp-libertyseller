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
  CalendarDays
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
  }
]

export const getAppById = (id: string): AppConfig | undefined => {
  return apps.find(app => app.id === id)
}

export const getAppsByCategory = (category: string): AppConfig[] => {
  return apps.filter(app => app.category === category)
}
