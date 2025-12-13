'use client'

import { FileSpreadsheet, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

interface EmptyStateProps {
  clientId: string
}

export function EmptyState({ clientId }: EmptyStateProps) {
  return (
    <div className="glass-card p-12 rounded-xl text-center">
      <div className="max-w-md mx-auto">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-[#FF6600]/10 border border-[#FF6600]/20 flex items-center justify-center">
          <FileSpreadsheet className="h-10 w-10 text-[#FF6600]" />
        </div>
        <h3 className="text-xl font-semibold text-white mb-2">
          No hay datos disponibles
        </h3>
        <p className="text-white/60 mb-6">
          Sube tu primer reporte en la pestaña Optimizar para ver datos aquí
        </p>
        <Button
          asChild
          className="bg-[#FF6600] text-white hover:bg-[#FF6600]/90"
        >
          <Link href={`/dashboard/marketing/${clientId}/optimize`}>
            <Sparkles className="h-4 w-4 mr-2" />
            Ir a Optimizar
          </Link>
        </Button>
      </div>
    </div>
  )
}

