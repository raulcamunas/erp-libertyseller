import { 
  Home, 
  Users, 
  DollarSign, 
  Calculator,
  Globe,
  Linkedin,
  TrendingUp,
  Activity,
  Briefcase,
  CheckCircle2,
  FileSearch
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
    id: 'users',
    name: 'Gestión de Usuarios',
    description: 'Crea y gestiona usuarios del sistema',
    icon: Users,
    route: '/dashboard/users',
    status: 'active',
    category: 'core'
  },
  {
    id: 'marketing',
    name: 'PPC Agency Hub',
    description: 'Gestión de clientes y campañas PPC',
    icon: TrendingUp,
    route: '/dashboard/marketing',
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
    id: 'clients',
    name: 'Canvas Clientes',
    description: 'Gestión de clientes tipo Notion con tareas y más',
    icon: Briefcase,
    route: '/dashboard/clients',
    status: 'active',
    category: 'core'
  },
  {
    id: 'validator',
    name: 'Validador FBA',
    description: 'Validación de rentabilidad de productos Amazon FBA',
    icon: CheckCircle2,
    route: '/dashboard/validator',
    status: 'active',
    category: 'analytics'
  },
  {
    id: 'auditor',
    name: 'Sales Auditor',
    description: 'Auditoría estratégica de cuentas Amazon FBA',
    icon: FileSearch,
    route: '/dashboard/auditor',
    status: 'active',
    category: 'analytics'
  }
]

export const getAppById = (id: string): AppConfig | undefined => {
  return apps.find(app => app.id === id)
}

export const getAppsByCategory = (category: string): AppConfig[] => {
  return apps.filter(app => app.category === category)
}

