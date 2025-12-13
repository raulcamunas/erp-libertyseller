'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { LayoutDashboard, Sparkles, History, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ClientNavbarProps {
  clientId: string
  clientName: string
}

const navItems = [
  {
    id: 'dashboard',
    label: 'Dashboard General',
    icon: LayoutDashboard,
    href: (clientId: string) => `/dashboard/marketing/${clientId}`,
  },
  {
    id: 'optimize',
    label: 'Optimizar (Fusión)',
    icon: Sparkles,
    href: (clientId: string) => `/dashboard/marketing/${clientId}/optimize`,
  },
  {
    id: 'history',
    label: 'Histórico',
    icon: History,
    href: (clientId: string) => `/dashboard/marketing/${clientId}/history`,
  },
  {
    id: 'settings',
    label: 'Configuración',
    icon: Settings,
    href: (clientId: string) => `/dashboard/marketing/${clientId}/settings`,
  },
]

export function ClientNavbar({ clientId, clientName }: ClientNavbarProps) {
  const pathname = usePathname()

  const isActive = (href: string) => {
    if (href === `/dashboard/marketing/${clientId}`) {
      return pathname === href
    }
    return pathname.startsWith(href)
  }

  return (
    <div className="glass-card p-4 rounded-xl mb-6">
      {/* Header con nombre del cliente */}
      <div className="mb-4 pb-4 border-b border-white/10">
        <h2 className="text-xl font-semibold text-white">
          {clientName}
        </h2>
      </div>

      {/* Navegación */}
      <nav className="flex flex-wrap gap-2">
        {navItems.map((item) => {
          const Icon = item.icon
          const href = item.href(clientId)
          const active = isActive(href)

          return (
            <Link
              key={item.id}
              href={href}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200",
                "text-sm font-medium",
                active
                  ? "bg-[#FF6600]/20 text-[#FF6600] border border-[#FF6600]/30"
                  : "text-white/70 hover:text-white hover:bg-white/[0.05] border border-transparent"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

