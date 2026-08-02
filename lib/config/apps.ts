import {
  Home,
  Users,
  Calculator,
  Globe,
  Linkedin,
  Activity,
  Clock,
  Timer,
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
    id: 'horas',
    name: 'Mis Horas',
    description: 'Apunta tus horas y mira en vivo tu salario y comisiones',
    icon: Timer,
    route: '/dashboard/horas',
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
