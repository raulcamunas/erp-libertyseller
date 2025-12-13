import { 
  Home, 
  Users, 
  DollarSign, 
  FileText, 
  Settings, 
  BarChart3,
  Calculator,
  Globe,
  Linkedin
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
    id: 'leads',
    name: 'Gestión de Leads',
    description: 'Gestiona tus leads y oportunidades',
    icon: Users,
    route: '/dashboard/leads',
    badge: 'Nuevo',
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
    id: 'finances',
    name: 'Finanzas',
    description: 'Control financiero y facturación',
    icon: DollarSign,
    route: '/dashboard/finances',
    status: 'active',
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
    id: 'reports',
    name: 'Reportes',
    description: 'Análisis y reportes detallados',
    icon: BarChart3,
    route: '/dashboard/reports',
    status: 'active',
    category: 'analytics'
  },
  {
    id: 'documents',
    name: 'Documentos',
    description: 'Gestión de documentos y archivos',
    icon: FileText,
    route: '/dashboard/documents',
    status: 'inactive',
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
  }
]

export const getAppById = (id: string): AppConfig | undefined => {
  return apps.find(app => app.id === id)
}

export const getAppsByCategory = (category: string): AppConfig[] => {
  return apps.filter(app => app.category === category)
}

