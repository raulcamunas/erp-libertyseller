'use client'

import { useRouter } from 'next/navigation'
import { FileSearch, Upload, TrendingUp, BarChart3, Brain, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export default function AuditorPage() {
  const router = useRouter()

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="heading-medium text-white mb-2">Sales Auditor</h1>
        <p className="text-white/50">
          Auditoría estratégica completa de cuentas Amazon FBA con análisis de IA
        </p>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <FileSearch className="h-6 w-6 text-[#FF6600]" />
            ¿Cómo funciona?
          </CardTitle>
          <CardDescription className="text-white/60">
            Herramienta profesional de auditoría para vendedores Amazon FBA
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex items-start gap-3 p-4 rounded-lg bg-white/5">
              <Upload className="h-5 w-5 text-[#FF6600] mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-white mb-1">Sube tus Datos</h3>
                <p className="text-sm text-white/70">
                  Sube los archivos CSV de Helium 10 (Xray y Cerebro) y la URL de tu cuenta
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-lg bg-white/5">
              <BarChart3 className="h-5 w-5 text-[#FF6600] mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-white mb-1">Análisis Automático</h3>
                <p className="text-sm text-white/70">
                  Detecta automáticamente el modelo de negocio (ARBITRAGE o PRIVATE LABEL)
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-lg bg-white/5">
              <TrendingUp className="h-5 w-5 text-[#FF6600] mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-white mb-1">Métricas Precisas</h3>
                <p className="text-sm text-white/70">
                  Calcula oportunidades perdidas, riesgo y productos con potencial
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-lg bg-white/5">
              <Brain className="h-5 w-5 text-[#FF6600] mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="font-semibold text-white mb-1">Análisis IA</h3>
                <p className="text-sm text-white/70">
                  GPT-4o genera un informe estratégico personalizado con plan de acción
                </p>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-white/10">
            <Button
              onClick={() => router.push('/dashboard/auditor/new')}
              className="w-full"
            >
              <Upload className="h-4 w-4 mr-2" />
              Crear Nueva Auditoría
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Share2 className="h-6 w-6 text-[#FF6600]" />
            Compartir Auditorías
          </CardTitle>
          <CardDescription className="text-white/60">
            Genera enlaces públicos para compartir con clientes potenciales
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-white/70 text-sm mb-4">
            Cada auditoría genera un enlace público único que puedes compartir. El cliente verá un dashboard profesional con todas las métricas y el análisis de IA.
          </p>
          <Button
            variant="outline"
            onClick={() => router.push('/dashboard/auditor/reports')}
            className="w-full"
          >
            Ver Mis Auditorías
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}


