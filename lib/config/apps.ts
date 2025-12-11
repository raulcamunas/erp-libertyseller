import { 
  Home, 
  Users, 
  DollarSign, 
  FileText, 
  Settings, 
  BarChart3,
  Mail,
  ShoppingCart
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
    id: 'finances',
    name: 'Finanzas',
    description: 'Control financiero y facturación',
    icon: DollarSign,
    route: '/dashboard/finances',
    status: 'inactive',
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
    id: 'email',
    name: 'Email Marketing',
    description: 'Campañas y comunicaciones',
    icon: Mail,
    route: '/dashboard/email',
    status: 'inactive',
    category: 'productivity'
  },
  {
    id: 'orders',
    name: 'Pedidos',
    description: 'Gestión de pedidos y envíos',
    icon: ShoppingCart,
    route: '/dashboard/orders',
    status: 'inactive',
    category: 'core'
  }
]

export const getAppById = (id: string): AppConfig | undefined => {
  return apps.find(app => app.id === id)
}

export const getAppsByCategory = (category: string): AppConfig[] => {
  return apps.filter(app => app.category === category)
}

