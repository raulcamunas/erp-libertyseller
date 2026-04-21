'use client'

import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Sparkles, Shuffle, Bug } from 'lucide-react'

export default function ListingBuilderHubPage() {
  const router = useRouter()

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="heading-medium text-white mb-2">Listing Builder</h1>
        <p className="text-white/50">
          Genera, valida y depura archivos planos (flat files) de Amazon con IA
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-[#FF6600]" />
              Listing Builder
            </CardTitle>
            <CardDescription className="text-white/60">
              Genera título, bullets, descripción y backend keywords optimizados (COSMO 2025)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => router.push('/dashboard/listing-builder/builder')}>
              Abrir
            </Button>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Shuffle className="h-5 w-5 text-[#FF6600]" />
              Arbitraje
            </CardTitle>
            <CardDescription className="text-white/60">
              Genera Inventory Loader / Listing Loader (próximamente)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" variant="outline" disabled>
              Próximamente
            </Button>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Bug className="h-5 w-5 text-[#FF6600]" />
              Depurador
            </CardTitle>
            <CardDescription className="text-white/60">
              Analiza Processing Reports y propone correcciones (próximamente)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" variant="outline" disabled>
              Próximamente
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
