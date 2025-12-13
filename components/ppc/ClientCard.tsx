'use client'

import { PPCClient } from '@/lib/types/ppc'
import { Badge } from '@/components/ui/badge'
import { Building2, Play, Pause } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import Image from 'next/image'

interface ClientCardProps {
  client: PPCClient
}

export function ClientCard({ client }: ClientCardProps) {
  const router = useRouter()

  const handleClick = () => {
    router.push(`/dashboard/marketing/${client.id}`)
  }

  return (
    <div
      onClick={handleClick}
      className={cn(
        "glass-card p-6 rounded-xl cursor-pointer transition-all duration-300",
        "hover:border-[#FF6600]/30 hover:scale-[1.02]",
        "flex flex-col gap-4"
      )}
    >
      {/* Header con Logo y Estado */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          {client.logo_url ? (
            <div className="relative w-16 h-16 rounded-lg overflow-hidden bg-white/5 border border-white/10">
              <Image
                src={client.logo_url}
                alt={client.name}
                fill
                className="object-contain p-2"
              />
            </div>
          ) : (
            <div className="w-16 h-16 rounded-lg bg-[#FF6600]/10 border border-[#FF6600]/20 flex items-center justify-center">
              <Building2 className="h-8 w-8 text-[#FF6600]" />
            </div>
          )}
          <div>
            <h3 className="text-lg font-semibold text-white mb-1">
              {client.name}
            </h3>
            <p className="text-sm text-white/50">
              {client.currency}
            </p>
          </div>
        </div>
        <Badge
          className={cn(
            "px-3 py-1 text-xs font-semibold",
            client.status === 'active'
              ? "bg-green-500/20 text-green-400 border border-green-500/30"
              : "bg-orange-500/20 text-orange-400 border border-orange-500/30"
          )}
        >
          {client.status === 'active' ? (
            <>
              <Play className="h-3 w-3 inline mr-1" />
              Activo
            </>
          ) : (
            <>
              <Pause className="h-3 w-3 inline mr-1" />
              Pausado
            </>
          )}
        </Badge>
      </div>

      {/* Footer con indicador de acción */}
      <div className="pt-4 border-t border-white/10">
        <p className="text-xs text-white/40 flex items-center gap-2">
          <span>Click para ver detalles</span>
          <span className="text-[#FF6600]">→</span>
        </p>
      </div>
    </div>
  )
}

